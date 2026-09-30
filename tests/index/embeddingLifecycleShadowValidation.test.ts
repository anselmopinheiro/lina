import { describe, expect, it } from "vitest";
import {
  adaptCurrentStateToLifecycleSnapshot,
  CurrentEmbeddingStateInputs,
} from "../../src/index/embeddingLifecycleAdapter";
import {
  validateLifecycleInvariants,
  EmbeddingWorkAssessment,
} from "../../src/index/embeddingLifecycleModel";
import { VectorContractV1 } from "../../src/index/vectorContract";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { EmbeddingUpdatePlan } from "../../src/index/embeddingUpdatePlan";

describe("LINA-14B1: Shadow Lifecycle Validation & Scenario Matrix", () => {
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

  const makeDeviceRuntime = (overrides: Partial<DeviceRuntimeState> = {}): DeviceRuntimeState => ({
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

  // -------------------------------------------------------------------------
  // Scenario 1: Vault novo sem índice nem embeddings
  // -------------------------------------------------------------------------
  describe("Scenario 1: Vault novo sem índice nem embeddings", () => {
    it("evaluates correctly to NO_TEXT_INDEX and passes all invariants", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime({
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
        validForSearchCount: 0,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("NO_TEXT_INDEX");
      expect(snapshot.read.effectiveMode).toBe("unavailable");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("text-index-not-ready");

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Índice textual criado sem embeddings
  // -------------------------------------------------------------------------
  describe("Scenario 2: Índice textual criado sem embeddings", () => {
    it("evaluates correctly to INDEX_ONLY with text-only search readiness", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime({
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
        vectorContract: baseContract,
        updatePlan: {
          mode: "initial-build",
          targetIdentity: baseContract,
          totalChunks: 50,
          reusableCanonicalCount: 0,
          recoverableCheckpointCount: 0,
          toGenerateCount: 50,
          staleToReplaceCount: 0,
          missingCount: 50,
          obsoleteToDropCount: 0,
          reusableCanonicalRecords: [],
          recoverableCheckpointRecords: [],
          chunksToGenerate: [],
          obsoleteChunkIds: [],
          recordsToPublish: [],
          requiresPublication: true,
          reasons: ["canonical-missing-or-empty"],
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("INDEX_ONLY");
      expect(snapshot.read.effectiveMode).toBe("text-only");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.write.applicable).toBe(true);
      expect(snapshot.write.updateRequired).toBe(true);
      expect(snapshot.write.work.mode).toBe("initial-build");
      expect(snapshot.capability.canRequestUpdate).toBe(true);

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Embeddings válidos
  // -------------------------------------------------------------------------
  describe("Scenario 3: Embeddings válidos", () => {
    it("evaluates to READY with full search mode and zero pending work", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 150,
        vectorContract: baseContract,
        workAssessment: {
          kind: "none",
          updateRequired: false,
          severity: "none",
          cost: "local",
          reasons: ["up-to-date"],
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("READY");
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.write.applicable).toBe(true);
      expect(snapshot.write.updateRequired).toBe(false);
      expect(snapshot.write.work.kind).toBe("none");

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Notas alteradas sem regeneração
  // -------------------------------------------------------------------------
  describe("Scenario 4: Notas alteradas sem regeneração", () => {
    it("evaluates to UPDATE_AVAILABLE, maintains search capability while flagging update", () => {
      const mockPlan: EmbeddingUpdatePlan = {
        mode: "incremental",
        targetIdentity: baseContract,
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
        reasons: ["chunks-need-generation"],
      };

      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        updatePlan: mockPlan,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.write.applicable).toBe(true);
      expect(snapshot.write.updateRequired).toBe(true);
      expect(snapshot.write.work.kind).toBe("pending");
      expect(snapshot.write.work.mode).toBe("incremental");
      expect(snapshot.capability.canRequestUpdate).toBe(true);

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Alteração de provider
  // -------------------------------------------------------------------------
  describe("Scenario 5: Alteração de provider", () => {
    it("evaluates to INCOMPATIBLE, downgrades read to text-only and requires full rebuild", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        publishedIdentity: {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          inputVersion: 1,
          prefixMode: "none",
        },
        vectorContract: baseContract, // ollama / nomic-embed-text
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.read.effectiveMode).toBe("text-only");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.compatibility.status).toBe("incompatible");
      expect(snapshot.read.compatibility.reasons).toContain("provider-mismatch");
      expect(snapshot.write.applicable).toBe(true);

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Alteração de modelo
  // -------------------------------------------------------------------------
  describe("Scenario 6: Alteração de modelo", () => {
    it("evaluates to INCOMPATIBLE, flags model mismatch and blocks semantic search", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        publishedIdentity: {
          provider: "ollama",
          model: "bge-m3",
          dimensions: 1024,
          inputVersion: 1,
          prefixMode: "none",
        },
        vectorContract: baseContract, // ollama / nomic-embed-text
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.read.effectiveMode).toBe("text-only");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.compatibility.status).toBe("incompatible");
      expect(snapshot.read.compatibility.reasons).toContain("model-mismatch");

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Estado Companion
  // -------------------------------------------------------------------------
  describe("Scenario 7: Estado Companion", () => {
    it("strictly isolates write capability while preserving valid read capability", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime({
          effectiveRole: "companion",
          isCompanion: true,
          isActiveProducer: false,
        }),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "action",
          cost: "local",
          reasons: ["work-available"],
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("READY");
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.write.applicable).toBe(false);
      expect(snapshot.write.updateRequired).toBe(false);
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("companion");

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Producer sem ownership (Standby Producer)
  // -------------------------------------------------------------------------
  describe("Scenario 8: Producer sem ownership", () => {
    it("evaluates to STANDBY, prevents write execution while allowing read-only search", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime({
          effectiveRole: "producer",
          isActiveProducer: false,
          isStandbyProducer: true,
        }),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("STANDBY");
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.write.applicable).toBe(false);
      expect(snapshot.write.updateRequired).toBe(false);
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("standby");

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Geração em curso
  // -------------------------------------------------------------------------
  describe("Scenario 9: Geração em curso", () => {
    it("evaluates to UPDATING, reflects process phase, progress and cancellability", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        operationState: {
          status: "running",
          phase: "generating",
          processedChunks: 45,
          totalChunks: 100,
          reusedChunks: 30,
          failedChunks: 0,
          startedAt: Date.now() - 5000,
          origin: "sidebar",
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("UPDATING");
      expect(snapshot.process.phase).toBe("generating");
      expect(snapshot.process.cancellable).toBe(true);
      expect(snapshot.process.progress).toEqual({
        processed: 45,
        total: 100,
        reused: 30,
        failed: 0,
      });
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("operation-active");

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Erro operacional
  // -------------------------------------------------------------------------
  describe("Scenario 10: Erro operacional", () => {
    it("evaluates to ERROR, records failure history and allows retry", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        operationState: {
          status: "failed",
          phase: null,
          processedChunks: 12,
          totalChunks: 100,
          error: "Ollama timeout during batch 2",
          message: "Connection timed out",
          finishedAt: Date.now(),
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);

      expect(snapshot.primary).toBe("ERROR");
      expect(snapshot.history.lastOperation?.kind).toBe("failed");
      expect(snapshot.history.lastOperation?.message).toBe("Ollama timeout during batch 2");
      expect(snapshot.capability.canRequestUpdate).toBe(true);

      const invariants = validateLifecycleInvariants(snapshot);
      expect(invariants.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Architectural Cross-Check Invariants
  // -------------------------------------------------------------------------
  describe("Architectural Cross-Check Invariants", () => {
    it("NEVER resolves READY with pending write work on an active producer", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "action",
          cost: "local",
          reasons: ["work-available"],
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).not.toBe("READY");
      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
    });

    it("NEVER allows write applicability or update requests on Companion", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime({
          effectiveRole: "companion",
          isCompanion: true,
          isActiveProducer: false,
        }),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.write.applicable).toBe(false);
      expect(snapshot.capability.canRequestUpdate).toBe(false);
    });

    it("NEVER enables semantic search when INCOMPATIBLE", () => {
      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        publishedIdentity: {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
        vectorContract: baseContract,
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.effectiveMode).not.toBe("full");
    });

    it("NEVER flags UPDATE_AVAILABLE without a valid work reason", () => {
      const emptyWork: EmbeddingWorkAssessment = {
        kind: "none",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["up-to-date"],
      };

      const inputs: CurrentEmbeddingStateInputs = {
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        workAssessment: {
          kind: "none",
          updateRequired: false,
          severity: "none",
          cost: "local",
          reasons: ["up-to-date"],
        },
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
      expect(snapshot.primary).toBe("READY");
      expect(snapshot.write.updateRequired).toBe(false);
    });
  });
});
