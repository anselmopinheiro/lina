import { DeviceCapabilities } from "../capabilities/deviceCapabilities";
import { BinaryWorker, BinaryWorkerState } from "./binaryWorker";
import {
  EmbeddingWorker,
  EmbeddingWorkerRequestResult,
  EmbeddingWorkerState,
} from "./embeddingWorker";
import { EmbeddingScheduler, EmbeddingSchedulerState } from "./embeddingScheduler";
import {
  EmbeddingOperationCancelResult,
  EmbeddingOperationOrigin,
  EmbeddingOperationState,
} from "../index/embeddingOperationManager";
import { ReconciliationWorker, ReconciliationWorkerState } from "./reconciliationWorker";
import { TextIndexAutomaticUpdate, TextIndexWorker } from "./textIndexWorker";

export type MaintenanceEngineStatus = "idle" | "indexing" | "reconciling" | "compiling-binary" | "error";

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
  readonly canPublish?: () => Promise<boolean> | boolean;
  readonly textIndexWorker?: TextIndexWorker;
  readonly reconciliationWorker?: ReconciliationWorker;
  readonly binaryWorker?: BinaryWorker;
  readonly embeddingWorker?: EmbeddingWorker;
  readonly embeddingScheduler?: EmbeddingScheduler;
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

  async canPublish(): Promise<boolean> {
    if (!this.options.canPublish) {
      return true;
    }
    return Boolean(await this.options.canPublish());
  }

  start(): void {
    if (this.disposed) {
      return;
    }
    this.started = true;
    this.options.textIndexWorker?.start();
    if (this.canRun("startup-reconciliation")) {
      this.options.reconciliationWorker?.start();
    }
    if (this.canRun("binary-copy")) {
      this.options.binaryWorker?.start();
    }
    if (this.canRun("embeddings")) {
      this.options.embeddingWorker?.start();
      this.options.embeddingScheduler?.start();
    }
  }

  refreshTextIndexWorker(): void {
    if (!this.started) {
      return;
    }
    this.options.textIndexWorker?.start();
  }

  stopTextIndexWorker(): void {
    this.options.textIndexWorker?.stop();
  }

  stop(): void {
    this.started = false;
    this.options.textIndexWorker?.stop();
    this.options.reconciliationWorker?.stop();
    this.options.binaryWorker?.stop();
    this.options.embeddingScheduler?.disable();
    this.state = { status: "idle", activeTask: null, lastError: null };
  }

  scheduleTextIndexModify(path: string, run: () => void): void {
    this.options.textIndexWorker?.scheduleModify(path, run);
  }

  getTextIndexWorker(): TextIndexWorker | undefined {
    return this.options.textIndexWorker;
  }

  getReconciliationWorker(): ReconciliationWorker | undefined {
    return this.options.reconciliationWorker;
  }

  getReconciliationState(): ReconciliationWorkerState | undefined {
    return this.options.reconciliationWorker?.getState();
  }

  getBinaryWorker(): BinaryWorker | undefined {
    return this.options.binaryWorker;
  }

  getBinaryState(): BinaryWorkerState | undefined {
    return this.options.binaryWorker?.getState();
  }

  getEmbeddingWorker(): EmbeddingWorker | undefined {
    return this.options.embeddingWorker;
  }

  getEmbeddingState(): EmbeddingWorkerState | undefined {
    return this.options.embeddingWorker?.getState();
  }

  getEmbeddingScheduler(): EmbeddingScheduler | undefined {
    return this.options.embeddingScheduler;
  }

  getEmbeddingSchedulerState(): EmbeddingSchedulerState | undefined {
    return this.options.embeddingScheduler?.getState();
  }

  markEmbeddingSchedulerDirty(): void {
    if (!this.canRun("embeddings")) {
      return;
    }
    this.options.embeddingScheduler?.markDirty();
  }

  preemptEmbeddingSchedulerForManual(): void {
    this.options.embeddingScheduler?.preemptForManual();
  }

  getEmbeddingOperationState(): EmbeddingOperationState {
    return this.requireEmbeddingWorker().getOperationState();
  }

  onEmbeddingOperationStateChange(listener: (state: EmbeddingOperationState) => void): () => void {
    return this.requireEmbeddingWorker().subscribeToOperationState(listener);
  }

  requestEmbeddingGeneration(
    origin: EmbeddingOperationOrigin,
    onProgress?: (message: string) => void,
  ): EmbeddingWorkerRequestResult {
    if (origin !== "automatic") {
      this.preemptEmbeddingSchedulerForManual();
    }
    return this.requireEmbeddingWorker().requestGeneration(origin, onProgress);
  }

  cancelEmbeddingGeneration(): EmbeddingOperationCancelResult {
    return this.requireEmbeddingWorker().cancelActiveOperation();
  }

  checkBinaryCopy() {
    // Validation is read-only and remains available to companions; only
    // producer-side artifact writes require an active worker lifecycle.
    return this.options.binaryWorker?.check() ?? Promise.resolve(undefined);
  }

  createOrUpdateBinaryCopy() {
    return this.runBinaryTask("binary-create-or-update", () =>
      this.options.binaryWorker?.createOrUpdate() ?? Promise.resolve(undefined));
  }

  removeBinaryCopy() {
    return this.runBinaryTask("binary-remove", () =>
      this.options.binaryWorker?.remove() ?? Promise.resolve(undefined));
  }

  maintainBinaryAfterPublication(publicationId: string | undefined): void {
    if (!this.canRun("binary-copy")) {
      return;
    }
    this.options.binaryWorker?.maintainAfterPublication(publicationId);
  }

  /**
   * Repairs the local derived runtime copy for an existing canonical
   * publication. This is intentionally a BinaryWorker-only operation: it
   * never schedules an embedding operation or calls a provider.
   */
  async migrateBinaryArtifactsAtStartup(): Promise<boolean> {
    if (!this.canRun("binary-copy") || !this.options.binaryWorker) {
      return false;
    }
    const worker = this.options.binaryWorker;
    worker.start();
    const current = await worker.check();
    if (current.status === "valid") {
      return true;
    }
    if (!["absent", "outdated", "incomplete", "invalid"].includes(current.status)) {
      return false;
    }
    const repaired = await this.runBinaryTask("binary-artifact-migration", () => worker.createOrUpdate());
    return repaired?.status === "valid";
  }

  async runStartupReconciliation(): Promise<boolean> {
    return this.runReconciliationTask("startup-reconciliation", () =>
      this.options.reconciliationWorker?.runStartupReconciliation() ?? Promise.resolve(false));
  }

  async runExclusionReconciliation(): Promise<boolean> {
    return this.runReconciliationTask("exclusion-reconciliation", () =>
      this.options.reconciliationWorker?.runExclusionReconciliation() ?? Promise.resolve(false));
  }

  queueTextIndexAutomaticUpdate(update: TextIndexAutomaticUpdate): void {
    this.options.textIndexWorker?.queueAutomaticIndexUpdate(update);
  }

  requeueTextIndexAutomaticUpdates(updates: TextIndexAutomaticUpdate[]): void {
    this.options.textIndexWorker?.requeueAutomaticIndexUpdates(updates);
  }

  scheduleTextIndexAutomaticUpdatesFlush(): void {
    this.options.textIndexWorker?.schedulePendingAutomaticUpdatesFlush();
  }

  async processTextIndexAutomaticUpdates(force = false): Promise<void> {
    await this.options.textIndexWorker?.processPendingAutomaticUpdates(force);
  }

  drainTextIndexAutomaticUpdates(signal?: AbortSignal): Promise<boolean> {
    return this.options.textIndexWorker?.drainAutomaticUpdatesBeforeEmbeddingGeneration(signal) ?? Promise.resolve(true);
  }

  async runTextIndexTask<T>(task: () => Promise<T>): Promise<T> {
    if (!this.canRun("text-index")) {
      return task();
    }
    this.state = { status: "indexing", activeTask: "text-index", lastError: null };
    try {
      const result = await task();
      this.state = { status: "idle", activeTask: null, lastError: null };
      return result;
    } catch (error) {
      this.state = {
        status: "error",
        activeTask: null,
        lastError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private async runReconciliationTask(
    taskName: string,
    task: () => Promise<boolean>,
  ): Promise<boolean> {
    if (!this.canRun("startup-reconciliation")) {
      return false;
    }
    // Reconciliation can be invoked by a settings effect before the plugin's
    // normal listener lifecycle starts. Start only this worker here; do not
    // implicitly attach vault listeners.
    this.options.reconciliationWorker?.start();
    this.state = { status: "reconciling", activeTask: taskName, lastError: null };
    try {
      const completed = await task();
      this.state = { status: "idle", activeTask: null, lastError: null };
      return completed;
    } catch (error) {
      this.state = {
        status: "idle",
        activeTask: null,
        lastError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private async runBinaryTask<T>(taskName: string, task: () => Promise<T | undefined>): Promise<T | undefined> {
    if (!this.canRun("binary-copy")) {
      return undefined;
    }
    this.options.binaryWorker?.start();
    this.state = { status: "compiling-binary", activeTask: taskName, lastError: null };
    try {
      const result = await task();
      this.state = { status: "idle", activeTask: null, lastError: null };
      return result;
    } catch (error) {
      this.state = {
        status: "idle",
        activeTask: null,
        lastError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.started = false;
    this.options.textIndexWorker?.dispose();
    this.options.reconciliationWorker?.dispose();
    this.options.binaryWorker?.dispose();
    this.options.embeddingWorker?.dispose();
    this.options.embeddingScheduler?.dispose();
    this.disposed = true;
  }

  private requireEmbeddingWorker(): EmbeddingWorker {
    if (!this.options.embeddingWorker) {
      throw new Error("Embedding worker is unavailable.");
    }
    return this.options.embeddingWorker;
  }
}
