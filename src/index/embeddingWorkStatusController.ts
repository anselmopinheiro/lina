import { EmbeddingStateSummary } from "./embeddingState";
import { EmbeddingUpdatePlanPreview } from "./embeddingUpdatePlan";

export type EmbeddingWorkStatus =
  | "unknown"
  | "dirty"
  | "calculating"
  | "ready"
  | "error"
  | "disposed";

export type EmbeddingWorkInvalidationReason =
  | "text-index-published"
  | "text-index-rebuilt"
  | "startup-reconciled"
  | "embeddings-published"
  | "checkpoint-changed"
  | "settings-changed"
  | "manual-refresh"
  | "external-sync-detected"
  | "unknown";

export interface EmbeddingWorkRuntimeState {
  status: EmbeddingWorkStatus;
  revision: number;
  calculatedRevision?: number;
  summary?: EmbeddingWorkSummary;
  workAvailable?: boolean;
  reason?: EmbeddingWorkInvalidationReason;
  errorCategory?: string;
  updatedAt?: string;
}

export interface EmbeddingWorkStatusClock {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timeoutId: number): void;
}

export interface EmbeddingWorkStatusControllerOptions {
  refreshSummary: () => Promise<EmbeddingWorkSummary | null>;
  clock?: EmbeddingWorkStatusClock;
  refreshDebounceMs?: number;
  shouldDeferRefresh?: () => boolean;
  autoRefreshOnSubscribe?: boolean;
  autoRefreshOnDirty?: boolean;
  debugLog?: (event: string, details: Record<string, unknown>) => void;
}

export type EmbeddingWorkStatusListener = (state: EmbeddingWorkRuntimeState) => void;

export interface EmbeddingWorkSummary extends EmbeddingStateSummary {
  detailsAvailable?: boolean;
  canonicalReadability?: "missing" | "empty" | "readable" | "unreadable";
  resourceLimitCode?: string;
  exists?: boolean;
  totalEmbeddings?: number;
  model?: string;
  provider?: string;
  dimensions?: number;
  updatedAt?: string;
  expectedPrefixMode?: string;
  manifestPrefixMode?: string;
  isPrefixModeMismatch?: boolean;
  updatePlan?: EmbeddingUpdatePlanPreview;
}

function cloneState(state: EmbeddingWorkRuntimeState): EmbeddingWorkRuntimeState {
  return {
    ...state,
    summary: state.summary ? { ...state.summary } : undefined,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultClock(): EmbeddingWorkStatusClock {
  return {
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
  };
}

export function hasEmbeddingWorkAvailable(summary: EmbeddingWorkSummary | EmbeddingStateSummary | undefined): boolean {
  if (!summary) {
    return false;
  }

  const updatePlan = "updatePlan" in summary ? summary.updatePlan : undefined;
  return (updatePlan?.toGenerateCount ?? 0) > 0
    || updatePlan?.requiresPublication === true
    || summary.missingCount > 0
    || summary.staleCount > 0
    || summary.obsoleteCount > 0
    || summary.duplicateRecordCount > 0
    || summary.invalidRecordCount > 0;
}

function deriveEmbeddingWorkAvailability(summary: EmbeddingWorkSummary | undefined): boolean | undefined {
  if (!summary) return undefined;
  if (summary.updatePlan?.mode === "full-rebuild") return true;
  if (summary.detailsAvailable === false || summary.updatePlan?.mode === "indeterminate") return undefined;
  return hasEmbeddingWorkAvailable(summary);
}

export class EmbeddingWorkStatusController {
  private state: EmbeddingWorkRuntimeState = {
    status: "unknown",
    revision: 0,
  };
  private readonly listeners = new Set<EmbeddingWorkStatusListener>();
  private readonly refreshSummary: () => Promise<EmbeddingWorkSummary | null>;
  private readonly clock: EmbeddingWorkStatusClock;
  private readonly refreshDebounceMs: number;
  private readonly shouldDeferRefresh: () => boolean;
  private readonly autoRefreshOnSubscribe: boolean;
  private readonly autoRefreshOnDirty: boolean;
  private readonly debugLog?: (event: string, details: Record<string, unknown>) => void;
  private refreshTimer: number | null = null;
  private activeRefreshPromise: Promise<EmbeddingWorkRuntimeState> | null = null;
  private activeRefreshRevision: number | null = null;
  private followUpRefreshPromise: Promise<EmbeddingWorkRuntimeState> | null = null;
  private followUpRefreshRequested = false;

  constructor(options: EmbeddingWorkStatusControllerOptions) {
    this.refreshSummary = options.refreshSummary;
    this.clock = options.clock ?? defaultClock();
    this.refreshDebounceMs = Math.max(0, Math.floor(options.refreshDebounceMs ?? 250));
    this.shouldDeferRefresh = options.shouldDeferRefresh ?? (() => false);
    this.autoRefreshOnSubscribe = options.autoRefreshOnSubscribe ?? true;
    this.autoRefreshOnDirty = options.autoRefreshOnDirty ?? true;
    this.debugLog = options.debugLog;
  }

  getState(): EmbeddingWorkRuntimeState {
    return cloneState(this.state);
  }

  subscribe(listener: EmbeddingWorkStatusListener): () => void {
    if (this.state.status === "disposed") {
      listener(this.getState());
      return () => undefined;
    }

    this.listeners.add(listener);
    listener(this.getState());
    this.debug("subscriber-added", { subscriberCount: this.listeners.size });

    if (this.autoRefreshOnSubscribe && (this.state.status === "unknown" || this.state.status === "dirty" || this.state.status === "error")) {
      this.scheduleRefresh("subscriber-active");
    }

    return () => {
      this.listeners.delete(listener);
      this.debug("subscriber-removed", { subscriberCount: this.listeners.size });
      if (this.listeners.size === 0) {
        this.cancelScheduledRefresh();
      }
    };
  }

  markDirty(reason: EmbeddingWorkInvalidationReason = "unknown"): void {
    if (this.state.status === "disposed") {
      return;
    }

    this.state = {
      ...this.state,
      status: "dirty",
      revision: this.state.revision + 1,
      reason,
      errorCategory: undefined,
      updatedAt: nowIso(),
    };
    this.debug("dirty", {
      reason,
      revision: this.state.revision,
      subscriberCount: this.listeners.size,
    });
    this.notify();

    if (this.autoRefreshOnDirty && this.listeners.size > 0) {
      this.scheduleRefresh(reason);
    }
  }

  async refresh(reason: EmbeddingWorkInvalidationReason = "manual-refresh"): Promise<EmbeddingWorkRuntimeState> {
    if (this.state.status === "disposed") {
      return this.getState();
    }

    this.cancelScheduledRefresh();

    if (this.activeRefreshPromise) {
      if (this.activeRefreshRevision !== this.state.revision) {
        this.followUpRefreshRequested = true;
        if (!this.followUpRefreshPromise) {
          this.followUpRefreshPromise = this.activeRefreshPromise.then(async () => {
            this.followUpRefreshPromise = null;
            if (!this.followUpRefreshRequested || this.state.status === "disposed") {
              return this.getState();
            }
            this.followUpRefreshRequested = false;
            return this.refresh(reason);
          });
        }
        return this.followUpRefreshPromise;
      }

      return this.activeRefreshPromise;
    }

    if (this.shouldDeferRefresh()) {
      this.state = {
        ...this.state,
        status: "dirty",
        reason,
        updatedAt: nowIso(),
      };
      this.debug("refresh-deferred", {
        reason,
        revision: this.state.revision,
      });
      this.notify();
      return this.getState();
    }

    this.activeRefreshRevision = this.state.revision;
    this.activeRefreshPromise = this.runRefresh(this.activeRefreshRevision, reason);
    try {
      return await this.activeRefreshPromise;
    } finally {
      this.activeRefreshPromise = null;
      this.activeRefreshRevision = null;
    }
  }

  dispose(): void {
    if (this.state.status === "disposed") {
      return;
    }

    this.cancelScheduledRefresh();
    this.state = {
      ...this.state,
      status: "disposed",
      updatedAt: nowIso(),
    };
    this.debug("disposed", { revision: this.state.revision });
    this.notify();
    this.listeners.clear();
  }

  private async runRefresh(
    revisionAtStart: number,
    reason: EmbeddingWorkInvalidationReason
  ): Promise<EmbeddingWorkRuntimeState> {
    this.state = {
      ...this.state,
      status: "calculating",
      reason,
      errorCategory: undefined,
      updatedAt: nowIso(),
    };
    this.debug("refresh-started", { reason, revision: revisionAtStart });
    this.notify();

    try {
      const summary = await this.refreshSummary();
      if (this.state.status === "disposed") {
        this.debug("refresh-ignored-disposed", { revision: revisionAtStart });
        return this.getState();
      }

      if (this.state.revision !== revisionAtStart) {
        this.debug("refresh-discarded-late", {
          calculatedRevision: revisionAtStart,
          currentRevision: this.state.revision,
        });
        this.state = {
          ...this.state,
          status: "dirty",
          updatedAt: nowIso(),
        };
        this.notify();
        return this.getState();
      }

      const safeSummary = summary ?? undefined;
      this.state = {
        status: "ready",
        revision: this.state.revision,
        calculatedRevision: revisionAtStart,
        summary: safeSummary,
        workAvailable: deriveEmbeddingWorkAvailability(safeSummary),
        reason,
        updatedAt: nowIso(),
      };
      this.debug("refresh-completed", {
        revision: revisionAtStart,
        workAvailable: this.state.workAvailable,
        totalChunks: safeSummary?.totalChunks ?? 0,
        missingCount: safeSummary?.missingCount ?? 0,
        staleCount: safeSummary?.staleCount ?? 0,
        obsoleteCount: safeSummary?.obsoleteCount ?? 0,
      });
      this.notify();
      return this.getState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.state.status === "disposed") {
        this.debug("refresh-error-ignored-disposed", { revision: revisionAtStart });
        return this.getState();
      }

      if (this.state.revision !== revisionAtStart) {
        this.debug("refresh-error-discarded-late", {
          calculatedRevision: revisionAtStart,
          currentRevision: this.state.revision,
        });
        this.state = {
          ...this.state,
          status: "dirty",
          updatedAt: nowIso(),
        };
      } else {
        this.state = {
          ...this.state,
          status: "error",
          errorCategory: "refresh-failed",
          updatedAt: nowIso(),
        };
      }
      this.debug("refresh-failed", {
        revision: revisionAtStart,
        error: message,
      });
      this.notify();
      return this.getState();
    }
  }

  private scheduleRefresh(reason: string): void {
    if (this.state.status === "disposed" || this.listeners.size === 0 || this.refreshTimer !== null) {
      return;
    }

    this.debug("refresh-scheduled", {
      reason,
      revision: this.state.revision,
      debounceMs: this.refreshDebounceMs,
    });
    this.refreshTimer = this.clock.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh("manual-refresh");
    }, this.refreshDebounceMs);
  }

  private cancelScheduledRefresh(): void {
    if (this.refreshTimer === null) {
      return;
    }

    this.clock.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private debug(event: string, details: Record<string, unknown>): void {
    this.debugLog?.(event, details);
  }
}
