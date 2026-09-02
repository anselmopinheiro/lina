/**
 * Embedding Backoff Policy (Phase 0.2.2.6)
 *
 * Pure, deterministic resilience model preventing repeated automatic embedding
 * maintenance failures from creating tight retry loops or overloading local providers.
 *
 * Core Architectural Invariant:
 * "Failed automatic generation applies exponential cooldown without losing dirty work state."
 */

export interface EmbeddingBackoffConfig {
  readonly initialCooldownMs?: number;
  readonly backoffMultiplier?: number;
  readonly maxCooldownMs?: number;
}

export interface EmbeddingBackoffState {
  readonly consecutiveFailures: number;
  readonly lastFailureTimestamp: number | null;
  readonly cooldownUntil: number | null;
}

export const DEFAULT_INITIAL_COOLDOWN_MS = 60_000; // 1 minute
export const DEFAULT_BACKOFF_MULTIPLIER = 2.0;
export const DEFAULT_MAX_COOLDOWN_MS = 900_000; // 15 minutes

export const INITIAL_EMBEDDING_BACKOFF_STATE: Readonly<EmbeddingBackoffState> = {
  consecutiveFailures: 0,
  lastFailureTimestamp: null,
  cooldownUntil: null,
};

/**
 * Calculates cooldown duration in milliseconds based on consecutive failures.
 *
 * Formula: min(initialCooldown * (multiplier ^ (failures - 1)), maxCooldown)
 */
export function calculateCooldownDuration(
  consecutiveFailures: number,
  config?: EmbeddingBackoffConfig,
): number {
  if (consecutiveFailures <= 0) {
    return 0;
  }
  const initial = Math.max(0, config?.initialCooldownMs ?? DEFAULT_INITIAL_COOLDOWN_MS);
  const multiplier = Math.max(1, config?.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER);
  const max = Math.max(initial, config?.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS);

  const duration = initial * Math.pow(multiplier, consecutiveFailures - 1);
  return Math.min(Math.round(duration), max);
}

/**
 * Records an automatic generation failure and computes the next cooldown expiration timestamp.
 */
export function recordBackoffFailure(
  currentState: EmbeddingBackoffState,
  now: number,
  config?: EmbeddingBackoffConfig,
): EmbeddingBackoffState {
  const consecutiveFailures = currentState.consecutiveFailures + 1;
  const cooldownDuration = calculateCooldownDuration(consecutiveFailures, config);
  return {
    consecutiveFailures,
    lastFailureTimestamp: now,
    cooldownUntil: now + cooldownDuration,
  };
}

/**
 * Resets backoff state upon successful generation or manual intervention.
 */
export function recordBackoffSuccess(): EmbeddingBackoffState {
  return {
    consecutiveFailures: 0,
    lastFailureTimestamp: null,
    cooldownUntil: null,
  };
}

/**
 * Checks whether an active cooldown is currently blocking automatic dispatch.
 */
export function isBackoffCooldownActive(state: EmbeddingBackoffState, now: number): boolean {
  if (state.cooldownUntil === null) {
    return false;
  }
  return now < state.cooldownUntil;
}

/**
 * Returns remaining cooldown duration in milliseconds relative to `now`.
 */
export function getRemainingBackoffCooldownMs(state: EmbeddingBackoffState, now: number): number {
  if (state.cooldownUntil === null) {
    return 0;
  }
  return Math.max(0, state.cooldownUntil - now);
}
