import { describe, expect, it } from "vitest";
import {
  calculateCooldownDuration,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_INITIAL_COOLDOWN_MS,
  DEFAULT_MAX_COOLDOWN_MS,
  getRemainingBackoffCooldownMs,
  INITIAL_EMBEDDING_BACKOFF_STATE,
  isBackoffCooldownActive,
  recordBackoffFailure,
  recordBackoffSuccess,
} from "../../src/maintenance/embeddingBackoffPolicy";

describe("embeddingBackoffPolicy", () => {
  describe("calculateCooldownDuration", () => {
    it("returns 0 for 0 or negative failures", () => {
      expect(calculateCooldownDuration(0)).toBe(0);
      expect(calculateCooldownDuration(-1)).toBe(0);
    });

    it("returns initial cooldown for 1 failure", () => {
      expect(calculateCooldownDuration(1)).toBe(DEFAULT_INITIAL_COOLDOWN_MS); // 60,000 ms
    });

    it("scales exponentially with defaults", () => {
      expect(calculateCooldownDuration(1)).toBe(60_000); // 1m
      expect(calculateCooldownDuration(2)).toBe(120_000); // 2m
      expect(calculateCooldownDuration(3)).toBe(240_000); // 4m
      expect(calculateCooldownDuration(4)).toBe(480_000); // 8m
      expect(calculateCooldownDuration(5)).toBe(900_000); // 15m (capped at max)
      expect(calculateCooldownDuration(10)).toBe(900_000); // 15m (capped at max)
    });

    it("respects custom configuration", () => {
      const customConfig = {
        initialCooldownMs: 10_000,
        backoffMultiplier: 3.0,
        maxCooldownMs: 100_000,
      };

      expect(calculateCooldownDuration(1, customConfig)).toBe(10_000);
      expect(calculateCooldownDuration(2, customConfig)).toBe(30_000);
      expect(calculateCooldownDuration(3, customConfig)).toBe(90_000);
      expect(calculateCooldownDuration(4, customConfig)).toBe(100_000); // capped at max
    });
  });

  describe("recordBackoffFailure", () => {
    it("transitions from initial state on first failure", () => {
      const now = 1_000_000;
      const state = recordBackoffFailure(INITIAL_EMBEDDING_BACKOFF_STATE, now);

      expect(state.consecutiveFailures).toBe(1);
      expect(state.lastFailureTimestamp).toBe(now);
      expect(state.cooldownUntil).toBe(now + 60_000);
    });

    it("increments failures and computes exponential cooldown on consecutive failures", () => {
      const now1 = 1_000_000;
      const state1 = recordBackoffFailure(INITIAL_EMBEDDING_BACKOFF_STATE, now1);

      const now2 = 1_070_000;
      const state2 = recordBackoffFailure(state1, now2);

      expect(state2.consecutiveFailures).toBe(2);
      expect(state2.lastFailureTimestamp).toBe(now2);
      expect(state2.cooldownUntil).toBe(now2 + 120_000);
    });
  });

  describe("recordBackoffSuccess", () => {
    it("resets failure counter and clears cooldown", () => {
      const failedState = {
        consecutiveFailures: 4,
        lastFailureTimestamp: 1_000_000,
        cooldownUntil: 1_480_000,
      };

      const resetState = recordBackoffSuccess();
      expect(resetState.consecutiveFailures).toBe(0);
      expect(resetState.lastFailureTimestamp).toBeNull();
      expect(resetState.cooldownUntil).toBeNull();
    });
  });

  describe("isBackoffCooldownActive & getRemainingBackoffCooldownMs", () => {
    it("returns false and 0 when cooldownUntil is null", () => {
      expect(isBackoffCooldownActive(INITIAL_EMBEDDING_BACKOFF_STATE, 1_000_000)).toBe(false);
      expect(getRemainingBackoffCooldownMs(INITIAL_EMBEDDING_BACKOFF_STATE, 1_000_000)).toBe(0);
    });

    it("correctly identifies active vs expired cooldowns", () => {
      const state = {
        consecutiveFailures: 1,
        lastFailureTimestamp: 1_000_000,
        cooldownUntil: 1_060_000,
      };

      // Before expiration
      expect(isBackoffCooldownActive(state, 1_030_000)).toBe(true);
      expect(getRemainingBackoffCooldownMs(state, 1_030_000)).toBe(30_000);

      // Exact expiration
      expect(isBackoffCooldownActive(state, 1_060_000)).toBe(false);
      expect(getRemainingBackoffCooldownMs(state, 1_060_000)).toBe(0);

      // After expiration
      expect(isBackoffCooldownActive(state, 1_070_000)).toBe(false);
      expect(getRemainingBackoffCooldownMs(state, 1_070_000)).toBe(0);
    });
  });
});
