import {
  EmbeddingStateSummary,
  type EmbeddingInputPrefixMode,
  type PublishedEmbeddingIdentity,
} from "./embeddingState";
import { EmbeddingUpdatePlanPreview } from "./embeddingUpdatePlan";
import { type EmbeddingLifecycleSnapshot } from "./embeddingLifecycleModel";
import { adaptCurrentStateToLifecycleSnapshot } from "./embeddingLifecycleAdapter";
import {
  type EmbeddingWritePathDecision,
  deriveEmbeddingWritePathDecision,
} from "./embeddingLifecycleWritePath";
import { type DeviceRuntimeState } from "../device/deviceRuntimeState";
import type { EmbeddingOperationState } from "./embeddingOperationManager";
import { getEmbeddingProviderCapability } from "../ai/providerCapabilities";

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
  decision?: EmbeddingWritePathDecision;
  lifecycleSnapshot?: EmbeddingLifecycleSnapshot;
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
  getDeviceRuntimeState?: () => DeviceRuntimeState | undefined;
}

export type EmbeddingWorkStatusListener = (state: EmbeddingWorkRuntimeState) => void;

export interface EmbeddingWorkSummary extends Partial<EmbeddingStateSummary> {
  detailsAvailable?: boolean;
  canonicalReadability?: "missing" | "empty" | "readable" | "unreadable" | "resource-limit-exceeded";
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
  /** Real identity read from the published manifest (not reconstructed from partial fields). */
  publishedIdentity?: PublishedEmbeddingIdentity;
  /** Factual usability of the text index (`readTextIndexStatus`); when absent it derives from the device runtime. */
  textIndexStatus?: "ready" | "stale" | "missing" | "invalid";
  deviceRuntimeState?: DeviceRuntimeState;
  /**
   * Effective locality of the configured endpoint (LINA-15F): `true` when note content would leave
   * this device (remote/invalid endpoint or non-local provider). When omitted, the static provider
   * capability is used.
   */
  targetEndpointIsExternal?: boolean;
}

function positiveOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
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

function deriveEmbeddingWorkDecisionAndAvailability(
  safeSummary: EmbeddingWorkSummary | undefined,
  revision: number,
  customDeviceRuntime?: DeviceRuntimeState
): {
  decision?: EmbeddingWritePathDecision;
  lifecycleSnapshot?: EmbeddingLifecycleSnapshot;
  workAvailable?: boolean;
} {
  if (!safeSummary) {
    return { workAvailable: undefined };
  }

  if (isIndeterminateWorkSummary(safeSummary)) {
    return { workAvailable: undefined };
  }

  const snapshot = buildEmbeddingWorkLifecycleSnapshot(safeSummary, revision, customDeviceRuntime);
  const decision = deriveEmbeddingWritePathDecision(snapshot);
  let workAvailable: boolean | undefined;
  if (decision.workKind === "indeterminate" || snapshot.primary === "INDETERMINATE") {
    workAvailable = undefined;
  } else if (
    snapshot.capability.blockedReason === "companion" ||
    snapshot.capability.blockedReason === "standby"
  ) {
    workAvailable = false;
  } else {
    workAvailable = snapshot.write.work.updateRequired;
  }

  return {
    decision,
    lifecycleSnapshot: snapshot,
    workAvailable,
  };
}

/** True when the summary cannot support a trustworthy work classification. */
export function isIndeterminateWorkSummary(safeSummary: EmbeddingWorkSummary): boolean {
  return (
    safeSummary.updatePlan?.mode === "indeterminate" ||
    (!safeSummary.updatePlan && (safeSummary.detailsAvailable === false || safeSummary.canonicalReadability === "unreadable") && safeSummary.canonicalReadability !== "resource-limit-exceeded")
  );
}

/**
 * Builds the canonical lifecycle snapshot from a (non-indeterminate) work summary.
 * Shared by the controller cache and the live snapshot provider; `operationState` lets the
 * provider overlay the live operation, which the cached snapshot does not carry.
 */
export function buildEmbeddingWorkLifecycleSnapshot(
  safeSummary: EmbeddingWorkSummary,
  revision: number,
  customDeviceRuntime?: DeviceRuntimeState,
  operationState?: EmbeddingOperationState | null
): EmbeddingLifecycleSnapshot {
  const plannedTarget = safeSummary.updatePlan?.targetIdentity;
  const targetProvider = plannedTarget?.provider ?? safeSummary.provider;
  const targetModel = plannedTarget?.model ?? safeSummary.model;

  // Unknown facts stay unknown: no default dimensions, input version or prefix mode (LINA-15D-B).
  const targetIdentity: PublishedEmbeddingIdentity | undefined = targetProvider && targetModel ? {
    provider: targetProvider,
    model: targetModel,
    dimensions: positiveOrUndefined(plannedTarget?.dimensions ?? safeSummary.dimensions),
    inputVersion: plannedTarget?.inputVersion,
    prefixMode: (plannedTarget?.prefixMode ?? safeSummary.expectedPrefixMode) as EmbeddingInputPrefixMode | undefined,
  } : undefined;

  // The published identity is the real manifest identity carried by the work summary.
  const publishedIdentity: PublishedEmbeddingIdentity | undefined = safeSummary.exists !== false && safeSummary.publishedIdentity
    ? {
      ...safeSummary.publishedIdentity,
      dimensions: positiveOrUndefined(safeSummary.publishedIdentity.dimensions),
    }
    : undefined;

  // A missing runtime is not an Active Producer: the adapter receives no runtime and the work
  // assessment is explicitly indeterminate (fail-closed).
  const deviceRuntimeState = safeSummary.deviceRuntimeState ?? customDeviceRuntime;

  const isExternalProvider = safeSummary.targetEndpointIsExternal
    ?? (targetIdentity?.provider ? !getEmbeddingProviderCapability(targetIdentity.provider).isLocal : false);

  // Without the runtime or the update plan the work cannot be assessed: indeterminate, never "no work".
  const missingFact = !deviceRuntimeState
    ? "device-runtime-unavailable"
    : !safeSummary.updatePlan ? "update-plan-unavailable" : undefined;

  const snapshot = adaptCurrentStateToLifecycleSnapshot({
    revision,
    deviceRuntimeState,
    ...(missingFact ? {
      workAssessment: {
        kind: "indeterminate" as const,
        updateRequired: false,
        severity: "none" as const,
        cost: "none" as const,
        reasons: [missingFact],
      },
    } : {}),
    targetIdentity,
    isExternalProvider,
    updatePlan: missingFact ? undefined : safeSummary.updatePlan,
    publishedIdentity,
    canonicalExists: safeSummary.exists ?? true,
    // Real count of vectors valid for search; the plan's reusable canonical records when the status has none.
    validForSearchCount: safeSummary.validForSearchCount ?? safeSummary.updatePlan?.reusableCanonicalCount,
    canonicalReadability: safeSummary.canonicalReadability ?? "readable",
    upstreamTextIndex: safeSummary.textIndexStatus,
    operationState: operationState ?? undefined,
  });

  return snapshot;
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
  private readonly getDeviceRuntimeState?: () => DeviceRuntimeState | undefined;
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
    this.getDeviceRuntimeState = options.getDeviceRuntimeState;
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
      const derived = deriveEmbeddingWorkDecisionAndAvailability(
        safeSummary,
        revisionAtStart,
        this.getDeviceRuntimeState?.()
      );
      this.state = {
        status: "ready",
        revision: this.state.revision,
        calculatedRevision: revisionAtStart,
        summary: safeSummary,
        workAvailable: derived.workAvailable,
        decision: derived.decision,
        lifecycleSnapshot: derived.lifecycleSnapshot,
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
