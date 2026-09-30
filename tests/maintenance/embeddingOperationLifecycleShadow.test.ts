import { describe, expect, it } from "vitest";
import {
  evaluateOperationDecisionFromSnapshot,
  type EmbeddingOperationEligibilityDecision,
} from "../../src/maintenance/embeddingWorker";
import { resolveEmbeddingLifecycle } from "../../src/index/embeddingLifecycleModel";

describe("Worker and Operation Manager Lifecycle Decision Evaluation", () => {
  const baseIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none" as const,
  };

  const baseProducerInput = {
    revision: 1,
    deviceRole: "producer" as const,
    isActiveProducer: true,
    embeddingsEnabled: true,
    upstreamTextIndex: "ready" as const,
    publishedIdentity: baseIdentity,
    deviceIdentity: baseIdentity,
    targetIdentity: baseIdentity,
    canonicalExists: true,
    validForSearchCount: 10,
    activeSource: "jsonl" as const,
  };

  it("1. Scenario READY sem trabalho: canStart = false, canCancel = false, action = none", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      workAssessment: {
        kind: "none",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["up-to-date"],
      },
    });

    expect(snapshot.primary).toBe("READY");

    const decision: EmbeddingOperationEligibilityDecision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: false,
      canCancel: false,
      canRetry: false,
      action: "none",
      requiresConfirmation: false,
      ownershipLostDuringOperation: false,
      reason: "no-work-pending",
    });
  });

  it("2. Scenario UPDATE_AVAILABLE: canStart = true, action = update", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["chunks-need-generation"],
      },
    });

    expect(snapshot.primary).toBe("UPDATE_AVAILABLE");

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: true,
      canCancel: false,
      canRetry: false,
      action: "update",
      requiresConfirmation: false,
      reason: "authorized-update",
    });
  });

  it("3. Scenario INDEX_ONLY: canStart = true, action = generate", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      canonicalExists: false,
      validForSearchCount: 0,
      workAssessment: {
        kind: "pending",
        mode: "initial-build",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["canonical-missing-or-empty"],
      },
    });

    expect(snapshot.primary).toBe("INDEX_ONLY");

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: true,
      canCancel: false,
      action: "generate",
      reason: "authorized-generate",
    });
  });

  it("4. Scenario INCOMPATIBLE: canStart = true (com ação rebuild e confirmação obrigatória)", () => {
    const targetIdentity = {
      provider: "ollama",
      model: "mxbai-embed-large",
      dimensions: 1024,
      inputVersion: 1,
      prefixMode: "none" as const,
    };

    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      deviceIdentity: targetIdentity,
      targetIdentity,
      workAssessment: {
        kind: "pending",
        mode: "full-rebuild",
        updateRequired: true,
        severity: "blocking",
        cost: "local",
        reasons: ["model-mismatch"],
      },
    });

    expect(snapshot.primary).toBe("INCOMPATIBLE");

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: true,
      canCancel: false,
      action: "rebuild",
      requiresConfirmation: true,
      reason: "incompatible-rebuild-required",
    });
  });


  it("5. Scenario ERROR: canStart = false, action = retry, canRetry = true", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "failed",
        error: "Ollama connection timeout",
      },
      history: {
        lastFailure: { category: "timeout", message: "Ollama connection timeout" },
      },
    });

    expect(snapshot.primary).toBe("ERROR");

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: false,
      canCancel: false,
      canRetry: true,
      action: "retry",
      reason: "error-retry-authorized",
    });
  });

  it("6. Scenario Companion: strictly blocks operation start and cancel", () => {
    const companionSnapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      deviceRole: "companion",
      isActiveProducer: false,
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["chunks-need-generation"],
      },
    });

    const decision = evaluateOperationDecisionFromSnapshot(companionSnapshot);
    expect(decision).toMatchObject({
      canStart: false,
      canCancel: false,
      canRetry: false,
      action: "none",
      reason: "blocked-companion",
    });
  });

  it("7. Scenario Standby: blocks operation start for standby producer", () => {
    const standbySnapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      deviceRole: "producer",
      isActiveProducer: false,
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["chunks-need-generation"],
      },
    });

    expect(standbySnapshot.primary).toBe("STANDBY");

    const decision = evaluateOperationDecisionFromSnapshot(standbySnapshot);
    expect(decision).toMatchObject({
      canStart: false,
      canCancel: false,
      action: "none",
      reason: "blocked-standby",
    });
  });

  it("8. Scenario INDETERMINATE: blocks starting operations and prevents corruption", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      workAssessment: {
        kind: "indeterminate",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["unreadable-manifest"],
      },
    });

    expect(snapshot.primary).toBe("INDETERMINATE");

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: false,
      canCancel: false,
      action: "none",
      reason: "indeterminate-state-blocked",
    });
  });

  it("9. Scenario Geração em curso (UPDATING): canStart = false, canCancel = true during cancellable phase", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "running",
        phase: "generating",
        totalChunks: 100,
        processedChunks: 45,
        generatedChunks: 45,
        failedChunks: 0,
        reusedChunks: 0,
      },
    });

    expect(snapshot.primary).toBe("UPDATING");
    expect(snapshot.process.cancellable).toBe(true);

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: false,
      canCancel: true,
      action: "cancel",
      phase: "generating",
      reason: "operation-active-cancellable",
    });
  });

  it("10. Scenario Cancelamento (CANCELLING): canStart = false, canCancel = false, action = none", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "cancelling",
        phase: "cancelled",
        totalChunks: 100,
        processedChunks: 50,
        generatedChunks: 50,
        failedChunks: 0,
        reusedChunks: 0,
      },
    });

    expect(snapshot.primary).toBe("CANCELLING");

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision).toMatchObject({
      canStart: false,
      canCancel: false,
      action: "none",
      phase: "cancelling",
    });
  });

  it("11. Scenario Retry: canRetry = true is preserved on ERROR when authorized", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "failed",
        error: "Rate limit exceeded",
      },
      history: {
        lastFailure: { category: "rate-limit", message: "Rate limit exceeded" },
      },
    });

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.canRetry).toBe(true);
    expect(decision.action).toBe("retry");
  });

  it("12. Scenario Perda de Ownership durante operação: ownershipLostDuringOperation = true", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      deviceRole: "companion",
      isActiveProducer: false,
      operationState: {
        status: "running",
        phase: "generating",
        totalChunks: 100,
        processedChunks: 30,
        generatedChunks: 30,
        failedChunks: 0,
        reusedChunks: 0,
      },
    });

    expect(snapshot.primary).toBe("UPDATING");

    const decision = evaluateOperationDecisionFromSnapshot(snapshot);
    expect(decision.ownershipLostDuringOperation).toBe(true);
    expect(decision.canStart).toBe(false);
    expect(decision.reason).toBe("ownership-lost-during-operation");
  });

  it("13. Scenario Persisting: protects atomic persistence by blocking cancellation", () => {
    // Canonical protects atomic persistence during persisting phase
    const persistingSnapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "running",
        phase: "persisting",
        totalChunks: 100,
        processedChunks: 100,
        generatedChunks: 100,
        failedChunks: 0,
        reusedChunks: 0,
      },
    });

    expect(persistingSnapshot.process.cancellable).toBe(false);
    expect(persistingSnapshot.process.phase).toBe("persisting");

    const decision = evaluateOperationDecisionFromSnapshot(persistingSnapshot);
    expect(decision.canCancel).toBe(false);
    expect(decision.canStart).toBe(false);
    expect(decision.phase).toBe("persisting");
  });
});
