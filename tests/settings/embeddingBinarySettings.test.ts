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
    expect(pt.settingsBinaryPreference).toBe("Usar cache rápida quando disponível");
    expect(pt.settingsBinaryExperimentalWarning).toContain("Otimização de velocidade em memória");
    expect(en.settingsBinaryPreference).toBe("Use fast search cache when available");
    expect(en.settingsBinaryExperimentalWarning).toContain("High-speed in-memory optimization");
    for (const strings of [pt, en]) {
      expect(strings.settingsBinaryCheck).toBeTruthy();
      expect(strings.settingsBinaryCreate).toBeTruthy();
      expect(strings.settingsBinaryRemoveConfirm).toBeTruthy();
    }
  });

  it("uses the configured Obsidian folder in the exclusion note for PT-PT, English, and fallback", () => {
    const configDir = ".obsidian-escola";
    const pt = getStrings("pt-PT").settingsExclusionsNote.replace("{configDir}", configDir);
    const en = getStrings("en").settingsExclusionsNote.replace("{configDir}", configDir);
    const fallback = getStrings().settingsExclusionsNote.replace("{configDir}", configDir);
    const rendererSource = readFileSync(resolve(process.cwd(), "src/settings/declarativeSettingRenderers.ts"), "utf8");

    expect(pt).toBe("As pastas .lina/ e .obsidian-escola/ são sempre excluídas automaticamente.");
    expect(en).toBe("The .lina/ and .obsidian-escola/ folders are always excluded automatically.");
    expect(fallback).toBe(pt);
    expect(pt).not.toContain(".obsidian/");
    expect(en).not.toContain(".obsidian/");
    expect(rendererSource).toContain('strings.settingsExclusionsNote.replace("{configDir}", configDir)');
  });

  it("starts derived maintenance only after the canonical generation token is released", () => {
    const main = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");
    const worker = readFileSync(resolve(process.cwd(), "src/maintenance/embeddingWorker.ts"), "utf8");
    const release = worker.indexOf("options.coordinator.finish(generationToken)");
    const maintenance = worker.indexOf("options.binaryHandoff.maintainAfterPublication(result.publicationId)");
    expect(release).toBeGreaterThan(-1);
    expect(maintenance).toBeGreaterThan(release);
    expect(main).not.toContain("getLocalMaintainBinaryEmbeddingCopy()");
    expect(readFileSync(resolve(process.cwd(), "src/maintenance/binaryWorker.ts"), "utf8"))
      .not.toContain("isAutomaticMaintenanceEnabled");
    expect(main).toContain("settingsBinaryAutomaticWarning");
  });

  it("renders passively and only invokes the controller from explicit button callbacks", () => {
    const source = readFileSync(resolve(process.cwd(), "src/settings/declarativeSettingsBinaryRenderers.ts"), "utf8");
    const pt = getStrings("pt-PT"); const en = getStrings("en");
    expect(source).toContain('attr: { "aria-live": "polite" }');
    expect(source).toContain("createCheckBinaryAction");
    expect(source).toContain("createCreateOrUpdateBinaryAction");
    expect(source).toContain("createRemoveBinaryRenderer");
    expect(source).toContain("setDestructive()");
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

  it("selects the runtime resource profile through device capabilities without persisting limits", () => {
    const main = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");
    const settings = readFileSync(resolve(process.cwd(), "src/settings.ts"), "utf8");
    const capabilities = readFileSync(resolve(process.cwd(), "src/capabilities/deviceCapabilities.ts"), "utf8");
    expect(main).toContain("getDeviceCapabilities().resourceProfile");
    expect(capabilities).toContain("resolveDeviceCapabilities(Platform)");
    expect(main).not.toContain("navigator.userAgent");
    expect(settings).not.toContain("maxEstimatedPeakBytes");
  });
});
