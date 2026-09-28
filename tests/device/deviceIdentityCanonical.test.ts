import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  saveDeviceState,
  loadDeviceState,
  getDeviceStatePath,
  type DeviceState,
} from "../../src/device/deviceState";
import {
  saveOwnership,
  loadOwnership,
} from "../../src/device/deviceOwnership";
import {
  LinaSettingTab,
  DEFAULT_SETTINGS,
  type SettingDefinitionPage,
} from "../../src/settings";
import { createSettingsRuntimeAdapters, type SettingsRuntimeHost } from "../../src/settings/settingsRuntimeAdapters";
import type { SettingDefinition } from "../../src/settings/pureDeclarativeSettingsBlueprint";
import { FakeAdapter } from "../helpers/fakeAdapter";

describe("LINA-03-IMPLEMENT-DEVICE-IDENTITY-CANONICAL-001 — Canonical Device Identity", () => {
  function createTestEnvironment() {
    const adapter = new FakeAdapter();
    const app = new App();
    (app.vault as unknown as { adapter: FakeAdapter }).adapter = adapter;
    const plugin = new LinaPlugin(app);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: {
        [plugin.getDeviceId()]: {},
      },
    };
    return { adapter, app, plugin };
  }

  // 1. Identidade canónica existente
  it("1. Existing canonical identity: reads deviceId and deviceName from .lina/devices/<deviceId>.json", async () => {
    const { adapter, plugin } = createTestEnvironment();
    const deviceId = plugin.getDeviceId();

    const canonicalState: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-10T15:00:00.000Z",
      deviceName: "Canonical Workstation",
      role: "producer",
    };
    await saveDeviceState(adapter, canonicalState);

    await plugin.loadDataFromDisk();

    // Canonical getters on plugin
    expect(plugin.getDeviceId()).toBe(deviceId);
    expect(plugin.getDeviceName()).toBe("Canonical Workstation");
    expect(plugin.getLocalDeviceState()).toEqual(canonicalState);

    // Diagnostics agrees
    const diagnostics = await plugin.getDeviceDiagnostics();
    expect(diagnostics.device.id).toBe(deviceId);
    expect(diagnostics.device.name).toBe("Canonical Workstation");
    expect(diagnostics.device.isConfigured).toBe(true);

    // Settings tab agrees
    const tab = new LinaSettingTab(plugin.app, plugin);
    expect(tab.getControlValue("deviceName")).toBe("Canonical Workstation");

    const pages = tab.getSettingDefinitions();
    const deviceProducerPage = pages.find((p) => (p as SettingDefinitionPage).id === "general") as SettingDefinitionPage | undefined;
    expect(deviceProducerPage?.displayValue).toContain("Canonical Workstation");

    tab.hide();
  });

  // 2. Divergência: data.json: deviceName=A, device state: deviceName=B -> Resultado: usar B
  it("2. Divergence: when data.json has deviceName=A and device state has deviceName=B, strictly uses B", async () => {
    const { adapter, plugin } = createTestEnvironment();
    const deviceId = plugin.getDeviceId();

    // Setup divergence: data.json has 'A'
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: {
        [deviceId]: {
          deviceName: "Legacy Name A",
        },
      },
    };

    // Canonical state has 'B'
    const canonicalState: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-10T15:00:00.000Z",
      deviceName: "Canonical Name B",
      role: "producer",
    };
    await saveDeviceState(adapter, canonicalState);

    await plugin.loadDataFromDisk();

    // The single canonical authority MUST be B
    expect(plugin.getDeviceName()).toBe("Canonical Name B");

    // Diagnostics must show B
    const diagnostics = await plugin.getDeviceDiagnostics();
    expect(diagnostics.device.name).toBe("Canonical Name B");
    expect(diagnostics.device.name).not.toBe("Legacy Name A");

    // Settings must show B
    const tab = new LinaSettingTab(plugin.app, plugin);
    expect(tab.getControlValue("deviceName")).toBe("Canonical Name B");

    const pages = tab.getSettingDefinitions();
    const deviceProducerPage = pages.find((p) => (p as SettingDefinitionPage).id === "general") as SettingDefinitionPage | undefined;
    expect(deviceProducerPage?.displayValue).toContain("Canonical Name B");
    expect(deviceProducerPage?.displayValue).not.toContain("Legacy Name A");

    tab.hide();
  });

  // 3. Device state ausente
  it("3. Missing device state: pure reads do not create file, diagnostics and identity remain safely unconfigured", async () => {
    const { adapter, plugin } = createTestEnvironment();
    const deviceId = plugin.getDeviceId();
    const expectedPath = getDeviceStatePath(deviceId);

    expect(await adapter.exists(expectedPath)).toBe(false);

    // Reading diagnostics when file is absent
    const diagnostics = await plugin.getDeviceDiagnostics();
    expect(diagnostics.device.id).toBe(deviceId);
    expect(diagnostics.device.name).toBeUndefined();
    expect(diagnostics.device.isConfigured).toBe(false);

    // Must NOT have created the device state file on disk as a side effect
    expect(await adapter.exists(expectedPath)).toBe(false);

    // Plugin getter returns undefined when state is absent
    expect(plugin.getLocalDeviceState()).toBeUndefined();
  });

  // 4. Companion: lê; não cria; não altera
  describe("4. Companion boundary constraints", () => {
    it("reads existing canonical identity safely", async () => {
      const { adapter, plugin } = createTestEnvironment();
      const companionId = plugin.getDeviceId();

      const companionState: DeviceState = {
        schemaVersion: 2,
        deviceId: companionId,
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-10T15:00:00.000Z",
        deviceName: "Companion Tablet",
        role: "companion",
      };
      await saveDeviceState(adapter, companionState);

      await plugin.loadDataFromDisk();
      expect(plugin.getLocalDeviceRole()).toBe("companion");
      expect(plugin.getDeviceName()).toBe("Companion Tablet");

      const diagnostics = await plugin.getDeviceDiagnostics();
      expect(diagnostics.device.name).toBe("Companion Tablet");
      expect(diagnostics.device.effectiveRole).toBe("companion");
    });

    it("does not create device state file when absent", async () => {
      const { adapter, plugin } = createTestEnvironment();
      const companionId = plugin.getDeviceId();
      const expectedPath = getDeviceStatePath(companionId);

      // Explicit companion role via resolution or mock
      plugin.localDeviceState = undefined;
      plugin.getLocalDeviceRole = () => "companion";
      plugin.getEffectiveDeviceRole = () => "companion";

      expect(await adapter.exists(expectedPath)).toBe(false);

      const diagnostics = await plugin.getDeviceDiagnostics();
      expect(diagnostics.device.name).toBeUndefined();

      // Crucial: companion reading absent state does NOT create .lina/devices/<id>.json
      expect(await adapter.exists(expectedPath)).toBe(false);
    });

    it("does not alter device state: update attempts are rejected", async () => {
      const { adapter, plugin } = createTestEnvironment();
      const companionId = plugin.getDeviceId();

      const companionState: DeviceState = {
        schemaVersion: 2,
        deviceId: companionId,
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-10T15:00:00.000Z",
        deviceName: "Companion Tablet",
        role: "companion",
      };
      await saveDeviceState(adapter, companionState);
      await plugin.loadDataFromDisk();

      expect(plugin.getLocalDeviceRole()).toBe("companion");

      // Attempting to update device name directly on plugin throws
      await expect(plugin.updateDeviceName("Attempted Rename")).rejects.toThrow();

      // State on disk remains unaltered
      const persisted = await loadDeviceState(adapter, companionId);
      expect(persisted?.deviceName).toBe("Companion Tablet");

      // Attempting to update device name via settings runtime adapter is rejected
      const host: SettingsRuntimeHost = {
        getSnapshot: () => ({ settings: plugin.settings }),
        replaceSnapshot: (next) => { plugin.settings = next.settings; },
        saveSnapshot: async () => plugin.saveSettings(),
        getCurrentDeviceId: () => companionId,
        runEffect: () => undefined,
        getEffectiveDeviceRole: () => "companion",
        getCanonicalDeviceName: () => plugin.getDeviceName(),
        updateCanonicalDeviceName: async (name) => {
          try {
            await plugin.updateDeviceName(name);
            return { ok: true };
          } catch {
            return { ok: false, error: "save-failed" };
          }
        },
      };

      const adapters = createSettingsRuntimeAdapters(host, {
        deviceRole: "companion",
        getEffectiveDeviceRole: () => "companion",
      });

      const res = await adapters.setLocalValue("deviceName", "Attempted Rename");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("invalid-value");

      // Verify via LinaSettingTab that device-name is disabled for companion
      const tab = new LinaSettingTab(plugin.app, plugin);
      const pages = tab.getSettingDefinitions();
      let deviceNameDef: (SettingDefinition & { id?: string }) | undefined;
      for (const page of pages) {
        if ("items" in page && Array.isArray(page.items)) {
          const found = page.items.find((item: SettingDefinition & { id?: string }) => item.id === "device-name");
          if (found) {
            deviceNameDef = found;
            break;
          }
        }
      }
      expect(deviceNameDef?.control?.disabled).toBe(true);
      tab.hide();
    });
  });

  // 5. Producer: atualiza metadados permitidos; não altera ownership
  it("5. Producer: updates permitted metadata (deviceName) and preserves ownership untouched", async () => {
    const { adapter, plugin } = createTestEnvironment();
    const producerId = plugin.getDeviceId();

    // Initial state: assigned Producer
    const initialState: DeviceState = {
      schemaVersion: 2,
      deviceId: producerId,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-10T15:00:00.000Z",
      deviceName: "Initial Studio Producer",
      role: "producer",
    };
    await saveDeviceState(adapter, initialState);

    // Active Producer ownership record
    await saveOwnership(adapter, {
      schemaVersion: 1,
      activeProducerId: producerId,
      epoch: 7,
      acquiredAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
      reason: "initial",
    });

    await plugin.loadDataFromDisk();
    expect(plugin.getLocalDeviceRole()).toBe("producer");
    expect(plugin.getDeviceName()).toBe("Initial Studio Producer");

    const ownershipBefore = await loadOwnership(adapter);
    expect(ownershipBefore?.activeProducerId).toBe(producerId);
    expect(ownershipBefore?.epoch).toBe(7);

    // Producer updates device name
    const updatedState = await plugin.updateDeviceName("Renamed Studio Producer Pro");
    expect(updatedState.deviceName).toBe("Renamed Studio Producer Pro");
    expect(plugin.getDeviceName()).toBe("Renamed Studio Producer Pro");

    // Persisted device state on disk updated
    const stateOnDisk = await loadDeviceState(adapter, producerId);
    expect(stateOnDisk?.deviceName).toBe("Renamed Studio Producer Pro");

    // Critical constraint: ownership.json must NOT be touched or altered
    const ownershipAfter = await loadOwnership(adapter);
    expect(ownershipAfter).toEqual(ownershipBefore);
    expect(ownershipAfter?.epoch).toBe(7);
    expect(ownershipAfter?.activeProducerId).toBe(producerId);
    expect(ownershipAfter?.reason).toBe("initial");
    expect(ownershipAfter?.acquiredAt).toBe("2026-08-01T10:00:00.000Z");

    // Both Settings and Diagnostics now present the new canonical name
    const diagnostics = await plugin.getDeviceDiagnostics();
    expect(diagnostics.device.name).toBe("Renamed Studio Producer Pro");

    const tab = new LinaSettingTab(plugin.app, plugin);
    expect(tab.getControlValue("deviceName")).toBe("Renamed Studio Producer Pro");
    tab.hide();
  });
});
