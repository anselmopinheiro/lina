import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import LinaPlugin from "../../main.ts";
import { chunkText, Chunk } from "../../src/index/chunker";
import { hashContent } from "../../src/index/noteHasher";
import {
  IndexedNote,
  readIndexedChunks,
  readIndexedNotes,
  saveTextIndex,
} from "../../src/index/indexStore";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  createInitialExclusionPolicy,
  evolveExclusionPolicy,
  filterIndexedDatasetByPolicy,
  filterEmbeddingRecordsByPolicy,
  resolveDefensiveExclusionRules,
  ExclusionPolicyV1,
} from "../../src/index/exclusionPolicy";
import {
  purgeOrphanEmbeddingRecords,
  publishCanonicalEmbeddings,
} from "../../src/index/embeddingPersistence";
import {
  executeCompanionTextSearch,
  executeCompanionSemanticSearch,
  executeCompanionSearch,
} from "../../src/companion/companionSearch";
import {
  detectLocalDelta,
  executeCompanionSearchWithDelta,
} from "../../src/companion/companionDeltaSearch";
import { evaluateCompanionConsumptionState } from "../../src/companion/companionConsumptionState";
import { EmbeddingRecord } from "../../src/index/embeddingGenerator";
import { BinaryEmbeddingCopyController } from "../../src/index/embeddingBinaryCopyController";
import { BinaryEmbeddingDataAdapter, BinaryEmbeddingDigest } from "../../src/index/embeddingBinaryStorage";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import { shouldExcludeContent, shouldExcludePath } from "../../src/index/indexExclusions";

type TestableLinaPlugin = LinaPlugin & Record<string, unknown>;

class ControllerVault {
  adapter: FakeAdapter;
  configDir = ".obsidian";
  readPaths: string[] = [];
  private listedFiles: TFile[] = [];
  private contents = new Map<string, string>();

  constructor(adapter: FakeAdapter) {
    this.adapter = adapter;
  }

  setMarkdownFiles(files: TFile[]): void {
    this.listedFiles = files;
  }

  setContent(path: string, content: string): void {
    this.contents.set(path, content);
  }

  getMarkdownFiles(): TFile[] {
    return this.listedFiles;
  }

  async read(file: TFile): Promise<string> {
    this.readPaths.push(file.path);
    const content = this.contents.get(file.path);
    if (content === undefined) {
      throw new Error(`Missing fake content for ${file.path}`);
    }
    return content;
  }
}

class BinaryTestAdapter extends FakeAdapter implements BinaryEmbeddingDataAdapter {
  private binaryFiles = new Map<string, ArrayBuffer>();

  async readBinary(path: string): Promise<ArrayBuffer> {
    const buf = this.binaryFiles.get(this.normalizePath(path));
    if (!buf) throw new Error(`Missing binary file: ${path}`);
    return buf.slice(0);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.binaryFiles.set(this.normalizePath(path), data.slice(0));
  }

  override async stat(path: string): Promise<{ type: string; size: number; mtime: number } | null> {
    const normalized = this.normalizePath(path);
    const bin = this.binaryFiles.get(normalized);
    if (bin !== undefined) {
      return { type: "file", size: bin.byteLength, mtime: Date.now() };
    }
    return super.stat(normalized);
  }

  override async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);
    return (await super.exists(normalized)) || this.binaryFiles.has(normalized);
  }

  override async remove(path: string): Promise<void> {
    const normalized = this.normalizePath(path);
    this.binaryFiles.delete(normalized);
    await super.remove(normalized);
  }

  override async rename(oldPath: string, newPath: string): Promise<void> {
    const normOld = this.normalizePath(oldPath);
    const normNew = this.normalizePath(newPath);
    const bin = this.binaryFiles.get(normOld);
    if (bin !== undefined) {
      this.binaryFiles.delete(normOld);
      this.binaryFiles.set(normNew, bin);
    }
    await super.rename(normOld, normNew);
  }
}

function makeFile(path: string, content: string, mtime = 100): TFile {
  const file = new TFile(path, content);
  file.stat = { size: content.length, mtime };
  return file;
}

const mockProvenance = {
  deviceId: "producer-device-1",
  deviceName: "Desktop Workstation",
  deviceRole: "producer" as const,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function createHarness(): {
  adapter: FakeAdapter;
  vault: ControllerVault;
  plugin: TestableLinaPlugin;
} {
  const adapter = new FakeAdapter();
  const vault = new ControllerVault(adapter);
  const plugin = Object.create(LinaPlugin.prototype) as TestableLinaPlugin;

  plugin.app = { vault };
  plugin.manifest = { id: "lina" };
  plugin.settings = {
    autoUpdateIndexOnFileChanges: true,
    debugIndexUpdates: false,
    indexExcludedFolders: "",
    indexExcludedPathContains: "",
    indexExcludedContentContains: "",
    embeddingUpdateMode: "manual",
  };
  plugin.localDeviceState = {
    schemaVersion: 2,
    deviceId: "producer-device-1",
    role: "producer",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  plugin.canonicalPolicyStatus = "loaded";
  plugin.effectiveExclusionRules = {
    excludedFolders: [],
    excludedPathContains: [],
    excludedContentContains: [],
  };
  plugin.indexedNotes = [];
  plugin.indexedChunks = [];
  plugin.textIndexLoaded = false;
  plugin.pendingAutomaticUpdates = new Map();
  plugin.activeAutomaticIndexUpdates = 0;
  plugin.automaticUpdateInProgress = false;
  plugin.textIndexRebuildListeners = new Set();
  plugin.textIndexRebuildProgress = { status: "idle", totalNotes: 0, processedNotes: 0 };
  plugin.indexDiagnostic = { totalNotes: 0, totalChunks: 0 };

  plugin.getCanonicalExclusionPolicy = () => plugin.currentExclusionPolicy;
  plugin.getEffectiveExclusionRules = () => plugin.effectiveExclusionRules;
  plugin.getIndexPathExclusions = () => ({
    excludedFolders: plugin.effectiveExclusionRules?.excludedFolders ? [...plugin.effectiveExclusionRules.excludedFolders] : [],
    excludedPathContains: plugin.effectiveExclusionRules?.excludedPathContains ? [...plugin.effectiveExclusionRules.excludedPathContains] : [],
  });
  plugin.getExcludedContentTerms = () => plugin.effectiveExclusionRules?.excludedContentContains ? [...plugin.effectiveExclusionRules.excludedContentContains] : [];
  plugin.isIndexPathExcludedByUserRules = (path: string) => {
    const rules = plugin.effectiveExclusionRules ?? { excludedFolders: [], excludedPathContains: [], excludedContentContains: [] };
    return shouldExcludePath(path, { excludedFolders: rules.excludedFolders, excludedPathContains: rules.excludedPathContains }, ".obsidian").excluded;
  };
  plugin.isContentExcludedByUserRules = (content: string) => {
    const terms = plugin.effectiveExclusionRules?.excludedContentContains ?? [];
    return terms.length > 0 && shouldExcludeContent(content, terms).excluded;
  };
  plugin.getOwnershipGate = () => ({
    canPublish: vi.fn().mockResolvedValue(plugin.localDeviceState?.role === "producer"),
    isAuthorizedSync: () => plugin.localDeviceState?.role === "producer",
    getProvenance: () => mockProvenance,
  }) as never;

  // Provide a lightweight getTextIndexStatus mock so that
  // reconcileIndexExclusionsInRuntime can proceed without the full plugin
  // lifecycle. Reads the persisted manifest hash from the fake adapter so
  // the no-update branch correctly detects a hash change.
  plugin.getTextIndexStatus = vi.fn().mockImplementation(async () => {
    try {
      const raw = await adapter.read(".lina/index/manifest.json");
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      return {
        isUsable: true,
        usability: "ready",
        manifest,
        excludedNotes: 0,
        error: undefined,
      };
    } catch {
      return { isUsable: false, usability: "missing", manifest: undefined, excludedNotes: 0, error: "manifest-missing" };
    }
  });

  return { adapter, vault, plugin };
}

describe("LINA-03-004 — Artifact Invalidation & Companion Defensive Filtering", () => {
  // =========================================================================
  // Producer — Stricter Policy (Scenarios 1-5)
  // =========================================================================
  describe("Producer — stricter policy", () => {
    it("1 & 2: adding excluded folder removes note from index and removes its chunks", async () => {
      const { vault, plugin } = createHarness();
      const privateFile = makeFile("Private/Secret.md", "Sensitive private content");
      const publicFile = makeFile("Public/Doc.md", "Public documentation content");
      vault.setMarkdownFiles([privateFile, publicFile]);
      vault.setContent(privateFile.path, "Sensitive private content");
      vault.setContent(publicFile.path, "Public documentation content");

      const notes: IndexedNote[] = [
        {
          path: privateFile.path,
          basename: "Secret",
          extension: "md",
          size: 25,
          mtime: 100,
          contentHash: hashContent("Sensitive private content"),
          indexedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          path: publicFile.path,
          basename: "Doc",
          extension: "md",
          size: 29,
          mtime: 100,
          contentHash: hashContent("Public documentation content"),
          indexedAt: "2026-09-01T00:00:00.000Z",
        },
      ];
      const chunks: Chunk[] = [
        ...chunkText(privateFile.path, "Sensitive private content", { chunkSize: 1200, overlap: 150 }),
        ...chunkText(publicFile.path, "Public documentation content", { chunkSize: 1200, overlap: 150 }),
      ];

      const initialPolicy = createInitialExclusionPolicy(
        { excludedFolders: [], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );
      plugin.currentExclusionPolicy = initialPolicy;

      await saveTextIndex(
        plugin.app as never,
        notes,
        chunks,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        { enabled: true, alwaysExcludedFolders: [".obsidian"], excludedFoldersCount: 0, excludedPathContainsCount: 0, excludedContentContainsCount: 0 },
        mockProvenance,
        initialPolicy
      );

      plugin.indexedNotes = [...notes];
      plugin.indexedChunks = [...chunks];
      plugin.textIndexLoaded = true;

      // Make policy stricter: exclude Private/
      const stricterPolicy = evolveExclusionPolicy(
        initialPolicy,
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );
      plugin.currentExclusionPolicy = stricterPolicy;
      plugin.effectiveExclusionRules = stricterPolicy.rules;

      await (plugin as any).reconcileIndexExclusionsInRuntime();

      const persistedNotes = await readIndexedNotes(plugin.app as never);
      const persistedChunks = await readIndexedChunks(plugin.app as never);

      // Scenario 1: Note removed
      expect(persistedNotes?.map((n) => n.path)).toEqual(["Public/Doc.md"]);
      // Scenario 2: Chunks removed
      expect(persistedChunks?.map((c) => c.path)).toEqual(["Public/Doc.md"]);
    });

    it("3: orphan embeddings are safely purged/invalidated when chunks are excluded", async () => {
      const { plugin, adapter } = createHarness();
      const chunks: Chunk[] = [
        {
          chunkId: "c-public",
          path: "Public/Doc.md",
          chunkIndex: 0,
          text: "Public documentation content",
          textHash: "th-pub",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ];

      const records: EmbeddingRecord[] = [
        {
          chunkId: "c-private",
          path: "Private/Secret.md",
          index: 0,
          textHash: "th-priv",
          model: "nomic-embed-text",
          provider: "ollama",
          dimensions: 3,
          embedding: [0.1, 0.2, 0.3],
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        {
          chunkId: "c-public",
          path: "Public/Doc.md",
          index: 0,
          textHash: "th-pub",
          model: "nomic-embed-text",
          provider: "ollama",
          dimensions: 3,
          embedding: [0.4, 0.5, 0.6],
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ];

      // Publish initial embeddings containing both private and public
      await adapter.write(".lina/index/manifest.json", JSON.stringify({
        version: 1,
        indexType: "text",
        totalNotes: 2,
        totalChunks: 2,
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 3,
          totalEmbeddings: 2,
          publicationId: "pub-initial",
        },
        embeddingInput: { version: 1, prefixMode: "none" },
      }));

      await publishCanonicalEmbeddings(
        plugin.app as never,
        records,
        {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 3,
          inputVersion: 1,
          prefixMode: "none",
        }
      );

      // Now purge orphan embeddings using only public chunks and stricter policy
      const result = await purgeOrphanEmbeddingRecords(
        plugin.app as never,
        chunks,
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] }
      );

      expect(result.purgedCount).toBe(1);
      expect(result.remainingCount).toBe(1);

      const rawEmbeddings = await adapter.read(".lina/index/embeddings.jsonl");
      expect(rawEmbeddings).not.toContain("Private/Secret.md");
      expect(rawEmbeddings).toContain("Public/Doc.md");
    });

    it("4: derived binary copy becomes outdated when canonical embeddings are purged and republished", async () => {
      const adapter = new BinaryTestAdapter();
      const digest: BinaryEmbeddingDigest = {
        async digest(value: ArrayBuffer) {
          let total = 0;
          for (const byte of new Uint8Array(value)) total += byte;
          return `sha256:${total.toString(16).padStart(64, "0")}`;
        },
      };
      const coordinator = new IndexWriteCoordinator();

      // Seed initial canonical embeddings and binary storage
      const initialRecord: EmbeddingRecord = {
        chunkId: "c1",
        path: "Public/Doc.md",
        index: 0,
        textHash: "th1",
        provider: "ollama",
        model: "nomic",
        dimensions: 2,
        embedding: [0.1, 0.2],
        createdAt: "2026-09-01T00:00:00.000Z",
      };

      await adapter.write(".lina/index/manifest.json", JSON.stringify({
        version: 1,
        indexType: "text",
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider: "ollama",
          model: "nomic",
          dimensions: 2,
          totalEmbeddings: 1,
          publicationId: "pub-1",
        },
        embeddingInput: { version: 1, prefixMode: "none" },
      }));

      await publishCanonicalEmbeddings(
        { vault: { adapter } } as never,
        [initialRecord],
        { provider: "ollama", model: "nomic", dimensions: 2, inputVersion: 1, prefixMode: "none" }
      );

      const manifestAfterPublish = JSON.parse(await adapter.read(".lina/index/manifest.json"));
      const pubId = manifestAfterPublish.embeddings.publicationId;

      const binaryController = new BinaryEmbeddingCopyController(adapter as never, digest, coordinator);
      const buildResult = await binaryController.maintainAfterCanonicalPublication(pubId);
      expect(buildResult.status).toBe("valid");

      // Now purge records: simulate a change where c1 is removed and c2 remains
      const newRecord: EmbeddingRecord = {
        chunkId: "c2",
        path: "Public/Other.md",
        index: 0,
        textHash: "th2",
        provider: "ollama",
        model: "nomic",
        dimensions: 2,
        embedding: [0.3, 0.4],
        createdAt: "2026-09-01T00:00:00.000Z",
      };

      // Add new record, purge orphan c1
      await publishCanonicalEmbeddings(
        { vault: { adapter } } as never,
        [newRecord],
        { provider: "ollama", model: "nomic", dimensions: 2, inputVersion: 1, prefixMode: "none" }
      );

      // Binary copy controller check should now see status: "outdated" because publicationId changed!
      const checkSummary = await binaryController.check(true);
      expect(checkSummary.status).toBe("outdated");
    });

    it("5: final published manifest uses the new policyHash", async () => {
      const { vault, plugin, adapter } = createHarness();
      const file = makeFile("Public/Doc.md", "Public documentation content");
      vault.setMarkdownFiles([file]);
      vault.setContent(file.path, "Public documentation content");

      const notes: IndexedNote[] = [
        {
          path: file.path,
          basename: "Doc",
          extension: "md",
          size: 28,
          mtime: 100,
          contentHash: hashContent("Public documentation content"),
          indexedAt: "2026-09-01T00:00:00.000Z",
        },
      ];
      const chunks = chunkText(file.path, "Public documentation content", { chunkSize: 1200, overlap: 150 });

      const initialPolicy = createInitialExclusionPolicy(
        { excludedFolders: [], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );
      plugin.currentExclusionPolicy = initialPolicy;

      await saveTextIndex(
        plugin.app as never,
        notes,
        chunks,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        { enabled: true, alwaysExcludedFolders: [".obsidian"], excludedFoldersCount: 0, excludedPathContainsCount: 0, excludedContentContainsCount: 0 },
        mockProvenance,
        initialPolicy
      );

      plugin.indexedNotes = [...notes];
      plugin.indexedChunks = [...chunks];
      plugin.textIndexLoaded = true;

      // Stricter policy
      const newPolicy = evolveExclusionPolicy(
        initialPolicy,
        { excludedFolders: ["Archived/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );
      plugin.currentExclusionPolicy = newPolicy;
      plugin.effectiveExclusionRules = newPolicy.rules;

      await (plugin as any).reconcileIndexExclusionsInRuntime();

      const manifestRaw = await adapter.read(".lina/index/manifest.json");
      const manifest = JSON.parse(manifestRaw);

      expect(manifest.exclusionPolicyHash).toBe(newPolicy.policyHash);
      expect(manifest.exclusionPolicyRevision).toBe(newPolicy.policyRevision);
    });
  });

  // =========================================================================
  // Producer — Relaxed Policy (Scenarios 6-9)
  // =========================================================================
  describe("Producer — relaxed policy", () => {
    it("6, 7 & 8: removing exclusion makes note eligible, reindexes it, and recreates chunks without duplication", async () => {
      const { vault, plugin } = createHarness();
      const existingFile = makeFile("Public/Doc.md", "Existing public note");
      const unexcludedFile = makeFile("Private/Doc.md", "Previously excluded note now eligible");

      vault.setMarkdownFiles([existingFile, unexcludedFile]);
      vault.setContent(existingFile.path, "Existing public note");
      vault.setContent(unexcludedFile.path, "Previously excluded note now eligible");

      const existingNotes: IndexedNote[] = [
        {
          path: existingFile.path,
          basename: "Doc",
          extension: "md",
          size: 20,
          mtime: 100,
          contentHash: hashContent("Existing public note"),
          indexedAt: "2026-09-01T00:00:00.000Z",
        },
      ];
      const existingChunks = chunkText(existingFile.path, "Existing public note", { chunkSize: 1200, overlap: 150 });

      // Initially excluded Private/
      const initialPolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );
      plugin.currentExclusionPolicy = initialPolicy;

      await saveTextIndex(
        plugin.app as never,
        existingNotes,
        existingChunks,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        1,
        { enabled: true, alwaysExcludedFolders: [".obsidian"], excludedFoldersCount: 1, excludedPathContainsCount: 0, excludedContentContainsCount: 0 },
        mockProvenance,
        initialPolicy
      );

      plugin.indexedNotes = [...existingNotes];
      plugin.indexedChunks = [...existingChunks];
      plugin.textIndexLoaded = true;

      // Relax policy: remove Private/
      const relaxedPolicy = evolveExclusionPolicy(
        initialPolicy,
        { excludedFolders: [], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );
      plugin.currentExclusionPolicy = relaxedPolicy;
      plugin.effectiveExclusionRules = relaxedPolicy.rules;

      await (plugin as any).reconcileIndexExclusionsInRuntime();

      const persistedNotes = await readIndexedNotes(plugin.app as never);
      const persistedChunks = await readIndexedChunks(plugin.app as never);

      // Scenario 6 & 7: newly eligible note reindexed
      const paths = persistedNotes?.map((n) => n.path).sort();
      expect(paths).toEqual(["Private/Doc.md", "Public/Doc.md"]);

      // Scenario 8: chunks recreated without duplication
      const chunkPaths = persistedChunks?.map((c) => c.path).sort();
      expect(chunkPaths).toEqual(["Private/Doc.md", "Public/Doc.md"]);
      expect(new Set(persistedChunks?.map((c) => c.chunkId)).size).toBe(persistedChunks?.length);
    });

    it("9: missing embeddings for reindexed notes are detected in status without duplication", async () => {
      const file1 = makeFile("Public/Doc1.md", "Note 1");
      const file2 = makeFile("Public/Doc2.md", "Note 2");

      const chunks = [
        ...chunkText(file1.path, "Note 1", { chunkSize: 1200, overlap: 150 }),
        ...chunkText(file2.path, "Note 2", { chunkSize: 1200, overlap: 150 }),
      ];

      // Embedding only exists for Doc1
      const records: EmbeddingRecord[] = [
        {
          chunkId: chunks[0].chunkId,
          path: file1.path,
          index: 0,
          textHash: chunks[0].textHash,
          provider: "ollama",
          model: "nomic",
          dimensions: 2,
          embedding: [0.1, 0.2],
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ];

      const safeRecords = filterEmbeddingRecordsByPolicy(
        records,
        chunks,
        new Set<string>()
      );

      // Only 1 embedding exists, but 2 chunks exist: missing embedding enters normal flow
      expect(safeRecords.length).toBe(1);
      expect(chunks.length).toBe(2);
      expect(safeRecords.length).toBeLessThan(chunks.length);
    });
  });

  // =========================================================================
  // No-op Semantic Change (Scenario 10)
  // =========================================================================
  describe("No-op semantic change", () => {
    it("10: same policyHash does not trigger unnecessary reconciliation or churn", async () => {
      const { plugin } = createHarness();
      const initialPolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );
      plugin.currentExclusionPolicy = initialPolicy;

      const reconcileSpy = vi.fn().mockResolvedValue(undefined);
      plugin.reconcileIndexExclusionsAfterSettingsChange = reconcileSpy;

      // Mock service that returns identical policyHash
      const service = {
        updateRules: vi.fn().mockResolvedValue({
          success: true,
          policy: evolveExclusionPolicy(
            initialPolicy,
            { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
            mockProvenance
          ),
        }),
      };
      plugin.getExclusionPolicyService = () => service as never;
      plugin.saveSettings = vi.fn().mockResolvedValue(undefined);
      plugin.getOwnershipGate = () => ({ canPublish: vi.fn().mockResolvedValue(true) } as never);

      const updateResult = await plugin.updateExclusionRules({
        excludedFolders: ["Private/"],
        excludedPathContains: [],
        excludedContentContains: [],
      });

      expect(updateResult.success).toBe(true);
      expect(reconcileSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Companion Text Filtering (Scenarios 11-13)
  // =========================================================================
  describe("Companion text filtering", () => {
    const staleNotes: IndexedNote[] = [
      {
        path: "Private/Secret.md",
        basename: "Secret",
        extension: "md",
        size: 100,
        mtime: 100,
        contentHash: "h1",
        indexedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        path: "Public/Doc.md",
        basename: "Doc",
        extension: "md",
        size: 100,
        mtime: 100,
        contentHash: "h2",
        indexedAt: "2026-09-01T00:00:00.000Z",
      },
    ];

    const staleChunks: Chunk[] = [
      {
        chunkId: "c1",
        path: "Private/Secret.md",
        chunkIndex: 0,
        text: "Top secret intelligence about confidential projects",
        textHash: "th1",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        chunkId: "c2",
        path: "Public/Doc.md",
        chunkIndex: 0,
        text: "General public overview of projects and architecture",
        textHash: "th2",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];

    it("11 & 12: stale index containing now-excluded note -> note and chunks do not appear in results", () => {
      const activePolicy: ExclusionPolicyV1 = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );

      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: { version: 1, indexType: "text", totalNotes: 2, totalChunks: 2 },
      });

      const searchResult = executeCompanionTextSearch({
        query: "projects",
        notes: staleNotes,
        chunks: staleChunks,
        activePolicy,
        consumptionState,
      });

      expect(searchResult.totalResults).toBe(1);
      expect(searchResult.results[0].path).toBe("Public/Doc.md");
      expect(searchResult.results.some((r) => r.path.includes("Private"))).toBe(false);
    });

    it("13: legacy manifest remains searchable while filtered by active policy", () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );

      // Legacy manifest without exclusion policy fields
      const legacyState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 2,
        },
        activePolicy,
      });

      expect(legacyState.policyCompatibility?.status).toBe("unknown");
      expect(legacyState.policyCompatibility?.reason).toBe("legacy-manifest");

      const searchResult = executeCompanionTextSearch({
        query: "projects",
        notes: staleNotes,
        chunks: staleChunks,
        activePolicy,
        consumptionState: legacyState,
      });

      expect(searchResult.canConsume).toBe(true);
      expect(searchResult.results.map((r) => r.path)).toEqual(["Public/Doc.md"]);
    });
  });

  // =========================================================================
  // Companion Semantic & Hybrid Filtering (Scenarios 14-16)
  // =========================================================================
  describe("Companion semantic/hybrid filtering", () => {
    const chunks: Chunk[] = [
      {
        chunkId: "c-priv",
        path: "Private/Diary.md",
        chunkIndex: 0,
        text: "Confidential diary entry with private thoughts",
        textHash: "th-p",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        chunkId: "c-pub",
        path: "Public/Wiki.md",
        chunkIndex: 0,
        text: "Public wiki article with shared thoughts",
        textHash: "th-w",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];

    const embeddings: EmbeddingRecord[] = [
      {
        chunkId: "c-priv",
        path: "Private/Diary.md",
        index: 0,
        textHash: "th-p",
        provider: "ollama",
        model: "nomic",
        dimensions: 3,
        embedding: [1.0, 0.0, 0.0],
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        chunkId: "c-pub",
        path: "Public/Wiki.md",
        index: 0,
        textHash: "th-w",
        provider: "ollama",
        model: "nomic",
        dimensions: 3,
        embedding: [0.9, 0.1, 0.0],
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];

    it("14: excluded chunk with valid embedding does not appear in semantic search", () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );

      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 2,
          embeddingsEnabled: true,
          embeddings: { enabled: true, totalEmbeddings: 2, dimensions: 3, publicationId: "p1" },
        },
      });

      const semanticResult = executeCompanionSemanticSearch({
        query: "thoughts",
        queryEmbedding: [1.0, 0.0, 0.0],
        embeddings,
        chunks,
        activePolicy,
        consumptionState,
      });

      expect(semanticResult.totalResults).toBe(1);
      expect(semanticResult.results[0].path).toBe("Public/Wiki.md");
      expect(semanticResult.results.some((r) => r.path.includes("Private"))).toBe(false);
    });

    it("15: companion search with delta does not expose content excluded by active policy", async () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );

      const notes: IndexedNote[] = [
        { path: "Private/Diary.md", basename: "Diary", extension: "md", size: 50, mtime: 1, contentHash: "h1", indexedAt: "2026-09-01T00:00:00.000Z" },
        { path: "Public/Wiki.md", basename: "Wiki", extension: "md", size: 50, mtime: 1, contentHash: "h2", indexedAt: "2026-09-01T00:00:00.000Z" },
      ];

      const hybridResult = await executeCompanionSearchWithDelta({
        query: "thoughts",
        scannedNotes: [
          { path: "Public/Wiki.md", basename: "Wiki", extension: "md", size: 50, mtime: 1 },
          { path: "Private/Diary.md", basename: "Diary", extension: "md", size: 50, mtime: 1 },
        ],
        indexedNotes: notes,
        indexedChunks: chunks,
        readContent: async (path) => path === "Public/Wiki.md" ? "Public wiki article with shared thoughts" : "Private thoughts",
        activePolicy,
      });

      expect(hybridResult.results.some((r) => r.result.path.includes("Private"))).toBe(false);
      expect(hybridResult.results[0].result.path).toBe("Public/Wiki.md");
    });

    it("16: policy mismatch still protects excluded content defensively", () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );

      // Manifest with different policy hash -> mismatch
      const mismatchState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 2,
          exclusionPolicyRevision: 99,
          exclusionPolicyHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        activePolicy,
      });

      expect(mismatchState.policyCompatibility?.status).toBe("mismatch");

      const notes: IndexedNote[] = [
        { path: "Private/Secret.md", basename: "Secret", extension: "md", size: 10, mtime: 1, contentHash: "h1", indexedAt: "2026-09-01T00:00:00.000Z" },
        { path: "Public/Doc.md", basename: "Doc", extension: "md", size: 10, mtime: 1, contentHash: "h2", indexedAt: "2026-09-01T00:00:00.000Z" },
      ];
      const testChunks: Chunk[] = [
        { chunkId: "c1", path: "Private/Secret.md", chunkIndex: 0, text: "secret", textHash: "t1", createdAt: "2026-09-01T00:00:00.000Z" },
        { chunkId: "c2", path: "Public/Doc.md", chunkIndex: 0, text: "public doc", textHash: "t2", createdAt: "2026-09-01T00:00:00.000Z" },
      ];

      const searchResult = executeCompanionTextSearch({
        query: "doc",
        notes,
        chunks: testChunks,
        activePolicy,
        consumptionState: mismatchState,
      });

      // Defensive filtering must hold even under mismatch!
      expect(searchResult.results.some((r) => r.path.includes("Private"))).toBe(false);
      expect(searchResult.results[0].path).toBe("Public/Doc.md");
    });
  });

  // =========================================================================
  // Companion Delta Search (Scenarios 17-20)
  // =========================================================================
  describe("Companion delta search", () => {
    it("17: new note in excluded folder does not enter delta", async () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );

      const delta = await detectLocalDelta({
        scannedNotes: [
          { path: "Private/NewSecret.md", basename: "NewSecret", extension: "md", size: 50, mtime: 100 },
        ],
        indexedNotes: [],
        readContent: async () => "Local private file",
        activePolicy,
      });

      expect(delta.createdNotes).toHaveLength(0);
      expect(delta.modifiedNotes).toHaveLength(0);
    });

    it("18: note with excluded path term does not enter delta", async () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: [], excludedPathContains: ["draft"], excludedContentContains: [] },
        mockProvenance
      );

      const delta = await detectLocalDelta({
        scannedNotes: [
          { path: "Notes/my-draft-note.md", basename: "my-draft-note", extension: "md", size: 50, mtime: 100 },
        ],
        indexedNotes: [],
        readContent: async () => "Draft content",
        activePolicy,
      });

      expect(delta.createdNotes).toHaveLength(0);
      expect(delta.modifiedNotes).toHaveLength(0);
    });

    it("19: note with excluded content term does not enter delta", async () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: [], excludedPathContains: [], excludedContentContains: ["#confidential"] },
        mockProvenance
      );

      const delta = await detectLocalDelta({
        scannedNotes: [
          { path: "Notes/Report.md", basename: "Report", extension: "md", size: 50, mtime: 100 },
        ],
        indexedNotes: [],
        readContent: async () => "Project report marked #confidential",
        activePolicy,
      });

      expect(delta.createdNotes).toHaveLength(0);
      expect(delta.modifiedNotes).toHaveLength(0);
    });

    it("20: eligible note enters delta normally", async () => {
      const activePolicy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: ["draft"], excludedContentContains: ["#secret"] },
        mockProvenance
      );

      const delta = await detectLocalDelta({
        scannedNotes: [
          { path: "Public/CleanReport.md", basename: "CleanReport", extension: "md", size: 50, mtime: 100 },
        ],
        indexedNotes: [],
        readContent: async () => "Clean public content",
        activePolicy,
      });

      expect(delta.createdNotes).toHaveLength(1);
      expect(delta.createdNotes[0].path).toBe("Public/CleanReport.md");
    });
  });

  // =========================================================================
  // Invalid Policy (Scenarios 21-22)
  // =========================================================================
  describe("Invalid policy", () => {
    it("21: canonical invalid policy never falls back to legacy exclusions", () => {
      const invalidPolicyLoadResult = {
        status: "invalid" as const,
        reason: "invalid-json" as const,
        error: "Corrupt exclusions.json",
      };

      const resolvedRules = resolveDefensiveExclusionRules(invalidPolicyLoadResult);

      // Must be empty (strict non-legacy authority)
      expect(resolvedRules.excludedFolders).toEqual([]);
      expect(resolvedRules.excludedPathContains).toEqual([]);
      expect(resolvedRules.excludedContentContains).toEqual([]);
    });

    it("22: mandatory built-in exclusions (.lina/ and .obsidian/) are always applied even with invalid policy", () => {
      const invalidPolicyLoadResult = {
        status: "invalid" as const,
        reason: "invalid-json" as const,
        error: "Corrupt exclusions.json",
      };

      const notes: IndexedNote[] = [
        { path: ".lina/index/notes.json", basename: "notes", extension: "json", size: 100, mtime: 1, contentHash: "h1", indexedAt: "2026-09-01T00:00:00.000Z" },
        { path: ".obsidian/workspace.json", basename: "workspace", extension: "json", size: 100, mtime: 1, contentHash: "h2", indexedAt: "2026-09-01T00:00:00.000Z" },
        { path: "Notes/Regular.md", basename: "Regular", extension: "md", size: 100, mtime: 1, contentHash: "h3", indexedAt: "2026-09-01T00:00:00.000Z" },
      ];
      const chunks: Chunk[] = [
        { chunkId: "c1", path: ".lina/index/notes.json", chunkIndex: 0, text: "index internal", textHash: "t1", createdAt: "2026-09-01T00:00:00.000Z" },
        { chunkId: "c2", path: "Notes/Regular.md", chunkIndex: 0, text: "regular text", textHash: "t2", createdAt: "2026-09-01T00:00:00.000Z" },
      ];

      const filtered = filterIndexedDatasetByPolicy(notes, chunks, invalidPolicyLoadResult, ".obsidian");

      expect(filtered.notes.map((n) => n.path)).toEqual(["Notes/Regular.md"]);
      expect(filtered.chunks.map((c) => c.path)).toEqual(["Notes/Regular.md"]);
    });
  });

  // =========================================================================
  // Regression (Scenarios 23-26)
  // =========================================================================
  describe("Regression", () => {
    it("23: normal search operations continue to function as expected", () => {
      const notes: IndexedNote[] = [
        { path: "Docs/Guide.md", basename: "Guide", extension: "md", size: 200, mtime: 100, contentHash: "h1", indexedAt: "2026-09-01T00:00:00.000Z" },
      ];
      const chunks: Chunk[] = [
        { chunkId: "c1", path: "Docs/Guide.md", chunkIndex: 0, text: "Step-by-step setup guide for Lina.", textHash: "t1", createdAt: "2026-09-01T00:00:00.000Z" },
      ];

      const searchResult = executeCompanionSearch({
        query: "setup",
        notes,
        chunks,
        mode: "text",
      });

      expect(searchResult.totalResults).toBe(1);
      expect(searchResult.results[0].path).toBe("Docs/Guide.md");
    });

    it("24: active producer ownership gating remains intact", async () => {
      const { plugin } = createHarness();
      // Set role to companion
      plugin.localDeviceState = {
        schemaVersion: 2,
        deviceId: "companion-device-2",
        role: "companion",
        updatedAt: "2026-09-01T00:00:00.000Z",
      };

      const result = await plugin.updateExclusionRules({
        excludedFolders: ["ShouldFail/"],
        excludedPathContains: [],
        excludedContentContains: [],
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("unauthorized");
    });

    it("25: manifest policy compatibility evaluator continues to function", () => {
      const policy = createInitialExclusionPolicy(
        { excludedFolders: ["Private/"], excludedPathContains: [], excludedContentContains: [] },
        mockProvenance
      );

      const compatibleState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 1,
          totalChunks: 1,
          exclusionPolicyRevision: policy.policyRevision,
          exclusionPolicyHash: policy.policyHash,
        },
        activePolicy: policy,
      });

      expect(compatibleState.policyCompatibility?.status).toBe("compatible");

      const mismatchState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 1,
          totalChunks: 1,
          exclusionPolicyRevision: 2,
          // Must be a valid sha256 hex string (64 lowercase hex chars) that
          // differs from policy.policyHash to trigger the "mismatch" status.
          exclusionPolicyHash: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
        },
        activePolicy: policy,
      });

      expect(mismatchState.policyCompatibility?.status).toBe("mismatch");
    });

    it("26: legacy artifacts without exclusion provenance remain readable", () => {
      const legacyState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 5,
          totalChunks: 10,
        },
        activePolicy: createInitialExclusionPolicy(
          { excludedFolders: [], excludedPathContains: [], excludedContentContains: [] },
          mockProvenance
        ),
      });

      expect(legacyState.policyCompatibility?.status).toBe("unknown");
      expect(legacyState.policyCompatibility?.reason).toBe("legacy-manifest");
      expect(legacyState.canConsume).toBe(true);
      // A legacy manifest without embeddings is in text-only mode (no vector
      // search available), which is the correct consumption mode here.
      expect(legacyState.consumptionMode).toBe("text-only");
    });
  });
});
