import {
  getAnalysisProviderDefaults,
  getEmbeddingProviderDefaults,
} from "../ai/providerDefaults";
import {
  getProviderModels,
  type ModelCatalogEntry,
  type ModelCatalogType,
} from "../ai/modelCatalog";

export const PURE_LOCAL_SETTING_KEYS = [
  "deviceName",
  "analysisProvider",
  "analysisModel",
  "analysisBaseUrl",
  "analysisTimeout",
  "embeddingsProvider",
  "embeddingsModel",
  "embeddingsBaseUrl",
  "embeddingsBatchSize",
  "embeddingsTimeout",
  "embeddingStorageReadPreference",
  "maintainBinaryEmbeddingCopy",
] as const;

export type PureLocalSettingKey = typeof PURE_LOCAL_SETTING_KEYS[number];
export type PureLocalProviderDomain = "analysis" | "embedding";
export type PureLocalSettingKind = "text" | "provider" | "model" | "timeout" | "batch-size" | "storage-preference" | "boolean";

export interface PureLocalSettingMetadata {
  key: PureLocalSettingKey;
  kind: PureLocalSettingKind;
  providerDomain?: PureLocalProviderDomain;
}

export const PURE_LOCAL_SETTING_METADATA: readonly PureLocalSettingMetadata[] = [
  { key: "deviceName", kind: "text" },
  { key: "analysisProvider", kind: "provider", providerDomain: "analysis" },
  { key: "analysisModel", kind: "model", providerDomain: "analysis" },
  { key: "analysisBaseUrl", kind: "text", providerDomain: "analysis" },
  { key: "analysisTimeout", kind: "timeout", providerDomain: "analysis" },
  { key: "embeddingsProvider", kind: "provider", providerDomain: "embedding" },
  { key: "embeddingsModel", kind: "model", providerDomain: "embedding" },
  { key: "embeddingsBaseUrl", kind: "text", providerDomain: "embedding" },
  { key: "embeddingsBatchSize", kind: "batch-size", providerDomain: "embedding" },
  { key: "embeddingsTimeout", kind: "timeout", providerDomain: "embedding" },
  { key: "embeddingStorageReadPreference", kind: "storage-preference" },
  { key: "maintainBinaryEmbeddingCopy", kind: "boolean" },
];

export type PureLocalProviderId = "ollama" | "mistral" | "openrouter";
export type LegacyPureLocalProviderId = "openai" | "gemini" | "anthropic" | "custom";

const LEGACY_PURE_LOCAL_PROVIDERS: readonly LegacyPureLocalProviderId[] = ["openai", "gemini", "anthropic", "custom"];

interface PureLocalProviderMetadata {
  id: PureLocalProviderId;
  label: string;
  isLocal: boolean;
  usesBaseUrl: boolean;
  requiresApiKey: boolean;
  hasModelCatalog: boolean;
  allowsManualModel: boolean;
}

const PURE_LOCAL_PROVIDERS: readonly PureLocalProviderMetadata[] = [
  { id: "ollama", label: "Ollama", isLocal: true, usesBaseUrl: true, requiresApiKey: false, hasModelCatalog: true, allowsManualModel: true },
  { id: "mistral", label: "Mistral", isLocal: false, usesBaseUrl: true, requiresApiKey: true, hasModelCatalog: true, allowsManualModel: true },
  { id: "openrouter", label: "OpenRouter", isLocal: false, usesBaseUrl: true, requiresApiKey: true, hasModelCatalog: false, allowsManualModel: true },
];

export const PURE_LOCAL_EMBEDDING_STORAGE_PREFERENCES = ["jsonl", "prefer-binary"] as const;
export type PureLocalEmbeddingStoragePreference = typeof PURE_LOCAL_EMBEDDING_STORAGE_PREFERENCES[number];

export function isPureLocalSettingKey(value: string): value is PureLocalSettingKey {
  return PURE_LOCAL_SETTING_KEYS.some((key) => key === value);
}

export function getPureLocalProviderOptions(): Array<{ value: PureLocalProviderId; label: string }> {
  return PURE_LOCAL_PROVIDERS.map(({ id, label }) => ({ value: id, label }));
}

export function getPureLocalProviderMetadata(provider: string): PureLocalProviderMetadata | undefined {
  const metadata = PURE_LOCAL_PROVIDERS.find((candidate) => candidate.id === provider);
  return metadata ? { ...metadata } : undefined;
}

export function isPureLocalProviderId(provider: string): provider is PureLocalProviderId {
  return getPureLocalProviderMetadata(provider) !== undefined;
}

/** Legacy persisted provider values are read safely but are never exposed as active options. */
export function isLegacyPureLocalProviderId(provider: string): provider is LegacyPureLocalProviderId {
  return LEGACY_PURE_LOCAL_PROVIDERS.some((candidate) => candidate === provider);
}

export function resolvePureLocalProviderId(provider: string): PureLocalProviderId | undefined {
  if (isPureLocalProviderId(provider)) return provider;
  return isLegacyPureLocalProviderId(provider) ? "ollama" : undefined;
}

export function resolvePureLocalProviderDefaults(
  provider: string,
  domain: PureLocalProviderDomain
): { baseUrl: string; model: string } {
  return domain === "analysis"
    ? getAnalysisProviderDefaults(provider)
    : getEmbeddingProviderDefaults(provider);
}

export function getPureLocalModelOptions(
  provider: string,
  domain: PureLocalProviderDomain
): Array<{ value: string; label: string }> {
  const catalogType: ModelCatalogType = domain === "analysis" ? "chat" : "embedding";
  return getProviderModels(provider, catalogType).map((model: ModelCatalogEntry) => ({
    value: model.id,
    label: model.label === model.id ? model.id : `${model.label} (${model.id})`,
  }));
}

export function isPureLocalModelManual(provider: string, domain: PureLocalProviderDomain, model: string): boolean {
  return !getPureLocalModelOptions(provider, domain).some((option) => option.value === model);
}

export function shouldShowPureLocalBaseUrl(provider: string): boolean {
  return getPureLocalProviderMetadata(provider)?.usesBaseUrl === true;
}

export function shouldShowPureLocalApiKey(provider: string): boolean {
  return getPureLocalProviderMetadata(provider)?.requiresApiKey === true;
}

export function shouldShowPureLocalModelCatalog(provider: string): boolean {
  return getPureLocalProviderMetadata(provider)?.hasModelCatalog === true;
}

export function shouldShowPureLocalManualModel(provider: string): boolean {
  return getPureLocalProviderMetadata(provider)?.allowsManualModel === true;
}

export function normalizePureLocalTimeout(value: string): string {
  const parsed = Number.parseInt(value, 10);
  return String(Math.min(300, Math.max(10, Number.isNaN(parsed) ? 60 : parsed)));
}

export function normalizePureLocalEmbeddingBatchSize(value: string): string {
  const parsed = Number.parseInt(value, 10);
  return String(Math.min(50, Math.max(1, Number.isNaN(parsed) ? 10 : parsed)));
}

export function isPureLocalEmbeddingStoragePreference(value: string): value is PureLocalEmbeddingStoragePreference {
  return PURE_LOCAL_EMBEDDING_STORAGE_PREFERENCES.some((preference) => preference === value);
}
