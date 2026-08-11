import { App, Setting } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { createConnectionCredentialBindings } from "../../src/settings/declarativeSettingsConnectionCredentialBindings";
import { createDeclarativeSettingsLifecycleController } from "../../src/settings/declarativeSettingsLifecycleController";

let confirmationAccept: (() => void) | undefined;

vi.mock("obsidian", async () => {
  const mock = await vi.importActual<typeof import("../helpers/mockObsidian")>("../helpers/mockObsidian.ts");
  class ConfirmationModal extends mock.Modal {
    contentEl = { empty() {}, setText() {} };
    addButton(callback: (button: {
      setButtonText(value: string): unknown;
      setDestructive(): unknown;
      onClick(handler: () => void): unknown;
    }) => void): this {
      const button = {
        setButtonText() { return button; },
        setDestructive() { return button; },
        onClick(handler: () => void) { confirmationAccept = handler; return button; },
      };
      callback(button);
      return this;
    }
    addCancelButton(): this { return this; }
  }
  return { ...mock, ConfirmationModal };
});

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
      onChange(next: (value: string) => void) {
        if (rendered) rendered.change = (value) => {
          rendered!.value = value;
          next(value);
        };
        return text;
      },
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

function renderImperativeCredential(
  tab: LinaSettingTab,
  domain: "credentials-analysis" | "credentials-embeddings",
  save: (value: string) => Promise<boolean>,
  clear: () => Promise<boolean> = async () => true,
): RenderedCredential {
  rendered = { value: "initial", change() {}, buttons: [] };
  Reflect.apply(Reflect.get(tab, "renderExplicitCredentialSetting"), tab, [{} as never, true, domain, 0, save, clear]);
  return rendered;
}

type CapturedButton = {
  label?: string;
  disabled: boolean;
  click?: () => void;
};

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

function installFullTabDouble() {
  const buttons: CapturedButton[] = [];
  const passwordInputs: Array<{ change(value: string): void; value: string }> = [];
  const element = {
    createEl() { return element; },
    createSpan() { return element; },
    setText() {},
    addClass() {},
    removeClass() {},
  };
  const originalHeading = Object.getOwnPropertyDescriptor(Setting.prototype, "setHeading");
  Object.defineProperty(Setting.prototype, "setHeading", { configurable: true, value() { return this; } });
  vi.spyOn(Setting.prototype, "setName").mockImplementation(function (this: Setting) {
    Object.defineProperty(this, "descEl", { configurable: true, value: element });
    return this;
  });
  vi.spyOn(Setting.prototype, "setDesc").mockImplementation(function (this: Setting) { return this; });
  vi.spyOn(Setting.prototype, "addText").mockImplementation(function (this: Setting, callback) {
    let change: (value: string) => void = () => undefined;
    let inputType = "text";
    const text = {
      inputEl: {
        get type() { return inputType; },
        set type(value: string) { inputType = value; },
      },
      setPlaceholder() { return text; },
      setValue(value: string) { if (inputType === "password") current.value = value; return text; },
      setDisabled() { return text; },
      onChange(next: (value: string) => void) { change = next; return text; },
    };
    const current = { value: "", change(value: string) { current.value = value; change(value); } };
    callback(text as never);
    if (inputType === "password") passwordInputs.push(current);
    return this;
  });
  vi.spyOn(Setting.prototype, "addTextArea").mockImplementation(function (this: Setting, callback) {
    const text = { inputEl: { type: "text" }, setPlaceholder() { return text; }, setValue() { return text; }, onChange() { return text; } };
    callback(text as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addDropdown").mockImplementation(function (this: Setting, callback) {
    const dropdown = { addOption() { return dropdown; }, setValue() { return dropdown; }, onChange() { return dropdown; } };
    callback(dropdown as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addToggle").mockImplementation(function (this: Setting, callback) {
    const toggle = { setValue() { return toggle; }, setDisabled() { return toggle; }, onChange() { return toggle; } };
    callback(toggle as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addButton").mockImplementation(function (this: Setting, callback) {
    const captured: CapturedButton = { disabled: false };
    const button = {
      setButtonText(label: string) { captured.label = label; return button; },
      setDisabled(value: boolean) { captured.disabled = value; return button; },
      setCta() { return button; },
      setDestructive() { return button; },
      onClick(click: () => void) { captured.click = click; return button; },
    };
    buttons.push(captured);
    callback(button as never);
    return this;
  });
  return {
    buttons,
    passwordInputs,
    container: { empty() {}, createEl() { return element; } },
    restore() {
      vi.restoreAllMocks();
      if (originalHeading) Object.defineProperty(Setting.prototype, "setHeading", originalHeading);
      else Reflect.deleteProperty(Setting.prototype, "setHeading");
    },
  };
}

function lastButton(buttons: readonly CapturedButton[], label: string): CapturedButton {
  const button = [...buttons].reverse().find((entry) => entry.label === label);
  if (!button) throw new Error(`Missing button ${label}.`);
  return button;
}

afterEach(() => vi.restoreAllMocks());

describe("settings actions, lifecycle, and cleanup parity", () => {
  it("keeps credential save pending until persistence succeeds, matching the candidate lifecycle", async () => {
    installCredentialDouble();
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...plugin.settings, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const imperativePersistence = deferred<void>();
    const imperativeCalls: string[] = [];
    const imperative = renderImperativeCredential(tab, "credentials-analysis", async (value) => {
      imperativeCalls.push(value);
      await imperativePersistence.promise;
      return true;
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
    expect(imperative.value).toBe(secret);
    imperative.buttons[0].click?.();
    expect(imperativeCalls).toEqual([secret]);

    let candidateDraft = secret;
    const candidateSave = candidate.saveCredential("analysis", candidateDraft, () => { candidateDraft = ""; });
    expect(lifecycle.isPending("credentials-analysis")).toBe(true);
    expect(candidate.getState().analysis.credential).toMatchObject({ status: "saving", available: false });
    expect(candidateDraft).toBe(secret);

    imperativePersistence.resolve();
    candidatePersistence.resolve({ ok: true, available: true });
    await Promise.resolve();
    await candidateSave;
    expect(imperative.value).toBe("");
    expect(lifecycle.isPending("credentials-analysis")).toBe(false);
    expect(candidateDraft).toBe("");
    expect(JSON.stringify(candidate.getState())).not.toContain(secret);
  });

  it("isolates credential domains and leaves failed, cancelled, and stale actions inert", async () => {
    installCredentialDouble();
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const analysisPersistence = deferred<boolean>();
    const analysisCalls: string[] = [];
    const analysis = renderImperativeCredential(tab, "credentials-analysis", async (value) => {
      analysisCalls.push(value);
      return analysisPersistence.promise;
    });
    const embeddingsCalls: string[] = [];
    const embeddings = renderImperativeCredential(tab, "credentials-embeddings", async (value) => {
      embeddingsCalls.push(value);
      return true;
    });

    analysis.change("analysis-draft");
    analysis.buttons[0].click?.();
    embeddings.change("embeddings-draft");
    embeddings.buttons[0].click?.();
    await flushAsync();
    expect(analysisCalls).toEqual(["analysis-draft"]);
    expect(embeddingsCalls).toEqual(["embeddings-draft"]);

    analysisPersistence.resolve(false);
    await flushAsync();
    analysis.buttons[0].click?.();
    expect(analysisCalls).toEqual(["analysis-draft", "analysis-draft"]);

    let clears = 0;
    const clearTab = new LinaSettingTab(app, plugin);
    const credential = renderImperativeCredential(clearTab, "credentials-analysis", async () => true, async () => {
      clears += 1;
      return false;
    });
    confirmationAccept = undefined;
    credential.buttons[1].click?.();
    expect(clears).toBe(0);
    expect(confirmationAccept).toBeTypeOf("function");
    confirmationAccept?.();
    await flushAsync();
    expect(clears).toBe(1);

    const stalePersistence = deferred<boolean>();
    const staleTab = new LinaSettingTab(app, plugin);
    const stale = renderImperativeCredential(staleTab, "credentials-analysis", async () => stalePersistence.promise);
    stale.change("stale-draft");
    stale.buttons[0].click?.();
    staleTab.hide();
    staleTab.hide();
    stalePersistence.resolve(true);
    await flushAsync();
    expect(stale.value).toBe("stale-draft");
  });

  it("owns connection and binary actions by domain across rerender, confirmation, and cleanup", async () => {
    const instrumentation = installFullTabDouble();
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = {
      ...plugin.settings,
      aiProvider: "mistral",
      embeddingProvider: "mistral",
      deviceSettingsById: {
        current: {
          analysisProvider: "mistral",
          analysisModel: "mistral-small-latest",
          analysisBaseUrl: "https://api.mistral.ai/v1",
          analysisApiKey: "stored-analysis",
          embeddingsProvider: "mistral",
          embeddingsModel: "mistral-embed",
          embeddingsBaseUrl: "https://api.mistral.ai/v1",
          embeddingsApiKey: "stored-embeddings",
        },
      },
    };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    tab.containerEl = instrumentation.container as never;
    vi.spyOn(plugin, "getBinaryEmbeddingCopyMaintenanceState").mockReturnValue({ phase: "idle" } as never);
    vi.spyOn(plugin, "getEmbeddingReadDiagnosticState").mockReturnValue({
      configuredPreference: "jsonl", effectiveSource: "not-loaded", fallbackReason: "none",
    });

    const analysisPending = deferred<string>();
    const embeddingsPending = deferred<{ success: boolean; message: string }>();
    const analysisConnection = vi.spyOn(tab as never, "testAnalysisProviderConnection")
      .mockImplementationOnce(() => analysisPending.promise)
      .mockResolvedValue("Ligação testada com sucesso.");
    const embeddingsConnection = vi.spyOn(tab as never, "testEmbeddingProviderConnection")
      .mockImplementationOnce(() => embeddingsPending.promise)
      .mockResolvedValue({ success: true, message: "OK" });

    tab.display();
    const analysisButton = lastButton(instrumentation.buttons, "Testar ligação");
    const embeddingsButton = lastButton(instrumentation.buttons, "Testar ligação dos embeddings");
    analysisButton.click?.();
    analysisButton.click?.();
    embeddingsButton.click?.();
    embeddingsButton.click?.();
    expect(analysisConnection).toHaveBeenCalledTimes(1);
    expect(embeddingsConnection).toHaveBeenCalledTimes(1);
    expect(analysisButton.disabled).toBe(true);
    expect(embeddingsButton.disabled).toBe(true);

    tab.display();
    analysisPending.resolve("late analysis");
    embeddingsPending.resolve({ success: true, message: "late embeddings" });
    await flushAsync();
    expect(lastButton(instrumentation.buttons, "Testar ligação").disabled).toBe(false);
    expect(lastButton(instrumentation.buttons, "Testar ligação dos embeddings").disabled).toBe(false);

    const firstCheck = deferred<{ status: "valid" }>();
    const checkBinary = vi.spyOn(plugin, "checkBinaryEmbeddingCopy")
      .mockImplementationOnce(() => firstCheck.promise as never)
      .mockResolvedValue({ status: "valid" } as never);
    const createBinary = vi.spyOn(plugin, "createOrUpdateBinaryEmbeddingCopy").mockResolvedValue({ status: "valid" } as never);
    const removeBinary = vi.spyOn(plugin, "removeBinaryEmbeddingCopy").mockResolvedValue();
    const checkButton = lastButton(instrumentation.buttons, "Verificar cópia binária");
    const createButton = lastButton(instrumentation.buttons, "Criar/atualizar cópia binária");
    checkButton.click?.();
    createButton.click?.();
    expect(checkBinary).toHaveBeenCalledTimes(1);
    expect(createBinary).not.toHaveBeenCalled();
    firstCheck.resolve({ status: "valid" });
    await flushAsync();

    Reflect.set(tab, "binaryStatusReasonCode", "legacy-manifest");
    tab.display();
    const legacyCreate = lastButton(instrumentation.buttons, "Criar/atualizar cópia binária");
    expect(legacyCreate.disabled).toBe(true);
    legacyCreate.click?.();
    expect(createBinary).not.toHaveBeenCalled();

    confirmationAccept = undefined;
    const removeButton = lastButton(instrumentation.buttons, "Remover cópia binária");
    removeButton.click?.();
    expect(removeBinary).not.toHaveBeenCalled();
    expect(confirmationAccept).toBeTypeOf("function");
    confirmationAccept?.();
    await flushAsync();
    expect(removeBinary).toHaveBeenCalledTimes(1);

    tab.hide();
    tab.hide();
    tab.display();
    lastButton(instrumentation.buttons, "Testar ligação").click?.();
    await flushAsync();
    expect(analysisConnection).toHaveBeenCalledTimes(2);
    instrumentation.restore();
  });
});
