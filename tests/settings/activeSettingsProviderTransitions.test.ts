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
  normalizeAiProfiles,
  normalizeSupportedProvider,
  setDeviceSettingsContext,
  type LinaSettings,
} from "../../src/settings";
import { getPureLocalProviderOptions } from "../../src/settings/pureLocalSettingsModel";

type Domain = "analysis" | "embeddings";

const MANUAL_SENTINEL = "__lina_custom_model__";

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
    setValue(next: string) { value = next; return dropdown; },
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
    addText(callback: (component: typeof text) => void) { callback(text); return setting; },
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

function activeDefinition(tab: LinaSettingTab, id: string) {
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === id) as { visible?: boolean | (() => boolean) } | undefined;
  if (!definition) throw new Error(`Missing active definition ${id}.`);
  return definition;
}

function activeControlPlaceholder(tab: LinaSettingTab, id: string): string | undefined {
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === id) as {
      control?: { placeholder?: string };
    } | undefined;
  if (!definition?.control) throw new Error(`Missing active control definition ${id}.`);
  return definition.control.placeholder;
}

function captureModelCatalog(definition: ReturnType<typeof findActiveRenderer>) {
  const options: string[] = [];
  let selected = "";
  let textValue = "";
  let controlType: "dropdown" | "text" | "" = "";
  const dropdown = {
    addOption(value: string) { options.push(value); return dropdown; },
    setValue(value: string) { selected = value; return dropdown; },
    onChange() { return dropdown; },
  };
  const text = {
    setPlaceholder() { return text; },
    setValue(value: string) { textValue = value; return text; },
    onChange() { return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { controlType = "dropdown"; callback(dropdown); return setting; },
    addText(callback: (component: typeof text) => void) { controlType = "text"; callback(text); return setting; },
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
  return { controlType, options, selected, textValue };
}

function captureModelControls(tab: LinaSettingTab, domain: Domain) {
  let dropdowns = 0;
  let textboxes = 0;
  let textValue = "";
  let changeDropdown: (value: string) => Promise<void> = async () => undefined;
  let changeText: (value: string) => Promise<void> = async () => undefined;
  const dropdown = {
    addOption() { return dropdown; },
    setValue() { return dropdown; },
    onChange(callback: (value: string) => Promise<void>) { changeDropdown = callback; return dropdown; },
  };
  const text = {
    setPlaceholder() { return text; },
    setValue(value: string) { textValue = value; return text; },
    onChange(callback: (value: string) => Promise<void>) { changeText = callback; return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { dropdowns += 1; callback(dropdown); return setting; },
    addText(callback: (component: typeof text) => void) { textboxes += 1; callback(text); return setting; },
  };
  const manualSetting = {
    setName() { return manualSetting; },
    setDesc() { return manualSetting; },
    addText(callback: (component: typeof text) => void) { textboxes += 1; callback(text); return manualSetting; },
  };
  const group = {
    addSetting(callback: (child: typeof manualSetting) => void) { callback(manualSetting); },
    listEl: { createEl() {} },
  };
  const id = domain === "analysis" ? "analysis-model" : "embeddings-model";
  findActiveRenderer(tab, id).render(setting, group);
  return { dropdowns, textboxes, textValue, changeDropdown, changeText };
}

function createActiveModelDomHarness(tab: LinaSettingTab, domain: Domain) {
  type Control = {
    tag: "select" | "input";
    editable: boolean;
    focused: boolean;
    value: string;
    change: (value: string) => Promise<void>;
  };
  let controls: Control[] = [];
  let renderCount = 0;
  const id = domain === "analysis" ? "analysis-model" : "embeddings-model";
  const render = (): void => {
    renderCount += 1;
    controls = [];
    const setting = {
      setName() { return setting; },
      setDesc() { return setting; },
      addDropdown(callback: (component: {
        addOption(value: string, label: string): unknown;
        setValue(value: string): unknown;
        onChange(handler: (value: string) => Promise<void>): unknown;
      }) => void) {
        const control: Control = { tag: "select", editable: true, focused: false, value: "", change: async () => undefined };
        const dropdown = {
          addOption() { return dropdown; },
          setValue(value: string) { control.value = value; return dropdown; },
          onChange(handler: (value: string) => Promise<void>) { control.change = handler; return dropdown; },
        };
        controls.push(control);
        callback(dropdown);
        return setting;
      },
      addText(callback: (component: {
        setPlaceholder(value: string): unknown;
        setValue(value: string): unknown;
        onChange(handler: (value: string) => Promise<void>): unknown;
      }) => void) {
        const control: Control = { tag: "input", editable: true, focused: false, value: "", change: async () => undefined };
        const text = {
          setPlaceholder() { return text; },
          setValue(value: string) { control.value = value; return text; },
          onChange(handler: (value: string) => Promise<void>) {
            control.change = async (value) => {
              control.value = value;
              await handler(value);
            };
            return text;
          },
        };
        controls.push(control);
        callback(text);
        return setting;
      },
    };
    findActiveRenderer(tab, id).render(setting, { listEl: { createEl() {} } });
  };
  return {
    render,
    getControls: () => controls,
    getRenderCount: () => renderCount,
    focus(control: Control) { control.focused = true; },
  };
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
    ["analysis", "analysisProvider", "analysisModel", "mistral", "mistral-small-latest"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "mistral", "mistral-embed"],
    ["analysis", "analysisProvider", "analysisModel", "ollama", "gemma4:e2b"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "ollama", "nomic-embed-text-v2-moe"],
  ] as const)("creates a real editable manual textbox in the active DOM after selecting the sentinel for %s/%s", async (
    domain,
    providerKey,
    modelKey,
    provider,
    model,
  ) => {
    const { plugin, tab } = createTab({ [providerKey]: provider, [modelKey]: model });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const dom = createActiveModelDomHarness(tab, domain);
    vi.spyOn(tab, "update").mockImplementation(dom.render);

    dom.render();
    expect(dom.getControls()).toEqual([
      expect.objectContaining({ tag: "select", editable: true, value: model }),
    ]);
    await dom.getControls()[0]!.change(MANUAL_SENTINEL);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(dom.getControls()).toEqual([
      expect.objectContaining({ tag: "select", editable: true, value: MANUAL_SENTINEL }),
      expect.objectContaining({ tag: "input", editable: true, value: model }),
    ]);
    expect(save).not.toHaveBeenCalled();
    tab.hide();
  });

  it.each([
    ["analysis", "analysisProvider", "analysisModel", "openrouter/analysis-model"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "openrouter/embeddings-model"],
  ] as const)("keeps custom OpenRouter models behind one provider-scoped dropdown and textbox in the active DOM for %s", (domain, providerKey, modelKey, model) => {
    const { tab } = createTab({ [providerKey]: "openrouter", [modelKey]: model });
    const dom = createActiveModelDomHarness(tab, domain);

    dom.render();

    expect(dom.getControls()).toEqual([
      expect.objectContaining({ tag: "select", editable: true, value: MANUAL_SENTINEL }),
      expect.objectContaining({ tag: "input", editable: true, value: model }),
    ]);
    tab.hide();
  });

  it.each([
    ["analysis", "analysisProvider", "analysisModel", "mistral", "mistral-small-latest"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "mistral", "mistral-embed"],
    ["analysis", "analysisProvider", "analysisModel", "ollama", "gemma4:e2b"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "ollama", "nomic-embed-text-v2-moe"],
  ] as const)("keeps the active manual textbox focused and unrecreated while typing for %s/%s", async (
    domain,
    providerKey,
    modelKey,
    provider,
    model,
  ) => {
    const { plugin, tab } = createTab({ [providerKey]: provider, [modelKey]: model });
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const dom = createActiveModelDomHarness(tab, domain);
    vi.spyOn(tab, "update").mockImplementation(dom.render);

    dom.render();
    await dom.getControls()[0]!.change(MANUAL_SENTINEL);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const textbox = dom.getControls()[1]!;
    dom.focus(textbox);
    const structuralRenders = dom.getRenderCount();

    for (const value of ["m", "me", "meu", "meu-modelo"]) {
      await textbox.change(value);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(dom.getControls()).toEqual([
        expect.objectContaining({ tag: "select", value: MANUAL_SENTINEL }),
        textbox,
      ]);
      expect(textbox).toMatchObject({ editable: true, focused: true, value });
    }

    expect(dom.getRenderCount()).toBe(structuralRenders);
    expect(currentDevice(plugin)[modelKey]).toBe("meu-modelo");
    tab.hide();
  });

  it.each([
    ["analysis", "analysisProvider", "analysisModel"],
    ["embeddings", "embeddingsProvider", "embeddingsModel"],
  ] as const)("keeps the OpenRouter custom textbox focused and unrecreated while typing for %s", async (domain, providerKey, modelKey) => {
    const { plugin, tab } = createTab({ [providerKey]: "openrouter", [modelKey]: "" });
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const dom = createActiveModelDomHarness(tab, domain);
    vi.spyOn(tab, "update").mockImplementation(dom.render);

    dom.render();
    if (domain === "embeddings") {
      await dom.getControls()[0]!.change(MANUAL_SENTINEL);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    const textbox = dom.getControls()[1]!;
    dom.focus(textbox);
    const structuralRenders = dom.getRenderCount();

    for (const value of ["o", "op", "openrouter/model"]) {
      await textbox.change(value);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(dom.getControls()).toEqual([
        expect.objectContaining({ tag: "select", value: MANUAL_SENTINEL }),
        textbox,
      ]);
      expect(textbox).toMatchObject({ editable: true, focused: true, value });
    }

    expect(dom.getRenderCount()).toBe(structuralRenders);
    expect(currentDevice(plugin)[modelKey]).toBe("openrouter/model");
    tab.hide();
  });

  it("keeps the latest concurrent manual model value after an earlier save completes", async () => {
    let releaseFirstSave: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    const { plugin, tab } = createTab({ analysisProvider: "mistral", analysisModel: "mistral-small-latest" });
    vi.spyOn(plugin, "saveSettings")
      .mockImplementationOnce(async () => firstSave)
      .mockResolvedValue();
    const dom = createActiveModelDomHarness(tab, "analysis");
    vi.spyOn(tab, "update").mockImplementation(dom.render);

    dom.render();
    await dom.getControls()[0]!.change(MANUAL_SENTINEL);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const textbox = dom.getControls()[1]!;
    const structuralRenders = dom.getRenderCount();
    const earlier = textbox.change("m");
    await Promise.resolve();
    const latest = textbox.change("me");
    releaseFirstSave?.();
    await Promise.all([earlier, latest]);

    expect(currentDevice(plugin).analysisModel).toBe("me");
    expect(dom.getControls()).toEqual([
      expect.objectContaining({ tag: "select", value: MANUAL_SENTINEL }),
      textbox,
    ]);
    expect(textbox.value).toBe("me");
    expect(dom.getRenderCount()).toBe(structuralRenders);
    tab.hide();
  });

  it.each([
    ["analysis", "analysisProvider", "analysisModel", "mistral", "mistral-small-latest", "mistral/manual-model"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "mistral", "mistral-embed", "mistral/manual-model"],
    ["analysis", "analysisProvider", "analysisModel", "ollama", "gemma4:e2b", "ollama/manual-model"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "ollama", "nomic-embed-text-v2-moe", "ollama/manual-model"],
  ] as const)("persists, restores, and clears the active DOM manual textbox for %s/%s", async (
    domain,
    providerKey,
    modelKey,
    provider,
    knownModel,
    manualModel,
  ) => {
    const { plugin, tab } = createTab({ [providerKey]: provider, [modelKey]: knownModel });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const dom = createActiveModelDomHarness(tab, domain);
    vi.spyOn(tab, "update").mockImplementation(dom.render);

    dom.render();
    await dom.getControls()[0]!.change(MANUAL_SENTINEL);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await dom.getControls()[1]!.change(manualModel);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(currentDevice(plugin)[modelKey]).toBe(manualModel);
    expect(dom.getControls()).toEqual([
      expect.objectContaining({ tag: "select", value: MANUAL_SENTINEL }),
      expect.objectContaining({ tag: "input", editable: true, value: manualModel }),
    ]);
    expect(save).toHaveBeenCalledTimes(1);
    tab.hide();

    const reopened = new LinaSettingTab(plugin.app, plugin);
    const reopenedDom = createActiveModelDomHarness(reopened, domain);
    vi.spyOn(reopened, "update").mockImplementation(reopenedDom.render);
    reopenedDom.render();
    expect(reopenedDom.getControls()).toEqual([
      expect.objectContaining({ tag: "select", value: MANUAL_SENTINEL }),
      expect.objectContaining({ tag: "input", editable: true, value: manualModel }),
    ]);

    await reopenedDom.getControls()[0]!.change(knownModel);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(currentDevice(plugin)[modelKey]).toBe(knownModel);
    expect(reopenedDom.getControls()).toEqual([
      expect.objectContaining({ tag: "select", value: knownModel }),
    ]);
    expect(save).toHaveBeenCalledTimes(2);
    reopened.hide();
  });

  it.each([
    ["analysis", "analysisProvider", "analysisModel", "mistral", "mistral-small-latest", "mistral/manual-model"],
    ["analysis", "analysisProvider", "analysisModel", "ollama", "gemma4:e2b", "ollama/manual-model"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "mistral", "mistral-embed", "mistral/manual-model"],
    ["embeddings", "embeddingsProvider", "embeddingsModel", "ollama", "nomic-embed-text-v2-moe", "ollama/manual-model"],
  ] as const)("switches %s from a known catalog model to a persisted manual model", async (
    domain,
    providerKey,
    modelKey,
    provider,
    knownModel,
    manualModel,
  ) => {
    const { plugin, tab } = createTab({ [providerKey]: provider, [modelKey]: knownModel });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const known = captureModelControls(tab, domain);

    expect(known).toMatchObject({ dropdowns: 1, textboxes: 0 });
    await known.changeDropdown("__lina_custom_model__");
    const manual = captureModelControls(tab, domain);
    expect(manual).toMatchObject({ dropdowns: 1, textboxes: 1, textValue: knownModel });
    await manual.changeText(manualModel);
    tab.update();

    expect(currentDevice(plugin)[modelKey]).toBe(manualModel);
    expect(captureModelControls(tab, domain)).toMatchObject({ dropdowns: 1, textboxes: 1, textValue: manualModel });
    tab.hide();

    const reopened = new LinaSettingTab(plugin.app, plugin);
    const restored = captureModelControls(reopened, domain);
    expect(restored).toMatchObject({ dropdowns: 1, textboxes: 1, textValue: manualModel });
    await restored.changeDropdown(knownModel);
    reopened.update();

    expect(currentDevice(plugin)[modelKey]).toBe(knownModel);
    expect(captureModelControls(reopened, domain)).toMatchObject({ dropdowns: 1, textboxes: 0 });
    expect(save).toHaveBeenCalledTimes(2);
    reopened.hide();
  });

  it.each([
    ["mistral", "ollama"],
    ["ollama", "mistral"],
    ["mistral", "openrouter"],
    ["openrouter", "mistral"],
    ["ollama", "openrouter"],
    ["openrouter", "ollama"],
  ] as const)("preserves custom %s models from %s to %s", async (from, to) => {
    for (const domain of ["analysis", "embeddings"] as const) {
      const providerKey = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
      const modelKey = domain === "analysis" ? "analysisModel" : "embeddingsModel";
      const model = `${domain}-custom-model`;
      const { plugin, tab } = createTab({ [providerKey]: from, [modelKey]: model });
      vi.spyOn(plugin, "saveSettings").mockResolvedValue();

      await captureProviderChange(tab, domain).change(to);

      const controls = captureModelControls(tab, domain);
      expect(currentDevice(plugin)[modelKey]).toBe(model);
      expect(controls).toMatchObject({ dropdowns: 1, textboxes: 1, textValue: model });
      tab.hide();
    }
  });

  it.each([
    ["analysis", "ollama", 1, 0],
    ["analysis", "mistral", 1, 0],
    ["analysis", "openrouter", 1, 1],
    ["embeddings", "ollama", 1, 0],
    ["embeddings", "mistral", 1, 0],
    ["embeddings", "openrouter", 1, 0],
  ] as const)("renders one provider-appropriate %s model control for %s", (domain, provider, dropdowns, textboxes) => {
    const key = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
    const { tab } = createTab({ [key]: provider });

    expect(captureModelControls(tab, domain)).toMatchObject({ dropdowns, textboxes });
    tab.hide();
  });

  it("persists an explicit OpenRouter embedding model through rerender and reopen", async () => {
    const domain = "embeddings" as const;
    const providerKey = "embeddingsProvider";
    const modelKey = "embeddingsModel";
    const model = "openrouter/embedding-model";
    const { plugin, tab } = createTab({ [providerKey]: "openrouter" });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const initial = captureModelControls(tab, domain);

    expect(initial).toMatchObject({
      dropdowns: 1,
      textboxes: 0,
      textValue: "",
    });
    await initial.changeDropdown(MANUAL_SENTINEL);
    const manual = captureModelControls(tab, domain);
    await manual.changeText(model);
    tab.update();

    expect(currentDevice(plugin)[modelKey]).toBe(model);
    expect(captureModelControls(tab, domain)).toMatchObject({ dropdowns: 1, textboxes: 1, textValue: model });
    tab.hide();

    const reopened = new LinaSettingTab(plugin.app, plugin);
    expect(captureModelControls(reopened, domain)).toMatchObject({ dropdowns: 1, textboxes: 1, textValue: model });
    expect(save).toHaveBeenCalledTimes(1);
    reopened.hide();
  });

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

    for (const provider of ["ollama", "mistral", "ollama", "openrouter", "ollama", "mistral", "openrouter", "mistral"] as const) {
      await captureProviderChange(tab, domain).change(provider);
      await Promise.resolve();

      const defaults = domain === "analysis"
        ? getAnalysisProviderDefaults(provider)
        : getEmbeddingProviderDefaults(provider);
      const expectedOptions = provider === "ollama"
        ? (domain === "analysis" ? ["gemma4:e2b"] : ["nomic-embed-text-v2-moe", "nomic-embed-text"])
        : provider === "mistral"
          ? (domain === "analysis" ? ["mistral-small-latest", "mistral-large-latest"] : ["mistral-embed"])
          : [];
      const catalog = host.getCatalog();

      expect(currentDevice(plugin)[providerKey]).toBe(provider);
      expect(currentDevice(plugin)[modelKey] ?? "").toBe(defaults.model);
      expect(catalog.controlType).toBe(provider === "openrouter" && domain === "analysis" ? "text" : "dropdown");
      const openRouterOptions = domain === "embeddings"
        ? ["openai/text-embedding-3-small", "__lina_custom_model__"]
        : ["__lina_custom_model__"];
      expect(catalog.options).toEqual(provider === "openrouter" ? openRouterOptions : [...expectedOptions, "__lina_custom_model__"]);
      expect(catalog.selected).toBe(provider === "openrouter" && domain === "analysis"
        ? "__lina_custom_model__"
        : defaults.model || "__lina_custom_model__");
      expect(catalog.textValue).toBe("");
    }
    tab.hide();
  });

  it.each(["openai", "gemini", "anthropic", "custom"] as const)("keeps legacy global %s configuration readable through Ollama defaults", (legacyProvider) => {
    const settings = {
      ...DEFAULT_SETTINGS,
      aiProfiles: [{
        id: "legacy-profile",
        name: "Legacy",
        provider: legacyProvider,
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
        requestTimeoutSeconds: 45,
      }],
    } as unknown as LinaSettings;

    expect(normalizeSupportedProvider(legacyProvider)).toBe("ollama");
    expect(normalizeAiProfiles(settings)).toEqual([expect.objectContaining({
      id: "legacy-profile",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "gemma4:e2b",
    })]);
    expect(settings.aiProfiles[0]?.provider).toBe(legacyProvider);
  });

  it.each([
    ["analysis", "ollama", false],
    ["analysis", "mistral", true],
    ["analysis", "openrouter", true],
    ["embeddings", "ollama", false],
    ["embeddings", "mistral", true],
    ["embeddings", "openrouter", true],
  ] as const)("keeps %s credentials visible only when %s requires them", (domain, provider, expectedVisible) => {
    const key = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
    const id = domain === "analysis" ? "analysis-credential" : "embeddings-credential";
    const { tab } = createTab({ [key]: provider });
    const visible = activeDefinition(tab, id).visible;

    expect(typeof visible === "function" ? visible() : visible).toBe(expectedVisible);
    tab.hide();
  });

  it.each([
    ["analysis", "openrouter", "analysisProvider", "analysisModel", "analysisBaseUrl"],
    ["embeddings", "openrouter", "embeddingsProvider", "embeddingsModel", "embeddingsBaseUrl"],
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
    const refreshConfiguration = vi.spyOn(plugin, "refreshEmbeddingConfigurationState").mockResolvedValue({ status: "ready", revision: 0 });

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
    expect(refreshConfiguration).toHaveBeenCalledTimes(domain === "embeddings" ? 1 : 0);
    tab.hide();
  });

  it.each([
    ["custom-model", "http://localhost:11434", "custom-model", "https://openrouter.ai/api/v1"],
    ["gemma4:e2b", "https://custom.example/v1", "", "https://custom.example/v1"],
    ["custom-model", "https://custom.example/v1", "custom-model", "https://custom.example/v1"],
  ])("preserves only genuinely custom analysis values", async (model, baseUrl, expectedModel, expectedBaseUrl) => {
    const { plugin, tab } = createTab({ analysisModel: model, analysisBaseUrl: baseUrl });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();

    await captureProviderChange(tab, "analysis").change("openrouter");

    expect(currentDevice(plugin)).toMatchObject({
      analysisProvider: "openrouter",
      analysisBaseUrl: expectedBaseUrl,
    });
    expect(currentDevice(plugin).analysisModel ?? "").toBe(expectedModel);
    expect(save).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it("refreshes the active embedding Base URL placeholder from the final provider tuple", async () => {
    const { plugin, tab } = createTab({
      embeddingsProvider: "mistral",
      embeddingsModel: "mistral-embed",
      embeddingsBaseUrl: "https://api.mistral.ai/v1",
    });
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();

    expect(activeControlPlaceholder(tab, "embeddings-base-url")).toBe("https://api.mistral.ai/v1");
    await captureProviderChange(tab, "embeddings").change("openrouter");

    expect(tab.getControlValue("embeddingsBaseUrl")).toBe("https://openrouter.ai/api/v1");
    expect(activeControlPlaceholder(tab, "embeddings-base-url")).toBe("https://openrouter.ai/api/v1");
    tab.hide();
  });

  it("preserves an explicit embedding proxy URL while normalizing the foreign known model", async () => {
    const { plugin, tab } = createTab({
      embeddingsProvider: "mistral",
      embeddingsModel: "mistral-embed",
      embeddingsBaseUrl: "https://my-proxy.internal/v1",
    });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();

    await captureProviderChange(tab, "embeddings").change("openrouter");

    expect(currentDevice(plugin)).toMatchObject({
      embeddingsProvider: "openrouter",
      embeddingsModel: "openai/text-embedding-3-small",
      embeddingsBaseUrl: "https://my-proxy.internal/v1",
    });
    expect(save).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it("repairs a historical OpenRouter tuple with Mistral model and normalized URL in one final identity refresh", async () => {
    const { plugin, tab } = createTab({
      embeddingsProvider: "openrouter",
      embeddingsModel: "mistral-embed",
      embeddingsBaseUrl: "https://api.mistral.ai/v1/embeddings",
    });
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const refreshConfiguration = vi.spyOn(plugin, "refreshEmbeddingConfigurationState")
      .mockResolvedValue({ status: "ready", revision: 1 });
    const generation = vi.spyOn(plugin, "requestEmbeddingIndexGeneration");

    expect(activeControlPlaceholder(tab, "embeddings-base-url")).toBe("https://openrouter.ai/api/v1");
    await captureProviderChange(tab, "embeddings").change("openrouter");

    expect(currentDevice(plugin)).toMatchObject({
      embeddingsProvider: "openrouter",
      embeddingsModel: "openai/text-embedding-3-small",
      embeddingsBaseUrl: "https://openrouter.ai/api/v1",
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(refreshConfiguration).toHaveBeenCalledTimes(1);
    expect(generation).not.toHaveBeenCalled();
    tab.hide();
  });

  it("rolls back provider, model, and Base URL together without running effects", async () => {
    const { plugin, tab } = createTab();
    vi.spyOn(plugin, "saveSettings").mockRejectedValue(new Error("save failed"));
    const refreshConfiguration = vi.spyOn(plugin, "refreshEmbeddingConfigurationState").mockResolvedValue({ status: "ready", revision: 0 });
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);

    await captureProviderChange(tab, "embeddings").change("mistral");

    expect(currentDevice(plugin)).toMatchObject({
      embeddingsProvider: "ollama",
      embeddingsModel: "nomic-embed-text-v2-moe",
      embeddingsBaseUrl: "http://localhost:11434",
    });
    expect(refreshConfiguration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    tab.hide();
  });

  it("orders the embedding effect and rerender after the single confirmed save", async () => {
    const { plugin, tab } = createTab();
    const events: string[] = [];
    vi.spyOn(plugin, "saveSettings").mockImplementation(async () => { events.push("save"); });
    vi.spyOn(plugin, "refreshEmbeddingConfigurationState").mockImplementation(async () => { events.push("effect"); return { status: "ready", revision: 0 }; });
    vi.spyOn(tab, "update").mockImplementation(() => { events.push("update"); });

    await captureProviderChange(tab, "embeddings").change("mistral");
    await Promise.resolve();

    expect(events).toEqual(["save", "effect", "update"]);
    tab.hide();
  });

  it("refreshes local embedding compatibility for a model change without starting a generation", async () => {
    const { plugin, tab } = createTab();
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const refreshConfiguration = vi.spyOn(plugin, "refreshEmbeddingConfigurationState")
      .mockResolvedValue({ status: "ready", revision: 1 });
    const schedulerDirty = vi.spyOn(plugin, "markEmbeddingWorkStatusDirty");
    const generation = vi.spyOn(plugin, "requestEmbeddingIndexGeneration");

    await captureModelControls(tab, "embeddings").changeDropdown("nomic-embed-text");

    expect(refreshConfiguration).toHaveBeenCalledTimes(1);
    expect(schedulerDirty).not.toHaveBeenCalled();
    expect(generation).not.toHaveBeenCalled();
    tab.hide();
  });

  it("does not refresh compatibility or save when the provider/model identity is unchanged", async () => {
    const { plugin, tab } = createTab();
    const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const refreshConfiguration = vi.spyOn(plugin, "refreshEmbeddingConfigurationState");

    await captureProviderChange(tab, "embeddings").change("ollama");

    expect(save).not.toHaveBeenCalled();
    expect(refreshConfiguration).not.toHaveBeenCalled();
    tab.hide();
  });

  it("does not let a failed earlier transition roll back a later confirmed transition", async () => {
    const { plugin, tab } = createTab();
    const save = vi.spyOn(plugin, "saveSettings")
      .mockRejectedValueOnce(new Error("first save failed"))
      .mockResolvedValueOnce();
    const refreshConfiguration = vi.spyOn(plugin, "refreshEmbeddingConfigurationState").mockResolvedValue({ status: "ready", revision: 0 });
    const provider = captureProviderChange(tab, "embeddings");

    const failed = provider.change("mistral");
    const confirmed = provider.change("openrouter");
    await Promise.all([failed, confirmed]);

    expect(currentDevice(plugin)).toMatchObject({
      embeddingsProvider: "openrouter",
      embeddingsBaseUrl: "https://openrouter.ai/api/v1",
    });
    expect(currentDevice(plugin).embeddingsModel ?? "").toBe("openai/text-embedding-3-small");
    expect(save).toHaveBeenCalledTimes(2);
    expect(refreshConfiguration).toHaveBeenCalledTimes(1);
    tab.hide();
  });

  it("exposes one centralized default matrix for every supported provider and domain", () => {
    const expected = {
      ollama: ["gemma4:e2b", "nomic-embed-text-v2-moe", "http://localhost:11434"],
      mistral: ["mistral-small-latest", "mistral-embed", "https://api.mistral.ai/v1"],
      openrouter: ["", "openai/text-embedding-3-small", "https://openrouter.ai/api/v1"],
    } as const;

    expect(getPureLocalProviderOptions("analysis").map(({ value }) => value)).toEqual(["ollama", "mistral"]);
    expect(getPureLocalProviderOptions("embedding").map(({ value }) => value)).toEqual(Object.keys(expected));
    for (const [provider, [analysisModel, embeddingModel, baseUrl]] of Object.entries(expected)) {
      expect(getAnalysisProviderDefaults(provider)).toEqual({ model: analysisModel, baseUrl });
      expect(getEmbeddingProviderDefaults(provider)).toEqual({ model: embeddingModel, baseUrl });
    }
  });

  it.each([
    ["analysis", "openai", "analysisProvider", "analysisModel", "analysisBaseUrl"],
    ["analysis", "gemini", "analysisProvider", "analysisModel", "analysisBaseUrl"],
    ["analysis", "anthropic", "analysisProvider", "analysisModel", "analysisBaseUrl"],
    ["analysis", "custom", "analysisProvider", "analysisModel", "analysisBaseUrl"],
    ["embeddings", "openai", "embeddingsProvider", "embeddingsModel", "embeddingsBaseUrl"],
    ["embeddings", "gemini", "embeddingsProvider", "embeddingsModel", "embeddingsBaseUrl"],
    ["embeddings", "anthropic", "embeddingsProvider", "embeddingsModel", "embeddingsBaseUrl"],
    ["embeddings", "custom", "embeddingsProvider", "embeddingsModel", "embeddingsBaseUrl"],
  ] as const)("reads legacy %s provider %s as Ollama without persisting a migration", (
    domain,
    legacyProvider,
    providerKey,
    modelKey,
    baseUrlKey,
  ) => {
    const { plugin, tab } = createTab({
      [providerKey]: legacyProvider,
      [modelKey]: "legacy-model",
      [baseUrlKey]: "https://legacy.example/v1",
    });
    const save = vi.spyOn(plugin, "saveSettings");
    const defaults = domain === "analysis"
      ? getAnalysisProviderDefaults("ollama")
      : getEmbeddingProviderDefaults("ollama");

    expect(captureProviderChange(tab, domain).selected).toBe("ollama");
    expect(captureModelValue(tab, domain)).toBe(defaults.model);
    expect(tab.getControlValue(baseUrlKey)).toBe(defaults.baseUrl);
    expect(currentDevice(plugin)[providerKey]).toBe(legacyProvider);
    expect(save).not.toHaveBeenCalled();
    tab.hide();
  });
});
