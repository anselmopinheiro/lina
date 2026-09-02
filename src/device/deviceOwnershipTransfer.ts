/**
 * Manual Ownership Transfer Service Foundation (Phase D2.5.1)
 *
 * Provides a dedicated, safe, and controlled service layer for transferring
 * active producer ownership to a designated device.
 *
 * Architectural Invariants:
 * - Strictly isolated service: Zero UI, zero worker triggers, zero index rebuilds, zero role mutations, zero auto-takeover.
 * - Monotonic epoch fencing: Increments the epoch by exactly 1 on successful transfer.
 * - Atomic persistence: Writes to a temporary file before renaming to `.lina/ownership.json`.
 * - Structured results: Returns typed success/failure representations without throwing or using localized UI strings.
 */

import { isValidDeviceId } from "./deviceIdentity";
import {
  loadOwnership,
  saveOwnership,
  OwnershipDataAdapter,
  OwnershipManifest,
  OWNERSHIP_SCHEMA_VERSION,
} from "./deviceOwnership";

export type OwnershipTransferFailureReason =
  | "missing-ownership"
  | "invalid-target-device"
  | "already-active-producer"
  | "epoch-mismatch"
  | "persistence-failure";

export interface OwnershipTransferSuccess {
  readonly success: true;
  readonly manifest: OwnershipManifest;
  readonly previousManifest: OwnershipManifest;
}

export interface OwnershipTransferFailure {
  readonly success: false;
  readonly reason: OwnershipTransferFailureReason;
  readonly currentManifest?: OwnershipManifest | null;
  readonly error?: Error;
}

export type OwnershipTransferResult = OwnershipTransferSuccess | OwnershipTransferFailure;

export interface OwnershipTransferOptions {
  /**
   * Optional epoch guard. If provided, transfer will only proceed if the current
   * manifest's epoch strictly matches this value (preventing race conditions).
   */
  readonly expectedEpoch?: number;
}

/**
 * Transfers vault publisher ownership to a target device.
 *
 * Validation Rules:
 * 1. An existing, valid ownership manifest must be present in `.lina/ownership.json`.
 * 2. Target device ID must be a valid UUID v4 (or valid device ID).
 * 3. Target device must not already be the active producer.
 * 4. If `expectedEpoch` is supplied, it must match the current manifest's epoch.
 *
 * Epoch & State:
 * - Increments epoch monotonically (`currentEpoch + 1`).
 * - Stamped with `reason = "manual-transfer"`.
 * - Atomically persisted.
 *
 * Safety:
 * - Does NOT mutate device roles.
 * - Does NOT trigger index rebuilds or background workers.
 * - Does NOT perform automatic recovery claims.
 *
 * @param adapter - DataAdapter for vault file I/O.
 * @param targetDeviceId - The persistent device ID of the intended new active producer.
 * @param options - Optional configuration including expectedEpoch fencing token.
 * @returns Structured result indicating success or failure.
 */
export async function transferOwnershipToDevice(
  adapter: OwnershipDataAdapter,
  targetDeviceId: string,
  options?: OwnershipTransferOptions
): Promise<OwnershipTransferResult> {
  const normalizedTargetId = typeof targetDeviceId === "string" ? targetDeviceId.trim() : "";

  // 1. Validate target device identifier format
  if (!isValidDeviceId(normalizedTargetId)) {
    return {
      success: false,
      reason: "invalid-target-device",
    };
  }

  // 2. Load current ownership manifest
  let currentManifest: OwnershipManifest | null = null;
  try {
    currentManifest = await loadOwnership(adapter);
  } catch (error) {
    return {
      success: false,
      reason: "missing-ownership",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  if (!currentManifest) {
    return {
      success: false,
      reason: "missing-ownership",
    };
  }

  // 3. Verify target device is not already the active producer
  if (currentManifest.activeProducerId === normalizedTargetId) {
    return {
      success: false,
      reason: "already-active-producer",
      currentManifest,
    };
  }

  // 4. Validate expected epoch fencing token if provided
  if (options?.expectedEpoch !== undefined && currentManifest.epoch !== options.expectedEpoch) {
    return {
      success: false,
      reason: "epoch-mismatch",
      currentManifest,
    };
  }

  // 5. Construct updated manifest with incremented epoch
  const now = new Date().toISOString();
  const nextEpoch = currentManifest.epoch + 1;

  const newManifest: OwnershipManifest = {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    activeProducerId: normalizedTargetId,
    epoch: nextEpoch,
    acquiredAt: now,
    updatedAt: now,
    reason: "manual-transfer",
  };

  // 6. Atomically persist updated ownership manifest
  try {
    await saveOwnership(adapter, newManifest);
  } catch (error) {
    return {
      success: false,
      reason: "persistence-failure",
      currentManifest,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  return {
    success: true,
    manifest: newManifest,
    previousManifest: currentManifest,
  };
}
