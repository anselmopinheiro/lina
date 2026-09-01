import {
  EmbeddingOperationCancelResult,
  EmbeddingOperationContext,
  EmbeddingOperationManager,
  EmbeddingOperationOrigin,
  EmbeddingOperationRequestResult,
  EmbeddingOperationState,
} from "../index/embeddingOperationManager";
import { IndexWriteCoordinatorResult, IndexWriteCoordinatorToken } from "../index/indexWriteCoordinator";

export type EmbeddingWorkerStatus = "idle" | "running" | "error";

export interface EmbeddingWorkerState {
  readonly status: EmbeddingWorkerStatus;
  readonly lastError: string | null;
}

export interface EmbeddingWorkerGenerationResult {
  readonly success: boolean;
  readonly message: string;
  readonly cancelled?: boolean;
  readonly publicationId?: string;
}

export interface EmbeddingWorkerCapabilityPort {
  readonly canGenerateEmbeddings: () => boolean;
  readonly canPublish?: () => boolean;
}

export interface EmbeddingWorkerGenerationServicePort {
  readonly generate: (
    operation: EmbeddingOperationContext,
    onProgress?: (message: string) => void,
  ) => Promise<EmbeddingWorkerGenerationResult>;
}

/** The existing generator owns checkpointing and canonical publication. */
export interface EmbeddingWorkerPersistencePort {
  readonly onGenerationFinalized: (result: EmbeddingWorkerGenerationResult) => void;
}

export interface EmbeddingWorkerStatusNotificationPort {
  readonly notify: (state: EmbeddingWorkerState) => void;
}

export interface EmbeddingWorkerBinaryHandoffPort {
  readonly maintainAfterPublication: (publicationId?: string) => void;
}

export interface EmbeddingWorkerCoordinatorPort {
  readonly requestPreparation: () => IndexWriteCoordinatorResult;
  readonly cancelPreparation: () => void;
  readonly startGeneration: () => IndexWriteCoordinatorResult;
  readonly finish: (token: IndexWriteCoordinatorToken | undefined) => void;
}

export interface EmbeddingWorkerMessages {
  readonly preparing: string;
  readonly waitingForTextIndex: string;
  readonly cancelled: string;
  readonly blockedByTextIndex: (result: IndexWriteCoordinatorResult) => string;
  readonly generalError: string;
  readonly cancelling: string;
}

export interface EmbeddingWorkerOptions {
  readonly capabilities?: EmbeddingWorkerCapabilityPort;
  readonly canPublish?: () => boolean;
  readonly isTextIndexBusy?: () => boolean;
  readonly drainTextIndex?: (signal?: AbortSignal) => Promise<boolean>;
  readonly scheduleTextIndexFlush?: () => void;
  readonly coordinator?: EmbeddingWorkerCoordinatorPort;
  readonly generationService?: EmbeddingWorkerGenerationServicePort;
  readonly persistence?: EmbeddingWorkerPersistencePort;
  readonly statusNotifications?: EmbeddingWorkerStatusNotificationPort;
  readonly binaryHandoff?: EmbeddingWorkerBinaryHandoffPort;
  readonly messages?: EmbeddingWorkerMessages;
}

export type EmbeddingWorkerDependency =
  | "capabilities"
  | "text-index-status"
  | "text-index-drain"
  | "text-index-flush"
  | "coordinator"
  | "generation-service"
  | "persistence"
  | "status-notifications"
  | "binary-handoff"
  | "messages";

export type EmbeddingWorkerRequestResult =
  | EmbeddingOperationRequestResult
  | { status: "text-index-busy" | "not-capable" | "not-active-producer"; state: EmbeddingOperationState };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "embedding-maintenance-failed";
}

/** Producer-side embedding maintenance owner with host-injected ports. */
export class EmbeddingWorker {
  private started = false;
  private disposed = false;
  private state: EmbeddingWorkerState = { status: "idle", lastError: null };
  private readonly operationManager = new EmbeddingOperationManager();

  constructor(private readonly options: EmbeddingWorkerOptions) {}

  isStarted(): boolean { return this.started; }

  getState(): EmbeddingWorkerState { return { ...this.state }; }

  getOperationState(): EmbeddingOperationState { return this.operationManager.getState(); }

  subscribeToOperationState(listener: (state: EmbeddingOperationState) => void): () => void {
    return this.operationManager.subscribe(listener);
  }

  getMissingDependencies(): readonly EmbeddingWorkerDependency[] {
    const missing: EmbeddingWorkerDependency[] = [];
    if (typeof this.options.capabilities?.canGenerateEmbeddings !== "function") missing.push("capabilities");
    if (typeof this.options.isTextIndexBusy !== "function") missing.push("text-index-status");
    if (typeof this.options.drainTextIndex !== "function") missing.push("text-index-drain");
    if (typeof this.options.scheduleTextIndexFlush !== "function") missing.push("text-index-flush");
    if (!this.hasCoordinator()) missing.push("coordinator");
    if (typeof this.options.generationService?.generate !== "function") missing.push("generation-service");
    if (typeof this.options.persistence?.onGenerationFinalized !== "function") missing.push("persistence");
    if (typeof this.options.statusNotifications?.notify !== "function") missing.push("status-notifications");
    if (typeof this.options.binaryHandoff?.maintainAfterPublication !== "function") missing.push("binary-handoff");
    if (!this.hasMessages()) missing.push("messages");
    return missing;
  }

  isExecutionPrepared(): boolean { return this.getMissingDependencies().length === 0; }

  start(): void {
    if (!this.disposed && this.options.capabilities?.canGenerateEmbeddings() === true) this.started = true;
  }

  stop(): void {
    this.started = false;
    if (this.state.status === "running") this.updateState({ status: "idle", lastError: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.operationManager.cancelActiveOperation(undefined, this.options.messages?.cancelling);
    this.operationManager.dispose();
    this.stop();
    this.disposed = true;
  }

  cancelActiveOperation(): EmbeddingOperationCancelResult {
    return this.operationManager.cancelActiveOperation(undefined, this.options.messages?.cancelling);
  }

  requestGeneration(origin: EmbeddingOperationOrigin, onProgress?: (message: string) => void): EmbeddingWorkerRequestResult {
    if (!this.options.capabilities?.canGenerateEmbeddings()) {
      return { status: "not-capable", state: this.operationManager.getState() };
    }
    if (this.options.capabilities?.canPublish && !this.options.capabilities.canPublish()) {
      return { status: "not-active-producer", state: this.operationManager.getState() };
    }
    if (this.options.canPublish && !this.options.canPublish()) {
      return { status: "not-active-producer", state: this.operationManager.getState() };
    }
    this.start();
    if (!this.started || this.disposed || !this.isExecutionPrepared()) {
      return { status: "disposed", state: this.operationManager.getState() };
    }

    const options = this.options as Required<EmbeddingWorkerOptions>;
    if (options.isTextIndexBusy()) return { status: "text-index-busy", state: this.operationManager.getState() };

    const currentState = this.operationManager.getState();
    if (currentState.status === "running" || currentState.status === "cancelling") {
      return { status: "already-running", state: currentState };
    }

    const reservation = options.coordinator.requestPreparation();
    if (reservation.status !== "accepted") {
      return { status: reservation.status === "disposed" ? "disposed" : "text-index-busy", state: currentState };
    }

    const request = this.operationManager.request(origin, async (operation) => {
      let generationToken: IndexWriteCoordinatorToken | undefined;
      let result: EmbeddingWorkerGenerationResult | undefined;
      try {
        this.updateState({ status: "running", lastError: null });
        operation.setPhase("preparing", options.messages.preparing);
        if (operation.signal.aborted) return this.cancelledResult(options.messages.cancelled);

        operation.setPhase("waiting-for-text-index", options.messages.waitingForTextIndex);
        const drained = await options.drainTextIndex(operation.signal);
        if (!drained || operation.signal.aborted) return this.cancelledResult(options.messages.cancelled);

        const activation = options.coordinator.startGeneration();
        if (activation.status !== "accepted" || !activation.token) {
          return { success: false, message: options.messages.blockedByTextIndex(activation) };
        }
        generationToken = activation.token;
        result = await options.generationService.generate(operation, onProgress);
        options.persistence.onGenerationFinalized(result);
      } catch (error) {
        this.updateState({ status: "error", lastError: describeError(error) });
        throw error;
      } finally {
        if (generationToken) options.coordinator.finish(generationToken);
        else options.coordinator.cancelPreparation();
        options.scheduleTextIndexFlush();
      }

      if (result?.success) options.binaryHandoff.maintainAfterPublication(result.publicationId);
      return result ?? { success: false, message: options.messages.generalError };
    });

    if (request.status !== "accepted") {
      options.coordinator.cancelPreparation();
      return request;
    }
    void request.completion.then((completion) => {
      this.updateState(completion.result.success || completion.result.cancelled
        ? { status: "idle", lastError: null }
        : { status: "error", lastError: completion.result.message });
    });
    return request;
  }

  private cancelledResult(message: string): EmbeddingWorkerGenerationResult {
    return { success: false, message, cancelled: true };
  }

  private updateState(nextState: EmbeddingWorkerState): void {
    this.state = nextState;
    this.options.statusNotifications?.notify(this.getState());
  }

  private hasCoordinator(): boolean {
    const port = this.options.coordinator;
    return typeof port?.requestPreparation === "function" && typeof port.cancelPreparation === "function"
      && typeof port.startGeneration === "function" && typeof port.finish === "function";
  }

  private hasMessages(): boolean {
    const port = this.options.messages;
    return typeof port?.preparing === "string" && typeof port.waitingForTextIndex === "string"
      && typeof port.cancelled === "string" && typeof port.blockedByTextIndex === "function"
      && typeof port.generalError === "string" && typeof port.cancelling === "string";
  }
}
