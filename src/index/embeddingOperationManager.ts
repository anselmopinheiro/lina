export type EmbeddingOperationOrigin = "command" | "sidebar" | "internal";

export type EmbeddingOperationStatus = "idle" | "running" | "completed" | "failed";

export interface EmbeddingOperationRunResult {
  success: boolean;
  message: string;
}

export interface EmbeddingOperationState {
  operationId: number | null;
  origin: EmbeddingOperationOrigin | null;
  status: EmbeddingOperationStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  error: string | null;
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

function createIdleState(): EmbeddingOperationState {
  return {
    operationId: null,
    origin: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    message: null,
    error: null,
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
    this.disposed = true;
    this.listeners.clear();
  }

  request(
    origin: EmbeddingOperationOrigin,
    runner: () => Promise<EmbeddingOperationRunResult>
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

    this.updateState({
      operationId,
      origin,
      status: "running",
      startedAt,
      finishedAt: null,
      message: null,
      error: null,
    });

    const completion = (async (): Promise<EmbeddingOperationCompletion> => {
      try {
        const result = await runner();
        const message = sanitizeMessage(result.message);
        const finishedAt = new Date().toISOString();

        if (result.success) {
          this.updateState({
            operationId,
            origin,
            status: "completed",
            startedAt,
            finishedAt,
            message,
            error: null,
          });
        } else {
          this.updateState({
            operationId,
            origin,
            status: "failed",
            startedAt,
            finishedAt,
            message: null,
            error: message ?? "Embedding operation failed.",
          });
        }

        return {
          state: this.getState(),
          result,
        };
      } catch (error) {
        console.error("Lina: embedding operation failed:", error);
        const sanitizedError = sanitizeError(error);
        const finishedAt = new Date().toISOString();

        this.updateState({
          operationId,
          origin,
          status: "failed",
          startedAt,
          finishedAt,
          message: null,
          error: sanitizedError,
        });

        return {
          state: this.getState(),
          result: {
            success: false,
            message: sanitizedError,
          },
        };
      } finally {
        this.activePromise = null;
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
