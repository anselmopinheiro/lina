import { App, ConfirmationModal, Setting } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { createImperativeParitySettings } from "./imperativeSettingsParityCapture";

vi.mock("obsidian", async () => {
	const mock = await vi.importActual<typeof import("../helpers/mockObsidian")>(
		"../helpers/mockObsidian.ts",
	);

	class ConfirmationModal extends mock.Modal {
		contentEl = {
			empty() {},
			setText() {},
		};

		addButton(callback: (button: {
			setButtonText(value: string): unknown;
			setDestructive(): unknown;
			onClick(handler: () => void): unknown;
		}) => void): this {
			callback({
				setButtonText: () => this,
				setDestructive: () => this,
				onClick: () => this,
			});
			return this;
		}

		addCancelButton(): this {
			return this;
		}
	}

	return { ...mock, ConfirmationModal };
});

interface RenderedCredential {
  value: string;
  change: (value: string) => void;
  buttons: Array<{ label?: string; click?: () => void }>;
}

let rendered: RenderedCredential | undefined;
let confirmClear: (() => void) | undefined;

function installSettingDouble(): void {
  vi.spyOn(Setting.prototype, "setName").mockImplementation(function (this: Setting) {
    Object.defineProperty(this, "descEl", {
      configurable: true,
      value: { createEl() { return { setText() {} }; } },
    });
    return this;
  });
  vi.spyOn(Setting.prototype, "setDesc").mockImplementation(function (this: Setting) { return this; });
  vi.spyOn(Setting.prototype, "addText").mockImplementation(function (this: Setting, callback) {
    const text = {
      inputEl: { type: "text" },
      setPlaceholder() { return text; },
      setValue(value: string) { if (rendered) rendered.value = value; return text; },
      onChange(next: (value: string) => void) { if (rendered) rendered.change = next; return text; },
    };
    callback(text as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addButton").mockImplementation(function (this: Setting, callback) {
    const state: { label?: string; click?: () => void } = {};
    const button = {
      setButtonText(label: string) { state.label = label; return button; },
      setDisabled() { return button; },
      setCta() { return button; },
      setDestructive() { return button; },
      onClick(click: () => void) { state.click = click; return button; },
    };
    rendered?.buttons.push(state);
    callback(button as never);
    return this;
  });
	vi.spyOn(ConfirmationModal.prototype, "addButton").mockImplementation(function (this: ConfirmationModal, callback) {
    const button = {
      setButtonText() { return button; },
      setDestructive() { return button; },
      onClick(click: () => void) { confirmClear = click; return button; },
    };
    callback(button as never);
    return this;
  });
  vi.spyOn(ConfirmationModal.prototype, "addCancelButton").mockImplementation(function (this: ConfirmationModal) { return this; });
  vi.spyOn(ConfirmationModal.prototype, "open").mockImplementation(() => undefined);
}

function renderCredential(
  tab: LinaSettingTab,
  stored: boolean,
  domain: "credentials-analysis" | "credentials-embeddings",
  save: (value: string) => Promise<boolean>,
  clear: () => Promise<boolean>,
): RenderedCredential {
  rendered = { value: "initial", change() {}, buttons: [] };
  confirmClear = undefined;
  Reflect.apply(Reflect.get(tab, "renderExplicitCredentialSetting"), tab, [{} as never, stored, domain, 0, save, clear]);
  return rendered;
}

beforeEach(() => installSettingDouble());
afterEach(() => vi.restoreAllMocks());

describe("imperative credential settings", () => {
  it("keeps analysis and embeddings drafts empty, explicit, isolated, and secret-free in public UI state", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = createImperativeParitySettings();
    setDeviceSettingsContext(plugin.settings, () => {}, "harness-device");
    const tab = new LinaSettingTab(app, plugin);
    const analysisSaves: string[] = [];
    const embeddingSaves: string[] = [];
    const strings = getStrings("pt-PT");

    const analysis = renderCredential(tab, true, "credentials-analysis", async (value) => {
      analysisSaves.push(value);
      return true;
    }, async () => true);
    const embeddings = renderCredential(tab, true, "credentials-embeddings", async (value) => {
      embeddingSaves.push(value);
      return true;
    }, async () => true);
    expect(analysis.value).toBe("");
    expect(embeddings.value).toBe("");
    expect(analysis.buttons.map((button) => button.label)).toEqual([strings.settingsCredentialSave, strings.settingsCredentialClear]);
    expect(embeddings.buttons.map((button) => button.label)).toEqual([strings.settingsCredentialSave, strings.settingsCredentialClear]);

    const sentinel = "SUPER_SECRET_SENTINEL";
    analysis.change(sentinel);
    expect(analysisSaves).toEqual([]);
    analysis.buttons[0].click?.();
    expect(analysisSaves).toEqual([sentinel]);
    expect(embeddingSaves).toEqual([]);
    expect(analysis.value).toBe("");
    expect(JSON.stringify({ analysis: analysis.buttons, embeddings: embeddings.buttons })).not.toContain(sentinel);
  });

  it("keeps clear inert until the explicit confirmation accepts it", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = createImperativeParitySettings();
    setDeviceSettingsContext(plugin.settings, () => {}, "harness-device");
    const tab = new LinaSettingTab(app, plugin);
    let clears = 0;
    const credential = renderCredential(tab, true, "credentials-analysis", async () => true, async () => {
      clears += 1;
      return true;
    });

    credential.buttons[1].click?.();
    expect(clears).toBe(0);
    expect(confirmClear).toBeTypeOf("function");
    confirmClear?.();
    expect(clears).toBe(1);
    expect(credential.value).toBe("");
  });
});
