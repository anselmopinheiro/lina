/**
 * Ownership Transfer Safety & Confirmation Layer (Phase D2.5.2)
 *
 * Provides a safety abstraction layer before executing ownership transfers:
 * 1. Generates structured, read-only transfer previews without side effects.
 * 2. Enforces explicit confirmation requirements to prevent silent or accidental transfers.
 * 3. Revalidates fencing tokens (expectedEpoch) to prevent race conditions from stale previews.
 * 4. Delegates atomic persistence exclusively to `transferOwnershipToDevice`.
 *
 * Architectural Invariants:
 * - Zero UI dependencies: Returns machine-readable structured results without localized strings.
 * - Zero side effects during preview: Preview creation never writes, deletes, or renames files.
 * - Zero automatic takeover: No heartbeat, TTL, background monitoring, or auto-promotion routines.
 * - Strict role isolation: Role != Ownership. Transfer changes publication authority only.
 */

import { isValidDeviceId } from "./deviceIdentity";
import {
  loadOwnership,
  OwnershipDataAdapter,
  OwnershipManifest,
} from "./deviceOwnership";
import {
  transferOwnershipToDevice,
  OwnershipTransferFailureReason,
} from "./deviceOwnershipTransfer";
import { appendOwnershipAuditEvent } from "./deviceOwnershipAudit";

/**
 * Structured read-only preview of an intended ownership transfer.
 */
export interface OwnershipTransferPreview {
  readonly currentProducerId: string;
  readonly targetProducerId: string;
  readonly currentEpoch: number;
  readonly nextEpoch: number;
  readonly reason: "manual-transfer";
  readonly requiresConfirmation: true;
  readonly preparedAt: string;
}

/**
 * Explicit user confirmation token required to execute an ownership transfer.
 */
export interface OwnershipTransferConfirmation {
  readonly confirmed: boolean;
}

export type OwnershipTransferPreviewFailureReason =
  | "missing-ownership"
  | "invalid-target-device"
  | "already-active-producer";

export interface OwnershipTransferPreviewSuccess {
  readonly success: true;
  readonly preview: OwnershipTransferPreview;
}

export interface OwnershipTransferPreviewFailure {
  readonly success: false;
  readonly reason: OwnershipTransferPreviewFailureReason;
  readonly error?: Error;
}

export type OwnershipTransferPreviewResult =
  | OwnershipTransferPreviewSuccess
  | OwnershipTransferPreviewFailure;

export type OwnershipTransferExecutionFailureReason =
  | "confirmation-required"
  | "invalid-preview"
  | OwnershipTransferFailureReason;

export interface OwnershipTransferExecutionSuccess {
  readonly success: true;
  readonly manifest: OwnershipManifest;
  readonly previousManifest: OwnershipManifest;
}

export interface OwnershipTransferExecutionFailure {
  readonly success: false;
  readonly reason: OwnershipTransferExecutionFailureReason;
  readonly currentManifest?: OwnershipManifest | null;
  readonly error?: Error;
}

export type OwnershipTransferExecutionResult =
  | OwnershipTransferExecutionSuccess
  | OwnershipTransferExecutionFailure;

/**
 * Validates whether an unknown object conforms to the `OwnershipTransferPreview` schema.
 */
export function isOwnershipTransferPreview(value: unknown): value is OwnershipTransferPreview {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const v = value as Record<string, unknown>;

  if (typeof v.currentProducerId !== "string" || !isValidDeviceId(v.currentProducerId)) {
    return false;
  }

  if (typeof v.targetProducerId !== "string" || !isValidDeviceId(v.targetProducerId)) {
    return false;
  }

  if (v.currentProducerId === v.targetProducerId) {
    return false;
  }

  if (typeof v.currentEpoch !== "number" || !Number.isInteger(v.currentEpoch) || v.currentEpoch < 1) {
    return false;
  }

  if (typeof v.nextEpoch !== "number" || v.nextEpoch !== v.currentEpoch + 1) {
    return false;
  }

  if (v.reason !== "manual-transfer") {
    return false;
  }

  if (v.requiresConfirmation !== true) {
    return false;
  }

  if (typeof v.preparedAt !== "string" || v.preparedAt.trim().length === 0) {
    return false;
  }

  return true;
}

/**
 * Prepares a structured, read-only preview of an intended ownership transfer.
 *
 * Safety Invariant:
 * - This function performs zero filesystem writes, role changes, or worker triggers.
 *
 * @param adapter - DataAdapter for reading the current vault ownership manifest.
 * @param targetDeviceId - The device ID intended to become the new active producer.
 * @returns Structured result containing the transfer preview or failure reason.
 */
export async function prepareOwnershipTransferPreview(
  adapter: OwnershipDataAdapter,
  targetDeviceId: string
): Promise<OwnershipTransferPreviewResult> {
  const normalizedTargetId = typeof targetDeviceId === "string" ? targetDeviceId.trim() : "";

  // 1. Validate target device format
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
    };
  }

  // 4. Construct read-only preview
  const preview: OwnershipTransferPreview = {
    currentProducerId: currentManifest.activeProducerId,
    targetProducerId: normalizedTargetId,
    currentEpoch: currentManifest.epoch,
    nextEpoch: currentManifest.epoch + 1,
    reason: "manual-transfer",
    requiresConfirmation: true,
    preparedAt: new Date().toISOString(),
  };

  return {
    success: true,
    preview,
  };
}

/**
 * Validates explicit confirmation and executes an ownership transfer.
 *
 * Safety Invariants:
 * 1. Requires explicit confirmation (`confirmation.confirmed === true`).
 * 2. Revalidates preview structure and integrity.
 * 3. Enforces monotonic epoch fencing: if current manifest epoch on disk no longer matches
 *    `preview.currentEpoch`, fails immediately with `"epoch-mismatch"`.
 * 4. Delegates atomic persistence exclusively to `transferOwnershipToDevice`.
 *
 * @param adapter - DataAdapter for vault file operations.
 * @param preview - The preview object generated by `prepareOwnershipTransferPreview`.
 * @param confirmation - Explicit user confirmation token.
 * @returns Structured result indicating transfer execution outcome.
 */
export async function confirmAndExecuteOwnershipTransfer(
  adapter: OwnershipDataAdapter,
  preview: OwnershipTransferPreview,
  confirmation: OwnershipTransferConfirmation
): Promise<OwnershipTransferExecutionResult> {
  // 1. Enforce explicit confirmation
  if (!confirmation || confirmation.confirmed !== true) {
    return {
      success: false,
      reason: "confirmation-required",
    };
  }

  // 2. Validate preview object integrity
  if (!isOwnershipTransferPreview(preview)) {
    return {
      success: false,
      reason: "invalid-preview",
    };
  }

  // 3. Execute transfer via service layer, passing preview.currentEpoch as fencing guard
  const transferResult = await transferOwnershipToDevice(adapter, preview.targetProducerId, {
    expectedEpoch: preview.currentEpoch,
  });

  if (!transferResult.success) {
    return {
      success: false,
      reason: transferResult.reason,
      currentManifest: transferResult.currentManifest,
      error: transferResult.error,
    };
  }

  // 4. Append immutable audit trail event for confirmed transfer
  try {
    await appendOwnershipAuditEvent(adapter, {
      previousProducerId: transferResult.previousManifest.activeProducerId,
      newProducerId: transferResult.manifest.activeProducerId,
      previousEpoch: transferResult.previousManifest.epoch,
      newEpoch: transferResult.manifest.epoch,
      reason: "manual-transfer",
      executedAt: transferResult.manifest.acquiredAt,
    });
  } catch (auditError) {
    console.warn("Lina: failed to append ownership audit event:", auditError);
  }

  return {
    success: true,
    manifest: transferResult.manifest,
    previousManifest: transferResult.previousManifest,
  };
}
