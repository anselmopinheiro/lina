import { App, Setting } from "obsidian";
import { vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  DEFAULT_SETTINGS,
  LinaSettingTab,
  type LinaSettings,
  setDeviceSettingsContext,
} from "../../src/settings";
import type { BinaryEmbeddingMaintenanceState } from "../../src/index/embeddingBinaryCopyController";
import type { EmbeddingReadDiagnosticState } from "../../src/search/runtimeEmbeddingIndex";
import { ImperativeSettingsParityHarness, type ImperativeSettingsManifest } from "./imperativeSettingsParityHarness";

let activeHarness: ImperativeSettingsParityHarness | undefined;
let originalSetHeading: PropertyDescriptor | undefined;

function createDescriptionElement() {
  const element = {
    createEl() { return element; },
    createSpan() { return element; },
    setText() {},
  };
  return element;
}

function createTextComponent(harness: ImperativeSettingsParityHarness, setting: Setting, index: number) {
  let inputType = "text";
  return {
    inputEl: {
      get type() { return inputType; },
      set type(value: string) { inputType = value; harness.markInputType(setting, index, value); },
    },
    setPlaceholder() { harness.markPlaceholder(setting, index); return this; },
    setValue() { harness.markInitialValue(setting, index); return this; },
    onChange() { harness.markOnChange(setting, index); return this; },
  };
}

function createDropdownComponent(harness: ImperativeSettingsParityHarness, setting: Setting, index: number) {
  return {
    addOption() { return this; },
    setValue() { harness.markInitialValue(setting, index); return this; },
    onChange() { harness.markOnChange(setting, index); return this; },
  };
}

function createToggleComponent(harness: ImperativeSettingsParityHarness, setting: Setting, index: number) {
  return {
    setValue() { harness.markInitialValue(setting, index); return this; },
    setDisabled(value: boolean) { harness.markDisabled(setting, index, value); return this; },
    onChange() { harness.markOnChange(setting, index); return this; },
  };
}

function createButtonComponent(harness: ImperativeSettingsParityHarness, setting: Setting, index: number) {
  return {
    setButtonText(label: string) { harness.markButtonText(setting, index, label); return this; },
    setDisabled(value: boolean) { harness.markDisabled(setting, index, value); return this; },
    setDestructive() { harness.markDestructive(setting, index); return this; },
    setCta() { return this; },
    onClick() { harness.markOnClick(setting, index); return this; },
  };
}

export function installImperativeSettingsInstrumentation(): void {
  originalSetHeading = Object.getOwnPropertyDescriptor(Setting.prototype, "setHeading");
  Object.defineProperty(Setting.prototype, "setHeading", {
    configurable: true,
    value(this: Setting) { activeHarness?.setHeading(this); return this; },
  });
  vi.spyOn(Setting.prototype, "setName").mockImplementation(function (this: Setting, name: string) {
    activeHarness?.setName(this, name);
    if (!Reflect.get(this, "descEl")) Object.defineProperty(this, "descEl", { configurable: true, value: createDescriptionElement() });
    return this;
  });
  vi.spyOn(Setting.prototype, "setDesc").mockImplementation(function (this: Setting, description: string) {
    activeHarness?.setDescription(this, description);
    return this;
  });
  vi.spyOn(Setting.prototype, "addText").mockImplementation(function (this: Setting, callback) {
    const index = activeHarness?.addControl(this, "text");
    if (activeHarness && index !== undefined) callback(createTextComponent(activeHarness, this, index) as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addTextArea").mockImplementation(function (this: Setting, callback) {
    const index = activeHarness?.addControl(this, "textarea");
    if (activeHarness && index !== undefined) callback(createTextComponent(activeHarness, this, index) as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addDropdown").mockImplementation(function (this: Setting, callback) {
    const index = activeHarness?.addControl(this, "dropdown");
    if (activeHarness && index !== undefined) callback(createDropdownComponent(activeHarness, this, index) as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addToggle").mockImplementation(function (this: Setting, callback) {
    const index = activeHarness?.addControl(this, "toggle");
    if (activeHarness && index !== undefined) callback(createToggleComponent(activeHarness, this, index) as never);
    return this;
  });
  vi.spyOn(Setting.prototype, "addButton").mockImplementation(function (this: Setting, callback) {
    const index = activeHarness?.addControl(this, "button");
    if (activeHarness && index !== undefined) callback(createButtonComponent(activeHarness, this, index) as never);
    return this;
  });
}

export function restoreImperativeSettingsInstrumentation(): void {
  activeHarness = undefined;
  vi.restoreAllMocks();
  if (originalSetHeading) Object.defineProperty(Setting.prototype, "setHeading", originalSetHeading);
  else Reflect.deleteProperty(Setting.prototype, "setHeading");
  originalSetHeading = undefined;
}

export function createImperativeParitySettings(): LinaSettings {
  return {
    ...DEFAULT_SETTINGS,
    aiProfiles: DEFAULT_SETTINGS.aiProfiles.map((profile) => ({ ...profile })),
    aiProvider: "mistral",
    embeddingProvider: "mistral",
    deviceSettingsById: {
      "harness-device": {
        analysisProvider: "mistral",
        analysisApiKey: "SUPER_SECRET_SENTINEL",
        embeddingsProvider: "mistral",
        embeddingsApiKey: "SUPER_SECRET_SENTINEL",
      },
    },
  };
}

export interface ImperativeSettingsCapture {
  manifest: ImperativeSettingsManifest;
  saveSettings: ReturnType<typeof vi.spyOn>;
  saveData: ReturnType<typeof vi.spyOn>;
  binaryState: ReturnType<typeof vi.spyOn>;
  readDiagnostic: ReturnType<typeof vi.spyOn>;
  checkBinary: ReturnType<typeof vi.spyOn>;
  createBinary: ReturnType<typeof vi.spyOn>;
  removeBinary: ReturnType<typeof vi.spyOn>;
}

export function captureImperativeSettings(): ImperativeSettingsCapture {
  const app = new App();
  const plugin = new LinaPlugin(app);
  plugin.settings = createImperativeParitySettings();
  setDeviceSettingsContext(plugin.settings, () => {}, "harness-device");

  const saveSettings = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
  const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue();
  const binaryState = vi.spyOn(plugin, "getBinaryEmbeddingCopyMaintenanceState").mockReturnValue({ phase: "idle" } satisfies BinaryEmbeddingMaintenanceState);
  const readDiagnostic = vi.spyOn(plugin, "getEmbeddingReadDiagnosticState").mockReturnValue({
    configuredPreference: "jsonl",
    effectiveSource: "not-loaded",
    fallbackReason: "none",
  } satisfies EmbeddingReadDiagnosticState);
  const checkBinary = vi.spyOn(plugin, "checkBinaryEmbeddingCopy");
  const createBinary = vi.spyOn(plugin, "createOrUpdateBinaryEmbeddingCopy");
  const removeBinary = vi.spyOn(plugin, "removeBinaryEmbeddingCopy");
  const tab = new LinaSettingTab(app, plugin);
  const harness = new ImperativeSettingsParityHarness();
  activeHarness = harness;
  tab.containerEl = harness.createContainer() as never;
  tab.display();
  activeHarness = undefined;
  return { manifest: harness.snapshot(), saveSettings, saveData, binaryState, readDiagnostic, checkBinary, createBinary, removeBinary };
}
