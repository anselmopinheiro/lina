import { describe, expect, it, vi } from "vitest";
import {
  EmbeddingWorkStatusController,
  EmbeddingWorkSummary,
  hasEmbeddingWorkAvailable,
} from "../../src/index/embeddingWorkStatusController";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";

describe("LINA-14D.2-A: EmbeddingWorkStatusController Lifecycle & Write Path Migration", () => {
  const baseSummary: EmbeddingWorkSummary = {
    totalChunks: 10,
    totalCanonicalRecords: 10,
    validCount: 10,
    missingCount: 0,
    staleCount: 0,
    obsoleteCount: 0,
    validForSearchCount: 10,
    reusableForNextGenerationCount: 10,
    recoverableCheckpointCount: 0,
    operationActive: false,
    duplicateRecordCount: 0,
    invalidRecordCount: 0,
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    exists: true,
    canonicalReadability: "readable",
  };

  const defaultTargetIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none",
  };

  it("1. Scenario READY: no pending work, action is none, workAvailable is false", async () => {
    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      updatePlan: {
        mode: "incremental" as const,
        totalChunks: 10,
        reusableCanonicalCount: 10,
        recoverableCheckpointCount: 0,
        toGenerateCount: 0,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: false,
        targetIdentity: defaultTargetIdentity,
      },
    }));

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBe(false);
    expect(state.decision?.action).toBe("none");
    expect(state.decision?.workKind).toBe("none");
    expect(state.decision?.updateRequired).toBe(false);
    expect(state.lifecycleSnapshot?.primary).toBe("READY");
  });

  it("2. Scenario UPDATE_AVAILABLE: pending work derives action update and workAvailable true", async () => {
    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      missingCount: 2,
      updatePlan: {
        mode: "incremental" as const,
        totalChunks: 12,
        reusableCanonicalCount: 10,
        recoverableCheckpointCount: 0,
        toGenerateCount: 2,
        staleToReplaceCount: 0,
        missingCount: 2,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        targetIdentity: defaultTargetIdentity,
      },
    }));

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBe(true);
    expect(state.decision?.action).toBe("update");
    expect(state.decision?.workKind).toBe("pending");
    expect(state.decision?.updateRequired).toBe(true);
    expect(state.lifecycleSnapshot?.primary).toBe("UPDATE_AVAILABLE");
  });

  it("3. Scenario INDEX_ONLY: missing embeddings derives action generate and workAvailable true", async () => {
    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      exists: false,
      validCount: 0,
      validForSearchCount: 0,
      missingCount: 10,
      updatePlan: {
        mode: "initial-build" as const,
        totalChunks: 10,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 10,
        staleToReplaceCount: 0,
        missingCount: 10,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        targetIdentity: defaultTargetIdentity,
      },
    }));

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBe(true);
    expect(state.decision?.action).toBe("generate");
    expect(state.decision?.workKind).toBe("pending");
    expect(state.lifecycleSnapshot?.primary).toBe("INDEX_ONLY");
  });

  it("4. Scenario INCOMPATIBLE: full rebuild required with confirmation", async () => {
    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      provider: "ollama",
      model: "nomic-embed-text",
      updatePlan: {
        mode: "full-rebuild" as const,
        totalChunks: 10,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 10,
        staleToReplaceCount: 10,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["model-mismatch"],
        targetIdentity: {
          provider: "ollama",
          model: "mxbai-embed-large",
          dimensions: 1024,
          inputVersion: 1,
          prefixMode: "none",
        },
      },
    }));

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBe(true);
    expect(state.decision?.action).toBe("rebuild");
    expect(state.decision?.requiresConfirmation).toBe(true);
    expect(state.decision?.workKind).toBe("pending");
  });

  it("5. Scenario ERROR: refresh failure transitions to error and allows retry", async () => {
    let shouldFail = true;
    const refreshSummary = vi.fn(async () => {
      if (shouldFail) {
        throw new Error("Temporary network timeout");
      }
      return {
        ...baseSummary,
        missingCount: 1,
        updatePlan: {
          mode: "incremental" as const,
          totalChunks: 11,
          reusableCanonicalCount: 10,
          recoverableCheckpointCount: 0,
          toGenerateCount: 1,
          staleToReplaceCount: 0,
          missingCount: 1,
          obsoleteToDropCount: 0,
          requiresPublication: true,
          targetIdentity: defaultTargetIdentity,
        },
      };
    });

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const errorState = await controller.refresh("manual-refresh");

    expect(errorState.status).toBe("error");
    expect(errorState.errorCategory).toBe("refresh-failed");
    expect(errorState.workAvailable).toBeUndefined();

    // Retry
    shouldFail = false;
    const recoveredState = await controller.refresh("manual-refresh");
    expect(recoveredState.status).toBe("ready");
    expect(recoveredState.workAvailable).toBe(true);
    expect(recoveredState.decision?.action).toBe("update");
  });

  it("6. Scenario Companion: never executes, never schedules, applicable false", async () => {
    const companionRuntime: DeviceRuntimeState = {
      deviceId: "companion-device",
      effectiveRole: "companion",
      isActiveProducer: false,
      assignmentState: "assigned",
      isConfigured: true,
      ownershipExists: true,
      isStandbyProducer: false,
      isCompanion: true,
      isUnassigned: false,
      canPublish: false,
      canTransferOwnership: false,
      transferEligibilityReason: "companion-device",
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
    };

    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      missingCount: 5,
      deviceRuntimeState: companionRuntime,
      updatePlan: {
        mode: "incremental" as const,
        totalChunks: 15,
        reusableCanonicalCount: 10,
        recoverableCheckpointCount: 0,
        toGenerateCount: 5,
        staleToReplaceCount: 0,
        missingCount: 5,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        targetIdentity: defaultTargetIdentity,
      },
    }));

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBe(false);
    expect(state.decision?.applicable).toBe(false);
    expect(state.decision?.action).toBe("none");
    expect(state.decision?.canExecute).toBe(false);
  });

  it("7. Scenario Standby: never executes, applicable false", async () => {
    const standbyRuntime: DeviceRuntimeState = {
      deviceId: "standby-device",
      effectiveRole: "producer",
      isActiveProducer: false,
      assignmentState: "assigned",
      isConfigured: true,
      ownershipExists: true,
      isStandbyProducer: true,
      isCompanion: false,
      isUnassigned: false,
      canPublish: false,
      canTransferOwnership: true,
      transferEligibilityReason: "standby-ready",
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
    };

    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      missingCount: 3,
      updatePlan: {
        mode: "incremental" as const,
        totalChunks: 13,
        reusableCanonicalCount: 10,
        recoverableCheckpointCount: 0,
        toGenerateCount: 3,
        staleToReplaceCount: 0,
        missingCount: 3,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        targetIdentity: defaultTargetIdentity,
      },
    }));

    const controller = new EmbeddingWorkStatusController({
      refreshSummary,
      getDeviceRuntimeState: () => standbyRuntime,
    });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBe(false);
    expect(state.decision?.applicable).toBe(false);
    expect(state.decision?.action).toBe("none");
    expect(state.decision?.canExecute).toBe(false);
  });

  it("8. Scenario INDETERMINATE: unreadable index preserves workAvailable as undefined and never coerces to idle", async () => {
    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      canonicalReadability: "unreadable" as const,
      detailsAvailable: false,
      updatePlan: {
        mode: "indeterminate" as const,
        totalChunks: 10,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 0,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: false,
        reasons: ["canonical-unreadable"],
      },
    }));

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBeUndefined();
    expect(state.decision?.action).toBeUndefined();
  });

  it("9. Scenario Publish-only cleanup: obsolete records derive action update with zero cost", async () => {
    const refreshSummary = vi.fn(async () => ({
      ...baseSummary,
      obsoleteCount: 3,
      updatePlan: {
        mode: "publish-only" as const,
        totalChunks: 7,
        reusableCanonicalCount: 7,
        recoverableCheckpointCount: 0,
        toGenerateCount: 0,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 3,
        requiresPublication: true,
        targetIdentity: defaultTargetIdentity,
      },
    }));

    const controller = new EmbeddingWorkStatusController({ refreshSummary });
    const state = await controller.refresh("manual-refresh");

    expect(state.status).toBe("ready");
    expect(state.workAvailable).toBe(true);
    expect(state.decision?.action).toBe("update");
    expect(state.decision?.cost).toBe("none");
    expect(state.decision?.workMode).toBe("publish-only");
  });

  it("10. Scenario Parity: hasEmbeddingWorkAvailable matches classification semantics", () => {
    // 0 missing, 0 stale, 0 obsolete
    expect(hasEmbeddingWorkAvailable(baseSummary)).toBe(false);

    // missing chunks
    expect(hasEmbeddingWorkAvailable({ ...baseSummary, missingCount: 1 })).toBe(true);

    // stale chunks
    expect(hasEmbeddingWorkAvailable({ ...baseSummary, staleCount: 1 })).toBe(true);

    // obsolete chunks
    expect(hasEmbeddingWorkAvailable({ ...baseSummary, obsoleteCount: 1 })).toBe(true);

    // duplicates or invalid records
    expect(hasEmbeddingWorkAvailable({ ...baseSummary, duplicateRecordCount: 1 })).toBe(true);
    expect(hasEmbeddingWorkAvailable({ ...baseSummary, invalidRecordCount: 1 })).toBe(true);

    // undefined summary
    expect(hasEmbeddingWorkAvailable(undefined)).toBe(false);
  });
});
