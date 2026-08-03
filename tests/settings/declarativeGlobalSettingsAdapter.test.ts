import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { IndexData } from "../../src/indexStore";
import {
  DEFAULT_SETTINGS,
  DECLARATIVE_GLOBAL_SETTING_KEYS,
  LinaSettings,
  LinaSettingTab,
} from "../../src/settings";

interface SavedPayload {
  settings: LinaSettings;
  index?: IndexData;
}

function isSavedPayload(value: unknown): value is SavedPayload {
  return typeof value === "object"
    && value !== null
    && "settings" in value
    && typeof value.settings === "object"
    && value.settings !== null;
}

function createSettings(): LinaSettings {
  return {
    ...DEFAULT_SETTINGS,
    aiProfiles: DEFAULT_SETTINGS.aiProfiles.map((profile) => ({ ...profile })),
    deviceSettingsById: {
      "device-test": {
        analysisProvider: "mistral",
        analysisModel: "mistral-small-latest",
        analysisBaseUrl: "https://example.invalid",
        analysisApiKey: "not-a-real-secret",
        analysisTimeout: "60",
        embeddingStorageReadPreference: "prefer-binary",
      },
    },
  };
}

class TestLinaPlugin extends LinaPlugin {
  savedPayloads: SavedPayload[] = [];
  saveFailure: Error | undefined;

  async saveData(data: unknown): Promise<void> {
    if (this.saveFailure) throw this.saveFailure;
    if (!isSavedPayload(data)) throw new Error("Unexpected saved payload.");
    this.savedPayloads.push(data);
  }
}

function createTestContext(): { plugin: TestLinaPlugin; tab: LinaSettingTab } {
  const app = new App();
  const plugin = new TestLinaPlugin(app);
  plugin.settings = createSettings();
  plugin.indexData = {
    version: 123,
    entries: [{
      path: "preserve-me.md",
      basename: "preserve-me",
      extension: "md",
      mtime: 1,
      indexedAt: 2,
      excerpt: "sentinel",
      charCount: 8,
      wordCount: 1,
      contentUpdatedAt: 3,
    }],
  };

  return { plugin, tab: new LinaSettingTab(app, plugin) };
}

describe("declarative global settings adapter", () => {
  it("keeps an explicit, global-only whitelist", () => {
    expect(DECLARATIVE_GLOBAL_SETTING_KEYS).toEqual([
      "embeddingsEnabled",
      "checkSyncOnStartup",
      "updateIndexOnStartup",
      "debugIndexUpdates",
      "indexExcludedFolders",
      "indexExcludedPathContains",
      "indexExcludedContentContains",
      "yamlSuggestionsEnabled",
      "yamlAllowedProperties",
      "yamlIncludeTags",
      "embeddingDefaultLanguage",
    ]);
  });

  it("reads only whitelisted global values without side effects", () => {
    const { tab } = createTestContext();
    const display = vi.spyOn(tab, "display");
    const update = vi.spyOn(tab, "update");

    expect(tab.getControlValue("embeddingsEnabled")).toBe(false);
    expect(tab.getControlValue("yamlAllowedProperties")).toBe("tipo, projeto, area, contexto, estado, tags");
    expect(display).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("writes valid global boolean, string, and enum values through the existing save flow", async () => {
    const { plugin, tab } = createTestContext();
    const saveSettings = vi.spyOn(plugin, "saveSettings");
    const display = vi.spyOn(tab, "display");
    const update = vi.spyOn(tab, "update");

    await tab.setControlValue("embeddingsEnabled", true);
    await tab.setControlValue("yamlAllowedProperties", "tipo, estado");
    await tab.setControlValue("embeddingDefaultLanguage", "multi");

    expect(plugin.settings.embeddingsEnabled).toBe(true);
    expect(plugin.settings.yamlAllowedProperties).toBe("tipo, estado");
    expect(plugin.settings.embeddingDefaultLanguage).toBe("multi");
    expect(saveSettings).toHaveBeenCalledTimes(3);
    expect(plugin.savedPayloads).toHaveLength(3);
    expect(plugin.savedPayloads.at(-1)).toEqual({ settings: plugin.settings, index: plugin.indexData });
    expect(plugin.savedPayloads.at(-1)?.index?.entries[0]?.excerpt).toBe("sentinel");
    expect(plugin.settings.deviceSettingsById?.["device-test"]?.analysisApiKey).toBe("not-a-real-secret");
    expect(display).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects unknown, device-scoped, and secret keys without saving or exposing values", async () => {
    const { plugin, tab } = createTestContext();
    const saveSettings = vi.spyOn(plugin, "saveSettings");

    expect(() => tab.getControlValue("analysisProvider")).toThrow("Unsupported declarative global setting key.");
    expect(() => tab.getControlValue("aiApiKey")).toThrow("Unsupported declarative global setting key.");
    expect(() => tab.getControlValue("deviceSettingsById")).toThrow("Unsupported declarative global setting key.");
    await expect(tab.setControlValue("analysisApiKey", "not-a-real-secret")).rejects.toThrow("Unsupported declarative global setting key.");
    await expect(tab.setControlValue("unknownSetting", true)).rejects.toThrow("Unsupported declarative global setting key.");

    expect(saveSettings).not.toHaveBeenCalled();
    expect(plugin.settings.deviceSettingsById?.["device-test"]?.analysisApiKey).toBe("not-a-real-secret");
  });

  it("rejects invalid values without persisting or changing the setting", async () => {
    const { plugin, tab } = createTestContext();
    const saveSettings = vi.spyOn(plugin, "saveSettings");

    await expect(tab.setControlValue("embeddingsEnabled", "true")).rejects.toThrow("Invalid value for declarative global setting.");
    await expect(tab.setControlValue("yamlAllowedProperties", 42)).rejects.toThrow("Invalid value for declarative global setting.");
    await expect(tab.setControlValue("embeddingDefaultLanguage", "de")).rejects.toThrow("Invalid value for declarative global setting.");

    expect(plugin.settings.embeddingsEnabled).toBe(false);
    expect(plugin.settings.yamlAllowedProperties).toBe("tipo, projeto, area, contexto, estado, tags");
    expect(plugin.settings.embeddingDefaultLanguage).toBe("pt-PT");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("propagates a persistence failure", async () => {
    const { plugin, tab } = createTestContext();
    plugin.saveFailure = new Error("save failed");

    await expect(tab.setControlValue("checkSyncOnStartup", true)).rejects.toThrow("save failed");
    expect(plugin.savedPayloads).toHaveLength(0);
  });
});
