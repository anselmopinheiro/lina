export type EmbeddingSchedulerStatus = "disabled" | "clean" | "dirty" | "scheduled" | "paused";

export interface EmbeddingSchedulerState {
  readonly status: EmbeddingSchedulerStatus;
  readonly ready: boolean;
  readonly dirtySince: number | null;
  readonly scheduledFor: number | null;
}

export interface EmbeddingSchedulerTimers {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (timeoutId: number) => void;
}

export interface EmbeddingSchedulerAutomaticDispatchResult {
  readonly status: "accepted" | "already-running" | "unavailable";
  readonly completion?: Promise<{ readonly success: boolean }>;
}

export interface EmbeddingSchedulerOptions {
  readonly canScheduleEmbeddings: () => boolean;
  readonly timers: EmbeddingSchedulerTimers;
  /**
   * Host-owned policy boundary. The scheduler deliberately does not know how
   * a provider is configured; the host enables this only for Ollama.
   */
  readonly canDispatchAutomatically?: () => boolean;
  /** Uses the existing derived embedding-work state rather than recalculating a diff. */
  readonly hasEmbeddingWork?: () => Promise<boolean>;
  /** Requests work through the host's existing maintenance execution path. */
  readonly dispatchAutomatic?: () => EmbeddingSchedulerAutomaticDispatchResult;
  readonly quietPeriodMs?: number;
  readonly maximumDelayMs?: number;
}

const DEFAULT_QUIET_PERIOD_MS = 30_000;
const DEFAULT_MAXIMUM_DELAY_MS = 300_000;

/**
 * Transient scheduling policy. Execution, when authorized by injected host
 * ports, remains outside this module and is never a direct provider call.
 */
export class EmbeddingScheduler {
  private started = false;
  private disposed = false;
  private paused = false;
  private dirtySince: number | null = null;
  private ready = false;
  private quietTimer: number | null = null;
  private maximumDelayTimer: number | null = null;
  private automaticDispatchInFlight = false;
  private state: EmbeddingSchedulerState = {
    status: "disabled",
    ready: false,
    dirtySince: null,
    scheduledFor: null,
  };

  constructor(private readonly options: EmbeddingSchedulerOptions) {}

  getState(): EmbeddingSchedulerState {
    return { ...this.state };
  }

  isStarted(): boolean {
    return this.started;
  }

  start(): void {
    if (this.disposed || !this.options.canScheduleEmbeddings()) {
      return;
    }
    this.started = true;
    this.paused = false;
    this.updateState(this.dirtySince === null ? "clean" : "dirty");
  }

  markDirty(): void {
    if (!this.started || this.disposed || this.paused || !this.options.canScheduleEmbeddings()) {
      return;
    }

    const now = this.options.timers.now();
    this.dirtySince ??= now;
    this.ready = false;
    if (this.automaticDispatchInFlight) {
      this.updateState("dirty");
      return;
    }
    this.clearQuietTimer();
    this.quietTimer = this.options.timers.setTimeout(() => this.reachReady(), this.quietPeriodMs);
    if (this.maximumDelayTimer === null) {
      this.maximumDelayTimer = this.options.timers.setTimeout(() => this.reachReady(), this.maximumDelayMs);
    }
    this.updateState("scheduled", now + this.quietPeriodMs);
  }

  markClean(): void {
    if (this.disposed) {
      return;
    }
    this.clearTimers();
    this.dirtySince = null;
    this.ready = false;
    this.updateState(this.started && !this.paused ? "clean" : this.paused ? "paused" : "disabled");
  }

  preemptForManual(): void {
    if (this.disposed) {
      return;
    }
    this.clearTimers();
    this.ready = false;
    this.updateState(this.started && !this.paused
      ? this.dirtySince === null ? "clean" : "dirty"
      : this.paused ? "paused" : "disabled");
  }

  pause(): void {
    if (!this.started || this.disposed) {
      return;
    }
    this.clearTimers();
    this.paused = true;
    this.ready = false;
    this.updateState("paused");
  }

  resume(): void {
    if (!this.started || this.disposed || !this.paused) {
      return;
    }
    this.paused = false;
    this.updateState(this.dirtySince === null ? "clean" : "dirty");
  }

  disable(): void {
    if (this.disposed) {
      return;
    }
    this.clearTimers();
    this.started = false;
    this.paused = false;
    this.ready = false;
    this.updateState("disabled");
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disable();
    this.disposed = true;
  }

  private reachReady(): void {
    if (!this.started || this.disposed || this.paused || !this.options.canScheduleEmbeddings()) {
      return;
    }
    this.clearTimers();
    this.ready = true;
    this.updateState("dirty");
    void this.dispatchIfEligible();
  }

  private async dispatchIfEligible(): Promise<void> {
    if (
      this.automaticDispatchInFlight
      || !this.started
      || this.disposed
      || this.paused
      || !this.options.canScheduleEmbeddings()
      || !this.options.canDispatchAutomatically?.()
      || !this.options.hasEmbeddingWork
      || !this.options.dispatchAutomatic
    ) {
      return;
    }

    let hasEmbeddingWork: boolean;
    try {
      hasEmbeddingWork = await this.options.hasEmbeddingWork();
    } catch {
      // Preserve the dirty state. A transient status-read failure must never
      // cause automatic work to run or make work appear clean.
      return;
    }

    if (!this.started || this.disposed || this.paused || !this.options.canScheduleEmbeddings()) {
      return;
    }

    if (!hasEmbeddingWork) {
      this.markClean();
      return;
    }

    if (!this.options.canDispatchAutomatically()) {
      // The host policy may have changed while the derived work state was
      // being read. Keep the work available for an explicit manual request.
      this.updateState("dirty");
      return;
    }

    const dispatch = this.options.dispatchAutomatic();
    if (dispatch.status !== "accepted" || !dispatch.completion) {
      this.updateState("dirty");
      return;
    }

    this.clearTimers();
    this.automaticDispatchInFlight = true;
    try {
      const completion = await dispatch.completion;
      if (!this.started || this.disposed || this.paused || !this.options.canScheduleEmbeddings()) {
        return;
      }

      if (!completion.success) {
        this.updateState("dirty");
        return;
      }

      let hasRemainingWork: boolean;
      try {
        hasRemainingWork = await this.options.hasEmbeddingWork();
      } catch {
        this.updateState("dirty");
        return;
      }

      if (!this.started || this.disposed || this.paused || !this.options.canScheduleEmbeddings()) {
        return;
      }

      if (!hasRemainingWork) {
        this.markClean();
        return;
      }

      // A publication or an edit may have made the derived state dirty while
      // the worker ran. Start a fresh debounce cycle instead of losing it.
      this.dirtySince = null;
      this.ready = false;
      this.automaticDispatchInFlight = false;
      this.markDirty();
    } finally {
      this.automaticDispatchInFlight = false;
    }
  }

  private updateState(status: EmbeddingSchedulerStatus, scheduledFor: number | null = null): void {
    this.state = {
      status,
      ready: this.ready,
      dirtySince: this.dirtySince,
      scheduledFor,
    };
  }

  private clearTimers(): void {
    this.clearQuietTimer();
    if (this.maximumDelayTimer !== null) {
      this.options.timers.clearTimeout(this.maximumDelayTimer);
      this.maximumDelayTimer = null;
    }
  }

  private clearQuietTimer(): void {
    if (this.quietTimer !== null) {
      this.options.timers.clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
  }

  private get quietPeriodMs(): number {
    return Math.max(0, this.options.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS);
  }

  private get maximumDelayMs(): number {
    return Math.max(this.quietPeriodMs, this.options.maximumDelayMs ?? DEFAULT_MAXIMUM_DELAY_MS);
  }
}
