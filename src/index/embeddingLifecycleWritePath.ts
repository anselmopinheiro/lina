import {
  EmbeddingLifecycleSnapshot,
  EmbeddingLifecycleStatus,
  EmbeddingWorkCost,
  EmbeddingWorkExecutionMode,
  EmbeddingWorkKind,
  EmbeddingWorkSeverity,
  ProcessPhase,
} from "./embeddingLifecycleModel";

// ---------------------------------------------------------------------------
// Canonical Write Path decision (derived from the snapshot only)
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

export type OperationStartBlockReason =
  | "ownership-lost"
  | "not-applicable"
  | "companion"
  | "indeterminate"
  | "confirmation-required";

export type OperationStartGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: OperationStartBlockReason };

/**
 * Single rule set deciding whether an embedding operation may START, shared by the Worker
 * (pre-validation) and the Operation Manager (last barrier). It only reads the canonical decision.
 *
 * Start is refused when write authority is missing or lost (Companion, Standby, Unassigned,
 * disabled), when the canonical state is indeterminate (never treated as "normal"), or when the
 * recommended action needs explicit user confirmation but the request is automatic.
 */
export function evaluateOperationStartGate(
  decision: EmbeddingWritePathDecision,
  origin: "command" | "sidebar" | "internal" | "automatic"
): OperationStartGate {
  if (decision.ownershipLostDuringOperation) {
    return { allowed: false, reason: "ownership-lost" };
  }
  if (!decision.applicable) {
    return { allowed: false, reason: decision.blockedReason === "companion" ? "companion" : "not-applicable" };
  }
  if (decision.primary === "INDETERMINATE" || decision.workKind === "indeterminate") {
    return { allowed: false, reason: "indeterminate" };
  }
  if (decision.requiresConfirmation && origin === "automatic") {
    return { allowed: false, reason: "confirmation-required" };
  }
  return { allowed: true };
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
