import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  getAnalysisProviderDefaults,
  getEmbeddingProviderDefaults,
} from "../../src/ai/providerDefaults";
import {
  DEFAULT_SETTINGS,
  LinaSettingTab,
  setDeviceSettingsContext,
  type LinaSettings,
} from "../../src/settings";
import { getPureLocalProviderOptions } from "../../src/settings/pureLocalSettingsModel";

type Domain = "analysis" | "embeddings";

function createTab(overrides: Record<string, unknown> = {}) {
  const app = new App();
  const plugin = new LinaPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    deviceSettingsById: {
      current: {
        analysisProvider: "ollama",
        analysisModel: "gemma4:e2b",
        analysisBaseUrl: "http://localhost:11434",
        embeddingsProvider: "ollama",
        embeddingsModel: "nomic-embed-text-v2-moe",
        embeddingsBaseUrl: "http://localhost:11434",
        ...overrides,
      },
    },
  } satisfies LinaSettings;
  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, "current");
  return { plugin, tab: new LinaSettingTab(app, plugin) };
}

function captureProviderChange(tab: LinaSettingTab, domain: Domain) {
  let selected = "";
  let change: (value: string) => Promise<void> = async () => undefined;
  const dropdown = {
    addOption() { return dropdown; },
    setValue(value: string) { selected = value; return dropdown; },
    onChange(callback: (value: string) => Promise<void>) { change = callback; return dropdown; },
  };
  const setting = {
    setName() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
  };
  const id = domain === "analysis" ? "analysis-provider" : "embeddings-provider";
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === id) as {
      render?: (target: unknown, group: unknown) => void;
    } | undefined;
  if (!definition?.render) throw new Error(`Missing active provider definition ${id}.`);
  definition.render(setting, {});
  return { selected, change };
}

function captureModelValue(tab: LinaSettingTab, domain: Domain): string {
  let value = "";
  const dropdown = {
    addOption() { return dropdown; },
    setValue() { return dropdown; },
    onChange() { return dropdown; },
  };
  const text = {
    setPlaceholder() { return text; },
    setValue(next: string) { value = next; return text; },
    onChange() { return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
  };
  const child = {
    setName() { return child; },
    setDesc() { return child; },
    addText(callback: (component: typeof text) => void) { callback(text); return child; },
  };
  const group = {
    addSetting(callback: (component: typeof child) => void) { callback(child); },
    listEl: { createEl() {} },
  };
  const id = domain === "analysis" ? "analysis-model" : "embeddings-model";
  const definition = tab.getSettingDefinitions()
    .flatMap((candidate) => candidate.items)
    .find((item) => (item as { id?: string }).id === id) as {
      render?: (target: unknown, targetGroup: unknown) => void;
    } | undefined;
  if (!definition?.render) throw new Error(`Missing active model definition ${id}.`);
  definition.render(setting, group);
  return value;
}

function findActiveRenderer(tab: LinaSettingTab, id: string) {
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === id) as {
      render?: (target: unknown, targetGroup: unknown) => void;
    } | undefined;
  if (!definition?.render) throw new Error(`Missing active renderer ${id}.`);
  return definition;
}

function captureModelCatalog(definition: ReturnType<typeof findActiveRenderer>) {
  const options: string[] = [];
  let selected = "";
  const dropdown = {
    addOption(value: string) { options.push(value); return dropdown; },
    setValue(value: string) { selected = value; return dropdown; },
    onChange() { return dropdown; },
  };
  const text = {
    setPlaceholder() { return text; },
    setValue() { return text; },
    onChange() { return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
  };
  const manual = {
    setName() { return manual; },
    setDesc() { return manual; },
    addText(callback: (component: typeof text) => void) { callback(text); return manual; },
  };
  definition.render(setting, {
    addSetting(callback: (component: typeof manual) => void) { callback(manual); },
    listEl: { createEl() {} },
  });
  return { options, selected };
}

function createModelCatalogHost(tab: LinaSettingTab, domain: Domain) {
  const id = domain === "analysis" ? "analysis-model" : "embeddings-model";
  let activeDefinition: ReturnType<typeof findActiveRenderer> | undefined;
  let activeCatalog = { options: [] as string[], selected: "" };
  const update = (): void => {
    const nextDefinition = findActiveRenderer(tab, id);
    if (nextDefinition === activeDefinition) return;
    activeDefinition = nextDefinition;
    activeCatalog = captureModelCatalog(nextDefinition);
  };
  update();
  return { update, getCatalog: () => activeCatalog };
}

function currentDevice(plugin: LinaPlugin): Record<string, unknown> {
  return plugin.settings.deviceSettingsById?.current ?? {};
}

describe("active settings provider transitions", () => {
  it.each([
    ["analysis", "analysisProvider", "analysisModel"],
    ["embeddings", "embeddingsProvider", "embeddingsModel"],
  ] as const)("refreshes %s model options and selection through repeated provider transitions in one active tab", async (
    domain,
    providerKey,
    modelKey,
  ) => {
    const initial = domain === "analysis"
      ? { analysisProvider: "mistral", analysisModel: "mistral-small-latest" }
      : { embeddingsProvider: "mistral", embeddingsModel: "mistral-embed" };
    const { plugin, tab } = createTab(initial);
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const host = createModelCatalogHost(tab, domain);
    vi.spyOn(tab, "update").mockImplementation(host.update);

    for (const provider of ["ollama", "mistral", "ollama"] as const) {
      await captureProviderChange(tab, domain).change(provider);
      await Promise.resolve();

      const defaults = domain === "analysis"
        ? getAnalysisProviderDefaults(provider)
        : getEmbeddingProviderDefaults(provider);
      const expectedOptions = provider === "ollama"
        ? (domain === "analysis" ? ["gemma4:e2b"] : ["nomic-embed-text-v2-moe", "nomic-embed-text"])
        : (domain === "analysis" ? ["mistral-small-latest", "mistral-large-latest"] : ["mistral-embed"]);
      const catalog = host.getCatalog();

      expect(currentDevice(plugin)[providerKey]).toBe(provider);
      expect(currentDevice(plugin)[modelKey]).toBe(defaults.model);
      expect(catalog.options).toEqual([...expectedOptions, "__lina_custom_model__"]);
      expect(catalog.selected).toBe(defaults.model);
    }
    tab.hide();
  });

  it.each([
    ["analysis", "openai", "analysisProvider", "analysisModel", "analysisBaseUrl"],
    ["analysis", "custom", "analysisProvider", "analysisModel", "analysisBaseUrl"],
    ["embeddings", "mistral", "embeddingsProvider", "embeddingsModel", "embeddingsBaseUrl"],
  ] as const)("replaces known %s defaults atomically when selecting %s", async (
    domain,
    nextProvider,
    providerKey,
    modelKey,
    baseUrlKey,
  ) => {
    const { plugin, tab } = createTab();
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const dirty = vi.spyOn(plugin, "markEmbeddingWorkStatusDirty").mockImplementation(() => undefined);

    await captureProviderChange(tab, domain).change(nextProvider);
    await Promise.resolve();

    const defaults = domain === "analysis"
      ? getAnalysisProviderDefaults(nextProvider)
      : getEmbeddingProviderDefaults(nextProvider);
    expect(currentDevice(plugin)).toMatchObject({
      [providerKey]: nextProvider,
    });
    expect(currentDevice(plugin)[modelKey] ?? "").toBe(defaults.model);
    expect(currentDevice(plugin)[baseUrlKey] ?? "").toBe(defaults.baseUrl);
    expect(captureProviderChange(tab, domain).selected).toBe(nextProvider);
    expect(captureModelValue(tab, domain)).toBe(defaults.model);
    expect(tab.getControlValue(baseUrlKey) ?? "").toBe(defaults.baseUrl);
    expect(save).toHaveBeenCalledTimes(1);
    expect(dirty).toHaveBeenCalledTimes(domain === "embeddings" ? 1 : 0);
    tab.hide();
  });

  it.each([
    ["custom-model", "http://localhost:11434", "custom-model", "https://api.openai.com/v1"],
    ["gemma4:e2b", "https://custom.example/v1", "", "https://custom.example/v1"],
    ["custom-model", "https://custom.example/v1", "custom-model", "https://custom.example/v1"],
  ])("preserves only genuinely custom analysis values", async (model, baseUrl, expectedModel, expectedBaseUrl) => {
    const { plugin, tab } = createTab({ analysisModel: model, analysisBaseUrl: baseUrl });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();

    await captureProviderChange(tab, "analysis").change("openai");

    expect(currentDevice(plugin)).toMatchObject({
      analysisProvider: "openai",
      analysisBaseUrl: expectedBaseUrl,
    });
    expect(currentDevice(plugin).analysisModel ?? "").toBe(expectedModel);
    expect(save).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it("rolls back provider, model, and Base URL together without running effects", async () => {
    const { plugin, tab } = createTab();
    vi.spyOn(plugin, "saveSettings").mockRejectedValue(new Error("save failed"));
    const dirty = vi.spyOn(plugin, "markEmbeddingWorkStatusDirty").mockImplementation(() => undefined);
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);

    await captureProviderChange(tab, "embeddings").change("mistral");

    expect(currentDevice(plugin)).toMatchObject({
      embeddingsProvider: "ollama",
      embeddingsModel: "nomic-embed-text-v2-moe",
      embeddingsBaseUrl: "http://localhost:11434",
    });
    expect(dirty).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    tab.hide();
  });

  it("orders the embedding effect and rerender after the single confirmed save", async () => {
    const { plugin, tab } = createTab();
    const events: string[] = [];
    vi.spyOn(plugin, "saveSettings").mockImplementation(async () => { events.push("save"); });
    vi.spyOn(plugin, "markEmbeddingWorkStatusDirty").mockImplementation(() => { events.push("effect"); });
    vi.spyOn(tab, "update").mockImplementation(() => { events.push("update"); });

    await captureProviderChange(tab, "embeddings").change("mistral");
    await Promise.resolve();

    expect(events).toEqual(["save", "effect", "update"]);
    tab.hide();
  });

  it("does not let a failed earlier transition roll back a later confirmed transition", async () => {
    const { plugin, tab } = createTab();
    const save = vi.spyOn(plugin, "saveSettings")
      .mockRejectedValueOnce(new Error("first save failed"))
      .mockResolvedValueOnce();
    const dirty = vi.spyOn(plugin, "markEmbeddingWorkStatusDirty").mockImplementation(() => undefined);
    const provider = captureProviderChange(tab, "embeddings");

    const failed = provider.change("mistral");
    const confirmed = provider.change("openai");
    await Promise.all([failed, confirmed]);

    expect(currentDevice(plugin)).toMatchObject({
      embeddingsProvider: "openai",
      embeddingsBaseUrl: "https://api.openai.com/v1",
    });
    expect(currentDevice(plugin).embeddingsModel ?? "").toBe("");
    expect(save).toHaveBeenCalledTimes(2);
    expect(dirty).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it("exposes one centralized default matrix for every supported provider and domain", () => {
    const expected = {
      ollama: ["gemma4:e2b", "nomic-embed-text-v2-moe", "http://localhost:11434"],
      mistral: ["mistral-small-latest", "mistral-embed", "https://api.mistral.ai/v1"],
      openrouter: ["", "", "https://openrouter.ai/api/v1"],
      openai: ["", "", "https://api.openai.com/v1"],
      gemini: ["", "", "https://generativelanguage.googleapis.com/v1beta"],
      anthropic: ["", "", "https://api.anthropic.com"],
      custom: ["", "", ""],
    } as const;

    expect(getPureLocalProviderOptions().map(({ value }) => value)).toEqual(Object.keys(expected));
    for (const [provider, [analysisModel, embeddingModel, baseUrl]] of Object.entries(expected)) {
      expect(getAnalysisProviderDefaults(provider)).toEqual({ model: analysisModel, baseUrl });
      expect(getEmbeddingProviderDefaults(provider)).toEqual({ model: embeddingModel, baseUrl });
    }
  });
});
