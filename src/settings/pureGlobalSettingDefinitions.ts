import type { SettingDefinition } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import {
  getEmbeddingDefaultLanguageOptions,
  type DeclarativeGlobalSettingKey,
} from "./declarativeGlobalSettings";

type PureGlobalSettingStrings = Pick<
  UiStrings,
  | "settingsEnableEmbeddings"
  | "settingsEnableEmbeddingsDesc"
  | "settingsCheckSyncOnStartup"
  | "settingsCheckSyncOnStartupDesc"
  | "settingsUpdateIndexOnStartup"
  | "settingsUpdateIndexOnStartupDesc"
  | "settingsDebugIndex"
  | "settingsDebugIndexDesc"
  | "settingsExcludedFolders"
  | "settingsExcludedFoldersDesc"
  | "settingsExcludedTerms"
  | "settingsExcludedTermsDesc"
  | "settingsExcludedContentTerms"
  | "settingsExcludedContentTermsDesc"
  | "settingsYamlEnabled"
  | "settingsYamlEnabledDesc"
  | "settingsYamlProperties"
  | "settingsYamlPropertiesDesc"
  | "settingsYamlIncludeTags"
  | "settingsYamlIncludeTagsDesc"
  | "settingsEmbeddingLanguage"
  | "settingsEmbeddingLanguageDescription"
  | "langPtPT"
  | "langEn"
  | "langEs"
  | "langFr"
  | "langMulti"
  | "langAuto"
>;

export function createPureGlobalSettingDefinitions(
  strings: PureGlobalSettingStrings
): Array<SettingDefinition<DeclarativeGlobalSettingKey>> {
  return [
    {
      name: strings.settingsEnableEmbeddings,
      desc: strings.settingsEnableEmbeddingsDesc,
      control: { type: "toggle", key: "embeddingsEnabled" },
    },
    {
      name: strings.settingsCheckSyncOnStartup,
      desc: strings.settingsCheckSyncOnStartupDesc,
      control: { type: "toggle", key: "checkSyncOnStartup" },
    },
    {
      name: strings.settingsUpdateIndexOnStartup,
      desc: strings.settingsUpdateIndexOnStartupDesc,
      control: { type: "toggle", key: "updateIndexOnStartup" },
    },
    {
      name: strings.settingsDebugIndex,
      desc: strings.settingsDebugIndexDesc,
      control: { type: "toggle", key: "debugIndexUpdates" },
    },
    {
      name: strings.settingsExcludedFolders,
      desc: strings.settingsExcludedFoldersDesc,
      control: {
        type: "textarea",
        key: "indexExcludedFolders",
        placeholder: "03_Pessoal/",
      },
    },
    {
      name: strings.settingsExcludedTerms,
      desc: strings.settingsExcludedTermsDesc,
      control: {
        type: "textarea",
        key: "indexExcludedPathContains",
        placeholder: "senha\npassword\ntoken",
      },
    },
    {
      name: strings.settingsExcludedContentTerms,
      desc: strings.settingsExcludedContentTermsDesc,
      control: {
        type: "textarea",
        key: "indexExcludedContentContains",
        placeholder: "SEGREDO-LINA-TESTE",
      },
    },
    {
      name: strings.settingsYamlEnabled,
      desc: strings.settingsYamlEnabledDesc,
      control: { type: "toggle", key: "yamlSuggestionsEnabled" },
    },
    {
      name: strings.settingsYamlProperties,
      desc: strings.settingsYamlPropertiesDesc,
      control: {
        type: "text",
        key: "yamlAllowedProperties",
        placeholder: "tipo, projeto, area, contexto, estado, tags",
      },
    },
    {
      name: strings.settingsYamlIncludeTags,
      desc: strings.settingsYamlIncludeTagsDesc,
      control: { type: "toggle", key: "yamlIncludeTags" },
    },
    {
      name: strings.settingsEmbeddingLanguage,
      desc: strings.settingsEmbeddingLanguageDescription,
      control: {
        type: "dropdown",
        key: "embeddingDefaultLanguage",
        options: Object.fromEntries(
          getEmbeddingDefaultLanguageOptions({
            ptPT: strings.langPtPT,
            en: strings.langEn,
            es: strings.langEs,
            fr: strings.langFr,
            multi: strings.langMulti,
            auto: strings.langAuto,
          }).map(({ value, label }) => [value, label])
        ),
      },
    },
  ];
}
