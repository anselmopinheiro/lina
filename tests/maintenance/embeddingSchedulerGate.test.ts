import { describe, expect, it } from "vitest";
import {
  evaluateSchedulerDecisionFromSnapshot,
} from "../../src/maintenance/embeddingScheduler";
import { resolveEmbeddingLifecycle } from "../../src/index/embeddingLifecycleModel";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import type { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";

describe("LINA-14F.4-B4.0-A: Scheduler Gate Characterization Tests (F01)", () => {
  const localIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none" as const,
  };

  const externalIdentity = {
    provider: "mistral",
    model: "mistral-embed",
    dimensions: 1024,
    inputVersion: 1,
    prefixMode: "none" as const,
  };

  const baseProducerRuntime: DeviceRuntimeState = {
    deviceId: "producer-device-1",
    effectiveRole: "producer",
    isActiveProducer: true,
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
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
  };

  it("F01.1: Blocks automatic dispatch when effective provider is external (Mistral), even if policy is automatic", () => {
    // When effective provider is Mistral, cost is external and requires confirmation
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: baseProducerRuntime,
      publishedIdentity: externalIdentity,
      targetIdentity: externalIdentity,
      isExternalProvider: true,
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "external",
        reasons: ["chunks-need-generation"],
      },
    });

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");

    expect(decision.shouldSchedule).toBe(true);
    expect(decision.canDispatch).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toBe("external-provider-blocked");
  });

  it("F01.2: Blocks automatic dispatch when full rebuild is required, even on local Ollama provider", () => {
    const newLocalIdentity = {
      ...localIdentity,
      model: "bge-m3",
      dimensions: 1024,
    };

    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: baseProducerRuntime,
      publishedIdentity: localIdentity,
      targetIdentity: newLocalIdentity,
      isExternalProvider: false,
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      workAssessment: {
        kind: "pending",
        mode: "full-rebuild",
        updateRequired: true,
        severity: "blocking",
        cost: "local",
        reasons: ["model-mismatch"],
      },
    });

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");

    expect(decision.shouldSchedule).toBe(true);
    expect(decision.canDispatch).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toBe("incompatible-rebuild-required");
  });

  it("F01.3: Allows automatic dispatch ONLY for local provider with incremental/initial work under automatic policy", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: baseProducerRuntime,
      publishedIdentity: localIdentity,
      targetIdentity: localIdentity,
      isExternalProvider: false,
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["chunks-need-generation"],
      },
    });

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");

    expect(decision.shouldSchedule).toBe(true);
    expect(decision.canDispatch).toBe(true);
    expect(decision.hasWork).toBe(true);
    expect(decision.action).toBe("update");
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toBe("auto-dispatch-approved");
  });

  it("F01.4: Blocks automatic dispatch when policy is manual, even for local Ollama with incremental work", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: baseProducerRuntime,
      publishedIdentity: localIdentity,
      targetIdentity: localIdentity,
      isExternalProvider: false,
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
      workAssessment: {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: "local",
        reasons: ["chunks-need-generation"],
      },
    });

    const decision = evaluateSchedulerDecisionFromSnapshot(snapshot, "manual");

    expect(decision.shouldSchedule).toBe(true);
    expect(decision.canDispatch).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toBe("manual-confirmation-required");
  });

  it("F01.5: Blocks scheduling and dispatch on Companion or Standby devices", () => {
    const companionRuntime: DeviceRuntimeState = {
      ...baseProducerRuntime,
      effectiveRole: "companion",
      isCompanion: true,
      isActiveProducer: false,
      canPublish: false,
    };

    const companionSnapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: companionRuntime,
      publishedIdentity: localIdentity,
      targetIdentity: localIdentity,
      isExternalProvider: false,
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 100,
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

    expect(decision.shouldSchedule).toBe(false);
    expect(decision.canDispatch).toBe(false);
    expect(decision.reason).toBe("blocked-companion");
  });
});
