import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { DEFAULT_SETTINGS } from "../../src/settings";

describe("experimental binary embedding settings", () => {
  it("keeps safe effective defaults", () => {
    expect(DEFAULT_SETTINGS.deviceSettingsById).toEqual({});
    const source = readFileSync(resolve(process.cwd(), "src/settings.ts"), "utf8");
    expect(source).toContain('return ensureCurrentDeviceSettings().embeddingStorageReadPreference === "prefer-binary" ? "prefer-binary" : "jsonl"');
    expect(source).toContain("maintainBinaryEmbeddingCopy === true");
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
    expect(source).toContain("settingsBinarySection");
    expect(source).toContain('attr: { "aria-live": "polite" }');
    expect(source.indexOf("checkBinaryEmbeddingCopy()")).toBeGreaterThan(source.indexOf("settingsBinaryCheck"));
    expect(source).toContain('settingsBinaryStatusLegacyManifest');
    expect(source).toContain('binaryStatusReasonCode === "legacy-manifest"');
  });
});
