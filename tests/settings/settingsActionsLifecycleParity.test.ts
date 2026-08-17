import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { getStrings } from "../../src/i18n/strings";
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

function renderActiveCredential(tab: LinaSettingTab, id: "analysis-credential" | "embeddings-credential") {
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === id) as {
      render?: (setting: unknown, group: unknown) => void | (() => void);
    } | undefined;
  if (!definition?.render) throw new Error(`Missing active credential renderer: ${id}`);

  const calls: {
    text?: { value?: string; type?: string };
    buttons: Array<{ text?: string; destructive?: boolean; disabled?: boolean; onClick?: () => void }>;
  } = { buttons: [] };
  const text = {
    inputEl: { type: "text" } as HTMLInputElement,
    setPlaceholder() { return text; },
    setValue(value: string) { (calls.text ??= {}).value = value; return text; },
    onChange() { return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addText(callback: (control: typeof text) => void) {
      callback(text);
      (calls.text ??= {}).type = text.inputEl.type;
      return setting;
    },
    addButton(callback: (button: {
      setButtonText(value: string): unknown;
      setDisabled(value: boolean): unknown;
      setCta(): unknown;
      setDestructive(): unknown;
      onClick(value: () => void): unknown;
    }) => void) {
      const buttonState: { text?: string; destructive?: boolean; disabled?: boolean; onClick?: () => void } = {};
      const button = {
        setButtonText(value: string) { buttonState.text = value; return button; },
        setDisabled(value: boolean) { buttonState.disabled = value; return button; },
        setCta() { return button; },
        setDestructive() { buttonState.destructive = true; return button; },
        onClick(value: () => void) { buttonState.onClick = value; return button; },
      };
      calls.buttons.push(buttonState);
      callback(button);
      return setting;
    },
    descEl: { createEl() { return { setText() {} }; } },
  };
  definition.render(setting, {});
  return calls;
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
    expect(reopened.flatMap((group) => group.items)).toHaveLength(49);
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

  it("renders each active remote credential row with one empty password input, Save, and Clear", () => {
    const tab = createTab();
    const strings = getStrings("pt-PT");

    for (const id of ["analysis-credential", "embeddings-credential"] as const) {
      expect(renderActiveCredential(tab, id)).toEqual({
        text: { value: "", type: "password" },
        buttons: [
          { text: strings.settingsCredentialSave, disabled: true, onClick: expect.any(Function) },
          { text: strings.settingsCredentialClear, destructive: true, disabled: false, onClick: expect.any(Function) },
        ],
      });
    }
    tab.hide();
  });

  it("keeps the connection and binary button renderers under declarative lifecycle ownership", () => {
    const tab = createTab();
    const definitions = tab.getSettingDefinitions().flatMap((group) => group.items) as Array<{ id: string; action?: () => Promise<unknown>; render?: unknown }>;

    for (const id of ["test-analysis-connection", "test-embeddings-connection", "check-binary-copy", "create-or-update-binary-copy"]) {
      const definition = definitions.find((entry) => entry.id === id);
      expect(definition?.render).toEqual(expect.any(Function));
      expect(definition?.action).toBeUndefined();
    }
    expect(definitions.find((entry) => entry.id === "remove-binary-copy")?.render).toEqual(expect.any(Function));
    tab.hide();
  });
});
