import { DeviceCapabilities } from "../capabilities/deviceCapabilities";

export type ReconciliationWorkerStatus = "idle" | "reconciling";

export interface ReconciliationWorkerState {
  readonly status: ReconciliationWorkerStatus;
  readonly activeTask: "startup" | "exclusions" | null;
  readonly lastError: string | null;
}

export interface ReconciliationWorkerOptions {
  readonly capabilities: DeviceCapabilities;
  readonly runStartupReconciliation: () => Promise<void>;
  readonly runExclusionReconciliation: () => Promise<void>;
  readonly waitForAutomaticUpdates: () => Promise<void>;
}

/**
 * Coordinates producer-side reconciliation workflows while keeping the
 * existing reconciliation algorithms behind injected host ports.
 */
export class ReconciliationWorker {
  private started = false;
  private disposed = false;
  private exclusionReconciliationPromise: Promise<void> = Promise.resolve();
  private state: ReconciliationWorkerState = {
    status: "idle",
    activeTask: null,
    lastError: null,
  };

  constructor(private readonly options: ReconciliationWorkerOptions) {}

  isStarted(): boolean {
    return this.started;
  }

  getState(): ReconciliationWorkerState {
    return { ...this.state };
  }

  async runStartupReconciliation(): Promise<boolean> {
    return this.run("startup", this.options.runStartupReconciliation);
  }

  async runExclusionReconciliation(): Promise<boolean> {
    if (!this.started || !this.options.capabilities.canReconcileStartupDiffs) {
      return false;
    }
    const previous = this.exclusionReconciliationPromise;
    const reconciliation = previous.then(async () => {
      await this.options.waitForAutomaticUpdates();
      await this.run("exclusions", this.options.runExclusionReconciliation);
    });
    this.exclusionReconciliationPromise = reconciliation.catch(() => undefined);
    await reconciliation;
    return true;
  }

  start(): void {
    if (this.disposed || !this.options.capabilities.canReconcileStartupDiffs) {
      return;
    }
    this.started = true;
  }

  stop(): void {
    this.started = false;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.stop();
    this.disposed = true;
  }

  private async run(
    task: "startup" | "exclusions",
    execute: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.started || !this.options.capabilities.canReconcileStartupDiffs) {
      return false;
    }

    this.state = { status: "reconciling", activeTask: task, lastError: null };
    try {
      await execute();
      this.state = { status: "idle", activeTask: null, lastError: null };
      return true;
    } catch (error) {
      this.state = {
        status: "idle",
        activeTask: null,
        lastError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }
}
