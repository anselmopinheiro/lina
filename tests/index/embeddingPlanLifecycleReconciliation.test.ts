import { describe, expect, it } from "vitest";
import {
  adaptCurrentStateToLifecycleSnapshot,
  toEmbeddingIdentitySummary,
} from "../../src/index/embeddingLifecycleAdapter";
import {
  EmbeddingLifecycleSnapshot,
  validateLifecycleInvariants,
} from "../../src/index/embeddingLifecycleModel";
import {
  deriveEmbeddingWritePathDecision,
  evaluateOperationStartGate,
} from "../../src/index/embeddingLifecycleWritePath";
import {
  EmbeddingUpdatePlanPreview,
} from "../../src/index/embeddingUpdatePlan";
import {
  buildEmbeddingWorkLifecycleSnapshot,
  EmbeddingWorkSummary,
} from "../../src/index/embeddingWorkStatusController";
import {
  evaluateSchedulerDecisionFromSnapshot,
} from "../../src/maintenance/embeddingScheduler";

describe("LINA-15B: Embedding Plan ↔ Lifecycle Reconciliation", () => {
  const localTargetIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none" as const,
  };

  const externalTargetIdentity = {
    provider: "mistral",
    model: "mistral-embed",
    dimensions: 1024,
    inputVersion: 1,
    prefixMode: "none" as const,
  };

  describe("1. Full-Rebuild Reconciliation (Finding F-03 Fix)", () => {
    it("reconciles legacy manifest (published-identity-incomplete) into INCOMPATIBLE and rebuild action with confirmation", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "full-rebuild",
        targetIdentity: localTargetIdentity,
        totalChunks: 100,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 100,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["published-identity-incomplete"],
      };

      const summary: EmbeddingWorkSummary = {
        exists: true,
        canonicalReadability: "readable",
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        totalChunks: 100,
        validCount: 0,
        missingCount: 0,
        staleCount: 0,
        obsoleteCount: 0,
        updatePlan: plan,
      };

      const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary, 1);

      // Invariant validation
      const inv = validateLifecycleInvariants(snapshot);
      expect(inv.valid).toBe(true);

      // Snapshot checks
      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.write.work.mode).toBe("full-rebuild");
      expect(snapshot.write.work.severity).toBe("blocking");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.effectiveMode).toBe("text-only");
      expect(snapshot.read.compatibility.status).toBe("incompatible");

      // Write path decision checks
      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("rebuild");
      expect(decision.requiresConfirmation).toBe(true);
      expect(decision.canExecute).toBe(true);

      // Scheduler evaluation checks (must NOT auto-dispatch!)
      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(false);
      expect(scheduler.action).toBe("rebuild");
      expect(scheduler.requiresConfirmation).toBe(true);
      expect(scheduler.reason).toBe("incompatible-rebuild-required");

      // Start gate check (automatic start must be blocked)
      const startGate = evaluateOperationStartGate(decision, "automatic");
      expect(startGate.allowed).toBe(false);
      if (!startGate.allowed) {
        expect(startGate.reason).toBe("confirmation-required");
      }
    });

    it("reconciles canonical mixed identities (canonical-identity-mixed) into INCOMPATIBLE and rebuild action", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "full-rebuild",
        targetIdentity: localTargetIdentity,
        totalChunks: 80,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 80,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["canonical-identity-mixed"],
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        canonicalExists: true,
        canonicalReadability: "readable",
        upstreamTextIndex: "ready",
        publishedIdentity: localTargetIdentity,
        targetIdentity: localTargetIdentity,
        updatePlan: plan,
      });

      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.write.work.mode).toBe("full-rebuild");

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("rebuild");
      expect(decision.requiresConfirmation).toBe(true);

      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(false);
    });

    it("reconciles dimension change into INCOMPATIBLE and rebuild action with confirmation", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "full-rebuild",
        targetIdentity: { ...localTargetIdentity, dimensions: 1024 },
        totalChunks: 50,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 50,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["dimension-changed"],
      };

      const summary: EmbeddingWorkSummary = {
        exists: true,
        canonicalReadability: "readable",
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768, // Published dimensions differ from target 1024
        totalChunks: 50,
        updatePlan: plan,
      };

      const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary, 1);
      expect(snapshot.primary).toBe("INCOMPATIBLE");

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("rebuild");
      expect(decision.requiresConfirmation).toBe(true);

      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(false);
    });
  });

  describe("2. Incremental Update Reconciliation", () => {
    it("classifies normal missing chunks as UPDATE_AVAILABLE with update action and auto-dispatch for local provider", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "incremental",
        targetIdentity: localTargetIdentity,
        totalChunks: 100,
        reusableCanonicalCount: 95,
        recoverableCheckpointCount: 0,
        toGenerateCount: 5,
        staleToReplaceCount: 0,
        missingCount: 5,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["missing-chunks"],
      };

      const summary: EmbeddingWorkSummary = {
        exists: true,
        canonicalReadability: "readable",
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        totalChunks: 100,
        validCount: 95,
        missingCount: 5,
        staleCount: 0,
        obsoleteCount: 0,
        updatePlan: plan,
      };

      const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary, 1);
      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.write.work.mode).toBe("incremental");

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("update");
      expect(decision.requiresConfirmation).toBe(false);

      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(true);
      expect(scheduler.reason).toBe("auto-dispatch-approved");

      const startGate = evaluateOperationStartGate(decision, "automatic");
      expect(startGate.allowed).toBe(true);
    });

    it("requires confirmation for incremental update with external provider (e.g. Mistral)", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "incremental",
        targetIdentity: externalTargetIdentity,
        totalChunks: 100,
        reusableCanonicalCount: 90,
        recoverableCheckpointCount: 0,
        toGenerateCount: 10,
        staleToReplaceCount: 10,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["stale-chunks"],
      };

      const summary: EmbeddingWorkSummary = {
        exists: true,
        canonicalReadability: "readable",
        provider: "mistral",
        model: "mistral-embed",
        dimensions: 1024,
        totalChunks: 100,
        validCount: 90,
        missingCount: 0,
        staleCount: 10,
        obsoleteCount: 0,
        updatePlan: plan,
      };

      const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary, 1);
      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(snapshot.write.cost).toBe("external");

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("update");
      expect(decision.requiresConfirmation).toBe(true);

      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(false);
      expect(scheduler.reason).toBe("external-provider-blocked");
    });
  });

  describe("3. Initial Build and Indeterminate Reconciliation", () => {
    it("reconciles initial-build into INDEX_ONLY and generate action", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "initial-build",
        targetIdentity: localTargetIdentity,
        totalChunks: 50,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 50,
        staleToReplaceCount: 0,
        missingCount: 50,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["canonical-missing"],
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        canonicalExists: false,
        canonicalReadability: "missing",
        upstreamTextIndex: "ready",
        updatePlan: plan,
      });

      expect(snapshot.primary).toBe("INDEX_ONLY");
      expect(snapshot.read.semanticAvailable).toBe(false);

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("generate");
      expect(decision.requiresConfirmation).toBe(false);
    });

    it("reconciles indeterminate into INDETERMINATE blocking action and scheduler", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "indeterminate",
        targetIdentity: localTargetIdentity,
        totalChunks: 50,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        toGenerateCount: 0,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: false,
        reasons: ["canonical-unreadable"],
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        canonicalExists: true,
        canonicalReadability: "unreadable",
        upstreamTextIndex: "ready",
        updatePlan: plan,
      });

      expect(snapshot.primary).toBe("INDETERMINATE");
      expect(snapshot.write.work.kind).toBe("indeterminate");

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("none");
      expect(decision.canExecute).toBe(false);

      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(false);
      expect(scheduler.reason).toBe("indeterminate-state-blocked");

      const startGate = evaluateOperationStartGate(decision, "automatic");
      expect(startGate.allowed).toBe(false);
      if (!startGate.allowed) {
        expect(startGate.reason).toBe("indeterminate");
      }
    });
  });

  describe("4. Standby and Companion Safety", () => {
    it("blocks write actions on Standby Producer even if plan has pending work", () => {
      const plan: EmbeddingUpdatePlanPreview = {
        mode: "incremental",
        targetIdentity: localTargetIdentity,
        totalChunks: 100,
        reusableCanonicalCount: 80,
        recoverableCheckpointCount: 0,
        toGenerateCount: 20,
        staleToReplaceCount: 20,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: true,
        reasons: ["stale-chunks"],
      };

      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        deviceRuntimeState: {
          deviceId: "standby-device",
          effectiveRole: "producer",
          isActiveProducer: false, // Standby!
          assignmentState: "assigned",
          isConfigured: true,
          ownershipExists: true,
          isStandbyProducer: true,
          isCompanion: false,
          isUnassigned: false,
          canPublish: false,
          canTransferOwnership: true,
          transferEligibilityReason: "eligible",
        },
        canonicalExists: true,
        upstreamTextIndex: "ready",
        publishedIdentity: localTargetIdentity,
        updatePlan: plan,
      });

      expect(snapshot.primary).toBe("STANDBY");
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("standby");

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("none");
      expect(decision.applicable).toBe(false);

      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(false);
      expect(scheduler.shouldSchedule).toBe(false);
      expect(scheduler.reason).toBe("blocked-standby");
    });
  });
});
