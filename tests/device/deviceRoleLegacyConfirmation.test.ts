import { describe, it, expect, beforeEach } from "vitest";
import { App, Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  createDeviceRoleDescriptionRenderer,
  getDeviceRoleTitle,
} from "../../src/settings/declarativeSettingRenderers";
import { getStrings } from "../../src/i18n/strings";
import { DEFAULT_SETTINGS, setDeviceSettingsContext } from "../../src/settings";
import type { DeviceRole } from "../../src/device/deviceRole";
import { saveOwnership } from "../../src/device/deviceOwnership";
import { generateDeviceId } from "../../src/device/deviceIdentity";

function createSettingMock() {
  let name = "";
  let desc = "";
  let buttonText = "";
  let buttonCta = false;
  let buttonDisabled = false;
  let buttonClickHandler: (() => Promise<void>) | undefined;
  const dropdownOptions: { key: string; text: string }[] = [];

  const buttonComponent = {
    setButtonText(text: string) {
      buttonText = text;
      return buttonComponent;
    },
    setCta() {
      buttonCta = true;
      return buttonComponent;
    },
    setDisabled(disabled: boolean) {
      buttonDisabled = disabled;
      return buttonComponent;
    },
    onClick(handler: () => Promise<void>) {
      buttonClickHandler = handler;
      return buttonComponent;
    },
  };

  const dropdownComponent = {
    addOption(key: string, text: string) {
      dropdownOptions.push({ key, text });
      return dropdownComponent;
    },
    setValue() {
      return dropdownComponent;
    },
    onChange() {
      return dropdownComponent;
    },
  };

  const setting = {
    setName(n: string) {
      name = n;
      return setting;
    },
    setDesc(d: string) {
      desc = d;
      return setting;
    },
    addButton(cb: (b: typeof buttonComponent) => void) {
      cb(buttonComponent);
      return setting;
    },
    addDropdown(cb: (d: typeof dropdownComponent) => void) {
      cb(dropdownComponent);
      return setting;
    },
  };

  return {
    setting,
    get name() { return name; },
    get desc() { return desc; },
    get buttonText() { return buttonText; },
    get buttonCta() { return buttonCta; },
    get buttonDisabled() { return buttonDisabled; },
    get hasButton() { return buttonClickHandler !== undefined; },
    get hasDropdown() { return dropdownOptions.length > 0; },
    async clickButton() {
      await buttonClickHandler?.();
    },
  };
}

describe("Phase 0.2.2.X.1.5 — Legacy Role Confirmation & Temporary Fallback UX", () => {
  let app: App;
  let adapter: FakeAdapter;
  let plugin: LinaPlugin;
  const pt = getStrings("pt-PT");
  const en = getStrings("en");

  beforeEach(() => {
    Platform.isMobile = false;
    adapter = new FakeAdapter();
    app = new App();
    (app.vault as unknown as { adapter: FakeAdapter }).adapter = adapter;
    plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
  });

  describe("Legacy Active Producer Confirmation", () => {
    it("confirms Producer without changing activeProducerId, epoch, or interrupting publication", async () => {
      const localId = plugin.getDeviceId();

      // Setup legacy device state without explicit role
      await adapter.write(`.lina/devices/${localId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId: localId,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      // Setup existing active ownership manifest pointing to this device at epoch 3
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: localId,
        epoch: 3,
        acquiredAt: "2026-08-20T10:05:00.000Z",
        updatedAt: "2026-08-20T10:05:00.000Z",
        reason: "initial",
      });

      // Verify legacy-fallback state
      const initialResolution = plugin.getDeviceRoleResolution();
      expect(initialResolution.assignmentState).toBe("legacy-fallback");
      expect(initialResolution.effectiveRole).toBe("producer");
      expect(initialResolution.persistedRole).toBeUndefined();

      // Verify active ownership is authorized
      const gate = plugin.getOwnershipGate();
      const initialGateResult = await gate.evaluate();
      expect(initialGateResult.authorized).toBe(true);
      expect(initialGateResult.status).toBe("authorized");
      expect(initialGateResult.epoch).toBe(3);
      expect(initialGateResult.activeProducerId).toBe(localId);

      // Render legacy fallback UI
      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution: initialResolution,
        onAssignDeviceRole: async (role) => {
          await plugin.assignDeviceRole(role);
        },
      });
      renderer(mock.setting as never, {} as never);

      // Verify temporary visual status
      expect(mock.name).toBe(`${pt.settingsDeviceRole}: 🟡 ${pt.settingsDeviceDesktopProducerTitle} — ${pt.settingsDeviceTemporaryStatus}`);
      expect(mock.name).not.toContain("🟢");
      expect(mock.desc).toBe(pt.settingsDeviceLegacyDesktopNotice);
      expect(mock.hasDropdown).toBe(false); // No dropdown in legacy confirmation
      expect(mock.hasButton).toBe(true);
      expect(mock.buttonText).toBe(pt.settingsDeviceConfirmProducerRole);

      // User confirms Producer role
      await mock.clickButton();

      // State is now persisted explicitly
      const deviceFile = `.lina/devices/${localId}.json`;
      const savedDevice = JSON.parse(await adapter.read(deviceFile));
      expect(savedDevice.role).toBe("producer");

      // Resolution immediately transitions to assigned / producer
      const updatedResolution = plugin.getDeviceRoleResolution();
      expect(updatedResolution.assignmentState).toBe("assigned");
      expect(updatedResolution.effectiveRole).toBe("producer");
      expect(updatedResolution.persistedRole).toBe("producer");
      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(false);

      // Critical Invariant: Ownership epoch and activeProducerId MUST NOT CHANGE
      const manifestRaw = JSON.parse(await adapter.read(".lina/ownership.json"));
      expect(manifestRaw.activeProducerId).toBe(localId);
      expect(manifestRaw.epoch).toBe(3); // Unchanged!

      const postGateResult = await gate.evaluate();
      expect(postGateResult.authorized).toBe(true);
      expect(postGateResult.status).toBe("authorized");
      expect(postGateResult.epoch).toBe(3);
      expect(postGateResult.activeProducerId).toBe(localId);

      // Subsequent render renders normal assigned green badge without buttons
      const postMock = createSettingMock();
      const postRenderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution: updatedResolution,
      });
      postRenderer(postMock.setting as never, {} as never);
      expect(postMock.name).toBe(`${pt.settingsDeviceRole}: 🟢 ${pt.settingsDeviceDesktopProducerTitle}`);
      expect(postMock.name).not.toContain("🟡");
      expect(postMock.name).not.toContain("Temporário");
      expect(postMock.desc).toBe(pt.settingsDeviceProducerDesc);
      expect(postMock.hasButton).toBe(false);
    });
  });

  describe("Legacy Standby Producer Confirmation", () => {
    it("confirms Producer role without overwriting remote ownership or incrementing epoch", async () => {
      const localId = plugin.getDeviceId();
      const remoteProducerId = generateDeviceId();

      // Setup legacy device state without explicit role
      await adapter.write(`.lina/devices/${localId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId: localId,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      // Ownership belongs to remote Desktop A at epoch 2
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteProducerId,
        epoch: 2,
        acquiredAt: "2026-08-20T10:05:00.000Z",
        updatedAt: "2026-08-20T10:05:00.000Z",
        reason: "initial",
      });

      const initialResolution = plugin.getDeviceRoleResolution();
      expect(initialResolution.assignmentState).toBe("legacy-fallback");

      const gate = plugin.getOwnershipGate();
      const initialGateResult = await gate.evaluate();
      expect(initialGateResult.authorized).toBe(false);
      expect(initialGateResult.status).toBe("standby-producer");
      expect(initialGateResult.activeProducerId).toBe(remoteProducerId);

      // Confirm Producer role
      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: en,
        resolution: initialResolution,
        onAssignDeviceRole: async (role) => {
          await plugin.assignDeviceRole(role);
        },
      });
      renderer(mock.setting as never, {} as never);
      expect(mock.name).toBe(`${en.settingsDeviceRole}: 🟡 ${en.settingsDeviceDesktopProducerTitle} — ${en.settingsDeviceTemporaryStatus}`);
      expect(mock.buttonText).toBe(en.settingsDeviceConfirmProducerRole);

      await mock.clickButton();

      // State is now persisted
      const savedDevice = JSON.parse(await adapter.read(`.lina/devices/${localId}.json`));
      expect(savedDevice.role).toBe("producer");
      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("assigned");

      // Critical Invariant: Remote ownership manifest was NOT overwritten or incremented
      const manifestRaw = JSON.parse(await adapter.read(".lina/ownership.json"));
      expect(manifestRaw.activeProducerId).toBe(remoteProducerId);
      expect(manifestRaw.epoch).toBe(2);

      // Gate confirms device remains Standby Producer
      const postGateResult = await gate.evaluate();
      expect(postGateResult.authorized).toBe(false);
      expect(postGateResult.status).toBe("standby-producer");
      expect(postGateResult.activeProducerId).toBe(remoteProducerId);
      expect(postGateResult.epoch).toBe(2);
    });
  });

  describe("Legacy Mobile Companion Confirmation", () => {
    it("confirms Companion role on mobile and leaves device non-Producer", async () => {
      Platform.isMobile = true;
      const localId = plugin.getDeviceId();

      await adapter.write(`.lina/devices/${localId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId: localId,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      const initialResolution = plugin.getDeviceRoleResolution();
      expect(initialResolution.assignmentState).toBe("legacy-fallback");
      expect(initialResolution.effectiveRole).toBe("companion");

      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution: initialResolution,
        onAssignDeviceRole: async (role) => {
          await plugin.assignDeviceRole(role);
        },
      });
      renderer(mock.setting as never, {} as never);

      expect(mock.name).toBe(`${pt.settingsDeviceRole}: 🟡 ${pt.settingsDeviceMobileCompanionTitle} — ${pt.settingsDeviceTemporaryStatus}`);
      expect(mock.desc).toBe(pt.settingsDeviceLegacyMobileNotice);
      expect(mock.buttonText).toBe(pt.settingsDeviceConfirmCompanionRole);

      await mock.clickButton();

      // Persisted as companion
      const savedDevice = JSON.parse(await adapter.read(`.lina/devices/${localId}.json`));
      expect(savedDevice.role).toBe("companion");
      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("assigned");
      expect(plugin.getDeviceRoleResolution().effectiveRole).toBe("companion");

      // Gate confirms not-producer-role
      const gateResult = await plugin.getOwnershipGate().evaluate();
      expect(gateResult.authorized).toBe(false);
      expect(gateResult.status).toBe("not-producer-role");
      expect(await adapter.exists(".lina/ownership.json")).toBe(false);
    });
  });

  describe("Persistence Failure Behavior", () => {
    it("preserves legacy-fallback state and active producer authority if storage fails", async () => {
      const localId = plugin.getDeviceId();

      await adapter.write(`.lina/devices/${localId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId: localId,
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: localId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution: plugin.getDeviceRoleResolution(),
        onAssignDeviceRole: async () => {
          throw new Error("Disk write simulated error");
        },
      });
      renderer(mock.setting as never, {} as never);

      // User clicks confirm, which throws
      await mock.clickButton();

      // Button is re-enabled to allow retry
      expect(mock.buttonDisabled).toBe(false);

      // State remains safely in legacy-fallback
      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("legacy-fallback");
      expect(plugin.getEffectiveDeviceRole()).toBe("producer");
      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(true);

      // Active Producer publication is NOT disrupted
      const gateResult = await plugin.getOwnershipGate().evaluate();
      expect(gateResult.authorized).toBe(true);
      expect(gateResult.status).toBe("authorized");
    });
  });

  describe("Platform-Aware Semantic Role Labels (Platform != Role)", () => {
    it("never labels Desktop Companion as 'Mobile Companion'", () => {
      // Desktop explicitly assigned as Companion
      const desktopCompanionTitle = getDeviceRoleTitle(en, "companion", false);
      expect(desktopCompanionTitle).toBe("Desktop Companion");
      expect(desktopCompanionTitle).not.toContain("Mobile");

      const ptDesktopCompanionTitle = getDeviceRoleTitle(pt, "companion", false);
      expect(ptDesktopCompanionTitle).toBe("Desktop Companion");
      expect(ptDesktopCompanionTitle).not.toContain("Mobile");

      // Mobile assigned as Companion
      const mobileCompanionTitle = getDeviceRoleTitle(en, "companion", true);
      expect(mobileCompanionTitle).toBe("Mobile Companion");

      // Desktop assigned as Producer
      const desktopProducerTitle = getDeviceRoleTitle(en, "producer", false);
      expect(desktopProducerTitle).toBe("Desktop Producer");

      // Mobile assigned as Producer (future compatibility)
      const mobileProducerTitle = getDeviceRoleTitle(en, "producer", true);
      expect(mobileProducerTitle).toBe("Mobile Producer");
    });

    it("renders Desktop Companion cleanly in Settings without Mobile prefix", () => {
      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: en,
        role: "companion",
        isMobile: false,
      });
      renderer(mock.setting as never, {} as never);

      expect(mock.name).toBe(`${en.settingsDeviceRole}: 🔵 Desktop Companion`);
      expect(mock.name).not.toContain("Mobile Companion");
      expect(mock.desc).toBe(en.settingsDeviceCompanionDesc);
    });

    it("renders Mobile Companion cleanly in Settings", () => {
      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: en,
        role: "companion",
        isMobile: true,
      });
      renderer(mock.setting as never, {} as never);

      expect(mock.name).toBe(`${en.settingsDeviceRole}: 🔵 Mobile Companion`);
      expect(mock.desc).toBe(en.settingsDeviceCompanionDesc);
    });
  });

  describe("No Silent Persistence Without Confirmation", () => {
    it("does not persist role when legacy settings view is opened and dismissed", async () => {
      const localId = plugin.getDeviceId();
      await adapter.write(`.lina/devices/${localId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId: localId,
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution: plugin.getDeviceRoleResolution(),
      });

      // Passive rendering
      renderer(mock.setting as never, {} as never);

      // Verify no write occurred
      const deviceRaw = JSON.parse(await adapter.read(`.lina/devices/${localId}.json`));
      expect(deviceRaw.role).toBeUndefined();
      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("legacy-fallback");
      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(true);
    });
  });
});
