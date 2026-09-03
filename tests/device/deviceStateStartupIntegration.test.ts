import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { getOrCreatePersistentDeviceId } from "../../src/device/deviceIdentity";
import {
  getDeviceStatePath,
  loadDeviceState,
  saveDeviceState,
  type DeviceState,
} from "../../src/device/deviceState";
import { FakeAdapter } from "../helpers/fakeAdapter";

describe("deviceState startup runtime integration", () => {
  it("creates device state at .lina/devices/<deviceId>.json on startup when missing", async () => {
    const adapter = new FakeAdapter();
    const app = new App();
    app.vault.adapter = adapter;

    const plugin = new LinaPlugin(app);
    await plugin.loadDataFromDisk();

    const deviceId = getOrCreatePersistentDeviceId(app);
    const expectedPath = getDeviceStatePath(deviceId);

    expect(await adapter.exists(expectedPath)).toBe(true);

    const loadedState = await loadDeviceState(adapter, deviceId);
    expect(loadedState).not.toBeNull();
    expect(loadedState?.deviceId).toBe(deviceId);
    expect(loadedState?.schemaVersion).toBe(2);
    expect(loadedState?.role).toBeUndefined();
    expect(loadedState?.deviceName).toBeUndefined();
    expect(new Date(loadedState?.createdAt ?? "").getTime()).toBeGreaterThan(0);
    expect(new Date(loadedState?.updatedAt ?? "").getTime()).toBeGreaterThan(0);
  });

  it("loads and preserves existing device state with producer role without overwriting", async () => {
    const adapter = new FakeAdapter();
    const app = new App();
    app.vault.adapter = adapter;

    const deviceId = getOrCreatePersistentDeviceId(app);
    const preExistingState: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-15T15:30:00.000Z",
      deviceName: "Custom Office Workstation",
      role: "producer",
    };
    await saveDeviceState(adapter, preExistingState);

    const plugin = new LinaPlugin(app);
    await plugin.loadDataFromDisk();

    const loadedState = await loadDeviceState(adapter, deviceId);
    expect(loadedState).toEqual(preExistingState);
    expect(loadedState?.role).toBe("producer");
    expect(loadedState?.deviceName).toBe("Custom Office Workstation");
    expect(loadedState?.createdAt).toBe("2026-08-01T12:00:00.000Z");
    expect(loadedState?.updatedAt).toBe("2026-08-15T15:30:00.000Z");
  });

  it("loads and preserves existing device state without overwriting custom role or fields", async () => {
    const adapter = new FakeAdapter();
    const app = new App();
    app.vault.adapter = adapter;

    const deviceId = getOrCreatePersistentDeviceId(app);
    const preExistingState: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-15T15:30:00.000Z",
      deviceName: "Custom Office Workstation",
      role: "companion",
    };
    await saveDeviceState(adapter, preExistingState);

    const plugin = new LinaPlugin(app);
    await plugin.loadDataFromDisk();

    const loadedState = await loadDeviceState(adapter, deviceId);
    expect(loadedState).toEqual(preExistingState);
    expect(loadedState?.role).toBe("companion");
    expect(loadedState?.deviceName).toBe("Custom Office Workstation");
    expect(loadedState?.createdAt).toBe("2026-08-01T12:00:00.000Z");
    expect(loadedState?.updatedAt).toBe("2026-08-15T15:30:00.000Z");
  });

  it("ensures deviceId matches the authoritative identity layer", async () => {
    const adapter = new FakeAdapter();
    const app = new App();
    app.vault.adapter = adapter;

    const identityDeviceId = getOrCreatePersistentDeviceId(app);

    const plugin = new LinaPlugin(app);
    await plugin.loadDataFromDisk();

    const loadedState = await loadDeviceState(adapter, identityDeviceId);
    expect(loadedState?.deviceId).toBe(identityDeviceId);
  });

  it("preserves isolation between different devices in the same vault", async () => {
    const sharedAdapter = new FakeAdapter();

    // Device A starts up
    const appA = new App();
    appA.vault.adapter = sharedAdapter;
    const pluginA = new LinaPlugin(appA);
    await pluginA.loadDataFromDisk();
    const deviceIdA = getOrCreatePersistentDeviceId(appA);

    // Device B starts up with a distinct identity
    const appB = new App();
    appB.vault.adapter = sharedAdapter;
    const pluginB = new LinaPlugin(appB);
    await pluginB.loadDataFromDisk();
    const deviceIdB = getOrCreatePersistentDeviceId(appB);

    expect(deviceIdA).not.toBe(deviceIdB);

    const pathA = getDeviceStatePath(deviceIdA);
    const pathB = getDeviceStatePath(deviceIdB);

    expect(pathA).not.toBe(pathB);
    expect(await sharedAdapter.exists(pathA)).toBe(true);
    expect(await sharedAdapter.exists(pathB)).toBe(true);

    const stateA = await loadDeviceState(sharedAdapter, deviceIdA);
    const stateB = await loadDeviceState(sharedAdapter, deviceIdB);

    expect(stateA?.deviceId).toBe(deviceIdA);
    expect(stateB?.deviceId).toBe(deviceIdB);
  });

  describe("canonical role resolution runtime integration", () => {
    it("resolves fresh device as unassigned without silent Producer assumption", async () => {
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(false);

      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("unassigned");
      expect(resolution.effectiveRole).toBe("unassigned");
      expect(resolution.recommendedRole).toBe("producer");
      expect(resolution.persistedRole).toBeUndefined();

      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");
    });

    it("resolves device as legacy-fallback when legacy compatibility fallback is enabled", async () => {
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      plugin.setLegacyRoleFallbackAllowed(true);
      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(true);

      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("legacy-fallback");
      expect(resolution.effectiveRole).toBe("producer");
      expect(resolution.recommendedRole).toBe("producer");
      expect(resolution.persistedRole).toBeUndefined();

      expect(plugin.getEffectiveDeviceRole()).toBe("producer");
    });

    it("preserves explicitly assigned role on startup and overrides fallback", async () => {
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const deviceId = getOrCreatePersistentDeviceId(app);
      const preExistingState: DeviceState = {
        schemaVersion: 2,
        deviceId,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-15T15:30:00.000Z",
        role: "companion",
      };
      await saveDeviceState(adapter, preExistingState);

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      plugin.setLegacyRoleFallbackAllowed(true);

      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("assigned");
      expect(resolution.persistedRole).toBe("companion");
      expect(resolution.effectiveRole).toBe("companion");
      expect(resolution.recommendedRole).toBe("producer");
    });
  });
});
