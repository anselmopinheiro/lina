import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";

function createTab() {
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
  return new LinaSettingTab(app, plugin);
}

describe("C4 active settings lifecycle and cleanup", () => {
  it("owns one declarative composition until hide and recreates it only after disposal", () => {
    const tab = createTab();
    const first = tab.getSettingDefinitions();
    const second = tab.getSettingDefinitions();

    const firstAction = first.flatMap((group) => group.items).find((item) => (item as { id?: string }).id === "test-analysis-connection") as { action?: unknown };
    const secondAction = second.flatMap((group) => group.items).find((item) => (item as { id?: string }).id === "test-analysis-connection") as { action?: unknown };
    expect(secondAction.action).toBe(firstAction.action);
    tab.hide();
    tab.hide();
    const reopened = tab.getSettingDefinitions();
    expect(reopened).not.toBe(first);
    expect(reopened.flatMap((group) => group.items)).toHaveLength(47);
    tab.hide();
  });

  it("keeps credential definitions secret-free and empty before explicit input", () => {
    const tab = createTab();
    const definitions = tab.getSettingDefinitions().flatMap((group) => group.items) as Array<{ id: string; visible?: () => boolean }>;
    const analysis = definitions.find((definition) => definition.id === "analysis-credential");
    const embeddings = definitions.find((definition) => definition.id === "embeddings-credential");
    const serialized = JSON.stringify(definitions);

    expect(analysis?.visible?.()).toBe(true);
    expect(embeddings?.visible?.()).toBe(true);
    expect(serialized).not.toContain("SUPER_SECRET_SENTINEL");
    expect(serialized).not.toContain("apiKey");
    tab.hide();
  });

  it("keeps the connection and binary actions under declarative lifecycle ownership", () => {
    const tab = createTab();
    const definitions = tab.getSettingDefinitions().flatMap((group) => group.items) as Array<{ id: string; action?: () => Promise<unknown>; disabled?: () => boolean }>;

    for (const id of ["test-analysis-connection", "test-embeddings-connection", "check-binary-copy", "create-or-update-binary-copy"]) {
      const definition = definitions.find((entry) => entry.id === id);
      expect(definition?.action).toEqual(expect.any(Function));
      expect(definition?.disabled?.()).toBe(false);
    }
    expect(definitions.find((entry) => entry.id === "remove-binary-copy")?.action).toBeUndefined();
    tab.hide();
  });
});
