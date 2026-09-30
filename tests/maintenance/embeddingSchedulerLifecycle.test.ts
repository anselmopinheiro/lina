import { describe, expect, it } from "vitest";
import {
  evaluateLegacySchedulerDecision,
  evaluateSchedulerDecisionFromSnapshot,
  compareSchedulerDecision,
} from "../../src/maintenance/embeddingScheduler";
import { resolveEmbeddingLifecycle } from "../../src/index/embeddingLifecycleModel";

describe("LINA-14D.2-C: Embedding Scheduler Lifecycle Shadow Migration", () => {
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

  it("1. Scenario sem trabalho (READY): scheduler does not schedule or dispatch work", () => {
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

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: true,
      canDispatch: false,
      hasWork: false,
      action: "none",
      requiresConfirmation: false,
      reason: "no-work",
    });

    const comparison = compareSchedulerDecision(
      {
        canGenerateEmbeddings: true,
        isAuthorizedProducer: true,
        deviceRole: "producer",
        policy: "automatic-local-only",
        isLocalProvider: true,
        hasExternalCost: false,
        hasPendingWork: false,
      },
      snapshot,
      "automatic-local-only"
    );

    expect(comparison.matches).toBe(true);
    expect(comparison.hasRealDivergence).toBe(false);
  });

  it("2. Scenario UPDATE_AVAILABLE: recognizes pending work compatible with update", () => {
    // 2A: Local provider with automatic policy -> approved for dispatch
    const localSnapshot = resolveEmbeddingLifecycle({
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

    expect(localSnapshot.primary).toBe("UPDATE_AVAILABLE");

    const localAuto = evaluateSchedulerDecisionFromSnapshot(localSnapshot, "automatic-local-only");
    expect(localAuto).toMatchObject({
      shouldSchedule: true,
      canDispatch: true,
      hasWork: true,
      action: "update",
      requiresConfirmation: false,
      reason: "auto-dispatch-approved",
    });

    // 2B: Local provider with manual policy -> dispatch blocked, requires confirmation
    const localManual = evaluateSchedulerDecisionFromSnapshot(localSnapshot, "manual");
    expect(localManual).toMatchObject({
      shouldSchedule: true,
      canDispatch: false,
      hasWork: true,
      action: "update",
      requiresConfirmation: true,
      reason: "manual-confirmation-required",
    });

    // 2C: External provider with automatic policy -> dispatch blocked, requires confirmation
    const externalSnapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      publishedIdentity: { ...baseIdentity, provider: "mistral", model: "mistral-embed" },
      deviceIdentity: { ...baseIdentity, provider: "mistral", model: "mistral-embed" },
      targetIdentity: { ...baseIdentity, provider: "mistral", model: "mistral-embed" },
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "external",
        reasons: ["chunks-need-generation"],
      },
    });

    const externalAuto = evaluateSchedulerDecisionFromSnapshot(externalSnapshot, "automatic-local-only");
    expect(externalAuto).toMatchObject({
      shouldSchedule: true,
      canDispatch: false,
      hasWork: true,
      action: "update",
      requiresConfirmation: true,
      reason: "external-provider-blocked",
    });
  });

  it("3. Scenario INDEX_ONLY: recognizes initial build need", () => {
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

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: true,
      canDispatch: true,
      hasWork: true,
      action: "generate",
      requiresConfirmation: false,
    });
  });

  it("4. Scenario INCOMPATIBLE: does not execute automatically, requires rebuild with confirmation", () => {
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

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: true,
      canDispatch: false,
      hasWork: true,
      action: "rebuild",
      requiresConfirmation: true,
      reason: "incompatible-rebuild-required",
    });
  });

  it("5. Scenario ERROR: failure state recommends retry and blocks automatic dispatch", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "failed",
        error: "Connection refused",
      },
      history: {
        lastFailure: { category: "network-error", message: "Connection refused" },
      },
    });

    expect(snapshot.primary).toBe("ERROR");

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: true,
      canDispatch: false,
      action: "retry",
      requiresConfirmation: true,
      reason: "error-retry-required",
    });
  });

  it("6. Scenario Companion: never schedules nor executes locally", () => {
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

    const decision = evaluateSchedulerDecisionFromSnapshot(companionSnapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: false,
      canDispatch: false,
      hasWork: false,
      action: "none",
      requiresConfirmation: false,
      reason: "blocked-companion",
    });
  });

  it("7. Scenario Standby: never executes on standby device", () => {
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

    const decision = evaluateSchedulerDecisionFromSnapshot(standbySnapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: false,
      canDispatch: false,
      hasWork: false,
      action: "none",
      requiresConfirmation: false,
      reason: "blocked-standby",
    });
  });

  it("8. Scenario INDETERMINATE: blocks automatic execution without silent idle fallback", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      workAssessment: {
        kind: "indeterminate",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["corrupted-metadata"],
      },
    });

    expect(snapshot.primary).toBe("INDETERMINATE");

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: false,
      canDispatch: false,
      hasWork: false,
      action: "none",
      reason: "indeterminate-state-blocked",
    });
  });

  it("9. Scenario Perda de Ownership: blocks scheduling and dispatch upon authority revocation", () => {
    const lostSnapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      deviceRole: "unassigned",
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

    const decision = evaluateSchedulerDecisionFromSnapshot(lostSnapshot, "automatic-local-only");
    expect(decision).toMatchObject({
      shouldSchedule: false,
      canDispatch: false,
      hasWork: false,
      action: "none",
      reason: "blocked-unassigned",
    });
  });

  it("10. Scenario Divergência Scheduler Legado vs Decisão Canónica: classifies differences accurately", () => {
    // Test difference classification when legacy might lack strict INCOMPATIBLE rebuild check
    const targetIdentity = {
      provider: "ollama",
      model: "mxbai-embed-large",
      dimensions: 1024,
      inputVersion: 1,
      prefixMode: "none" as const,
    };

    const incompatibleSnapshot = resolveEmbeddingLifecycle({
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

    // Legacy inputs assume hasPendingWork = true, local provider Ollama -> legacy would say canDispatch = true
    const comparison = compareSchedulerDecision(
      {
        canGenerateEmbeddings: true,
        isAuthorizedProducer: true,
        deviceRole: "producer",
        policy: "automatic-local-only",
        isLocalProvider: true,
        hasExternalCost: false,
        hasPendingWork: true,
      },
      incompatibleSnapshot,
      "automatic-local-only"
    );

    expect(comparison.matches).toBe(false);
    expect(comparison.legacyDecision.canDispatch).toBe(true);
    expect(comparison.canonicalDecision.canDispatch).toBe(false);
    expect(comparison.canonicalDecision.action).toBe("rebuild");

    // The dispatch difference is categorized as expected because canonical enforces rebuild protection
    const dispatchDiff = comparison.differences.find((d) => d.property === "canDispatch");
    expect(dispatchDiff).toBeDefined();
    expect(dispatchDiff?.category).toBe("expected");
    expect(comparison.hasRealDivergence).toBe(false);
  });
});
