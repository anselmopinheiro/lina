import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  captureImperativeSettings,
  installImperativeSettingsInstrumentation,
  restoreImperativeSettingsInstrumentation,
} from "./imperativeSettingsParityCapture";

vi.mock("../../src/settings/declarativeSettingsCandidateComposition", () => {
  throw new Error("The detached declarative candidate must not be used by the imperative harness.");
});

beforeEach(() => {
  installImperativeSettingsInstrumentation();
});

afterEach(() => {
  restoreImperativeSettingsInstrumentation();
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
