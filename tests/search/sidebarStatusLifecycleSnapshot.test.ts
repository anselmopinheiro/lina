import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  buildSidebarStatusViewModel,
  type BuildSidebarStatusViewModelInput,
} from "../../src/search/sidebarStatusViewModel";
import {
  adaptCurrentStateToLifecycleSnapshot,
  CurrentEmbeddingStateInputs,
} from "../../src/index/embeddingLifecycleAdapter";
import { VectorContractV1 } from "../../src/index/vectorContract";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";

describe("LINA-14C-1: Sidebar Status ViewModel with EmbeddingLifecycleSnapshot", () => {
  const stringsPt = getStrings("pt-PT");
  const stringsEn = getStrings("en");

  const baseNow = new Date("2026-09-05T12:00:00.000Z").getTime();

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
    deviceId: "device-producer-1",
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

  function createBaseInput(overrides: Partial<BuildSidebarStatusViewModelInput> = {}): BuildSidebarStatusViewModelInput {
    return {
      deviceId: "device-producer-1",
      deviceRole: "producer",
      isAuthorizedProducer: true,
      isStandbyProducer: false,
      textIndexReady: true,
      textIndexUsability: "usable",
      textIndexUpdatedAt: new Date(baseNow - 2 * 60 * 60 * 1000).toISOString(),
      currentSearchMode: "hibrida",
      strings: stringsPt,
      currentTime: baseNow,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // 1. READY state
  // -------------------------------------------------------------------------
  it("1. Resolves READY state to fresh embeddings and full hybrid search", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
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
    });

    const vm = buildSidebarStatusViewModel(createBaseInput({
      lifecycleSnapshot: snapshot,
    }));

    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.searchAvailability.semanticAvailable).toBe(true);
    expect(vm.searchAvailability.hybridMode).toBe("full");
    expect(vm.searchAvailability.currentModeHeadline).toBe(stringsPt.sidebarSearchHybridFull);
    expect(vm.searchAvailability.tone).toBe("success");
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
    expect(vm.degradedAlert).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 2. UPDATE_AVAILABLE state
  // -------------------------------------------------------------------------
  it("2. Resolves UPDATE_AVAILABLE state to stale embeddings (update required) and full search", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
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
    });

    const vm = buildSidebarStatusViewModel(createBaseInput({
      lifecycleSnapshot: snapshot,
    }));

    expect(vm.freshness.embeddings.status).toBe("stale");
    expect(vm.searchAvailability.semanticAvailable).toBe(true);
    expect(vm.searchAvailability.hybridMode).toBe("full");
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. INCOMPATIBLE state
  // -------------------------------------------------------------------------
  it("3. Resolves INCOMPATIBLE state to text-only mode and vector mismatch alert", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
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
    });

    const vm = buildSidebarStatusViewModel(createBaseInput({
      lifecycleSnapshot: snapshot,
    }));

    expect(vm.freshness.embeddings.status).toBe("stale");
    expect(vm.searchAvailability.semanticAvailable).toBe(false);
    expect(vm.searchAvailability.hybridMode).toBe("text-only");
    expect(vm.degradedAlert?.kind).toBe("vector-mismatch");
    expect(vm.degradedAlert?.level).toBe("warning");
  });

  // -------------------------------------------------------------------------
  // 4. INDEX_ONLY state
  // -------------------------------------------------------------------------
  it("4. Resolves INDEX_ONLY state to missing embeddings and text-only hybrid mode", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime({
        embeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: false,
          exists: false,
          semanticAvailable: false,
        },
      }),
      upstreamTextIndex: "ready",
      canonicalExists: false,
      validForSearchCount: 0,
      vectorContract: baseContract,
    });

    const vm = buildSidebarStatusViewModel(createBaseInput({
      lifecycleSnapshot: snapshot,
    }));

    expect(vm.freshness.embeddings.status).toBe("missing");
    expect(vm.searchAvailability.semanticAvailable).toBe(false);
    expect(vm.searchAvailability.hybridMode).toBe("text-only");
  });

  // -------------------------------------------------------------------------
  // 5. Companion device isolation
  // -------------------------------------------------------------------------
  it("5. Resolves Companion state with disabled write maintenance and managed notice", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime({
        effectiveRole: "companion",
        isCompanion: true,
        isActiveProducer: false,
      }),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      vectorContract: baseContract,
    });

    const vm = buildSidebarStatusViewModel(createBaseInput({
      deviceRole: "companion",
      isAuthorizedProducer: false,
      lifecycleSnapshot: snapshot,
    }));

    expect(vm.role.roleKey).toBe("companion");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.searchAvailability.semanticAvailable).toBe(true);
    expect(vm.maintenance.canExecuteMaintenance).toBe(false);
    expect(vm.maintenance.isCompanion).toBe(true);
    expect(vm.maintenance.gatingNotice).toBe(stringsPt.sidebarMaintenanceManagedByActiveProducer);
  });

  // -------------------------------------------------------------------------
  // 6. Producer Standby
  // -------------------------------------------------------------------------
  it("6. Resolves Standby Producer state with disabled write maintenance and standby notice", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime({
        effectiveRole: "producer",
        isActiveProducer: false,
        isStandbyProducer: true,
      }),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      vectorContract: baseContract,
    });

    const vm = buildSidebarStatusViewModel(createBaseInput({
      deviceRole: "producer",
      isAuthorizedProducer: false,
      isStandbyProducer: true,
      lifecycleSnapshot: snapshot,
    }));

    expect(vm.role.roleKey).toBe("standby-producer");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.maintenance.canExecuteMaintenance).toBe(false);
    expect(vm.maintenance.isStandby).toBe(true);
    expect(vm.maintenance.gatingNotice).toBe(stringsPt.sidebarMaintenanceStandbyNotice);
  });

  // -------------------------------------------------------------------------
  // 7. ERROR state
  // -------------------------------------------------------------------------
  it("7. Resolves ERROR state correctly and preserves retry affordance", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      vectorContract: baseContract,
      operationState: {
        status: "failed",
        phase: null,
        processedChunks: 10,
        totalChunks: 100,
        error: "Provider connection timeout",
        message: "Failed",
      },
    });

    const vm = buildSidebarStatusViewModel(createBaseInput({
      lifecycleSnapshot: snapshot,
    }));

    expect(vm.freshness.embeddings.status).toBe("stale");
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. Canonical Action Derivation (LINA-15E)
  // -------------------------------------------------------------------------
  describe("8. Canonical Action Derivation (LINA-15E)", () => {
    it("8.1 Exposes 'update' action for UPDATE_AVAILABLE state", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 80,
        vectorContract: baseContract,
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "low",
          cost: "local",
          reasons: ["stale-detected"],
        },
      });

      const vm = buildSidebarStatusViewModel(createBaseInput({
        lifecycleSnapshot: snapshot,
      }));

      expect(vm.action).toBeDefined();
      expect(vm.action?.kind).toBe("update");
      expect(vm.action?.label).toBe(stringsPt.btnUpdateEmbeddings || "Atualizar embeddings");
      expect(vm.action?.disabled).toBe(false);
      expect(vm.action?.isFullRebuild).toBe(false);
      expect(vm.action?.requiresConfirmation).toBe(false);
      expect(vm.action?.isVisible).toBe(true);
    });

    it("8.2 Exposes 'generate' action for INDEX_ONLY state", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: false,
        validForSearchCount: 0,
        vectorContract: baseContract,
        workAssessment: {
          kind: "pending",
          mode: "initial-build",
          updateRequired: true,
          severity: "action",
          cost: "local",
          reasons: ["missing-initial"],
        },
      });

      const vm = buildSidebarStatusViewModel(createBaseInput({
        lifecycleSnapshot: snapshot,
      }));

      expect(vm.action).toBeDefined();
      expect(vm.action?.kind).toBe("generate");
      expect(vm.action?.label).toBe(stringsPt.commandGenerateEmbeddings || "Gerar embeddings");
      expect(vm.action?.disabled).toBe(false);
      expect(vm.action?.isFullRebuild).toBe(false);
      expect(vm.action?.isVisible).toBe(true);
    });

    it("8.3 Exposes 'rebuild' action with fullRebuild and confirmation for INCOMPATIBLE state", () => {
      const incompatibleContract: VectorContractV1 = {
        ...baseContract,
        model: "text-embedding-3-small",
        dimensions: 1536,
        contractId: "vec:openai:text-embedding-3-small:1536:1:none",
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: incompatibleContract,
        workAssessment: {
          kind: "pending",
          mode: "full-rebuild",
          updateRequired: true,
          severity: "blocking",
          cost: "external",
          reasons: ["model-mismatch"],
        },
      });

      const vm = buildSidebarStatusViewModel(createBaseInput({
        lifecycleSnapshot: snapshot,
      }));

      expect(vm.action).toBeDefined();
      expect(vm.action?.kind).toBe("rebuild");
      expect(vm.action?.label).toBe(stringsPt.rebuildEmbeddings || "Reconstruir embeddings");
      expect(vm.action?.disabled).toBe(false);
      expect(vm.action?.isFullRebuild).toBe(true);
      expect(vm.action?.requiresConfirmation).toBe(true);
      expect(vm.action?.isVisible).toBe(true);
    });

    it("8.4 Does not expose write action for INDETERMINATE unreadable state", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        canonicalReadability: "unreadable",
        validForSearchCount: 0,
        vectorContract: baseContract,
        workAssessment: {
          kind: "indeterminate",
          updateRequired: false,
          severity: "none",
          cost: "none",
          reasons: ["canonical-unreadable"],
        },
      });

      const vm = buildSidebarStatusViewModel(createBaseInput({
        lifecycleSnapshot: snapshot,
      }));

      expect(vm.action).toBeUndefined();
    });

    it("8.5 Exposes 'cancel' action during active operation", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 100,
        vectorContract: baseContract,
        operationState: {
          status: "running",
          phase: "generating",
          processedChunks: 25,
          totalChunks: 100,
        },
      });

      const vm = buildSidebarStatusViewModel(createBaseInput({
        lifecycleSnapshot: snapshot,
      }));

      expect(vm.action).toBeDefined();
      expect(vm.action?.kind).toBe("cancel");
      expect(vm.action?.label).toBe(stringsPt.actionCancel || "Cancelar");
      expect(vm.action?.disabled).toBe(false);
      expect(vm.action?.isVisible).toBe(true);
    });

    it("8.6 Does not expose write actions to Companion or Standby devices", () => {
      const companionSnapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime({
          effectiveRole: "companion",
          isCompanion: true,
          isActiveProducer: false,
        }),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 80,
        vectorContract: baseContract,
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "low",
          cost: "local",
          reasons: ["stale-detected"],
        },
      });

      const companionVm = buildSidebarStatusViewModel(createBaseInput({
        deviceRole: "companion",
        isAuthorizedProducer: false,
        lifecycleSnapshot: companionSnapshot,
      }));

      expect(companionVm.action).toBeUndefined();

      const standbySnapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime({
          effectiveRole: "producer",
          isStandbyProducer: true,
          isActiveProducer: false,
        }),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 80,
        vectorContract: baseContract,
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "low",
          cost: "local",
          reasons: ["stale-detected"],
        },
      });

      const standbyVm = buildSidebarStatusViewModel(createBaseInput({
        deviceRole: "producer",
        isAuthorizedProducer: false,
        isStandbyProducer: true,
        lifecycleSnapshot: standbySnapshot,
      }));

      expect(standbyVm.action).toBeUndefined();
    });

    it("8.7 Treats resource-limit-exceeded as full rebuild with confirmation required", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: makeDeviceRuntime(),
        upstreamTextIndex: "ready",
        canonicalExists: true,
        canonicalReadability: "resource-limit-exceeded",
        validForSearchCount: 0,
        vectorContract: baseContract,
        updatePlan: {
          mode: "full-rebuild",
          targetIdentity: { provider: "ollama", model: "nomic-embed-text" },
          reasons: ["canonical-resource-limit-exceeded"],
          totalChunks: 100,
          recoverableCheckpointCount: 0,
          reusableCanonicalCount: 0,
          toGenerateCount: 100,
          staleToReplaceCount: 0,
          missingCount: 0,
          obsoleteToDropCount: 0,
          requiresPublication: true,
        },
      });

      const vm = buildSidebarStatusViewModel(createBaseInput({
        lifecycleSnapshot: snapshot,
      }));

      expect(vm.action).toBeDefined();
      expect(vm.action?.kind).toBe("rebuild");
      expect(vm.action?.isFullRebuild).toBe(true);
      expect(vm.action?.requiresConfirmation).toBe(true);
      expect(vm.action?.disabled).toBe(false);
    });
  });
});
