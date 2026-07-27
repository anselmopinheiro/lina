import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { DEFAULT_SETTINGS, getLocalEmbeddingStorageReadPreference, getLocalMaintainBinaryEmbeddingCopy, setDeviceSettingsContext, setLocalEmbeddingStorageReadPreference, setLocalMaintainBinaryEmbeddingCopy } from "../../src/settings";

describe("experimental binary embedding settings", () => {
  it("keeps safe effective defaults", () => {
    expect(DEFAULT_SETTINGS.deviceSettingsById).toEqual({});
    const source = readFileSync(resolve(process.cwd(), "src/settings.ts"), "utf8");
    expect(source).toContain('return ensureCurrentDeviceSettings().embeddingStorageReadPreference === "prefer-binary" ? "prefer-binary" : "jsonl"');
    expect(source).toContain("maintainBinaryEmbeddingCopy === true");
  });

  it("keeps desktop and mobile binary preferences isolated by device id", () => {
    const settings = { ...DEFAULT_SETTINGS, deviceSettingsById: {} };
    setDeviceSettingsContext(settings, () => undefined, "desktop-test");
    setLocalEmbeddingStorageReadPreference("jsonl");
    setLocalMaintainBinaryEmbeddingCopy(true);
    setDeviceSettingsContext(settings, () => undefined, "mobile-test");
    expect(getLocalEmbeddingStorageReadPreference()).toBe("jsonl");
    expect(getLocalMaintainBinaryEmbeddingCopy()).toBe(false);
    setLocalEmbeddingStorageReadPreference("prefer-binary");
    setLocalMaintainBinaryEmbeddingCopy(false);
    setDeviceSettingsContext(settings, () => undefined, "desktop-test");
    expect(getLocalEmbeddingStorageReadPreference()).toBe("jsonl");
    expect(getLocalMaintainBinaryEmbeddingCopy()).toBe(true);
    setDeviceSettingsContext(settings, () => undefined, "mobile-test");
    expect(getLocalEmbeddingStorageReadPreference()).toBe("prefer-binary");
    expect(getLocalMaintainBinaryEmbeddingCopy()).toBe(false);
  });

  it("provides the complete experimental section in PT-PT and English", () => {
    const pt = getStrings("pt-PT"); const en = getStrings("en");
    expect(pt.settingsBinaryPreference).toBe("Preferir cópia binária válida");
    expect(pt.settingsBinaryExperimentalWarning).toContain("Funcionalidade experimental");
    expect(en.settingsBinaryPreference).toBe("Prefer a valid binary copy");
    expect(en.settingsBinaryExperimentalWarning).toContain("Experimental feature");
    for (const strings of [pt, en]) {
      expect(strings.settingsBinaryCheck).toBeTruthy();
      expect(strings.settingsBinaryCreate).toBeTruthy();
      expect(strings.settingsBinaryRemoveConfirm).toBeTruthy();
    }
  });

  it("starts derived maintenance only after the canonical generation token is released", () => {
    const main = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");
    const release = main.indexOf("this.getIndexWriteCoordinator().finish(generationToken)");
    const maintenance = main.lastIndexOf("this.startAutomaticBinaryEmbeddingMaintenance(");
    expect(release).toBeGreaterThan(-1);
    expect(maintenance).toBeGreaterThan(release);
    expect(main).toContain("getLocalMaintainBinaryEmbeddingCopy()");
    expect(main).toContain("settingsBinaryAutomaticWarning");
  });

  it("renders passively and only invokes the controller from explicit button callbacks", () => {
    const source = readFileSync(resolve(process.cwd(), "src/settings.ts"), "utf8");
    const pt = getStrings("pt-PT"); const en = getStrings("en");
    expect(source).toContain("settingsBinarySection");
    expect(source).toContain('attr: { "aria-live": "polite" }');
    expect(source.indexOf("checkBinaryEmbeddingCopy()")).toBeGreaterThan(source.indexOf("settingsBinaryCheck"));
    expect(source).toContain('settingsBinaryStatusLegacyManifest');
    expect(source).toContain('binaryStatusReasonCode === "legacy-manifest"');
    expect(source).toContain("getEmbeddingReadDiagnosticState()");
    expect(source).toContain("settingsBinaryNotLoaded");
    expect(source).toContain("settingsBinaryEffectiveSource");
    expect(source).toContain("settingsBinaryLastLoad");
    expect(source).toContain('"resource-limit"');
    expect(source).toContain('"no-safe-source"');
    expect(source).toContain('readDiagnostic.configuredPreference === "prefer-binary" ? this.L.settingsBinaryFallback : this.L.settingsBinaryReadReason');
    expect(source).toContain("settingsBinaryMaintenanceState");
    expect(source).toContain("settingsBinaryCopyState");
    expect(source).toContain("Math.max(1, Math.round(readDiagnostic.loadDurationMs))");
    expect(source).not.toContain("binarySourcePublicationId}`");
    expect(pt.settingsBinaryNotLoaded).toContain("Ainda não carregada");
    expect(en.settingsBinaryNotLoaded).toContain("Not loaded");
    expect(pt.settingsEmbeddingSourceMemoryLimit).toContain("limite de memória seguro");
    expect(en.settingsEmbeddingSourceMemoryLimit).toContain("safe memory limit");
    expect(pt.settingsBinaryMaintenanceState).toBe("Manutenção automática");
    expect(pt.settingsBinaryCopyState).toBe("Estado da cópia");
    expect(pt.settingsBinaryReadReason).toBe("Motivo da leitura");
    expect(en.settingsBinaryMaintenanceState).toBe("Automatic maintenance");
    expect(en.settingsBinaryCopyState).toBe("Copy state");
  });

  it("selects the runtime resource profile from Obsidian Platform without persisting limits", () => {
    const main = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");
    const settings = readFileSync(resolve(process.cwd(), "src/settings.ts"), "utf8");
    expect(main).toContain('Platform.isMobile ? "mobile" : "desktop"');
    expect(main).not.toContain("navigator.userAgent");
    expect(settings).not.toContain("maxEstimatedPeakBytes");
  });
});
