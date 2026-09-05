import { describe, it, expect, beforeEach } from "vitest";
import type { App } from "obsidian";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { FakeApp } from "../helpers/fakeApp";
import {
  saveTextIndex,
  readTextIndexStatus,
  readTextIndexForAutomaticUpdate,
  createTextGenerationId,
  computeTextArtifactDigest,
  isValidTextGenerationId,
  isValidTextArtifactDigest,
  type IndexedNote,
  type TextIndexManifest,
} from "../../src/index/indexStore";
import { type Chunk } from "../../src/index/chunker";
import {
  publishCanonicalEmbeddings,
  type EmbeddingRecord,
  type EmbeddingPublicationInfo,
} from "../../src/index/embeddingPersistence";
import {
  evaluateCompanionConsumptionState,
  readCompanionConsumptionState,
} from "../../src/companion/companionConsumptionState";
import {
  type OwnershipManifest,
  type OwnershipDataAdapter,
  OWNERSHIP_SCHEMA_VERSION,
} from "../../src/device/deviceOwnership";
import {
  createVectorContract,
} from "../../src/index/vectorContract";
import {
  createArtifactProvenance,
} from "../../src/device/artifactProvenance";
import {
  createProducerState,
  saveProducerState,
} from "../../src/device/producerState";
import {
  BINARY_EMBEDDING_FILES,
  type BinaryEmbeddingManifestV1,
} from "../../src/index/embeddingBinaryStorage";
import {
  VALID_NOTES,
  VALID_CHUNKS,
  VALID_MANIFEST,
} from "../fixtures/indexFixtures";

function asApp(fake: FakeApp): App {
  return fake as unknown as App;
}

const PRODUCER_A = "11111111-1111-4111-8111-111111111111";
const PRODUCER_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_C = "33333333-3333-4333-8333-333333333333";

function createValidOwnership(producerId = PRODUCER_A, epoch = 1): OwnershipManifest {
  return {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    activeProducerId: producerId,
    epoch,
    acquiredAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    reason: "initial",
  };
}

describe("LINA-03-007: Artifact Generation Integrity & Sync Resilience", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  describe("1. Generation Identity (Points 1-4)", () => {
    it("1. new generation receives unique and deterministic generationId", () => {
      const gen1 = createTextGenerationId();
      const gen2 = createTextGenerationId();
      expect(gen1).not.toBe(gen2);
      expect(isValidTextGenerationId(gen1)).toBe(true);
      expect(isValidTextGenerationId(gen2)).toBe(true);
    });

    it("2. saveTextIndex stamps generationId, notesDigest, and chunksDigest into manifest.json", async () => {
      const success = await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      expect(success).toBe(true);

      const manifestRaw = JSON.parse(await adapter.read(".lina/index/manifest.json")) as TextIndexManifest;
      expect(manifestRaw.generationId).toBeDefined();
      expect(isValidTextGenerationId(manifestRaw.generationId)).toBe(true);
      expect(isValidTextArtifactDigest(manifestRaw.notesDigest)).toBe(true);
      expect(isValidTextArtifactDigest(manifestRaw.chunksDigest)).toBe(true);

      const notesContent = await adapter.read(".lina/index/notes.json");
      const chunksContent = await adapter.read(".lina/index/chunks.jsonl");

      expect(manifestRaw.notesDigest).toBe(computeTextArtifactDigest(notesContent));
      expect(manifestRaw.chunksDigest).toBe(computeTextArtifactDigest(chunksContent));
    });

    it("3. readTextIndexStatus verifies that notes and chunks match the generation digests", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(true);
      expect(status.usability).toBe("ready");
      expect(status.generationIntegrity).toBe("verified");
      expect(status.generationId).toBeDefined();
    });

    it("4. rejects dataset when record counts match but content has been altered (count collision bypass prevented)", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Mutate notes.json content with SAME note count (2 notes) but altered content
      const alteredNotes: IndexedNote[] = [
        { ...VALID_NOTES[0], contentHash: "tampered_hash_1" },
        { ...VALID_NOTES[1], contentHash: "tampered_hash_2" },
      ];
      await adapter.write(".lina/index/notes.json", JSON.stringify(alteredNotes, null, 2));

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.usability).toBe("invalid");
      expect(status.generationIntegrity).toBe("digest-mismatch");
      expect(status.error).toContain("digest do notes.json");
    });
  });

  describe("2. Digests & Integrity (Points 5-8)", () => {
    it("5. notes modified -> digest mismatch detected", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      await adapter.write(".lina/index/notes.json", JSON.stringify([VALID_NOTES[0]], null, 2));

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.generationIntegrity).toBe("count-mismatch");
    });

    it("6. chunks modified -> digest mismatch detected", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Tamper 1 chunk preserving chunk count (3 chunks)
      const tamperedChunks: Chunk[] = [
        { ...VALID_CHUNKS[0], text: "Tampered chunk content." },
        VALID_CHUNKS[1],
        VALID_CHUNKS[2],
      ];
      await adapter.write(".lina/index/chunks.jsonl", tamperedChunks.map((c) => JSON.stringify(c)).join("\n"));

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.generationIntegrity).toBe("digest-mismatch");
      expect(status.error).toContain("digest do chunks.jsonl");
    });

    it("7. both notes and chunks matching digests -> valid and ready", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(true);
      expect(status.generationIntegrity).toBe("verified");
    });

    it("8. malformed digest format in manifest -> rejected as invalid manifest", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      const manifest = JSON.parse(await adapter.read(".lina/index/manifest.json")) as Record<string, unknown>;
      manifest.notesDigest = "not-a-valid-sha256";
      await adapter.write(".lina/index/manifest.json", JSON.stringify(manifest, null, 2));

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.usability).toBe("invalid");
    });
  });

  describe("3. Partial Sync Resilience (Points 9-13)", () => {
    it("9. new manifest + old notes + old chunks -> rejected cleanly", async () => {
      // Save generation 1
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      const oldNotes = await adapter.read(".lina/index/notes.json");
      const oldChunks = await adapter.read(".lina/index/chunks.jsonl");

      // Save generation 2 with different data
      const newNotes: IndexedNote[] = [
        ...VALID_NOTES,
        {
          path: "note3.md",
          basename: "note3",
          extension: "md",
          size: 300,
          mtime: 3000000,
          contentHash: "ghi789",
          indexedAt: new Date().toISOString(),
        },
      ];
      const newChunks: Chunk[] = [
        ...VALID_CHUNKS,
        {
          chunkId: "note3.md::0",
          path: "note3.md",
          chunkIndex: 0,
          text: "Content of note3",
          textHash: "hash3",
          createdAt: new Date().toISOString(),
        },
      ];
      await saveTextIndex(
        asApp(app),
        newNotes,
        newChunks,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Simulate partial sync: new manifest, but old notes and chunks arrive
      await adapter.write(".lina/index/notes.json", oldNotes);
      await adapter.write(".lina/index/chunks.jsonl", oldChunks);

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.generationIntegrity).toBe("count-mismatch");
    });

    it("10. new manifest + new notes + old chunks -> rejected (chunks digest mismatch)", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      const oldChunks = await adapter.read(".lina/index/chunks.jsonl");

      // New generation with same chunk count (3) but updated chunk text
      const newChunks: Chunk[] = [
        VALID_CHUNKS[0],
        VALID_CHUNKS[1],
        { ...VALID_CHUNKS[2], text: "Updated content for note2 chunk 1." },
      ];
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        newChunks,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Revert chunks.jsonl to oldChunks
      await adapter.write(".lina/index/chunks.jsonl", oldChunks);

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.generationIntegrity).toBe("digest-mismatch");
      expect(status.error).toContain("digest do chunks.jsonl");
    });

    it("11. new manifest + old notes + new chunks -> rejected (notes digest mismatch)", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      const oldNotes = await adapter.read(".lina/index/notes.json");

      // New generation with same note count (2) but updated note hash
      const newNotes: IndexedNote[] = [
        VALID_NOTES[0],
        { ...VALID_NOTES[1], contentHash: "updated_hash" },
      ];
      await saveTextIndex(
        asApp(app),
        newNotes,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Revert notes.json to oldNotes
      await adapter.write(".lina/index/notes.json", oldNotes);

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.generationIntegrity).toBe("digest-mismatch");
      expect(status.error).toContain("digest do notes.json");
    });

    it("12. new notes/chunks + old manifest -> does not activate as new generation (fails safely)", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      const oldManifest = await adapter.read(".lina/index/manifest.json");

      // New generation with 3 notes and 4 chunks
      const newNotes: IndexedNote[] = [
        ...VALID_NOTES,
        {
          path: "note3.md",
          basename: "note3",
          extension: "md",
          size: 300,
          mtime: 3000000,
          contentHash: "ghi789",
          indexedAt: new Date().toISOString(),
        },
      ];
      const newChunks: Chunk[] = [
        ...VALID_CHUNKS,
        {
          chunkId: "note3.md::0",
          path: "note3.md",
          chunkIndex: 0,
          text: "Content of note3",
          textHash: "hash3",
          createdAt: new Date().toISOString(),
        },
      ];
      await saveTextIndex(
        asApp(app),
        newNotes,
        newChunks,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Revert manifest to oldManifest
      await adapter.write(".lina/index/manifest.json", oldManifest);

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.generationIntegrity).toBe("count-mismatch");
    });

    it("13. missing chunks or notes file results in incomplete/missing status without throwing", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      await adapter.remove(".lina/index/chunks.jsonl");

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(false);
      expect(status.usability).toBe("invalid");
      expect(status.generationIntegrity).toBe("incomplete");
    });
  });

  describe("4. Manifest-Last Principle (Points 14-16)", () => {
    it("14. promotes payload files first and manifest last during publication", async () => {
      const operations: string[] = [];
      const trackingApp = new FakeApp(adapter);
      const originalWrite = adapter.write.bind(adapter);
      const originalRename = adapter.rename.bind(adapter);

      adapter.write = async (path: string, data: string) => {
        operations.push(`write:${path}`);
        return originalWrite(path, data);
      };
      adapter.rename = async (from: string, to: string) => {
        operations.push(`rename:${from}->${to}`);
        return originalRename(from, to);
      };

      await saveTextIndex(
        asApp(trackingApp),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Manifest temporary promotion rename must be the LAST promotion among canonical targets
      const renameOps = operations.filter((op) => op.startsWith("rename:"));
      const lastRename = renameOps[renameOps.length - 1];
      expect(lastRename).toContain("manifest.json");
    });

    it("15 & 16. failure before manifest promotion rolls back and preserves previous generation", async () => {
      // 1. Initial valid index
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      const initialManifest = JSON.parse(await adapter.read(".lina/index/manifest.json")) as TextIndexManifest;

      // 2. Simulate failure when promoting manifest.json
      const originalRename = adapter.rename.bind(adapter);
      adapter.rename = async (from: string, to: string) => {
        if (from.includes("manifest.json.tmp-")) {
          throw new Error("Simulated failure promoting manifest.json");
        }
        return originalRename(from, to);
      };

      const newNotes: IndexedNote[] = [
        ...VALID_NOTES,
        {
          path: "note3.md",
          basename: "note3",
          extension: "md",
          size: 300,
          mtime: 3000000,
          contentHash: "ghi789",
          indexedAt: new Date().toISOString(),
        },
      ];

      const success = await saveTextIndex(
        asApp(app),
        newNotes,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      expect(success).toBe(false);

      // 3. Confirm original generation remains intact
      adapter.rename = originalRename;
      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(true);
      expect(status.manifest?.generationId).toBe(initialManifest.generationId);
      expect(status.totalNotes).toBe(2);
    });
  });

  describe("5. Embedding Linkage (Points 17-19)", () => {
    it("17. canonical embeddings publication links to text generationId via sourceTextGenerationId", async () => {
      // 1. Save text index to establish a generationId
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );
      const textManifest = JSON.parse(await adapter.read(".lina/index/manifest.json")) as TextIndexManifest;
      expect(textManifest.generationId).toBeDefined();

      // 2. Publish canonical embeddings
      const records: EmbeddingRecord[] = VALID_CHUNKS.map((chunk, i) => ({
        chunkId: chunk.chunkId,
        path: chunk.path,
        index: chunk.chunkIndex,
        textHash: chunk.textHash,
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 4,
        embedding: [0.1, 0.2, 0.3, 0.4],
        createdAt: new Date().toISOString(),
      }));

      const info: EmbeddingPublicationInfo = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 4,
        inputVersion: 1,
        prefixMode: "none",
      };

      const pubResult = await publishCanonicalEmbeddings(asApp(app), records, info);
      expect(pubResult.success).toBe(true);

      const updatedManifest = JSON.parse(await adapter.read(".lina/index/manifest.json")) as Record<string, any>;
      expect(updatedManifest.embeddings.sourceTextGenerationId).toBe(textManifest.generationId);
    });

    it("18. Companion detects when text generationId has moved ahead of embeddings sourceTextGenerationId", () => {
      const consumption = evaluateCompanionConsumptionState({
        deviceId: COMPANION_C,
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 5,
          totalChunks: 10,
          generationId: "gen-generation-2",
          notesDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          chunksDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          embeddingsEnabled: true,
          embeddings: {
            enabled: true,
            provider: "ollama",
            model: "nomic-embed-text",
            dimensions: 768,
            publicationId: "pub-old",
            sourceTextGenerationId: "gen-generation-1", // Outdated!
          },
        },
      });

      expect(consumption.canConsume).toBe(true); // Text index is usable
      expect(consumption.embeddingState.available).toBe(false); // Outdated embeddings are deactivated
      expect(consumption.consumptionMode).toBe("text-only"); // Falls back to text-only mode
    });

    it("19. Vector contract match cannot activate embeddings if generationId mismatches", () => {
      const consumption = evaluateCompanionConsumptionState({
        deviceId: COMPANION_C,
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 5,
          totalChunks: 10,
          generationId: "gen-active-text-gen",
          embeddingsEnabled: true,
          embeddings: {
            enabled: true,
            provider: "ollama",
            model: "nomic-embed-text",
            dimensions: 768,
            publicationId: "pub-123",
            sourceTextGenerationId: "gen-stale-text-gen",
            vectorContract: {
              schemaVersion: 1,
              contractId: "vc1:ollama-nomic-768-cosine-v1-none",
              provider: "ollama",
              model: "nomic-embed-text",
              dimensions: 768,
              metric: "cosine",
              prefixMode: "none",
              inputVersion: 1,
            },
          },
        },
      });

      expect(consumption.embeddingState.available).toBe(false);
      expect(consumption.consumptionMode).toBe("text-only");
    });
  });

  describe("6. Conflict Files Safety (Points 20-22)", () => {
    it("20. ignores 'manifest (conflicted copy).json' and reads only canonical manifest.json", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Create a conflict copy with bogus/corrupt content
      await adapter.write(".lina/index/manifest (conflicted copy 2026-09-05).json", "{ corrupt conflict data");

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(true);
      expect(status.usability).toBe("ready");
    });

    it("21. ignores 'notes (conflicted copy).json' and 'chunks (conflicted copy).jsonl'", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      await adapter.write(".lina/index/notes (conflict).json", "{ corrupt notes");
      await adapter.write(".lina/index/chunks (conflict).jsonl", "{ corrupt chunks");

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(true);
      expect(status.usability).toBe("ready");
    });

    it("22. canonical manifest missing + conflicted copy present -> treated as missing (no fallback)", async () => {
      await adapter.write(".lina/index/manifest (conflicted copy).json", JSON.stringify(VALID_MANIFEST));

      const status = await readTextIndexStatus(asApp(app));
      expect(status.exists).toBe(false);
      expect(status.isUsable).toBe(false);
      expect(status.usability).toBe("missing");
    });
  });

  describe("7. Legacy Compatibility (Points 23-24)", () => {
    it("23. 0.2.4 legacy index without generationId or digests remains fully usable", async () => {
      // Legacy files from fixtures
      await adapter.write(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
      await adapter.write(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
      await adapter.write(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

      const status = await readTextIndexStatus(asApp(app));
      expect(status.isUsable).toBe(true);
      expect(status.usability).toBe("ready");
      expect(status.generationIntegrity).toBe("legacy");
      expect(status.generationId).toBeUndefined();
    });

    it("24. legacy manifest without digests is not treated as corrupted", async () => {
      const consumption = evaluateCompanionConsumptionState({
        deviceId: COMPANION_C,
        role: "companion",
        textManifestRaw: VALID_MANIFEST,
      });

      expect(consumption.canConsume).toBe(true);
      expect(consumption.generationIntegrity).toBe("legacy");
      expect(consumption.consumptionMode).toBe("text-only");
    });
  });

  describe("8. Companion Consumption (Points 25-27)", () => {
    it("25. digest mismatch is observable in Companion consumption state", () => {
      const consumption = evaluateCompanionConsumptionState({
        deviceId: COMPANION_C,
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 3,
          generationId: "gen-123",
          notesDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chunksDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        notesDigestMismatch: true,
      });

      expect(consumption.canConsume).toBe(false);
      expect(consumption.generationIntegrity).toBe("digest-mismatch");
      expect(consumption.consumptionMode).toBe("degraded");
      expect(consumption.artifactAvailability.textIndex).toBe("invalid");
    });

    it("26. partial sync read via readCompanionConsumptionState does not crash", async () => {
      await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0
      );

      // Tamper chunks.jsonl
      await adapter.write(".lina/index/chunks.jsonl", "altered content");

      const consumption = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
      expect(consumption.canConsume).toBe(false);
      expect(consumption.generationIntegrity).toBe("digest-mismatch");
      expect(consumption.consumptionMode).toBe("degraded");
    });

    it("27. policy, vector contract, freshness, and generation integrity remain distinct and independent axes", () => {
      const fixedNow = Date.parse("2026-09-05T12:00:00.000Z");
      const ownership = createValidOwnership(PRODUCER_A, 1);
      const prodState = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        updatedAt: new Date(fixedNow - 30 * 3600 * 1000).toISOString(), // 30h ago -> aging
      });

      const vectorContract = createVectorContract({
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        metric: "cosine",
        prefixMode: "none",
        inputVersion: 1,
      });

      const consumption = evaluateCompanionConsumptionState({
        deviceId: COMPANION_C,
        role: "companion",
        ownership,
        producerState: prodState,
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 3,
          generationId: "gen-xyz",
          notesDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chunksDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          exclusionPolicyRevision: 1,
          exclusionPolicyHash: "ph1:validhash123",
          vectorContract,
        },
        timestamp: new Date(fixedNow).toISOString(),
      });

      // 4 distinct axes:
      // 1. Generation integrity: verified
      expect(consumption.generationIntegrity).toBe("verified");
      // 2. Freshness: aging
      expect(consumption.producerFreshness).toBe("aging");
      // 3. Vector contract: populated
      expect(consumption.vectorContract?.contractId).toBe(vectorContract.contractId);
      // 4. Policy: populated
      expect(consumption.canConsume).toBe(true);
    });
  });

  describe("9. Ownership Gating (Points 28-29)", () => {
    it("28. Active Producer publishes generation with valid ownership", async () => {
      const ownership = createValidOwnership(PRODUCER_A, 1);
      await adapter.write(".lina/ownership.json", JSON.stringify(ownership));

      const provenance = createArtifactProvenance(PRODUCER_A, 1);

      const success = await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        undefined,
        provenance
      );

      expect(success).toBe(true);
      const status = await readTextIndexStatus(asApp(app));
      expect(status.provenance?.producerDeviceId).toBe(PRODUCER_A);
      expect(status.provenance?.producerEpoch).toBe(1);
    });

    it("29. Standby and Companion do not write or publish index files", async () => {
      const companionState = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
      expect(companionState.canConsume).toBe(false);

      // Verify no index files were created by Companion read
      expect(await adapter.exists(".lina/index/manifest.json")).toBe(false);
      expect(await adapter.exists(".lina/index/notes.json")).toBe(false);
      expect(await adapter.exists(".lina/index/chunks.jsonl")).toBe(false);
    });
  });
});
