import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { DECLARATIVE_GLOBAL_SETTING_KEYS } from "../../src/settings/declarativeGlobalSettings";
import { createPureGlobalSettingsComposition } from "../../src/settings/pureGlobalSettingsComposition";

const expectedSectionKeys = [
  ["embeddingsEnabled"],
  ["checkSyncOnStartup", "updateIndexOnStartup", "debugIndexUpdates"],
  ["indexExcludedFolders", "indexExcludedPathContains", "indexExcludedContentContains"],
  ["yamlSuggestionsEnabled", "yamlAllowedProperties", "yamlIncludeTags"],
  ["embeddingDefaultLanguage"],
];

function getControlKeys(language: "pt-PT" | "en" | undefined): string[] {
  return createPureGlobalSettingsComposition(getStrings(language)).flatMap((section) =>
    section.items?.map((definition) => definition.control.key) ?? []
  );
}

describe("pure global settings composition", () => {
  it("contains only the five approved sections and their controls in current visual order", () => {
    const composition = createPureGlobalSettingsComposition(getStrings("pt-PT"));

    expect(composition).toHaveLength(5);
    expect(composition.map((section) => section.type)).toEqual(["group", "group", "group", "group", "group"]);
    expect(composition.map((section) => section.items?.map((definition) => definition.control.key))).toEqual(
      expectedSectionKeys
    );
    expect(getControlKeys("pt-PT")).toEqual(DECLARATIVE_GLOBAL_SETTING_KEYS);
    expect(new Set(getControlKeys("pt-PT")).size).toBe(11);
  });

  it.each(["pt-PT", "en"] as const)("uses existing section headings for %s", (language) => {
    const strings = getStrings(language);
    const composition = createPureGlobalSettingsComposition(strings);

    expect(composition.map((section) => section.heading)).toEqual([
      strings.settingsEmbeddingsSection,
      strings.settingsIndexSection,
      strings.settingsExclusionsSection,
      strings.settingsYamlSection,
      strings.settingsMultilingual,
    ]);
    expect(composition.every((section) => section.heading?.length)).toBe(true);
  });

  it("uses Portuguese headings when the caller relies on the existing fallback", () => {
    expect(createPureGlobalSettingsComposition(getStrings())).toEqual(
      createPureGlobalSettingsComposition(getStrings("pt-PT"))
    );
  });

  it("does not add declarative informational rows that need custom rendering", () => {
    const composition = createPureGlobalSettingsComposition(getStrings("pt-PT"));

    expect(composition.flatMap((section) => section.items ?? [])).toHaveLength(11);
    expect(composition.every((section) => Object.keys(section).sort().join(",") === "heading,items,type")).toBe(true);
  });

  it("returns independent plain structures on every call", () => {
    const strings = getStrings("en");
    const first = createPureGlobalSettingsComposition(strings);
    const second = createPureGlobalSettingsComposition(strings);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].items).not.toBe(second[0].items);

    first[0].items?.push(first[0].items[0]);
    expect(second[0].items).toHaveLength(1);
  });
});
