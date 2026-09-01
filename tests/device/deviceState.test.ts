import { describe, expect, it } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  createDefaultDeviceState,
  getDeviceStatePath,
  getOrCreateDeviceState,
  isDeviceState,
  loadDeviceState,
  saveDeviceState,
  updateDeviceRole,
  type DeviceState,
} from "../../src/device/deviceState";

describe("deviceState", () => {
  const validUuidA = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const validUuidB = "550e8400-e29b-41d4-a716-446655440000";

  describe("getDeviceStatePath", () => {
    it("computes the canonical path under .lina/devices/<deviceId>.json", () => {
      expect(getDeviceStatePath(validUuidA)).toBe(`.lina/devices/${validUuidA}.json`);
      expect(getDeviceStatePath(validUuidB)).toBe(`.lina/devices/${validUuidB}.json`);
    });

    it("throws an error when provided with an invalid deviceId", () => {
      expect(() => getDeviceStatePath("")).toThrow();
      expect(() => getDeviceStatePath("   ")).toThrow();
      expect(() => getDeviceStatePath("invalid-non-uuid")).toThrow();
    });
  });

  describe("isDeviceState validation", () => {
    it("validates well-formed DeviceState objects with schemaVersion 2 and role", () => {
      const state: DeviceState = {
        schemaVersion: 2,
        deviceId: validUuidA,
        createdAt: "2026-08-31T20:00:00.000Z",
        updatedAt: "2026-08-31T20:00:00.000Z",
        deviceName: "My MacBook",
        role: "producer",
      };

      expect(isDeviceState(state)).toBe(true);
    });

    it("validates legacy DeviceState objects with schemaVersion 1", () => {
      const state = {
        schemaVersion: 1,
        deviceId: validUuidA,
        createdAt: "2026-08-31T20:00:00.000Z",
        updatedAt: "2026-08-31T20:00:00.000Z",
      };

      expect(isDeviceState(state)).toBe(true);
    });

    it("rejects invalid schemaVersion, invalid roles, missing fields, or invalid types", () => {
      expect(isDeviceState(null)).toBe(false);
      expect(isDeviceState({})).toBe(false);
      expect(isDeviceState({ schemaVersion: 3, deviceId: validUuidA, createdAt: "2026", updatedAt: "2026" })).toBe(false);
      expect(isDeviceState({ schemaVersion: 2, deviceId: "invalid", createdAt: "2026", updatedAt: "2026" })).toBe(false);
      expect(isDeviceState({ schemaVersion: 2, deviceId: validUuidA, createdAt: "", updatedAt: "2026" })).toBe(false);
      expect(isDeviceState({ schemaVersion: 2, deviceId: validUuidA, createdAt: "2026", updatedAt: "2026", role: "invalid-role" })).toBe(false);
      expect(isDeviceState({ schemaVersion: 2, deviceId: validUuidA, createdAt: "2026", updatedAt: "2026", deviceName: 12345 })).toBe(false);
    });
  });

  describe("createDefaultDeviceState", () => {
    it("creates a default state with schemaVersion 2, valid timestamps, and no automatic role or deviceName", () => {
      const state = createDefaultDeviceState(validUuidA);

      expect(state.schemaVersion).toBe(2);
      expect(state.deviceId).toBe(validUuidA);
      expect(state.deviceName).toBeUndefined();
      expect(state.role).toBeUndefined();
      expect(new Date(state.createdAt).getTime()).toBeGreaterThan(0);
      expect(new Date(state.updatedAt).getTime()).toBeGreaterThan(0);
      expect(isDeviceState(state)).toBe(true);
    });

    it("creates a default state with specified deviceName and role when provided", () => {
      const state = createDefaultDeviceState(validUuidA, "Desktop Workstation", "producer");

      expect(state.schemaVersion).toBe(2);
      expect(state.deviceId).toBe(validUuidA);
      expect(state.deviceName).toBe("Desktop Workstation");
      expect(state.role).toBe("producer");
      expect(isDeviceState(state)).toBe(true);
    });

    it("creates a default state with specified companion role", () => {
      const state = createDefaultDeviceState(validUuidA, "iPad Pro", "companion");

      expect(state.schemaVersion).toBe(2);
      expect(state.role).toBe("companion");
      expect(state.deviceName).toBe("iPad Pro");
      expect(isDeviceState(state)).toBe(true);
    });

    it("creates a default state with deviceName only and unassigned role", () => {
      const state = createDefaultDeviceState(validUuidA, "My Laptop");

      expect(state.schemaVersion).toBe(2);
      expect(state.role).toBeUndefined();
      expect(state.deviceName).toBe("My Laptop");
      expect(isDeviceState(state)).toBe(true);
    });
  });

  describe("loadDeviceState and saveDeviceState", () => {
    it("returns null when the device state file does not exist", async () => {
      const adapter = new FakeAdapter();
      const state = await loadDeviceState(adapter, validUuidA);

      expect(state).toBeNull();
    });

    it("atomically saves and reloads device state", async () => {
      const adapter = new FakeAdapter();
      const initialState = createDefaultDeviceState(validUuidA, "Studio Mac", "producer");

      await saveDeviceState(adapter, initialState);

      const targetPath = getDeviceStatePath(validUuidA);
      expect(await adapter.exists(targetPath)).toBe(true);

      const loaded = await loadDeviceState(adapter, validUuidA);
      expect(loaded).toEqual(initialState);
    });

    it("creates and saves a neutral default state on getOrCreateDeviceState when missing", async () => {
      const adapter = new FakeAdapter();
      const state = await getOrCreateDeviceState(adapter, validUuidA);

      expect(state.deviceId).toBe(validUuidA);
      expect(state.deviceName).toBeUndefined();
      expect(state.role).toBeUndefined();
      expect(state.schemaVersion).toBe(2);

      const reloaded = await loadDeviceState(adapter, validUuidA);
      expect(reloaded).toEqual(state);
    });

    it("creates and saves a default state with specified fields on getOrCreateDeviceState when missing", async () => {
      const adapter = new FakeAdapter();
      const state = await getOrCreateDeviceState(adapter, validUuidA, "Laptop", "companion");

      expect(state.deviceId).toBe(validUuidA);
      expect(state.deviceName).toBe("Laptop");
      expect(state.role).toBe("companion");

      const reloaded = await loadDeviceState(adapter, validUuidA);
      expect(reloaded).toEqual(state);
    });

    it("returns existing state on getOrCreateDeviceState without overwriting", async () => {
      const adapter = new FakeAdapter();
      const original = createDefaultDeviceState(validUuidA, "Original Name", "producer");
      await saveDeviceState(adapter, original);

      const resolved = await getOrCreateDeviceState(adapter, validUuidA, "New Name", "companion");
      expect(resolved.deviceName).toBe("Original Name");
      expect(resolved.role).toBe("producer");
    });

    it("loads and preserves schemaVersion 1 legacy records seamlessly", async () => {
      const adapter = new FakeAdapter();
      const legacyV1 = {
        schemaVersion: 1,
        deviceId: validUuidA,
        createdAt: "2026-08-30T10:00:00.000Z",
        updatedAt: "2026-08-30T10:00:00.000Z",
        deviceName: "Old Device",
      };
      await adapter.write(getDeviceStatePath(validUuidA), JSON.stringify(legacyV1));

      const loaded = await loadDeviceState(adapter, validUuidA);
      expect(loaded?.schemaVersion).toBe(1);
      expect(loaded?.deviceName).toBe("Old Device");
      expect(isDeviceState(loaded)).toBe(true);
    });
  });

  describe("updateDeviceRole", () => {
    it("updates the role and saves atomically with schemaVersion 2", async () => {
      const adapter = new FakeAdapter();
      await getOrCreateDeviceState(adapter, validUuidA, "My Device", "producer");

      const updated = await updateDeviceRole(adapter, validUuidA, "companion");
      expect(updated.role).toBe("companion");
      expect(updated.schemaVersion).toBe(2);

      const reloaded = await loadDeviceState(adapter, validUuidA);
      expect(reloaded?.role).toBe("companion");
    });

    it("rejects updating to an invalid role", async () => {
      const adapter = new FakeAdapter();
      await getOrCreateDeviceState(adapter, validUuidA);

      await expect(updateDeviceRole(adapter, validUuidA, "invalid" as never)).rejects.toThrow();
    });
  });

  describe("Multi-device isolation", () => {
    it("ensures distinct devices write to distinct files with independent roles", async () => {
      const adapter = new FakeAdapter();

      const stateA = await getOrCreateDeviceState(adapter, validUuidA, "Desktop", "producer");
      const stateB = await getOrCreateDeviceState(adapter, validUuidB, "Phone", "companion");

      const pathA = getDeviceStatePath(validUuidA);
      const pathB = getDeviceStatePath(validUuidB);

      expect(pathA).not.toBe(pathB);
      expect(await adapter.exists(pathA)).toBe(true);
      expect(await adapter.exists(pathB)).toBe(true);

      const loadedA = await loadDeviceState(adapter, validUuidA);
      const loadedB = await loadDeviceState(adapter, validUuidB);

      expect(loadedA?.deviceId).toBe(validUuidA);
      expect(loadedA?.role).toBe("producer");

      expect(loadedB?.deviceId).toBe(validUuidB);
      expect(loadedB?.role).toBe("companion");
    });
  });

  describe("Corrupted state handling", () => {
    it("returns null when the state file contains invalid JSON", async () => {
      const adapter = new FakeAdapter();
      const targetPath = getDeviceStatePath(validUuidA);
      await adapter.write(targetPath, "this is not { valid json");

      const loaded = await loadDeviceState(adapter, validUuidA);
      expect(loaded).toBeNull();
    });

    it("returns null when the file contains mismatched deviceId", async () => {
      const adapter = new FakeAdapter();
      const targetPath = getDeviceStatePath(validUuidA);
      const mismatchedState = createDefaultDeviceState(validUuidB);
      await adapter.write(targetPath, JSON.stringify(mismatchedState));

      const loaded = await loadDeviceState(adapter, validUuidA);
      expect(loaded).toBeNull();
    });

    it("recovers from corrupted state via getOrCreateDeviceState by rewriting valid state", async () => {
      const adapter = new FakeAdapter();
      const targetPath = getDeviceStatePath(validUuidA);
      await adapter.write(targetPath, "corrupted");

      const recovered = await getOrCreateDeviceState(adapter, validUuidA, "Recovered Device");
      expect(isDeviceState(recovered)).toBe(true);
      expect(recovered.deviceId).toBe(validUuidA);
      expect(recovered.deviceName).toBe("Recovered Device");

      const reloaded = await loadDeviceState(adapter, validUuidA);
      expect(reloaded).toEqual(recovered);
    });
  });
});
