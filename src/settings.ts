import { App, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";
import { getStrings, UiStrings } from "./i18n/strings";
import { generateOllamaText } from "./ai/ollamaProvider";
import { generateMistralText } from "./ai/mistralProvider";

export type AIProvider = "ollama" | "mistral" | "openai" | "openrouter" | "anthropic" | "gemini" | "custom";
export type EmbeddingProvider = "ollama" | "openai" | "openrouter" | "gemini" | "other";

export type AIOutputLanguage = "pt-PT" | "pt-BR" | "en" | "es" | "fr" | "auto";

export type InterfaceLanguage = "pt-PT" | "en";

export type EmbeddingDefaultLanguage = "pt-PT" | "en" | "es" | "fr" | "multi" | "auto";

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

export interface LinaDeviceSettings {
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
}

export interface LinaSettings {
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

  // Configurações por dispositivo
  deviceSettingsById?: Record<string, LinaDeviceSettings>;

  // --- Campos mantidos para compatibilidade (migração) ---
  // IA análise (antigo)
  provider?: AIProvider;
  ollamaUrl?: string;
  openrouterUrl?: string;
  openaiUrl?: string;
  anthropicUrl?: string;
  geminiUrl?: string;
  chatModel?: string;

  // Embeddings (antigo)
  embeddingLocalEnabled?: boolean;
  embeddingLocalBaseUrl?: string;
  embeddingLocalModel?: string;
  embeddingLocalTimeoutMs?: number;
  autoGenerateEmbeddingsOnStartup?: boolean;
  autoGenerateEmbeddingsOnlyWhenNeeded?: boolean;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

const AI_PROVIDER_OPTIONS: Array<{ value: AIProvider; label: string }> = [
  { value: "ollama", label: "Ollama" },
  { value: "mistral", label: "Mistral" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Outro / compatível" },
];

function getProviderLabel(provider: AIProvider): string {
  return AI_PROVIDER_OPTIONS.find(option => option.value === provider)?.label ?? provider;
}

function isProviderRemote(provider: string): boolean {
  return provider !== "ollama";
}

const EMBEDDING_PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ollama", label: "Ollama" },
  { value: "mistral", label: "Mistral" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Outro / compatível" },
];

const LEGACY_AUTO_PROFILE_IDS = new Set<string>(["openrouter", "openai", "gemini", "anthropic", "custom"]);

function getProviderDefaults(provider: AIProvider, settings: Pick<LinaSettings, "aiBaseUrl" | "aiAnalysisModel" | "aiRequestTimeoutSeconds" | "aiOutputLanguage">): Omit<LinaAiProfile, "id" | "name"> {
  switch (provider) {
    case "ollama":
      return {
        provider,
        baseUrl: settings.aiBaseUrl || "http://localhost:11434",
        model: settings.aiAnalysisModel || "gemma4:e2b",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: true
      };
    case "mistral":
      return {
        provider,
        baseUrl: "https://api.mistral.ai/v1",
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
    case "openai":
      return {
        provider,
        baseUrl: "https://api.openai.com/v1",
        model: "",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: false
      };
    case "gemini":
      return {
        provider,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: false
      };
    case "anthropic":
      return {
        provider,
        baseUrl: "https://api.anthropic.com",
        model: "",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: false
      };
    case "custom":
    default:
      return {
        provider: "custom",
        baseUrl: "",
        model: "",
        requestTimeoutSeconds: settings.aiRequestTimeoutSeconds || 60,
        outputLanguage: settings.aiOutputLanguage || "pt-PT",
        isLocal: false
      };
  }
}

function isLegacyAutoProviderProfile(profile: LinaAiProfile, settings: LinaSettings): boolean {
  if (!LEGACY_AUTO_PROFILE_IDS.has(profile.id)) return false;

  const defaults = getProviderDefaults(profile.provider, settings);
  const defaultName = getProviderLabel(profile.provider);

  return profile.name === defaultName
    && profile.baseUrl === defaults.baseUrl
    && profile.model === defaults.model
    && (profile.requestTimeoutSeconds ?? 60) === defaults.requestTimeoutSeconds
    && (profile.isLocal ?? false) === (defaults.isLocal ?? false);
}

let activeSettings: LinaSettings | null = null;
let saveActiveSettings: (() => void) | null = null;

type LinaDeviceStringSettingKey = Exclude<keyof LinaDeviceSettings, "aiProfileApiKeys">;

function hashDeviceToken(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getCurrentDeviceSettingsId(): string {
  const nav = window.navigator;
  const token = [
    nav.userAgent,
    nav.language,
    String(nav.hardwareConcurrency ?? ""),
    String(nav.maxTouchPoints ?? "")
  ].join("|");

  // Heurística mínima: distingue contextos comuns, mas não é garantidamente única.
  // Deve ser melhorada futuramente se forem detetadas colisões entre dispositivos.
  return `device-${hashDeviceToken(token)}`;
}

export function setDeviceSettingsContext(settings: LinaSettings, saveSettings: () => void): void {
  activeSettings = settings;
  saveActiveSettings = saveSettings;
  ensureCurrentDeviceSettings();
}

function ensureCurrentDeviceSettings(): LinaDeviceSettings {
  if (!activeSettings) return {};

  const deviceId = getCurrentDeviceSettingsId();
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
  switch (key) {
    case "analysis.provider":
      return getDeviceValue("analysisProvider");
    case "analysis.model":
      return getDeviceValue("analysisModel");
    case "analysis.baseUrl":
      return getDeviceValue("analysisBaseUrl");
    case "analysis.apiKey":
      return getDeviceValue("analysisApiKey");
    case "analysis.timeout":
      return getDeviceValue("analysisTimeout");
    case "embeddings.provider":
      return getDeviceValue("embeddingsProvider");
    case "embeddings.model":
      return getDeviceValue("embeddingsModel");
    case "embeddings.baseUrl":
      return getDeviceValue("embeddingsBaseUrl");
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
  return getLocalVal("analysis.apiKey");
}
export function setLocalAnalysisApiKey(value: string): void {
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
  return getLocalVal("embeddings.apiKey");
}
export function setLocalEmbeddingsApiKey(value: string): void {
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
    const provider = profile.provider || "ollama";
    if (isLegacyAutoProviderProfile({ ...profile, provider }, settings)) continue;
    const fallback = getProviderDefaults(provider, settings);
    byId.set(profile.id, {
      id: profile.id,
      name: profile.name || getProviderLabel(provider),
      provider,
      baseUrl: profile.baseUrl ?? fallback.baseUrl,
      model: profile.model ?? fallback.model,
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
    settings.aiProvider = settings.provider as AIProvider;
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
  } else {
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
  aiBaseUrl: "http://localhost:11434",
  aiApiKey: "",
  aiAnalysisModel: "gemma4:12b",
  aiRequestTimeoutSeconds: 60,
  aiOutputLanguage: "pt-PT",
  aiProfiles: [
    {
      id: "ollama-local",
      name: "Ollama local",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "gemma4:e2b",
      requestTimeoutSeconds: 60,
      outputLanguage: "pt-PT",
      isLocal: true
    },
    {
      id: "mistral",
      name: "Mistral",
      provider: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-small-latest",
      requestTimeoutSeconds: 60,
      outputLanguage: "pt-PT",
      isLocal: false
    }
  ],

  // Embeddings
  embeddingsEnabled: false,
  embeddingProvider: "ollama",
  embeddingBaseUrl: "http://localhost:11434",
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
  autoUpdateIndexOnFileChanges: false,
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

  // Configurações por dispositivo
  deviceSettingsById: {},
};

export class LinaSettingTab extends PluginSettingTab {
  plugin: LinaPlugin;

  constructor(app: App, plugin: LinaPlugin) {
    super(app, plugin);
    this.plugin = plugin;

    // Migrar settings antigas ao carregar as definições
    const changed = migrarSettings(this.plugin.settings);
    if (changed) {
      void this.plugin.saveSettings();
    }
  }

  /** Obtém o objeto de strings traduzidas para o idioma atual. */
  private get L(): UiStrings {
    return getStrings(this.plugin.settings.interfaceLanguage ?? "pt-PT");
  }

  // Funções de defaults por provider
  private getAnalysisDefaults(provider: string): { baseUrl: string; model: string } {
    switch (provider) {
      case "ollama":
        return { baseUrl: "http://localhost:11434", model: "gemma4:e2b" };
      case "mistral":
        return { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" };
      case "openrouter":
        return { baseUrl: "https://openrouter.ai/api/v1", model: "" };
      case "openai":
        return { baseUrl: "https://api.openai.com/v1", model: "" };
      case "gemini":
        return { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "" };
      case "anthropic":
        return { baseUrl: "https://api.anthropic.com", model: "" };
      case "custom":
      default:
        return { baseUrl: "", model: "" };
    }
  }

  private getEmbeddingDefaults(provider: string): { baseUrl: string; model: string } {
    switch (provider) {
      case "ollama":
        return { baseUrl: "http://localhost:11434", model: "nomic-embed-text-v2-moe" };
      case "mistral":
        return { baseUrl: "https://api.mistral.ai/v1", model: "" };
      case "openrouter":
        return { baseUrl: "https://openrouter.ai/api/v1", model: "" };
      case "openai":
        return { baseUrl: "https://api.openai.com/v1", model: "" };
      case "gemini":
        return { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "" };
      case "anthropic":
        return { baseUrl: "https://api.anthropic.com", model: "" };
      case "custom":
      default:
        return { baseUrl: "", model: "" };
    }
  }

  private async testAnalysisProviderConnection(
    provider: string,
    model: string,
    baseUrl: string,
    timeout: string
  ): Promise<string> {
    if (provider === "ollama" || provider === "mistral") {
      if (provider === "mistral") {
        const apiKey = getLocalAnalysisApiKey();
        if (!apiKey) {
          return this.L.settingsApiKeyMissing;
        }
      }

      const prompt = "Responde apenas com: Lina OK";
      const timeoutMs = (parseInt(timeout) || 60) * 1000;

      try {
        let result: { success: boolean; message: string; text?: string };
        if (provider === "ollama") {
          result = await generateOllamaText(baseUrl || "http://localhost:11434", model || "gemma4:e2b", prompt, timeoutMs);
        } else {
          const apiKey = getLocalAnalysisApiKey();
          result = await generateMistralText(baseUrl || "https://api.mistral.ai/v1", apiKey, model || "mistral-small-latest", prompt, timeoutMs);
        }

        if (!result.success) {
          return result.message || this.L.settingsConnectionFailed;
        }

        if (!result.text || result.text.trim().length === 0) {
          return this.L.settingsConnectionEmptyResponse;
        }

        return this.L.settingsConnectionSuccess;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `${this.L.settingsConnectionErrorPrefix}: ${msg}`;
      }
    }

    return this.L.settingsProviderNotImplementedTest;
  }

  display(): void {
    this.renderSettingsContent();
  }

  private renderSettingsContent(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(this.L.settingsTitle)
      .setHeading();
    containerEl.createEl("p", {
      text: this.L.settingsDescription
    });

    containerEl.createEl("a", {
      href: "https://www.buymeacoffee.com/apinheiro",
      text: "Buy Me a Coffee",
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });

    containerEl.createEl("p", {
      text: this.L.settingsSupportText
    });

    // ============================================================
    // DISPOSITIVO ATUAL
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsDeviceSection)
      .setHeading();

    containerEl.createEl("p", {
      text: this.L.settingsDeviceDescription,
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" }
    });

    new Setting(containerEl)
      .setName(this.L.settingsDeviceName)
      .addText((text) =>
        text
          .setPlaceholder(this.L.settingsDeviceNamePlaceholder)
          .setValue(getLocalDeviceName())
          .onChange((value) => {
            setLocalDeviceName(value);
          })
      );

    // Separador
    containerEl.createEl("hr");

    // ============================================================
    // ANÁLISE IA
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsAnalysisSection)
      .setHeading();

    // Provider
    const localAnalysisProvider = getLocalAnalysisProvider() || this.plugin.settings.aiProvider || "ollama";
    new Setting(containerEl)
      .setName(this.L.settingsProvider)
      .addDropdown((dropdown) => {
        for (const opt of AI_PROVIDER_OPTIONS) {
          dropdown.addOption(opt.value, opt.label);
        }
        dropdown.setValue(localAnalysisProvider).onChange((value) => {
          setLocalAnalysisProvider(value);
          // Preencher defaults se campos estiverem vazios
          const defaults = this.getAnalysisDefaults(value);
          const currentModel = getLocalAnalysisModel();
          const currentBaseUrl = getLocalAnalysisBaseUrl();
          if (!currentBaseUrl) setLocalAnalysisBaseUrl(defaults.baseUrl);
          if (!currentModel) setLocalAnalysisModel(defaults.model);
          this.renderSettingsContent();
        });
      });

    // Aviso de provider não implementado
    const isAnalysisImplemented = localAnalysisProvider === "ollama" || localAnalysisProvider === "mistral";
    if (!isAnalysisImplemented) {
      containerEl.createEl("p", {
        text: this.L.settingsProviderNotImplemented,
        attr: { style: "font-size: 0.85em; color: var(--text-warning); font-style: italic; padding: 4px 8px; background: var(--background-modifier-hover); border-radius: 4px;" }
      });
    }

    // Modelo
    const localAnalysisModel = getLocalAnalysisModel() || this.plugin.settings.aiAnalysisModel || "";
    new Setting(containerEl)
      .setName(this.L.settingsModel)
      .addText((text) =>
        text
          .setPlaceholder("gemma4:e2b")
          .setValue(localAnalysisModel)
          .onChange((value) => {
            setLocalAnalysisModel(value);
          })
      );

    // URL base
    const localAnalysisBaseUrl = getLocalAnalysisBaseUrl() || this.plugin.settings.aiBaseUrl || "";
    new Setting(containerEl)
      .setName(this.L.settingsBaseUrl)
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(localAnalysisBaseUrl)
          .onChange((value) => {
            setLocalAnalysisBaseUrl(value);
          })
      );

    // Chave API (só para remoto)
    const isAnalysisRemote = isProviderRemote(localAnalysisProvider);
    if (isAnalysisRemote) {
      const localAnalysisApiKey = getLocalAnalysisApiKey();
      new Setting(containerEl)
        .setName(this.L.settingsApiKey)
        .setDesc(this.L.settingsApiKeyDescription)
        .addText((text) => {
          const hasKey = localAnalysisApiKey.length > 0;
          const input = text
            .setPlaceholder(hasKey ? this.L.settingsApiKeyLocalSaved : this.L.settingsApiKeyPlaceholder)
            .setValue("")
            .onChange((value) => {
              setLocalAnalysisApiKey(value);
            });
          (input.inputEl as HTMLInputElement).type = "password";
          return input;
        });
    }

    // Tempo limite
    const localAnalysisTimeout = getLocalAnalysisTimeout() || String(this.plugin.settings.aiRequestTimeoutSeconds || 60);
    new Setting(containerEl)
      .setName(this.L.settingsTimeout)
      .setDesc(this.L.settingsTimeoutDesc)
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(localAnalysisTimeout)
          .onChange((value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 60 : num, 10, 300);
            setLocalAnalysisTimeout(String(clamped));
            text.setValue(String(clamped));
          })
      );

    // Botão testar ligação
    const testResultEl = containerEl.createEl("p", {
      attr: { style: "font-size: 0.85em; margin-top: 4px;" }
    });

    new Setting(containerEl)
      .addButton((button) =>
        button
          .setButtonText(this.L.settingsTestConnection)
          .onClick(async () => {
            testResultEl.setText(this.L.settingsTestingConnection);
            testResultEl.removeClass("lina-color-success");
            testResultEl.removeClass("lina-color-error");
            testResultEl.addClass("lina-color-muted");
            const result = await this.testAnalysisProviderConnection(
              localAnalysisProvider,
              localAnalysisModel,
              localAnalysisBaseUrl,
              localAnalysisTimeout
            );
            testResultEl.setText(result);
            testResultEl.removeClass("lina-color-muted");
            testResultEl.addClass(result === this.L.settingsConnectionSuccess ? "lina-color-success" : "lina-color-error");
          })
      );

    // Separador
    containerEl.createEl("hr");

    // ============================================================
    // EMBEDDINGS
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsEmbeddingsSection)
      .setHeading();

    // Ativar embeddings (guardado em data.json por ser preferência geral)
    new Setting(containerEl)
      .setName(this.L.settingsEnableEmbeddings)
      .setDesc(this.L.settingsEnableEmbeddingsDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.embeddingsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.embeddingsEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    // Provider de embeddings
    const localEmbeddingProvider = getLocalEmbeddingsProvider() || this.plugin.settings.embeddingProvider || "ollama";
    new Setting(containerEl)
      .setName("Provider")
      .addDropdown((dropdown) => {
        for (const opt of EMBEDDING_PROVIDER_OPTIONS) {
          dropdown.addOption(opt.value, opt.label);
        }
        dropdown.setValue(localEmbeddingProvider).onChange((value) => {
          setLocalEmbeddingsProvider(value);
          const defaults = this.getEmbeddingDefaults(value);
          const currentModel = getLocalEmbeddingsModel();
          const currentBaseUrl = getLocalEmbeddingsBaseUrl();
          if (!currentBaseUrl) setLocalEmbeddingsBaseUrl(defaults.baseUrl);
          if (!currentModel) setLocalEmbeddingsModel(defaults.model);
          this.renderSettingsContent();
        });
      });

    // Aviso de provider não implementado
    const isEmbeddingImplemented = localEmbeddingProvider === "ollama";
    if (!isEmbeddingImplemented) {
      containerEl.createEl("p", {
        text: this.L.settingsProviderNotImplemented,
        attr: { style: "font-size: 0.85em; color: var(--text-warning); font-style: italic; padding: 4px 8px; background: var(--background-modifier-hover); border-radius: 4px;" }
      });
    }

    // Modelo
    const localEmbeddingModel = getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || "";
    new Setting(containerEl)
      .setName(this.L.settingsModel)
      .addText((text) =>
        text
          .setPlaceholder("nomic-embed-text-v2-moe")
          .setValue(localEmbeddingModel)
          .onChange((value) => {
            setLocalEmbeddingsModel(value);
          })
      );

    // URL base
    const localEmbeddingBaseUrl = getLocalEmbeddingsBaseUrl() || this.plugin.settings.embeddingBaseUrl || "";
    new Setting(containerEl)
      .setName(this.L.settingsBaseUrl)
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(localEmbeddingBaseUrl)
          .onChange((value) => {
            setLocalEmbeddingsBaseUrl(value);
          })
      );

    // Chave API (só para remoto)
    const isEmbeddingRemote = isProviderRemote(localEmbeddingProvider);
    if (isEmbeddingRemote) {
      const localEmbeddingApiKey = getLocalEmbeddingsApiKey();
      new Setting(containerEl)
        .setName(this.L.settingsApiKey)
        .setDesc(this.L.settingsApiKeyDescription)
        .addText((text) => {
          const hasKey = localEmbeddingApiKey.length > 0;
          const input = text
            .setPlaceholder(hasKey ? this.L.settingsApiKeyLocalSaved : this.L.settingsApiKeyPlaceholder)
            .setValue("")
            .onChange((value) => {
              setLocalEmbeddingsApiKey(value);
            });
          (input.inputEl as HTMLInputElement).type = "password";
          return input;
        });
    }

    // Tamanho do lote
    const localEmbeddingBatchSize = getLocalEmbeddingsBatchSize() || String(this.plugin.settings.embeddingBatchSize || 10);
    new Setting(containerEl)
      .setName(this.L.settingsBatchSize)
      .setDesc(this.L.settingsBatchSizeDesc)
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(localEmbeddingBatchSize)
          .onChange((value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 10 : num, 1, 50);
            setLocalEmbeddingsBatchSize(String(clamped));
            text.setValue(String(clamped));
          })
      );

    // Tempo limite
    const localEmbeddingTimeout = getLocalEmbeddingsTimeout() || String(this.plugin.settings.embeddingRequestTimeoutSeconds || 60);
    new Setting(containerEl)
      .setName(this.L.settingsTimeout)
      .setDesc(this.L.settingsTimeoutDesc)
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(localEmbeddingTimeout)
          .onChange((value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 60 : num, 10, 300);
            setLocalEmbeddingsTimeout(String(clamped));
            text.setValue(String(clamped));
          })
      );

    // Separador
    containerEl.createEl("hr");

    // ============================================================
    // PASTA INBOX
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsInboxSection)
      .setHeading();

    new Setting(containerEl)
      .setName(this.L.settingsInboxFolder)
      .setDesc(this.L.settingsInboxFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("00_Inbox")
          .setValue(this.plugin.settings.inboxFolderPath ?? "00_Inbox")
          .onChange(async (value) => {
            this.plugin.settings.inboxFolderPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsInboxMaxNotes)
      .setDesc(this.L.settingsInboxMaxNotesDesc)
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.maxInboxNotesToAnalyze ?? 10))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 10 : num, 1, 20);
            this.plugin.settings.maxInboxNotesToAnalyze = clamped;
            await this.plugin.saveSettings();
            text.setValue(String(clamped));
          })
      );

    // ============================================================
    // ÍNDICE
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsIndexSection)
      .setHeading();

    new Setting(containerEl)
      .setName(this.L.settingsCheckSyncOnStartup)
      .setDesc(this.L.settingsCheckSyncOnStartupDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.checkSyncOnStartup ?? false)
          .onChange(async (value) => {
            this.plugin.settings.checkSyncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsUpdateIndexOnStartup)
      .setDesc(this.L.settingsUpdateIndexOnStartupDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.updateIndexOnStartup ?? false)
          .onChange(async (value) => {
            this.plugin.settings.updateIndexOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsAutoUpdateIndex)
      .setDesc(this.L.settingsAutoUpdateIndexDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoUpdateIndexOnFileChanges ?? false)
          .onChange(async (value) => {
            this.plugin.settings.autoUpdateIndexOnFileChanges = value;
            await this.plugin.saveSettings();
            this.plugin.updateVaultEventListeners();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsDebugIndex)
      .setDesc(this.L.settingsDebugIndexDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugIndexUpdates ?? false)
          .onChange(async (value) => {
            this.plugin.settings.debugIndexUpdates = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsExclusionsSection)
      .setHeading();

    new Setting(containerEl)
      .setName(this.L.settingsExcludedFolders)
      .setDesc(this.L.settingsExcludedFoldersDesc)
      .addTextArea((text) =>
        text
          .setPlaceholder("03_Pessoal/")
          .setValue(this.plugin.settings.indexExcludedFolders ?? "")
          .onChange(async (value) => {
            this.plugin.settings.indexExcludedFolders = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsExcludedTerms)
      .setDesc(this.L.settingsExcludedTermsDesc)
      .addTextArea((text) =>
        text
          .setPlaceholder("senha\npassword\ntoken")
          .setValue(this.plugin.settings.indexExcludedPathContains ?? "")
          .onChange(async (value) => {
            this.plugin.settings.indexExcludedPathContains = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      text: this.L.settingsExclusionsNote,
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" }
    });

    // ============================================================
    // PESQUISA HÍBRIDA
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsHybridSection)
      .setHeading();

    new Setting(containerEl)
      .setName(this.L.settingsTextWeight)
      .setDesc(this.L.settingsTextWeightDesc)
      .addText((text) =>
        text
          .setPlaceholder("0.7")
          .setValue(String(this.plugin.settings.hybridSearchTextWeight ?? 0.7))
          .onChange(async (value) => {
            const num = Number.parseFloat(value);
            const clamped = clamp(Number.isNaN(num) ? 0.7 : num, 0, 1);
            this.plugin.settings.hybridSearchTextWeight = clamped;
            await this.plugin.saveSettings();
            text.setValue(String(clamped));
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsSemanticWeight)
      .setDesc(this.L.settingsSemanticWeightDesc)
      .addText((text) =>
        text
          .setPlaceholder("0.3")
          .setValue(String(this.plugin.settings.hybridSearchSemanticWeight ?? 0.3))
          .onChange(async (value) => {
            const num = Number.parseFloat(value);
            const clamped = clamp(Number.isNaN(num) ? 0.3 : num, 0, 1);
            this.plugin.settings.hybridSearchSemanticWeight = clamped;
            await this.plugin.saveSettings();
            text.setValue(String(clamped));
          })
      );

    // ============================================================
    // YAML / PROPRIEDADES DAS NOTAS
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsYamlSection)
      .setHeading();

    new Setting(containerEl)
      .setName(this.L.settingsYamlEnabled)
      .setDesc(this.L.settingsYamlEnabledDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.yamlSuggestionsEnabled ?? true)
          .onChange(async (value) => {
            this.plugin.settings.yamlSuggestionsEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsYamlProperties)
      .setDesc(this.L.settingsYamlPropertiesDesc)
      .addText((text) =>
        text
          .setPlaceholder("tipo, projeto, area, contexto, estado, tags")
          .setValue(this.plugin.settings.yamlAllowedProperties ?? "tipo, projeto, area, contexto, estado, tags")
          .onChange(async (value) => {
            this.plugin.settings.yamlAllowedProperties = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsYamlIncludeTags)
      .setDesc(this.L.settingsYamlIncludeTagsDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.yamlIncludeTags ?? true)
          .onChange(async (value) => {
            this.plugin.settings.yamlIncludeTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.L.settingsMaxTags)
      .setDesc(this.L.settingsMaxTagsDesc)
      .addText((text) =>
        text
          .setPlaceholder("8")
          .setValue(String(this.plugin.settings.maxSuggestedTags ?? 8))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 8 : num, 1, 20);
            this.plugin.settings.maxSuggestedTags = clamped;
            await this.plugin.saveSettings();
            text.setValue(String(clamped));
          })
      );

    // ============================================================
    // MULTILINGUE
    // ============================================================
    new Setting(containerEl)
      .setName(this.L.settingsMultilingual)
      .setHeading();

    containerEl.createEl("p", {
      text: this.L.settingsMultilingualDescription,
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" }
    });

    new Setting(containerEl)
      .setName(this.L.settingsInterfaceLanguage)
      .setDesc(this.L.settingsInterfaceLanguageDescription)
      .addDropdown((dropdown) => {
        dropdown.addOption("pt-PT", this.L.langPtPT);
        dropdown.addOption("en", this.L.langEn);
        dropdown.setValue(this.plugin.settings.interfaceLanguage ?? "pt-PT");
        dropdown.onChange(async (value) => {
          this.plugin.settings.interfaceLanguage = value as InterfaceLanguage;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(this.L.settingsEmbeddingLanguage)
      .setDesc(this.L.settingsEmbeddingLanguageDescription)
      .addDropdown((dropdown) => {
        dropdown.addOption("pt-PT", this.L.langPtPT);
        dropdown.addOption("en", this.L.langEn);
        dropdown.addOption("es", this.L.langEs);
        dropdown.addOption("fr", this.L.langFr);
        dropdown.addOption("multi", this.L.langMulti);
        dropdown.addOption("auto", this.L.langAuto);
        dropdown.setValue(this.plugin.settings.embeddingDefaultLanguage ?? "pt-PT");
        dropdown.onChange(async (value) => {
          this.plugin.settings.embeddingDefaultLanguage = value as EmbeddingDefaultLanguage;
          await this.plugin.saveSettings();
        });
      });

    // Separador
    containerEl.createEl("hr");

    new Setting(containerEl)
      .setName(this.L.settingsSupportSection)
      .setHeading();
    containerEl.createEl("p", {
      text: this.L.settingsSupportDescription
    });
    containerEl.createEl("a", {
      href: "https://www.buymeacoffee.com/apinheiro",
      text: this.L.settingsSupportLink,
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });
  }
}
