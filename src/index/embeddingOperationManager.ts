export type EmbeddingOperationOrigin = "command" | "sidebar" | "internal";

export type EmbeddingOperationStatus = "idle" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
export type EmbeddingOperationPhase =
  | "preparing"
  | "waiting-for-text-index"
  | "validating"
  | "generating"
  | "persisting"
  | "completed"
  | "failed"
  | "cancelled";

export interface EmbeddingOperationProgress {
  totalChunks: number;
  processedChunks: number;
  generatedChunks: number;
  failedChunks: number;
  reusedChunks: number;
  currentChunk: number | null;
}

export interface EmbeddingOperationRunResult {
  success: boolean;
  message: string;
  cancelled?: boolean;
}

export interface EmbeddingOperationState {
  operationId: number | null;
  origin: EmbeddingOperationOrigin | null;
  status: EmbeddingOperationStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  error: string | null;
  phase: EmbeddingOperationPhase | null;
  totalChunks: number | null;
  processedChunks: number;
  generatedChunks: number;
  failedChunks: number;
  reusedChunks: number;
  percentage: number | null;
  currentChunk: number | null;
  cancelRequestedAt: string | null;
}

export interface EmbeddingOperationContext {
  readonly operationId: number;
  readonly signal: AbortSignal;
  setPhase(phase: EmbeddingOperationPhase, message?: string): void;
  setProgress(progress: Partial<EmbeddingOperationProgress>): void;
}

export interface EmbeddingOperationCompletion {
  state: EmbeddingOperationState;
  result: EmbeddingOperationRunResult;
}

export type EmbeddingOperationRequestResult =
  | {
    status: "accepted";
    state: EmbeddingOperationState;
    completion: Promise<EmbeddingOperationCompletion>;
  }
  | {
    status: "already-running" | "disposed";
    state: EmbeddingOperationState;
  };

export type EmbeddingOperationCancelResult =
  | "cancel-requested"
  | "no-active-operation"
  | "already-cancelling"
  | "disposed";

function createIdleState(): EmbeddingOperationState {
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
  };
}

function sanitizeMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 300 ? `${normalized.slice(0, 297)}...` : normalized;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeMessage(error.message) ?? "Unknown embedding operation error.";
  }

  return sanitizeMessage(String(error)) ?? "Unknown embedding operation error.";
}

export class EmbeddingOperationManager {
  private listeners = new Set<(state: EmbeddingOperationState) => void>();
  private currentState: EmbeddingOperationState = createIdleState();
  private activePromise: Promise<EmbeddingOperationCompletion> | null = null;
  private activeAbortController: AbortController | null = null;
  private nextOperationId = 0;
  private disposed = false;

  getState(): EmbeddingOperationState {
    return { ...this.currentState };
  }

  subscribe(listener: (state: EmbeddingOperationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.cancelActiveOperation();
    this.disposed = true;
    this.listeners.clear();
  }

  cancelActiveOperation(operationId?: number, message?: string): EmbeddingOperationCancelResult {
    if (this.disposed) {
      return "disposed";
    }

    if (!this.activePromise || !this.activeAbortController) {
      return "no-active-operation";
    }

    if (operationId !== undefined && this.currentState.operationId !== operationId) {
      return "no-active-operation";
    }

    if (this.currentState.status === "cancelling") {
      return "already-cancelling";
    }

    if (this.currentState.status !== "running") {
      return "no-active-operation";
    }

    const cancelRequestedAt = new Date().toISOString();
    this.updateState({
      ...this.currentState,
      status: "cancelling",
      message: sanitizeMessage(message ?? "Embedding generation cancellation requested."),
      cancelRequestedAt,
    });
    this.activeAbortController.abort();
    return "cancel-requested";
  }

  request(
    origin: EmbeddingOperationOrigin,
    runner: (context: EmbeddingOperationContext) => Promise<EmbeddingOperationRunResult>
  ): EmbeddingOperationRequestResult {
    if (this.disposed) {
      return {
        status: "disposed",
        state: this.getState(),
      };
    }

    if (this.activePromise) {
      return {
        status: "already-running",
        state: this.getState(),
      };
    }

    const operationId = ++this.nextOperationId;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    this.updateState({
      operationId,
      origin,
      status: "running",
      startedAt,
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
    });

    const completion = (async (): Promise<EmbeddingOperationCompletion> => {
      try {
        const result = await runner({
          operationId,
          signal: abortController.signal,
          setPhase: (phase, message) => {
            if (
              this.disposed
              || this.currentState.operationId !== operationId
              || (this.currentState.status !== "running" && this.currentState.status !== "cancelling")
            ) {
              return;
            }
            this.updateState({
              ...this.currentState,
              phase,
              message: sanitizeMessage(message),
              error: null,
            });
          },
          setProgress: (progress) => {
            if (
              this.disposed
              ||
              this.currentState.operationId !== operationId
              || (this.currentState.status !== "running" && this.currentState.status !== "cancelling")
            ) {
              return;
            }

            const totalChunks = progress.totalChunks ?? this.currentState.totalChunks;
            const processedChunks = clampProgressCount(
              Math.max(progress.processedChunks ?? this.currentState.processedChunks, this.currentState.processedChunks),
              totalChunks
            );
            const generatedChunks = Math.max(progress.generatedChunks ?? this.currentState.generatedChunks, 0);
            const failedChunks = Math.max(progress.failedChunks ?? this.currentState.failedChunks, 0);
            const reusedChunks = Math.max(progress.reusedChunks ?? this.currentState.reusedChunks, 0);
            const currentChunk = progress.currentChunk === undefined
              ? this.currentState.currentChunk
              : progress.currentChunk;

            this.updateState({
              ...this.currentState,
              totalChunks,
              processedChunks,
              generatedChunks,
              failedChunks,
              reusedChunks,
              currentChunk,
              percentage: calculatePercentage(processedChunks, totalChunks),
            });
          },
        });
        const message = sanitizeMessage(result.message);
        const finishedAt = new Date().toISOString();

        if (this.disposed || this.currentState.operationId !== operationId) {
          return {
            state: this.getState(),
            result,
          };
        }

        if (result.cancelled) {
          this.updateState({
            ...this.currentState,
            operationId,
            origin,
            status: "cancelled",
            startedAt,
            finishedAt,
            message,
            error: null,
            phase: "cancelled",
          });
        } else if (result.success) {
          this.updateState({
            ...this.currentState,
            operationId,
            origin,
            status: "completed",
            startedAt,
            finishedAt,
            message,
            error: null,
            phase: "completed",
          });
        } else {
          this.updateState({
            ...this.currentState,
            operationId,
            origin,
            status: "failed",
            startedAt,
            finishedAt,
            message: null,
            error: message ?? "Embedding operation failed.",
            phase: "failed",
          });
        }

        return {
          state: this.getState(),
          result,
        };
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Lina: embedding operation failed:", error);
        }
        const sanitizedError = sanitizeError(error);
        const finishedAt = new Date().toISOString();

        const cancelled = abortController.signal.aborted;

        if (!this.disposed && this.currentState.operationId === operationId) {
          this.updateState({
            ...this.currentState,
            operationId,
            origin,
            status: cancelled ? "cancelled" : "failed",
            startedAt,
            finishedAt,
            message: cancelled ? sanitizedError : null,
            error: cancelled ? null : sanitizedError,
            phase: cancelled ? "cancelled" : "failed",
          });
        }

        return {
          state: this.getState(),
          result: {
            success: false,
            message: sanitizedError,
            cancelled,
          },
        };
      } finally {
        this.activePromise = null;
        if (this.currentState.operationId === operationId) {
          this.activeAbortController = null;
        }
      }
    })();

    this.activePromise = completion;

    return {
      status: "accepted",
      state: this.getState(),
      completion,
    };
  }

  private updateState(nextState: EmbeddingOperationState): void {
    this.currentState = nextState;
    const snapshot = this.getState();

    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function clampProgressCount(value: number, totalChunks: number | null): number {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (typeof totalChunks !== "number" || totalChunks < 0) {
    return normalized;
  }

  return Math.min(normalized, totalChunks);
}

function calculatePercentage(processedChunks: number, totalChunks: number | null): number | null {
  if (typeof totalChunks !== "number" || totalChunks <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.floor((processedChunks / totalChunks) * 100)));
}
