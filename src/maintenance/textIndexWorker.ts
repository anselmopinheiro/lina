import { DeviceCapabilities } from "../capabilities/deviceCapabilities";
import type { TFile } from "obsidian";
import {
  AutomaticUpdateChangeType,
  coalesceAutomaticUpdateEvent,
  createPathScopedDebouncer,
  PathScopedDebouncer,
} from "../index/automaticUpdateEvents";

export type TextIndexVaultEvent = "create" | "modify" | "delete" | "rename";

export interface TextIndexAutomaticUpdate {
  changeType: AutomaticUpdateChangeType;
  file?: TFile;
  path: string;
  oldPath?: string;
  receivedAt: string;
}

export interface TextIndexAutomaticBatchOptions {
  readonly allowEmbeddingReservation?: boolean;
}

export interface TextIndexWorkerOptions {
  readonly capabilities: DeviceCapabilities;
  readonly isAutomaticUpdateEnabled: () => boolean;
  readonly subscribeVaultEvent: (
    event: TextIndexVaultEvent,
    callback: (file: unknown, oldPath?: string) => void,
  ) => () => void;
  readonly onVaultEvent: (event: TextIndexVaultEvent, file: unknown, oldPath?: string) => void;
  /**
   * Executes an already-coalesced batch. The worker owns when a batch is
   * queued and retried; the host still owns the index read/write algorithm.
   */
  readonly runAutomaticBatch?: (
    updates: TextIndexAutomaticUpdate[],
    options: TextIndexAutomaticBatchOptions,
  ) => Promise<boolean>;
  readonly drainAutomaticBatch?: (updates: TextIndexAutomaticUpdate[]) => Promise<void>;
  readonly canFlushAutomaticUpdates?: () => boolean;
  readonly canPublish?: () => boolean | Promise<boolean>;
  readonly timers: {
    readonly setTimeout: (callback: () => void, delay: number) => number;
    readonly clearTimeout: (timeoutId: number) => void;
  };
}

/**
 * Owns the text-index ingestion lifecycle. Existing index algorithms remain
 * behind its injected callbacks during this first migration step.
 */
export class TextIndexWorker {
  private started = false;
  private listeners: Array<() => void> = [];
  private modifyDebouncer?: PathScopedDebouncer<() => void>;
  private automaticUpdatesReady = false;
  private automaticUpdateInProgress = false;
  private automaticUpdatePending = false;
  private automaticUpdatePromise: Promise<void> | null = null;
  private pendingAutomaticUpdates = new Map<string, TextIndexAutomaticUpdate>();
  private pendingAutomaticUpdatesFlushTimer: number | null = null;

  constructor(private readonly options: TextIndexWorkerOptions) {}

  isStarted(): boolean {
    return this.started;
  }

  isAutomaticUpdatesReady(): boolean {
    return this.automaticUpdatesReady;
  }

  setAutomaticUpdatesReady(ready: boolean): void {
    this.automaticUpdatesReady = ready;
    if (ready) {
      this.schedulePendingAutomaticUpdatesFlush();
    }
  }

  isAutomaticUpdateInProgress(): boolean {
    return this.automaticUpdateInProgress;
  }

  setAutomaticUpdateInProgress(inProgress: boolean): void {
    this.automaticUpdateInProgress = inProgress;
  }

  isAutomaticUpdatePending(): boolean {
    return this.automaticUpdatePending;
  }

  setAutomaticUpdatePending(pending: boolean): void {
    this.automaticUpdatePending = pending;
  }

  getAutomaticUpdatePromise(): Promise<void> | null {
    return this.automaticUpdatePromise;
  }

  setAutomaticUpdatePromise(promise: Promise<void> | null): void {
    this.automaticUpdatePromise = promise;
  }

  getPendingAutomaticUpdates(): Map<string, TextIndexAutomaticUpdate> {
    return this.pendingAutomaticUpdates;
  }

  setPendingAutomaticUpdates(updates: Map<string, TextIndexAutomaticUpdate>): void {
    this.pendingAutomaticUpdates = updates;
  }

  setPendingAutomaticUpdatesFlushTimer(timeoutId: number | null): void {
    this.pendingAutomaticUpdatesFlushTimer = timeoutId;
  }

  start(): void {
    this.stop();
    if (!this.options.capabilities.canWatchVaultEvents
      || !this.options.capabilities.canMaintainTextIndex
      || !this.options.isAutomaticUpdateEnabled()) {
      return;
    }

    for (const event of ["create", "modify", "delete", "rename"] as const) {
      this.listeners.push(this.options.subscribeVaultEvent(event, (file, oldPath) => {
        this.options.onVaultEvent(event, file, oldPath);
      }));
    }
    this.modifyDebouncer = createPathScopedDebouncer((run) => run(), 2000, this.options.timers);
    this.started = true;
  }

  scheduleModify(path: string, run: () => void): void {
    if (!this.started) {
      return;
    }
    this.modifyDebouncer?.schedule(path, run);
  }

  queueAutomaticIndexUpdate(update: TextIndexAutomaticUpdate): void {
    coalesceAutomaticUpdateEvent(this.pendingAutomaticUpdates, update);
    this.schedulePendingAutomaticUpdatesFlush();
  }

  requeueAutomaticIndexUpdates(updates: TextIndexAutomaticUpdate[]): void {
    for (const update of updates) {
      coalesceAutomaticUpdateEvent(this.pendingAutomaticUpdates, update);
    }
    if (updates.length > 0) {
      this.automaticUpdatePending = true;
      this.schedulePendingAutomaticUpdatesFlush();
    }
  }

  schedulePendingAutomaticUpdatesFlush(): void {
    if (!this.options.capabilities.canMaintainTextIndex
      || !this.automaticUpdatesReady
      || this.pendingAutomaticUpdates.size === 0) {
      return;
    }
    if (this.automaticUpdatePromise || this.options.canFlushAutomaticUpdates?.() === false) {
      this.automaticUpdatePending = true;
      return;
    }
    if (this.pendingAutomaticUpdatesFlushTimer !== null) {
      return;
    }
    this.pendingAutomaticUpdatesFlushTimer = this.options.timers.setTimeout(() => {
      this.pendingAutomaticUpdatesFlushTimer = null;
      void this.flushPendingAutomaticUpdates();
    }, 1000);
  }

  async flushPendingAutomaticUpdates(force = false): Promise<void> {
    if (!this.options.capabilities.canMaintainTextIndex
      || (!force && !this.automaticUpdatesReady)
      || this.pendingAutomaticUpdates.size === 0) {
      return;
    }
    if (this.automaticUpdatePromise || this.options.canFlushAutomaticUpdates?.() === false) {
      this.automaticUpdatePending = true;
      return;
    }

    if (this.options.canPublish) {
      const allowedResult = this.options.canPublish();
      const isAllowed = typeof allowedResult === "boolean" ? allowedResult : await allowedResult;
      if (!isAllowed) {
        return;
      }
    }

    const updates = [...this.pendingAutomaticUpdates.values()];
    this.pendingAutomaticUpdates.clear();
    const run = this.options.runAutomaticBatch;
    if (!run) {
      this.requeueAutomaticIndexUpdates(updates);
      return;
    }

    this.automaticUpdatePromise = (async () => {
      const completed = await run(updates, {});
      if (!completed) {
        this.requeueAutomaticIndexUpdates(updates);
      }
    })();
    try {
      await this.automaticUpdatePromise;
    } finally {
      this.automaticUpdatePromise = null;
      if (this.automaticUpdatePending || this.pendingAutomaticUpdates.size > 0) {
        this.automaticUpdatePending = false;
        this.schedulePendingAutomaticUpdatesFlush();
      }
    }
  }

  async processPendingAutomaticUpdates(force = false): Promise<void> {
    await this.flushPendingAutomaticUpdates(force);
  }

  async drainAutomaticUpdatesBeforeEmbeddingGeneration(signal?: AbortSignal): Promise<boolean> {
    while (true) {
      if (signal?.aborted) {
        return false;
      }
      if (this.automaticUpdatePromise) {
        await this.automaticUpdatePromise;
        continue;
      }
      if (this.pendingAutomaticUpdates.size === 0) {
        return true;
      }

      const updates = [...this.pendingAutomaticUpdates.values()];
      this.pendingAutomaticUpdates.clear();
      if (signal?.aborted) {
        this.requeueAutomaticIndexUpdates(updates);
        return false;
      }
      if (this.options.drainAutomaticBatch) {
        await this.options.drainAutomaticBatch(updates);
      } else {
        const completed = await this.options.runAutomaticBatch?.(updates, {
          allowEmbeddingReservation: true,
        }) ?? false;
        if (!completed) {
          this.requeueAutomaticIndexUpdates(updates);
          return false;
        }
      }
    }
  }

  stop(): void {
    this.modifyDebouncer?.cancelAll();
    this.modifyDebouncer = undefined;
    for (const unsubscribe of this.listeners) {
      unsubscribe();
    }
    this.listeners = [];
    this.started = false;
    if (this.pendingAutomaticUpdatesFlushTimer !== null) {
      this.options.timers.clearTimeout(this.pendingAutomaticUpdatesFlushTimer);
      this.pendingAutomaticUpdatesFlushTimer = null;
    }
  }

  dispose(): void {
    this.stop();
    this.pendingAutomaticUpdates.clear();
    this.automaticUpdatePending = false;
  }
}
