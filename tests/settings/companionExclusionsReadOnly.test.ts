import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { normalizeExclusionRules } from "../../src/index/exclusionPolicy";
import { getCompanionExclusionsReadOnlyFields } from "../../src/settings/declarativeSettingRenderers";

const rules = normalizeExclusionRules({
  excludedFolders: ["03_Pessoal/"],
  excludedPathContains: ["senha"],
  excludedContentContains: ["SEGREDO-LINA-TESTE"],
});

describe("Companion read-only exclusions", () => {
  it("shows the three effective canonical rule groups when the synchronized policy is loaded", () => {
    const strings = getStrings("pt-PT");
    expect(getCompanionExclusionsReadOnlyFields(strings, { status: "loaded", rules })).toEqual([
      [strings.settingsExcludedFolders, ["03_pessoal/"]],
      [strings.settingsExcludedTerms, ["senha"]],
      [strings.settingsExcludedContentTerms, ["segredo-lina-teste"]],
    ]);
  });

  it("does not expose local fallback values when the synchronized policy is unavailable or invalid", () => {
    const strings = getStrings("pt-PT");
    expect(getCompanionExclusionsReadOnlyFields(strings, { status: "missing", rules })).toEqual([]);
    expect(getCompanionExclusionsReadOnlyFields(strings, { status: "invalid", rules })).toEqual([]);
  });

  it("renders the effective values as disabled controls and names the Producer as their manager", () => {
    const source = readFileSync(resolve(process.cwd(), "src/settings/declarativeSettingRenderers.ts"), "utf8");
    expect(source).toContain("textarea.disabled = true;");
    expect(getStrings("pt-PT").settingsCompanionExclusionsManaged).toContain("Producer");
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Companion exclusions layout (mobile)", () => {
  const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");
  const block = (selector: string): string => {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("lays the read-only exclusions out in a single column", () => {
    expect(block(".setting-item.lina-settings-exclusions-readonly {")).toContain("flex-direction: column");
    expect(block(".lina-settings-exclusions-readonly .setting-item-control {")).toContain("flex-direction: column");
    expect(block(".lina-settings-exclusions-readonly .lina-settings-readonly-exclusion {")).toContain("flex-direction: column");
  });

  it("never forces a width wider than the viewport", () => {
    const section = css.slice(css.indexOf("/* Privacy & exclusions (Companion, read-only)"));
    expect(section).not.toMatch(/(?<!max-|min-)width:\s*\d+(\.\d+)?(px|rem|em)/);
    expect(block(".lina-settings-exclusions-readonly .lina-settings-readonly-exclusion-value {")).toContain("max-width: 100%");
  });
});
