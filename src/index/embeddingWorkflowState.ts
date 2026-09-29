/**
 * Canonical Embedding Workflow State (Phase 0.3.x — LINA-11)
 *
 * Separates the Read Path (Semantic Capability: can we search with current vectors?)
 * from the Write Path (Embedding Workflow: what is the operational situation of embedding updates?).
 */

import { EmbeddingOperationState } from "./embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "./embeddingWorkStatusController";
import { BinaryEmbeddingMaintenancePhase } from "./embeddingBinaryCopyController";

export type EmbeddingWorkflowStatus =
  | "idle"
  | "checking"
  | "update-required"
  | "preparing"
  | "generating"
  | "persisting"
  | "finalizing"
  | "error"
  | "cancelled";

export interface EmbeddingWorkflowState {
  readonly status: EmbeddingWorkflowStatus;
  readonly workAvailable: boolean;
  readonly operationRunning: boolean;
  readonly processedChunks?: number;
  readonly totalChunks?: number;
  readonly message?: string;
  readonly error?: string;
  readonly canUpdate: boolean;
}

export interface ResolveEmbeddingWorkflowInput {
  readonly workState?: EmbeddingWorkRuntimeState;
  readonly operationState?: EmbeddingOperationState;
  readonly binaryMaintenancePhase?: BinaryEmbeddingMaintenancePhase;
  readonly isAuthorizedProducer?: boolean;
  readonly textIndexReady?: boolean;
}

/**
 * Pure resolver for the canonical embedding workflow state.
 *
 * Enforces the core invariant:
 * In manual mode (or when no generation has been confirmed and started):
 * workAvailable === true && generationRunning === false
 * ALWAYS produces status === "update-required" and NEVER "preparing".
 */
export function resolveEmbeddingWorkflowState(
  input: ResolveEmbeddingWorkflowInput
): EmbeddingWorkflowState {
  const {
    workState,
    operationState,
    binaryMaintenancePhase,
    isAuthorizedProducer = false,
    textIndexReady = false,
  } = input;

  const workAvailable = Boolean(workState?.workAvailable);

  // 1. Active Operation running or cancelling
  if (operationState?.status === "running") {
    let status: EmbeddingWorkflowStatus = "generating";
    if (
      operationState.phase === "preparing" ||
      operationState.phase === "waiting-for-text-index" ||
      operationState.phase === "validating"
    ) {
      status = "preparing";
    } else if (operationState.phase === "generating") {
      status = "generating";
    } else if (operationState.phase === "persisting") {
      status = "persisting";
    }

    return {
      status,
      workAvailable,
      operationRunning: true,
      processedChunks: operationState.processedChunks,
      totalChunks: operationState.totalChunks ?? undefined,
      message: operationState.message ?? undefined,
      canUpdate: false,
    };
  }

  if (operationState?.status === "cancelling") {
    return {
      status: "preparing",
      workAvailable,
      operationRunning: true,
      processedChunks: operationState.processedChunks,
      totalChunks: operationState.totalChunks ?? undefined,
      message: operationState.message ?? undefined,
      canUpdate: false,
    };
  }

  // 2. Operation Failed
  if (operationState?.status === "failed") {
    return {
      status: "error",
      workAvailable,
      operationRunning: false,
      error: operationState.error ?? undefined,
      message: operationState.message ?? undefined,
      canUpdate: Boolean(isAuthorizedProducer && textIndexReady),
    };
  }

  // 3. Operation Cancelled
  if (operationState?.status === "cancelled") {
    if (workAvailable) {
      return {
        status: "update-required",
        workAvailable: true,
        operationRunning: false,
        message: operationState.message ?? undefined,
        canUpdate: Boolean(isAuthorizedProducer && textIndexReady),
      };
    }
    return {
      status: "cancelled",
      workAvailable: false,
      operationRunning: false,
      message: operationState.message ?? undefined,
      canUpdate: false,
    };
  }

  // 4. Binary copy maintenance finalizing after canonical generation
  const isBinaryFinalizing =
    binaryMaintenancePhase === "reading-jsonl" ||
    binaryMaintenancePhase === "building" ||
    binaryMaintenancePhase === "digesting" ||
    binaryMaintenancePhase === "publishing" ||
    binaryMaintenancePhase === "validating";

  if (isBinaryFinalizing && !workAvailable) {
    return {
      status: "finalizing",
      workAvailable: false,
      operationRunning: false,
      canUpdate: false,
    };
  }

  // 5. Work state checks
  if (
    !workState ||
    workState.status === "unknown" ||
    workState.status === "dirty" ||
    workState.status === "calculating"
  ) {
    return {
      status: "checking",
      workAvailable: false,
      operationRunning: false,
      canUpdate: false,
    };
  }

  if (workState.status === "error") {
    return {
      status: "error",
      workAvailable,
      operationRunning: false,
      error: workState.errorCategory ?? "error",
      canUpdate: Boolean(isAuthorizedProducer && textIndexReady),
    };
  }

  if (workAvailable) {
    return {
      status: "update-required",
      workAvailable: true,
      operationRunning: false,
      canUpdate: Boolean(isAuthorizedProducer && textIndexReady),
    };
  }

  return {
    status: "idle",
    workAvailable: false,
    operationRunning: false,
    canUpdate: false,
  };
}
