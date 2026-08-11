import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";

describe("active declarative credential settings", () => {
  it("keeps analysis and embeddings credentials out of public definitions", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: {
        current: {
          analysisProvider: "mistral",
          analysisApiKey: "SUPER_SECRET_SENTINEL",
          embeddingsProvider: "mistral",
          embeddingsApiKey: "SUPER_SECRET_SENTINEL",
        },
      },
    };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const definitions = tab.getSettingDefinitions().flatMap((group) => group.items) as Array<{ id: string; render?: unknown; visible?: () => boolean }>;

    for (const id of ["analysis-credential", "embeddings-credential"]) {
      const definition = definitions.find((entry) => entry.id === id);
      expect(definition?.render).toEqual(expect.any(Function));
      expect(definition?.visible?.()).toBe(true);
    }
    const serialized = JSON.stringify(definitions);
    expect(serialized).not.toContain("SUPER_SECRET_SENTINEL");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("Authorization");
    tab.hide();
  });

  it("keeps credentials outside value hooks and requires their explicit renderer actions", async () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: { analysisProvider: "mistral" } } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);

    expect(tab.getControlValue("analysis-credential")).toBeUndefined();
    await tab.setControlValue("analysis-credential", "not-a-real-secret");
    expect(plugin.settings.deviceSettingsById?.current?.analysisApiKey).toBeUndefined();
    tab.hide();
  });
});
