export const DECLARATIVE_SETTINGS_LIFECYCLE_DOMAINS = [
  "analysis",
  "embeddings",
  "binary",
  "credentials-analysis",
  "credentials-embeddings",
] as const;

export type DeclarativeSettingsLifecycleDomain = typeof DECLARATIVE_SETTINGS_LIFECYCLE_DOMAINS[number];
export type DeclarativeSettingsLifecycleOperationStatus = "idle" | "pending" | "success" | "error";
export type DeclarativeSettingsLifecycleCompletion = "success" | "error";

declare const lifecycleTokenBrand: unique symbol;

/** Opaque monotonic token for one asynchronous lifecycle operation. */
export interface DeclarativeSettingsLifecycleToken {
  readonly domain: DeclarativeSettingsLifecycleDomain;
  readonly generation: number;
  readonly [lifecycleTokenBrand]: undefined;
}

export interface DeclarativeSettingsLifecycleState {
  readonly disposed: boolean;
  readonly updateScheduled: boolean;
  readonly pendingDomains: readonly DeclarativeSettingsLifecycleDomain[];
  readonly operationStatus: Readonly<Record<DeclarativeSettingsLifecycleDomain, DeclarativeSettingsLifecycleOperationStatus>>;
}

export type DeclarativeSettingsLifecycleCleanup = () => void;
export type DeclarativeSettingsLifecycleCancelUpdate = () => void;

export interface DeclarativeSettingsLifecycleControllerOptions {
  requestHostUpdate(): void;
  scheduleUpdate(callback: () => void): DeclarativeSettingsLifecycleCancelUpdate | void;
  onCleanupError?(): void;
}

export interface DeclarativeSettingsLifecycleController {
  getState(): DeclarativeSettingsLifecycleState;
  isDisposed(): boolean;
  getOperationStatus(domain: DeclarativeSettingsLifecycleDomain): DeclarativeSettingsLifecycleOperationStatus;
  isPending(domain: DeclarativeSettingsLifecycleDomain): boolean;
  beginPending(domain: DeclarativeSettingsLifecycleDomain): DeclarativeSettingsLifecycleToken | undefined;
  completePending(token: DeclarativeSettingsLifecycleToken, completion: DeclarativeSettingsLifecycleCompletion): boolean;
  canApply(token: DeclarativeSettingsLifecycleToken): boolean;
  applyIfCurrent(token: DeclarativeSettingsLifecycleToken, apply: () => void): boolean;
  invalidateDomain(domain: DeclarativeSettingsLifecycleDomain): void;
  invalidateAll(): void;
  registerCleanup(owner: string, id: string, cleanup: DeclarativeSettingsLifecycleCleanup): boolean;
  removeCleanup(owner: string, id: string): boolean;
  removeOwner(owner: string): number;
  requestUpdate(): boolean;
  flushUpdate(): boolean;
  dispose(): void;
}

interface CleanupEntry {
  called: boolean;
  cleanup: DeclarativeSettingsLifecycleCleanup;
}

const operationState = (): Record<DeclarativeSettingsLifecycleDomain, DeclarativeSettingsLifecycleOperationStatus> => ({
  analysis: "idle",
  embeddings: "idle",
  binary: "idle",
  "credentials-analysis": "idle",
  "credentials-embeddings": "idle",
});

const generationState = (): Record<DeclarativeSettingsLifecycleDomain, number> => ({
  analysis: 0,
  embeddings: 0,
  binary: 0,
  "credentials-analysis": 0,
  "credentials-embeddings": 0,
});

function invokeCleanup(
  entry: CleanupEntry,
  onCleanupError: (() => void) | undefined,
): boolean {
  if (entry.called) return false;
  entry.called = true;
  try {
    entry.cleanup();
  } catch {
    try {
      onCleanupError?.();
    } catch {
      // Cleanup errors are intentionally contained so remaining drafts can be cleared.
    }
  }
  return true;
}

export function createDeclarativeSettingsLifecycleController(
  options: DeclarativeSettingsLifecycleControllerOptions,
): DeclarativeSettingsLifecycleController {
  let disposed = false;
  let updateScheduled = false;
  let updatingHost = false;
  let cancelScheduledUpdate: DeclarativeSettingsLifecycleCancelUpdate | undefined;
  const generations = generationState();
  const status = operationState();
  const pending = new Map<DeclarativeSettingsLifecycleDomain, number>();
  const cleanups = new Map<string, Map<string, CleanupEntry>>();
  const reportCleanupError = (): void => {
    options.onCleanupError?.();
  };

  const requestUpdate = (): boolean => {
    if (disposed || updateScheduled || updatingHost) return false;
    updateScheduled = true;
    try {
      const scheduledCancellation = options.scheduleUpdate(() => {
        flushUpdate();
      });
      cancelScheduledUpdate = typeof scheduledCancellation === "function"
        ? scheduledCancellation
        : undefined;
      return true;
    } catch {
      updateScheduled = false;
      cancelScheduledUpdate = undefined;
      return false;
    }
  };

  const flushUpdate = (): boolean => {
    if (disposed || !updateScheduled) return false;
    updateScheduled = false;
    cancelScheduledUpdate = undefined;
    updatingHost = true;
    try {
      options.requestHostUpdate();
    } catch {
      // A host refresh failure must not retain a scheduled update or loop.
    } finally {
      updatingHost = false;
    }
    return true;
  };

  const invalidateDomain = (domain: DeclarativeSettingsLifecycleDomain): void => {
    generations[domain] += 1;
    const changed = pending.delete(domain) || status[domain] !== "idle";
    status[domain] = "idle";
    if (changed) requestUpdate();
  };

  const removeCleanup = (owner: string, id: string): boolean => {
    const ownerEntries = cleanups.get(owner);
    const entry = ownerEntries?.get(id);
    if (!entry) return false;
    ownerEntries?.delete(id);
    if (ownerEntries?.size === 0) cleanups.delete(owner);
    return invokeCleanup(entry, reportCleanupError);
  };

  const canApply = (token: DeclarativeSettingsLifecycleToken): boolean =>
    !disposed && generations[token.domain] === token.generation;

  const applyIfCurrent = (
    token: DeclarativeSettingsLifecycleToken,
    apply: () => void,
  ): boolean => {
    if (!canApply(token)) return false;
    apply();
    return true;
  };

  const completePending = (
    token: DeclarativeSettingsLifecycleToken,
    completion: DeclarativeSettingsLifecycleCompletion,
  ): boolean => {
    if (!canApply(token) || pending.get(token.domain) !== token.generation) return false;
    pending.delete(token.domain);
    status[token.domain] = completion;
    requestUpdate();
    return true;
  };

  const removeOwner = (owner: string): number => {
    const ownerEntries = cleanups.get(owner);
    if (!ownerEntries) return 0;
    cleanups.delete(owner);
    let removed = 0;
    for (const entry of ownerEntries.values()) {
      if (invokeCleanup(entry, reportCleanupError)) removed += 1;
    }
    return removed;
  };

  return {
    getState() {
      return {
        disposed,
        updateScheduled,
        pendingDomains: DECLARATIVE_SETTINGS_LIFECYCLE_DOMAINS.filter((domain) => pending.has(domain)),
        operationStatus: { ...status },
      };
    },
    isDisposed() {
      return disposed;
    },
    getOperationStatus(domain) {
      return status[domain];
    },
    isPending(domain) {
      return !disposed && pending.has(domain);
    },
    beginPending(domain) {
      if (disposed || pending.has(domain)) return undefined;
      const generation = generations[domain] + 1;
      generations[domain] = generation;
      pending.set(domain, generation);
      status[domain] = "pending";
      requestUpdate();
      return { domain, generation } as DeclarativeSettingsLifecycleToken;
    },
    completePending,
    canApply,
    applyIfCurrent,
    invalidateDomain,
    invalidateAll() {
      let changed = false;
      for (const domain of DECLARATIVE_SETTINGS_LIFECYCLE_DOMAINS) {
        generations[domain] += 1;
        changed = pending.delete(domain) || status[domain] !== "idle" || changed;
        status[domain] = "idle";
      }
      if (changed) requestUpdate();
    },
    registerCleanup(owner, id, cleanup) {
      if (disposed) {
        invokeCleanup({ called: false, cleanup }, reportCleanupError);
        return false;
      }
      const ownerEntries = cleanups.get(owner) ?? new Map<string, CleanupEntry>();
      if (ownerEntries.has(id)) return false;
      ownerEntries.set(id, { called: false, cleanup });
      cleanups.set(owner, ownerEntries);
      return true;
    },
    removeCleanup,
    removeOwner,
    requestUpdate,
    flushUpdate,
    dispose() {
      if (disposed) return;
      disposed = true;
      updateScheduled = false;
      try {
        cancelScheduledUpdate?.();
      } catch {
        // A scheduler cannot prevent disposal from completing.
      }
      cancelScheduledUpdate = undefined;
      for (const domain of DECLARATIVE_SETTINGS_LIFECYCLE_DOMAINS) {
        generations[domain] += 1;
        status[domain] = "idle";
      }
      pending.clear();
      for (const owner of [...cleanups.keys()]) {
        removeOwner(owner);
      }
    },
  };
}
