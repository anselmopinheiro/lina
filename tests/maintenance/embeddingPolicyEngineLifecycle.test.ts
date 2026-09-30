import { describe, expect, it } from "vitest";
import {
  evaluateEmbeddingUpdatePolicy,
  evaluateEmbeddingUpdatePolicyFromSnapshot,
  EmbeddingPolicyDecision,
} from "../../src/maintenance/embeddingPolicyEngine";
import { getEmbeddingProviderCapability } from "../../src/ai/providerCapabilities";
import { resolveEmbeddingLifecycle } from "../../src/index/embeddingLifecycleModel";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";

describe("LINA-14D.2-B: Embedding Policy Engine Lifecycle & Write Path Migration", () => {
  const ollama = getEmbeddingProviderCapability("ollama");
  const mistral = getEmbeddingProviderCapability("mistral");
  const openrouter = getEmbeddingProviderCapability("openrouter");

  const baseIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none",
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

  it("1. Scenario READY: no pending work, allowed: false, requiresConfirmation: false, action: none", () => {
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

    const decisionAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
    expect(decisionAuto).toMatchObject({
      allowed: false,
      requiresConfirmation: false,
      reason: "no-update-required",
      action: "none",
    });

    const decisionManual = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "manual");
    expect(decisionManual).toMatchObject({
      allowed: false,
      requiresConfirmation: false,
      reason: "no-update-required",
      action: "none",
    });
  });

  it("2. Scenario UPDATE_AVAILABLE: local auto-approved vs external confirmation-required", () => {
    // Local provider (Ollama)
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

    const localAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(localSnapshot, "automatic-local-only");
    expect(localAuto).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      reason: "local-provider-auto-approved",
      action: "update",
    });

    const localManual = evaluateEmbeddingUpdatePolicyFromSnapshot(localSnapshot, "manual");
    expect(localManual).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reason: "manual-confirmation-required",
      action: "update",
    });

    // External provider (Mistral)
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

    const externalAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(externalSnapshot, "automatic-local-only");
    expect(externalAuto).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reason: "external-provider-blocked",
      action: "update",
    });
  });

  it("3. Scenario INDEX_ONLY: missing embeddings derives generate action", () => {
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

    const decisionAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
    expect(decisionAuto).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
      reason: "local-provider-auto-approved",
      action: "generate",
    });

    const decisionManual = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "manual");
    expect(decisionManual).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reason: "manual-confirmation-required",
      action: "generate",
    });
  });

  it("4. Scenario INCOMPATIBLE: full rebuild required with explicit confirmation", () => {
    const targetIdentity = {
      provider: "ollama",
      model: "mxbai-embed-large",
      dimensions: 1024,
      inputVersion: 1,
      prefixMode: "none",
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

    const decisionAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
    expect(decisionAuto).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reason: "rebuild-confirmation-required",
      action: "rebuild",
    });

    const decisionManual = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "manual");
    expect(decisionManual).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reason: "manual-confirmation-required",
      action: "rebuild",
    });
  });

  it("5. Scenario ERROR: failure state recommends retry with confirmation", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "failed",
        error: "Provider connection timeout",
      },
      history: {
        lastFailure: { category: "connection-timeout", message: "Provider connection timeout" },
      },
    });

    expect(snapshot.primary).toBe("ERROR");

    const decisionManual = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "manual");
    expect(decisionManual).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reason: "manual-confirmation-required",
      action: "retry",
    });
  });

  it("6. Scenario Companion: strictly blocks execution, allowed: false, action: none", () => {
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

    const decisionAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(companionSnapshot, "automatic-local-only");
    expect(decisionAuto).toMatchObject({
      allowed: false,
      requiresConfirmation: false,
      reason: "companion-device-not-allowed",
      action: "none",
    });

    const decisionManual = evaluateEmbeddingUpdatePolicyFromSnapshot(companionSnapshot, "manual");
    expect(decisionManual).toMatchObject({
      allowed: false,
      requiresConfirmation: false,
      reason: "companion-device-not-allowed",
      action: "none",
    });
  });

  it("7. Scenario Standby: blocks execution for standby producer, allowed: false, action: none", () => {
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

    const decisionAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(standbySnapshot, "automatic-local-only");
    expect(decisionAuto).toMatchObject({
      allowed: false,
      requiresConfirmation: false,
      reason: "standby-device-not-allowed",
      action: "none",
    });
  });

  it("8. Scenario INDETERMINATE: blocks automatic execution and preserves reason", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      workAssessment: {
        kind: "indeterminate",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["canonical-unreadable"],
      },
    });

    expect(snapshot.primary).toBe("INDETERMINATE");

    const decisionAuto = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
    expect(decisionAuto).toMatchObject({
      allowed: false,
      requiresConfirmation: false,
      reason: "indeterminate-state-blocked",
      action: "none",
    });
  });

  it("9. Scenario Rebuild with Confirmation: full-rebuild requires confirmation under any policy", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      workAssessment: {
        kind: "pending",
        mode: "full-rebuild",
        updateRequired: true,
        severity: "blocking",
        cost: "local",
        reasons: ["dimension-changed"],
      },
    });

    const decision = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.action).toBe("rebuild");
    expect(decision.reason).toBe("rebuild-confirmation-required");
  });

  it("10. Scenario Retry after Failure: canRetry is enabled when authorized", () => {
    const snapshot = resolveEmbeddingLifecycle({
      ...baseProducerInput,
      operationState: {
        status: "failed",
        error: "Rate limit exceeded",
      },
      history: {
        lastFailure: { category: "rate-limited", message: "Rate limit exceeded" },
      },
    });

    const decision = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "manual");
    expect(decision.action).toBe("retry");
    expect(decision.decision?.canRetry).toBe(true);
  });

  it("11. Snapshot Evaluation: evaluateEmbeddingUpdatePolicyFromSnapshot approves automatic update for local provider", () => {
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

    const decision = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.action).toBe("update");
  });
});
