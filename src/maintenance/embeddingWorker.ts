export type EmbeddingWorkerStatus = "idle" | "running" | "error";

export type EmbeddingWorkerDependency =
  | "capabilities"
  | "operation-state"
  | "generation-service"
  | "persistence"
  | "status-notifications"
  | "binary-handoff";

export interface EmbeddingWorkerCapabilityPort {
  readonly canGenerateEmbeddings: () => boolean;
}

export interface EmbeddingWorkerOperationStatePort {
  readonly getState: () => { readonly status: string };
}

/**
 * Future boundary for the generation orchestration currently retained in the
 * plugin host. It is deliberately not called during this extraction phase.
 */
export interface EmbeddingWorkerGenerationServicePort {
  readonly generate: () => Promise<unknown>;
}

/**
 * Future boundary for canonical publication and checkpoint persistence.
 * Existing persistence remains owned by the current generation flow.
 */
export interface EmbeddingWorkerPersistencePort {
  readonly persist: () => Promise<unknown>;
}

export interface EmbeddingWorkerStatusNotificationPort {
  readonly notify: (state: EmbeddingWorkerState) => void;
}

export interface EmbeddingWorkerBinaryHandoffPort {
  readonly maintainAfterPublication: (publicationId?: string) => void;
}

export interface EmbeddingWorkerOptions {
  readonly capabilities?: EmbeddingWorkerCapabilityPort;
  readonly operationState?: EmbeddingWorkerOperationStatePort;
  readonly generationService?: EmbeddingWorkerGenerationServicePort;
  readonly persistence?: EmbeddingWorkerPersistencePort;
  readonly statusNotifications?: EmbeddingWorkerStatusNotificationPort;
  readonly binaryHandoff?: EmbeddingWorkerBinaryHandoffPort;
}

export interface EmbeddingWorkerState {
	readonly status: EmbeddingWorkerStatus;
	readonly lastError: string | null;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : "future-maintenance-failed";
}

/**
 * Lifecycle and state boundary for future producer-side embedding
 * maintenance. Ports make the future execution migration independent of the
 * plugin host, Obsidian UI, and direct application state. This phase does not
 * invoke them or move any current embedding workflow.
 */
export class EmbeddingWorker {
  private started = false;
  private disposed = false;
  private state: EmbeddingWorkerState = { status: "idle", lastError: null };

  constructor(private readonly options: EmbeddingWorkerOptions) {}

  isStarted(): boolean {
    return this.started;
  }

  getState(): EmbeddingWorkerState {
    return { ...this.state };
  }

  getMissingDependencies(): readonly EmbeddingWorkerDependency[] {
    const missing: EmbeddingWorkerDependency[] = [];
    if (typeof this.options.capabilities?.canGenerateEmbeddings !== "function") {
      missing.push("capabilities");
    }
    if (typeof this.options.operationState?.getState !== "function") {
      missing.push("operation-state");
    }
    if (typeof this.options.generationService?.generate !== "function") {
      missing.push("generation-service");
    }
    if (typeof this.options.persistence?.persist !== "function") {
      missing.push("persistence");
    }
    if (typeof this.options.statusNotifications?.notify !== "function") {
      missing.push("status-notifications");
    }
    if (typeof this.options.binaryHandoff?.maintainAfterPublication !== "function") {
      missing.push("binary-handoff");
    }
    return missing;
  }

  isExecutionPrepared(): boolean {
    return this.getMissingDependencies().length === 0;
  }

  start(): void {
    if (this.disposed || this.options.capabilities?.canGenerateEmbeddings() !== true) {
      return;
    }
    this.started = true;
  }

  stop(): void {
    this.started = false;
    if (this.state.status === "running") {
      this.state = { status: "idle", lastError: null };
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.stop();
    this.disposed = true;
  }

  /**
   * Reserves the minimal future-maintenance state without running work. A
   * later execution migration can consume this boundary without taking over
   * current embedding services in this phase.
   */
  beginFutureMaintenance(): boolean {
    if (!this.started || !this.isExecutionPrepared() || this.state.status === "running") {
      return false;
    }
    this.state = { status: "running", lastError: null };
    return true;
  }

  finishFutureMaintenance(error?: unknown): void {
    if (error === undefined) {
      this.state = { status: "idle", lastError: null };
      return;
    }
		this.state = {
			status: "error",
			lastError: describeError(error),
		};
	}
}
