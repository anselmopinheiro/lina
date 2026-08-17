import { DeviceCapabilities } from "../capabilities/deviceCapabilities";

export type EmbeddingWorkerStatus = "idle" | "running" | "error";

export interface EmbeddingWorkerState {
	readonly status: EmbeddingWorkerStatus;
	readonly lastError: string | null;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : "future-maintenance-failed";
}

/**
 * Lifecycle and state boundary for future producer-side embedding
 * maintenance. This foundation intentionally owns no provider, storage,
 * checkpoint, publication, or execution dependency.
 */
export class EmbeddingWorker {
  private started = false;
  private disposed = false;
  private state: EmbeddingWorkerState = { status: "idle", lastError: null };

  constructor(private readonly capabilities: DeviceCapabilities) {}

  isStarted(): boolean {
    return this.started;
  }

  getState(): EmbeddingWorkerState {
    return { ...this.state };
  }

  start(): void {
    if (this.disposed || !this.capabilities.canGenerateEmbeddings) {
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
    if (!this.started || this.state.status === "running") {
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
