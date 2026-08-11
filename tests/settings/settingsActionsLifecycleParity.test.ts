import { App, Setting } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { createConnectionCredentialBindings } from "../../src/settings/declarativeSettingsConnectionCredentialBindings";
import { createDeclarativeSettingsLifecycleController } from "../../src/settings/declarativeSettingsLifecycleController";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

type RenderedCredential = {
  value: string;
  change(value: string): void;
  buttons: Array<{ label?: string; click?: () => void }>;
};

let rendered: RenderedCredential | undefined;

function installCredentialDouble(): void {
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
}

function renderImperativeCredential(tab: LinaSettingTab, save: (value: string) => void): RenderedCredential {
  rendered = { value: "initial", change() {}, buttons: [] };
  Reflect.apply(Reflect.get(tab, "renderExplicitCredentialSetting"), tab, [{} as never, true, save, () => undefined]);
  return rendered;
}

afterEach(() => vi.restoreAllMocks());

describe("settings actions, lifecycle, and cleanup parity", () => {
  it("records the C4 credential-save lifecycle divergence through the real imperative renderer and candidate binding", async () => {
    installCredentialDouble();
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...plugin.settings, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const imperativePersistence = deferred<void>();
    const imperativeCalls: string[] = [];
    const imperative = renderImperativeCredential(tab, (value) => {
      imperativeCalls.push(value);
      return imperativePersistence.promise;
    });

    const candidatePersistence = deferred<{ ok: true; available: true }>();
    const lifecycle = createDeclarativeSettingsLifecycleController({ requestHostUpdate() {}, scheduleUpdate() {} });
    const candidate = createConnectionCredentialBindings({
      lifecycle,
      connectionPorts: {
        async testAnalysisConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; },
        async testEmbeddingsConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; },
      },
      credentialStatus: { getAvailability: () => ({ required: true, available: false }) },
      credentialMutations: {
        save() { return candidatePersistence.promise; },
        async clear() { return { ok: true, available: false }; },
      },
      getConnectionConfiguration(domain) {
        return { provider: "mistral", model: domain === "analysis" ? "mistral-small-latest" : "mistral-embed", baseUrl: "https://api.mistral.ai/v1", timeout: "60", credentialAvailable: false };
      },
      getCredentialRef(domain) { return { deviceId: "current", domain }; },
      async confirmCredentialClear() { return true; },
    });

    const secret = "SUPER_SECRET_SENTINEL";
    imperative.change(secret);
    imperative.buttons[0].click?.();
    expect(imperativeCalls).toEqual([secret]);
    expect(imperative.value).toBe("");

    let candidateDraft = secret;
    const candidateSave = candidate.saveCredential("analysis", candidateDraft, () => { candidateDraft = ""; });
    expect(lifecycle.isPending("credentials-analysis")).toBe(true);
    expect(candidate.getState().analysis.credential).toMatchObject({ status: "saving", available: false });
    expect(candidateDraft).toBe(secret);

    imperativePersistence.resolve();
    candidatePersistence.resolve({ ok: true, available: true });
    await candidateSave;
    expect(lifecycle.isPending("credentials-analysis")).toBe(false);
    expect(candidateDraft).toBe("");
    expect(JSON.stringify(candidate.getState())).not.toContain(secret);
  });
});
