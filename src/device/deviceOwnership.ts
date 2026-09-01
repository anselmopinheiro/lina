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

export const OWNERSHIP_SCHEMA_VERSION = 1;
export const OWNERSHIP_FILE_PATH = ".lina/ownership.json";

export type OwnershipReason = "initial" | "manual-transfer" | "recovery-claim";

/**
 * Manifest representing the current authoritative publisher of shared vault artifacts.
 */
export interface OwnershipManifest {
  /** Schema version integer for forward/backward compatibility. */
  readonly schemaVersion: 1;

  /** Persistent UUID v4 of the active producer authorized to publish shared artifacts. */
  readonly activeProducerId: string;

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
}

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
  return value === "initial" || value === "manual-transfer" || value === "recovery-claim";
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

  if (typeof value.activeProducerId !== "string" || !isValidDeviceId(value.activeProducerId)) {
    return false;
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
 * Loads and validates the ownership manifest from `.lina/ownership.json`.
 * Returns `null` if the file does not exist, is empty, contains invalid JSON, or fails schema validation.
 */
export async function loadOwnership(adapter: OwnershipDataAdapter): Promise<OwnershipManifest | null> {
  const filePath = getOwnershipPath();

  try {
    const exists = await adapter.exists(filePath);
    if (!exists) {
      return null;
    }

    const rawContent = await adapter.read(filePath);
    if (!rawContent || rawContent.trim().length === 0) {
      return null;
    }

    const parsed: unknown = JSON.parse(rawContent);
    if (isOwnershipManifest(parsed)) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Atomically persists the ownership manifest using a temporary staging file and rename sequence.
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
  const serialized = JSON.stringify(manifest, null, 2);

  try {
    await adapter.write(temporaryPath, serialized);
    await adapter.rename(temporaryPath, targetPath);
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath);
      }
    } catch {
      // Ignore temporary file cleanup errors
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

  const existing = await loadOwnership(adapter);
  if (existing) {
    throw new Error(
      `Cannot claim initial ownership: ownership manifest already exists for producer "${existing.activeProducerId}" at epoch ${existing.epoch}.`
    );
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

  const current = await loadOwnership(adapter);

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
