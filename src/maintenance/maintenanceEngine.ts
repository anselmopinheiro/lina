import { DeviceCapabilities } from "../capabilities/deviceCapabilities";

export type MaintenanceEngineStatus = "idle" | "running" | "error";

export type MaintenanceOperation =
  | "vault-events"
  | "text-index"
  | "startup-reconciliation"
  | "embeddings"
  | "binary-copy";

export interface MaintenanceEngineState {
  readonly status: MaintenanceEngineStatus;
  readonly activeTask: string | null;
  readonly lastError: string | null;
}

export interface MaintenanceEngineOptions {
  readonly capabilities: DeviceCapabilities;
}

/**
 * Coordination boundary for producer-side maintenance.
 *
 * This foundation owns no workers or timers yet. Existing maintenance flows
 * remain in LinaPlugin until a later extraction phase moves them here.
 */
export class MaintenanceEngine {
  private started = false;
  private disposed = false;
  private state: MaintenanceEngineState = {
    status: "idle",
    activeTask: null,
    lastError: null,
  };

  constructor(private readonly options: MaintenanceEngineOptions) {}

  getCapabilities(): DeviceCapabilities {
    return this.options.capabilities;
  }

  getState(): MaintenanceEngineState {
    return { ...this.state };
  }

  isStarted(): boolean {
    return this.started;
  }

  canRun(operation: MaintenanceOperation): boolean {
    const capabilities = this.options.capabilities;
    switch (operation) {
      case "vault-events":
        return capabilities.canWatchVaultEvents && capabilities.canMaintainTextIndex;
      case "text-index":
        return capabilities.canMaintainTextIndex;
      case "startup-reconciliation":
        return capabilities.canReconcileStartupDiffs;
      case "embeddings":
        return capabilities.canGenerateEmbeddings;
      case "binary-copy":
        return capabilities.canMaintainBinaryCopy;
    }
  }

  start(): void {
    if (this.disposed) {
      return;
    }
    this.started = true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.started = false;
    this.disposed = true;
  }
}
