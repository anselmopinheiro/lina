import { App, Setting } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  DEFAULT_SETTINGS,
  LinaSettingTab,
  type LinaSettings,
  setDeviceSettingsContext,
} from "../../src/settings";
import type { BinaryEmbeddingMaintenanceState } from "../../src/index/embeddingBinaryCopyController";
import type { EmbeddingReadDiagnosticState } from "../../src/search/runtimeEmbeddingIndex";
import { getStrings } from "../../src/i18n/strings";
import { ImperativeSettingsParityHarness, type ImperativeSettingsManifest } from "./imperativeSettingsParityHarness";

vi.mock("../../src/settings/declarativeSettingsCandidateComposition", () => {
  throw new Error("The detached declarative candidate must not be used by the imperative harness.");
});

let activeHarness: ImperativeSettingsParityHarness | undefined;
let originalSetHeading: PropertyDescriptor | undefined;

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
    setDestructive() { return this; },
    setCta() { return this; },
    onClick() { harness.markOnClick(setting, index); return this; },
  };
}

function installSettingInstrumentation(): void {
  originalSetHeading = Object.getOwnPropertyDescriptor(Setting.prototype, "setHeading");
  Object.defineProperty(Setting.prototype, "setHeading", {
    configurable: true,
    value(this: Setting) { activeHarness?.setHeading(this); return this; },
  });
  vi.spyOn(Setting.prototype, "setName").mockImplementation(function (this: Setting, name: string) {
    activeHarness?.setName(this, name);
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

function createSettings(): LinaSettings {
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

function captureImperativeSettings(): {
  manifest: ImperativeSettingsManifest;
  saveSettings: ReturnType<typeof vi.spyOn>;
  saveData: ReturnType<typeof vi.spyOn>;
  binaryState: ReturnType<typeof vi.spyOn>;
  readDiagnostic: ReturnType<typeof vi.spyOn>;
  checkBinary: ReturnType<typeof vi.spyOn>;
  createBinary: ReturnType<typeof vi.spyOn>;
  removeBinary: ReturnType<typeof vi.spyOn>;
} {
  const app = new App();
  const plugin = new LinaPlugin(app);
  plugin.settings = createSettings();
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

beforeEach(() => {
  installSettingInstrumentation();
});

afterEach(() => {
  activeHarness = undefined;
  vi.restoreAllMocks();
  if (originalSetHeading) Object.defineProperty(Setting.prototype, "setHeading", originalSetHeading);
  else Reflect.deleteProperty(Setting.prototype, "setHeading");
});

describe("imperative settings parity harness", () => {
  it("observes the real imperative display without invoking callbacks or side effects", () => {
    const capture = captureImperativeSettings();
    const strings = getStrings("pt-PT");

    expect(capture.manifest.items.length).toBeGreaterThan(0);
    expect(capture.manifest.items.some((item) => item.kind === "heading" && item.name === strings.settingsAnalysisSection)).toBe(true);
    expect(capture.manifest.items.some((item) => item.name === strings.settingsDeviceName && item.section === strings.settingsDeviceSection && item.controlKinds.includes("text"))).toBe(true);
    expect(capture.manifest.items.some((item) => item.description === strings.settingsBaseUrlAutoDesc)).toBe(true);
    expect(capture.manifest.items.some((item) => item.controls.some((control) => control.inputType === "password"))).toBe(true);
    expect(capture.manifest.items.some((item) => item.controls.some((control) => control.hasInitialValue))).toBe(true);
    expect(capture.manifest.items.some((item) => item.controls.some((control) => control.disabled === false))).toBe(true);
    expect(capture.manifest.items.some((item) => item.controls.some((control) => control.hasOnChange))).toBe(true);
    expect(capture.manifest.items.some((item) => item.controls.some((control) => control.hasOnClick))).toBe(true);
    expect(capture.saveSettings).not.toHaveBeenCalled();
    expect(capture.saveData).not.toHaveBeenCalled();
    expect(capture.binaryState).toHaveBeenCalledTimes(1);
    expect(capture.readDiagnostic).toHaveBeenCalledTimes(1);
    expect(capture.checkBinary).not.toHaveBeenCalled();
    expect(capture.createBinary).not.toHaveBeenCalled();
    expect(capture.removeBinary).not.toHaveBeenCalled();
  });

  it("produces a deterministic, serializable, secret-free manifest", () => {
    const first = captureImperativeSettings().manifest;
    const second = captureImperativeSettings().manifest;
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(second.items).not.toBe(first.items);
    expect(() => JSON.stringify(first)).not.toThrow();
    expect(JSON.parse(serialized)).toEqual(first);
    expect(serialized).not.toContain("SUPER_SECRET_SENTINEL");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("harness-device");
    expect(serialized).not.toContain("function");
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});
