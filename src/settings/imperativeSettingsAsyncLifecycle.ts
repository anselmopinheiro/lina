export const IMPERATIVE_SETTINGS_ASYNC_DOMAINS = [
  "analysis-connection",
  "embeddings-connection",
  "credentials-analysis",
  "credentials-embeddings",
  "binary",
] as const;

export type ImperativeSettingsAsyncDomain = typeof IMPERATIVE_SETTINGS_ASYNC_DOMAINS[number];

declare const imperativeSettingsAsyncTokenBrand: unique symbol;

/** Opaque token owned by one asynchronous action of the imperative tab. */
export interface ImperativeSettingsAsyncToken {
  readonly domain: ImperativeSettingsAsyncDomain;
  readonly generation: number;
  readonly [imperativeSettingsAsyncTokenBrand]: undefined;
}

export interface ImperativeSettingsAsyncLifecycle {
  begin(domain: ImperativeSettingsAsyncDomain): ImperativeSettingsAsyncToken | undefined;
  isCurrent(token: ImperativeSettingsAsyncToken): boolean;
  finish(token: ImperativeSettingsAsyncToken): boolean;
  invalidate(domain: ImperativeSettingsAsyncDomain): void;
  invalidateAll(): void;
  isPending(domain: ImperativeSettingsAsyncDomain): boolean;
  isDisposed(): boolean;
  dispose(): void;
}

type GenerationState = Record<ImperativeSettingsAsyncDomain, number>;

function createGenerationState(): GenerationState {
  return {
    "analysis-connection": 0,
    "embeddings-connection": 0,
    "credentials-analysis": 0,
    "credentials-embeddings": 0,
    binary: 0,
  };
}

/**
 * Small ownership primitive for the imperative settings tab only. It neither
 * schedules UI work nor cancels boundary calls; it merely makes late
 * completions inert after a render, invalidation, or disposal.
 */
export function createImperativeSettingsAsyncLifecycle(): ImperativeSettingsAsyncLifecycle {
  let disposed = false;
  const generations = createGenerationState();
  const pending = new Map<ImperativeSettingsAsyncDomain, number>();

  const invalidate = (domain: ImperativeSettingsAsyncDomain): void => {
    generations[domain] += 1;
    pending.delete(domain);
  };
  const isCurrent = (token: ImperativeSettingsAsyncToken): boolean =>
    !disposed
      && generations[token.domain] === token.generation
      && pending.get(token.domain) === token.generation;

  return {
    begin(domain) {
      if (disposed || pending.has(domain)) return undefined;
      const generation = generations[domain] + 1;
      generations[domain] = generation;
      pending.set(domain, generation);
      return { domain, generation } as ImperativeSettingsAsyncToken;
    },
    isCurrent,
    finish(token) {
      if (!isCurrent(token)) return false;
      pending.delete(token.domain);
      return true;
    },
    invalidate,
    invalidateAll() {
      for (const domain of IMPERATIVE_SETTINGS_ASYNC_DOMAINS) invalidate(domain);
    },
    isPending(domain) {
      return !disposed && pending.has(domain);
    },
    isDisposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const domain of IMPERATIVE_SETTINGS_ASYNC_DOMAINS) generations[domain] += 1;
      pending.clear();
    },
  };
}
