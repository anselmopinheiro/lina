import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { buildEmbeddingStatusViewModel } from "../../src/search/embeddingStatusViewModel";
import { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../../src/index/embeddingWorkStatusController";
import {
  adaptCurrentStateToLifecycleSnapshot,
} from "../../src/index/embeddingLifecycleAdapter";
import { VectorContractV1 } from "../../src/index/vectorContract";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { buildDeviceDiagnostics } from "../../src/device/deviceDiagnostics";

describe("LINA-14C.2: Diagnostics with EmbeddingLifecycleSnapshot", () => {
  const stringsPt = getStrings("pt-PT");

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

  function idleOperation(): EmbeddingOperationState {
    return {
      operationId: null,
      origin: null,
      status: "idle",
      startedAt: null,
      finishedAt: null,
      message: null,
      error: null,
      phase: null,
      totalChunks: null,
      processedChunks: 0,
      generatedChunks: 0,
      failedChunks: 0,
      reusedChunks: 0,
      percentage: null,
      currentChunk: null,
      cancelRequestedAt: null,
    };
  }

  function dummyWorkState(): EmbeddingWorkRuntimeState {
    return {
      status: "ready",
      revision: 1,
      calculatedRevision: 1,
      workAvailable: false,
    };
  }

  // -------------------------------------------------------------------------
  // Scenario 1: READY
  // -------------------------------------------------------------------------
  it("Scenario 1 (READY): Shows green diagnostic, semantic search available, no write actions", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 50,
      vectorContract: baseContract,
      workAssessment: {
        kind: "none",
        updateRequired: false,
        severity: "none",
        cost: "local",
        reasons: ["up-to-date"],
      },
    });

    expect(snapshot.primary).toBe("READY");
    expect(snapshot.read.semanticAvailable).toBe(true);

    const vm = buildEmbeddingStatusViewModel({
      workState: dummyWorkState(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text",
      indexReady: true,
      embeddingsReady: true,
      strings: stringsPt,
      lifecycleSnapshot: snapshot,
    });

    expect(vm.headline).toBe(stringsPt.stateEmbeddingStatusUpToDate);
    expect(vm.tone).toBe("success");
    expect(vm.runtimeLabel).toBe(stringsPt.diagnosticEmbeddingRuntimeReady);
    expect(vm.actions.map((a) => a.kind)).toEqual(["refresh-status"]);

    // Diagnostics device inspection
    const diag = buildDeviceDiagnostics({
      deviceId: "device-producer-1",
      lifecycleSnapshot: snapshot,
    });
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");
  });

  // -------------------------------------------------------------------------
  // Scenario 2: UPDATE_AVAILABLE
  // -------------------------------------------------------------------------
  it("Scenario 2 (UPDATE_AVAILABLE): Embeddings valid for search and incremental update available", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 45,
      vectorContract: baseContract,
      updatePlan: {
        mode: "incremental",
        targetIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "nomic-search-query-document",
        },
        totalChunks: 50,
        reusableCanonicalCount: 45,
        recoverableCheckpointCount: 0,
        toGenerateCount: 5,
        staleToReplaceCount: 3,
        missingCount: 2,
        obsoleteToDropCount: 0,
        requiresPublication: false,
        reasons: ["stale-chunks", "missing-chunks"],
      },
    });

    expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
    expect(snapshot.read.semanticAvailable).toBe(true);
    expect(snapshot.write.updateRequired).toBe(true);

    const vm = buildEmbeddingStatusViewModel({
      workState: dummyWorkState(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text",
      indexReady: true,
      embeddingsReady: true,
      strings: stringsPt,
      lifecycleSnapshot: snapshot,
    });

    expect(vm.headline).toBe(stringsPt.stateEmbeddingUpdateAvailable);
    expect(vm.tone).toBe("warning");
    expect(vm.guidance).toBe(stringsPt.diagnosticEmbeddingIncrementalGuidance);
    expect(vm.actions).toContainEqual({
      kind: "update",
      label: stringsPt.btnUpdateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: false,
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: INCOMPATIBLE
  // -------------------------------------------------------------------------
  it("Scenario 3 (INCOMPATIBLE): Blocks semantic search, provides explicit reason and requires confirmed full rebuild", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime({
        embeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: true,
          exists: true,
          vectorFileState: "available",
          provenance: { stale: false },
          compatibility: { compatible: false, reason: "model-mismatch" },
          contractState: "incompatible",
          readiness: { loaded: true, runtimeReady: false },
          runtimeState: "error",
          semanticAvailable: false,
          effectiveMode: "text-only",
        },
      }),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 50,
      publishedIdentity: {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      },
      vectorContract: {
        ...baseContract,
        model: "different-model",
      },
      updatePlan: {
        mode: "full-rebuild",
        targetIdentity: {
          provider: "ollama",
          model: "different-model",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
        },
        totalChunks: 50,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 50,
        staleToReplaceCount: 0,
        missingCount: 50,
        obsoleteToDropCount: 50,
        requiresPublication: false,
        reasons: ["model-mismatch"],
      },
    });

    expect(snapshot.primary).toBe("INCOMPATIBLE");
    expect(snapshot.read.semanticAvailable).toBe(false);

    const vm = buildEmbeddingStatusViewModel({
      workState: dummyWorkState(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "different-model",
      indexReady: true,
      embeddingsReady: false,
      strings: stringsPt,
      lifecycleSnapshot: snapshot,
    });

    expect(vm.headline).toBe(stringsPt.diagnosticEmbeddingFullRebuildRequired);
    expect(vm.tone).toBe("warning");
    expect(vm.guidance).toBe(stringsPt.diagnosticEmbeddingFullRebuildGuidance);
    expect(vm.actions).toContainEqual({
      kind: "rebuild",
      label: stringsPt.btnRebuildEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: true,
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: INDEX_ONLY
  // -------------------------------------------------------------------------
  it("Scenario 4 (INDEX_ONLY): Text index exists without embeddings, offers initial generate", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime({
        embeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: false,
          exists: false,
          vectorFileState: "missing",
          provenance: { stale: false },
          compatibility: { compatible: false, reason: "embeddings-missing" },
          contractState: "none",
          readiness: { loaded: false, runtimeReady: false },
          runtimeState: "unknown",
          semanticAvailable: false,
          effectiveMode: "text-only",
        },
      }),
      upstreamTextIndex: "ready",
      canonicalExists: false,
      validForSearchCount: 0,
      workAssessment: {
        kind: "pending",
        mode: "initial-build",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["initial-build"],
        counts: {
          totalChunks: 30,
          toGenerate: 30,
          staleToReplace: 0,
          missing: 30,
          obsoleteToDrop: 0,
          reusableCanonical: 0,
          recoverableCheckpoint: 0,
        },
      },
    });

    expect(snapshot.primary).toBe("INDEX_ONLY");
    expect(snapshot.read.semanticAvailable).toBe(false);

    const vm = buildEmbeddingStatusViewModel({
      workState: dummyWorkState(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text",
      indexReady: true,
      embeddingsReady: false,
      strings: stringsPt,
      lifecycleSnapshot: snapshot,
    });

    expect(vm.headline).toBe(stringsPt.diagnosticEmbeddingDetailsUnavailable);
    expect(vm.tone).toBe("neutral");
    expect(vm.actions).toContainEqual({
      kind: "generate",
      label: stringsPt.btnGenerateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: false,
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Companion (Zero write mutations)
  // -------------------------------------------------------------------------
  it("Scenario 5 (Companion): Never presents write actions or generation buttons", () => {
    const companionRuntime = makeDeviceRuntime({
      effectiveRole: "companion",
      isActiveProducer: false,
      isCompanion: true,
      canPublish: false,
    });

    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: companionRuntime,
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 50,
      vectorContract: baseContract,
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["stale-chunks"],
      },
    });

    expect(snapshot.write.applicable).toBe(false);
    expect(snapshot.capability.blockedReason).toBe("companion");

    const vm = buildEmbeddingStatusViewModel({
      workState: dummyWorkState(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text",
      indexReady: true,
      embeddingsReady: true,
      strings: stringsPt,
      lifecycleSnapshot: snapshot,
    });

    // Zero mutation actions allowed on Companion
    expect(vm.actions.map((a) => a.kind)).toEqual(["refresh-status"]);
    expect(vm.guidance).toBe(stringsPt.sidebarMaintenanceManagedByActiveProducer);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: ERROR
  // -------------------------------------------------------------------------
  it("Scenario 6 (ERROR): Surfaces error headline and runtime label cleanly", () => {
    const errorSnapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime({
        embeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: true,
          exists: true,
          vectorFileState: "corrupt",
          provenance: { stale: false },
          compatibility: { compatible: false, reason: "corrupt-file" },
          contractState: "none",
          readiness: { loaded: false, runtimeReady: false },
          runtimeState: "error",
          semanticAvailable: false,
          effectiveMode: "text-only",
        },
      }),
      upstreamTextIndex: "ready",
      canonicalExists: false,
      validForSearchCount: 0,
      operationState: {
        status: "failed",
        error: "Generation failed due to network error",
        phase: null,
        processedChunks: 0,
        totalChunks: 10,
        reusedChunks: 0,
        failedChunks: 1,
      },
    });

    expect(errorSnapshot.primary).toBe("ERROR");

    const vm = buildEmbeddingStatusViewModel({
      workState: dummyWorkState(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text",
      indexReady: true,
      embeddingsReady: false,
      strings: stringsPt,
      lifecycleSnapshot: errorSnapshot,
    });

    expect(vm.headline).toBe(stringsPt.statusEmbeddingsError);
    expect(vm.tone).toBe("error");
    expect(vm.runtimeLabel).toBe(stringsPt.diagnosticEmbeddingRuntimeError);
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Prior epoch
  // -------------------------------------------------------------------------
  it("Scenario 7 (Prior Epoch): Valid embeddings with preserved historical publication metadata", () => {
    const historicalTime = "2026-07-01T10:00:00.000Z";
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeDeviceRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 120,
      vectorContract: baseContract,
      producerState: {
        deviceId: "device-producer-1",
        embeddings: {
          lastSuccessfulPublicationAt: historicalTime,
        },
      },
      workAssessment: {
        kind: "none",
        updateRequired: false,
        severity: "none",
        cost: "local",
        reasons: ["up-to-date"],
      },
    });

    expect(snapshot.primary).toBe("READY");
    expect(snapshot.info.embeddingsPublishedAt).toBe(historicalTime);

    const vm = buildEmbeddingStatusViewModel({
      workState: dummyWorkState(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text",
      indexReady: true,
      embeddingsReady: true,
      strings: stringsPt,
      lifecycleSnapshot: snapshot,
    });

    expect(vm.headline).toBe(stringsPt.stateEmbeddingStatusUpToDate);
    expect(vm.tone).toBe("success");
    expect(vm.published).toContainEqual({
      label: stringsPt.detailsLastEmbeddingUpdate,
      value: historicalTime,
    });
  });
});
