import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  clampDetachedWeight,
  createDetachedConfigNoteRenderer,
  createDetachedInformationalSettingDefinitions,
  createDetachedInboxFolderRenderer,
  createDetachedInboxMaxNotesRenderer,
  createDetachedInteractiveSettingDefinitions,
  createDetachedInterfaceLanguageRenderer,
  createDetachedSemanticWeightRenderer,
  createDetachedSupportLinkRenderer,
  createDetachedTextWeightRenderer,
  type DetachedGlobalKey,
  type DetachedGlobalReadValue,
  type DetachedGlobalValue,
  type DetachedSettingsPorts,
} from "../../src/settings/declarativeSettingRenderers";

type ElementCall = { tag: string; options: Record<string, unknown> };
type TextState = { placeholder?: string; value?: string; onChange?: (value: string) => Promise<void> };
type DropdownState = { options: Array<{ value: string; label: string }>; value?: string; onChange?: (value: string) => Promise<void> };

function createSettingDouble() {
  const calls: { name?: string; description?: string; elements: ElementCall[]; text?: TextState; dropdown?: DropdownState } = { elements: [] };
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
  const setting = {
    setName(name: string) { calls.name = name; return setting; },
    setDesc(description: string) { calls.description = description; return setting; },
    addText(callback: (component: typeof text) => void) { callback(text); return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
    descEl: {
      createSpan(options: Record<string, unknown>) { calls.elements.push({ tag: "span", options }); },
      createEl(tag: string, options: Record<string, unknown>) { calls.elements.push({ tag, options }); },
    },
  };
  return { calls, setting };
}

function createPorts(initial: { [K in DetachedGlobalKey]: DetachedGlobalReadValue<K> }) {
  const values = { ...initial };
  const writes: Array<{ key: DetachedGlobalKey; value: string | number }> = [];
  let updateCount = 0;
  const ports: DetachedSettingsPorts = {
    getGlobal<K extends DetachedGlobalKey>(key: K): DetachedGlobalReadValue<K> {
      return values[key];
    },
    async setGlobal<K extends DetachedGlobalKey>(key: K, value: DetachedGlobalValue<K>): Promise<void> {
      values[key] = value;
      writes.push({ key, value });
    },
    getLocal() { return ""; },
    async setLocal() {},
    async applyEffect() {},
    requestUpdate() { updateCount += 1; },
  };
  return { ports, writes, getUpdateCount: () => updateCount };
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
});
