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
  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, "current");
  const instrumentation = installImperativeControlCapture();
  const tab = new LinaSettingTab(app, plugin);
  tab.containerEl = { empty() {}, createEl() { return createElement(); } } as never;
  tab.display();

  return {
    plugin,
    events,
    saveSettings,
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
  definition.render(setting as never, {} as never);
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

  it("records the material rollback divergence on a real embeddings-enabled callback", async () => {
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
      await expect(Promise.resolve(imperativeCallback?.(false))).rejects.toThrow("synthetic save failure");

      candidate.failNextSave();
      const candidateResult = await candidate.candidate.setControlValue("embeddings-enabled", false);

      expect(imperative.plugin.settings.embeddingsEnabled).toBe(false);
      expect(candidateResult).toEqual({ ok: false, error: "save-failed" });
      expect(candidate.snapshot().settings.embeddingsEnabled).toBe(true);
      expect(imperative.events).toEqual(["save"]);
      expect(candidate.events).toEqual(["save"]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });

  it("records the provider persistence/effect boundary divergence using both real dropdown callbacks", async () => {
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
      expect(candidate.snapshot().settings.deviceSettingsById?.current).toMatchObject({ analysisProvider: "mistral" });
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.analysisBaseUrl).toBe("http://localhost:11434");
      expect(candidate.snapshot().settings.deviceSettingsById?.current?.analysisModel).toBe("gemma4:e2b");
      expect(candidate.effects).toEqual([
        { type: "set-default-base-url", value: "https://api.mistral.ai/v1" },
        { type: "set-default-model", value: "mistral-small-latest" },
        { type: "refresh-model-options" },
      ]);
      expect(imperative.events).toEqual(["save", "save", "save"]);
      expect(candidate.events).toEqual([
        "save",
        "effect:set-default-base-url",
        "effect:set-default-model",
        "effect:refresh-model-options",
        "update",
      ]);
    } finally {
      candidate.candidate.dispose();
      imperative.restore();
    }
  });
});
