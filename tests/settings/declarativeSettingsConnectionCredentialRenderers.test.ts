import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  createDeclarativeSettingsConnectionCredentialRenderers,
} from "../../src/settings/declarativeSettingsConnectionCredentialRenderers";
import type {
  ConnectionCredentialBindings,
  ConnectionCredentialBindingsState,
  ConnectionCredentialDomain,
} from "../../src/settings/declarativeSettingsConnectionCredentialBindings";
import type { CredentialDomain } from "../../src/settings/pureCredentialModel";

type ElementState = { tag: string; options: Record<string, unknown> };
type ButtonState = { text?: string; disabled?: boolean; destructive?: boolean; onClick?: () => void };
type TextState = { placeholder?: string; value?: string; type: string; onChange?: (value: string) => void };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createSettingDouble() {
  const calls: { name?: string; description?: string; elements: ElementState[]; buttons: ButtonState[]; text?: TextState } = {
    elements: [], buttons: [],
  };
  const text = {
    inputEl: { type: "text" } as HTMLInputElement,
    setPlaceholder(value: string) { (calls.text ??= { type: "text" }).placeholder = value; return text; },
    setValue(value: string) { (calls.text ??= { type: "text" }).value = value; return text; },
    onChange(callback: (value: string) => void) { (calls.text ??= { type: "text" }).onChange = callback; return text; },
  };
  const setting = {
    setName(value: string) { calls.name = value; return setting; },
    setDesc(value: string) { calls.description = value; return setting; },
    addText(callback: (component: typeof text) => void) { callback(text); (calls.text ??= { type: "text" }).type = text.inputEl.type; return setting; },
    addButton(callback: (button: { setButtonText(value: string): unknown; setDisabled(value: boolean): unknown; setCta(): unknown; setDestructive(): unknown; onClick(value: () => void): unknown }) => void) {
      const state: ButtonState = {};
      const button = {
        setButtonText(value: string) { state.text = value; return button; },
        setDisabled(value: boolean) { state.disabled = value; return button; },
        setCta() { return button; },
        setDestructive() { state.destructive = true; return button; },
        onClick(value: () => void) { state.onClick = value; return button; },
      };
      calls.buttons.push(state);
      callback(button);
      return setting;
    },
    descEl: {
      createEl(tag: string, options: Record<string, unknown>) {
        const state = { tag, options: { ...options } };
        calls.elements.push(state);
        return { setText(value: string) { state.options.text = value; } };
      },
    },
  };
  return { calls, setting, change(value: string) { calls.text!.value = value; calls.text?.onChange?.(value); } };
}

function createBindingDouble() {
  const analysis = deferred<boolean>();
  const embeddings = deferred<boolean>();
  const saves: Array<{ domain: CredentialDomain; value: string }> = [];
  const clears: CredentialDomain[] = [];
  const tests: ConnectionCredentialDomain[] = [];
  const cleanups = new Map<string, () => void>();
  let saveSucceeds = true;
  let clearSucceeds = true;
  const state: ConnectionCredentialBindingsState = {
    analysis: { connection: { status: "idle" }, credential: { status: "absent", available: false } },
    embeddings: { connection: { status: "idle" }, credential: { status: "stored", available: true } },
  };
  const bindings: ConnectionCredentialBindings = {
    getState() {
      return {
        analysis: { connection: { ...state.analysis.connection }, credential: { ...state.analysis.credential } },
        embeddings: { connection: { ...state.embeddings.connection }, credential: { ...state.embeddings.credential } },
      };
    },
    async runConnectionTest(domain) {
      tests.push(domain);
      state[domain].connection = { status: "pending", provider: "mistral", model: "safe-model", baseUrl: "https://example.invalid" };
      const result = await (domain === "analysis" ? analysis.promise : embeddings.promise);
      state[domain].connection = result
        ? { status: "success", provider: "mistral", model: "safe-model", baseUrl: "https://example.invalid", messageKey: "connection-success" }
        : { status: "error", provider: "mistral", model: "safe-model", baseUrl: "https://example.invalid", messageKey: "connection-failed" };
      return result;
    },
    async saveCredential(domain, value, clearDraft) {
      saves.push({ domain, value });
      state[domain].credential = { status: "saving", available: state[domain].credential.available, operation: "save" };
      if (!saveSucceeds) {
        state[domain].credential = { status: "error", available: state[domain].credential.available, operation: "save", error: "save-failed" };
        return false;
      }
      clearDraft();
      state[domain].credential = { status: "success", available: true, operation: "save" };
      return true;
    },
    async clearCredential(domain) {
      clears.push(domain);
      if (!clearSucceeds) return false;
      state[domain].credential = { status: "success", available: false, operation: "clear" };
      return true;
    },
    registerCleanup(owner, id, cleanup) {
      const key = `${owner}/${id}`;
      if (cleanups.has(key)) return false;
      cleanups.set(key, cleanup);
      return true;
    },
    removeCleanup(owner, id) {
      const key = `${owner}/${id}`;
      const cleanup = cleanups.get(key);
      if (!cleanup) return false;
      cleanups.delete(key);
      cleanup();
      return true;
    },
    registerDraftCleanup(domain, id, cleanup) { return bindings.registerCleanup(`credentials-${domain}`, id, cleanup); },
    invalidateConnection(domain) { state[domain].connection = { status: "idle" }; },
    invalidateCredential(domain) { state[domain].credential = { status: "absent", available: false }; },
  };
  return {
    bindings, analysis, embeddings, saves, clears, tests, cleanups,
    failNextSave() { saveSucceeds = false; },
    cancelNextClear() { clearSucceeds = false; },
  };
}

function createRenderers(binding = createBindingDouble(), ownerPrefix = "candidate-a") {
  return {
    binding,
    renderers: createDeclarativeSettingsConnectionCredentialRenderers({
      bindings: binding.bindings,
      strings: getStrings("en"),
      ownerPrefix,
    }),
  };
}

describe("candidate connection and credential renderer factory", () => {
  it("uses the injected binding, keeps drafts renderer-local, and never serializes a submitted value", async () => {
    const { binding, renderers } = createRenderers();
    const rendered = createSettingDouble();
    const cleanup = renderers.createAnalysisCredentialRenderer()(rendered.setting as never, {} as never);
    const sentinel = "SUPER_SECRET_SENTINEL";

    expect(rendered.calls.text).toMatchObject({ value: "", type: "password" });
    rendered.change(sentinel);
    rendered.calls.buttons[0].onClick?.();
    await Promise.resolve();

    expect(binding.saves).toEqual([{ domain: "analysis", value: sentinel }]);
    expect(rendered.calls.text?.value).toBe("");
    expect(rendered.calls.elements[1].options.text).toBe(getStrings("en").settingsCredentialSaveSuccess);
    expect(JSON.stringify(renderers.getDiagnosticSnapshot())).not.toContain(sentinel);
    expect(JSON.stringify(rendered.calls.elements)).not.toContain(sentinel);
    expect(typeof cleanup).toBe("function");
  });

  it("preserves a failed draft, delegates clear to the injected binding, and reports only safe feedback", async () => {
    const { binding, renderers } = createRenderers();
    binding.failNextSave();
    const analysis = createSettingDouble();
    renderers.createAnalysisCredentialRenderer()(analysis.setting as never, {} as never);
    analysis.change("SUPER_SECRET_SENTINEL");
    analysis.calls.buttons[0].onClick?.();
    await Promise.resolve();
    expect(analysis.calls.text?.value).toBe("SUPER_SECRET_SENTINEL");
    expect(analysis.calls.elements[1].options.text).toBe(getStrings("en").settingsCredentialOperationError);

    const embeddings = createSettingDouble();
    renderers.createEmbeddingsCredentialRenderer()(embeddings.setting as never, {} as never);
    expect(embeddings.calls.buttons.map((button) => button.text)).toEqual([
      getStrings("en").settingsCredentialSave,
      getStrings("en").settingsCredentialClear,
    ]);
    embeddings.calls.buttons[1].onClick?.();
    await Promise.resolve();
    expect(binding.clears).toEqual(["embeddings"]);
    expect(embeddings.calls.elements[1].options.text).toBe(getStrings("en").settingsCredentialClearSuccess);

    binding.cancelNextClear();
    embeddings.calls.buttons[1].onClick?.();
    await Promise.resolve();
    expect(binding.clears).toEqual(["embeddings", "embeddings"]);
  });

  it("delegates independent connection actions, blocks duplicates, and renders normalized feedback", async () => {
    const { binding, renderers } = createRenderers();
    const analysisAction = renderers.createAnalysisConnectionAction();
    const embeddingsAction = renderers.createEmbeddingsConnectionAction();
    analysisAction.run();
    analysisAction.run();
    embeddingsAction.run();
    expect(binding.tests).toEqual(["analysis", "embeddings"]);
    expect(analysisAction.isDisabled()).toBe(true);
    expect(embeddingsAction.isDisabled()).toBe(true);

    const pending = createSettingDouble();
    renderers.createAnalysisFeedbackRenderer()(pending.setting as never, {} as never);
    expect(pending.calls.elements[0].options.text).toBe(getStrings("en").settingsTestingConnection);

    binding.analysis.resolve(true);
    binding.embeddings.resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    const analysisFeedback = createSettingDouble();
    const embeddingsFeedback = createSettingDouble();
    renderers.createAnalysisFeedbackRenderer()(analysisFeedback.setting as never, {} as never);
    renderers.createEmbeddingsFeedbackRenderer()(embeddingsFeedback.setting as never, {} as never);
    expect(analysisFeedback.calls.elements[0].options.text).toBe(getStrings("en").settingsConnectionSuccess);
    expect(embeddingsFeedback.calls.elements[0].options.text).toBe(getStrings("en").settingsEmbeddingTestFailed);
  });

  it("uses stable per-factory owners and disposes only its own renderer cleanups", () => {
    const first = createRenderers(createBindingDouble(), "candidate-first");
    const second = createRenderers(createBindingDouble(), "candidate-second");
    const firstRendered = createSettingDouble();
    const secondRendered = createSettingDouble();
    first.renderers.createAnalysisCredentialRenderer()(firstRendered.setting as never, {} as never);
    second.renderers.createAnalysisCredentialRenderer()(secondRendered.setting as never, {} as never);
    firstRendered.change("SUPER_SECRET_SENTINEL");
    secondRendered.change("SECOND_SECRET_SENTINEL");

    expect(first.renderers.getDiagnosticSnapshot().owners).toEqual(["candidate-first-credential-analysis"]);
    expect(second.renderers.getDiagnosticSnapshot().owners).toEqual(["candidate-second-credential-analysis"]);
    first.renderers.dispose();
    first.renderers.dispose();

    expect(firstRendered.calls.text?.value).toBe("");
    expect(secondRendered.calls.text?.value).toBe("SECOND_SECRET_SENTINEL");
    expect(second.renderers.getDiagnosticSnapshot().disposed).toBe(false);
    expect(second.binding.cleanups.size).toBe(1);
  });
});
