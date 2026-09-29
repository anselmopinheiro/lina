/**
 * Embedding Lifecycle Write Path — Shadow Layer (Phase LINA-14D-1)
 *
 * Derives the canonical Write Path decision (work, kind, severity, cost, recommended action,
 * confirmation and process preservation) exclusively from an `EmbeddingLifecycleSnapshot` and
 * compares it with the decisions still taken independently by the legacy Write Path:
 *
 *   - `EmbeddingWorkStatusController` (`workAvailable`);
 *   - `EmbeddingWorkflowState`;
 *   - `EmbeddingUpdatePlan` preview (policy and scheduler predicates);
 *   - Sidebar update button condition;
 *   - `EmbeddingOperationState`;
 *   - `ProducerStateV1` telemetry;
 *   - `EmbeddingPolicyDecision`.
 *
 * This module is strictly observational and pure: no I/O, no network, no timers, no mutation of
 * inputs, no Obsidian runtime dependency and no call into any generation or publication path.
 * It is NOT consumed by production flows in this phase; it only allows the Write Path to be
 * migrated progressively with evidence of equivalence.
 */

import {
  EmbeddingLifecycleSnapshot,
  EmbeddingLifecycleStatus,
  EmbeddingWorkCost,
  EmbeddingWorkExecutionMode,
  EmbeddingWorkKind,
  EmbeddingWorkSeverity,
  ProcessPhase,
} from "./embeddingLifecycleModel";
import {
  CurrentEmbeddingStateInputs,
  adaptCurrentStateToLifecycleSnapshot,
} from "./embeddingLifecycleAdapter";
import { EmbeddingWorkRuntimeState } from "./embeddingWorkStatusController";
import { EmbeddingUpdatePlanPreview } from "./embeddingUpdatePlan";
import type { EmbeddingPolicyDecision } from "../maintenance/embeddingPolicyEngine";

// ---------------------------------------------------------------------------
// 1. Canonical Write Path decision (derived from the snapshot only)
// ---------------------------------------------------------------------------

export type EmbeddingWriteAction = "none" | "generate" | "update" | "rebuild" | "cancel" | "retry";

export type EmbeddingWriteBlockedReason = EmbeddingLifecycleSnapshot["capability"]["blockedReason"];

export interface EmbeddingWritePathDecision {
  readonly primary: EmbeddingLifecycleStatus;
  readonly applicable: boolean;

  readonly workKind: EmbeddingWorkKind;
  readonly workMode?: EmbeddingWorkExecutionMode;
  readonly updateRequired: boolean;
  readonly severity: EmbeddingWorkSeverity;
  readonly cost: EmbeddingWorkCost;
  readonly reason?: string;

  /** Recommended action for the user. Never executed by this module. */
  readonly action: EmbeddingWriteAction;
  readonly canExecute: boolean;
  readonly blockedReason?: EmbeddingWriteBlockedReason;
  readonly requiresConfirmation: boolean;

  readonly process: {
    readonly phase: ProcessPhase;
    readonly progress?: {
      readonly processed: number;
      readonly total: number;
      readonly reused?: number;
      readonly failed?: number;
    };
    readonly cancellable: boolean;
    readonly origin?: "command" | "sidebar" | "automatic" | "internal";
  };

  /** True when an operation is active but this device no longer holds write authority. */
  readonly ownershipLostDuringOperation: boolean;

  readonly canRetry: boolean;
  readonly diagnostic?: {
    readonly category: string;
    readonly message?: string;
  };
}

const AUTHORITY_BLOCKS: ReadonlyArray<NonNullable<EmbeddingWriteBlockedReason>> = [
  "companion",
  "standby",
  "unassigned",
  "ownership-lost",
];

function actionFromMode(mode: EmbeddingWorkExecutionMode | undefined): EmbeddingWriteAction {
  switch (mode) {
    case "initial-build":
      return "generate";
    case "incremental":
    case "publish-only":
      return "update";
    case "full-rebuild":
      return "rebuild";
    default:
      return "none";
  }
}

/**
 * Derives the canonical Write Path decision from a lifecycle snapshot.
 *
 * Rules (in priority order):
 * 1. Active operation (UPDATING / CANCELLING): only `cancel` (when cancellable) or `none`;
 *    phase, progress and cancellability are preserved; nothing can be requested.
 * 2. Write not applicable (Companion, Standby, Unassigned, embeddings disabled) or facts still
 *    being verified: `none`.
 * 3. ERROR: `retry` (controlled by `capability.canRequestUpdate`), diagnostic preserved.
 * 4. INCOMPATIBLE: `rebuild`, always with confirmation.
 * 5. INDEX_ONLY: `generate`.
 * 6. Pending work: action derived from the work mode (`generate` / `update` / `rebuild`).
 * 7. Otherwise: `none`.
 */
export function deriveEmbeddingWritePathDecision(
  snapshot: EmbeddingLifecycleSnapshot
): EmbeddingWritePathDecision {
  const { write, process, capability, primary, history } = snapshot;
  const work = write.work;

  const operationActive = primary === "UPDATING" || primary === "CANCELLING";
  const ownershipLostDuringOperation =
    operationActive &&
    capability.blockedReason !== undefined &&
    AUTHORITY_BLOCKS.includes(capability.blockedReason);

  const diagnosticSource = history.lastFailure
    ?? (history.lastOperation?.kind === "failed"
      ? { category: "operation-failed", message: history.lastOperation.message }
      : undefined);
  const diagnostic = primary === "ERROR" && diagnosticSource
    ? { category: diagnosticSource.category, message: diagnosticSource.message }
    : undefined;

  let action: EmbeddingWriteAction = "none";
  let canExecute = false;

  if (operationActive) {
    action = process.cancellable ? "cancel" : "none";
    canExecute = false;
  } else if (!write.applicable || primary === "VERIFYING") {
    // Facts are still being calculated: no action may be recommended until they settle.
    action = "none";
    canExecute = false;
  } else if (primary === "ERROR") {
    action = "retry";
    canExecute = capability.canRequestUpdate;
  } else if (primary === "INCOMPATIBLE") {
    action = "rebuild";
    canExecute = capability.canRequestUpdate;
  } else if (primary === "INDEX_ONLY") {
    action = "generate";
    canExecute = capability.canRequestUpdate;
  } else if (work.kind === "pending") {
    action = actionFromMode(work.mode);
    canExecute = capability.canRequestUpdate && action !== "none";
  }

  const executes = action === "generate" || action === "update" || action === "rebuild" || action === "retry";
  const requiresConfirmation = executes && (
    action === "rebuild" ||
    work.mode === "full-rebuild" ||
    write.cost === "external" ||
    capability.requiresConfirmation
  );

  return {
    primary,
    applicable: write.applicable,
    workKind: work.kind,
    workMode: work.mode,
    updateRequired: write.updateRequired,
    severity: write.severity,
    cost: write.cost,
    reason: write.reason,
    action,
    canExecute,
    blockedReason: capability.blockedReason,
    requiresConfirmation,
    process: {
      phase: process.phase,
      progress: process.progress,
      cancellable: process.cancellable,
      origin: process.origin,
    },
    ownershipLostDuringOperation,
    canRetry: action === "retry" && canExecute,
    diagnostic,
  };
}

// ---------------------------------------------------------------------------
// 2. Legacy Write Path summary (replicas of the decisions taken today)
// ---------------------------------------------------------------------------

export interface EmbeddingWritePathShadowInputs extends CurrentEmbeddingStateInputs {
  /** Runtime work status; `summary.updatePlan` is used as plan when `updatePlan` is absent. */
  readonly workState?: EmbeddingWorkRuntimeState | null;
  /** Legacy policy decision, when known (confirmation comparison only). */
  readonly policyDecision?: EmbeddingPolicyDecision | null;
  /** Legacy `indexReady` used by the Sidebar button; defaults to `upstreamTextIndex` usable. */
  readonly textIndexReady?: boolean;
}

export interface LegacyWritePathSummary {
  readonly workflowStatus?: string;
  /** D1: `EmbeddingWorkStatusController.workAvailable` (tri-state). */
  readonly controllerWorkAvailable: boolean | undefined;
  /** D4: predicate used by `confirmAndRequestEmbeddingGeneration` (main.ts). */
  readonly policyPending: boolean | undefined;
  /** D5: predicate used by the automatic scheduler (`hasAutomaticEmbeddingWork`, main.ts). */
  readonly schedulerPending: boolean | undefined;
  /** D3: visibility of the Sidebar "update embeddings" button. */
  readonly sidebarButtonVisible: boolean;
  readonly planMode?: string;
  readonly operationStatus?: string;
  readonly operationPhase?: string;
  readonly operationCancellable: boolean;
  readonly producerMaintenanceStatus?: string;
  readonly producerHasError: boolean;
  readonly producerLastSuccessAt?: string;
  readonly policyRequiresConfirmation?: boolean;
}

/**
 * Replicates the legacy predicates. The replicas intentionally mirror the production code and are
 * pinned by tests; they are never used to take a production decision.
 */
export function summarizeLegacyWritePath(inputs: EmbeddingWritePathShadowInputs): LegacyWritePathSummary {
  const plan: EmbeddingUpdatePlanPreview | null | undefined =
    inputs.updatePlan ?? inputs.workState?.summary?.updatePlan;
  const operation = inputs.operationState ?? undefined;
  const runtime = inputs.deviceRuntimeState ?? undefined;

  const operationActive = operation?.status === "running" || operation?.status === "cancelling";
  const textIndexReady = inputs.textIndexReady
    ?? (inputs.upstreamTextIndex === "ready" || inputs.upstreamTextIndex === "stale");
  // The controller value is tri-state; do not fall back to the coerced workflow boolean when the
  // controller state is known, otherwise "indeterminate" would be hidden.
  const controllerWorkAvailable = inputs.workState
    ? inputs.workState.workAvailable
    : inputs.workflowState?.workAvailable;

  return {
    workflowStatus: inputs.workflowState?.status,
    controllerWorkAvailable,
    policyPending: plan ? plan.toGenerateCount > 0 || plan.requiresPublication : undefined,
    schedulerPending: plan ? plan.toGenerateCount > 0 || plan.requiresPublication : undefined,
    sidebarButtonVisible:
      runtime?.isActiveProducer === true &&
      controllerWorkAvailable === true &&
      !operationActive &&
      textIndexReady === true,
    planMode: plan?.mode,
    operationStatus: operation?.status,
    operationPhase: operation?.phase ?? undefined,
    operationCancellable: operation?.status === "running" && operation.phase !== "persisting",
    producerMaintenanceStatus: inputs.producerState?.maintenance?.status,
    producerHasError: Boolean(inputs.producerState?.maintenance?.lastError),
    producerLastSuccessAt: inputs.producerState?.embeddings?.lastSuccessfulPublicationAt ?? undefined,
    policyRequiresConfirmation: inputs.policyDecision?.requiresConfirmation,
  };
}

// ---------------------------------------------------------------------------
// 3. Shadow comparison
// ---------------------------------------------------------------------------

export type EmbeddingWritePathDifferenceArea =
  | "work"
  | "mode"
  | "action"
  | "confirmation"
  | "process"
  | "authority"
  | "history"
  | "primary";

export type EmbeddingWritePathDifferenceSeverity = "info" | "warning" | "divergence";

export interface EmbeddingWritePathDifference {
  readonly area: EmbeddingWritePathDifferenceArea;
  readonly property: string;
  readonly legacyValue: unknown;
  readonly snapshotValue: unknown;
  readonly description: string;
  readonly severity: EmbeddingWritePathDifferenceSeverity;
}

export interface EmbeddingWritePathShadowResult {
  readonly legacy: LegacyWritePathSummary;
  readonly snapshot: EmbeddingLifecycleSnapshot;
  readonly decision: EmbeddingWritePathDecision;
  readonly differences: readonly EmbeddingWritePathDifference[];
  /** True when no difference has severity `divergence`. */
  readonly consistent: boolean;
}

/** Actions that correspond to the "update embeddings" affordance offered to the user. */
const OFFERED_ACTIONS: ReadonlyArray<EmbeddingWriteAction> = ["generate", "update", "rebuild", "retry"];

function expectedLegacyProcessPhase(status: string | undefined): ProcessPhase | "derived-copy" | undefined {
  switch (status) {
    case "preparing":
      return "preparing";
    case "generating":
      return "generating";
    case "persisting":
      return "persisting";
    case "finalizing":
      return "derived-copy";
    case "checking":
      return "checking";
    case undefined:
      return undefined;
    default:
      return "idle";
  }
}

function describeIsolation(decision: EmbeddingWritePathDecision): string {
  return decision.blockedReason
    ? `write path not applicable (${decision.blockedReason})`
    : "write path not applicable";
}

/**
 * Compares the legacy Write Path decisions with the canonical snapshot decision.
 */
export function compareLegacyWritePathWithLifecycle(
  inputs: EmbeddingWritePathShadowInputs,
  snapshot: EmbeddingLifecycleSnapshot
): EmbeddingWritePathShadowResult {
  const legacy = summarizeLegacyWritePath(inputs);
  const decision = deriveEmbeddingWritePathDecision(snapshot);
  const differences: EmbeddingWritePathDifference[] = [];
  const push = (difference: EmbeddingWritePathDifference): void => {
    differences.push(difference);
  };

  const active = snapshot.primary === "UPDATING" || snapshot.primary === "CANCELLING";
  const indeterminate = snapshot.write.work.kind === "indeterminate";

  // 1. Work required — D1 (controller) vs snapshot.write.updateRequired
  if (!snapshot.write.applicable) {
    if (legacy.controllerWorkAvailable === true) {
      push({
        area: "work",
        property: "updateRequired",
        legacyValue: true,
        snapshotValue: false,
        description: `Legacy reports pending work but the snapshot marks the ${describeIsolation(decision)}`,
        severity: "info",
      });
    }
  } else if (indeterminate) {
    if (legacy.controllerWorkAvailable !== undefined) {
      push({
        area: "work",
        property: "updateRequired",
        legacyValue: legacy.controllerWorkAvailable,
        snapshotValue: "indeterminate",
        description: "Snapshot classifies the canonical state as indeterminate while legacy reports a definite answer",
        severity: "warning",
      });
    }
    if (legacy.workflowStatus === "idle") {
      push({
        area: "primary",
        property: "indeterminate-as-idle",
        legacyValue: legacy.workflowStatus,
        snapshotValue: snapshot.primary,
        description: "Legacy workflow coerces an indeterminate canonical state into idle (never READY in the snapshot)",
        severity: "divergence",
      });
    }
  } else if (legacy.controllerWorkAvailable === undefined) {
    push({
      area: "work",
      property: "updateRequired",
      legacyValue: undefined,
      snapshotValue: snapshot.write.updateRequired,
      description: "Legacy work availability is unknown while the snapshot reports a definite answer",
      severity: "warning",
    });
  } else if (legacy.controllerWorkAvailable !== snapshot.write.updateRequired) {
    push({
      area: "work",
      property: "updateRequired",
      legacyValue: legacy.controllerWorkAvailable,
      snapshotValue: snapshot.write.updateRequired,
      description: `Legacy workAvailable is ${legacy.controllerWorkAvailable} while snapshot updateRequired is ${snapshot.write.updateRequired}`,
      severity: "divergence",
    });
  }

  // 2. Execution predicates — D4 (policy) and D5 (scheduler) vs snapshot.write.updateRequired
  if (snapshot.write.applicable && !indeterminate) {
    const predicates: Array<[string, boolean | undefined]> = [
      ["policyPending", legacy.policyPending],
      ["schedulerPending", legacy.schedulerPending],
    ];
    for (const [property, value] of predicates) {
      if (value !== undefined && value !== snapshot.write.updateRequired) {
        push({
          area: "work",
          property,
          legacyValue: value,
          snapshotValue: snapshot.write.updateRequired,
          description: `Legacy ${property} is ${value} while snapshot updateRequired is ${snapshot.write.updateRequired}`,
          severity: "divergence",
        });
      }
    }
  }

  // 3. Plan mode vs snapshot work mode
  if (snapshot.write.applicable && legacy.planMode !== undefined) {
    const snapshotMode = snapshot.write.work.mode;
    const kind = snapshot.write.work.kind;
    const consistentMode =
      legacy.planMode === "indeterminate"
        ? kind === "indeterminate"
        : legacy.planMode === "initial-build"
        ? snapshotMode === "initial-build" || kind === "none"
        : legacy.planMode === "full-rebuild"
        ? snapshotMode === "full-rebuild"
        : kind === "indeterminate"
        ? false
        : snapshotMode === undefined || snapshotMode === "incremental" || snapshotMode === "publish-only";
    if (!consistentMode) {
      push({
        area: "mode",
        property: "workMode",
        legacyValue: legacy.planMode,
        snapshotValue: snapshotMode ?? kind,
        description: `Update plan mode "${legacy.planMode}" is not represented by snapshot work (${snapshotMode ?? kind})`,
        severity: "divergence",
      });
    }
  }

  // 4. Recommended action — D3 (Sidebar button) vs snapshot action
  const snapshotOffersAction = decision.canExecute && OFFERED_ACTIONS.includes(decision.action);
  if (legacy.sidebarButtonVisible !== snapshotOffersAction) {
    push({
      area: "action",
      property: "updateAction",
      legacyValue: legacy.sidebarButtonVisible,
      snapshotValue: snapshotOffersAction ? decision.action : "none",
      description: legacy.sidebarButtonVisible
        ? `Legacy Sidebar offers an update action but the snapshot does not (${decision.blockedReason ?? decision.primary})`
        : `Snapshot offers "${decision.action}" but the legacy Sidebar button is hidden`,
      severity: snapshot.write.applicable || legacy.sidebarButtonVisible ? "divergence" : "info",
    });
  }

  // 5. Confirmation — legacy policy vs derived confirmation
  const executes = decision.action === "generate" || decision.action === "update" ||
    decision.action === "rebuild" || decision.action === "retry";
  if (executes && legacy.policyRequiresConfirmation !== undefined &&
    legacy.policyRequiresConfirmation !== decision.requiresConfirmation) {
    push({
      area: "confirmation",
      property: "requiresConfirmation",
      legacyValue: legacy.policyRequiresConfirmation,
      snapshotValue: decision.requiresConfirmation,
      description: legacy.policyRequiresConfirmation
        ? "Legacy manual policy confirms a local update that the snapshot does not require to confirm"
        : "Snapshot requires confirmation where the legacy policy would proceed",
      severity: legacy.policyRequiresConfirmation ? "info" : "warning",
    });
  }

  // 6. Process — legacy workflow/operation vs snapshot.process
  const expectedPhase = expectedLegacyProcessPhase(legacy.workflowStatus);
  if (expectedPhase === "derived-copy") {
    push({
      area: "process",
      property: "phase",
      legacyValue: legacy.workflowStatus,
      snapshotValue: snapshot.process.phase,
      description: "Legacy 'finalizing' reflects the derived binary copy, which the snapshot does not model as embedding process",
      severity: "info",
    });
  } else if (expectedPhase !== undefined && expectedPhase !== snapshot.process.phase) {
    const cancellingAsPreparing = expectedPhase === "preparing" && snapshot.process.phase === "cancelling";
    push({
      area: "process",
      property: "phase",
      legacyValue: legacy.workflowStatus,
      snapshotValue: snapshot.process.phase,
      description: cancellingAsPreparing
        ? "Legacy workflow reports 'cancelling' as 'preparing'"
        : `Legacy workflow status "${legacy.workflowStatus}" does not match snapshot process phase "${snapshot.process.phase}"`,
      severity: cancellingAsPreparing ? "info" : "divergence",
    });
  }

  if (inputs.operationState && active) {
    if (legacy.operationCancellable !== snapshot.process.cancellable) {
      push({
        area: "process",
        property: "cancellable",
        legacyValue: legacy.operationCancellable,
        snapshotValue: snapshot.process.cancellable,
        description: "Cancellability differs between the legacy operation and the snapshot",
        severity: "divergence",
      });
    }
    const progress = snapshot.process.progress;
    if (
      progress &&
      (progress.processed !== inputs.operationState.processedChunks ||
        progress.total !== (inputs.operationState.totalChunks ?? undefined))
    ) {
      push({
        area: "process",
        property: "progress",
        legacyValue: `${inputs.operationState.processedChunks}/${inputs.operationState.totalChunks ?? "?"}`,
        snapshotValue: `${progress.processed}/${progress.total}`,
        description: "Operation progress is not preserved by the snapshot",
        severity: "divergence",
      });
    }
  }

  // 7. Authority — write authority lost while an operation is still active
  if (decision.ownershipLostDuringOperation) {
    push({
      area: "authority",
      property: "ownershipLostDuringOperation",
      legacyValue: legacy.operationStatus,
      snapshotValue: snapshot.capability.blockedReason,
      description: "An embedding operation is active but this device no longer holds write authority; legacy keeps reporting the operation as normal",
      severity: "divergence",
    });
  }

  // 8. Error — legacy error vs snapshot ERROR
  if (legacy.workflowStatus === "error" && snapshot.primary !== "ERROR") {
    push({
      area: "primary",
      property: "error",
      legacyValue: legacy.workflowStatus,
      snapshotValue: snapshot.primary,
      description: "Legacy workflow reports an error that the snapshot does not represent (e.g. work-status refresh failure)",
      severity: "warning",
    });
  }

  // 9. History — producer-state telemetry vs snapshot.history
  if (legacy.producerHasError !== Boolean(snapshot.history.lastFailure)) {
    push({
      area: "history",
      property: "lastFailure",
      legacyValue: legacy.producerHasError,
      snapshotValue: Boolean(snapshot.history.lastFailure),
      description: "Producer-state failure telemetry and snapshot history disagree",
      severity: "info",
    });
  }
  if ((legacy.producerLastSuccessAt ?? undefined) !== snapshot.history.lastSuccess?.at) {
    push({
      area: "history",
      property: "lastSuccess",
      legacyValue: legacy.producerLastSuccessAt,
      snapshotValue: snapshot.history.lastSuccess?.at,
      description: "Producer-state last publication and snapshot history disagree",
      severity: "info",
    });
  }

  return {
    legacy,
    snapshot,
    decision,
    differences,
    consistent: !differences.some((difference) => difference.severity === "divergence"),
  };
}

/**
 * Builds the canonical snapshot from the current state (using the runtime plan when available)
 * and compares it with the legacy Write Path decisions. Pure; performs no I/O.
 */
export function createEmbeddingWritePathShadowComparison(
  inputs: EmbeddingWritePathShadowInputs
): EmbeddingWritePathShadowResult {
  const updatePlan = inputs.updatePlan ?? inputs.workState?.summary?.updatePlan ?? null;
  const workStatus = inputs.workState?.status;
  const factsChecking = inputs.factsChecking ??
    (workStatus === "unknown" || workStatus === "dirty" || workStatus === "calculating");
  const snapshot = adaptCurrentStateToLifecycleSnapshot({ ...inputs, updatePlan, factsChecking });
  return compareLegacyWritePathWithLifecycle({ ...inputs, updatePlan }, snapshot);
}
