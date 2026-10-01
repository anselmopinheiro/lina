import {
  EmbeddingStateSummary,
  type EmbeddingInputPrefixMode,
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
  deviceRuntimeState?: DeviceRuntimeState;
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
  const targetProvider = safeSummary.updatePlan?.targetIdentity?.provider ?? safeSummary.provider;
  const targetModel = safeSummary.updatePlan?.targetIdentity?.model ?? safeSummary.model;
  const targetDimensions = safeSummary.updatePlan?.targetIdentity?.dimensions ?? safeSummary.dimensions;

  const targetIdentity = targetProvider && targetModel ? {
    provider: targetProvider,
    model: targetModel,
    dimensions: targetDimensions ?? 768,
    inputVersion: safeSummary.updatePlan?.targetIdentity?.inputVersion ?? 1,
    prefixMode: (safeSummary.updatePlan?.targetIdentity?.prefixMode ?? safeSummary.manifestPrefixMode ?? safeSummary.expectedPrefixMode ?? "none") as EmbeddingInputPrefixMode,
  } : undefined;

  const publishedIdentity = safeSummary.exists !== false && safeSummary.provider && safeSummary.model ? {
    provider: safeSummary.provider,
    model: safeSummary.model,
    dimensions: safeSummary.dimensions ?? safeSummary.updatePlan?.targetIdentity?.dimensions ?? 768,
    inputVersion: 1,
    prefixMode: (safeSummary.manifestPrefixMode ?? safeSummary.expectedPrefixMode ?? safeSummary.updatePlan?.targetIdentity?.prefixMode ?? "none") as EmbeddingInputPrefixMode,
  } : undefined;

  const defaultProducerRuntime: DeviceRuntimeState = {
    deviceId: customDeviceRuntime?.deviceId ?? "local-device",
    effectiveRole: "producer",
    isActiveProducer: true,
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isStandbyProducer: false,
    isCompanion: false,
    isUnassigned: false,
    canPublish: true,
    canTransferOwnership: false,
    transferEligibilityReason: "already-active-producer",
    embeddings: {
      configured: true,
      textIndexAvailable: true,
      embeddingsDeclared: true,
      exists: safeSummary.exists ?? true,
      vectorFileState: "available",
      provenance: { stale: false },
      compatibility: { compatible: true },
      contractState: "compatible",
      readiness: { loaded: true, runtimeReady: true },
      runtimeState: "ready",
      semanticAvailable: true,
      effectiveMode: "full",
    },
  };

  const deviceRuntimeState = safeSummary.deviceRuntimeState ?? customDeviceRuntime ?? defaultProducerRuntime;

  const isExternalProvider = targetIdentity?.provider ? !getEmbeddingProviderCapability(targetIdentity.provider).isLocal : false;

  const snapshot = adaptCurrentStateToLifecycleSnapshot({
    revision,
    deviceRuntimeState,
    targetIdentity,
    isExternalProvider,
    updatePlan: safeSummary.updatePlan ?? (targetIdentity ? {
      mode: "incremental",
      totalChunks: safeSummary.totalChunks ?? 0,
      missingCount: safeSummary.missingCount ?? 0,
      staleToReplaceCount: safeSummary.staleCount ?? 0,
      obsoleteToDropCount: safeSummary.obsoleteCount ?? 0,
      toGenerateCount: (safeSummary.missingCount ?? 0) + (safeSummary.staleCount ?? 0),
      reusableCanonicalCount: safeSummary.validCount ?? 0,
      recoverableCheckpointCount: safeSummary.recoverableCheckpointCount ?? 0,
      requiresPublication:
        (safeSummary.missingCount ?? 0) > 0 ||
        (safeSummary.staleCount ?? 0) > 0 ||
        (safeSummary.obsoleteCount ?? 0) > 0 ||
        (safeSummary.duplicateRecordCount ?? 0) > 0 ||
        (safeSummary.invalidRecordCount ?? 0) > 0,
      reasons: [],
      targetIdentity,
    } : undefined),
    publishedIdentity,
    canonicalExists: safeSummary.exists ?? true,
    canonicalReadability: safeSummary.canonicalReadability ?? "readable",
    upstreamTextIndex: "ready",
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
