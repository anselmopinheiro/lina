import { describe, expect, it } from "vitest";
import { buildDeviceDiagnostics } from "../../src/device/deviceDiagnostics";
import { DeviceState } from "../../src/device/deviceState";
import { OwnershipManifest } from "../../src/device/deviceOwnership";
import { VectorContractV1 } from "../../src/index/vectorContract";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";

describe("LINA-14C.3: Device Diagnostics with EmbeddingLifecycleSnapshot", () => {
  const timestamp = "2026-09-29T12:00:00.000Z";
  const deviceIdProducer = "device-producer-1";
  const deviceIdCompanion = "device-companion-1";

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

  const makeProducerState = (): DeviceState => ({
    schemaVersion: 2,
    deviceId: deviceIdProducer,
    deviceName: "Studio Mac",
    role: "producer",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const makeCompanionState = (): DeviceState => ({
    schemaVersion: 2,
    deviceId: deviceIdCompanion,
    deviceName: "iPad Pro",
    role: "companion",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const makeOwnership = (): OwnershipManifest => ({
    schemaVersion: 1,
    activeProducerId: deviceIdProducer,
    epoch: 2,
    acquiredAt: timestamp,
    updatedAt: timestamp,
    reason: "initial",
  });

  const makeProducerRuntime = (overrides: Partial<DeviceRuntimeState> = {}): DeviceRuntimeState => ({
    deviceId: deviceIdProducer,
    deviceName: "Studio Mac",
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

  const makeCompanionRuntime = (overrides: Partial<DeviceRuntimeState> = {}): DeviceRuntimeState => ({
    deviceId: deviceIdCompanion,
    deviceName: "iPad Pro",
    effectiveRole: "companion",
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isActiveProducer: false,
    isStandbyProducer: false,
    isCompanion: true,
    isUnassigned: false,
    canPublish: false,
    canTransferOwnership: false,
    transferEligibilityReason: "companion-role",
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
  // 1. Producer com embeddings válidos (READY)
  // -------------------------------------------------------------------------
  it("Scenario 1: Producer with valid embeddings reports full operational search without age-based alerts", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeProducerRuntime(),
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

    expect(snapshot.primary).toBe("READY");

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdProducer,
      deviceState: makeProducerState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.device.role).toBe("producer");
    expect(diag.ownership.isActiveProducer).toBe(true);
    expect(diag.companionSearch.available).toBe(true);
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");
    expect(diag.companionSearch.mode).toBe("full");
    expect(diag.lifecycleSnapshot).toBe(snapshot);
  });

  // -------------------------------------------------------------------------
  // 2. Producer com atualização pendente (UPDATE_AVAILABLE)
  // -------------------------------------------------------------------------
  it("Scenario 2: Producer with update available keeps operational search enabled while reporting update need", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeProducerRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 95,
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
        totalChunks: 100,
        reusableCanonicalCount: 95,
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

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdProducer,
      deviceState: makeProducerState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.companionSearch.available).toBe(true);
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");
  });

  // -------------------------------------------------------------------------
  // 3. Companion com artefactos válidos
  // -------------------------------------------------------------------------
  it("Scenario 3: Companion with valid artifacts has search enabled with zero write authority", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeCompanionRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      vectorContract: baseContract,
    });

    expect(snapshot.write.applicable).toBe(false);
    expect(snapshot.capability.canRequestUpdate).toBe(false);
    expect(snapshot.read.semanticAvailable).toBe(true);

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdCompanion,
      deviceState: makeCompanionState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.device.role).toBe("companion");
    expect(diag.ownership.isCompanion).toBe(true);
    expect(diag.companionSearch.available).toBe(true);
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");
  });

  // -------------------------------------------------------------------------
  // 4. Companion sem artefactos
  // -------------------------------------------------------------------------
  it("Scenario 4: Companion without embeddings operates safely in text-only mode", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeCompanionRuntime({
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
    });

    expect(snapshot.primary).toBe("INDEX_ONLY");
    expect(snapshot.read.semanticAvailable).toBe(false);
    expect(snapshot.read.effectiveMode).toBe("text-only");

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdCompanion,
      deviceState: makeCompanionState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.companionSearch.available).toBe(true);
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(false);
    expect(diag.companionSearch.operationalMode).toBe("text-only");
  });

  // -------------------------------------------------------------------------
  // 5. Vector Contract incompatível (INCOMPATIBLE)
  // -------------------------------------------------------------------------
  it("Scenario 5: Incompatible Vector Contract blocks semantic search with explicit reason and zero silent fallback", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeProducerRuntime({
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
    expect(snapshot.read.compatibility.status).toBe("incompatible");

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdProducer,
      deviceState: makeProducerState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.companionSearch.operationalSemanticAvailable).toBe(false);
    expect(diag.companionSearch.operationalMode).toBe("text-only");
    expect(diag.companionSearch.operationalReason).toBe("model-mismatch");
  });

  // -------------------------------------------------------------------------
  // 6. Prior epoch válido
  // -------------------------------------------------------------------------
  it("Scenario 6: Artifacts from prior epoch remain fully usable without spurious invalidation", () => {
    const historicalTime = "2026-07-01T10:00:00.000Z";
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeProducerRuntime({
        embeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: true,
          exists: true,
          vectorFileState: "available",
          provenance: { stale: true, epoch: 1 },
          compatibility: { compatible: true },
          contractState: "compatible",
          readiness: { loaded: true, runtimeReady: true },
          runtimeState: "ready",
          semanticAvailable: true,
          effectiveMode: "full",
        },
      }),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      vectorContract: baseContract,
      producerState: {
        deviceId: deviceIdProducer,
        embeddings: {
          lastSuccessfulPublicationAt: historicalTime,
        },
      },
    });

    expect(snapshot.primary).toBe("READY");
    expect(snapshot.read.semanticAvailable).toBe(true);

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdProducer,
      deviceState: makeProducerState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.companionSearch.available).toBe(true);
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");
  });

  // -------------------------------------------------------------------------
  // 7. Embeddings inexistentes (INDEX_ONLY)
  // -------------------------------------------------------------------------
  it("Scenario 7: When text index exists but embeddings do not, diagnostics reflects index-only state", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeProducerRuntime({
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
    });

    expect(snapshot.primary).toBe("INDEX_ONLY");
    expect(snapshot.read.semanticAvailable).toBe(false);

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdProducer,
      deviceState: makeProducerState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.companionSearch.operationalSemanticAvailable).toBe(false);
    expect(diag.companionSearch.operationalMode).toBe("text-only");
  });

  // -------------------------------------------------------------------------
  // 8. Estado indeterminado (INDETERMINATE)
  // -------------------------------------------------------------------------
  it("Scenario 8: Canonical unreadable reports indeterminate state safely", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeProducerRuntime({
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
          runtimeState: "unknown",
          semanticAvailable: false,
          effectiveMode: "text-only",
        },
      }),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      canonicalReadability: "unreadable",
      validForSearchCount: 10,
      vectorContract: baseContract,
      updatePlan: {
        mode: "incremental",
        targetIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
        },
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
    });

    expect(snapshot.primary).toBe("INDETERMINATE");
    expect(snapshot.read.semanticAvailable).toBe(true);

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdProducer,
      deviceState: makeProducerState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");
  });

  // -------------------------------------------------------------------------
  // 9. Erro operacional (ERROR)
  // -------------------------------------------------------------------------
  it("Scenario 9: Operation failure sets primary to ERROR with diagnostic integrity", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: makeProducerRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 0,
      operationState: {
        status: "failed",
        error: "Network connection refused",
        phase: null,
        processedChunks: 0,
        totalChunks: 10,
        reusedChunks: 0,
        failedChunks: 1,
      },
    });

    expect(snapshot.primary).toBe("ERROR");

    const diag = buildDeviceDiagnostics({
      deviceId: deviceIdProducer,
      deviceState: makeProducerState(),
      ownership: makeOwnership(),
      lifecycleSnapshot: snapshot,
    });

    expect(diag.lifecycleSnapshot?.primary).toBe("ERROR");
    expect(diag.lifecycleSnapshot?.history.lastOperation?.kind).toBe("failed");
  });
});
