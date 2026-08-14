import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  DEFAULT_SETTINGS,
  LinaSettingTab,
  getLocalAnalysisModel,
  getLocalEmbeddingsModel,
  setDeviceSettingsContext,
  type LinaSettings,
} from "../../src/settings";

function createContext(): { plugin: LinaPlugin; tab: LinaSettingTab } {
  const app = new App();
  const plugin = new LinaPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    deviceSettingsById: {
      current: {
        analysisProvider: "ollama",
        analysisModel: "gemma4:e2b",
        embeddingsProvider: "ollama",
        embeddingsModel: "nomic-embed-text-v2-moe",
      },
    },
  } satisfies LinaSettings;
  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, "current");
  return { plugin, tab: new LinaSettingTab(app, plugin) };
}

function findDefinition(tab: LinaSettingTab, id: string) {
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === id);
  if (!definition) throw new Error(`Missing active definition ${id}.`);
  return definition as { render?: (setting: unknown, group: unknown) => void };
}

function captureModel(tab: LinaSettingTab, id: "analysis-model" | "embeddings-model") {
  let selected = "";
  let manualValue = "";
  let change: (value: string) => Promise<void> = async () => undefined;
  const dropdown = {
    addOption() { return dropdown; },
    setValue(value: string) { selected = value; return dropdown; },
    onChange(callback: (value: string) => Promise<void>) { change = callback; return dropdown; },
  };
  const text = {
    setPlaceholder() { return text; },
    setValue(value: string) { manualValue = value; return text; },
    onChange() { return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
    addText(callback: (component: typeof text) => void) { callback(text); return setting; },
  };
  const group = {
    listEl: { createEl() {} },
  };
  findDefinition(tab, id).render?.(setting, group);
  return { selected, manualValue, change };
}

function captureAutoUpdateToggle(tab: LinaSettingTab) {
  let selected = false;
  let change: (value: boolean) => Promise<void> = async () => undefined;
  const toggle = {
    setValue(value: boolean) { selected = value; return toggle; },
    onChange(callback: (value: boolean) => Promise<void>) { change = callback; return toggle; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addToggle(callback: (component: typeof toggle) => void) { callback(toggle); return setting; },
  };
  findDefinition(tab, "auto-update-index-on-file-changes").render?.(setting, {});
  return { selected, change };
}

describe("active LinaSettingTab value hook persistence", () => {
  it.each([
    ["analysis-model", "llama3.2:latest", "analysisModel"],
    ["embeddings-model", "mxbai-embed-large:latest", "embeddingsModel"],
  ] as const)("persists and rerenders %s from the latest snapshot", async (id, next, key) => {
    const { plugin, tab } = createContext();
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const first = captureModel(tab, id);
    await first.change(next);
    const rerendered = captureModel(tab, id);

    expect(plugin.settings.deviceSettingsById?.current?.[key]).toBe(next);
    expect(id === "analysis-model" ? getLocalAnalysisModel() : getLocalEmbeddingsModel()).toBe(next);
    expect(rerendered.selected).toBe("__lina_custom_model__");
    expect(rerendered.manualValue).toBe(next);
    expect(save).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it("routes native Index control keys exactly once and preserves them after update", async () => {
    const { plugin, tab } = createContext();
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    for (const key of ["checkSyncOnStartup", "updateIndexOnStartup", "debugIndexUpdates"] as const) {
      await tab.setControlValue(key, true);
      expect(tab.getControlValue(key)).toBe(true);
      tab.update();
      expect(tab.getControlValue(key)).toBe(true);
    }
    expect(save).toHaveBeenCalledTimes(3);
    tab.hide();
  });

  it("uses the real host key contract and requests one update only after save", async () => {
    const { plugin, tab } = createContext();
    const events: string[] = [];
    vi.spyOn(plugin, "saveSettings").mockImplementation(async () => { events.push("save"); });
    vi.spyOn(tab, "update").mockImplementation(() => { events.push("update"); });

    await tab.setControlValue("checkSyncOnStartup", true);
    await Promise.resolve();

    expect(events).toEqual(["save", "update"]);
    expect(plugin.settings.checkSyncOnStartup).toBe(true);
    tab.hide();
  });

  it("rolls an Index toggle back on save failure without requesting update", async () => {
    const { plugin, tab } = createContext();
    vi.spyOn(plugin, "saveSettings").mockRejectedValue(new Error("save failed"));
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);

    await tab.setControlValue("checkSyncOnStartup", true);
    await Promise.resolve();

    expect(plugin.settings.checkSyncOnStartup).toBe(false);
    expect(tab.getControlValue("checkSyncOnStartup")).toBe(false);
    expect(update).not.toHaveBeenCalled();
    tab.hide();
  });

  it("persists the custom automatic Index toggle across rerender", async () => {
    const { plugin, tab } = createContext();
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    vi.spyOn(plugin, "updateVaultEventListeners").mockImplementation(() => undefined);
    const first = captureAutoUpdateToggle(tab);
    await first.change(true);
    const rerendered = captureAutoUpdateToggle(tab);

    expect(plugin.settings.autoUpdateIndexOnFileChanges).toBe(true);
    expect(rerendered.selected).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it("routes exclusion textarea keys and preserves canonical text after update", async () => {
    const { plugin, tab } = createContext();
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    vi.spyOn(plugin, "reconcileIndexExclusionsAfterSettingsChange").mockResolvedValue();
    const changes = {
      indexExcludedFolders: "Private/\nArchive/",
      indexExcludedPathContains: "password\ntoken",
      indexExcludedContentContains: "SECRET; PRIVATE",
    } as const;
    for (const [key, value] of Object.entries(changes)) {
      await tab.setControlValue(key, value);
      expect(tab.getControlValue(key)).toBe(value);
      tab.update();
      expect(tab.getControlValue(key)).toBe(value);
    }
    expect(save).toHaveBeenCalledTimes(3);
    tab.hide();
  });

  it("runs exclusion reconciliation only after a confirmed exclusion setting save", async () => {
    const { plugin, tab } = createContext();
    const events: string[] = [];
    vi.spyOn(plugin, "saveSettings").mockImplementation(async () => { events.push("save"); });
    vi.spyOn(plugin, "reconcileIndexExclusionsAfterSettingsChange").mockImplementation(async () => {
      events.push("reconcile");
    });

    await tab.setControlValue("indexExcludedFolders", "Private/");
    await Promise.resolve();

    expect(events).toEqual(["save", "reconcile"]);
    tab.hide();
  });

  it("does not reconcile exclusions after a failed setting save", async () => {
    const { plugin, tab } = createContext();
    vi.spyOn(plugin, "saveSettings").mockRejectedValue(new Error("save failed"));
    const reconcile = vi.spyOn(plugin, "reconcileIndexExclusionsAfterSettingsChange");

    await tab.setControlValue("indexExcludedFolders", "Private/");

    expect(reconcile).not.toHaveBeenCalled();
    expect(plugin.settings.indexExcludedFolders).toBe(DEFAULT_SETTINGS.indexExcludedFolders);
    tab.hide();
  });
});
