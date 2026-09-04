/**
 * Persistent Device Identity Service
 *
 * Provides a stable, unique, and cross-platform identifier for each Lina installation.
 * Backed by Obsidian's official `app.loadLocalStorage` and `app.saveLocalStorage` APIs.
 * The identifier is stored strictly outside synchronized vault files and remains independent
 * of hardware or browser fingerprints.
 */

export const LINA_DEVICE_ID_STORAGE_KEY = "lina_device_id";

/**
 * Minimal storage boundary representing Obsidian's App local storage methods.
 */
export interface DeviceIdentityStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIXED_UUID_REGEX = /^dev-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a given value is a well-formed, non-empty device identifier.
 */
export function isValidDeviceId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return false;
  }
  return UUID_REGEX.test(trimmed) || PREFIXED_UUID_REGEX.test(trimmed);
}

/**
 * Generates a cryptographically secure random UUID v4 string.
 */
export function generateDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback for minimal environments lacking crypto.randomUUID
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Retrieves the persisted device ID from local storage.
 * If no valid device ID exists, generates a new secure UUID, persists it, and returns it.
 *
 * @param storage - An object implementing Obsidian's `loadLocalStorage` and `saveLocalStorage` methods (typically `app`).
 * @returns The authoritative persistent device ID.
 */
export function getOrCreatePersistentDeviceId(storage: DeviceIdentityStorage): string {
  try {
    const stored = storage.loadLocalStorage(LINA_DEVICE_ID_STORAGE_KEY);
    if (isValidDeviceId(stored)) {
      return stored.trim();
    }
  } catch {
    // If reading from storage fails, proceed to generate a fresh ID
  }

  const newId = generateDeviceId();
  try {
    storage.saveLocalStorage(LINA_DEVICE_ID_STORAGE_KEY, newId);
  } catch {
    // If writing to storage fails, return the generated ID in-memory for this session
  }

  return newId;
}

/**
 * Clears any stored device ID from local storage.
 * Intended primarily for testing and diagnostic purposes.
 */
export function clearPersistentDeviceId(storage: DeviceIdentityStorage): void {
  try {
    storage.saveLocalStorage(LINA_DEVICE_ID_STORAGE_KEY, null);
  } catch {
    // Ignore storage errors during cleanup
  }
}
