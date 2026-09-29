import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { ProducerStateV1, createProducerState } from "../../src/device/producerState";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import { validateLifecycleInvariants } from "../../src/index/embeddingLifecycleModel";
import {
  EmbeddingWritePathShadowInputs,
  createEmbeddingWritePathShadowComparison,
  deriveEmbeddingWritePathDecision,
  summarizeLegacyWritePath,
} from "../../src/index/embeddingLifecycleWritePath";
import { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import { EmbeddingUpdatePlan, EmbeddingUpdatePlanPreview } from "../../src/index/embeddingUpdatePlan";
import { EmbeddingWorkRuntimeState, EmbeddingWorkSummary } from "../../src/index/embeddingWorkStatusController";
import { resolveEmbeddingWorkflowState } from "../../src/index/embeddingWorkflowState";
import { VectorContractV1 } from "../../src/index/vectorContract";
import { EmbeddingPolicyDecision } from "../../src/maintenance/embeddingPolicyEngine";
import { FakeAdapter } from "../helpers/fakeAdapter";

const contract: VectorContractV1 = {
  schemaVersion: 1,
  provider: "ollama",
  model: "nomic-embed-text",
  dimensions: 768,
  metric: "cosine",
  prefixMode: "nomic-search-query-document",
  inputVersion: 1,
  contractId: "vec:ollama:nomic-embed-text:768:1:nomic-search-query-document",
};

const targetIdentity = {
  provider: "ollama",
  model: "nomic-embed-text",
  inputVersion: 1,
  prefixMode: "nomic-search-query-document" as const,
  dimensions: 768,
};

function makePlan(overrides: Partial<EmbeddingUpdatePlanPreview> = {}): EmbeddingUpdatePlanPreview {
  return {
    mode: "incremental",
    targetIdentity,
    totalChunks: 105,
    reusableCanonicalCount: 100,
    recoverableCheckpointCount: 0,
    toGenerateCount: 5,
    staleToReplaceCount: 3,
    missingCount: 2,
    obsoleteToDropCount: 0,
    requiresPublication: false,
    reasons: ["stale-chunks", "missing-chunks"],
    ...overrides,
  };
}

function makeSummary(plan: EmbeddingUpdatePlanPreview): EmbeddingWorkSummary {
  return {
    totalChunks: plan.totalChunks,
    totalCanonicalRecords: plan.reusableCanonicalCount,
    validCount: plan.reusableCanonicalCount,
    missingCount: plan.missingCount,
    staleCount: plan.staleToReplaceCount,
    obsoleteCount: plan.obsoleteToDropCount,
    validForSearchCount: plan.reusableCanonicalCount,
    reusableForNextGenerationCount: plan.reusableCanonicalCount,
    recoverableCheckpointCount: plan.recoverableCheckpointCount,
    operationActive: false,
    duplicateRecordCount: 0,
    invalidRecordCount: 0,
    detailsAvailable: true,
    updatePlan: plan,
  };
}

function makeWorkState(
  plan: EmbeddingUpdatePlanPreview,
  overrides: Partial<EmbeddingWorkRuntimeState> = {}
): EmbeddingWorkRuntimeState {
  return {
    status: "ready",
    revision: 1,
    workAvailable: true,
    summary: makeSummary(plan),
    ...overrides,
  };
}

function makeOperation(overrides: Partial<EmbeddingOperationState> = {}): EmbeddingOperationState {
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
    ...overrides,
  };
}

function makeRuntime(
  overrides: Partial<DeviceRuntimeState> = {},
  embeddings: Partial<DeviceRuntimeState["embeddings"]> = {}
): DeviceRuntimeState {
  return {
    deviceId: "device-1",
    deviceName: "Primary",
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
      ...embeddings,
    },
    ...overrides,
  };
}

function shadow(overrides: Partial<EmbeddingWritePathShadowInputs> = {}) {
  const runtime = overrides.deviceRuntimeState ?? makeRuntime();
  const workState = overrides.workState ?? makeWorkState(makePlan());
  const operationState = overrides.operationState ?? makeOperation();
  const workflowState = overrides.workflowState ?? resolveEmbeddingWorkflowState({
    workState,
    operationState,
    isAuthorizedProducer: runtime.isActiveProducer,
    textIndexReady: true,
  });
  return createEmbeddingWritePathShadowComparison({
    revision: 1,
    computedAt: 1,
    deviceRuntimeState: runtime,
    workState,
    operationState,
    workflowState,
    vectorContract: contract,
    upstreamTextIndex: "ready",
    canonicalExists: true,
    validForSearchCount: 100,
    ...overrides,
  });
}

function divergences(result: ReturnType<typeof shadow>) {
  return result.differences.filter((difference) => difference.severity === "divergence");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe("LINA-14D-1: Embedding Write Path shadow layer", () => {
  describe("1. Producer with a pending update (UPDATE_AVAILABLE)", () => {
    it("derives action=update, keeps semantic search available and matches every legacy decision", () => {
      const result = shadow();

      expect(result.snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(result.snapshot.read.semanticAvailable).toBe(true);
      expect(result.decision.updateRequired).toBe(true);
      expect(result.decision.action).toBe("update");
      expect(result.decision.workMode).toBe("incremental");
      expect(result.decision.severity).toBe("action");
      expect(result.decision.canExecute).toBe(true);
      expect(result.decision.requiresConfirmation).toBe(false);

      expect(result.legacy.controllerWorkAvailable).toBe(true);
      expect(result.legacy.policyPending).toBe(true);
      expect(result.legacy.schedulerPending).toBe(true);
      expect(result.legacy.sidebarButtonVisible).toBe(true);
      expect(result.differences).toEqual([]);
      expect(result.consistent).toBe(true);
    });

    it("requires confirmation when the provider has an external cost", () => {
      const result = shadow({ isExternalProvider: true });
      expect(result.decision.action).toBe("update");
      expect(result.decision.cost).toBe("external");
      expect(result.decision.requiresConfirmation).toBe(true);
    });

    it("reports the legacy manual policy confirmation as informational only", () => {
      const policyDecision: EmbeddingPolicyDecision = {
        allowed: false,
        requiresConfirmation: true,
        reason: "manual-confirmation-required",
      };
      const result = shadow({ policyDecision });
      const confirmation = result.differences.filter((difference) => difference.area === "confirmation");
      expect(confirmation).toHaveLength(1);
      expect(confirmation[0]?.severity).toBe("info");
      expect(result.consistent).toBe(true);
    });
  });

  describe("2. Companion with valid artifacts", () => {
    it("never offers an action, never executes and only reports informational isolation", () => {
      const runtime = makeRuntime({
        effectiveRole: "companion",
        isCompanion: true,
        isActiveProducer: false,
        canPublish: false,
        transferEligibilityReason: "companion-role",
      });
      const result = shadow({ deviceRuntimeState: runtime });

      expect(result.snapshot.primary).toBe("READY");
      expect(result.snapshot.read.semanticAvailable).toBe(true);
      expect(result.decision.applicable).toBe(false);
      expect(result.decision.action).toBe("none");
      expect(result.decision.canExecute).toBe(false);
      expect(result.decision.blockedReason).toBe("companion");
      expect(result.decision.updateRequired).toBe(false);
      expect(result.legacy.controllerWorkAvailable).toBe(true);
      expect(result.consistent).toBe(true);
      expect(result.differences.length).toBeGreaterThan(0);
      expect(result.differences.every((difference) => difference.severity === "info")).toBe(true);
    });
  });

  describe("3. Generation in progress (UPDATING)", () => {
    const running = (phase: EmbeddingOperationState["phase"], processed = 40) =>
      makeOperation({
        status: "running",
        phase,
        origin: "sidebar",
        totalChunks: 100,
        processedChunks: processed,
        generatedChunks: processed - 10,
        reusedChunks: 10,
        failedChunks: 0,
      });

    it("preserves phase, progress and cancellability and offers only cancel", () => {
      const result = shadow({ operationState: running("generating") });

      expect(result.snapshot.primary).toBe("UPDATING");
      expect(result.decision.process.phase).toBe("generating");
      expect(result.decision.process.progress).toEqual({ processed: 40, total: 100, reused: 10, failed: 0 });
      expect(result.decision.process.cancellable).toBe(true);
      expect(result.decision.process.origin).toBe("sidebar");
      expect(result.decision.action).toBe("cancel");
      expect(result.decision.canExecute).toBe(false);
      expect(result.decision.blockedReason).toBe("operation-active");
      expect(result.decision.ownershipLostDuringOperation).toBe(false);
      expect(result.legacy.sidebarButtonVisible).toBe(false);
      expect(result.consistent).toBe(true);
    });

    it("keeps preparation cancellable and persisting past the point of no return", () => {
      const preparing = shadow({ operationState: running("validating", 0) });
      expect(preparing.decision.process.phase).toBe("preparing");
      expect(preparing.decision.process.cancellable).toBe(true);
      expect(preparing.decision.action).toBe("cancel");

      const persisting = shadow({ operationState: running("persisting", 100) });
      expect(persisting.decision.process.phase).toBe("persisting");
      expect(persisting.decision.process.cancellable).toBe(false);
      expect(persisting.decision.action).toBe("none");
      expect(persisting.consistent).toBe(true);
    });
  });

  describe("4. Cancellation", () => {
    it("reports cancelling without offering any action (legacy 'preparing' is informational)", () => {
      const result = shadow({
        operationState: makeOperation({
          status: "cancelling",
          phase: "generating",
          totalChunks: 100,
          processedChunks: 30,
          cancelRequestedAt: "2026-09-29T10:00:00.000Z",
        }),
      });

      expect(result.snapshot.primary).toBe("CANCELLING");
      expect(result.decision.process.phase).toBe("cancelling");
      expect(result.decision.process.cancellable).toBe(false);
      expect(result.decision.action).toBe("none");
      expect(result.decision.canExecute).toBe(false);
      expect(result.legacy.workflowStatus).toBe("preparing");
      expect(result.consistent).toBe(true);
      expect(
        result.differences.some((d) => d.area === "process" && d.severity === "info")
      ).toBe(true);
    });

    it("returns to an updatable state after cancellation and never presents it as an error", () => {
      const result = shadow({
        operationState: makeOperation({ status: "cancelled", phase: "cancelled", message: "cancelled" }),
      });

      expect(result.snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(result.snapshot.primary).not.toBe("ERROR");
      expect(result.snapshot.history.lastOperation?.kind).toBe("cancelled");
      expect(result.decision.action).toBe("update");
      expect(result.decision.canExecute).toBe(true);
      expect(result.consistent).toBe(true);
    });
  });

  describe("5. Provider error (ERROR)", () => {
    it("enables diagnostics and a controlled retry", () => {
      const result = shadow({
        operationState: makeOperation({
          status: "failed",
          phase: "failed",
          error: "Ollama timeout",
          message: "Ollama timeout",
        }),
      });

      expect(result.snapshot.primary).toBe("ERROR");
      expect(result.decision.action).toBe("retry");
      expect(result.decision.canRetry).toBe(true);
      expect(result.decision.canExecute).toBe(true);
      expect(result.decision.diagnostic).toEqual({ category: "operation-failed", message: "Ollama timeout" });
      expect(result.legacy.workflowStatus).toBe("error");
      expect(result.consistent).toBe(true);
    });

    it("does not allow a retry when this device cannot write", () => {
      const runtime = makeRuntime({ isActiveProducer: false, isStandbyProducer: true });
      const result = shadow({
        deviceRuntimeState: runtime,
        operationState: makeOperation({ status: "failed", phase: "failed", error: "boom" }),
      });
      expect(result.decision.action).toBe("none");
      expect(result.decision.canRetry).toBe(false);
    });

    it("requires confirmation for a retry that would rebuild everything", () => {
      const rebuild = makePlan({ mode: "full-rebuild", toGenerateCount: 105, missingCount: 105, reusableCanonicalCount: 0 });
      const result = shadow({
        workState: makeWorkState(rebuild),
        publishedIdentity: { provider: "mistral", model: "mistral-embed", dimensions: 1024, inputVersion: 1, prefixMode: "none" },
        operationState: makeOperation({ status: "failed", phase: "failed", error: "boom" }),
      });
      expect(result.snapshot.write.work.mode).toBe("full-rebuild");
      expect(result.decision.action).toBe("retry");
      expect(result.decision.requiresConfirmation).toBe(true);
    });
  });

  describe("6. Model incompatibility (INCOMPATIBLE)", () => {
    it("recommends a confirmed rebuild and suspends semantic search (Zero Silent Fallback)", () => {
      const rebuild = makePlan({
        mode: "full-rebuild",
        toGenerateCount: 105,
        missingCount: 105,
        staleToReplaceCount: 0,
        reusableCanonicalCount: 0,
        reasons: ["provider-changed"],
      });
      const policyDecision: EmbeddingPolicyDecision = {
        allowed: false,
        requiresConfirmation: true,
        reason: "manual-confirmation-required",
      };
      const result = shadow({
        workState: makeWorkState(rebuild),
        publishedIdentity: { provider: "mistral", model: "mistral-embed", dimensions: 1024, inputVersion: 1, prefixMode: "none" },
        isExternalProvider: true,
        policyDecision,
      });

      expect(result.snapshot.primary).toBe("INCOMPATIBLE");
      expect(result.snapshot.read.semanticAvailable).toBe(false);
      expect(result.snapshot.read.effectiveMode).toBe("text-only");
      expect(result.decision.action).toBe("rebuild");
      expect(result.decision.workMode).toBe("full-rebuild");
      expect(result.decision.severity).toBe("blocking");
      expect(result.decision.requiresConfirmation).toBe(true);
      expect(result.decision.canExecute).toBe(true);
      expect(result.consistent).toBe(true);
    });

    it("keeps INCOMPATIBLE as a rebuild even when no update plan is available", () => {
      const result = shadow({
        workState: { status: "ready", revision: 1, workAvailable: true },
        publishedIdentity: { provider: "mistral", model: "mistral-embed", dimensions: 1024, inputVersion: 1, prefixMode: "none" },
      });
      expect(result.snapshot.primary).toBe("INCOMPATIBLE");
      expect(result.decision.action).toBe("rebuild");
      expect(result.decision.requiresConfirmation).toBe(true);
    });

    it("does not offer a rebuild to a Companion", () => {
      const runtime = makeRuntime({ effectiveRole: "companion", isCompanion: true, isActiveProducer: false });
      const result = shadow({
        deviceRuntimeState: runtime,
        publishedIdentity: { provider: "mistral", model: "mistral-embed", dimensions: 1024, inputVersion: 1, prefixMode: "none" },
      });
      expect(result.snapshot.primary).toBe("INCOMPATIBLE");
      expect(result.decision.action).toBe("none");
      expect(result.decision.canExecute).toBe(false);
      expect(result.decision.blockedReason).toBe("companion");
    });
  });

  describe("7. Loss of ownership during generation", () => {
    it("flags the operation as running without authority and only allows cancelling it", () => {
      const runtime = makeRuntime({ isActiveProducer: false, isStandbyProducer: true, canPublish: false });
      const result = shadow({
        deviceRuntimeState: runtime,
        operationState: makeOperation({
          status: "running",
          phase: "generating",
          origin: "command",
          totalChunks: 100,
          processedChunks: 10,
        }),
      });

      expect(result.snapshot.primary).toBe("UPDATING");
      expect(result.snapshot.capability.blockedReason).toBe("standby");
      expect(result.decision.ownershipLostDuringOperation).toBe(true);
      expect(result.decision.action).toBe("cancel");
      expect(result.decision.canExecute).toBe(false);
      expect(result.decision.updateRequired).toBe(false);

      const authority = result.differences.filter((difference) => difference.area === "authority");
      expect(authority).toHaveLength(1);
      expect(authority[0]?.severity).toBe("divergence");
      expect(result.consistent).toBe(false);
    });
  });

  describe("8. Standby producer", () => {
    it("never offers update actions and never executes", () => {
      const runtime = makeRuntime({ isActiveProducer: false, isStandbyProducer: true, canPublish: false });
      const result = shadow({ deviceRuntimeState: runtime });

      expect(result.snapshot.primary).toBe("STANDBY");
      expect(result.decision.applicable).toBe(false);
      expect(result.decision.action).toBe("none");
      expect(result.decision.canExecute).toBe(false);
      expect(result.decision.blockedReason).toBe("standby");
      expect(result.legacy.sidebarButtonVisible).toBe(false);
      expect(result.consistent).toBe(true);
    });
  });

  describe("9. Indeterminate state", () => {
    it("never becomes READY and exposes the legacy coercion of indeterminate into idle", () => {
      const plan = makePlan({
        mode: "indeterminate",
        toGenerateCount: 0,
        missingCount: 0,
        staleToReplaceCount: 0,
        reasons: ["canonical-unreadable"],
      });
      const result = shadow({
        workState: makeWorkState(plan, { workAvailable: undefined }),
        canonicalReadability: "unreadable",
        validForSearchCount: 0,
      });

      expect(result.snapshot.primary).toBe("INDETERMINATE");
      expect(result.snapshot.primary).not.toBe("READY");
      expect(result.decision.workKind).toBe("indeterminate");
      expect(result.decision.action).toBe("none");
      expect(result.legacy.controllerWorkAvailable).toBeUndefined();
      expect(result.legacy.workflowStatus).toBe("idle");
      expect(result.differences.some((d) => d.property === "indeterminate-as-idle" && d.severity === "divergence")).toBe(true);
      expect(result.consistent).toBe(false);
    });
  });

  describe("10. Other canonical states", () => {
    it("READY: no update required and no action", () => {
      const plan = makePlan({
        toGenerateCount: 0,
        missingCount: 0,
        staleToReplaceCount: 0,
        reusableCanonicalCount: 105,
        reasons: ["no-generation-needed"],
      });
      const result = shadow({ workState: makeWorkState(plan, { workAvailable: false }) });

      expect(result.snapshot.primary).toBe("READY");
      expect(result.decision.updateRequired).toBe(false);
      expect(result.decision.action).toBe("none");
      expect(result.decision.severity).toBe("none");
      expect(result.consistent).toBe(true);
      expect(result.differences).toEqual([]);
    });

    it("INDEX_ONLY: recommends the initial generation", () => {
      const plan = makePlan({
        mode: "initial-build",
        toGenerateCount: 105,
        missingCount: 105,
        staleToReplaceCount: 0,
        reusableCanonicalCount: 0,
        reasons: ["canonical-missing"],
      });
      const result = shadow({
        deviceRuntimeState: makeRuntime({}, { exists: false, semanticAvailable: false, embeddingsDeclared: false }),
        workState: makeWorkState(plan),
        vectorContract: null,
        canonicalExists: false,
        validForSearchCount: 0,
      });

      expect(result.snapshot.primary).toBe("INDEX_ONLY");
      expect(result.decision.action).toBe("generate");
      expect(result.decision.workMode).toBe("initial-build");
      expect(result.decision.canExecute).toBe(true);
    });

    it("DISABLED: embeddings disabled never offer an action (legacy button divergence B6)", () => {
      const result = shadow({ deviceRuntimeState: makeRuntime({}, { configured: false }) });

      expect(result.snapshot.primary).toBe("DISABLED");
      expect(result.decision.action).toBe("none");
      expect(result.decision.blockedReason).toBe("embeddings-disabled");
      expect(result.legacy.sidebarButtonVisible).toBe(true);
      expect(result.differences.some((d) => d.area === "action" && d.severity === "divergence")).toBe(true);
    });

    it("VERIFYING: legacy dirty work state is 'checking' and no action is offered", () => {
      const result = shadow({ workState: makeWorkState(makePlan(), { status: "dirty" }) });
      expect(result.snapshot.primary).toBe("VERIFYING");
      expect(result.decision.action).toBe("none");
      expect(result.legacy.workflowStatus).toBe("checking");
      expect(result.snapshot.process.phase).toBe("checking");
    });

    it("publish-only cleanup is informational, costs nothing and needs no confirmation", () => {
      const plan = makePlan({
        toGenerateCount: 0,
        missingCount: 0,
        staleToReplaceCount: 0,
        obsoleteToDropCount: 4,
        requiresPublication: true,
        reasons: ["obsolete-records", "publication-needed"],
      });
      const result = shadow({
        workState: makeWorkState(plan),
        isExternalProvider: true,
      });
      expect(result.snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(result.decision.workMode).toBe("publish-only");
      expect(result.decision.action).toBe("update");
      expect(result.decision.severity).toBe("info");
      expect(result.decision.cost).toBe("none");
      expect(result.decision.requiresConfirmation).toBe(false);
      expect(result.consistent).toBe(true);
    });
  });

  describe("11. Detected legacy divergences (audit evidence)", () => {
    it("B7: obsolete records without chunks are work for the controller but not for policy/scheduler", () => {
      const plan = makePlan({
        totalChunks: 0,
        reusableCanonicalCount: 0,
        toGenerateCount: 0,
        missingCount: 0,
        staleToReplaceCount: 0,
        obsoleteToDropCount: 3,
        requiresPublication: false,
        reasons: ["obsolete-records"],
      });
      const result = shadow({ workState: makeWorkState(plan, { workAvailable: true }) });

      expect(result.legacy.controllerWorkAvailable).toBe(true);
      expect(result.legacy.policyPending).toBe(false);
      expect(result.legacy.schedulerPending).toBe(false);
      expect(result.snapshot.write.updateRequired).toBe(true);
      const properties = divergences(result).map((difference) => difference.property);
      expect(properties).toContain("policyPending");
      expect(properties).toContain("schedulerPending");
      expect(properties).not.toContain("updateRequired");
    });

    it("plan mode full-rebuild must be represented by the snapshot work mode", () => {
      const plan = makePlan({ mode: "full-rebuild", toGenerateCount: 105, missingCount: 105, reusableCanonicalCount: 0 });
      const result = shadow({ workState: makeWorkState(plan) });
      // Published identity equals the device contract and the target here, so the snapshot cannot
      // derive a rebuild by itself: the shadow must expose the disagreement.
      expect(result.snapshot.write.work.mode).toBe("incremental");
      expect(result.differences.some((d) => d.area === "mode" && d.severity === "divergence")).toBe(true);
    });

    it("refresh failure is a legacy error the snapshot does not represent", () => {
      const result = shadow({
        workState: makeWorkState(makePlan(), { status: "error", errorCategory: "refresh-failed" }),
      });
      expect(result.legacy.workflowStatus).toBe("error");
      expect(result.snapshot.primary).not.toBe("ERROR");
      expect(result.differences.some((d) => d.area === "primary" && d.property === "error")).toBe(true);
    });

    it("compares producer-state telemetry with the snapshot history informatively", () => {
      const producerState: ProducerStateV1 = createProducerState({
        activeProducerId: "5b2c1c3e-1b0e-4f3a-9d5e-3f5f3f0a9c11",
        producerEpoch: 2,
        embeddings: { lastSuccessfulPublicationAt: "2026-09-28T10:00:00.000Z" },
        maintenance: { status: "error", lastError: "provider unavailable" },
      });
      const result = shadow({ producerState });
      expect(result.legacy.producerHasError).toBe(true);
      expect(result.legacy.producerMaintenanceStatus).toBe("error");
      expect(result.snapshot.history.lastFailure?.category).toBe("provider unavailable");
      expect(result.snapshot.history.lastSuccess?.at).toBe("2026-09-28T10:00:00.000Z");
      expect(result.differences.filter((d) => d.area === "history")).toEqual([]);
    });
  });

  describe("12. Invariants, purity and determinism", () => {
    it("every canonical scenario satisfies the lifecycle invariants", () => {
      const standbyRuntime = makeRuntime({ isActiveProducer: false, isStandbyProducer: true });
      const companionRuntime = makeRuntime({ effectiveRole: "companion", isCompanion: true, isActiveProducer: false });
      const snapshots = [
        shadow(),
        shadow({ deviceRuntimeState: companionRuntime }),
        shadow({ deviceRuntimeState: standbyRuntime }),
        shadow({ operationState: makeOperation({ status: "running", phase: "generating", totalChunks: 10, processedChunks: 2 }) }),
        shadow({ operationState: makeOperation({ status: "running", phase: "persisting", totalChunks: 10, processedChunks: 10 }) }),
        shadow({ operationState: makeOperation({ status: "failed", phase: "failed", error: "x" }) }),
        shadow({ publishedIdentity: { provider: "mistral", model: "mistral-embed", dimensions: 1024, inputVersion: 1, prefixMode: "none" } }),
      ].map((result) => result.snapshot);

      for (const snapshot of snapshots) {
        expect(validateLifecycleInvariants(snapshot)).toEqual({ valid: true, violations: [] });
      }
    });

    it("Companion and non-authoritative devices never get an executable action in any state", () => {
      const runtimes = [
        makeRuntime({ effectiveRole: "companion", isCompanion: true, isActiveProducer: false }),
        makeRuntime({ isActiveProducer: false, isStandbyProducer: true }),
        makeRuntime({ effectiveRole: "unassigned", isUnassigned: true, isActiveProducer: false }),
      ];
      const operations = [
        makeOperation(),
        makeOperation({ status: "failed", phase: "failed", error: "x" }),
        makeOperation({ status: "cancelled", phase: "cancelled" }),
      ];
      for (const deviceRuntimeState of runtimes) {
        for (const operationState of operations) {
          const { decision } = shadow({ deviceRuntimeState, operationState });
          expect(decision.canExecute).toBe(false);
          expect(["none", "cancel"]).toContain(decision.action);
          expect(decision.canRetry).toBe(false);
        }
      }
    });

    it("does not mutate frozen inputs and is deterministic", () => {
      const inputs: EmbeddingWritePathShadowInputs = deepFreeze({
        revision: 1,
        computedAt: 1,
        deviceRuntimeState: makeRuntime(),
        workState: makeWorkState(makePlan()),
        operationState: makeOperation(),
        vectorContract: contract,
        upstreamTextIndex: "ready" as const,
        canonicalExists: true,
        validForSearchCount: 100,
      });
      const first = createEmbeddingWritePathShadowComparison(inputs);
      const second = createEmbeddingWritePathShadowComparison(inputs);
      expect(second).toEqual(first);
    });

    it("the adapter accepts the runtime plan preview and yields the same snapshot as the full plan", () => {
      const preview = makePlan();
      const fullPlan: EmbeddingUpdatePlan = {
        ...preview,
        reusableCanonicalRecords: [],
        recoverableCheckpointRecords: [],
        chunksToGenerate: [],
        obsoleteChunkIds: [],
        recordsToPublish: [],
      };
      const base = {
        revision: 1,
        computedAt: 1,
        deviceRuntimeState: makeRuntime(),
        vectorContract: contract,
        upstreamTextIndex: "ready" as const,
        canonicalExists: true,
        validForSearchCount: 100,
      };
      expect(adaptCurrentStateToLifecycleSnapshot({ ...base, updatePlan: preview }))
        .toEqual(adaptCurrentStateToLifecycleSnapshot({ ...base, updatePlan: fullPlan }));
    });

    it("legacy replicas mirror the production predicates", () => {
      const summary = summarizeLegacyWritePath({
        deviceRuntimeState: makeRuntime(),
        workState: makeWorkState(makePlan({ toGenerateCount: 0, requiresPublication: true })),
        operationState: makeOperation({ status: "running", phase: "generating" }),
        upstreamTextIndex: "ready",
      });
      expect(summary.policyPending).toBe(true);
      expect(summary.schedulerPending).toBe(true);
      expect(summary.sidebarButtonVisible).toBe(false);
      expect(summary.operationCancellable).toBe(true);
    });
  });

  describe("13. Isolation guarantees (no behaviour change)", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

    it("the shadow module is pure: no runtime, I/O, network, timers or generation entry points", () => {
      const source = read("src/index/embeddingLifecycleWritePath.ts")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of [
        "from \"obsidian\"",
        "node:fs",
        "requestUrl",
        "fetch(",
        "Date.now",
        "setTimeout",
        "saveData",
        "adapter.write",
        "requestEmbeddingIndexGeneration",
        "confirmAndRequestEmbeddingGeneration",
        "secretStorage",
        "localStorage",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    });

    it("no production flow consumes the shadow layer", () => {
      for (const file of [
        "src/search/linaSearchView.ts",
        "src/search/sidebarStatusViewModel.ts",
        "src/search/embeddingStatusViewModel.ts",
        "src/maintenance/embeddingScheduler.ts",
        "src/maintenance/embeddingWorker.ts",
        "src/maintenance/maintenanceEngine.ts",
        "src/maintenance/embeddingPolicyEngine.ts",
        "src/index/embeddingWorkStatusController.ts",
        "src/index/embeddingWorkflowState.ts",
        "src/index/embeddingGenerator.ts",
        "src/index/embeddingOperationManager.ts",
      ]) {
        const source = read(file);
        expect(source, file).not.toContain("embeddingLifecycleWritePath");
        expect(source, file).not.toContain("getEmbeddingWritePathShadowComparison");
      }
      const main = read("main.ts");
      expect(main.match(/getEmbeddingWritePathShadowComparison/g)).toHaveLength(1);
    });

    it("the plugin comparison is read-only: no writes, renames or removals", async () => {
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;
      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      const writesBefore = adapter.writeCount;
      const renamesBefore = adapter.renameCount;
      const result = await plugin.getEmbeddingWritePathShadowComparison();

      expect(result.snapshot.write.applicable).toBe(false);
      expect(result.decision.canExecute).toBe(false);
      expect(adapter.writeCount).toBe(writesBefore);
      expect(adapter.renameCount).toBe(renamesBefore);
    });
  });
});
