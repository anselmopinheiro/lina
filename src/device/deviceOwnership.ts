/**
 * Active Producer Ownership Service (Phase D2.1)
 *
 * Manages the global ownership manifest stored in `.lina/ownership.json`.
 * Implements single-active-publisher authority and epoch-fenced ownership
 * transitions across synchronized devices without whole-vault lock contention.
 *
 * Role != Ownership:
 * - A device role ("producer") specifies operational capability/intent.
 * - Ownership authorizes a specific producer to publish shared search artifacts under an active Epoch.
 */

import { normalizePath } from "obsidian";
import { isValidDeviceId } from "./deviceIdentity";
import { appendOwnershipAuditEvent } from "./deviceOwnershipAudit";

export const OWNERSHIP_SCHEMA_VERSION = 1;
export const OWNERSHIP_FILE_PATH = ".lina/ownership.json";

export type OwnershipReason = "initial" | "manual-transfer" | "recovery-claim" | "relinquish";

/**
 * Manifest representing the current authoritative publisher of shared vault artifacts.
 */
export interface OwnershipManifest {
  /** Schema version integer for forward/backward compatibility. */
  readonly schemaVersion: 1;

  /** Persistent UUID v4 of the active producer authorized to publish shared artifacts, or null if relinquished. */
  readonly activeProducerId: string | null;

  /** Monotonically increasing fencing generation number. */
  readonly epoch: number;

  /** ISO 8601 timestamp when this ownership was acquired. */
  readonly acquiredAt: string;

  /** ISO 8601 timestamp of last confirmed update or publication. */
  readonly updatedAt: string;

  /** Reason for this ownership transition. */
  readonly reason?: OwnershipReason;
}

/**
 * Minimal DataAdapter contract needed for ownership manifest persistence.
 */
export interface OwnershipDataAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  stat?(path: string): Promise<{ type: string; size: number; mtime: number } | null>;
  mkdir?(path: string): Promise<void>;
  list?(path: string): Promise<{ files: string[]; folders: string[] }>;
}

/**
 * Explicit result of reading the shared ownership authority.  `loadOwnership`
 * is retained for read-only compatibility, but mutation and authorization
 * paths must not collapse an unreadable or invalid existing file into an
 * unclaimed vault.
 */
export type OwnershipReadResult =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly manifest: OwnershipManifest }
  | {
    readonly status: "invalid" | "unsupported-schema" | "unreadable";
    readonly reason: "empty" | "invalid-json" | "invalid-manifest" | "unsupported-schema" | "read-failed";
  };

/**
 * Computes the normalized canonical vault file path for the ownership manifest.
 */
export function getOwnershipPath(): string {
  return normalizePath(OWNERSHIP_FILE_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidReason(value: unknown): value is OwnershipReason {
  return (
    value === "initial" ||
    value === "manual-transfer" ||
    value === "recovery-claim" ||
    value === "relinquish"
  );
}

/**
 * Validates whether an unknown object conforms to the `OwnershipManifest` schema.
 */
export function isOwnershipManifest(value: unknown): value is OwnershipManifest {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    return false;
  }

  if (value.reason === "relinquish") {
    if (value.activeProducerId !== null && value.activeProducerId !== undefined) {
      return false;
    }
  } else {
    if (typeof value.activeProducerId !== "string" || !isValidDeviceId(value.activeProducerId)) {
      return false;
    }
  }

  if (typeof value.epoch !== "number" || !Number.isInteger(value.epoch) || value.epoch < 1) {
    return false;
  }

  if (typeof value.acquiredAt !== "string" || value.acquiredAt.trim().length === 0) {
    return false;
  }

  if (typeof value.updatedAt !== "string" || value.updatedAt.trim().length === 0) {
    return false;
  }

  if (value.reason !== undefined && !isValidReason(value.reason)) {
    return false;
  }

  return true;
}

/**
 * Ensures the parent directory `.lina` exists in the vault.
 */
async function ensureOwnershipDirectory(adapter: OwnershipDataAdapter): Promise<void> {
  const dirPath = normalizePath(".lina");
  try {
    if (adapter.stat) {
      const stat = await adapter.stat(dirPath);
      if (!stat) {
        if (adapter.mkdir) {
          await adapter.mkdir(dirPath);
        }
      }
    } else if (adapter.mkdir) {
      const exists = await adapter.exists(dirPath);
      if (!exists) {
        await adapter.mkdir(dirPath);
      }
    }
  } catch {
    // Ignore directory creation errors if directory already exists
  }
}

/**
 * Reads and classifies `.lina/ownership.json` without conflating absence with
 * invalid or unreadable authority.
 */
export async function readOwnership(adapter: OwnershipDataAdapter): Promise<OwnershipReadResult> {
  const filePath = getOwnershipPath();

  try {
    const exists = await adapter.exists(filePath);
    if (!exists) {
      return { status: "missing" };
    }

    let rawContent: string;
    try {
      rawContent = await adapter.read(filePath);
    } catch {
      return { status: "unreadable", reason: "read-failed" };
    }
    if (!rawContent || rawContent.trim().length === 0) {
      return { status: "invalid", reason: "empty" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return { status: "invalid", reason: "invalid-json" };
    }
    if (isOwnershipManifest(parsed)) {
      return { status: "valid", manifest: parsed };
    }

    if (isRecord(parsed) && typeof parsed.schemaVersion === "number" && parsed.schemaVersion > OWNERSHIP_SCHEMA_VERSION) {
      return { status: "unsupported-schema", reason: "unsupported-schema" };
    }
    return { status: "invalid", reason: "invalid-manifest" };
  } catch {
    return { status: "unreadable", reason: "read-failed" };
  }
}

/**
 * Compatibility reader for consumers that only need a valid manifest.  New
 * authorization or mutation paths must use `readOwnership` to preserve the
 * distinction between absent and indeterminate authority.
 */
export async function loadOwnership(adapter: OwnershipDataAdapter): Promise<OwnershipManifest | null> {
  const result = await readOwnership(adapter);
  return result.status === "valid" ? result.manifest : null;
}

/**
 * Atomically persists the ownership manifest using temporary staging, backup, and promotion.
 */
export async function saveOwnership(
  adapter: OwnershipDataAdapter,
  manifest: OwnershipManifest
): Promise<void> {
  if (!isOwnershipManifest(manifest)) {
    throw new Error("Cannot save invalid OwnershipManifest.");
  }

  await ensureOwnershipDirectory(adapter);

  const targetPath = getOwnershipPath();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temporaryPath = `${targetPath}.tmp-${suffix}`;
  const backupPath = `${targetPath}.bak-${suffix}`;
  const serialized = JSON.stringify(manifest, null, 2);
  let backedUp = false;

  try {
    await adapter.write(temporaryPath, serialized);
    if (await adapter.exists(targetPath)) {
      await adapter.rename(targetPath, backupPath);
      backedUp = true;
    }
    await adapter.rename(temporaryPath, targetPath);

    if (backedUp && await adapter.exists(backupPath)) {
      try {
        await adapter.remove(backupPath);
      } catch (cleanupError) {
        console.warn(`Lina: failed to remove temporary ownership backup ${backupPath}:`, cleanupError);
      }
    }
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath);
      }
      if (backedUp) {
        if (await adapter.exists(targetPath)) {
          await adapter.remove(targetPath);
        }
        if (await adapter.exists(backupPath)) {
          await adapter.rename(backupPath, targetPath);
        }
      }
    } catch (rollbackError) {
      console.warn(`Lina: failed to roll back ownership save for ${targetPath}:`, rollbackError);
    }
    throw error;
  }
}

/**
 * Claims initial ownership of the vault when no ownership manifest exists yet.
 *
 * Rules:
 * - Only succeeds when `.lina/ownership.json` does not exist.
 * - Initializes `epoch = 1` with `reason = "initial"`.
 * - Never overwrites an existing ownership manifest.
 */
export async function claimInitialOwnership(
  adapter: OwnershipDataAdapter,
  deviceId: string
): Promise<OwnershipManifest> {
  const normalizedId = deviceId.trim();
  if (!isValidDeviceId(normalizedId)) {
    throw new Error(`Cannot claim initial ownership with invalid deviceId: "${deviceId}"`);
  }

  const existing = await readOwnership(adapter);
  if (existing.status === "valid") {
    throw new Error(
      `Cannot claim initial ownership: ownership manifest already exists for producer "${existing.manifest.activeProducerId}" at epoch ${existing.manifest.epoch}.`
    );
  }
  if (existing.status !== "missing") {
    throw new Error(`Cannot claim initial ownership: ownership state is ${existing.status} (${existing.reason}).`);
  }

  const now = new Date().toISOString();
  const manifest: OwnershipManifest = {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    activeProducerId: normalizedId,
    epoch: 1,
    acquiredAt: now,
    updatedAt: now,
    reason: "initial",
  };

  await saveOwnership(adapter, manifest);
  return manifest;
}

/**
 * Transfers ownership to a new producer device under a monotonically incremented epoch.
 *
 * Rules:
 * - Increments the epoch (`epoch = currentEpoch + 1`).
 * - If `expectedCurrentEpoch` is provided, ensures it matches current state before transferring.
 * - Sets reason to "manual-transfer" (or specified reason).
 * - Atomically persists the updated manifest.
 */
export async function transferOwnership(
  adapter: OwnershipDataAdapter,
  newProducerId: string,
  expectedCurrentEpoch?: number,
  reason: "manual-transfer" | "recovery-claim" = "manual-transfer"
): Promise<OwnershipManifest> {
  const normalizedId = newProducerId.trim();
  if (!isValidDeviceId(normalizedId)) {
    throw new Error(`Cannot transfer ownership to invalid deviceId: "${newProducerId}"`);
  }

  const currentResult = await readOwnership(adapter);
  if (currentResult.status !== "missing" && currentResult.status !== "valid") {
    throw new Error(`Cannot transfer ownership: ownership state is ${currentResult.status} (${currentResult.reason}).`);
  }
  const current = currentResult.status === "valid" ? currentResult.manifest : null;

  if (current && expectedCurrentEpoch !== undefined && current.epoch !== expectedCurrentEpoch) {
    throw new Error(
      `Ownership epoch mismatch during transfer: expected current epoch ${expectedCurrentEpoch}, but found epoch ${current.epoch}.`
    );
  }

  const nextEpoch = current ? current.epoch + 1 : 1;
  const now = new Date().toISOString();

  const updatedManifest: OwnershipManifest = {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    activeProducerId: normalizedId,
    epoch: nextEpoch,
    acquiredAt: now,
    updatedAt: now,
    reason,
  };

  await saveOwnership(adapter, updatedManifest);
  return updatedManifest;
}

/**
 * Relinquishes active producer ownership of the vault.
 *
 * Rules:
 * - Only the current active producer may relinquish ownership.
 * - Increments epoch monotonically (epoch = currentEpoch + 1).
 * - If expectedCurrentEpoch is provided, validates that it matches current manifest.
 * - Sets activeProducerId = null.
 * - Sets reason = "relinquish".
 * - Atomically persists the updated manifest.
 * - Appends audit event to .lina/ownership-history/.
 */
export async function relinquishOwnership(
  adapter: OwnershipDataAdapter,
  currentProducerId: string,
  expectedCurrentEpoch?: number
): Promise<OwnershipManifest> {
  const normalizedId = currentProducerId.trim();
  if (!isValidDeviceId(normalizedId)) {
    throw new Error(`Cannot relinquish ownership with invalid deviceId: "${currentProducerId}"`);
  }

  const currentResult = await readOwnership(adapter);
  if (currentResult.status !== "valid") {
    throw new Error("Cannot relinquish ownership: no ownership manifest exists.");
  }
  const current = currentResult.manifest;

  if (current.activeProducerId !== normalizedId) {
    throw new Error(
      `Cannot relinquish ownership: device "${normalizedId}" is not the active producer (current active producer is "${current.activeProducerId}").`
    );
  }

  if (expectedCurrentEpoch !== undefined && current.epoch !== expectedCurrentEpoch) {
    throw new Error(
      `Ownership epoch mismatch during relinquish: expected current epoch ${expectedCurrentEpoch}, but found epoch ${current.epoch}.`
    );
  }

  const nextEpoch = current.epoch + 1;
  const now = new Date().toISOString();

  const updatedManifest: OwnershipManifest = {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    activeProducerId: null,
    epoch: nextEpoch,
    acquiredAt: now,
    updatedAt: now,
    reason: "relinquish",
  };

  await saveOwnership(adapter, updatedManifest);

  try {
    await appendOwnershipAuditEvent(adapter, {
      previousProducerId: normalizedId,
      newProducerId: null,
      previousEpoch: current.epoch,
      newEpoch: nextEpoch,
      reason: "relinquish",
      executedAt: now,
    });
  } catch (auditError) {
    console.warn("Lina: failed to append ownership audit event for relinquish:", auditError);
  }

  return updatedManifest;
}
