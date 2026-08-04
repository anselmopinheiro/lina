import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  clampDetachedWeight,
  createDetachedAnalysisModelRenderer,
  createDetachedAnalysisProviderRenderer,
  createDetachedAnalysisTimeoutRenderer,
  createDetachedBinaryPreferenceRenderer,
  createDetachedBinarySettingDefinitions,
  createDetachedConfigNoteRenderer,
  createDetachedConnectionTestSettingDefinitions,
  createDetachedEmbeddingsModelRenderer,
  createDetachedEmbeddingsProviderRenderer,
  createDetachedEmbeddingsBatchSizeRenderer,
  createDetachedEmbeddingsTimeoutRenderer,
  createDetachedInformationalSettingDefinitions,
  createDetachedInboxFolderRenderer,
  createDetachedInboxMaxNotesRenderer,
  createDetachedInteractiveSettingDefinitions,
  createDetachedInterfaceLanguageRenderer,
  createDetachedMaintainBinaryCopyRenderer,
  createDetachedNumericBinarySettingDefinitions,
  createDetachedProviderModelSettingDefinitions,
  createDetachedSemanticWeightRenderer,
  createDetachedSupportLinkRenderer,
  createDetachedTextWeightRenderer,
  type DetachedGlobalKey,
  type DetachedGlobalReadValue,
  type DetachedGlobalValue,
  type DetachedConnectionTestPorts,
  type DetachedBinaryActionPorts,
  type DetachedLocalKey,
  type DetachedLocalValue,
  type DetachedSettingsPorts,
} from "../../src/settings/declarativeSettingRenderers";
import type { PureBinaryResult, PureBinaryRuntimeInput, PureConnectionTestInput, PureConnectionTestResult } from "../../src/settings/pureSettingsAsyncActions";

type ElementCall = { tag: string; options: Record<string, unknown> };
type TextState = { placeholder?: string; value?: string; onChange?: (value: string) => Promise<void> };
type DropdownState = { options: Array<{ value: string; label: string }>; value?: string; onChange?: (value: string) => Promise<void> };
type ToggleState = { value?: boolean; onChange?: (value: boolean) => Promise<void> };

function createSettingDouble() {
  const calls: { name?: string; description?: string; elements: ElementCall[]; text?: TextState; dropdown?: DropdownState; toggle?: ToggleState } = { elements: [] };
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
    descEl: {
      createSpan(options: Record<string, unknown>) { calls.elements.push({ tag: "span", options }); },
      createEl(tag: string, options: Record<string, unknown>) { calls.elements.push({ tag, options }); },
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
  const effects: Array<{ type: string; value?: string }> = [];
  let updateCount = 0;
  const ports: DetachedSettingsPorts = {
    getGlobal<K extends DetachedGlobalKey>(key: K): DetachedGlobalReadValue<K> {
      return values[key];
    },
    async setGlobal<K extends DetachedGlobalKey>(key: K, value: DetachedGlobalValue<K>): Promise<void> {
      values[key] = value;
      writes.push({ key, value });
    },
    getLocal<K extends DetachedLocalKey>(key: K): DetachedLocalValue<K> { return localValues[key]; },
    async setLocal<K extends DetachedLocalKey>(key: K, value: DetachedLocalValue<K>): Promise<void> {
      localValues[key] = value;
      localWrites.push({ key, value });
    },
    async applyEffect(effect) { effects.push(effect); },
    requestUpdate() { updateCount += 1; },
  };
  return { ports, writes, localWrites, effects, getUpdateCount: () => updateCount };
}

function defaultGlobalValues(): { [K in DetachedGlobalKey]: DetachedGlobalReadValue<K> } {
  return {
    inboxFolderPath: "00_Inbox",
    maxInboxNotesToAnalyze: 10,
    hybridSearchTextWeight: 0.7,
    hybridSearchSemanticWeight: 0.3,
    interfaceLanguage: "pt-PT",
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createConnectionTestPorts() {
  const analysis = deferred<PureConnectionTestResult>();
  const embedding = deferred<PureConnectionTestResult>();
  const inputs: Array<{ actionId: string; input: PureConnectionTestInput }> = [];
  let updateCount = 0;
  const analysisInput: PureConnectionTestInput = { provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-small-latest", credentialAvailable: true, timeout: "60" };
  const embeddingsInput: PureConnectionTestInput = { provider: "ollama", baseUrl: "http://localhost:11434", model: "nomic-embed-text", credentialAvailable: false, timeout: "60" };
  const ports: DetachedConnectionTestPorts = {
    getConnectionInput(actionId) { return actionId === "test-analysis-connection" ? analysisInput : embeddingsInput; },
    testAnalysisConnection(input) { inputs.push({ actionId: "analysis", input }); return analysis.promise; },
    testEmbeddingsConnection(input) { inputs.push({ actionId: "embeddings", input }); return embedding.promise; },
    requestUpdate() { updateCount += 1; },
  };
  return { ports, analysis, embedding, inputs, getUpdateCount: () => updateCount };
}

function createBinaryActionPorts() {
  const check = deferred<PureBinaryResult>();
  const create = deferred<PureBinaryResult>();
  const remove = deferred<void>();
  const confirmation = deferred<boolean>();
  const calls: string[] = [];
  const confirmations: unknown[] = [];
  let updateCount = 0;
  let input: PureBinaryRuntimeInput = { legacyManifest: false };
  const ports: DetachedBinaryActionPorts = {
    getBinaryInput() { return input; },
    checkBinaryCopy() { calls.push("check"); return check.promise; },
    createOrUpdateBinaryCopy() { calls.push("create"); return create.promise; },
    removeBinaryCopy() { calls.push("remove"); return remove.promise; },
    requestConfirmation(request) { confirmations.push(request); return confirmation.promise; },
    requestUpdate() { updateCount += 1; },
  };
  return { ports, check, create, remove, confirmation, calls, confirmations, setInput: (next: PureBinaryRuntimeInput) => { input = next; }, getUpdateCount: () => updateCount };
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

  it("renders the existing support link with its safe DOM structure and no outbound work", () => {
    const { calls, setting } = createSettingDouble();
    const fetchCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => { fetchCalls.push(args); return Promise.resolve(new Response()); }) as typeof fetch;
    try {
      createDetachedSupportLinkRenderer(getStrings("pt-PT"))(setting as never, {} as never);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls.name).toBe(getStrings("pt-PT").settingsSupportLink);
    expect(calls.elements).toEqual([
      { tag: "span", options: { text: `${getStrings("pt-PT").settingsSupportLink}: ` } },
      { tag: "a", options: { href: "https://www.buymeacoffee.com/apinheiro", text: "Buy Me a Coffee", attr: { target: "_blank", rel: "noopener noreferrer" } } },
    ]);
    expect(fetchCalls).toEqual([]);
    expect(createDetachedSupportLinkRenderer.toString()).not.toContain("innerHTML");
  });

  it("creates exactly two disconnected render definitions without controls or actions", () => {
    const definitions = createDetachedInformationalSettingDefinitions(getStrings("en"), ".obsidian-escola");
    expect(definitions).toHaveLength(2);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(2);
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

  it("creates five additional disconnected render definitions without controls or actions", () => {
    const { ports } = createPorts(defaultGlobalValues());
    const definitions = createDetachedInteractiveSettingDefinitions(getStrings("en"), ports);
    expect(definitions).toHaveLength(5);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(5);
    expect(definitions.every((definition) => typeof definition.render === "function")).toBe(true);
    expect(definitions.every((definition) => !("control" in definition) && !("action" in definition))).toBe(true);
  });

  it("renders the analysis provider in catalog order and applies only its ordered effects", async () => {
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedAnalysisProviderRenderer(getStrings("en"), ports)(setting as never, {} as never);
    expect(calls.dropdown).toMatchObject({ value: "ollama", options: [
      { value: "ollama", label: "Ollama" }, { value: "mistral", label: "Mistral" }, { value: "openrouter", label: "OpenRouter" },
      { value: "openai", label: "OpenAI" }, { value: "gemini", label: "Gemini" }, { value: "anthropic", label: "Anthropic" }, { value: "custom", label: "Outro / compatível" },
    ] });
    await calls.dropdown?.onChange?.("mistral");
    expect(localWrites).toEqual([{ key: "analysisProvider", value: "mistral" }]);
    expect(effects).toEqual([
      { type: "set-default-base-url", value: "https://api.mistral.ai/v1" },
      { type: "set-default-model", value: "mistral-small-latest" },
      { type: "refresh-model-options" },
    ]);
    expect(getUpdateCount()).toBe(1);
  });

  it("renders the embeddings provider and preserves dirty marking before default effects", async () => {
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues());
    const { calls, setting } = createSettingDouble();
    createDetachedEmbeddingsProviderRenderer(getStrings("pt-PT"), ports)(setting as never, {} as never);
    await calls.dropdown?.onChange?.("mistral");
    expect(localWrites).toEqual([{ key: "embeddingsProvider", value: "mistral" }]);
    expect(effects).toEqual([
      { type: "mark-embeddings-dirty" },
      { type: "set-default-base-url", value: "https://api.mistral.ai/v1" },
      { type: "set-default-model", value: "mistral-embed" },
      { type: "refresh-model-options" },
    ]);
    expect(getUpdateCount()).toBe(1);
  });

  it("keeps the analysis model catalog and manual control independent", async () => {
    const local = defaultLocalValues();
    local.analysisProvider = "mistral";
    local.analysisModel = "mistral-small-latest";
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues(), local);
    const primary = createSettingDouble();
    const { group, manual } = createGroupDouble();
    createDetachedAnalysisModelRenderer(getStrings("en"), ports)(primary.setting as never, group as never);
    expect(primary.calls).toMatchObject({ name: getStrings("en").settingsModel, description: getStrings("en").settingsModelCatalogDesc, dropdown: { value: "mistral-small-latest", options: [{ value: "mistral-small-latest", label: "Mistral Small (mistral-small-latest)" }, { value: "mistral-large-latest", label: "Mistral Large (mistral-large-latest)" }, { value: "__lina_custom_model__", label: getStrings("en").settingsCustomModelOption }] } });
    expect(manual.calls).toMatchObject({ name: getStrings("en").settingsManualModel, description: getStrings("en").settingsManualModelDesc, text: { placeholder: "gemma4:e2b", value: "mistral-small-latest" } });
    await primary.calls.dropdown?.onChange?.("mistral-large-latest");
    await manual.calls.text?.onChange?.("outside-the-catalog");
    expect(localWrites).toEqual([{ key: "analysisModel", value: "mistral-large-latest" }, { key: "analysisModel", value: "outside-the-catalog" }]);
    expect(manual.calls.text?.value).toBe("mistral-large-latest");
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
    expect(outsideGroup.manual.calls.text?.value).toBe("outside-the-catalog");
  });

  it("keeps the embeddings model catalog, empty fallback, manual value, and dirty effect", async () => {
    const local = defaultLocalValues();
    local.embeddingsModel = "";
    const { ports, localWrites, effects, getUpdateCount } = createPorts(defaultGlobalValues(), local);
    const primary = createSettingDouble();
    const { group, manual, elements } = createGroupDouble();
    createDetachedEmbeddingsModelRenderer(getStrings("pt-PT"), ports)(primary.setting as never, group as never);
    expect(primary.calls.dropdown?.value).toBe("nomic-embed-text-v2-moe");
    expect(primary.calls.dropdown?.options.map(({ value }) => value)).toEqual(["nomic-embed-text-v2-moe", "nomic-embed-text", "__lina_custom_model__"]);
    expect(manual.calls.text).toMatchObject({ placeholder: "nomic-embed-text-v2-moe", value: "nomic-embed-text-v2-moe" });
    await primary.calls.dropdown?.onChange?.("nomic-embed-text");
    await manual.calls.text?.onChange?.("custom-embedding-model");
    expect(localWrites).toEqual([{ key: "embeddingsModel", value: "nomic-embed-text" }, { key: "embeddingsModel", value: "custom-embedding-model" }]);
    expect(effects).toEqual([{ type: "mark-embeddings-dirty" }, { type: "mark-embeddings-dirty" }]);
    expect(elements).toEqual([{ tag: "p", options: { text: getStrings("pt-PT").settingsEmbeddingModelChangeWarning, attr: { style: "font-size: 0.85em; color: var(--text-muted); margin-top: -4px;" } } }]);
    expect(getUpdateCount()).toBe(0);
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

  it("creates four disconnected connection-test definitions with actions and feedback renders only", () => {
    const { ports } = createConnectionTestPorts();
    const definitions = createDetachedConnectionTestSettingDefinitions(getStrings("en"), ports);
    expect(definitions.map(({ id }) => id)).toEqual([
      "test-analysis-connection", "analysis-test-feedback", "test-embeddings-connection", "embeddings-test-feedback",
    ]);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(4);
    expect(definitions.filter((definition) => "action" in definition).every((definition) => typeof definition.action === "function" && !("render" in definition) && !("control" in definition))).toBe(true);
    expect(definitions.filter((definition) => "render" in definition).every((definition) => typeof definition.render === "function" && !("action" in definition) && !("control" in definition))).toBe(true);
  });

  it("runs the detached analysis action once, exposes pending feedback, and then success without a secret", async () => {
    const { ports, analysis, inputs, getUpdateCount } = createConnectionTestPorts();
    const definitions = createDetachedConnectionTestSettingDefinitions(getStrings("pt-PT"), ports);
    const action = definitions[0];
    const feedback = definitions[1];
    if (!("action" in action) || !("render" in feedback)) throw new Error("Expected declarative action and feedback definitions.");

    action.action({} as HTMLElement, 0);
    expect(inputs).toEqual([{ actionId: "analysis", input: { provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-small-latest", credentialAvailable: true, timeout: "60" } }]);
    expect(Object.keys(inputs[0].input)).toEqual(["provider", "baseUrl", "model", "credentialAvailable", "timeout"]);
    const pending = createSettingDouble();
    feedback.render(pending.setting as never, {} as never);
    expect(pending.calls.elements).toEqual([{ tag: "p", options: { text: getStrings("pt-PT").settingsTestingConnection, attr: { "aria-live": "polite" } } }]);

    analysis.resolve({ outcome: "success", messageKey: "connection-success" });
    await Promise.resolve();
    await Promise.resolve();
    const success = createSettingDouble();
    feedback.render(success.setting as never, {} as never);
    expect(success.calls.elements[0].options.text).toBe(getStrings("pt-PT").settingsConnectionSuccess);
    expect(getUpdateCount()).toBe(2);
  });

  it("keeps detached embedding feedback independent and shows its safe error result", async () => {
    const { ports, analysis, embedding, getUpdateCount } = createConnectionTestPorts();
    const definitions = createDetachedConnectionTestSettingDefinitions(getStrings("en"), ports);
    const analysisAction = definitions[0];
    const analysisFeedback = definitions[1];
    const embeddingAction = definitions[2];
    const embeddingFeedback = definitions[3];
    if (!("action" in analysisAction) || !("render" in analysisFeedback) || !("action" in embeddingAction) || !("render" in embeddingFeedback)) throw new Error("Expected declarative action and feedback definitions.");

    analysisAction.action({} as HTMLElement, 0);
    const embeddingIdle = createSettingDouble();
    embeddingFeedback.render(embeddingIdle.setting as never, {} as never);
    expect(embeddingIdle.calls.elements[0].options.text).toBe("");

    embeddingAction.action({} as HTMLElement, 0);
    embedding.resolve({ outcome: "failed", messageKey: "embeddings-api-key-missing" });
    await Promise.resolve();
    await Promise.resolve();
    const embeddingError = createSettingDouble();
    embeddingFeedback.render(embeddingError.setting as never, {} as never);
    expect(embeddingError.calls.elements[0].options.text).toBe(getStrings("en").settingsEmbeddingTestMistralApiKeyMissing);
    expect(embeddingError.calls.elements[0].options.attr).toEqual({ "aria-live": "polite" });
    expect(getUpdateCount()).toBe(3);
    expect(createDetachedConnectionTestSettingDefinitions.toString()).not.toContain("innerHTML");

    analysis.resolve({ outcome: "success", messageKey: "connection-success" });
  });

  it("creates detached binary status, actions, and feedback with no controls", () => {
    const { ports } = createBinaryActionPorts();
    const definitions = createDetachedBinarySettingDefinitions(getStrings("en"), ports);
    expect(definitions.map(({ id }) => id)).toEqual([
      "binary-status", "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy", "binary-action-feedback",
    ]);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(5);
    expect(definitions.filter((definition) => "action" in definition).every((definition) => typeof definition.action === "function" && !("render" in definition) && !("control" in definition))).toBe(true);
    expect(definitions.filter((definition) => "render" in definition).every((definition) => typeof definition.render === "function" && !("action" in definition) && !("control" in definition))).toBe(true);
  });

  it("renders detached binary status and check feedback from safe runtime state", async () => {
    const { ports, check, calls, getUpdateCount } = createBinaryActionPorts();
    const definitions = createDetachedBinarySettingDefinitions(getStrings("pt-PT"), ports);
    const status = definitions[0];
    const checkAction = definitions[1];
    const feedback = definitions[4];
    if (!("render" in status) || !("action" in checkAction) || !("render" in feedback)) throw new Error("Expected binary render and action definitions.");

    const initial = createSettingDouble();
    status.render(initial.setting as never, {} as never);
    expect(initial.calls.elements).toEqual([{ tag: "p", options: { text: `${getStrings("pt-PT").settingsBinaryCopyState}: ${getStrings("pt-PT").settingsBinaryStatusNotChecked}`, attr: { "aria-live": "polite" } } }]);

    checkAction.action({} as HTMLElement, 0);
    expect(calls).toEqual(["check"]);
    const pending = createSettingDouble();
    feedback.render(pending.setting as never, {} as never);
    expect(pending.calls.elements[0].options.text).toBe(getStrings("pt-PT").settingsBinaryWorking);

    check.resolve({ status: "valid", recordCount: 7, dimensions: 512, byteLengthKiB: 14 });
    await Promise.resolve();
    await Promise.resolve();
    const valid = createSettingDouble();
    status.render(valid.setting as never, {} as never);
    expect(valid.calls.elements[0].options.text).toBe(`${getStrings("pt-PT").settingsBinaryCopyState}: ${getStrings("pt-PT").settingsBinaryStatusValid} · 7 · 512D · 14 KiB`);
    expect(getUpdateCount()).toBe(2);
  });

  it("blocks detached binary creation for legacy state and keeps removal behind injected destructive confirmation", async () => {
    const { ports, confirmation, remove, calls, confirmations, setInput, getUpdateCount } = createBinaryActionPorts();
    const definitions = createDetachedBinarySettingDefinitions(getStrings("en"), ports);
    const createAction = definitions[2];
    const removeAction = definitions[3];
    const feedback = definitions[4];
    if (!("action" in createAction) || !("action" in removeAction) || !("render" in feedback)) throw new Error("Expected binary action and feedback definitions.");

    setInput({ legacyManifest: true });
    expect(typeof createAction.disabled === "function" && createAction.disabled()).toBe(true);
    createAction.action({} as HTMLElement, 0);
    expect(calls).toEqual([]);

    setInput({ legacyManifest: false });
    removeAction.action({} as HTMLElement, 0);
    expect(confirmations).toEqual([{ actionId: "remove-binary-copy", message: getStrings("en").settingsBinaryRemoveConfirm, confirmLabel: getStrings("en").settingsBinaryRemove, cancelLabel: "cancel", destructive: true }]);
    const awaiting = createSettingDouble();
    feedback.render(awaiting.setting as never, {} as never);
    expect(awaiting.calls.elements[0].options.text).toBe(getStrings("en").settingsBinaryRemoveConfirm);
    confirmation.resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(getUpdateCount()).toBe(2);

    const confirmed = createBinaryActionPorts();
    const confirmedDefinitions = createDetachedBinarySettingDefinitions(getStrings("en"), confirmed.ports);
    const confirmedRemove = confirmedDefinitions[3];
    if (!("action" in confirmedRemove)) throw new Error("Expected binary removal action.");
    confirmedRemove.action({} as HTMLElement, 0);
    confirmed.confirmation.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmed.calls).toEqual(["remove"]);
    confirmed.remove.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const absent = createSettingDouble();
    const confirmedStatus = confirmedDefinitions[0];
    if (!("render" in confirmedStatus)) throw new Error("Expected binary status renderer.");
    confirmedStatus.render(absent.setting as never, {} as never);
    expect(absent.calls.elements[0].options.text).toBe(`${getStrings("en").settingsBinaryCopyState}: ${getStrings("en").settingsBinaryStatusAbsent}`);
    expect(createDetachedBinarySettingDefinitions.toString()).not.toContain("innerHTML");
  });
});
