import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext, type LinaSettings } from "../../src/settings";

function createSettings(): LinaSettings {
  return {
    ...DEFAULT_SETTINGS,
    aiProfiles: DEFAULT_SETTINGS.aiProfiles.map((profile) => ({ ...profile })),
    deviceSettingsById: {
      current: { deviceName: "Current device", analysisBaseUrl: "http://localhost:11434" },
      other: { deviceName: "Other device" },
    },
  };
}

function createTab(settings = createSettings()) {
  const app = new App();
  const plugin = new LinaPlugin(app);
  plugin.settings = settings;
  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, "current");
  return { plugin, tab: new LinaSettingTab(app, plugin) };
}

describe("C3 active settings controls, persistence, and effects", () => {
  it("uses active declarative get/set hooks for global and device-local controls", async () => {
    const { plugin, tab } = createTab();
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();

    expect(tab.getControlValue("device-name")).toBe("Current device");
    expect(tab.getControlValue("embeddings-enabled")).toBe(false);
    await tab.setControlValue("device-name", "Renamed device");
    await tab.setControlValue("embeddings-enabled", true);

    expect(plugin.settings.deviceSettingsById?.current?.deviceName).toBe("Renamed device");
    expect(plugin.settings.deviceSettingsById?.other?.deviceName).toBe("Other device");
    expect(plugin.settings.embeddingsEnabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    tab.hide();
  });

  it("rolls a control back after a failed save and allows a later confirmed mutation", async () => {
    const { plugin, tab } = createTab();
    const save = vi.spyOn(plugin, "saveSettings")
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce();

    await tab.setControlValue("device-name", "Rejected name");
    expect(plugin.settings.deviceSettingsById?.current?.deviceName).toBe("Current device");
    await tab.setControlValue("device-name", "Confirmed name");

    expect(plugin.settings.deviceSettingsById?.current?.deviceName).toBe("Confirmed name");
    expect(save).toHaveBeenCalledTimes(2);
    tab.hide();
  });

  it("keeps unknown and secret ids outside the active value hooks", async () => {
    const { plugin, tab } = createTab();
    const save = vi.spyOn(plugin, "saveSettings");

    expect(tab.getControlValue("analysisApiKey")).toBeUndefined();
    await tab.setControlValue("analysisApiKey", "not-a-real-secret");
    await tab.setControlValue("unknown-setting", true);

    expect(save).not.toHaveBeenCalled();
    expect(plugin.settings.deviceSettingsById?.current?.analysisApiKey).toBeUndefined();
    tab.hide();
  });
});
