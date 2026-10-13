import {
  getVaultEventPath,
  getVaultRenameOldPath,
} from "../index/automaticUpdateEvents";

/**
 * Canonical synchronized artifact whose change can alter the Consumer's
 * Producer freshness alert.
 */
export const PRODUCER_STATE_FILE_PATH = ".lina/producer-state.json";

/**
 * Returns whether a vault event changes the canonical Producer state.
 *
 * A rename away from the path is relevant as well: the Consumer must re-read
 * so it can present the missing/unknown state rather than retain stale UI.
 */
export function isProducerStateVaultChange(file: unknown, oldPath?: unknown): boolean {
  return getVaultEventPath(file) === PRODUCER_STATE_FILE_PATH
    || getVaultRenameOldPath(oldPath) === PRODUCER_STATE_FILE_PATH;
}

/**
 * Cadence of the cheap `stat` check used while the Lina panel is visible.
 *
 * Vault events are not guaranteed for files inside the hidden `.lina` folder,
 * so the synchronized artifact is also observed by metadata. One `stat` of one
 * file; no read, no network, no polling of the index.
 */
export const PRODUCER_STATE_STAT_POLL_INTERVAL_MS = 30_000;

export interface ProducerStateStatAdapter {
  stat(path: string): Promise<{ readonly mtime?: number; readonly size?: number } | null>;
}

export interface ProducerStateChangeDetector {
  /**
   * Resolves `true` only when the artifact's metadata differs from the previous
   * successful observation. The first successful observation is the baseline
   * and never reports a change. A failed `stat` neither reports nor moves the
   * baseline, so a transient adapter error cannot cause a refresh loop.
   */
  check(): Promise<boolean>;
}

export function createProducerStateChangeDetector(
  adapter: ProducerStateStatAdapter,
  path: string = PRODUCER_STATE_FILE_PATH,
): ProducerStateChangeDetector {
  let baseline: string | undefined;
  let inFlight: Promise<boolean> | undefined;

  const observe = async (): Promise<boolean> => {
    let signature: string;
    try {
      const stat = await adapter.stat(path);
      signature = stat ? `${stat.mtime ?? "?"}:${stat.size ?? "?"}` : "missing";
    } catch {
      return false;
    }
    if (baseline === undefined) {
      baseline = signature;
      return false;
    }
    if (signature === baseline) return false;
    baseline = signature;
    return true;
  };

  return {
    check(): Promise<boolean> {
      // Single-flight: concurrent triggers (interval + leaf change) share one stat.
      inFlight ??= observe().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
