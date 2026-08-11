import { App, Setting } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  DEFAULT_SETTINGS,
  LinaSettingTab,
  setDeviceSettingsContext,
  type LinaSettings,
} from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsCandidateComposition } from "../../src/settings/declarativeSettingsCandidateComposition";
import type { SettingsRuntimeEffect, SettingsRuntimeSnapshot } from "../../src/settings/settingsRuntimeAdapters";

type ImperativeControlKind = "text" | "textarea" | "dropdown" | "toggle";
type ImperativeControl = {
  section: string;
  name: string;
  kind: ImperativeControlKind;
  textChange?: (value: string) => unknown;
  toggleChange?: (value: boolean) => unknown;
};

const strings = getStrings("pt-PT");

function createSettings(): LinaSettings {
  return {
    ...DEFAULT_SETTINGS,
    aiProfiles: DEFAULT_SETTINGS.aiProfiles.map((profile) => ({ ...profile })),
    aiProvider: "ollama",
    aiBaseUrl: "http://localhost:11434",
    aiAnalysisModel: "gemma4:e2b",
    embeddingProvider: "ollama",
    embeddingBaseUrl: "http://localhost:11434",
    embeddingModel: "nomic-embed-text-v2-moe",
    deviceSettingsById: {
      current: {
        deviceName: "Current device",
        analysisProvider: "ollama",
        analysisModel: "gemma4:e2b",
        analysisBaseUrl: "http://localhost:11434",
        embeddingsProvider: "ollama",
        embeddingsModel: "nomic-embed-text-v2-moe",
        embeddingsBaseUrl: "http://localhost:11434",
      },
      other: {
        deviceName: "Other device",
        analysisProvider: "mistral",
      },
    },
  };
}

function createElement() {
  const element = {
    createEl() { return element; },
    createSpan() { return element; },
    setText() {},
    addClass() {},
    removeClass() {},
  };
  return element;
}

function deferredVoid() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installImperativeControlCapture() {
  const controls: ImperativeControl[] = [];
  const settingMetadata = new WeakMap<object, { name: string; section: string }>();
  let section = "";
  const originalHeading = Object.getOwnPropertyDescriptor(Setting.prototype, "setHeading");

  vi.spyOn(Setting.prototype, "setName").mockImplementation(function (this: Setting, name: string) {
    settingMetadata.set(this, { name, section });
    if (!Reflect.get(this, "descEl")) {
      Object.defineProperty(this, "descEl", { configurable: true, value: createElement() });
    }
    return this;
  });
  Object.defineProperty(Setting.prototype, "setHeading", {
    configurable: true,
    value(this: Setting) {
      const metadata = settingMetadata.get(this);
      if (metadata) section = metadata.name;
      return this;
    },
  });
  vi.spyOn(Setting.prototype, "setDesc").mockImplementation(function (this: Setting) { return this; });

  const metadataFor = (setting: Setting): { name: string; section: string } =>
    settingMetadata.get(setting) ?? { name: "", section };
  vi.spyOn(Setting.prototype, "addText").mockImplementation(function (this: Setting, callback) {
    const control: ImperativeControl = { ...metadataFor(this), kind: "text" };
    const component = {
      inputEl: { type: "text" },
      setPlaceholder() { return component; },
      setValue() { return component; },
      onChange(handler: (value: string) => unknown) { control.textChange = handler; return component; },
    };
    controls.push(control);
    callback(component as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addTextArea").mockImplementation(function (this: Setting, callback) {
    const control: ImperativeControl = { ...metadataFor(this), kind: "textarea" };
    const component = {
      inputEl: { type: "text" },
      setPlaceholder() { return component; },
      setValue() { return component; },
      onChange(handler: (value: string) => unknown) { control.textChange = handler; return component; },
    };
    controls.push(control);
    callback(component as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addDropdown").mockImplementation(function (this: Setting, callback) {
    const control: ImperativeControl = { ...metadataFor(this), kind: "dropdown" };
    const component = {
      addOption() { return component; },
      setValue() { return component; },
      onChange(handler: (value: string) => unknown) { control.textChange = handler; return component; },
    };
    controls.push(control);
    callback(component as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addToggle").mockImplementation(function (this: Setting, callback) {
    const control: ImperativeControl = { ...metadataFor(this), kind: "toggle" };
    const component = {
      setValue() { return component; },
      setDisabled() { return component; },
      onChange(handler: (value: boolean) => unknown) { control.toggleChange = handler; return component; },
    };
    controls.push(control);
    callback(component as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addButton").mockImplementation(function (this: Setting, callback) {
    const component = {
      setButtonText() { return component; },
      setDisabled() { return component; },
      setDestructive() { return component; },
      setCta() { return component; },
      onClick() { return component; },
    };
    callback(component as never);
    return this;
  });

  return {
    controls,
    restore() {
      vi.restoreAllMocks();
      if (originalHeading) Object.defineProperty(Setting.prototype, "setHeading", originalHeading);
      else Reflect.deleteProperty(Setting.prototype, "setHeading");
    },
  };
}

function captureImperative(settings = createSettings()) {
  const app = new App();
  const plugin = new LinaPlugin(app);
  plugin.settings = settings;
  const events: string[] = [];
  const saveSettings = vi.spyOn(plugin, "saveSettings").mockImplementation(async () => {
    events.push("save");
  });
  vi.spyOn(plugin, "updateVaultEventListeners").mockImplementation(() => {
    events.push("effect:update-vault-event-listeners");
  });
  vi.spyOn(plugin, "invalidateRuntimeEmbeddingIndex").mockImplementation(() => {
    events.push("effect:invalidate-runtime-embedding-index");
  });
  vi.spyOn(plugin, "markEmbeddingWorkStatusDirty").mockImplementation(() => {
    events.push("effect:mark-embeddings-dirty");
  });
  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, "current");
  const instrumentation = installImperativeControlCapture();
  const tab = new LinaSettingTab(app, plugin);
  tab.containerEl = { empty() {}, createEl() { return createElement(); } } as never;
  tab.display();

  return {
    plugin,
    events,
    saveSettings,
    deferNextSave() {
      const pending = deferredVoid();
      saveSettings.mockImplementationOnce(async () => {
        events.push("save-start");
        await pending.promise;
        events.push("save-success");
      });
      return pending;
    },
    control(section: string, name: string, kind: ImperativeControlKind): ImperativeControl {
      const control = instrumentation.controls.find((entry) => entry.section === section && entry.name === name && entry.kind === kind);
      if (!control) throw new Error(`Missing imperative control ${section}/${name}/${kind}.`);
      return control;
    },
    restore: instrumentation.restore,
  };
}

function createCandidate(initial: LinaSettings) {
  let snapshot: SettingsRuntimeSnapshot = { settings: structuredClone(initial) };
  let failSave = false;
  let failEffect = false;
  let deferredSave: ReturnType<typeof deferredVoid> | undefined;
  const events: string[] = [];
  const effects: SettingsRuntimeEffect[] = [];
  const scheduled: Array<() => void> = [];
  const candidate = createDeclarativeSettingsCandidateComposition({
    strings,
    configDir: ".obsidian",
    runtimeHost: {
      getSnapshot: () => snapshot,
      replaceSnapshot(next) { snapshot = next; },
      async saveSnapshot() {
        const pending = deferredSave;
        deferredSave = undefined;
        if (pending) {
          events.push("save-start");
          await pending.promise;
          events.push("save-success");
          return;
        }
        events.push("save");
        if (failSave) {
          failSave = false;
          throw new Error("synthetic save failure");
        }
      },
      getCurrentDeviceId: () => "current",
      async runEffect(effect) {
        effects.push(effect);
        events.push(`effect:${effect.type}`);
        if (failEffect) {
          failEffect = false;
          throw new Error("synthetic effect failure");
        }
      },
    },
    runtimeOptions: {
      globalDefaults: {
        autoUpdateIndexOnFileChanges: false,
        maxSuggestedTags: 8,
        maxInboxNotesToAnalyze: 10,
        hybridSearchTextWeight: 0.7,
        hybridSearchSemanticWeight: 0.3,
        interfaceLanguage: "pt-PT",
      },
    },
    lifecycle: {
      requestHostUpdate() { events.push("update"); },
      scheduleUpdate(callback) {
        scheduled.push(callback);
      },
    },
    connectionCredentials: {
      connectionPorts: {
        async testAnalysisConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; },
        async testEmbeddingsConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; },
      },
      credentialStatus: { getAvailability() { return { required: false, available: false }; } },
      credentialMutations: {
        async save() { return { ok: true, available: true }; },
        async clear() { return { ok: true, available: false }; },
      },
      getConnectionConfiguration: () => ({ provider: "ollama", model: "", baseUrl: "", timeout: "60", credentialAvailable: false }),
      getCredentialRef: (domain) => ({ deviceId: "current", domain }),
      confirmCredentialClear: async () => true,
    },
    binary: {
      getCurrentStatus: () => ({ status: "absent" as const }),
      check: async () => ({ status: "valid" as const }),
      createOrUpdate: async () => ({ status: "valid" as const }),
      remove: async () => undefined,
      confirmRemove: async () => true,
      getReadPreference: () => "jsonl" as const,
      getMaintainBinaryCopy: () => false,
    },
  });

  return {
    candidate,
    events,
    effects,
    snapshot: () => snapshot,
    failNextSave() { failSave = true; },
    failNextEffect() { failEffect = true; },
    deferNextSave() {
      const pending = deferredVoid();
      deferredSave = pending;
      return pending;
    },
    flushUpdate() {
      scheduled.shift()?.();
    },
  };
}

function captureCandidateDropdown(
  candidate: ReturnType<typeof createCandidate>["candidate"],
  id: string,
): (value: string) => unknown {
  const definition = candidate.definitions.find((entry) => entry.id === id);
  if (!definition || !("render" in definition)) throw new Error(`Missing candidate renderer ${id}.`);
  let onChange: ((value: string) => unknown) | undefined;
  const dropdown = {
    addOption() { return dropdown; },
    setValue() { return dropdown; },
    onChange(callback: (value: string) => unknown) { onChange = callback; return dropdown; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
  };
  const manualSetting = {
    setName() { return manualSetting; },
    setDesc() { return manualSetting; },
    addText() { return manualSetting; },
    addDropdown() { return manualSetting; },
  };
  const group = {
    addSetting(callback: (child: typeof manualSetting) => void) { callback(manualSetting); return group; },
    listEl: { createEl() {} },
  };
  definition.render(setting as never, group as never);
  if (!onChange) throw new Error(`Candidate renderer ${id} did not register a dropdown callback.`);
  return onChange;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings controls, persistence, and effects parity", () => {
  it("classifies the mutable C3 control surface without treating actions or status rows as controls", () => {
    const globalPersisted = [
      "embeddings-enabled", "check-sync-on-startup", "update-index-on-startup", "debug-index-updates",
      "excluded-folders", "excluded-path-terms", "excluded-content-terms", "yaml-enabled",
      "yaml-properties", "yaml-include-tags", "embedding-language", "inbox-folder", "inbox-max-notes",
      "hybrid-text-weight", "hybrid-semantic-weight", "max-suggested-tags", "interface-language",
    ];
    const localPersisted = [
      "device-name", "analysis-model", "analysis-base-url", "analysis-timeout", "embeddings-base-url",
      "embeddings-batch-size", "embeddings-timeout", "binary-maintenance",
    ];
    const persistedWithEffect = [
      "analysis-provider", "embeddings-provider", "embeddings-model", "binary-preference",
      "auto-update-index-on-file-changes",
    ];
    const actionOnly = [
      "analysis-credential", "test-analysis-connection", "embeddings-credential", "test-embeddings-connection",
      "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy",
    ];

    expect(new Set([...globalPersisted, ...localPersisted, ...persistedWithEffect, ...actionOnly]).size)
      .toBe(globalPersisted.length + localPersisted.length + persistedWithEffect.length + actionOnly.length);
    expect(actionOnly).not.toContain("binary-status");
    expect(actionOnly).not.toContain("analysis-test-feedback");
  });

  it("keeps a simple device-local mutation equivalent and preserves the other device", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      await imperative.control(strings.settingsDeviceSection, strings.settingsDeviceName, "text").textChange?.("  Renamed device  ");
      const candidateResult = await candidate.candidate.setControlValue("device-name", "  Renamed device  ");

      expect(candidateResult).toEqual({ ok: true });
      expect(imperative.plugin.settings.deviceSettingsById?.current?.deviceName).toBe("Renamed device");
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.deviceName).toBe("Renamed device");
      expect(imperative.plugin.settings.deviceSettingsById?.other).toEqual({ deviceName: "Other device", analysisProvider: "mistral" });
      expect(candidate.snapshot().settings.deviceSettingsById?.other).toEqual({ deviceName: "Other device", analysisProvider: "mistral" });
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toEqual(["save"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("rolls back device-name after save failure, preserves the other device, and resumes from the confirmed value", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      imperative.saveSettings.mockImplementationOnce(async () => {
        imperative.events.push("save");
        throw new Error("synthetic save failure");
      });
      await imperative.control(strings.settingsDeviceSection, strings.settingsDeviceName, "text").textChange?.("  Renamed device  ");

      candidate.failNextSave();
      expect(await candidate.candidate.setControlValue("device-name", "  Renamed device  ")).toEqual({ ok: false, error: "save-failed" });
      expect(imperative.plugin.settings.deviceSettingsById?.current?.deviceName).toBe("Current device");
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.deviceName).toBe("Current device");
      expect(imperative.plugin.settings.deviceSettingsById?.other).toEqual({ deviceName: "Other device", analysisProvider: "mistral" });
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toEqual(["save"]);

      await imperative.control(strings.settingsDeviceSection, strings.settingsDeviceName, "text").textChange?.("  Renamed device  ");
      expect(await candidate.candidate.setControlValue("device-name", "  Renamed device  ")).toEqual({ ok: true });
      expect(imperative.plugin.settings.deviceSettingsById?.current?.deviceName).toBe("Renamed device");
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.deviceName).toBe("Renamed device");
      expect(imperative.events).toEqual(["save", "save"]);
      expect(candidate.events).toEqual(["save", "save"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("does not let a late local save failure overwrite a later confirmed device-name", async () => {
    const imperative = captureImperative();
    try {
      const firstSave = imperative.deferNextSave();
      const deviceName = imperative.control(strings.settingsDeviceSection, strings.settingsDeviceName, "text").textChange;
      const firstChange = deviceName?.("First device");
      await Promise.resolve();
      await deviceName?.("Second device");
      firstSave.reject(new Error("synthetic save failure"));
      await firstChange;

      expect(imperative.plugin.settings.deviceSettingsById?.current?.deviceName).toBe("Second device");
      expect(imperative.events).toEqual(["save-start", "save"]);
    } finally {
      imperative.restore();
    }
  });

  it("rolls back a real embeddings-enabled callback on save failure and resumes from the confirmed value", async () => {
    const imperativeSettings = createSettings();
    const candidateSettings = createSettings();
    imperativeSettings.embeddingsEnabled = true;
    candidateSettings.embeddingsEnabled = true;
    const imperative = captureImperative(imperativeSettings);
    const candidate = createCandidate(candidateSettings);
    try {
      imperative.saveSettings.mockImplementationOnce(async () => {
        imperative.events.push("save");
        throw new Error("synthetic save failure");
      });
      const imperativeCallback = imperative.control(strings.settingsEmbeddingsSection, strings.settingsEnableEmbeddings, "toggle").toggleChange;
      await imperativeCallback?.(false);

      candidate.failNextSave();
      const candidateResult = await candidate.candidate.setControlValue("embeddings-enabled", false);

      expect(imperative.plugin.settings.embeddingsEnabled).toBe(true);
      expect(candidateResult).toEqual({ ok: false, error: "save-failed" });
      expect(candidate.snapshot().settings.embeddingsEnabled).toBe(true);
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toEqual(["save"]);

      await imperativeCallback?.(false);
      expect(await candidate.candidate.setControlValue("embeddings-enabled", false)).toEqual({ ok: true });
      expect(imperative.plugin.settings.embeddingsEnabled).toBe(false);
      expect(candidate.snapshot().settings.embeddingsEnabled).toBe(false);
      expect(imperative.events).toEqual(["save", "save"]);
      expect(candidate.events).toEqual(["save", "save"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("rolls back check-sync-on-startup after save failure and resumes from the confirmed value", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      imperative.saveSettings.mockImplementationOnce(async () => {
        imperative.events.push("save");
        throw new Error("synthetic save failure");
      });
      const callback = imperative.control(strings.settingsIndexSection, strings.settingsCheckSyncOnStartup, "toggle").toggleChange;
      await callback?.(true);

      candidate.failNextSave();
      expect(await candidate.candidate.setControlValue("check-sync-on-startup", true)).toEqual({ ok: false, error: "save-failed" });
      expect(imperative.plugin.settings.checkSyncOnStartup).toBe(false);
      expect(candidate.snapshot().settings.checkSyncOnStartup).toBe(false);
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toEqual(["save"]);

      await callback?.(true);
      expect(await candidate.candidate.setControlValue("check-sync-on-startup", true)).toEqual({ ok: true });
      expect(imperative.plugin.settings.checkSyncOnStartup).toBe(true);
      expect(candidate.snapshot().settings.checkSyncOnStartup).toBe(true);
      expect(imperative.events).toEqual(["save", "save"]);
      expect(candidate.events).toEqual(["save", "save"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("does not let a late global save failure overwrite a later confirmed value", async () => {
    const imperative = captureImperative();
    try {
      const firstSave = imperative.deferNextSave();
      const checkSync = imperative.control(strings.settingsIndexSection, strings.settingsCheckSyncOnStartup, "toggle").toggleChange;
      const firstChange = checkSync?.(true);
      await Promise.resolve();
      await checkSync?.(false);
      firstSave.reject(new Error("synthetic save failure"));
      await firstChange;

      expect(imperative.plugin.settings.checkSyncOnStartup).toBe(false);
      expect(imperative.events).toEqual(["save-start", "save"]);
    } finally {
      imperative.restore();
    }
  });

  it("does not let a late embeddings-enabled save failure overwrite a later confirmed value", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      const imperativeEmbeddingsSave = imperative.deferNextSave();
      const embeddingsEnabled = imperative.control(strings.settingsEmbeddingsSection, strings.settingsEnableEmbeddings, "toggle").toggleChange;
      const imperativeEmbeddingsFirst = embeddingsEnabled?.(false);
      await Promise.resolve();
      await embeddingsEnabled?.(true);
      imperativeEmbeddingsSave.reject(new Error("synthetic save failure"));
      await imperativeEmbeddingsFirst;

      const candidateEmbeddingsSave = candidate.deferNextSave();
      const candidateEmbeddingsFirst = candidate.candidate.setControlValue("embeddings-enabled", false);
      await Promise.resolve();
      const candidateEmbeddingsSecond = candidate.candidate.setControlValue("embeddings-enabled", true);
      candidateEmbeddingsSave.reject(new Error("synthetic save failure"));
      await Promise.all([candidateEmbeddingsFirst, candidateEmbeddingsSecond]);

      expect(imperative.plugin.settings.embeddingsEnabled).toBe(true);
      expect(candidate.snapshot().settings.embeddingsEnabled).toBe(true);
      expect(imperative.events).toEqual(["save-start", "save"]);
      expect(candidate.events).toEqual(["save-start", "save"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("does not let a late analysis provider save failure restore over the confirmed provider triple", async () => {
    const imperativeSettings = createSettings();
    const candidateSettings = createSettings();
    Object.assign(imperativeSettings.deviceSettingsById!.current!, {
      analysisBaseUrl: "https://custom.example.invalid/v1",
      analysisModel: "custom-analysis",
    });
    Object.assign(candidateSettings.deviceSettingsById!.current!, {
      analysisBaseUrl: "https://custom.example.invalid/v1",
      analysisModel: "custom-analysis",
    });
    const imperative = captureImperative(imperativeSettings);
    const candidate = createCandidate(candidateSettings);
    try {
      const imperativeProviderSave = imperative.deferNextSave();
      const analysisProvider = imperative.control(strings.settingsAnalysisSection, strings.settingsProvider, "dropdown").textChange;
      const imperativeProviderFirst = analysisProvider?.("mistral");
      await Promise.resolve();
      await analysisProvider?.("openrouter");
      const imperativeSnapshotB = { ...imperative.plugin.settings.deviceSettingsById?.current };
      imperativeProviderSave.reject(new Error("synthetic save failure"));
      await imperativeProviderFirst;

      const candidateProviderSave = candidate.deferNextSave();
      const candidateProviderFirst = captureCandidateDropdown(candidate.candidate, "analysis-provider")("mistral");
      await Promise.resolve();
      const candidateProviderSecond = captureCandidateDropdown(candidate.candidate, "analysis-provider")("openrouter");
      candidateProviderSave.reject(new Error("synthetic save failure"));
      await Promise.all([candidateProviderFirst, candidateProviderSecond]);

      expect(imperativeSnapshotB).toMatchObject({ analysisProvider: "openrouter" });
      expect(imperative.plugin.settings.deviceSettingsById?.current).toEqual(imperativeSnapshotB);
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toEqual(imperativeSnapshotB);
      expect(imperative.events).toEqual(["save-start", "save"]);
      expect(candidate.events).toEqual(["save-start", "save", "effect:refresh-model-options"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("does not let a late embeddings provider save failure restore over the confirmed provider triple or dirty effect", async () => {
    const imperativeSettings = createSettings();
    const candidateSettings = createSettings();
    Object.assign(imperativeSettings.deviceSettingsById!.current!, {
      embeddingsBaseUrl: "https://custom-embeddings.example.invalid/v1",
      embeddingsModel: "custom-embedding",
    });
    Object.assign(candidateSettings.deviceSettingsById!.current!, {
      embeddingsBaseUrl: "https://custom-embeddings.example.invalid/v1",
      embeddingsModel: "custom-embedding",
    });
    const imperative = captureImperative(imperativeSettings);
    const candidate = createCandidate(candidateSettings);
    try {
      const imperativeEmbeddingProviderSave = imperative.deferNextSave();
      const embeddingsProvider = imperative.control(strings.settingsEmbeddingsSection, "Provider", "dropdown").textChange;
      const imperativeEmbeddingProviderFirst = embeddingsProvider?.("mistral");
      await Promise.resolve();
      await embeddingsProvider?.("openrouter");
      const imperativeSnapshotB = { ...imperative.plugin.settings.deviceSettingsById?.current };
      imperativeEmbeddingProviderSave.reject(new Error("synthetic save failure"));
      await imperativeEmbeddingProviderFirst;

      const candidateEmbeddingProviderSave = candidate.deferNextSave();
      const candidateEmbeddingProviderFirst = captureCandidateDropdown(candidate.candidate, "embeddings-provider")("mistral");
      await Promise.resolve();
      const candidateEmbeddingProviderSecond = captureCandidateDropdown(candidate.candidate, "embeddings-provider")("openrouter");
      candidateEmbeddingProviderSave.reject(new Error("synthetic save failure"));
      await Promise.all([candidateEmbeddingProviderFirst, candidateEmbeddingProviderSecond]);

      expect(imperativeSnapshotB).toMatchObject({ embeddingsProvider: "openrouter" });
      expect(imperative.plugin.settings.deviceSettingsById?.current).toEqual(imperativeSnapshotB);
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toEqual(imperativeSnapshotB);
      expect(imperative.events).toEqual(["save-start", "save", "effect:mark-embeddings-dirty"]);
      expect(candidate.events).toEqual(["save-start", "save", "effect:mark-embeddings-dirty", "effect:refresh-model-options"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("runs local effects only after persistence is confirmed", async () => {
      const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      const imperativeModelSave = imperative.deferNextSave();
      const imperativeModelChange = imperative.control(strings.settingsEmbeddingsSection, strings.settingsModel, "dropdown").textChange?.("mistral-embed");
      expect(imperative.events).toEqual(["save-start"]);
      imperativeModelSave.resolve();
      await imperativeModelChange;
      expect(imperative.events).toEqual(["save-start", "save-success", "effect:mark-embeddings-dirty"]);

      const candidateModelSave = candidate.deferNextSave();
      const candidateModelChange = captureCandidateDropdown(candidate.candidate, "embeddings-model")("mistral-embed");
      await Promise.resolve();
      expect(candidate.events).toEqual(["save-start"]);
      candidateModelSave.resolve();
      await candidateModelChange;
      candidate.flushUpdate();
      expect(candidate.events).toEqual([
        "save-start",
        "save-success",
        "effect:mark-embeddings-dirty",
        "update",
      ]);

      const imperativeBinarySave = imperative.deferNextSave();
      const imperativeBinaryChange = imperative.control(strings.settingsBinarySection, strings.settingsBinaryPreference, "dropdown").textChange?.("prefer-binary");
      expect(imperative.events).toEqual([
        "save-start",
        "save-success",
        "effect:mark-embeddings-dirty",
        "save-start",
      ]);
      imperativeBinarySave.resolve();
      await imperativeBinaryChange;
      expect(imperative.events).toEqual([
        "save-start",
        "save-success",
        "effect:mark-embeddings-dirty",
        "save-start",
        "save-success",
        "effect:invalidate-runtime-embedding-index",
      ]);

      const candidateBinarySave = candidate.deferNextSave();
      const candidateBinaryChange = captureCandidateDropdown(candidate.candidate, "binary-preference")("prefer-binary");
      await Promise.resolve();
      expect(candidate.events).toEqual([
        "save-start",
        "save-success",
        "effect:mark-embeddings-dirty",
        "update",
        "save-start",
      ]);
      candidateBinarySave.resolve();
      await candidateBinaryChange;
      candidate.flushUpdate();
      expect(candidate.events).toEqual([
        "save-start",
        "save-success",
        "effect:mark-embeddings-dirty",
        "update",
        "save-start",
        "save-success",
        "effect:invalidate-runtime-embedding-index",
        "update",
      ]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("skips embeddings-model and binary-preference effects after save failure", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      imperative.saveSettings.mockImplementationOnce(async () => {
        imperative.events.push("save");
        throw new Error("synthetic save failure");
      });
      await imperative.control(strings.settingsEmbeddingsSection, strings.settingsModel, "dropdown").textChange?.("mistral-embed");
      candidate.failNextSave();
      await captureCandidateDropdown(candidate.candidate, "embeddings-model")("mistral-embed");
      expect(imperative.plugin.settings.deviceSettingsById?.current?.embeddingsModel).toBe("nomic-embed-text-v2-moe");
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.embeddingsModel).toBe("nomic-embed-text-v2-moe");
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toEqual(["save"]);

      imperative.saveSettings.mockImplementationOnce(async () => {
        imperative.events.push("save");
        throw new Error("synthetic save failure");
      });
      await imperative.control(strings.settingsBinarySection, strings.settingsBinaryPreference, "dropdown").textChange?.("prefer-binary");
      candidate.failNextSave();
      await captureCandidateDropdown(candidate.candidate, "binary-preference")("prefer-binary");
      expect(imperative.plugin.settings.deviceSettingsById?.current?.embeddingStorageReadPreference).toBeUndefined();
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.embeddingStorageReadPreference).toBeUndefined();
      expect(imperative.events).toEqual(["save", "save"]);
      expect(candidate.events).toEqual(["save", "save"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("keeps embeddings-model and binary-preference changes after post-save effect failure without another save", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      vi.mocked(imperative.plugin.markEmbeddingWorkStatusDirty).mockImplementationOnce(() => {
        imperative.events.push("effect:mark-embeddings-dirty");
        throw new Error("synthetic effect failure");
      });
      await expect(Promise.resolve(
        imperative.control(strings.settingsEmbeddingsSection, strings.settingsModel, "dropdown").textChange?.("mistral-embed"),
      )).rejects.toThrow("synthetic effect failure");
      candidate.failNextEffect();
      await captureCandidateDropdown(candidate.candidate, "embeddings-model")("mistral-embed");
      expect(imperative.plugin.settings.deviceSettingsById?.current?.embeddingsModel).toBe("mistral-embed");
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.embeddingsModel).toBe("mistral-embed");
      expect(imperative.events).toEqual(["save", "effect:mark-embeddings-dirty"]);
      expect(candidate.events).toEqual(["save", "effect:mark-embeddings-dirty"]);

      vi.mocked(imperative.plugin.invalidateRuntimeEmbeddingIndex).mockImplementationOnce(() => {
        imperative.events.push("effect:invalidate-runtime-embedding-index");
        throw new Error("synthetic effect failure");
      });
      await expect(Promise.resolve(
        imperative.control(strings.settingsBinarySection, strings.settingsBinaryPreference, "dropdown").textChange?.("prefer-binary"),
      )).rejects.toThrow("synthetic effect failure");
      candidate.failNextEffect();
      await captureCandidateDropdown(candidate.candidate, "binary-preference")("prefer-binary");
      expect(imperative.plugin.settings.deviceSettingsById?.current?.embeddingStorageReadPreference).toBe("prefer-binary");
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.embeddingStorageReadPreference).toBe("prefer-binary");
      expect(imperative.events).toEqual([
        "save",
        "effect:mark-embeddings-dirty",
        "save",
        "effect:invalidate-runtime-embedding-index",
      ]);
      expect(candidate.events).toEqual([
        "save",
        "effect:mark-embeddings-dirty",
        "save",
        "effect:invalidate-runtime-embedding-index",
      ]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("persists analysis provider defaults atomically and preserves custom values", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      await imperative.control(strings.settingsAnalysisSection, strings.settingsProvider, "dropdown").textChange?.("mistral");
      await captureCandidateDropdown(candidate.candidate, "analysis-provider")("mistral");
      candidate.flushUpdate();

      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        analysisProvider: "mistral",
        analysisBaseUrl: "https://api.mistral.ai/v1",
        analysisModel: "mistral-small-latest",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject({
        analysisProvider: "mistral",
        analysisBaseUrl: "https://api.mistral.ai/v1",
        analysisModel: "mistral-small-latest",
      });
      expect(candidate.effects).toEqual([{ type: "refresh-model-options" }]);
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toEqual([
        "save",
        "effect:refresh-model-options",
        "update",
      ]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("materializes analysis defaults when the device values are empty", async () => {
    const imperativeSettings = createSettings();
    const candidateSettings = createSettings();
    delete imperativeSettings.deviceSettingsById!.current!.analysisBaseUrl;
    delete imperativeSettings.deviceSettingsById!.current!.analysisModel;
    delete candidateSettings.deviceSettingsById!.current!.analysisBaseUrl;
    delete candidateSettings.deviceSettingsById!.current!.analysisModel;
    const imperative = captureImperative(imperativeSettings);
    const candidate = createCandidate(candidateSettings);
    try {
      await imperative.control(strings.settingsAnalysisSection, strings.settingsProvider, "dropdown").textChange?.("mistral");
      await captureCandidateDropdown(candidate.candidate, "analysis-provider")("mistral");
      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        analysisProvider: "mistral",
        analysisBaseUrl: "https://api.mistral.ai/v1",
        analysisModel: "mistral-small-latest",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject(
        imperative.plugin.settings.deviceSettingsById?.current,
      );
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toContain("save");
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("preserves custom provider values and restores the full provider triple after save failure", async () => {
    const imperativeSettings = createSettings();
    const candidateSettings = createSettings();
    Object.assign(imperativeSettings.deviceSettingsById!.current!, {
      analysisBaseUrl: "https://custom.example.invalid/v1",
      analysisModel: "custom-analysis",
    });
    Object.assign(candidateSettings.deviceSettingsById!.current!, {
      analysisBaseUrl: "https://custom.example.invalid/v1",
      analysisModel: "custom-analysis",
    });
    const imperative = captureImperative(imperativeSettings);
    const candidate = createCandidate(candidateSettings);
    try {
      await imperative.control(strings.settingsAnalysisSection, strings.settingsProvider, "dropdown").textChange?.("mistral");
      await captureCandidateDropdown(candidate.candidate, "analysis-provider")("mistral");
      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        analysisProvider: "mistral",
        analysisBaseUrl: "https://custom.example.invalid/v1",
        analysisModel: "custom-analysis",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject(
        imperative.plugin.settings.deviceSettingsById?.current,
      );
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toContain("save");

      imperative.saveSettings.mockImplementationOnce(async () => {
        imperative.events.push("save");
        throw new Error("synthetic save failure");
      });
      candidate.failNextSave();
      await imperative.control(strings.settingsAnalysisSection, strings.settingsProvider, "dropdown").textChange?.("ollama");
      await captureCandidateDropdown(candidate.candidate, "analysis-provider")("ollama");
      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        analysisProvider: "mistral",
        analysisBaseUrl: "https://custom.example.invalid/v1",
        analysisModel: "custom-analysis",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject(
        imperative.plugin.settings.deviceSettingsById?.current,
      );
      expect(candidate.effects).toEqual([{ type: "refresh-model-options" }]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("persists embeddings provider defaults before its post-save dirty effect", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      await imperative.control(strings.settingsEmbeddingsSection, "Provider", "dropdown").textChange?.("mistral");
      await captureCandidateDropdown(candidate.candidate, "embeddings-provider")("mistral");
      candidate.flushUpdate();

      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        embeddingsProvider: "mistral",
        embeddingsBaseUrl: "https://api.mistral.ai/v1",
        embeddingsModel: "mistral-embed",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject(
        imperative.plugin.settings.deviceSettingsById?.current,
      );
      expect(imperative.events).toEqual(["save", "effect:mark-embeddings-dirty"]);
      expect(candidate.events).toEqual([
        "save",
        "effect:mark-embeddings-dirty",
        "effect:refresh-model-options",
        "update",
      ]);

      imperative.saveSettings.mockImplementationOnce(async () => {
        imperative.events.push("save");
        throw new Error("synthetic save failure");
      });
      candidate.failNextSave();
      await imperative.control(strings.settingsEmbeddingsSection, "Provider", "dropdown").textChange?.("ollama");
      await captureCandidateDropdown(candidate.candidate, "embeddings-provider")("ollama");
      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        embeddingsProvider: "mistral",
        embeddingsBaseUrl: "https://api.mistral.ai/v1",
        embeddingsModel: "mistral-embed",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject(
        imperative.plugin.settings.deviceSettingsById?.current,
      );
      expect(imperative.events).toEqual(["save", "effect:mark-embeddings-dirty", "save"]);
      expect(candidate.events).toEqual([
        "save",
        "effect:mark-embeddings-dirty",
        "effect:refresh-model-options",
        "update",
        "save",
      ]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("preserves custom embeddings provider values while still marking work dirty after save", async () => {
    const imperativeSettings = createSettings();
    const candidateSettings = createSettings();
    Object.assign(imperativeSettings.deviceSettingsById!.current!, {
      embeddingsBaseUrl: "https://custom-embeddings.example.invalid/v1",
      embeddingsModel: "custom-embedding",
    });
    Object.assign(candidateSettings.deviceSettingsById!.current!, {
      embeddingsBaseUrl: "https://custom-embeddings.example.invalid/v1",
      embeddingsModel: "custom-embedding",
    });
    const imperative = captureImperative(imperativeSettings);
    const candidate = createCandidate(candidateSettings);
    try {
      await imperative.control(strings.settingsEmbeddingsSection, "Provider", "dropdown").textChange?.("mistral");
      await captureCandidateDropdown(candidate.candidate, "embeddings-provider")("mistral");
      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        embeddingsProvider: "mistral",
        embeddingsBaseUrl: "https://custom-embeddings.example.invalid/v1",
        embeddingsModel: "custom-embedding",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject(
        imperative.plugin.settings.deviceSettingsById?.current,
      );
      expect(imperative.events).toEqual(["save", "effect:mark-embeddings-dirty"]);
      expect(candidate.effects).toEqual([
        { type: "mark-embeddings-dirty" },
        { type: "refresh-model-options" },
      ]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("keeps embeddings provider persistence after a post-save dirty effect failure without another save", async () => {
    const imperative = captureImperative();
    const candidate = createCandidate(createSettings());
    try {
      vi.mocked(imperative.plugin.markEmbeddingWorkStatusDirty).mockImplementationOnce(() => {
        imperative.events.push("effect:mark-embeddings-dirty");
        throw new Error("synthetic effect failure");
      });

      await expect(Promise.resolve(
        imperative.control(strings.settingsEmbeddingsSection, "Provider", "dropdown").textChange?.("mistral"),
      )).rejects.toThrow("synthetic effect failure");
      candidate.failNextEffect();
      await captureCandidateDropdown(candidate.candidate, "embeddings-provider")("mistral");

      expect(imperative.plugin.settings.deviceSettingsById?.current).toMatchObject({
        embeddingsProvider: "mistral",
        embeddingsBaseUrl: "https://api.mistral.ai/v1",
        embeddingsModel: "mistral-embed",
      });
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject(
        imperative.plugin.settings.deviceSettingsById?.current,
      );
      expect(imperative.events).toEqual(["save", "effect:mark-embeddings-dirty"]);
      expect(candidate.events).toEqual(["save", "effect:mark-embeddings-dirty"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });
});
