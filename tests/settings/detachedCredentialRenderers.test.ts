import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  createDetachedCredentialSettingDefinitions,
  type DetachedCredentialRendererPorts,
} from "../../src/settings/declarativeSettingRenderers";
import type { CredentialDomain, CredentialMutationResult } from "../../src/settings/pureCredentialModel";

type ElementState = { tag: string; options: Record<string, unknown> };
type TextState = { placeholder?: string; value?: string; type: string; onChange?: (value: string) => void };
type ButtonState = { text?: string; disabled?: boolean; destructive?: boolean; onClick?: () => void | Promise<void> };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSettingDouble() {
  const elements: ElementState[] = [];
  const calls: { name?: string; description?: string; elements: ElementState[]; text?: TextState; buttons: ButtonState[] } = { elements, buttons: [] };
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
    addButton(callback: (button: { setButtonText(value: string): unknown; setDisabled(value: boolean): unknown; setCta(): unknown; setDestructive(): unknown; onClick(value: () => void | Promise<void>): unknown }) => void) {
      const state: ButtonState = {};
      const button = {
        setButtonText(value: string) { state.text = value; return button; },
        setDisabled(value: boolean) { state.disabled = value; return button; },
        setCta() { return button; },
        setDestructive() { state.destructive = true; return button; },
        onClick(value: () => void | Promise<void>) { state.onClick = value; return button; },
      };
      calls.buttons.push(state);
      callback(button);
      return setting;
    },
    descEl: {
      createEl(tag: string, options: Record<string, unknown>) {
        const state = { tag, options: { ...options } };
        elements.push(state);
        return { setText(value: string) { state.options.text = value; } };
      },
    },
  };
  return { calls, setting };
}

function createCredentialPorts(initialAvailable: boolean, provider = "mistral") {
  let available = initialAvailable;
  const save = deferred<CredentialMutationResult>();
  const clear = deferred<CredentialMutationResult>();
  const confirmation = deferred<boolean>();
  const saves: Array<{ domain: CredentialDomain; deviceId: string; value: string }> = [];
  const clears: Array<{ domain: CredentialDomain; deviceId: string }> = [];
  const confirmations: Array<Record<string, unknown>> = [];
  let updates = 0;
  const ports: DetachedCredentialRendererPorts = {
    getCredentialRef(domain) { return { deviceId: "device-test", domain }; },
    getCredentialProvider() { return provider as "ollama" | "mistral"; },
    getAvailability(_ref, activeProvider) { return { required: activeProvider !== "ollama", available }; },
    save(ref, value) {
      saves.push({ domain: ref.domain, deviceId: ref.deviceId, value });
      return save.promise.then((result) => { if (result.ok) available = result.available; return result; });
    },
    clear(ref) {
      clears.push({ domain: ref.domain, deviceId: ref.deviceId });
      return clear.promise.then((result) => { if (result.ok) available = result.available; return result; });
    },
    requestConfirmation(request) { confirmations.push({ ...request }); return confirmation.promise; },
    requestUpdate() { updates += 1; },
  };
  return { ports, save, clear, confirmation, saves, clears, confirmations, getUpdates: () => updates };
}

function renderCredential(domain: CredentialDomain, ports: DetachedCredentialRendererPorts) {
  const definition = createDetachedCredentialSettingDefinitions(getStrings("pt-PT"), ports)
    .find((candidate) => candidate.id === `${domain}-credential`);
  if (!definition || !("render" in definition)) throw new Error("Expected credential renderer.");
  const rendered = createSettingDouble();
  const cleanup = definition.render(rendered.setting as never, {} as never);
  return { definition, ...rendered, cleanup };
}

describe("detached credential renderers", () => {
  it("hides local providers and renders a remote absent credential as an empty password field", () => {
    const local = createCredentialPorts(false, "ollama");
    const localDefinitions = createDetachedCredentialSettingDefinitions(getStrings("pt-PT"), local.ports);
    expect(localDefinitions[0].visible?.()).toBe(false);
    const localRendered = renderCredential("analysis", local.ports);
    expect(localRendered.calls.text).toBeUndefined();

    const remote = createCredentialPorts(false);
    const rendered = renderCredential("analysis", remote.ports);
    expect(rendered.definition.visible?.()).toBe(true);
    expect(rendered.calls.name).toBe(getStrings("pt-PT").settingsApiKey);
    expect(rendered.calls.text).toMatchObject({ value: "", type: "password", placeholder: getStrings("pt-PT").settingsApiKeyPlaceholder });
    expect(rendered.calls.elements[0].options.text).toBe(`${getStrings("pt-PT").settingsCredentialStatus}: ${getStrings("pt-PT").settingsCredentialNotStored}`);
    expect(rendered.calls.buttons.map((button) => button.text)).toEqual([getStrings("pt-PT").settingsCredentialSave]);
    expect(rendered.calls.buttons[0].disabled).toBe(true);
  });

  it("keeps a stored credential empty, masked, and clearable without exposing it", () => {
    const ports = createCredentialPorts(true);
    const rendered = renderCredential("analysis", ports.ports);
    expect(rendered.calls.text).toMatchObject({ value: "", type: "password", placeholder: getStrings("pt-PT").settingsApiKeyLocalSaved });
    expect(rendered.calls.elements[0].options.text).toBe(`${getStrings("pt-PT").settingsCredentialStatus}: ${getStrings("pt-PT").settingsApiKeyLocalSaved}`);
    expect(rendered.calls.buttons.map((button) => button.text)).toEqual([getStrings("pt-PT").settingsCredentialSave, getStrings("pt-PT").settingsCredentialClear]);
    expect(rendered.calls.buttons[1].destructive).toBe(true);
  });

  it("saves explicitly, blocks an empty or concurrent draft, clears it on success, and keeps it out of public output", async () => {
    const ports = createCredentialPorts(false);
    const rendered = renderCredential("analysis", ports.ports);
    const save = rendered.calls.buttons[0].onClick;
    save?.();
    expect(ports.saves).toEqual([]);

    const sentinel = "SUPER_SECRET_SENTINEL";
    rendered.calls.text?.onChange?.(sentinel);
    expect(rendered.calls.buttons[0].disabled).toBe(false);
    save?.();
    save?.();
    expect(ports.saves).toEqual([{ domain: "analysis", deviceId: "device-test", value: sentinel }]);
    expect(rendered.calls.buttons[0].disabled).toBe(true);
    expect(rendered.calls.elements[1].options.text).toBe(getStrings("pt-PT").settingsCredentialSaving);
    expect(ports.getUpdates()).toBe(1);

    ports.save.resolve({ ok: true, available: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(rendered.calls.text?.value).toBe("");
    expect(rendered.calls.elements[1].options.text).toBe(getStrings("pt-PT").settingsCredentialSaveSuccess);
    expect(ports.getUpdates()).toBe(2);
    expect(JSON.stringify({ definition: rendered.definition, calls: rendered.calls })).not.toContain(sentinel);
  });

  it("normalizes save errors without clearing the draft or exposing the thrown message", async () => {
    const ports = createCredentialPorts(false);
    const rendered = renderCredential("analysis", ports.ports);
    rendered.calls.text?.onChange?.("SUPER_SECRET_SENTINEL");
    rendered.calls.buttons[0].onClick?.();
    ports.save.reject(new Error("SUPER_SECRET_SENTINEL"));
    await Promise.resolve();
    await Promise.resolve();
    expect(rendered.calls.elements[1].options.text).toBe(getStrings("pt-PT").settingsCredentialOperationError);
    expect(rendered.calls.text?.value).toBe("");
    rendered.calls.buttons[0].onClick?.();
    expect(ports.saves).toHaveLength(2);
    expect(JSON.stringify({ definition: rendered.definition, elements: rendered.calls.elements })).not.toContain("SUPER_SECRET_SENTINEL");
  });

  it("requires injected destructive confirmation before clearing and keeps cancelled clearing inert", async () => {
    const ports = createCredentialPorts(true);
    const rendered = renderCredential("analysis", ports.ports);
    const clear = rendered.calls.buttons[1].onClick;
    clear?.();
    clear?.();
    expect(ports.confirmations).toEqual([{
      actionId: "clear-analysis-credential", message: getStrings("pt-PT").settingsCredentialClearConfirm,
      confirmLabel: getStrings("pt-PT").settingsCredentialClear, cancelLabel: getStrings("pt-PT").settingsCredentialCancel, destructive: true,
    }]);
    ports.confirmation.resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(ports.clears).toEqual([]);
    expect(ports.getUpdates()).toBe(1);
  });

  it("clears only after confirmation, exposes safe clearing feedback, and isolates analysis from embeddings", async () => {
    const analysis = createCredentialPorts(true);
    const embeddings = createCredentialPorts(false);
    const analysisRendered = renderCredential("analysis", analysis.ports);
    const embeddingsRendered = renderCredential("embeddings", embeddings.ports);
    embeddingsRendered.calls.text?.onChange?.("SUPER_SECRET_SENTINEL");
    analysisRendered.calls.buttons[1].onClick?.();
    analysis.confirmation.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(analysis.clears).toEqual([{ domain: "analysis", deviceId: "device-test" }]);
    expect(embeddings.saves).toEqual([]);
    expect(analysisRendered.calls.elements[1].options.text).toBe(getStrings("pt-PT").settingsCredentialClearing);
    analysis.clear.resolve({ ok: true, available: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(analysisRendered.calls.elements[1].options.text).toBe(getStrings("pt-PT").settingsCredentialClearSuccess);
    expect(analysis.getUpdates()).toBe(2);
    expect(JSON.stringify({ analysis: analysisRendered.calls.elements, embeddings: embeddingsRendered.calls.elements })).not.toContain("SUPER_SECRET_SENTINEL");
  });

  it("reports a completed clear without mislabelling an effective fallback as a save", async () => {
    const ports = createCredentialPorts(true);
    const rendered = renderCredential("analysis", ports.ports);
    rendered.calls.buttons[1].onClick?.();
    ports.confirmation.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    ports.clear.resolve({ ok: true, available: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(rendered.calls.elements[1].options.text).toBe(getStrings("pt-PT").settingsCredentialClearSuccess);
  });

  it("normalizes clear errors without exposing the rejected message", async () => {
    const ports = createCredentialPorts(true);
    const rendered = renderCredential("embeddings", ports.ports);
    rendered.calls.buttons[1].onClick?.();
    ports.confirmation.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    ports.clear.reject(new Error("SUPER_SECRET_SENTINEL"));
    await Promise.resolve();
    await Promise.resolve();
    expect(rendered.calls.elements[1].options.text).toBe(getStrings("pt-PT").settingsCredentialOperationError);
    expect(JSON.stringify({ elements: rendered.calls.elements, buttons: rendered.calls.buttons })).not.toContain("SUPER_SECRET_SENTINEL");
  });

  it("clears the ephemeral draft during cleanup and prevents stale events from mutating", () => {
    const ports = createCredentialPorts(false);
    const rendered = renderCredential("embeddings", ports.ports);
    rendered.calls.text?.onChange?.("SUPER_SECRET_SENTINEL");
    if (typeof rendered.cleanup === "function") rendered.cleanup();
    rendered.calls.buttons[0].onClick?.();
    expect(rendered.calls.text?.value).toBe("");
    expect(ports.saves).toEqual([]);
  });
});
