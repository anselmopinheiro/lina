import {
  isEmbeddingUpdateMode,
  type EmbeddingUpdateMode,
} from "../maintenance/embeddingUpdateSettings";

export { isEmbeddingUpdateMode, type EmbeddingUpdateMode };

export const DECLARATIVE_GLOBAL_SETTING_KEYS = [
  "embeddingsEnabled",
  "checkSyncOnStartup",
  "updateIndexOnStartup",
  "debugIndexUpdates",
  "indexExcludedFolders",
  "indexExcludedPathContains",
  "indexExcludedContentContains",
  "yamlSuggestionsEnabled",
  "yamlAllowedProperties",
  "yamlIncludeTags",
  "embeddingDefaultLanguage",
  "embeddingUpdateMode",
] as const;

export type DeclarativeGlobalSettingKey = typeof DECLARATIVE_GLOBAL_SETTING_KEYS[number];

export type DeclarativeGlobalSettingValueKind =
  | "boolean"
  | "string"
  | "embedding-default-language"
  | "embedding-update-mode";

export const DECLARATIVE_GLOBAL_SETTING_VALUE_KINDS = {
  embeddingsEnabled: "boolean",
  checkSyncOnStartup: "boolean",
  updateIndexOnStartup: "boolean",
  debugIndexUpdates: "boolean",
  indexExcludedFolders: "string",
  indexExcludedPathContains: "string",
  indexExcludedContentContains: "string",
  yamlSuggestionsEnabled: "boolean",
  yamlAllowedProperties: "string",
  yamlIncludeTags: "boolean",
  embeddingDefaultLanguage: "embedding-default-language",
  embeddingUpdateMode: "embedding-update-mode",
} as const satisfies Record<DeclarativeGlobalSettingKey, DeclarativeGlobalSettingValueKind>;

export const EMBEDDING_DEFAULT_LANGUAGE_VALUES = ["pt-PT", "en", "es", "fr", "multi", "auto"] as const;

export type EmbeddingDefaultLanguage = typeof EMBEDDING_DEFAULT_LANGUAGE_VALUES[number];

export const EMBEDDING_UPDATE_MODE_VALUES = ["manual", "automatic-local-only"] as const;

export interface EmbeddingDefaultLanguageLabels {
  ptPT: string;
  en: string;
  es: string;
  fr: string;
  multi: string;
  auto: string;
}

export interface EmbeddingUpdateModeLabels {
  manual: string;
  automaticLocalOnly: string;
}

export function isDeclarativeGlobalSettingKey(key: string): key is DeclarativeGlobalSettingKey {
  return DECLARATIVE_GLOBAL_SETTING_KEYS.some((candidate) => candidate === key);
}

export function isBooleanSettingValue(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isStringSettingValue(value: unknown): value is string {
  return typeof value === "string";
}

export function isEmbeddingDefaultLanguage(value: unknown): value is EmbeddingDefaultLanguage {
  return EMBEDDING_DEFAULT_LANGUAGE_VALUES.some((candidate) => candidate === value);
}

export function isDeclarativeGlobalSettingValue(key: DeclarativeGlobalSettingKey, value: unknown): boolean {
  switch (DECLARATIVE_GLOBAL_SETTING_VALUE_KINDS[key]) {
    case "boolean":
      return isBooleanSettingValue(value);
    case "string":
      return isStringSettingValue(value);
    case "embedding-default-language":
      return isEmbeddingDefaultLanguage(value);
    case "embedding-update-mode":
      return isEmbeddingUpdateMode(value);
  }
}

export function getEmbeddingDefaultLanguageOptions(
  labels: EmbeddingDefaultLanguageLabels
): Array<{ value: EmbeddingDefaultLanguage; label: string }> {
  return [
    { value: "pt-PT", label: labels.ptPT },
    { value: "en", label: labels.en },
    { value: "es", label: labels.es },
    { value: "fr", label: labels.fr },
    { value: "multi", label: labels.multi },
    { value: "auto", label: labels.auto },
  ];
}

export function getEmbeddingUpdateModeOptions(
  labels: EmbeddingUpdateModeLabels
): Array<{ value: EmbeddingUpdateMode; label: string }> {
  return [
    { value: "manual", label: labels.manual },
    { value: "automatic-local-only", label: labels.automaticLocalOnly },
  ];
}
