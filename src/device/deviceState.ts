/**
 * Device-Scoped State Service (Phase B)
 *
 * Manages device-specific state stored in dedicated, unsynchronized-per-device files
 * located at `.lina/devices/<deviceId>.json`.
 *
 * This separates genuinely shared user preferences (which belong in `data.json`) from
 * installation-specific operational state and hardware profiles, preventing synchronization
 * write collisions across multiple devices.
 */

import { normalizePath } from "obsidian";
import { isValidDeviceId } from "./deviceIdentity";

export const DEVICE_STATE_SCHEMA_VERSION = 1;
export const DEVICE_STATE_DIRECTORY = ".lina/devices";

/**
 * Minimal schema for device-scoped state.
 */
export interface DeviceState {
  readonly schemaVersion: 1;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deviceName?: string;
}

/**
 * Minimal DataAdapter contract needed for device state persistence.
 */
export interface DeviceStateDataAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  stat?(path: string): Promise<{ type: string; size: number; mtime: number } | null>;
  mkdir?(path: string): Promise<void>;
}

/**
 * Computes the canonical normalized vault file path for a device state file.
 */
export function getDeviceStatePath(deviceId: string): string {
  const normalizedId = deviceId.trim();
  if (!isValidDeviceId(normalizedId)) {
    throw new Error(`Invalid device ID for device state path: "${deviceId}"`);
  }
  return normalizePath(`${DEVICE_STATE_DIRECTORY}/${normalizedId}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates whether an unknown object conforms to the `DeviceState` schema.
 */
export function isDeviceState(value: unknown): value is DeviceState {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== DEVICE_STATE_SCHEMA_VERSION) {
    return false;
  }

  if (typeof value.deviceId !== "string" || !isValidDeviceId(value.deviceId)) {
    return false;
  }

  if (typeof value.createdAt !== "string" || value.createdAt.trim().length === 0) {
    return false;
  }

  if (typeof value.updatedAt !== "string" || value.updatedAt.trim().length === 0) {
    return false;
  }

  if (value.deviceName !== undefined && typeof value.deviceName !== "string") {
    return false;
  }

  return true;
}

/**
 * Creates a default `DeviceState` object with initial timestamps.
 */
export function createDefaultDeviceState(deviceId: string, deviceName?: string): DeviceState {
  const normalizedId = deviceId.trim();
  if (!isValidDeviceId(normalizedId)) {
    throw new Error(`Cannot create default device state with invalid deviceId: "${deviceId}"`);
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    deviceId: normalizedId,
    createdAt: now,
    updatedAt: now,
    ...(deviceName && deviceName.trim().length > 0 ? { deviceName: deviceName.trim() } : {}),
  };
}

/**
 * Ensures the parent directories for device state files exist in the vault.
 */
async function ensureDeviceStateDirectories(adapter: DeviceStateDataAdapter): Promise<void> {
  const paths = [normalizePath(".lina"), normalizePath(DEVICE_STATE_DIRECTORY)];
  for (const dirPath of paths) {
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
}

/**
 * Loads the device-scoped state file for the specified `deviceId`.
 * Returns `null` if the file does not exist or contains invalid/corrupt data.
 */
export async function loadDeviceState(
  adapter: DeviceStateDataAdapter,
  deviceId: string
): Promise<DeviceState | null> {
  const filePath = getDeviceStatePath(deviceId);

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
    if (isDeviceState(parsed) && parsed.deviceId === deviceId.trim()) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Atomically saves the device-scoped state file using a temporary file and rename sequence.
 */
export async function saveDeviceState(
  adapter: DeviceStateDataAdapter,
  state: DeviceState
): Promise<void> {
  if (!isDeviceState(state)) {
    throw new Error("Cannot save invalid DeviceState.");
  }

  await ensureDeviceStateDirectories(adapter);

  const targetPath = getDeviceStatePath(state.deviceId);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temporaryPath = `${targetPath}.tmp-${suffix}`;
  const serialized = JSON.stringify(state, null, 2);

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
 * Loads existing device state or creates, saves, and returns a fresh default device state.
 */
export async function getOrCreateDeviceState(
  adapter: DeviceStateDataAdapter,
  deviceId: string,
  deviceName?: string
): Promise<DeviceState> {
  const existing = await loadDeviceState(adapter, deviceId);
  if (existing) {
    return existing;
  }

  const newState = createDefaultDeviceState(deviceId, deviceName);
  await saveDeviceState(adapter, newState);
  return newState;
}
