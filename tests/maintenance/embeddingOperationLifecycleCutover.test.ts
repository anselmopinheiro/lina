import { describe, expect, it, vi } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import {
  type EmbeddingLifecycleSnapshot,
  resolveEmbeddingLifecycle,
} from "../../src/index/embeddingLifecycleModel";
import {
  deriveEmbeddingWritePathDecision,
} from "../../src/index/embeddingLifecycleWritePath";
import {
  EmbeddingOperationManager,
} from "../../src/index/embeddingOperationManager";
import {
  EmbeddingWorker,
  type EmbeddingWorkerGenerationResult,
  type EmbeddingWorkerOptions,
} from "../../src/maintenance/embeddingWorker";
import {
  compareOperationLifecycleDecision,
  evaluateOperationDecisionFromSnapshot,
} from "../../src/maintenance/embeddingOperationLifecycleShadow";
import { MaintenanceEngine } from "../../src/maintenance/maintenanceEngine";

function createMockSnapshot(overrides: Partial<Parameters<typeof resolveEmbeddingLifecycle>[0]> = {}): EmbeddingLifecycleSnapshot {
  const defaultIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none",
    contractId: "ollama:nomic-embed-text:768:1:none",
  };

  return resolveEmbeddingLifecycle({
    revision: 1,
    computedAt: new Date().toISOString(),
    deviceRole: "producer",
    isActiveProducer: true,
    embeddingsEnabled: true,
    upstreamTextIndex: "ready",
    canonicalExists: true,
    validForSearchCount: 100,
    activeSource: "canonical",
    publishedIdentity: defaultIdentity,
    deviceIdentity: defaultIdentity,
    workAssessment: {
      kind: "none",
      updateRequired: false,
      severity: "none",
      cost: "none",
      reasons: ["up-to-date"],
    },
    ...overrides,
  });
}

function createWorkerFixture(overrides: Partial<EmbeddingWorkerOptions> = {}) {
  const coordinator = new IndexWriteCoordinator();
  const binaryHandoff = vi.fn();
  const scheduleTextIndexFlush = vi.fn();
  const onGenerationFinalized = vi.fn();
  const statusNotify = vi.fn();

  const options: EmbeddingWorkerOptions = {
    capabilities: {
      canGenerateEmbeddings: () => resolveDeviceCapabilities({ isMobile: false }).canGenerateEmbeddings,
      canPublish: () => true,
    },
    canPublish: () => true,
    isTextIndexBusy: () => false,
    drainTextIndex: async () => true,
    scheduleTextIndexFlush,
    coordinator: {
      requestPreparation: () => coordinator.requestEmbeddingGenerationPreparation(),
      cancelPreparation: () => coordinator.cancelEmbeddingGenerationPreparation(),
      startGeneration: () => coordinator.startEmbeddingGeneration(),
      finish: (token) => coordinator.finish(token),
    },
    generationService: {
      generate: async (): Promise<EmbeddingWorkerGenerationResult> => ({
        success: true,
        message: "generated",
        publicationId: "pub-001",
      }),
    },
    persistence: { onGenerationFinalized },
    statusNotifications: { notify: statusNotify },
    binaryHandoff: { maintainAfterPublication: binaryHandoff },
    messages: {
      preparing: "preparing",
      waitingForTextIndex: "waiting",
      cancelled: "cancelled",
      blockedByTextIndex: () => "text index busy",
      generalError: "general error",
      cancelling: "cancelling",
    },
    ...overrides,
  };

  return { options, coordinator, binaryHandoff, scheduleTextIndexFlush, onGenerationFinalized, statusNotify };
}

describe("Embedding Operation Lifecycle Cutover (Phase LINA-14F.3)", () => {
  // Scenario 1: READY
  it("Scenario 1 (READY): reports action none, no op permitted, search valid", () => {
    const snapshot = createMockSnapshot({
      workAssessment: {
        kind: "none",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["up-to-date"],
      },
    });

    expect(snapshot.primary).toBe("READY");
    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.canStart).toBe(false);
    expect(decision.canCancel).toBe(false);
    expect(decision.canRetry).toBe(false);
    expect(decision.action).toBe("none");
    expect(decision.reason).toBe("no-work-pending");
  });

  // Scenario 2: UPDATE_AVAILABLE
  it("Scenario 2 (UPDATE_AVAILABLE): authorizes update while preserving existing search", async () => {
    const snapshot = createMockSnapshot({
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "low",
        cost: "local",
        reasons: ["notes-modified"],
        counts: { totalChunks: 120, toGenerate: 20, missing: 20, reusableCanonical: 100 },
      },
    });

    expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
    expect(snapshot.read.semanticAvailable).toBe(true);

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.canStart).toBe(true);
    expect(decision.action).toBe("update");
    expect(decision.requiresConfirmation).toBe(false);

    const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
    const worker = new EmbeddingWorker(fixture.options);
    const request = worker.requestGeneration("command");
    expect(request.status).toBe("accepted");
    if (request.status !== "accepted") throw new Error("Expected accepted request");
    const completion = await request.completion;
    expect(completion.result.success).toBe(true);
  });

  // Scenario 3: INDEX_ONLY
  it("Scenario 3 (INDEX_ONLY): authorizes initial generation for active producer", async () => {
    const snapshot = createMockSnapshot({
      canonicalExists: false,
      validForSearchCount: 0,
      workAssessment: {
        kind: "pending",
        updateRequired: true,
        severity: "blocking",
        cost: "local",
        reasons: ["no-published-index"],
        counts: { totalChunks: 50, toGenerate: 50, missing: 50 },
      },
    });

    expect(snapshot.primary).toBe("INDEX_ONLY");
    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.canStart).toBe(true);
    expect(decision.action).toBe("generate");

    const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
    const worker = new EmbeddingWorker(fixture.options);
    const request = worker.requestGeneration("command");
    expect(request.status).toBe("accepted");
  });

  // Scenario 4: INCOMPATIBLE
  it("Scenario 4 (INCOMPATIBLE): requires explicit rebuild confirmation, blocks unconfirmed auto-start", () => {
    const snapshot = createMockSnapshot({
      publishedIdentity: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
      deviceIdentity: { provider: "ollama", model: "bge-m3", dimensions: 1024 },
      workAssessment: {
        kind: "pending",
        updateRequired: true,
        severity: "blocking",
        cost: "local",
        reasons: ["model-mismatch"],
      },
    });

    expect(snapshot.primary).toBe("INCOMPATIBLE");
    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.action).toBe("rebuild");
    expect(decision.requiresConfirmation).toBe(true);

    const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
    const worker = new EmbeddingWorker(fixture.options);
    const request = worker.requestGeneration("automatic");
    expect(request.status).toBe("not-capable");
  });

  // Scenario 5: ERROR
  it("Scenario 5 (ERROR): authorizes controlled retry without blind immediate auto-execution", () => {
    const snapshot = createMockSnapshot({
      operationState: {
        status: "failed",
        error: "provider-connection-lost",
        processedChunks: 10,
        totalChunks: 100,
      },
      workAssessment: {
        kind: "pending",
        updateRequired: true,
        severity: "medium",
        cost: "local",
        reasons: ["retry-pending"],
      },
    });

    expect(snapshot.primary).toBe("ERROR");
    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.action).toBe("retry");
    expect(decision.canRetry).toBe(true);
    expect(decision.canStart).toBe(false);
  });

  // Scenario 6: Companion Isolation
  it("Scenario 6 (Companion): blocks execution, enforces read-only isolation", () => {
    const snapshot = createMockSnapshot({
      deviceRole: "companion",
      isActiveProducer: false,
      workAssessment: {
        kind: "pending",
        updateRequired: true,
        severity: "medium",
        cost: "local",
        reasons: ["notes-modified"],
      },
    });

    expect(snapshot.capability.blockedReason).toBe("companion");
    expect(snapshot.write.applicable).toBe(false);

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.canStart).toBe(false);
    expect(decision.action).toBe("none");

    const fixture = createWorkerFixture({
      capabilities: {
        canGenerateEmbeddings: () => false,
        canPublish: () => false,
      },
      canPublish: () => false,
      getLifecycleSnapshot: () => snapshot,
    });
    const worker = new EmbeddingWorker(fixture.options);
    const request = worker.requestGeneration("command");
    expect(request.status).toBe("not-capable");
  });

  // Scenario 7: Standby Producer
  it("Scenario 7 (Standby): blocks write execution without corrupting replica state", () => {
    const snapshot = createMockSnapshot({
      deviceRole: "producer",
      isActiveProducer: false,
      workAssessment: {
        kind: "pending",
        updateRequired: true,
        severity: "medium",
        cost: "local",
        reasons: ["notes-modified"],
      },
    });

    expect(snapshot.capability.blockedReason).toBe("standby");
    expect(snapshot.write.applicable).toBe(false);

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.canStart).toBe(false);
    expect(decision.action).toBe("none");

    const fixture = createWorkerFixture({
      capabilities: {
        canGenerateEmbeddings: () => true,
        canPublish: () => false,
      },
      canPublish: () => false,
      getLifecycleSnapshot: () => snapshot,
    });
    const worker = new EmbeddingWorker(fixture.options);
    const request = worker.requestGeneration("command");
    expect(request.status).toBe("not-active-producer");
  });

  // Scenario 8: INDETERMINATE
  it("Scenario 8 (INDETERMINATE): blocks automatic execution on corrupted/indeterminate state", () => {
    const snapshot = createMockSnapshot({
      workAssessment: {
        kind: "indeterminate",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["canonical-unreadable"],
      },
    });

    expect(snapshot.primary).toBe("INDETERMINATE");
    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.canStart).toBe(false);
    expect(decision.action).toBe("none");
    expect(decision.reason).toBe("indeterminate-state-blocked");

    const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
    const worker = new EmbeddingWorker(fixture.options);
    const request = worker.requestGeneration("command");
    expect(request.status).toBe("not-capable");
  });

  // Scenario 9: Geração em Curso / Single-Flight
  it("Scenario 9 (Geração em curso): enforces single-flight and rejects reentrant requests", async () => {
    let unblockGeneration: () => void;
    const generationPromise = new Promise<EmbeddingWorkerGenerationResult>((resolve) => {
      unblockGeneration = () => resolve({ success: true, message: "done" });
    });

    const fixture = createWorkerFixture({
      generationService: {
        generate: async () => await generationPromise,
      },
    });
    const worker = new EmbeddingWorker(fixture.options);

    const first = worker.requestGeneration("command");
    expect(first.status).toBe("accepted");

    const second = worker.requestGeneration("command");
    expect(second.status).toBe("already-running");

    unblockGeneration!();
    if (first.status !== "accepted") throw new Error("Expected accepted request");
    await first.completion;
  });

  // Scenario 10: Cancelamento
  it("Scenario 10 (Cancelamento): allows cancel during generation and handles safe completion", async () => {
    const manager = new EmbeddingOperationManager();

    let markGenerating: () => void;
    const holdGenerating = new Promise<void>((resolve) => { markGenerating = resolve; });
    const cancellableRequest = manager.request("command", async (ctx) => {
      ctx.setPhase("generating", "Generating embeddings");
      markGenerating();
      return await new Promise<EmbeddingWorkerGenerationResult>((resolve) => {
        ctx.signal.addEventListener("abort", () => {
          resolve({ success: false, message: "cancelled", cancelled: true });
        });
      });
    });

    await holdGenerating!;
    expect(manager.getState().status).toBe("running");
    expect(manager.getState().phase).toBe("generating");
    expect(manager.cancelActiveOperation()).toBe("cancel-requested");
    expect(manager.cancelActiveOperation()).toBe("already-cancelling");

    const cancellableCompletion = await cancellableRequest.completion;
    expect(cancellableCompletion.result.cancelled).toBe(true);
    expect(manager.getState().status).toBe("cancelled");
  });

  // Scenario 11: Retry
  it("Scenario 11 (Retry): allows authorized retry after operation failure", async () => {
    let shouldFail = true;
    const fixture = createWorkerFixture({
      generationService: {
        generate: async () => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error("provider-timeout");
          }
          return { success: true, message: "retry-succeeded" };
        },
      },
    });
    const worker = new EmbeddingWorker(fixture.options);

    const first = worker.requestGeneration("command");
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("Expected accepted request");
    const firstCompletion = await first.completion;
    expect(firstCompletion.result.success).toBe(false);
    expect(firstCompletion.result.message).toBe("provider-timeout");

    expect(worker.getState().status).toBe("error");
    expect(worker.getOperationState().status).toBe("failed");

    // Retry request after failure is accepted
    const retry = worker.requestGeneration("command");
    expect(retry.status).toBe("accepted");
    if (retry.status !== "accepted") throw new Error("Expected accepted retry request");
    const retryCompletion = await retry.completion;
    expect(retryCompletion.result.success).toBe(true);
    expect(worker.getState().status).toBe("idle");
  });

  // Scenario 12: Perda de Ownership
  it("Scenario 12 (Perda de ownership): flags ownershipLostDuringOperation when write authority is revoked", () => {
    const snapshot = createMockSnapshot({
      deviceRole: "producer",
      isActiveProducer: false, // lost authority
      operationState: {
        status: "running",
        phase: "generating",
        processedChunks: 50,
        totalChunks: 100,
      },
    });

    const writeDecision = deriveEmbeddingWritePathDecision(snapshot);
    expect(writeDecision.ownershipLostDuringOperation).toBe(true);

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.ownershipLostDuringOperation).toBe(true);
    expect(decision.canStart).toBe(false);
    expect(decision.reason).toBe("ownership-lost-during-operation");
  });

  // Scenario 13: Divergência Legado / Canónico
  it("Scenario 13 (Divergência legado/canónico): confirms shadow parity and zero real divergences", () => {
    const legacyInputs = {
      canGenerateEmbeddings: true,
      canPublish: true,
      isTextIndexBusy: false,
      deviceRole: "producer" as const,
      hasPendingWork: true,
    };
    const snapshot = createMockSnapshot({
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "low",
        cost: "local",
        reasons: ["notes-modified"],
        counts: { totalChunks: 100, toGenerate: 10, missing: 10, reusableCanonical: 90 },
      },
    });

    const comparison = compareOperationLifecycleDecision(legacyInputs, snapshot);
    expect(comparison.hasRealDivergence).toBe(false);
    expect(comparison.legacyDecision.canStart).toBe(true);
    expect(comparison.canonicalDecision.canStart).toBe(true);
  });

  // MaintenanceEngine integration
  it("integrates seamlessly with MaintenanceEngine", async () => {
    const fixture = createWorkerFixture();
    const worker = new EmbeddingWorker(fixture.options);
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      embeddingWorker: worker,
    });

    engine.start();
    expect(engine.isStarted()).toBe(true);
    const req = engine.requestEmbeddingGeneration("command");
    expect(req.status).toBe("accepted");
    if (req.status !== "accepted") throw new Error("Expected accepted request");
    const completion = await req.completion;
    expect(completion.result.success).toBe(true);
  });
});
