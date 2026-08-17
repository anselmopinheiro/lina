import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";

describe("active declarative settings harness", () => {
  it("observes the real declarative hooks without rendering or invoking callbacks", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { "harness-device": {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "harness-device");
    const saveSettings = vi.spyOn(plugin, "saveSettings");
    const tab = new LinaSettingTab(app, plugin);
    const groups = tab.getSettingDefinitions();
    const ids = groups.flatMap((group) => group.items).map((item) => item.id);

    expect(groups).toHaveLength(13);
    expect(ids).toHaveLength(49);
    expect(new Set(ids).size).toBe(49);
    expect(ids).toContain("device-name");
    expect(ids).toContain("analysis-credential");
    expect(ids).toContain("remove-binary-copy");
    expect(groups.some((group) => group.heading === getStrings("pt-PT").settingsAnalysisSection)).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
    tab.hide();
  });

  it("produces deterministic, serializable, secret-free definitions", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: { "harness-device": { analysisApiKey: "SUPER_SECRET_SENTINEL" } },
    };
    setDeviceSettingsContext(plugin.settings, () => {}, "harness-device");
    const tab = new LinaSettingTab(app, plugin);
    const first = tab.getSettingDefinitions();
    const second = tab.getSettingDefinitions();
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(serialized).not.toContain("SUPER_SECRET_SENTINEL");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/);
    tab.hide();
  });
});
