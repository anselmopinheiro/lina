/**
 * Embedding Operation Lifecycle Shadow Layer (Phase LINA-14D.2-D)
 *
 * Pure observational and comparator module that evaluates Worker and Operation Manager
 * execution eligibility, cancellation safety, retry authority, and ownership fencing
 * against the canonical `EmbeddingLifecycleSnapshot` and `deriveEmbeddingWritePathDecision()`.
 *
 * Core Architectural Invariants:
 * 1. Single source of truth: Execution and cancellation decisions derive from the canonical lifecycle model.
 * 2. Strict Companion & Standby protection: Devices without active write authority cannot start operations.
 * 3. Atomic persistence protection: Cancellation is prohibited during non-interruptible phases (e.g. `persisting`).
 * 4. Fencing against ownership loss: Operations active when write authority is lost are flagged immediately.
 * 5. Strictly pure: No I/O, no timers, no worker mutation, no side effects.
 */

import type { DeviceRole } from "../device/deviceRole";
import {
  type EmbeddingLifecycleSnapshot,
  type ProcessPhase,
} from "../index/embeddingLifecycleModel";
import {
  type EmbeddingWriteAction,
  type EmbeddingWritePathDecision,
  deriveEmbeddingWritePathDecision,
} from "../index/embeddingLifecycleWritePath";
import type {
  EmbeddingOperationState,
  EmbeddingOperationStatus,
} from "../index/embeddingOperationManager";
import type { EmbeddingWorkerState } from "./embeddingWorker";

// ---------------------------------------------------------------------------
// 1. Operation Shadow Decision & Inputs
// ---------------------------------------------------------------------------

export interface OperationShadowEligibilityDecision {
  /** True if starting a new generation/update operation is permitted. */
  readonly canStart: boolean;
  /** True if the currently active operation can be safely cancelled. */
  readonly canCancel: boolean;
  /** True if retrying a failed operation is authorized. */
  readonly canRetry: boolean;
  /** Recommended canonical write action. */
  readonly action: EmbeddingWriteAction;
  /** Whether the recommended action mandates explicit user modal confirmation. */
  readonly requiresConfirmation: boolean;
  /** True when an operation is running but write authority was lost during execution. */
  readonly ownershipLostDuringOperation: boolean;
  /** Canonical process phase. */
  readonly phase: ProcessPhase;
  /** Descriptive diagnostic reason. */
  readonly reason: string;
  /** Full derived canonical write path decision. */
  readonly decision?: EmbeddingWritePathDecision;
}

export interface LegacyOperationStateInputs {
  readonly canGenerateEmbeddings: boolean;
  readonly canPublish: boolean;
  readonly isTextIndexBusy?: boolean;
  readonly deviceRole?: DeviceRole;
  readonly workerState?: EmbeddingWorkerState;
  readonly operationState?: EmbeddingOperationState;
  readonly hasPendingWork?: boolean;
}

export type OperationDifferenceCategory = "expected" | "informative" | "divergence";

export type OperationDifferenceArea =
  | "execution"
  | "cancellation"
  | "retry"
  | "action"
  | "ownership"
  | "phase"
  | "confirmation";

export interface OperationLifecycleDifference {
  readonly area: OperationDifferenceArea;
  readonly property: string;
  readonly legacyValue: unknown;
  readonly canonicalValue: unknown;
  readonly description: string;
  readonly category: OperationDifferenceCategory;
}

export interface OperationLifecycleComparisonResult {
  readonly legacyDecision: OperationShadowEligibilityDecision;
  readonly canonicalDecision: OperationShadowEligibilityDecision;
  readonly differences: readonly OperationLifecycleDifference[];
  readonly matches: boolean;
  readonly hasRealDivergence: boolean;
}

// ---------------------------------------------------------------------------
// 2. Legacy Decision Evaluation (Replication of Current Runtime Logic)
// ---------------------------------------------------------------------------

export function evaluateLegacyOperationDecision(
  inputs: LegacyOperationStateInputs
): OperationShadowEligibilityDecision {
  const isCompanion = inputs.deviceRole === "companion";
  const opStatus: EmbeddingOperationStatus = inputs.operationState?.status ?? "idle";
  const operationActive = opStatus === "running" || opStatus === "cancelling";
  const hasWork = Boolean(inputs.hasPendingWork);

  const canStart =
    inputs.canGenerateEmbeddings &&
    inputs.canPublish &&
    !inputs.isTextIndexBusy &&
    !isCompanion &&
    !operationActive &&
    hasWork;

  // In legacy OperationManager, cancelActiveOperation returns "cancel-requested" whenever status === "running"
  const canCancel = opStatus === "running";

  const canRetry =
    opStatus === "failed" &&
    inputs.canGenerateEmbeddings &&
    inputs.canPublish &&
    !isCompanion;

  let action: EmbeddingWriteAction = "none";
  if (operationActive) {
    action = canCancel ? "cancel" : "none";
  } else if (canRetry) {
    action = "retry";
  } else if (canStart) {
    action = "update";
  }

  let reason = "idle";
  if (isCompanion) {
    reason = "companion-device-not-capable";
  } else if (!inputs.canPublish) {
    reason = "not-active-producer";
  } else if (inputs.isTextIndexBusy) {
    reason = "text-index-busy";
  } else if (operationActive) {
    reason = opStatus === "cancelling" ? "already-cancelling" : "operation-running";
  } else if (canRetry) {
    reason = "retry-eligible";
  } else if (canStart) {
    reason = "ready-to-execute";
  } else if (!hasWork) {
    reason = "no-work-pending";
  }

  const phase: ProcessPhase =
    opStatus === "running"
      ? (inputs.operationState?.phase as ProcessPhase | null) ?? "generating"
      : opStatus === "cancelling"
      ? "cancelling"
      : "idle";

  return {
    canStart,
    canCancel,
    canRetry,
    action,
    requiresConfirmation: false,
    ownershipLostDuringOperation: false,
    phase,
    reason,
  };
}

// ---------------------------------------------------------------------------
// 3. Canonical Decision Evaluation (Derived from Snapshot)
// ---------------------------------------------------------------------------

export function evaluateOperationDecisionFromSnapshot(
  snapshot: EmbeddingLifecycleSnapshot
): OperationShadowEligibilityDecision {
  const decision = deriveEmbeddingWritePathDecision(snapshot);
  const operationActive = snapshot.primary === "UPDATING" || snapshot.primary === "CANCELLING";

  const canStart =
    !operationActive &&
    decision.applicable &&
    decision.canExecute &&
    (decision.action === "generate" || decision.action === "update" || decision.action === "rebuild");

  const canCancel = operationActive && snapshot.process.cancellable;
  const canRetry = decision.canRetry;
  const ownershipLostDuringOperation = decision.ownershipLostDuringOperation;

  let reason = "idle";
  if (ownershipLostDuringOperation) {
    reason = "ownership-lost-during-operation";
  } else if (!decision.applicable) {
    reason = decision.blockedReason
      ? `blocked-${decision.blockedReason}`
      : "write-not-applicable";
  } else if (snapshot.primary === "INDETERMINATE" || decision.workKind === "indeterminate") {
    reason = "indeterminate-state-blocked";
  } else if (snapshot.primary === "INCOMPATIBLE") {
    reason = "incompatible-rebuild-required";
  } else if (snapshot.primary === "ERROR") {
    reason = canRetry ? "error-retry-authorized" : "error-retry-blocked";
  } else if (operationActive) {
    reason = snapshot.process.cancellable
      ? "operation-active-cancellable"
      : "operation-active-non-cancellable";
  } else if (decision.action === "none") {
    reason = "no-work-pending";
  } else if (canStart) {
    reason = `authorized-${decision.action}`;
  }

  return {
    canStart,
    canCancel,
    canRetry,
    action: decision.action,
    requiresConfirmation: decision.requiresConfirmation,
    ownershipLostDuringOperation,
    phase: snapshot.process.phase,
    reason,
    decision,
  };
}

// ---------------------------------------------------------------------------
// 4. Parity Comparison & Difference Classification
// ---------------------------------------------------------------------------

export function compareOperationLifecycleDecision(
  legacyInputs: LegacyOperationStateInputs,
  snapshot: EmbeddingLifecycleSnapshot
): OperationLifecycleComparisonResult {
  const legacyDecision = evaluateLegacyOperationDecision(legacyInputs);
  const canonicalDecision = evaluateOperationDecisionFromSnapshot(snapshot);
  const differences: OperationLifecycleDifference[] = [];

  const push = (diff: OperationLifecycleDifference) => {
    differences.push(diff);
  };

  // 1. Start Execution Authority (canStart)
  if (legacyDecision.canStart !== canonicalDecision.canStart) {
    const isExpected =
      !canonicalDecision.canStart &&
      (snapshot.primary === "INCOMPATIBLE" ||
        snapshot.primary === "INDETERMINATE" ||
        snapshot.primary === "STANDBY" ||
        snapshot.primary === "ERROR" ||
        !snapshot.write.applicable ||
        canonicalDecision.requiresConfirmation);

    push({
      area: "execution",
      property: "canStart",
      legacyValue: legacyDecision.canStart,
      canonicalValue: canonicalDecision.canStart,
      description: `Execution start authority differs (legacy=${legacyDecision.canStart}, canonical=${canonicalDecision.canStart})`,
      category: isExpected ? "expected" : "divergence",
    });
  }

  // 2. Cancellation Authority (canCancel)
  if (legacyDecision.canCancel !== canonicalDecision.canCancel) {
    // Canonical blocks cancel during non-cancellable phases like "persisting"
    const isExpected =
      !canonicalDecision.canCancel &&
      (snapshot.process.phase === "persisting" || !snapshot.process.cancellable);

    push({
      area: "cancellation",
      property: "canCancel",
      legacyValue: legacyDecision.canCancel,
      canonicalValue: canonicalDecision.canCancel,
      description: `Cancellation safety differs (legacy=${legacyDecision.canCancel}, canonical=${canonicalDecision.canCancel})`,
      category: isExpected ? "expected" : "divergence",
    });
  }

  // 3. Retry Authority (canRetry)
  if (legacyDecision.canRetry !== canonicalDecision.canRetry) {
    const isExpected =
      !canonicalDecision.canRetry &&
      (!snapshot.capability.canRequestUpdate || !snapshot.write.applicable);

    push({
      area: "retry",
      property: "canRetry",
      legacyValue: legacyDecision.canRetry,
      canonicalValue: canonicalDecision.canRetry,
      description: `Retry authority differs (legacy=${legacyDecision.canRetry}, canonical=${canonicalDecision.canRetry})`,
      category: isExpected ? "expected" : "divergence",
    });
  }

  // 4. Recommended Action (action)
  if (legacyDecision.action !== canonicalDecision.action) {
    const isInformativeOrExpected =
      canonicalDecision.action === "rebuild" ||
      canonicalDecision.action === "generate" ||
      canonicalDecision.action === "retry" ||
      canonicalDecision.action === "cancel" ||
      (legacyDecision.action === "cancel" && canonicalDecision.action === "none" && !snapshot.process.cancellable) ||
      (!snapshot.write.applicable && canonicalDecision.action === "none") ||
      (snapshot.primary === "INDETERMINATE" && canonicalDecision.action === "none");

    push({
      area: "action",
      property: "action",
      legacyValue: legacyDecision.action,
      canonicalValue: canonicalDecision.action,
      description: `Recommended write action differs (legacy=${legacyDecision.action}, canonical=${canonicalDecision.action})`,
      category: isInformativeOrExpected ? "informative" : "divergence",
    });
  }


  // 5. Ownership Loss Detection
  if (legacyDecision.ownershipLostDuringOperation !== canonicalDecision.ownershipLostDuringOperation) {
    push({
      area: "ownership",
      property: "ownershipLostDuringOperation",
      legacyValue: legacyDecision.ownershipLostDuringOperation,
      canonicalValue: canonicalDecision.ownershipLostDuringOperation,
      description: "Canonical lifecycle detects loss of write authority during active operation",
      category: "expected",
    });
  }

  // 6. Confirmation Requirement
  if (legacyDecision.requiresConfirmation !== canonicalDecision.requiresConfirmation) {
    push({
      area: "confirmation",
      property: "requiresConfirmation",
      legacyValue: legacyDecision.requiresConfirmation,
      canonicalValue: canonicalDecision.requiresConfirmation,
      description: `Explicit confirmation requirement differs (legacy=${legacyDecision.requiresConfirmation}, canonical=${canonicalDecision.requiresConfirmation})`,
      category: canonicalDecision.requiresConfirmation ? "expected" : "informative",
    });
  }

  // 7. Phase Alignment
  if (legacyDecision.phase !== canonicalDecision.phase) {
    push({
      area: "phase",
      property: "phase",
      legacyValue: legacyDecision.phase,
      canonicalValue: canonicalDecision.phase,
      description: `Process phase differs (legacy=${legacyDecision.phase}, canonical=${canonicalDecision.phase})`,
      category: "informative",
    });
  }

  const hasRealDivergence = differences.some((d) => d.category === "divergence");

  return {
    legacyDecision,
    canonicalDecision,
    differences,
    matches: differences.length === 0,
    hasRealDivergence,
  };
}
