import { describe, expect, it } from "vitest";
import {
  adaptCurrentStateToLifecycleSnapshot,
  toEmbeddingIdentitySummary,
  CurrentEmbeddingStateInputs,
} from "../../src/index/embeddingLifecycleAdapter";
import { VectorContractV1 } from "../../src/index/vectorContract";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { EmbeddingUpdatePlan } from "../../src/index/embeddingUpdatePlan";

describe("LINA-14B: Embedding Lifecycle Shadow Adapter", () => {
  const baseContract: VectorContractV1 = {
    schemaVersion: 1,
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    metric: "cosine",
    prefixMode: "nomic-search-query-document",
    inputVersion: 1,
    contractId: "vec:ollama:nomic-embed-text:768:1:nomic-search-query-document",
  };

  const makeBaseDeviceRuntime = (overrides: Partial<DeviceRuntimeState> = {}): DeviceRuntimeState => ({
    deviceId: "device-1",
    deviceName: "Primary Mac",
    effectiveRole: "producer",
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isActiveProducer: true,
    isStandbyProducer: false,
    isCompanion: false,
    isUnassigned: false,
    canPublish: true,
    canTransferOwnership: false,
    transferEligibilityReason: "already-active-producer",
    embeddings: {
      configured: true,
      textIndexAvailable: true,
      embeddingsDeclared: true,
      exists: true,
      vectorFileState: "available",
      provenance: { stale: false },
      compatibility: { compatible: true },
      contractState: "compatible",
      readiness: { loaded: true, runtimeReady: true },
      runtimeState: "ready",
      semanticAvailable: true,
      effectiveMode: "full",
    },
    ...overrides,
  });

  describe("1. Identity Conversion (toEmbeddingIdentitySummary)", () => {
    it("extracts canonical identity summary from VectorContractV1", () => {
      const summary = toEmbeddingIdentitySummary(baseContract);
      expect(summary).toEqual({
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
        contractId: "vec:ollama:nomic-embed-text:768:1:nomic-search-query-document",
      });
    });

    it("handles null/undefined gracefully", () => {
      expect(toEmbeddingIdentitySummary(null)).toBeUndefined();
      expect(toEmbeddingIdentitySummary(undefined)).toBeUndefined();
    });
  });

  describe("2. Nonexistent Embeddings (NO_TEXT_INDEX & INDEX_ONLY)", () => {
    it("resolves NO_TEXT_INDEX when text index is missing", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeBaseDeviceRuntime({
          embeddings: {
            configured: true,
            textIndexAvailable: false,
            embeddingsDeclared: false,
            exists: false,
            generationAvailable: false,
            semanticAvailable: false,
            contractMismatch: false,
            hasLocalCredentials: true,
          },
        }),
        upstreamTextIndex: "missing",
        canonicalExists: false,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("NO_TEXT_INDEX");
      expect(snapshot.read.effectiveMode).toBe("unavailable");
      expect(snapshot.capability.canRequestUpdate).toBe(false);
    });

    it("resolves INDEX_ONLY when text index is ready but embeddings do not exist", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeBaseDeviceRuntime({
          embeddings: {
            configured: true,
            textIndexAvailable: true,
            embeddingsDeclared: false,
            exists: false,
            generationAvailable: true,
            semanticAvailable: false,
            contractMismatch: false,
            hasLocalCredentials: true,
          },
        }),
        upstreamTextIndex: "ready",
        canonicalExists: false,
        validForSearchCount: 0,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("INDEX_ONLY");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.effectiveMode).toBe("text-only");
    });
  });

  describe("3. Valid & Up-to-Date Embeddings (READY)", () => {
    it("resolves READY when embeddings exist, match contract, and have no pending work", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeBaseDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        workflowState: {
          status: "idle",
          workAvailable: false,
          operationRunning: false,
          canUpdate: false,
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("READY");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.write.updateRequired).toBe(false);
    });
  });

  describe("4. Incompatible Provider / Model (INCOMPATIBLE)", () => {
    it("resolves INCOMPATIBLE and text-only mode when published identity differs from target", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeBaseDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        publishedIdentity: {
          provider: "mistral",
          model: "mistral-embed",
          dimensions: 1024,
          inputVersion: 1,
          prefixMode: "none",
        },
        vectorContract: baseContract, // ollama / nomic-embed-text
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.effectiveMode).toBe("text-only");
      expect(snapshot.read.compatibility.status).toBe("incompatible");
      expect(snapshot.read.compatibility.reasons).toContain("provider-mismatch");
    });
  });

  describe("5. Modified Notes without Rebuild (UPDATE_AVAILABLE)", () => {
    it("resolves UPDATE_AVAILABLE when valid embeddings exist but update plan has pending generation", () => {
      const mockPlan: EmbeddingUpdatePlan = {
        mode: "incremental",
        targetIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          inputVersion: 1,
          prefixMode: "nomic-search-query-document",
          dimensions: 768,
        },
        totalChunks: 105,
        reusableCanonicalCount: 100,
        recoverableCheckpointCount: 0,
        toGenerateCount: 5,
        staleToReplaceCount: 3,
        missingCount: 2,
        obsoleteToDropCount: 0,
        reusableCanonicalRecords: [],
        recoverableCheckpointRecords: [],
        chunksToGenerate: [],
        obsoleteChunkIds: [],
        recordsToPublish: [],
        requiresPublication: false,
        reasons: ["stale-chunks", "missing-chunks"],
      };

      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeBaseDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        updatePlan: mockPlan,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.write.updateRequired).toBe(true);
      expect(snapshot.write.work.kind).toBe("pending");
      expect(snapshot.write.work.mode).toBe("incremental");
      expect(snapshot.capability.canRequestUpdate).toBe(true);
    });
  });

  describe("6. Companion Role Isolation (C1 resolution)", () => {
    it("guarantees write.applicable=false, canRequestUpdate=false, while semantic search remains READY", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeBaseDeviceRuntime({
          effectiveRole: "companion",
          isCompanion: true,
          isActiveProducer: false,
        }),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        workflowState: {
          status: "update-required", // Legacy may report work available
          workAvailable: true,
          operationRunning: false,
          canUpdate: true,
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.write.applicable).toBe(false);
      expect(snapshot.write.updateRequired).toBe(false);
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("companion");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.primary).toBe("READY");
    });
  });

  describe("7. Indeterminate State Handling", () => {
    it("resolves INDETERMINATE when index is unreadable and never falls back to READY", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeBaseDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        canonicalReadability: "unreadable",
        validForSearchCount: 0,
        vectorContract: baseContract,
        updatePlan: {
          mode: "indeterminate",
          targetIdentity: {
            provider: "ollama",
            model: "nomic-embed-text",
            inputVersion: 1,
            prefixMode: "nomic-search-query-document",
            dimensions: 768,
          },
          totalChunks: 50,
          reusableCanonicalCount: 0,
          recoverableCheckpointCount: 0,
          toGenerateCount: 0,
          staleToReplaceCount: 0,
          missingCount: 0,
          obsoleteToDropCount: 0,
          reusableCanonicalRecords: [],
          recoverableCheckpointRecords: [],
          chunksToGenerate: [],
          obsoleteChunkIds: [],
          recordsToPublish: [],
          requiresPublication: false,
          reasons: ["canonical-unreadable"],
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("INDETERMINATE");
      expect(snapshot.primary).not.toBe("READY");
      expect(snapshot.write.work.kind).toBe("indeterminate");
    });
  });
});
