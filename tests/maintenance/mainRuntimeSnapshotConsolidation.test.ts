import { describe, expect, it, vi } from "vitest";
import { completeSummary } from "../helpers/completeWorkSummary";
import { activeProducerRuntime } from "../helpers/producerRuntimeState";
import * as fs from "fs";
import * as path from "path";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { buildEmbeddingWorkLifecycleSnapshot, EmbeddingWorkSummary } from "../../src/index/embeddingWorkStatusController";
import { deriveEmbeddingWritePathDecision } from "../../src/index/embeddingLifecycleWritePath";
import { hashContent } from "../../src/index/noteHasher";
import { buildEmbeddingInput, getPrefixModeForModel } from "../../src/index/embeddingGenerator";

type TestableLinaPlugin = LinaPlugin & Record<string, unknown>;

function createPluginHarness(overrides: {
  role?: "producer" | "companion" | "standby" | "unassigned";
  provider?: string;
  model?: string;
  updateMode?: string;
  chunksCount?: number;
  embeddingsCount?: number;
  authorized?: boolean;
} = {}): {
  plugin: TestableLinaPlugin;
  adapter: FakeAdapter;
} {
  const role = overrides.role ?? "producer";
  const provider = overrides.provider ?? "ollama";
  const model = overrides.model ?? "nomic-embed-text";
  const updateMode = overrides.updateMode ?? "automatic-local-only";
  const chunksCount = overrides.chunksCount ?? 10;
  const embeddingsCount = overrides.embeddingsCount ?? 10;
  const authorized = overrides.authorized ?? true;

  const effectiveRole = role === "standby" ? "producer" : role;
  const isStandby = role === "standby" || (role === "producer" && !authorized);
  const isActiveProducer = role === "producer" && authorized;
  const prefixMode = getPrefixModeForModel(model);

  const chunksLines: string[] = [];
  for (let i = 0; i < chunksCount; i++) {
    const text = `Chunk text line ${i}`;
    const chunk = {
      chunkId: `Note.md::${i}`,
      path: "Note.md",
      chunkIndex: i,
      text,
    };
    const input = buildEmbeddingInput(chunk, prefixMode);
    const textHash = hashContent(input);
    chunksLines.push(JSON.stringify({
      ...chunk,
      textHash,
      createdAt: "2026-08-01T00:00:00.000Z",
    }));
  }

  const embeddingsLines: string[] = [];
  if (embeddingsCount > 0) {
    const dummyVector = new Array(768).fill(0.01);
    for (let i = 0; i < embeddingsCount; i++) {
      const text = `Chunk text line ${i}`;
      const chunk = {
        chunkId: `Note.md::${i}`,
        path: "Note.md",
        chunkIndex: i,
        text,
      };
      const input = buildEmbeddingInput(chunk, prefixMode);
      const textHash = hashContent(input);
      embeddingsLines.push(JSON.stringify({
        chunkId: `Note.md::${i}`,
        path: "Note.md",
        index: i,
        textHash,
        embeddingInputHash: textHash,
        provider,
        model,
        dimensions: 768,
        embedding: dummyVector,
        createdAt: "2026-08-01T00:00:00.000Z",
      }));
    }
  }

  const files: Record<string, string> = {
    ".lina/index/chunks.jsonl": chunksLines.join("\n"),
  };
  if (embeddingsLines.length > 0) {
    files[".lina/index/embeddings.jsonl"] = embeddingsLines.join("\n");
    files[".lina/index/manifest.json"] = JSON.stringify({
      schemaVersion: 1,
      embeddingsEnabled: true,
      embeddings: {
        provider,
        model,
        dimensions: 768,
        totalEmbeddings: embeddingsCount,
      },
      embeddingInput: {
        version: 1,
        prefixMode,
      },
    });
  }

  const adapter = new FakeAdapter(files);
  const plugin = Object.create(LinaPlugin.prototype) as TestableLinaPlugin;
  plugin.app = {
    vault: {
      adapter,
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      read: vi.fn(),
      on: vi.fn(),
      offref: vi.fn(),
    },
  };
  plugin.manifest = { id: "lina" };
  plugin.settings = {
    interfaceLanguage: "pt-PT",
    embeddingProvider: provider,
    embeddingBaseUrl: "http://localhost:11434",
    embeddingModel: model,
    embeddingRequestTimeoutSeconds: 60,
    generateOnlyMissingEmbeddings: true,
    embeddingUpdateMode: updateMode,
    embeddingBatchSize: 10,
  };
  plugin.indexedNotes = [];
  plugin.indexedChunks = [];
  plugin.textIndexLoaded = true;
  const localDeviceState = {
    schemaVersion: 2,
    deviceId: "test-device-id",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    role: effectiveRole,
  };
  plugin.localDeviceState = localDeviceState;
  plugin.deviceRuntimeState = {
    deviceId: "test-device-id",
    effectiveRole,
    isActiveProducer,
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isStandbyProducer: isStandby,
    isCompanion: effectiveRole === "companion",
    isUnassigned: effectiveRole === "unassigned",
    canPublish: isActiveProducer,
    canTransferOwnership: false,
    transferEligibilityReason: "already-active-producer",
    embeddings: {
      configured: true,
      textIndexAvailable: true,
      embeddingsDeclared: true,
      exists: embeddingsCount > 0,
      vectorFileState: "available",
      provenance: { stale: false },
      compatibility: { compatible: true },
      contractState: "compatible",
      readiness: { loaded: true, runtimeReady: true },
      runtimeState: "ready",
      semanticAvailable: true,
      effectiveMode: "full",
    },
  };
  const ownershipGateMock = {
    isAuthorizedSync: () => authorized && !isStandby,
    getLastDecision: () => ({
      authorized: authorized && !isStandby,
      epoch: 1,
      reason: "initial",
      activeProducerId: authorized && !isStandby ? "test-device-id" : "other-device-id",
    }),
  };
  plugin.ownershipGate = ownershipGateMock;
  plugin.getOwnershipGate = () => ownershipGateMock;
  plugin.getEffectiveDeviceRole = () => effectiveRole;
  plugin.getDeviceRoleResolution = () => ({
    effectiveRole,
    assignedRole: effectiveRole,
    reason: "assigned-role",
  });
  plugin.maintenanceEngine = {
    getEmbeddingOperationState: () => ({ status: "idle" }),
    requestEmbeddingGeneration: vi.fn(() => ({
      status: "rejected",
      error: "producer-unavailable",
    })),
  };

  return { plugin, adapter };
}

describe("LINA-14F.4-B4.3: Main Runtime Snapshot Consolidation", () => {
  it("should not contain ad-hoc adaptCurrentStateToLifecycleSnapshot calls in confirmAndRequestEmbeddingGeneration or hasAutomaticEmbeddingWork", () => {
    const mainTsPath = path.resolve(__dirname, "../../main.ts");
    const content = fs.readFileSync(mainTsPath, "utf-8");

    // Extract confirmAndRequestEmbeddingGeneration body
    const confirmMatch = content.match(/async confirmAndRequestEmbeddingGeneration[\s\S]*?\n  \}/);
    expect(confirmMatch).not.toBeNull();
    const confirmBody = confirmMatch![0];
    expect(confirmBody).not.toContain("adaptCurrentStateToLifecycleSnapshot");
    expect(confirmBody).toContain("buildEmbeddingWorkLifecycleSnapshot");

    // Extract hasAutomaticEmbeddingWork body
    const autoWorkMatch = content.match(/private async hasAutomaticEmbeddingWork[\s\S]*?\n  \}/);
    expect(autoWorkMatch).not.toBeNull();
    const autoWorkBody = autoWorkMatch![0];
    expect(autoWorkBody).not.toContain("adaptCurrentStateToLifecycleSnapshot");
    expect(autoWorkBody).toContain("buildEmbeddingWorkLifecycleSnapshot");
  });

  describe("confirmAndRequestEmbeddingGeneration()", () => {
    it("returns no work when embeddings are READY and up-to-date", async () => {
      const { plugin } = createPluginHarness({
        role: "producer",
        chunksCount: 10,
        embeddingsCount: 10,
      });

      const result = await (plugin as any).confirmAndRequestEmbeddingGeneration({
        isFullRebuild: false,
        origin: "manual",
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(plugin.L.confirmEmbeddingUpdateNoWorkNotice);
    });

    it("evaluates UPDATE_AVAILABLE correctly and blocks non-producers (Standby / Companion)", async () => {
      const { plugin: standbyPlugin } = createPluginHarness({
        role: "standby",
        chunksCount: 10,
        embeddingsCount: 0,
      });

      const standbyResult = await (standbyPlugin as any).confirmAndRequestEmbeddingGeneration({
        isFullRebuild: false,
        origin: "manual",
      });
      expect(standbyResult.success).toBe(false);

      const { plugin: companionPlugin } = createPluginHarness({
        role: "companion",
        chunksCount: 10,
        embeddingsCount: 0,
      });

      const companionResult = await (companionPlugin as any).confirmAndRequestEmbeddingGeneration({
        isFullRebuild: false,
        origin: "manual",
      });
      expect(companionResult.success).toBe(false);
    });

    it("blocks request if producer loses ownership authority", async () => {
      const { plugin } = createPluginHarness({
        role: "producer",
        authorized: false,
        chunksCount: 10,
        embeddingsCount: 0,
      });

      // Role is producer, but ownership authority is lost
      const result = await (plugin as any).confirmAndRequestEmbeddingGeneration({
        isFullRebuild: false,
        origin: "automatic",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("hasAutomaticEmbeddingWork()", () => {
    it("returns true when local producer has missing chunks (UPDATE_AVAILABLE)", async () => {
      const { plugin } = createPluginHarness({
        role: "producer",
        provider: "ollama",
        updateMode: "automatic-local-only",
        chunksCount: 10,
        embeddingsCount: 5,
      });
    vi.spyOn(plugin as unknown as { getTextIndexStatus(): Promise<unknown> }, "getTextIndexStatus").mockResolvedValue({ exists: true, usability: "ready", isUsable: true });

      const hasWork = await (plugin as any).hasAutomaticEmbeddingWork();
      expect(hasWork).toBe(true);
    });

    it("returns false when fully up-to-date (READY)", async () => {
      const { plugin } = createPluginHarness({
        role: "producer",
        provider: "ollama",
        updateMode: "automatic-local-only",
        chunksCount: 10,
        embeddingsCount: 10,
      });

      const hasWork = await (plugin as any).hasAutomaticEmbeddingWork();
      expect(hasWork).toBe(false);
    });

    it("returns false for companion role", async () => {
      const { plugin } = createPluginHarness({
        role: "companion",
        provider: "ollama",
        updateMode: "automatic-local-only",
        chunksCount: 10,
        embeddingsCount: 0,
      });

      const hasWork = await (plugin as any).hasAutomaticEmbeddingWork();
      expect(hasWork).toBe(false);
    });

    it("returns false for standby role", async () => {
      const { plugin } = createPluginHarness({
        role: "standby",
        provider: "ollama",
        updateMode: "automatic-local-only",
        chunksCount: 10,
        embeddingsCount: 0,
      });

      const hasWork = await (plugin as any).hasAutomaticEmbeddingWork();
      expect(hasWork).toBe(false);
    });

    it("returns false for external provider under automatic-local-only policy", async () => {
      const { plugin } = createPluginHarness({
        role: "producer",
        provider: "openrouter",
        updateMode: "automatic-local-only",
        chunksCount: 10,
        embeddingsCount: 0,
      });

      const hasWork = await (plugin as any).hasAutomaticEmbeddingWork();
      expect(hasWork).toBe(false);
    });

    it("returns false when producer loses live ownership", async () => {
      const { plugin } = createPluginHarness({
        role: "producer",
        authorized: false,
        provider: "ollama",
        updateMode: "automatic-local-only",
        chunksCount: 10,
        embeddingsCount: 0,
      });

      const hasWork = await (plugin as any).hasAutomaticEmbeddingWork();
      expect(hasWork).toBe(false);
    });
  });

  describe("Lifecycle snapshot coverage for all states", () => {
    it("handles READY, UPDATE_AVAILABLE, INDEX_ONLY, INCOMPATIBLE and ERROR consistently", () => {
      // READY
      const readySummary: EmbeddingWorkSummary = {
        exists: true,
        canonicalReadability: "readable",
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        totalChunks: 10,
        validCount: 10,
        missingCount: 0,
        staleCount: 0,
        obsoleteCount: 0,
        updatePlan: {
          mode: "incremental",
          totalChunks: 10,
          missingCount: 0,
          staleToReplaceCount: 0,
          obsoleteToDropCount: 0,
          toGenerateCount: 0,
          reusableCanonicalCount: 10,
          recoverableCheckpointCount: 0,
          requiresPublication: false,
          reasons: [],
        },
      };
      const readySnapshot = buildEmbeddingWorkLifecycleSnapshot(completeSummary(readySummary), 1, activeProducerRuntime());
      expect(readySnapshot.primary).toBe("READY");
      const readyDecision = deriveEmbeddingWritePathDecision(readySnapshot);
      expect(readyDecision.updateRequired).toBe(false);
      expect(readyDecision.action).toBe("none");

      // UPDATE_AVAILABLE
      const updateSummary: EmbeddingWorkSummary = {
        ...readySummary,
        validCount: 5,
        missingCount: 5,
        updatePlan: {
          ...readySummary.updatePlan!,
          missingCount: 5,
          toGenerateCount: 5,
          requiresPublication: true,
        },
      };
      const updateSnapshot = buildEmbeddingWorkLifecycleSnapshot(completeSummary(updateSummary), 2, activeProducerRuntime());
      expect(updateSnapshot.primary).toBe("UPDATE_AVAILABLE");
      const updateDecision = deriveEmbeddingWritePathDecision(updateSnapshot);
      expect(updateDecision.updateRequired).toBe(true);
      expect(updateDecision.action).toBe("update");

      // INDEX_ONLY (initial build)
      const indexOnlySummary: EmbeddingWorkSummary = {
        exists: false,
        canonicalReadability: "missing",
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        totalChunks: 10,
        validCount: 0,
        missingCount: 10,
        staleCount: 0,
        obsoleteCount: 0,
        updatePlan: {
          mode: "initial-build",
          totalChunks: 10,
          missingCount: 10,
          staleToReplaceCount: 0,
          obsoleteToDropCount: 0,
          toGenerateCount: 10,
          reusableCanonicalCount: 0,
          recoverableCheckpointCount: 0,
          requiresPublication: true,
          reasons: [],
        },
      };
      const indexOnlySnapshot = buildEmbeddingWorkLifecycleSnapshot(completeSummary(indexOnlySummary), 3, activeProducerRuntime());
      expect(indexOnlySnapshot.primary).toBe("INDEX_ONLY");

      // INCOMPATIBLE (different model)
      const incompatibleSummary: EmbeddingWorkSummary = {
        exists: true,
        canonicalReadability: "readable",
        provider: "ollama",
        model: "old-model",
        dimensions: 384,
        totalChunks: 10,
        validCount: 0,
        missingCount: 10,
        staleCount: 0,
        obsoleteCount: 0,
        updatePlan: {
          mode: "full-rebuild",
          totalChunks: 10,
          missingCount: 10,
          staleToReplaceCount: 0,
          obsoleteToDropCount: 0,
          toGenerateCount: 10,
          reusableCanonicalCount: 0,
          recoverableCheckpointCount: 0,
          requiresPublication: true,
          reasons: ["target-identity-changed"],
          targetIdentity: {
            provider: "ollama",
            model: "new-model",
            dimensions: 768,
            inputVersion: 1,
            prefixMode: "none",
          },
        },
      };
      const incompatibleSnapshot = buildEmbeddingWorkLifecycleSnapshot(completeSummary(incompatibleSummary), 4, activeProducerRuntime());
      expect(incompatibleSnapshot.primary).toBe("INCOMPATIBLE");

      // ERROR / UNREADABLE
      const errorSummary: EmbeddingWorkSummary = {
        exists: true,
        canonicalReadability: "unreadable",
        provider: "ollama",
        model: "nomic-embed-text",
        updatePlan: {
          mode: "indeterminate",
          totalChunks: 0,
          missingCount: 0,
          staleToReplaceCount: 0,
          obsoleteToDropCount: 0,
          toGenerateCount: 0,
          reusableCanonicalCount: 0,
          recoverableCheckpointCount: 0,
          requiresPublication: false,
          reasons: ["canonical-unreadable"],
        },
      };
      const errorSnapshot = buildEmbeddingWorkLifecycleSnapshot(completeSummary(errorSummary), 5, activeProducerRuntime());
      expect(errorSnapshot.primary).toBe("INDETERMINATE");
    });
  });
});
