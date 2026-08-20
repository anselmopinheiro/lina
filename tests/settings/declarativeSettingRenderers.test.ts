import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  clampDetachedWeight,
  createDeclarativeSettingsButtonRenderer,
  createDetachedAnalysisModelRenderer,
  createDetachedAnalysisProviderRenderer,
  createDetachedAnalysisTimeoutRenderer,
  createDetachedAutoUpdateIndexRenderer,
  createDetachedBinaryPreferenceRenderer,
  createDetachedConfigNoteRenderer,
  createDetachedEmbeddingsModelRenderer,
  createDetachedEmbeddingsProviderRenderer,
  createDetachedEmbeddingsBatchSizeRenderer,
  createDetachedEmbeddingsTimeoutRenderer,
  createDetachedInformationalSettingDefinitions,
  createDetachedInboxFolderRenderer,
  createDetachedInboxMaxNotesRenderer,
  createDetachedInteractiveSettingDefinitions,
  createDetachedIndexYamlSettingDefinitions,
  createDetachedInterfaceLanguageRenderer,
  createDetachedMaxSuggestedTagsRenderer,
  createDetachedMaintainBinaryCopyRenderer,
  createDetachedNumericBinarySettingDefinitions,
  createDetachedProviderModelSettingDefinitions,
  createDetachedSemanticWeightRenderer,
  createDetachedTextWeightRenderer,
  createSupportActionRenderer,
  createSupportEmailRenderer,
  SUPPORT_EMAIL_ADDRESS,
  SUPPORT_EMAIL_URL,
  SUPPORT_FORM_URL,
  type DetachedGlobalKey,
  type DetachedGlobalReadValue,
  type DetachedGlobalValue,
  type DetachedLocalKey,
  type DetachedLocalValue,
  type DetachedSettingsPorts,
} from "../../src/settings/declarativeSettingRenderers";

type ElementCall = { tag: string; options: Record<string, unknown> };
type TextState = { placeholder?: string; value?: string; onChange?: (value: string) => Promise<void> };
type DropdownState = { options: Array<{ value: string; label: string }>; value?: string; onChange?: (value: string) => Promise<void> };
type ToggleState = { value?: boolean; onChange?: (value: boolean) => Promise<void> };

function createSettingDouble() {
  const calls: { name?: string; description?: string; elements: ElementCall[]; text?: TextState; dropdown?: DropdownState; toggle?: ToggleState; controlClearCount?: number } = { elements: [] };
  const text = {
    setPlaceholder(value: string) { (calls.text ??= {}).placeholder = value; return text; },
    setValue(value: string) { (calls.text ??= {}).value = value; return text; },
    onChange(callback: (value: string) => Promise<void>) { (calls.text ??= {}).onChange = callback; return text; },
  };
  const dropdown = {
    addOption(value: string, label: string) { (calls.dropdown ??= { options: [] }).options.push({ value, label }); return dropdown; },
    setValue(value: string) { (calls.dropdown ??= { options: [] }).value = value; return dropdown; },
    onChange(callback: (value: string) => Promise<void>) { (calls.dropdown ??= { options: [] }).onChange = callback; return dropdown; },
  };
  const toggle = {
    setValue(value: boolean) { (calls.toggle ??= {}).value = value; return toggle; },
    onChange(callback: (value: boolean) => Promise<void>) { (calls.toggle ??= {}).onChange = callback; return toggle; },
  };
  const setting = {
    setName(name: string) { calls.name = name; return setting; },
    setDesc(description: string) { calls.description = description; return setting; },
    addText(callback: (component: typeof text) => void) { callback(text); return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
    addToggle(callback: (component: typeof toggle) => void) { callback(toggle); return setting; },
    controlEl: {
      empty() {
        calls.controlClearCount = (calls.controlClearCount ?? 0) + 1;
        calls.dropdown = undefined;
        calls.text = undefined;
      },
    },
    descEl: {
      createSpan(options: Record<string, unknown>) { calls.elements.push({ tag: "span", options }); },
      createDiv(options: Record<string, unknown>) { calls.elements.push({ tag: "div", options }); },
      createEl(tag: string, options: Record<string, unknown>) { calls.elements.push({ tag, options }); },
    },
  };
  return { calls, setting };
}

function createButtonSettingDouble() {
  const calls: { name?: string; description?: string; elements: ElementCall[]; buttons: Array<{ label?: string; destructive?: boolean; disabled?: boolean; onClick?: () => void }> } = { elements: [], buttons: [] };
  const setting = {
    setName(value: string) { calls.name = value; return setting; },
    setDesc(value: string) { calls.description = value; return setting; },
    addButton(callback: (button: {
      setButtonText(value: string): unknown;
      setDestructive(): unknown;
      setDisabled(value: boolean): unknown;
      onClick(value: () => void): unknown;
    }) => void) {
      const button = {
        setButtonText(value: string) { calls.buttons.push({ label: value }); return button; },
        setDestructive() { calls.buttons.at(-1)!.destructive = true; return button; },
        setDisabled(value: boolean) { calls.buttons.at(-1)!.disabled = value; return button; },
        onClick(value: () => void) { calls.buttons.at(-1)!.onClick = value; return button; },
      };
      callback(button);
      return setting;
    },
    descEl: {
      createSpan(options: Record<string, unknown>) { calls.elements.push({ tag: "span", options }); },
      createDiv(options: Record<string, unknown>) { calls.elements.push({ tag: "div", options }); },
    },
  };
  return { calls, setting };
}

function createGroupDouble() {
  const manual = createSettingDouble();
  const elements: ElementCall[] = [];
  const group = {
    addSetting(callback: (setting: typeof manual.setting) => void) { callback(manual.setting); return group; },
    listEl: { createEl(tag: string, options: Record<string, unknown>) { elements.push({ tag, options }); } },
  };
  return { group, manual, elements };
}

function defaultLocalValues(): { [K in DetachedLocalKey]: DetachedLocalValue<K> } {
  return {
    deviceName: "", analysisProvider: "ollama", analysisModel: "gemma4:e2b", analysisBaseUrl: "http://localhost:11434", analysisTimeout: "60",
    embeddingsProvider: "ollama", embeddingsModel: "nomic-embed-text-v2-moe", embeddingsBaseUrl: "http://localhost:11434", embeddingsBatchSize: "10", embeddingsTimeout: "60",
    embeddingStorageReadPreference: "jsonl", maintainBinaryEmbeddingCopy: false,
  };
}

function createPorts(initial: { [K in DetachedGlobalKey]: DetachedGlobalReadValue<K> }, initialLocal = defaultLocalValues()) {
  const values = { ...initial };
  const localValues = { ...initialLocal };
  const writes: Array<{ key: DetachedGlobalKey; value: string | number }> = [];
  const localWrites: Array<{ key: DetachedLocalKey; value: string | boolean }> = [];
  const providerWrites: Array<{ domain: "analysis" | "embedding"; provider: string; model: string; baseUrl: string }> = [];
  const effects: Array<{ type: string; value?: string }> = [];
  let updateCount = 0;
  const ports: DetachedSettingsPorts = {
    getGlobal<K extends DetachedGlobalKey>(key: K): DetachedGlobalReadValue<K> {
      return values[key];
    },
    async setGlobal<K extends DetachedGlobalKey>(key: K, value: DetachedGlobalValue<K>, nextEffects = []): Promise<void> {
      values[key] = value;
      writes.push({ key, value });
      effects.push(...nextEffects);
    },
    getLocal<K extends DetachedLocalKey>(key: K): DetachedLocalValue<K> { return localValues[key]; },
    async setLocal<K extends DetachedLocalKey>(key: K, value: DetachedLocalValue<K>, nextEffects = []): Promise<void> {
      localValues[key] = value;
      localWrites.push({ key, value });
      effects.push(...nextEffects);
    },
    async setProvider(domain, provider, model, baseUrl, nextEffects = []): Promise<boolean> {
      const providerKey = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
      const modelKey = domain === "analysis" ? "analysisModel" : "embeddingsModel";
      const baseUrlKey = domain === "analysis" ? "analysisBaseUrl" : "embeddingsBaseUrl";
      localValues[providerKey] = provider;
      localValues[modelKey] = model;
      localValues[baseUrlKey] = baseUrl;
      providerWrites.push({ domain, provider, model, baseUrl });
      effects.push(...nextEffects);
      return true;
    },
    requestUpdate() { updateCount += 1; },
  };
  return { ports, writes, localWrites, providerWrites, effects, getUpdateCount: () => updateCount };
}

function defaultGlobalValues(): { [K in DetachedGlobalKey]: DetachedGlobalReadValue<K> } {
  return {
    inboxFolderPath: "00_Inbox",
    maxInboxNotesToAnalyze: 10,
    hybridSearchTextWeight: 0.7,
    hybridSearchSemanticWeight: 0.3,
    interfaceLanguage: "pt-PT",
    autoUpdateIndexOnFileChanges: false,
    maxSuggestedTags: 8,
  };
}

describe("detached declarative setting renderers", () => {
  it("preserves hybrid weight limits and fallbacks", () => { expect(clampDetachedWeight("-1", .7)).toBe(0); expect(clampDetachedWeight("2", .3)).toBe(1); expect(clampDetachedWeight("invalid", .7)).toBe(.7); });

  it("renders the config directory note in PT-PT, English, and fallback without a hardcoded directory", () => {
    for (const language of ["pt-PT", "en", "unknown"] as const) {
      const { calls, setting } = createSettingDouble();
      createDetachedConfigNoteRenderer(getStrings(language), ".obsidian-escola")(setting as never, {} as never);
      expect(calls.description).toContain(".obsidian-escola");
      expect(calls.description).not.toContain("{configDir}");
      expect(calls.elements).toEqual([]);
    }
    const source = createDetachedConfigNoteRenderer.toString();
    expect(source).not.toContain(".obsidian");
    expect(source).not.toContain("innerHTML");
  });

  it("renders support actions without opening URLs until their buttons are clicked", () => {
    const opened: string[] = [];
    const form = createButtonSettingDouble();
    const strings = getStrings("en");

    createSupportActionRenderer(
      strings.settingsSupportLink,
      strings.settingsSupportFormDescription,
      strings.settingsSupportFormButton,
      SUPPORT_FORM_URL,
      (url) => opened.push(url),
    )(form.setting as never, {} as never);
    expect(opened).toEqual([]);
    expect(form.calls).toEqual({
      name: "Support form",
      description: "Report a problem, ask for help, or send a suggestion.",
      elements: [],
      buttons: [{ label: "Open form", disabled: false, onClick: expect.any(Function) }],
    });
    form.calls.buttons[0]?.onClick?.();
    expect(opened).toEqual([SUPPORT_FORM_URL]);
  });

  it("shows and copies the support email only after an explicit click, then opens the exact mailto URL", async () => {
    const email = createButtonSettingDouble();
    const strings = getStrings("en");
    const copied: string[] = [];
    const opened: string[] = [];
    const notices: string[] = [];

    createSupportEmailRenderer(
      strings,
      (url) => opened.push(url),
      async (text) => { copied.push(text); },
      (message) => notices.push(message),
    )(email.setting as never, {} as never);

    expect(email.calls).toEqual({
      name: "Email support",
      description: "Contact support directly by email.",
      elements: [{ tag: "div", options: { text: SUPPORT_EMAIL_ADDRESS } }],
      buttons: [
        { label: "Copy email", disabled: false, onClick: expect.any(Function) },
        { label: "Send email", disabled: false, onClick: expect.any(Function) },
      ],
    });
    expect(copied).toEqual([]);
    expect(opened).toEqual([]);
    expect(notices).toEqual([]);
    expect(createSupportEmailRenderer.toString()).not.toContain("readText");

    email.calls.buttons[0]?.onClick?.();
    await Promise.resolve();
    expect(copied).toEqual([SUPPORT_EMAIL_ADDRESS]);
    expect(notices).toEqual(["Email address copied."]);
    expect(email.calls.elements).toEqual([{ tag: "div", options: { text: SUPPORT_EMAIL_ADDRESS } }]);

    email.calls.buttons[1]?.onClick?.();
    expect(opened).toEqual([SUPPORT_EMAIL_URL]);
  });

  it("renders executable declarative actions as one native button without duplicating the handler", () => {
    let runs = 0;
    const action = { run() { runs += 1; }, isDisabled() { return true; } };
    const { calls, setting } = createButtonSettingDouble();

    createDeclarativeSettingsButtonRenderer("Run action", action)(setting as never, {} as never);

    expect(calls).toEqual({
      name: "Run action",
      elements: [],
      buttons: [{ label: "Run action", disabled: true, onClick: expect.any(Function) }],
    });
    calls.buttons[0]?.onClick?.();
    expect(runs).toBe(1);
  });

  it("creates the disconnected config-note definition without controls or actions", () => {
    const definitions = createDetachedInformationalSettingDefinitions(getStrings("en"), ".obsidian-escola");
    expect(definitions).toHaveLength(1);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(1);
    expect(definitions.every((definition) => typeof definition.render === "function")).toBe(true);
    expect(definitions.every((definition) => !("control" in definition) && !("action" in definition))).toBe(true);
  });

  it("preserves the Inbox folder text control, trimming only on its asynchronous write", async () => {
    const { ports, writes, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedInboxFolderRenderer(getStrings("pt-PT"), ports)(setting as never, {} as never);
    expect(calls).toMatchObject({ name: getStrings("pt-PT").settingsInboxFolder, description: getStrings("pt-PT").settingsInboxFolderDesc, text: { placeholder: "00_Inbox", value: "00_Inbox" } });
    await calls.text?.onChange?.("  Projetos/Inbox  ");
    expect(writes).toEqual([{ key: "inboxFolderPath", value: "Projetos/Inbox" }]);
    expect(getUpdateCount()).toBe(0);
  });

  it("preserves the Inbox maximum as a bounded text control", async () => {
    const { ports, writes, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedInboxMaxNotesRenderer(getStrings("en"), ports)(setting as never, {} as never);
    expect(calls).toMatchObject({ name: getStrings("en").settingsInboxMaxNotes, description: getStrings("en").settingsInboxMaxNotesDesc, text: { placeholder: "10", value: "10" } });
    await calls.text?.onChange?.("0");
    await calls.text?.onChange?.("99");
    await calls.text?.onChange?.("invalid");
    expect(writes).toEqual([
      { key: "maxInboxNotesToAnalyze", value: 1 },
      { key: "maxInboxNotesToAnalyze", value: 20 },
      { key: "maxInboxNotesToAnalyze", value: 10 },
    ]);
    expect(calls.text?.value).toBe("10");
    expect(getUpdateCount()).toBe(0);
  });

  it("preserves independent hybrid text and semantic weights with their current fallbacks", async () => {
    const { ports, writes, getUpdateCount } = createPorts(defaultGlobalValues());
    const textSetting = createSettingDouble();
    const semanticSetting = createSettingDouble();
    createDetachedTextWeightRenderer(getStrings("pt-PT"), ports)(textSetting.setting as never, {} as never);
    createDetachedSemanticWeightRenderer(getStrings("pt-PT"), ports)(semanticSetting.setting as never, {} as never);
    expect(textSetting.calls).toMatchObject({ name: getStrings("pt-PT").settingsTextWeight, description: getStrings("pt-PT").settingsTextWeightDesc, text: { placeholder: "0.7", value: "0.7" } });
    expect(semanticSetting.calls).toMatchObject({ name: getStrings("pt-PT").settingsSemanticWeight, description: getStrings("pt-PT").settingsSemanticWeightDesc, text: { placeholder: "0.3", value: "0.3" } });
    await textSetting.calls.text?.onChange?.("invalid");
    await semanticSetting.calls.text?.onChange?.("2");
    expect(writes).toEqual([
      { key: "hybridSearchTextWeight", value: 0.7 },
      { key: "hybridSearchSemanticWeight", value: 1 },
    ]);
    expect(textSetting.calls.text?.value).toBe("0.7");
    expect(semanticSetting.calls.text?.value).toBe("1");
    expect(getUpdateCount()).toBe(0);
  });

  it("preserves the interface-language dropdown order, fallback, write, and single update request", async () => {
    const initial = defaultGlobalValues();
    initial.interfaceLanguage = undefined;
    const { ports, writes, getUpdateCount } = createPorts(initial);
    const { calls, setting } = createSettingDouble();
    createDetachedInterfaceLanguageRenderer(getStrings("en"), ports)(setting as never, {} as never);
    expect(calls).toMatchObject({
      name: getStrings("en").settingsInterfaceLanguage,
      description: getStrings("en").settingsInterfaceLanguageDescription,
      dropdown: { options: [{ value: "pt-PT", label: getStrings("en").langPtPT }, { value: "en", label: getStrings("en").langEn }], value: "pt-PT" },
    });
    await calls.dropdown?.onChange?.("en");
    expect(writes).toEqual([{ key: "interfaceLanguage", value: "en" }]);
    expect(getUpdateCount()).toBe(1);
  });

  it("preserves automatic index updates with its save and listener-refresh effect only", async () => {
    const { ports, writes, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();

    createDetachedAutoUpdateIndexRenderer(getStrings("pt-PT"), ports)(setting as never, {} as never);
    expect(calls).toMatchObject({
      name: getStrings("pt-PT").settingsAutoUpdateIndex,
      description: getStrings("pt-PT").settingsAutoUpdateIndexDesc,
      toggle: { value: false },
    });

    await calls.toggle?.onChange?.(true);
    expect(writes).toEqual([{ key: "autoUpdateIndexOnFileChanges", value: true }]);
    expect(effects).toEqual([{ type: "update-vault-event-listeners" }]);
    expect(getUpdateCount()).toBe(0);
  });

  it("preserves the suggested-tag dropdown normalization without extra effects or updates", async () => {
    const initial = defaultGlobalValues();
    initial.maxSuggestedTags = 99;
    const { ports, writes, effects, getUpdateCount } = createPorts(initial);
    const { calls, setting } = createSettingDouble();

    createDetachedMaxSuggestedTagsRenderer(getStrings("en"), ports)(setting as never, {} as never);
    expect(calls).toMatchObject({
      name: getStrings("en").settingsMaxTags,
      description: getStrings("en").settingsMaxTagsDesc,
      dropdown: { value: "20" },
    });
    expect(calls.dropdown?.options.map(({ value }) => value)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(index + 1)),
    );

    await calls.dropdown?.onChange?.("1");
    await calls.dropdown?.onChange?.("invalid");
    expect(writes).toEqual([
      { key: "maxSuggestedTags", value: 1 },
      { key: "maxSuggestedTags", value: 8 },
    ]);
    expect(effects).toEqual([]);
    expect(getUpdateCount()).toBe(0);
  });

  it("keeps the two new definitions detached from the active settings implementation", () => {
    const { ports } = createPorts(defaultGlobalValues());
    const definitions = createDetachedIndexYamlSettingDefinitions(getStrings("pt-PT"), ports);

    expect(definitions.map(({ id }) => id)).toEqual([
      "auto-update-index-on-file-changes",
      "max-suggested-tags",
    ]);
    expect(definitions.every((definition) => typeof definition.render === "function" && !("control" in definition) && !("action" in definition))).toBe(true);

    const activeSettingsSource = readFileSync(resolve(process.cwd(), "src/settings.ts"), "utf8");
    const mainSource = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");
    expect(activeSettingsSource).not.toContain("createDetachedIndexYamlSettingDefinitions");
    expect(mainSource).not.toContain("createDetachedIndexYamlSettingDefinitions");
  });

  it("creates five additional disconnected render definitions without controls or actions", () => {
    const { ports } = createPorts(defaultGlobalValues());
    const definitions = createDetachedInteractiveSettingDefinitions(getStrings("en"), ports);
    expect(definitions).toHaveLength(5);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(5);
    expect(definitions.every((definition) => typeof definition.render === "function")).toBe(true);
    expect(definitions.every((definition) => !("control" in definition) && !("action" in definition))).toBe(true);
  });

  it("renders the analysis provider in catalog order and applies only its ordered effects", async () => {
    const { ports, providerWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedAnalysisProviderRenderer(getStrings("en"), ports)(setting as never, {} as never);
    expect(calls.dropdown).toMatchObject({ value: "ollama", options: [
      { value: "ollama", label: "Ollama" }, { value: "mistral", label: "Mistral" },
      { value: "openrouter", label: "OpenRouter" },
    ] });
    await calls.dropdown?.onChange?.("mistral");
    expect(providerWrites).toEqual([{
      domain: "analysis",
      provider: "mistral",
      model: "mistral-small-latest",
      baseUrl: "https://api.mistral.ai/v1",
    }]);
    expect(effects).toEqual([{ type: "refresh-model-options" }]);
    expect(getUpdateCount()).toBe(1);
  });

  it("renders the embeddings provider and leaves identity invalidation to the runtime mutation boundary", async () => {
    const { ports, providerWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedEmbeddingsProviderRenderer(getStrings("pt-PT"), ports)(setting as never, {} as never);
    await calls.dropdown?.onChange?.("mistral");
    expect(providerWrites).toEqual([{
      domain: "embedding",
      provider: "mistral",
      model: "mistral-embed",
      baseUrl: "https://api.mistral.ai/v1",
    }]);
    expect(effects).toEqual([{ type: "refresh-model-options" }]);
    expect(getUpdateCount()).toBe(1);
  });

  it("renders the analysis catalog as one dropdown", async () => {
    const local = defaultLocalValues();
    local.analysisProvider = "mistral";
    local.analysisModel = "mistral-small-latest";
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues(), local);
    const primary = createSettingDouble();
    const { group, manual } = createGroupDouble();
    createDetachedAnalysisModelRenderer(getStrings("en"), ports)(primary.setting as never, group as never);
    expect(primary.calls).toMatchObject({ name: getStrings("en").settingsModel, description: getStrings("en").settingsModelCatalogDesc, dropdown: { value: "mistral-small-latest", options: [{ value: "mistral-small-latest", label: "Mistral Small (mistral-small-latest)" }, { value: "mistral-large-latest", label: "Mistral Large (mistral-large-latest)" }, { value: "__lina_custom_model__", label: getStrings("en").settingsCustomModelOption }] } });
    expect(manual.calls).toEqual({ elements: [] });
    await primary.calls.dropdown?.onChange?.("mistral-large-latest");
    expect(localWrites).toEqual([{ key: "analysisModel", value: "mistral-large-latest" }]);
    expect(effects).toEqual([]);
    expect(getUpdateCount()).toBe(0);

    const outsideLocal = defaultLocalValues();
    outsideLocal.analysisProvider = "mistral";
    outsideLocal.analysisModel = "outside-the-catalog";
    const outside = createPorts(defaultGlobalValues(), outsideLocal);
    const outsidePrimary = createSettingDouble();
    const outsideGroup = createGroupDouble();
    createDetachedAnalysisModelRenderer(getStrings("en"), outside.ports)(outsidePrimary.setting as never, outsideGroup.group as never);
    expect(outsidePrimary.calls.dropdown?.value).toBe("__lina_custom_model__");
    expect(outsidePrimary.calls.text).toMatchObject({
      placeholder: "gemma4:e2b",
      value: "outside-the-catalog",
    });
  });

  it("keeps the embeddings model catalog and leaves invalidation to the runtime mutation boundary", async () => {
    const local = defaultLocalValues();
    local.embeddingsModel = "";
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues(), local);
    const primary = createSettingDouble();
    const { group, manual, elements } = createGroupDouble();
    createDetachedEmbeddingsModelRenderer(getStrings("pt-PT"), ports)(primary.setting as never, group as never);
    expect(primary.calls.dropdown?.value).toBe("nomic-embed-text-v2-moe");
    expect(primary.calls.dropdown?.options.map(({ value }) => value)).toEqual(["nomic-embed-text-v2-moe", "nomic-embed-text", "__lina_custom_model__"]);
    expect(manual.calls).toEqual({ elements: [] });
    await primary.calls.dropdown?.onChange?.("nomic-embed-text");
    expect(localWrites).toEqual([{ key: "embeddingsModel", value: "nomic-embed-text" }]);
    expect(effects).toEqual([]);
    expect(elements).toEqual([{ tag: "p", options: { text: getStrings("pt-PT").settingsEmbeddingModelChangeWarning, attr: { style: "font-size: 0.85em; color: var(--text-muted); margin-top: -4px;" } } }]);
    expect(getUpdateCount()).toBe(0);
  });

  it("clears and rebuilds exactly one provider-scoped embedding model control on the same Setting row", async () => {
    const local = defaultLocalValues();
    const { ports } = createPorts(defaultGlobalValues(), local);
    const primary = createSettingDouble();
    const { group } = createGroupDouble();
    const render = createDetachedEmbeddingsModelRenderer(getStrings("en"), ports);

    render(primary.setting as never, group as never);
    expect(primary.calls.controlClearCount).toBe(1);
    expect(primary.calls.dropdown?.options.map(({ value }) => value)).toEqual([
      "nomic-embed-text-v2-moe", "nomic-embed-text", "__lina_custom_model__",
    ]);

    const provider = createSettingDouble();
    createDetachedEmbeddingsProviderRenderer(getStrings("en"), ports)(provider.setting as never, group as never);
    await provider.calls.dropdown?.onChange?.("openrouter");
    render(primary.setting as never, group as never);

    expect(primary.calls.controlClearCount).toBe(2);
    expect(primary.calls.dropdown?.options.map(({ value }) => value)).toEqual([
      "openai/text-embedding-3-small", "__lina_custom_model__",
    ]);
    expect(primary.calls.text).toBeUndefined();
  });

  it.each(["analysis", "embeddings"] as const)("renders OpenRouter %s custom models through the provider-scoped catalog", async (domain) => {
    const local = defaultLocalValues();
    const providerKey = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
    const modelKey = domain === "analysis" ? "analysisModel" : "embeddingsModel";
    local[providerKey] = "openrouter";
    local[modelKey] = "openrouter/custom-model";
    const { ports, localWrites, effects } = createPorts(defaultGlobalValues(), local);
    const primary = createSettingDouble();
    const { group, manual } = createGroupDouble();
    const renderer = domain === "analysis" ? createDetachedAnalysisModelRenderer : createDetachedEmbeddingsModelRenderer;

    renderer(getStrings("en"), ports)(primary.setting as never, group as never);

    expect(primary.calls).toMatchObject({ name: getStrings("en").settingsModel, text: { value: "openrouter/custom-model" } });
    expect(primary.calls.dropdown?.options.map(({ value }) => value)).toEqual(domain === "analysis"
      ? ["__lina_custom_model__"]
      : ["openai/text-embedding-3-small", "__lina_custom_model__"]);
    expect(primary.calls.dropdown?.value).toBe("__lina_custom_model__");
    expect(manual.calls).toEqual({ elements: [] });
    await primary.calls.text?.onChange?.("openrouter/next-model");
    expect(localWrites).toEqual([{ key: modelKey, value: "openrouter/next-model" }]);
    expect(effects).toEqual([]);
  });

  it("creates the four provider/model definitions without active-tab controls or actions", () => {
    const { ports } = createPorts(defaultGlobalValues());
    const definitions = createDetachedProviderModelSettingDefinitions(getStrings("pt-PT"), ports);
    expect(definitions.map(({ id }) => id)).toEqual(["analysis-provider", "analysis-model", "embeddings-provider", "embeddings-model"]);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(4);
    expect(definitions.every((definition) => typeof definition.render === "function")).toBe(true);
    expect(definitions.every((definition) => !("control" in definition) && !("action" in definition))).toBe(true);
  });

  it("normalizes analysis and embeddings timeouts with the existing 10–300 limits", async () => {
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const analysis = createSettingDouble();
    const embedding = createSettingDouble();
    createDetachedAnalysisTimeoutRenderer(getStrings("en"), ports)(analysis.setting as never, {} as never);
    createDetachedEmbeddingsTimeoutRenderer(getStrings("en"), ports)(embedding.setting as never, {} as never);
    expect(analysis.calls.text).toMatchObject({ placeholder: "60", value: "60" });
    expect(embedding.calls.text).toMatchObject({ placeholder: "60", value: "60" });
    await analysis.calls.text?.onChange?.("60");
    await analysis.calls.text?.onChange?.("9");
    await analysis.calls.text?.onChange?.("301");
    await analysis.calls.text?.onChange?.("invalid");
    await embedding.calls.text?.onChange?.("10");
    expect(localWrites).toEqual([
      { key: "analysisTimeout", value: "60" }, { key: "analysisTimeout", value: "10" }, { key: "analysisTimeout", value: "300" }, { key: "analysisTimeout", value: "60" },
      { key: "embeddingsTimeout", value: "10" },
    ]);
    expect(analysis.calls.text?.value).toBe("60");
    expect(embedding.calls.text?.value).toBe("10");
    expect(effects).toEqual([]);
    expect(getUpdateCount()).toBe(0);
  });

  it("normalizes the embedding batch size with the existing 1–50 limits", async () => {
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedEmbeddingsBatchSizeRenderer(getStrings("pt-PT"), ports)(setting as never, {} as never);
    expect(calls).toMatchObject({ name: getStrings("pt-PT").settingsBatchSize, description: getStrings("pt-PT").settingsBatchSizeDesc, text: { placeholder: "10", value: "10" } });
    for (const value of ["1", "50", "0", "51", "invalid"]) await calls.text?.onChange?.(value);
    expect(localWrites).toEqual([
      { key: "embeddingsBatchSize", value: "1" }, { key: "embeddingsBatchSize", value: "50" }, { key: "embeddingsBatchSize", value: "1" }, { key: "embeddingsBatchSize", value: "50" }, { key: "embeddingsBatchSize", value: "10" },
    ]);
    expect(calls.text?.value).toBe("10");
    expect(effects).toEqual([]);
    expect(getUpdateCount()).toBe(0);
  });

  it("preserves binary preference options, invalidation, and one update without I/O", async () => {
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedBinaryPreferenceRenderer(getStrings("en"), ports)(setting as never, {} as never);
    expect(calls.dropdown).toMatchObject({ value: "jsonl", options: [{ value: "jsonl", label: "JSONL" }, { value: "prefer-binary", label: getStrings("en").settingsBinaryPrefer }] });
    await calls.dropdown?.onChange?.("prefer-binary");
    expect(localWrites).toEqual([{ key: "embeddingStorageReadPreference", value: "prefer-binary" }]);
    expect(effects).toEqual([{ type: "invalidate-runtime-embedding-index" }]);
    expect(getUpdateCount()).toBe(1);
  });

  it("preserves the maintain-binary-copy toggle with a local write and one update", async () => {
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedMaintainBinaryCopyRenderer(getStrings("pt-PT"), ports)(setting as never, {} as never);
    expect(calls).toMatchObject({ name: getStrings("pt-PT").settingsBinaryMaintain, description: getStrings("pt-PT").settingsBinaryMaintainDesc, toggle: { value: false } });
    await calls.toggle?.onChange?.(true);
    expect(localWrites).toEqual([{ key: "maintainBinaryEmbeddingCopy", value: true }]);
    expect(effects).toEqual([]);
    expect(getUpdateCount()).toBe(1);
  });

  it("creates the five numeric/binary definitions without controls or actions", () => {
    const { ports } = createPorts(defaultGlobalValues());
    const definitions = createDetachedNumericBinarySettingDefinitions(getStrings("en"), ports);
    expect(definitions.map(({ id }) => id)).toEqual(["analysis-timeout", "embeddings-timeout", "embeddings-batch-size", "binary-preference", "maintain-binary-copy"]);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(5);
    expect(definitions.every((definition) => typeof definition.render === "function")).toBe(true);
    expect(definitions.every((definition) => !("control" in definition) && !("action" in definition))).toBe(true);
  });

});
