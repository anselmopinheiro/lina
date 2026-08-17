import {
  BinaryEmbeddingCopySummary,
} from "../index/embeddingBinaryCopyController";
import { DeviceCapabilities } from "../capabilities/deviceCapabilities";

export type BinaryWorkerStatus = "idle" | "compiling-binary";
export type BinaryWorkerTask = "check" | "create-or-update" | "remove" | "published-maintenance";

export interface BinaryWorkerState {
  readonly status: BinaryWorkerStatus;
  readonly activeTask: BinaryWorkerTask | null;
  readonly lastError: string | null;
}

export interface BinaryWorkerOptions {
  readonly capabilities: DeviceCapabilities;
  readonly isAutomaticMaintenanceEnabled: () => boolean;
  readonly check: () => Promise<BinaryEmbeddingCopySummary>;
  readonly createOrUpdate: () => Promise<BinaryEmbeddingCopySummary>;
  readonly remove: () => Promise<void>;
  readonly maintainAfterPublication: (publicationId: string) => Promise<BinaryEmbeddingCopySummary>;
  readonly onBinaryPublicationReady: () => void;
  readonly onAutomaticMaintenanceFailure: (summary: BinaryEmbeddingCopySummary) => void;
}

/**
 * Coordinates the derived binary artifact only. Canonical embedding
 * generation and publication remain upstream responsibilities.
 */
export class BinaryWorker {
  private started = false;
  private disposed = false;
  private state: BinaryWorkerState = {
    status: "idle",
    activeTask: null,
    lastError: null,
  };

  constructor(private readonly options: BinaryWorkerOptions) {}

  isStarted(): boolean {
    return this.started;
  }

  getState(): BinaryWorkerState {
    return { ...this.state };
  }

  start(): void {
    if (this.disposed || !this.options.capabilities.canMaintainBinaryCopy) {
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

  async check(): Promise<BinaryEmbeddingCopySummary> {
    if (!this.options.capabilities.canReadArtifacts) {
      return { status: "error", reason: "Cópia binária indisponível neste dispositivo." };
    }
    return this.run("check", this.options.check);
  }

  async createOrUpdate(): Promise<BinaryEmbeddingCopySummary | undefined> {
    if (!this.canMaintain()) {
      return undefined;
    }
    return this.run("create-or-update", this.options.createOrUpdate, true);
  }

  async remove(): Promise<boolean> {
    if (!this.canMaintain()) {
      return false;
    }
    await this.run("remove", async () => {
      await this.options.remove();
      return { status: "absent" };
    }, true);
    return true;
  }

  maintainAfterPublication(publicationId: string | undefined): void {
    if (!this.canMaintain() || !this.options.isAutomaticMaintenanceEnabled()) {
      return;
    }
    if (!publicationId) {
      console.warn("Lina: canonical publication completed without a publication id; derived binary maintenance was skipped.");
      return;
    }
    void this.run(
      "published-maintenance",
      () => this.options.maintainAfterPublication(publicationId),
    ).then((summary) => {
      if (summary.status === "valid") {
        this.options.onBinaryPublicationReady();
        return;
      }
      this.options.onAutomaticMaintenanceFailure(summary);
    });
  }

  private canMaintain(): boolean {
    return this.started && this.options.capabilities.canMaintainBinaryCopy;
  }

  private async run(
    task: BinaryWorkerTask,
    operation: () => Promise<BinaryEmbeddingCopySummary>,
    invalidatesRuntimeIndex = false,
  ): Promise<BinaryEmbeddingCopySummary> {
    this.state = { status: "compiling-binary", activeTask: task, lastError: null };
    try {
      const summary = await operation();
      if (invalidatesRuntimeIndex) {
        this.options.onBinaryPublicationReady();
      }
      this.state = {
        status: "idle",
        activeTask: null,
        lastError: summary.status === "error" ? summary.reason ?? "binary-maintenance-failed" : null,
      };
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { status: "idle", activeTask: null, lastError: message };
      throw error;
    }
  }
}
