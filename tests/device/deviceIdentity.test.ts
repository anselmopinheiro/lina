import { describe, expect, it } from "vitest";
import {
  clearPersistentDeviceId,
  generateDeviceId,
  getOrCreatePersistentDeviceId,
  isValidDeviceId,
  LINA_DEVICE_ID_STORAGE_KEY,
  type DeviceIdentityStorage,
} from "../../src/device/deviceIdentity";

class MemoryStorage implements DeviceIdentityStorage {
  private map = new Map<string, unknown>();

  loadLocalStorage(key: string): unknown {
    return this.map.get(key) ?? null;
  }

  saveLocalStorage(key: string, data: unknown | null): void {
    if (data === null || data === undefined) {
      this.map.delete(key);
    } else {
      this.map.set(key, data);
    }
  }

  getRaw(key: string): unknown {
    return this.map.get(key);
  }
}

describe("deviceIdentity", () => {
  it("validates well-formed UUID and prefixed UUID strings", () => {
    expect(isValidDeviceId("c9bf9e57-1685-4c89-bafb-ff5af830be8a")).toBe(true);
    expect(isValidDeviceId("dev-c9bf9e57-1685-4c89-bafb-ff5af830be8a")).toBe(true);
    expect(isValidDeviceId("")).toBe(false);
    expect(isValidDeviceId("   ")).toBe(false);
    expect(isValidDeviceId(null)).toBe(false);
    expect(isValidDeviceId(undefined)).toBe(false);
    expect(isValidDeviceId(12345)).toBe(false);
    expect(isValidDeviceId("invalid-device-id")).toBe(false);
  });

  it("generates valid UUIDs", () => {
    const id1 = generateDeviceId();
    const id2 = generateDeviceId();

    expect(isValidDeviceId(id1)).toBe(true);
    expect(isValidDeviceId(id2)).toBe(true);
    expect(id1).not.toBe(id2);
  });

  it("generates and persists a new UUID when storage is empty on first run", () => {
    const storage = new MemoryStorage();
    expect(storage.getRaw(LINA_DEVICE_ID_STORAGE_KEY)).toBeUndefined();

    const deviceId = getOrCreatePersistentDeviceId(storage);

    expect(isValidDeviceId(deviceId)).toBe(true);
    expect(storage.getRaw(LINA_DEVICE_ID_STORAGE_KEY)).toBe(deviceId);
  });

  it("reuses existing persisted UUID without regenerating on subsequent calls", () => {
    const storage = new MemoryStorage();
    const firstId = getOrCreatePersistentDeviceId(storage);
    const secondId = getOrCreatePersistentDeviceId(storage);
    const thirdId = getOrCreatePersistentDeviceId(storage);

    expect(firstId).toBe(secondId);
    expect(secondId).toBe(thirdId);
  });

  it("replaces invalid or corrupt stored values with a fresh valid UUID", () => {
    const storage = new MemoryStorage();
    storage.saveLocalStorage(LINA_DEVICE_ID_STORAGE_KEY, "corrupted-non-uuid-string");

    const freshId = getOrCreatePersistentDeviceId(storage);

    expect(isValidDeviceId(freshId)).toBe(true);
    expect(freshId).not.toBe("corrupted-non-uuid-string");
    expect(storage.getRaw(LINA_DEVICE_ID_STORAGE_KEY)).toBe(freshId);
  });

  it("isolates device IDs across distinct storage instances", () => {
    const storageA = new MemoryStorage();
    const storageB = new MemoryStorage();

    const idA = getOrCreatePersistentDeviceId(storageA);
    const idB = getOrCreatePersistentDeviceId(storageB);

    expect(idA).not.toBe(idB);
    expect(storageA.getRaw(LINA_DEVICE_ID_STORAGE_KEY)).toBe(idA);
    expect(storageB.getRaw(LINA_DEVICE_ID_STORAGE_KEY)).toBe(idB);
  });

  it("allows clearing persisted device ID", () => {
    const storage = new MemoryStorage();
    const initialId = getOrCreatePersistentDeviceId(storage);
    expect(storage.getRaw(LINA_DEVICE_ID_STORAGE_KEY)).toBe(initialId);

    clearPersistentDeviceId(storage);
    expect(storage.getRaw(LINA_DEVICE_ID_STORAGE_KEY)).toBeUndefined();

    const newId = getOrCreatePersistentDeviceId(storage);
    expect(isValidDeviceId(newId)).toBe(true);
    expect(newId).not.toBe(initialId);
  });
});
