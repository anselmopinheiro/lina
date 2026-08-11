import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";

describe("C2 active settings structure and content", () => {
  it("exposes the canonical 12 groups and 47 real definitions through the active tab", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const groups = tab.getSettingDefinitions();
    const ids = groups.flatMap((group) => group.items).map((item) => (item as { id: string }).id);

    expect(groups).toHaveLength(12);
    expect(ids).toHaveLength(47);
    expect(new Set(ids).size).toBe(47);
    expect(ids).toEqual(expect.arrayContaining([
      "device-description", "analysis-credential", "test-analysis-connection",
      "binary-status", "remove-binary-copy", "embeddings-credential", "support-link",
    ]));
    expect(groups.map((group) => group.heading)).toContain(getStrings("pt-PT").settingsSupportSection);
    expect(JSON.stringify(groups)).not.toContain("apiKey");
    tab.hide();
  });

  it("keeps definitions deterministic and the single source of truth on the composition", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const first = tab.getSettingDefinitions();
    const second = tab.getSettingDefinitions();

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("SUPER_SECRET_SENTINEL");
    tab.hide();
  });
});
