import { App, ConfirmationModal, PluginSettingTab, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import LinaPlugin from "../main";
import { LINA_DEVELOPMENT_BUILD_TIMESTAMP } from "./buildInfo";
import { getStrings, UiStrings } from "./i18n/strings";
import { generateProviderText } from "./ai/textProvider";
import { generateProviderEmbedding } from "./ai/embeddingProvider";
import {
  MISTRAL_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  getAnalysisProviderDefaults,
  getEmbeddingProviderDefaults,
} from "./ai/providerDefaults";
import {
  type EmbeddingDefaultLanguage,
} from "./settings/declarativeGlobalSettings";
import {
  createCredentialRuntimeBridge,
} from "./settings/credentialRuntimeBridge";
import {
  createDeclarativeSettingsCandidateComposition,
  type DeclarativeSettingsCandidateComposition,
} from "./settings/declarativeSettingsCandidateComposition";
import type {
  SettingsRuntimeEffect,
  SettingsRuntimeSnapshot,
} from "./settings/settingsRuntimeAdapters";
import type { CredentialRuntimeSettingsSnapshot } from "./settings/credentialRuntimeBridge";
import type { PureBinaryResult } from "./settings/pureSettingsAsyncActions";
import { createSettingsIntroductionRenderer } from "./settings/declarativeSettingRenderers";
import {
  isLegacyPureLocalProviderId,
  resolvePureLocalProviderId,
  type PureLocalProviderId,
} from "./settings/pureLocalSettingsModel";
import { getOrCreatePersistentDeviceId } from "./device/deviceIdentity";
import {
  LINA_SECRET_KEYS,
  deleteSecretValue,
  getSecretValueSync,
  setSecretValue,
  type SecretStorageAdapter,
} from "./device/secretStorage";

export {
  DECLARATIVE_GLOBAL_SETTING_KEYS,
  DECLARATIVE_GLOBAL_SETTING_VALUE_KINDS,
  type DeclarativeGlobalSettingKey,
  type DeclarativeGlobalSettingValueKind,
  type EmbeddingDefaultLanguage,
} from "./settings/declarativeGlobalSettings";

const EMBEDDING_CONNECTION_TEST_TEXT = "Lina embedding test";
const DEVELOPMENT_BUILD_INFO_ID = "development-build-info";

export type AIProvider = PureLocalProviderId;
export type EmbeddingProvider = PureLocalProviderId;
type LegacyUnsupportedAIProvider = "openai" | "gemini" | "anthropic" | "custom";
type PersistedAIProvider = AIProvider | LegacyUnsupportedAIProvider;

export type AIOutputLanguage = "pt-PT" | "pt-BR" | "en" | "es" | "fr" | "auto";

export type InterfaceLanguage = "pt-PT" | "en";

export interface LinaAiProfile {
  id: string;
  name: string;
  provider: AIProvider;
  baseUrl: string;
  model: string;
  requestTimeoutSeconds: number;
  outputLanguage?: AIOutputLanguage;
  isLocal?: boolean;
}

export interface LinaDeviceSettings extends Record<string, unknown> {
  deviceName?: string;
  activeAiProfileId?: string;
  aiProfileApiKeys?: Record<string, string>;
  analysisProvider?: string;
  analysisModel?: string;
  analysisBaseUrl?: string;
  analysisApiKey?: string;
  analysisTimeout?: string;
  embeddingsProvider?: string;
  embeddingsModel?: string;
  embeddingsBaseUrl?: string;
  embeddingsApiKey?: string;
  embeddingsBatchSize?: string;
  embeddingsTimeout?: string;
  embeddingStorageReadPreference?: "jsonl" | "prefer-binary";
  maintainBinaryEmbeddingCopy?: boolean;
}

export interface LinaSettings extends Record<string, unknown> {
  // IA / análise e organização de notas
  aiProvider: AIProvider;
  aiBaseUrl: string;
  aiApiKey: string;
  aiAnalysisModel: string;
  aiRequestTimeoutSeconds: number;
  aiOutputLanguage: AIOutputLanguage;
  aiProfiles: LinaAiProfile[];

  // Embeddings
  embeddingsEnabled: boolean;
  embeddingProvider: EmbeddingProvider;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingBatchSize: number;
  embeddingRequestTimeoutSeconds: number;
  generateEmbeddingsOnStartup: boolean;
  generateOnlyMissingEmbeddings: boolean;

  // Índice
  checkSyncOnStartup?: boolean;
  updateIndexOnStartup?: boolean;
  indexExcludedFolders?: string;
  indexExcludedPathContains?: string;
  indexExcludedContentContains?: string;
  autoUpdateIndexOnFileChanges?: boolean;
  debugIndexUpdates?: boolean;

  // Pesquisa híbrida
  hybridSearchTextWeight?: number;
  hybridSearchSemanticWeight?: number;

  // YAML / propriedades das notas
  yamlSuggestionsEnabled: boolean;
  yamlAllowedProperties: string;
  yamlIncludeTags: boolean;
  maxSuggestedTags: number;

  // Multilingue
  interfaceLanguage: InterfaceLanguage;
  embeddingDefaultLanguage: EmbeddingDefaultLanguage;

  // Inbox / organização em lote
  inboxFolderPath: string;
  maxInboxNotesToAnalyze: number;
  folderAnalysisMaxNotes: number;
  folderAnalysisIncludeSubfolders: boolean;
  lastAnalyzedFolderPath: string;

  // Configurações por dispositivo
  deviceSettingsById?: Record<string, LinaDeviceSettings>;

  // Configuração local do dispositivo (persistida em data.json)
  localDeviceName?: string;
  localActiveAiProfileId?: string;
  localAnalysisProvider?: string;
  localAnalysisModel?: string;
  localAnalysisBaseUrl?: string;
  localAnalysisApiKey?: string;
  localAnalysisTimeout?: string;
  localEmbeddingsProvider?: string;
  localEmbeddingsModel?: string;
  localEmbeddingsBaseUrl?: string;
  localEmbeddingsApiKey?: string;
  localEmbeddingsBatchSize?: string;
  localEmbeddingsTimeout?: string;

  // --- Campos mantidos para compatibilidade (migração) ---
  // IA análise (antigo)
  provider?: PersistedAIProvider;
  ollamaUrl?: string;
  openrouterUrl?: string;
  chatModel?: string;

  // Embeddings (antigo)
  embeddingLocalEnabled?: boolean;
  embeddingLocalBaseUrl?: string;
  embeddingLocalModel?: string;
  embeddingLocalTimeoutMs?: number;
  autoGenerateEmbeddingsOnStartup?: boolean;
  autoGenerateEmbeddingsOnlyWhenNeeded?: boolean;
}

function getProviderLabel(provider: AIProvider): string {
  switch (provider) {
    case "ollama": return "Ollama";
    case "mistral": return "Mistral";
    case "openrouter": return "OpenRouter";
  }
}

export function normalizeSupportedProvider(provider: string | undefined): AIProvider {
  return resolvePureLocalProviderId(provider?.trim() ?? "") ?? "ollama";
}

function getProviderDefaults(provider: AIProvider, settings: Pick<LinaSettings, "aiBaseUrl" | "aiAnalysisModel" | "aiRequestTimeoutSeconds" | "aiOutputLanguage">): Omit<LinaAiProfile, "id" | "name"> {
  switch (provider) {
    case "ollama":
      return {
        provider,
        baseUrl: settings.aiBaseUrl || OLLAMA_DEFAULT_BASE_URL,
        model: settings.aiAnalysisModel || "gemma4:e2b",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: true
      };
    case "mistral":
      return {
        provider,
        baseUrl: MISTRAL_DEFAULT_BASE_URL,
        model: "mistral-small-latest",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: false
      };
    case "openrouter":
      return {
        provider,
        baseUrl: "https://openrouter.ai/api/v1",
        model: "",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: false
      };
  }
}

// --- Sistema de device settings (persistido em data.json via deviceSettingsById) ---

let activeSettings: LinaSettings | null = null;
let saveActiveSettings: (() => void) | null = null;

type LinaDeviceStringSettingKey = Exclude<keyof LinaDeviceSettings, "aiProfileApiKeys" | "embeddingStorageReadPreference" | "maintainBinaryEmbeddingCopy">;

function hashDeviceToken(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function getLegacyFingerprintDeviceId(): string {
  const nav = typeof window === "undefined" ? undefined : window.navigator;
  const token = [
    nav?.userAgent ?? "unknown",
    nav?.language ?? "unknown",
    String(nav?.hardwareConcurrency ?? ""),
    String(nav?.maxTouchPoints ?? "")
  ].join("|");

  return `device-${hashDeviceToken(token)}`;
}

export function getCurrentDeviceSettingsId(): string {
  return activeDeviceSettingsId ?? getLegacyFingerprintDeviceId();
}

export function getActiveDeviceSettingsId(): string {
  return activeDeviceSettingsId ?? getCurrentDeviceSettingsId();
}

let activeDeviceSettingsId: string | undefined;
let activeSecretStorage: SecretStorageAdapter | undefined;

export function setDeviceSettingsContext(
  settings: LinaSettings,
  saveSettings: () => void,
  deviceId?: string,
  secretStorage?: SecretStorageAdapter,
): void {
  activeSettings = settings;
  saveActiveSettings = saveSettings;
  activeDeviceSettingsId = deviceId?.trim() || activeDeviceSettingsId || getCurrentDeviceSettingsId();
  if (secretStorage !== undefined) {
    activeSecretStorage = secretStorage;
  }
  ensureCurrentDeviceSettings();
}

function ensureCurrentDeviceSettings(): LinaDeviceSettings {
  if (!activeSettings) return {};

  const deviceId = activeDeviceSettingsId ?? getCurrentDeviceSettingsId();
  activeSettings.deviceSettingsById ??= {};
  activeSettings.deviceSettingsById[deviceId] ??= {};
  return activeSettings.deviceSettingsById[deviceId];
}

function getDeviceValue(key: LinaDeviceStringSettingKey): string {
  const settings = ensureCurrentDeviceSettings();
  const value = settings[key];
  return typeof value === "string" ? value : "";
}

function setDeviceValue(key: LinaDeviceStringSettingKey, value: string): void {
  if (!activeSettings) return;

  const settings = ensureCurrentDeviceSettings();
  const trimmed = value.trim();
  if (trimmed) {
    settings[key] = trimmed;
  } else {
    delete settings[key];
  }
  saveActiveSettings?.();
}

// --- Funções de compatibilidade (wrappers para campos locais em LinaSettings) ---

// --- Device settings públicas ---

export function getLocalDeviceName(): string {
  return getDeviceValue("deviceName");
}

export function setLocalDeviceName(value: string): void {
  setDeviceValue("deviceName", value);
}

export function getLocalActiveAiProfileId(): string {
  return getDeviceValue("activeAiProfileId");
}

export function setLocalActiveAiProfileId(profileId: string): void {
  setDeviceValue("activeAiProfileId", profileId);
}

export function getLocalAiProfileApiKey(profileId: string): string {
  const settings = ensureCurrentDeviceSettings();
  return settings.aiProfileApiKeys?.[profileId] ?? "";
}

export function setLocalAiProfileApiKey(profileId: string, apiKey: string): void {
  if (!activeSettings) return;

  const settings = ensureCurrentDeviceSettings();
  settings.aiProfileApiKeys ??= {};
  const trimmed = apiKey.trim();
  if (trimmed) {
    settings.aiProfileApiKeys[profileId] = trimmed;
  } else {
    delete settings.aiProfileApiKeys[profileId];
  }
  saveActiveSettings?.();
}

function getLocalVal(key: string): string {
  const normalizeProvider = (value: string): string => value ? normalizeSupportedProvider(value) : "";
  switch (key) {
    case "analysis.provider":
      return normalizeProvider(getDeviceValue("analysisProvider"));
    case "analysis.model":
      return isLegacyPureLocalProviderId(getDeviceValue("analysisProvider"))
        ? getAnalysisProviderDefaults("ollama").model
        : getDeviceValue("analysisModel");
    case "analysis.baseUrl":
      return isLegacyPureLocalProviderId(getDeviceValue("analysisProvider"))
        ? getAnalysisProviderDefaults("ollama").baseUrl
        : getDeviceValue("analysisBaseUrl");
    case "analysis.apiKey":
      return getDeviceValue("analysisApiKey");
    case "analysis.timeout":
      return getDeviceValue("analysisTimeout");
    case "embeddings.provider":
      return normalizeProvider(getDeviceValue("embeddingsProvider"));
    case "embeddings.model":
      return isLegacyPureLocalProviderId(getDeviceValue("embeddingsProvider"))
        ? getEmbeddingProviderDefaults("ollama").model
        : getDeviceValue("embeddingsModel");
    case "embeddings.baseUrl":
      return isLegacyPureLocalProviderId(getDeviceValue("embeddingsProvider"))
        ? getEmbeddingProviderDefaults("ollama").baseUrl
        : getDeviceValue("embeddingsBaseUrl");
    case "embeddings.apiKey":
      return getDeviceValue("embeddingsApiKey");
    case "embeddings.batchSize":
      return getDeviceValue("embeddingsBatchSize");
    case "embeddings.timeout":
      return getDeviceValue("embeddingsTimeout");
    default:
      return "";
  }
}

function setLocalVal(key: string, value: string): void {
  switch (key) {
    case "analysis.provider":
      setDeviceValue("analysisProvider", value);
      break;
    case "analysis.model":
      setDeviceValue("analysisModel", value);
      break;
    case "analysis.baseUrl":
      setDeviceValue("analysisBaseUrl", value);
      break;
    case "analysis.apiKey":
      setDeviceValue("analysisApiKey", value);
      break;
    case "analysis.timeout":
      setDeviceValue("analysisTimeout", value);
      break;
    case "embeddings.provider":
      setDeviceValue("embeddingsProvider", value);
      break;
    case "embeddings.model":
      setDeviceValue("embeddingsModel", value);
      break;
    case "embeddings.baseUrl":
      setDeviceValue("embeddingsBaseUrl", value);
      break;
    case "embeddings.apiKey":
      setDeviceValue("embeddingsApiKey", value);
      break;
    case "embeddings.batchSize":
      setDeviceValue("embeddingsBatchSize", value);
      break;
    case "embeddings.timeout":
      setDeviceValue("embeddingsTimeout", value);
      break;
  }
}

// Análise IA
export function getLocalAnalysisProvider(): string {
  return getLocalVal("analysis.provider");
}
export function setLocalAnalysisProvider(value: string): void {
  setLocalVal("analysis.provider", value);
}
export function getLocalAnalysisModel(): string {
  return getLocalVal("analysis.model");
}
export function setLocalAnalysisModel(value: string): void {
  setLocalVal("analysis.model", value);
}
export function getLocalAnalysisBaseUrl(): string {
  return getLocalVal("analysis.baseUrl");
}
export function setLocalAnalysisBaseUrl(value: string): void {
  setLocalVal("analysis.baseUrl", value);
}
export function getLocalAnalysisApiKey(): string {
  const secret = getSecretValueSync(activeSecretStorage, LINA_SECRET_KEYS.analysisApiKey);
  if (secret) return secret;
  return getLocalVal("analysis.apiKey");
}
export function setLocalAnalysisApiKey(value: string): void {
  if (activeSecretStorage) {
    if (value) void setSecretValue(activeSecretStorage, LINA_SECRET_KEYS.analysisApiKey, value);
    else void deleteSecretValue(activeSecretStorage, LINA_SECRET_KEYS.analysisApiKey);
  }
  setLocalVal("analysis.apiKey", value);
}
export function getLocalAnalysisTimeout(): string {
  return getLocalVal("analysis.timeout");
}
export function setLocalAnalysisTimeout(value: string): void {
  setLocalVal("analysis.timeout", value);
}

// Embeddings
export function getLocalEmbeddingsProvider(): string {
  return getLocalVal("embeddings.provider");
}
export function setLocalEmbeddingsProvider(value: string): void {
  setLocalVal("embeddings.provider", value);
}
export function getLocalEmbeddingsModel(): string {
  return getLocalVal("embeddings.model");
}
export function setLocalEmbeddingsModel(value: string): void {
  setLocalVal("embeddings.model", value);
}
export function getLocalEmbeddingsBaseUrl(): string {
  return getLocalVal("embeddings.baseUrl");
}
export function setLocalEmbeddingsBaseUrl(value: string): void {
  setLocalVal("embeddings.baseUrl", value);
}
export function getLocalEmbeddingsApiKey(): string {
  const secret = getSecretValueSync(activeSecretStorage, LINA_SECRET_KEYS.embeddingsApiKey);
  if (secret) return secret;
  return getLocalVal("embeddings.apiKey");
}
export function setLocalEmbeddingsApiKey(value: string): void {
  if (activeSecretStorage) {
    if (value) void setSecretValue(activeSecretStorage, LINA_SECRET_KEYS.embeddingsApiKey, value);
    else void deleteSecretValue(activeSecretStorage, LINA_SECRET_KEYS.embeddingsApiKey);
  }
  setLocalVal("embeddings.apiKey", value);
}
export function getLocalEmbeddingsBatchSize(): string {
  return getLocalVal("embeddings.batchSize");
}
export function setLocalEmbeddingsBatchSize(value: string): void {
  setLocalVal("embeddings.batchSize", value);
}
export function getLocalEmbeddingsTimeout(): string {
  return getLocalVal("embeddings.timeout");
}
export function setLocalEmbeddingsTimeout(value: string): void {
  setLocalVal("embeddings.timeout", value);
}

export function getLocalEmbeddingStorageReadPreference(): "jsonl" | "prefer-binary" {
  return ensureCurrentDeviceSettings().embeddingStorageReadPreference === "prefer-binary" ? "prefer-binary" : "jsonl";
}

export function setLocalEmbeddingStorageReadPreference(value: "jsonl" | "prefer-binary"): void {
  if (!activeSettings) return;
  ensureCurrentDeviceSettings().embeddingStorageReadPreference = value;
  saveActiveSettings?.();
}

export function getLocalMaintainBinaryEmbeddingCopy(): boolean {
  return ensureCurrentDeviceSettings().maintainBinaryEmbeddingCopy === true;
}

export function setLocalMaintainBinaryEmbeddingCopy(value: boolean): void {
  if (!activeSettings) return;
  ensureCurrentDeviceSettings().maintainBinaryEmbeddingCopy = value;
  saveActiveSettings?.();
}

export function buildDefaultAiProfiles(settings: Pick<LinaSettings, "aiBaseUrl" | "aiAnalysisModel" | "aiRequestTimeoutSeconds" | "aiOutputLanguage">): LinaAiProfile[] {
  return [
    {
      id: "ollama-local",
      name: "Ollama local",
      ...getProviderDefaults("ollama", settings)
    },
    {
      id: "mistral",
      name: "Mistral",
      ...getProviderDefaults("mistral", settings)
    }
  ];
}

export function normalizeAiProfiles(settings: LinaSettings): LinaAiProfile[] {
  const defaults = buildDefaultAiProfiles(settings);
  const profiles = Array.isArray(settings.aiProfiles) ? settings.aiProfiles : [];
  const byId = new Map<string, LinaAiProfile>();

  if (profiles.length === 0) {
    return defaults;
  }

  for (const profile of profiles) {
    if (!profile || !profile.id) continue;
    const configuredProvider = profile.provider;
    const provider = normalizeSupportedProvider(configuredProvider);
    const isLegacyProvider = isLegacyPureLocalProviderId(configuredProvider ?? "");
    const fallback = isLegacyProvider
      ? { ...getProviderDefaults("ollama", settings), ...getAnalysisProviderDefaults("ollama") }
      : getProviderDefaults(provider, settings);
    byId.set(profile.id, {
      id: profile.id,
      name: profile.name || getProviderLabel(provider),
      provider,
      baseUrl: isLegacyProvider ? fallback.baseUrl : profile.baseUrl ?? fallback.baseUrl,
      model: isLegacyProvider ? fallback.model : profile.model ?? fallback.model,
      requestTimeoutSeconds: profile.requestTimeoutSeconds || fallback.requestTimeoutSeconds || 60,
      outputLanguage: profile.outputLanguage || fallback.outputLanguage || settings.aiOutputLanguage || "pt-PT",
      isLocal: profile.isLocal ?? fallback.isLocal ?? provider === "ollama"
    });
  }

  const normalized = Array.from(byId.values());
  return normalized.length > 0 ? normalized : defaults;
}

export function getActiveAiProfile(settings: LinaSettings): LinaAiProfile {
  const profiles = normalizeAiProfiles(settings);
  const localProfileId = getLocalActiveAiProfileId();
  return profiles.find(profile => profile.id === localProfileId)
    ?? profiles.find(profile => profile.id === "ollama-local")
    ?? profiles[0];
}

function migrarSettings(settings: LinaSettings): boolean {
  let changed = false;

  // Migrar IA / análise - apenas se o campo alvo não tiver valor
  if (settings.provider && !settings.aiProvider) {
    settings.aiProvider = normalizeSupportedProvider(settings.provider);
    changed = true;
  }
  if (settings.ollamaUrl && !settings.aiBaseUrl) {
    settings.aiBaseUrl = settings.ollamaUrl;
    changed = true;
  }
  if (settings.chatModel && !settings.aiAnalysisModel) {
    settings.aiAnalysisModel = settings.chatModel;
    changed = true;
  }
  if (!Array.isArray(settings.aiProfiles) || settings.aiProfiles.length === 0) {
    settings.aiProfiles = buildDefaultAiProfiles(settings);
    changed = true;
  } else if (!settings.aiProfiles.some((profile) => isLegacyPureLocalProviderId(profile?.provider ?? ""))) {
    const normalizedProfiles = normalizeAiProfiles(settings);
    if (JSON.stringify(settings.aiProfiles) !== JSON.stringify(normalizedProfiles)) {
      settings.aiProfiles = normalizedProfiles;
      changed = true;
    }
  }

  // Migrar embeddings - apenas se o campo alvo não tiver valor
  if (settings.embeddingLocalEnabled !== undefined && !settings.embeddingsEnabled) {
    settings.embeddingsEnabled = settings.embeddingLocalEnabled;
    changed = true;
  }
  if (settings.embeddingLocalBaseUrl && !settings.embeddingBaseUrl) {
    settings.embeddingBaseUrl = settings.embeddingLocalBaseUrl;
    changed = true;
  }
  if (settings.embeddingLocalModel && !settings.embeddingModel) {
    settings.embeddingModel = settings.embeddingLocalModel;
    changed = true;
  }
  if (settings.embeddingLocalTimeoutMs !== undefined && !settings.embeddingRequestTimeoutSeconds) {
    settings.embeddingRequestTimeoutSeconds = Math.round(settings.embeddingLocalTimeoutMs / 1000);
    changed = true;
  }
  if (settings.autoGenerateEmbeddingsOnStartup !== undefined && !settings.generateEmbeddingsOnStartup) {
    settings.generateEmbeddingsOnStartup = settings.autoGenerateEmbeddingsOnStartup;
    changed = true;
  }
  if (settings.autoGenerateEmbeddingsOnlyWhenNeeded !== undefined && !settings.generateOnlyMissingEmbeddings) {
    settings.generateOnlyMissingEmbeddings = settings.autoGenerateEmbeddingsOnlyWhenNeeded;
    changed = true;
  }

  return changed;
}

export const DEFAULT_SETTINGS: LinaSettings = {
  // IA / análise e organização de notas
  aiProvider: "ollama",
  aiBaseUrl: OLLAMA_DEFAULT_BASE_URL,
  aiApiKey: "",
  aiAnalysisModel: "gemma4:12b",
  aiRequestTimeoutSeconds: 60,
  aiOutputLanguage: "pt-PT",
  aiProfiles: [
    {
      id: "ollama-local",
      name: "Ollama local",
      provider: "ollama",
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      model: "gemma4:e2b",
      requestTimeoutSeconds: 60,
      outputLanguage: "pt-PT",
      isLocal: true
    },
    {
      id: "mistral",
      name: "Mistral",
      provider: "mistral",
      baseUrl: MISTRAL_DEFAULT_BASE_URL,
      model: "mistral-small-latest",
      requestTimeoutSeconds: 60,
      outputLanguage: "pt-PT",
      isLocal: false
    }
  ],

  // Embeddings
  embeddingsEnabled: false,
  embeddingProvider: "ollama",
  embeddingBaseUrl: OLLAMA_DEFAULT_BASE_URL,
  embeddingApiKey: "",
  embeddingModel: "nomic-embed-text",
  embeddingBatchSize: 10,
  embeddingRequestTimeoutSeconds: 60,
  generateEmbeddingsOnStartup: false,
  generateOnlyMissingEmbeddings: true,

  // Índice
  checkSyncOnStartup: false,
  updateIndexOnStartup: false,
  indexExcludedFolders: "03_Pessoal/",
  indexExcludedPathContains: "senha\nsenhas\npassword\npasswords\npalavra-passe\npalavras-passe\nwifi\nwi-fi\nrouter\nrouters\ntoken\ntokens\nsecret\nsecrets\napi key\napi-key\nchave\nchaves",
  indexExcludedContentContains: "",
  autoUpdateIndexOnFileChanges: true,
  debugIndexUpdates: false,

  // Pesquisa híbrida
  hybridSearchTextWeight: 0.7,
  hybridSearchSemanticWeight: 0.3,

  // YAML / propriedades das notas
  yamlSuggestionsEnabled: true,
  yamlAllowedProperties: "tipo, projeto, area, contexto, estado, tags",
  yamlIncludeTags: true,
  maxSuggestedTags: 8,

  // Multilingue
  interfaceLanguage: "pt-PT",
  embeddingDefaultLanguage: "pt-PT",

  // Inbox / organização em lote
  inboxFolderPath: "00_Inbox",
  maxInboxNotesToAnalyze: 10,
  folderAnalysisMaxNotes: 10,
  folderAnalysisIncludeSubfolders: false,
  lastAnalyzedFolderPath: "",

  // Configurações por dispositivo
  deviceSettingsById: {},
};

export class LinaSettingTab extends PluginSettingTab {
  plugin: LinaPlugin;
  private composition: DeclarativeSettingsCandidateComposition | undefined;
  private compositionLanguage: InterfaceLanguage | undefined;
  private readonly introductionRenderers = new Map<InterfaceLanguage, ReturnType<typeof createSettingsIntroductionRenderer>>();

  constructor(app: App, plugin: LinaPlugin) {
    super(app, plugin);
    this.plugin = plugin;

    if (migrarSettings(this.plugin.settings)) {
      void this.plugin.saveSettings();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const composition = this.getComposition();
    composition.refreshDynamicDefinitions();
    const language = this.plugin.settings.interfaceLanguage ?? "pt-PT";
    const strings = getStrings(language);
    let introductionRenderer = this.introductionRenderers.get(language);
    if (!introductionRenderer) {
      introductionRenderer = createSettingsIntroductionRenderer(
        strings,
        this.plugin.manifest.version,
        LINA_DEVELOPMENT_BUILD_TIMESTAMP,
      );
      this.introductionRenderers.set(language, introductionRenderer);
    }
    const buildInfoCompatibilityDefinition: SettingDefinition & { id: string } = {
      id: DEVELOPMENT_BUILD_INFO_ID,
      name: strings.settingsBuild,
      desc: LINA_DEVELOPMENT_BUILD_TIMESTAMP,
      searchable: false,
      visible: false,
    };
    const introductionDefinition: SettingDefinition & { id: string } = {
      id: "support-introduction",
      name: strings.settingsTitle,
      desc: strings.settingsDescription,
      visible: true,
      render: introductionRenderer,
    };
    return composition.groups.map((group) => {
      const items = group.items.flatMap((item): SettingDefinition[] => {
        if (!item.definition) return [];
        if (item.id === "support-introduction") return [introductionDefinition];
        const definition = "render" in item.definition ? { ...item.definition } : item.definition;
        return [definition];
      });
      if (group.id === "introduction") items.push(buildInfoCompatibilityDefinition);
      return {
        type: "group" as const,
        heading: group.heading,
        // Render definitions derive their UI from mutable runtime settings. Give
        // Obsidian a fresh descriptor on update so it invokes the renderer again.
        items,
      };
    });
  }

  getControlValue(key: string): unknown {
    return this.getComposition().getControlValue(key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await this.getComposition().setControlValue(key, value);
  }

  hide(): void {
    this.disposeComposition();
    super.hide();
  }

  private getComposition(): DeclarativeSettingsCandidateComposition {
    const language = this.plugin.settings.interfaceLanguage ?? "pt-PT";
    if (!this.composition || this.compositionLanguage !== language) {
      this.disposeComposition();
      this.composition = this.createComposition();
      this.compositionLanguage = language;
    }
    return this.composition;
  }

  private disposeComposition(): void {
    this.composition?.dispose();
    this.composition = undefined;
    this.compositionLanguage = undefined;
  }

  private createComposition(): DeclarativeSettingsCandidateComposition {
    const credentialRuntime = createCredentialRuntimeBridge({
      getDeviceId: () => getActiveDeviceSettingsId(),
      readSettings: () => this.createCredentialSnapshot(),
      secretStorage: this.app.secretStorage,
      saveSettings: async (next) => {
        const previous = this.plugin.settings;
        this.applyCredentialSnapshot(next);
        try {
          await this.plugin.saveSettings();
        } catch (error) {
          this.plugin.settings = previous;
          this.synchronizeDeviceSettingsContext();
          throw error;
        }
      },
    }, {
      testAnalysis: async (input) => {
        try {
          const result = await generateProviderText({
            provider: input.provider,
            baseUrl: input.baseUrl,
            apiKey: input.credential,
            model: input.model,
            prompt: "Responde apenas com: Lina OK",
            timeoutMs: (Number.parseInt(input.timeout, 10) || 60) * 1000,
          });
          return result.success && result.text?.trim()
            ? { outcome: "success", messageKey: "connection-success" }
            : { outcome: "failed", messageKey: "connection-failed" };
        } catch {
          // The binding exposes only safe feedback keys.
        }
        return { outcome: "failed", messageKey: "connection-failed" };
      },
      testEmbeddings: async (input) => {
        try {
          const result = await generateProviderEmbedding({
            provider: input.provider,
            baseUrl: input.baseUrl,
            apiKey: input.credential ?? "",
            model: input.model,
            input: EMBEDDING_CONNECTION_TEST_TEXT,
            timeoutMs: (Number.parseInt(input.timeout, 10) || 60) * 1000,
          });
          const validEmbedding = Array.isArray(result.embedding)
            && result.embedding.length > 0
            && result.embedding.every((value) => typeof value === "number");
          return result.success && validEmbedding
            ? { outcome: "success", messageKey: "connection-success" }
            : { outcome: "failed", messageKey: "embedding-test-failed" };
        } catch {
          return { outcome: "failed", messageKey: "embedding-test-failed" };
        }
      },
    });

    const connectionConfiguration = (domain: "analysis" | "embeddings") => {
      const analysis = domain === "analysis";
      const provider = analysis ? getLocalAnalysisProvider() : getLocalEmbeddingsProvider();
      const ref = { deviceId: getActiveDeviceSettingsId(), domain } as const;
      return {
        provider,
        model: analysis ? getLocalAnalysisModel() : getLocalEmbeddingsModel(),
        baseUrl: analysis ? getLocalAnalysisBaseUrl() : getLocalEmbeddingsBaseUrl(),
        timeout: analysis ? getLocalAnalysisTimeout() : getLocalEmbeddingsTimeout(),
        credentialAvailable: credentialRuntime.getAvailability(ref, provider as never).available,
      };
    };

    return createDeclarativeSettingsCandidateComposition({
      strings: getStrings(this.plugin.settings.interfaceLanguage ?? "pt-PT"),
      configDir: this.app.vault.configDir,
      runtimeHost: {
        getSnapshot: (): SettingsRuntimeSnapshot => ({ settings: this.plugin.settings }),
        replaceSnapshot: (next) => this.replaceRuntimeSnapshot(next),
        saveSnapshot: () => this.plugin.saveSettings(),
        getCurrentDeviceId: () => getActiveDeviceSettingsId(),
        runEffect: (effect) => this.runRuntimeEffect(effect),
      },
      runtimeOptions: {
        globalDefaults: {
          autoUpdateIndexOnFileChanges: DEFAULT_SETTINGS.autoUpdateIndexOnFileChanges ?? false,
          maxSuggestedTags: DEFAULT_SETTINGS.maxSuggestedTags ?? 8,
          maxInboxNotesToAnalyze: DEFAULT_SETTINGS.maxInboxNotesToAnalyze ?? 10,
          hybridSearchTextWeight: DEFAULT_SETTINGS.hybridSearchTextWeight ?? 0.7,
          hybridSearchSemanticWeight: DEFAULT_SETTINGS.hybridSearchSemanticWeight ?? 0.3,
          interfaceLanguage: DEFAULT_SETTINGS.interfaceLanguage ?? "pt-PT",
        },
      },
      lifecycle: {
        requestHostUpdate: () => {
          if (this.composition) this.update();
        },
        scheduleUpdate: (callback) => {
          let cancelled = false;
          queueMicrotask(() => {
            if (!cancelled) callback();
          });
          return () => { cancelled = true; };
        },
      },
      connectionCredentials: {
        connectionPorts: credentialRuntime,
        credentialStatus: credentialRuntime,
        credentialMutations: credentialRuntime,
        getConnectionConfiguration: connectionConfiguration,
        getCredentialRef: (domain) => ({ deviceId: getActiveDeviceSettingsId(), domain }),
        confirmCredentialClear: () => this.confirmDestructive(
          this.L.settingsCredentialClear,
          this.L.settingsCredentialClearConfirm,
        ),
      },
      binary: {
        getCurrentStatus: () => this.toPureBinaryResult(this.plugin.getBinaryEmbeddingCopyMaintenanceState().summary),
        check: async () => this.toPureBinaryResult(await this.plugin.checkBinaryEmbeddingCopy()) ?? { status: "error" },
        createOrUpdate: async () => this.toPureBinaryResult(await this.plugin.createOrUpdateBinaryEmbeddingCopy()) ?? { status: "error" },
        remove: () => this.plugin.removeBinaryEmbeddingCopy(),
        confirmRemove: () => this.confirmDestructive(
          this.L.settingsBinaryRemove,
          this.L.settingsBinaryRemoveConfirm,
        ),
        getReadPreference: () => getLocalEmbeddingStorageReadPreference(),
        getMaintainBinaryCopy: () => getLocalMaintainBinaryEmbeddingCopy(),
        getReadDiagnostic: () => this.plugin.getEmbeddingReadDiagnosticState(),
      },
    });
  }

  private async runRuntimeEffect(effect: SettingsRuntimeEffect): Promise<void> {
    switch (effect.type) {
      case "update-vault-event-listeners":
        this.plugin.updateVaultEventListeners();
        return;
      case "reconcile-index-exclusions":
        await this.plugin.reconcileIndexExclusionsAfterSettingsChange();
        return;
      case "refresh-embedding-configuration-state":
        await this.plugin.refreshEmbeddingConfigurationState();
        return;
      case "invalidate-runtime-embedding-index":
        this.plugin.invalidateRuntimeEmbeddingIndex("manual");
        return;
      case "rerender-settings":
        this.update();
        return;
      case "set-default-base-url":
      case "set-default-model":
      case "refresh-model-options":
        return;
    }
  }

  private createCredentialSnapshot(): CredentialRuntimeSettingsSnapshot {
    const deviceSettingsById: Record<string, Record<string, unknown>> = {};
    for (const [deviceId, settings] of Object.entries(this.plugin.settings.deviceSettingsById ?? {})) {
      deviceSettingsById[deviceId] = { ...settings };
    }
    return { ...this.plugin.settings, deviceSettingsById };
  }

  private applyCredentialSnapshot(next: CredentialRuntimeSettingsSnapshot): void {
    const devices = { ...(this.plugin.settings.deviceSettingsById ?? {}) };
    for (const [deviceId, settings] of Object.entries(next.deviceSettingsById ?? {})) {
      const current = { ...(devices[deviceId] ?? {}) };
      if (typeof settings.analysisApiKey === "string") current.analysisApiKey = settings.analysisApiKey;
      else delete current.analysisApiKey;
      if (typeof settings.embeddingsApiKey === "string") current.embeddingsApiKey = settings.embeddingsApiKey;
      else delete current.embeddingsApiKey;
      devices[deviceId] = current;
    }
    this.plugin.settings = { ...this.plugin.settings, deviceSettingsById: devices };
    this.synchronizeDeviceSettingsContext();
  }

  private replaceRuntimeSnapshot(next: SettingsRuntimeSnapshot): void {
    this.plugin.settings = Object.assign({}, this.plugin.settings, next.settings);
    this.synchronizeDeviceSettingsContext();
  }

  private synchronizeDeviceSettingsContext(): void {
    setDeviceSettingsContext(
      this.plugin.settings,
      () => { void this.plugin.saveSettings(); },
      getActiveDeviceSettingsId(),
      this.app.secretStorage,
    );
  }

  private toPureBinaryResult(
    summary: Awaited<ReturnType<LinaPlugin["checkBinaryEmbeddingCopy"]>> | undefined,
  ): PureBinaryResult | undefined {
    if (!summary || summary.status === "checking") return undefined;
    return {
      status: summary.status,
      reasonCode: summary.reasonCode,
      recordCount: summary.recordCount,
      dimensions: summary.dimensions,
      byteLengthKiB: summary.byteLength === undefined ? undefined : Math.round(summary.byteLength / 1024),
    };
  }

  private confirmDestructive(label: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(confirmed);
      };
      const confirmation = new ConfirmationModal(this.app);
      confirmation.onClose = () => {
        finish(false);
      };
      confirmation.contentEl.setText(message);
      confirmation
        .addButton((button) => button
          .setButtonText(label)
          .setDestructive()
          .onClick(() => finish(true)))
        .addCancelButton();
      confirmation.open();
    });
  }

  private get L(): UiStrings {
    return getStrings(this.plugin.settings.interfaceLanguage ?? "pt-PT");
  }
}
