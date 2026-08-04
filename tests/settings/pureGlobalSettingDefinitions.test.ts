import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  DECLARATIVE_GLOBAL_SETTING_KEYS,
  EMBEDDING_DEFAULT_LANGUAGE_VALUES,
} from "../../src/settings/declarativeGlobalSettings";
import { createPureGlobalSettingDefinitions } from "../../src/settings/pureGlobalSettingDefinitions";

const expectedControlTypes = [
  "toggle",
  "toggle",
  "toggle",
  "toggle",
  "textarea",
  "textarea",
  "textarea",
  "toggle",
  "text",
  "toggle",
  "dropdown",
];

describe("pure global setting definitions", () => {
  it("contains exactly the approved global controls in visual order", () => {
    const definitions = createPureGlobalSettingDefinitions(getStrings("pt-PT"));

    expect(definitions).toHaveLength(11);
    expect(definitions.map((definition) => definition.control.key)).toEqual(
      DECLARATIVE_GLOBAL_SETTING_KEYS
    );
    expect(new Set(definitions.map((definition) => definition.control.key)).size).toBe(11);
    expect(definitions.map((definition) => definition.control.type)).toEqual(expectedControlTypes);
  });

  it.each(["pt-PT", "en"] as const)("uses the existing labels and descriptions for %s", (language) => {
    const strings = getStrings(language);
    const definitions = createPureGlobalSettingDefinitions(strings);

    expect(definitions.map((definition) => [definition.name, definition.desc])).toEqual([
      [strings.settingsEnableEmbeddings, strings.settingsEnableEmbeddingsDesc],
      [strings.settingsCheckSyncOnStartup, strings.settingsCheckSyncOnStartupDesc],
      [strings.settingsUpdateIndexOnStartup, strings.settingsUpdateIndexOnStartupDesc],
      [strings.settingsDebugIndex, strings.settingsDebugIndexDesc],
      [strings.settingsExcludedFolders, strings.settingsExcludedFoldersDesc],
      [strings.settingsExcludedTerms, strings.settingsExcludedTermsDesc],
      [strings.settingsExcludedContentTerms, strings.settingsExcludedContentTermsDesc],
      [strings.settingsYamlEnabled, strings.settingsYamlEnabledDesc],
      [strings.settingsYamlProperties, strings.settingsYamlPropertiesDesc],
      [strings.settingsYamlIncludeTags, strings.settingsYamlIncludeTagsDesc],
      [strings.settingsEmbeddingLanguage, strings.settingsEmbeddingLanguageDescription],
    ]);
  });

  it("uses Portuguese strings when the caller relies on the existing fallback", () => {
    const fallbackStrings = getStrings();
    const definitions = createPureGlobalSettingDefinitions(fallbackStrings);

    expect(definitions).toEqual(createPureGlobalSettingDefinitions(getStrings("pt-PT")));
  });

  it("preserves the existing text placeholders", () => {
    const definitions = createPureGlobalSettingDefinitions(getStrings("pt-PT"));

    expect(definitions.map((definition) => definition.control.type === "toggle" ? undefined : definition.control.placeholder)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "03_Pessoal/",
      "senha\npassword\ntoken",
      "SEGREDO-LINA-TESTE",
      undefined,
      "tipo, projeto, area, contexto, estado, tags",
      undefined,
      undefined,
    ]);
  });

  it("uses the shared embedding-language values and localized labels", () => {
    const strings = getStrings("en");
    const definitions = createPureGlobalSettingDefinitions(strings);
    const dropdown = definitions.at(-1)?.control;

    expect(dropdown).toMatchObject({
      type: "dropdown",
      key: "embeddingDefaultLanguage",
    });
    expect(dropdown?.type === "dropdown" ? dropdown.options : undefined).toEqual({
      "pt-PT": strings.langPtPT,
      en: strings.langEn,
      es: strings.langEs,
      fr: strings.langFr,
      multi: strings.langMulti,
      auto: strings.langAuto,
    });
    expect(dropdown?.type === "dropdown" ? Object.keys(dropdown.options) : []).toEqual(
      EMBEDDING_DEFAULT_LANGUAGE_VALUES
    );
  });

  it("returns independent plain data on every call", () => {
    const strings = getStrings("pt-PT");
    const first = createPureGlobalSettingDefinitions(strings);
    const second = createPureGlobalSettingDefinitions(strings);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first.at(-1)?.control).not.toBe(second.at(-1)?.control);

    if (first.at(-1)?.control.type === "dropdown" && second.at(-1)?.control.type === "dropdown") {
      first.at(-1).control.options.en = "changed";
      expect(second.at(-1).control.options.en).toBe(strings.langEn);
    }
  });
});
