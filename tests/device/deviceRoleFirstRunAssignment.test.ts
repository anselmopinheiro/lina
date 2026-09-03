import { describe, it, expect, beforeEach } from "vitest";
import { App, Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { createDeviceRoleDescriptionRenderer } from "../../src/settings/declarativeSettingRenderers";
import { getStrings } from "../../src/i18n/strings";
import { resolveDeviceRole } from "../../src/device/deviceRoleResolver";
import type { DeviceRole } from "../../src/device/deviceRole";
import { LinaSettingTab, DEFAULT_SETTINGS, setDeviceSettingsContext } from "../../src/settings";

function createSettingMock() {
  let name = "";
  let desc = "";
  let dropdownOptions: { key: string; text: string }[] = [];
  let dropdownValue = "";
  let dropdownChangeHandler: ((value: string) => void) | undefined;
  let buttonText = "";
  let buttonCta = false;
  let buttonDisabled = false;
  let buttonClickHandler: (() => Promise<void>) | undefined;

  const dropdownComponent = {
    addOption(key: string, text: string) {
      dropdownOptions.push({ key, text });
      return dropdownComponent;
    },
    setValue(val: string) {
      dropdownValue = val;
      return dropdownComponent;
    },
    onChange(handler: (value: string) => void) {
      dropdownChangeHandler = handler;
      return dropdownComponent;
    },
  };

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

  const setting = {
    setName(n: string) {
      name = n;
      return setting;
    },
    setDesc(d: string) {
      desc = d;
      return setting;
    },
    addDropdown(cb: (d: typeof dropdownComponent) => void) {
      cb(dropdownComponent);
      return setting;
    },
    addButton(cb: (b: typeof buttonComponent) => void) {
      cb(buttonComponent);
      return setting;
    },
  };

  return {
    setting,
    get name() { return name; },
    get desc() { return desc; },
    get dropdownOptions() { return dropdownOptions; },
    get dropdownValue() { return dropdownValue; },
    get buttonText() { return buttonText; },
    get buttonCta() { return buttonCta; },
    get buttonDisabled() { return buttonDisabled; },
    selectOption(key: string) {
      dropdownValue = key;
      dropdownChangeHandler?.(key);
    },
    async clickButton() {
      await buttonClickHandler?.();
    },
    hasDropdown() {
      return dropdownOptions.length > 0;
    },
    hasButton() {
      return buttonClickHandler !== undefined;
    },
  };
}

describe("Phase 0.2.2.X.1.4 — First-Run Device Role UX & Explicit Assignment", () => {
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

  describe("Fresh desktop UX", () => {
    it("renders unassigned neutral state with preselected Producer without writing to disk", async () => {
      const mock = createSettingMock();
      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("unassigned");
      expect(resolution.recommendedRole).toBe("producer");

      let assignedRole: DeviceRole | undefined;
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution,
        onAssignDeviceRole: async (role) => {
          assignedRole = role;
        },
      });

      renderer(mock.setting as never, {} as never);

      // Verify unassigned neutral presentation
      expect(mock.name).toBe(`${pt.settingsDeviceRole}: ⚪ ${pt.settingsDeviceUnconfiguredTitle}`);
      expect(mock.name).not.toContain("🟢");
      expect(mock.name).not.toContain("Desktop Producer");
      expect(mock.desc).toContain(pt.settingsDeviceUnconfiguredDesc);

      // Verify dropdown and options
      expect(mock.hasDropdown()).toBe(true);
      expect(mock.dropdownValue).toBe("producer");
      expect(mock.dropdownOptions).toHaveLength(2);
      expect(mock.dropdownOptions[0]).toEqual({
        key: "producer",
        text: `${pt.settingsDeviceProducerOption} — ${pt.settingsDeviceRoleRecommended}`,
      });
      expect(mock.dropdownOptions[1]).toEqual({
        key: "companion",
        text: pt.settingsDeviceCompanionOption,
      });

      // Verify confirmation button
      expect(mock.hasButton()).toBe(true);
      expect(mock.buttonText).toBe(pt.settingsDeviceConfirmRole);
      expect(mock.buttonCta).toBe(true);

      // Crucial: passive rendering must NOT invoke persistence or change role
      expect(assignedRole).toBeUndefined();
      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");
      expect(await adapter.exists(`.lina/devices/${plugin.getDeviceId()}.json`)).toBe(false);
    });

    it("explicitly confirms Producer: persists role, transitions resolution, and auto-claims unowned vault", async () => {
      const mock = createSettingMock();
      const resolution = plugin.getDeviceRoleResolution();

      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution,
        onAssignDeviceRole: async (role) => {
          await plugin.assignDeviceRole(role);
        },
      });

      renderer(mock.setting as never, {} as never);
      expect(mock.dropdownValue).toBe("producer");

      // User explicitly clicks confirmation button
      await mock.clickButton();

      // State is now persisted
      const deviceFile = `.lina/devices/${plugin.getDeviceId()}.json`;
      expect(await adapter.exists(deviceFile)).toBe(true);
      const saved = JSON.parse(await adapter.read(deviceFile));
      expect(saved.role).toBe("producer");

      // Runtime resolution immediately transitions to assigned / producer
      const updatedResolution = plugin.getDeviceRoleResolution();
      expect(updatedResolution.assignmentState).toBe("assigned");
      expect(updatedResolution.effectiveRole).toBe("producer");
      expect(plugin.getLocalDeviceRole()).toBe("producer");

      // Ownership gate evaluates and claims initial ownership
      const gate = plugin.getOwnershipGate();
      const gateResult = await gate.evaluate();
      expect(gateResult.authorized).toBe(true);
      expect(gateResult.status).toBe("authorized");

      // Verify subsequent render renders assigned Producer badge without chooser controls
      const postMock = createSettingMock();
      const postRenderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution: updatedResolution,
        onAssignDeviceRole: async () => {},
      });
      postRenderer(postMock.setting as never, {} as never);
      expect(postMock.name).toBe(`${pt.settingsDeviceRole}: 🟢 ${pt.settingsDeviceProducerTitle}`);
      expect(postMock.desc).toBe(pt.settingsDeviceProducerDesc);
      expect(postMock.hasDropdown()).toBe(false);
      expect(postMock.hasButton()).toBe(false);
    });

    it("explicitly selects and confirms Companion: persists role and does not claim ownership", async () => {
      const mock = createSettingMock();
      const resolution = plugin.getDeviceRoleResolution();

      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution,
        onAssignDeviceRole: async (role) => {
          await plugin.assignDeviceRole(role);
        },
      });

      renderer(mock.setting as never, {} as never);

      // User selects Companion in dropdown
      mock.selectOption("companion");
      expect(mock.dropdownValue).toBe("companion");

      // User clicks confirmation button
      await mock.clickButton();

      // State is persisted as companion
      const deviceFile = `.lina/devices/${plugin.getDeviceId()}.json`;
      expect(await adapter.exists(deviceFile)).toBe(true);
      const saved = JSON.parse(await adapter.read(deviceFile));
      expect(saved.role).toBe("companion");

      // Runtime resolution immediately transitions to assigned / companion
      const updatedResolution = plugin.getDeviceRoleResolution();
      expect(updatedResolution.assignmentState).toBe("assigned");
      expect(updatedResolution.effectiveRole).toBe("companion");
      expect(plugin.getLocalDeviceRole()).toBe("companion");

      // Ownership gate must NOT claim ownership
      const gate = plugin.getOwnershipGate();
      const gateResult = await gate.evaluate();
      expect(gateResult.authorized).toBe(false);
      expect(gateResult.status).toBe("not-producer-role");
      expect(await adapter.exists(".lina/ownership.json")).toBe(false);

      // Verify subsequent render renders Companion badge without chooser controls
      const postMock = createSettingMock();
      const postRenderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution: updatedResolution,
        onAssignDeviceRole: async () => {},
      });
      postRenderer(postMock.setting as never, {} as never);
      expect(postMock.name).toBe(`${pt.settingsDeviceRole}: 🔵 ${pt.settingsDeviceDesktopCompanionTitle}`);
      expect(postMock.desc).toBe(pt.settingsDeviceCompanionDesc);
      expect(postMock.hasDropdown()).toBe(false);
      expect(postMock.hasButton()).toBe(false);
    });
  });

  describe("Fresh mobile UX", () => {
    beforeEach(() => {
      Platform.isMobile = true;
    });

    it("renders only Companion acknowledgment without dropdown and requires explicit confirmation", async () => {
      const mock = createSettingMock();
      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("unassigned");
      expect(resolution.recommendedRole).toBe("companion");

      let assignedRole: DeviceRole | undefined;
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: en,
        resolution,
        onAssignDeviceRole: async (role) => {
          assignedRole = role;
          await plugin.assignDeviceRole(role);
        },
      });

      renderer(mock.setting as never, {} as never);

      // Must not show dropdown or Producer option
      expect(mock.hasDropdown()).toBe(false);
      expect(mock.name).toBe(`${en.settingsDeviceRole}: ⚪ ${en.settingsDeviceUnconfiguredTitle}`);
      expect(mock.name).not.toContain("🟢");
      expect(mock.desc).toBe(en.settingsDeviceMobileCompanionNotice);

      // Must show explicit acknowledgment button
      expect(mock.hasButton()).toBe(true);
      expect(mock.buttonText).toBe(en.settingsDeviceUseAsCompanion);

      // Passive rendering does not persist
      expect(assignedRole).toBeUndefined();
      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");

      // Click button persists companion
      await mock.clickButton();
      expect(assignedRole).toBe("companion");
      expect(plugin.getEffectiveDeviceRole()).toBe("companion");
      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("assigned");
    });
  });

  describe("Persistence failure and error safety", () => {
    it("leaves state unassigned and re-enables button if storage write fails", async () => {
      const mock = createSettingMock();
      const resolution = plugin.getDeviceRoleResolution();

      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution,
        onAssignDeviceRole: async () => {
          throw new Error("Disk full simulation");
        },
      });

      renderer(mock.setting as never, {} as never);

      // Click button throws
      await mock.clickButton();

      // Button is re-enabled after failure
      expect(mock.buttonDisabled).toBe(false);

      // Device remains unassigned
      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("unassigned");
      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");
    });
  });

  describe("Leaving Settings without confirmation", () => {
    it("keeps device safely unassigned if tab is closed without clicking confirmation", async () => {
      const tab = new LinaSettingTab(app, plugin);
      const definitions = tab.getSettingDefinitions();
      const deviceGroup = definitions.find((g) => (g as { heading?: string }).heading === pt.settingsDeviceSection) as { items: { id?: string; render?: (s: unknown, g: unknown) => void }[] };
      const deviceItem = deviceGroup.items.find((item) => item.id === "device-description");

      const mock = createSettingMock();
      deviceItem?.render?.(mock.setting as never, {} as never);

      expect(mock.hasButton()).toBe(true);

      // Tab is closed/hidden without user clicking confirmation button
      tab.hide();

      // Device remains unassigned
      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("unassigned");
      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");
      expect(plugin.getLocalDeviceRole()).toBeUndefined();
    });
  });

  describe("Legacy device preservation", () => {
    it("does not render first-run chooser for legacy-fallback device", async () => {
      // Simulate existing legacy device without role
      const deviceId = plugin.getDeviceId();
      await adapter.write(`.lina/devices/${deviceId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId,
        createdAt: "2026-08-30T10:00:00.000Z",
        updatedAt: "2026-08-30T10:00:00.000Z",
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("legacy-fallback");
      expect(resolution.effectiveRole).toBe("producer");

      const mock = createSettingMock();
      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        resolution,
      });
      renderer(mock.setting as never, {} as never);

      // Legacy fallback renders temporary Producer badge with confirmation button, without chooser dropdown
      expect(mock.name).toBe(`${pt.settingsDeviceRole}: 🟡 ${pt.settingsDeviceDesktopProducerTitle} — ${pt.settingsDeviceTemporaryStatus}`);
      expect(mock.desc).toBe(pt.settingsDeviceLegacyDesktopNotice);
      expect(mock.hasDropdown()).toBe(false);
      expect(mock.hasButton()).toBe(true);
      expect(mock.buttonText).toBe(pt.settingsDeviceConfirmProducerRole);
    });
  });
});
