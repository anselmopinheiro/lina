import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";
import { generateOllamaText } from "./ai/ollamaProvider";
import { generateMistralText } from "./ai/mistralProvider";

export type AIProvider = "ollama" | "mistral" | "openai" | "openrouter" | "anthropic" | "gemini" | "custom";
export type EmbeddingProvider = "ollama" | "openai" | "openrouter" | "gemini" | "other";

export type AIOutputLanguage = "pt-PT" | "pt-BR" | "en" | "es" | "fr" | "auto";

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

  // Inbox / organização em lote
  inboxFolderPath: string;
  maxInboxNotesToAnalyze: number;

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

const ACTIVE_AI_PROFILE_STORAGE_KEY = "lina.activeAiProfileId";
const DEVICE_NAME_STORAGE_KEY = "lina.deviceName";
const API_KEY_STORAGE_PREFIX = "lina.apiKey.";

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

function isProviderImplemented(provider: AIProvider): boolean {
  return provider === "ollama" || provider === "mistral";
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

function createGenericProfileId(existingProfiles: LinaAiProfile[]): string {
  let candidate = "perfil";
  let suffix = 2;
  const existingIds = new Set(existingProfiles.map(profile => profile.id));

  while (existingIds.has(candidate)) {
    candidate = `perfil-${suffix}`;
    suffix++;
  }

  return candidate;
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

function getLocalStorageValue(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function setLocalStorageValue(key: string, value: string): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage pode estar indisponível em alguns contextos.
  }
}

export function getLocalDeviceName(): string {
  return getLocalStorageValue(DEVICE_NAME_STORAGE_KEY);
}

export function setLocalDeviceName(value: string): void {
  setLocalStorageValue(DEVICE_NAME_STORAGE_KEY, value.trim());
}

export function getLocalActiveAiProfileId(): string {
  return getLocalStorageValue(ACTIVE_AI_PROFILE_STORAGE_KEY);
}

export function setLocalActiveAiProfileId(profileId: string): void {
  setLocalStorageValue(ACTIVE_AI_PROFILE_STORAGE_KEY, profileId);
}

export function getLocalAiProfileApiKey(profileId: string): string {
  return getLocalStorageValue(`${API_KEY_STORAGE_PREFIX}${profileId}`);
}

export function setLocalAiProfileApiKey(profileId: string, apiKey: string): void {
  setLocalStorageValue(`${API_KEY_STORAGE_PREFIX}${profileId}`, apiKey.trim());
}

// ============================================================
// NOVAS FUNÇÕES DE LOCALSTORAGE PARA CONFIGURAÇÃO LOCAL
// ============================================================

const LOCAL_PREFIX = "lina.";

function getLocalVal(key: string): string {
  return getLocalStorageValue(`${LOCAL_PREFIX}${key}`);
}

function setLocalVal(key: string, value: string): void {
  setLocalStorageValue(`${LOCAL_PREFIX}${key}`, value);
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
  if (settings.embeddingModel && !settings.embeddingModel) {
    settings.embeddingModel = settings.embeddingModel;
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

  // Inbox / organização em lote
  inboxFolderPath: "00_Inbox",
  maxInboxNotesToAnalyze: 10,
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

  // Função auxiliar para obter valor local com fallback para settings antigas (data.json)
  private getAnalysisLocalOrFallback<T>(localGetter: () => string, settingsKey: keyof LinaSettings): string {
    const local = localGetter();
    if (local) return local;
    const fallback = String((this.plugin.settings as any)[settingsKey] ?? "");
    return fallback;
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
          return "Chave API em falta para este provider.";
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
          return result.message || "Não foi possível contactar o provider.";
        }

        if (!result.text || result.text.trim().length === 0) {
          return "Resposta vazia do provider.";
        }

        return "Ligação testada com sucesso.";
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Não foi possível contactar o provider: ${msg}`;
      }
    }

    return "Provider ainda não implementado nesta versão.";
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Lina" });
    containerEl.createEl("p", {
      text: "Assistente para Obsidian focado em pesquisa, organização e enriquecimento de notas Markdown."
    });

    const bmcLink = containerEl.createEl("a", {
      href: "https://www.buymeacoffee.com/apinheiro",
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });
    bmcLink.createEl("img", {
      attr: {
        src: "https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png",
        alt: "Buy Me a Coffee",
        style: "height: 60px !important;width: 217px !important;"
      }
    });

    containerEl.createEl("p", {
      text: "Se o Lina lhe for útil, pode apoiar o desenvolvimento através de Buy Me a Coffee."
    });

    // ============================================================
    // DISPOSITIVO ATUAL
    // ============================================================
    containerEl.createEl("h3", { text: "Dispositivo atual" });

    containerEl.createEl("p", {
      text: "Estas opções de IA são guardadas apenas neste dispositivo.",
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" }
    });

    new Setting(containerEl)
      .setName("Nome deste dispositivo")
      .addText((text) =>
        text
          .setPlaceholder("PC Ryzen, Surface antigo, Telemóvel...")
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
    containerEl.createEl("h3", { text: "Análise IA" });

    // Provider
    const localAnalysisProvider = getLocalAnalysisProvider() || this.plugin.settings.aiProvider || "ollama";
    new Setting(containerEl)
      .setName("Provider")
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
          this.display();
        });
      });

    // Aviso de provider não implementado
    const isAnalysisImplemented = localAnalysisProvider === "ollama" || localAnalysisProvider === "mistral";
    if (!isAnalysisImplemented) {
      containerEl.createEl("p", {
        text: "Provider ainda não implementado nesta versão.",
        attr: { style: "font-size: 0.85em; color: var(--text-warning); font-style: italic; padding: 4px 8px; background: var(--background-modifier-hover); border-radius: 4px;" }
      });
    }

    // Modelo
    const localAnalysisModel = getLocalAnalysisModel() || this.plugin.settings.aiAnalysisModel || "";
    new Setting(containerEl)
      .setName("Modelo")
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
      .setName("URL base")
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
        .setName("Chave API")
        .setDesc("A chave API é guardada apenas neste dispositivo.")
        .addText((text) => {
          const hasKey = localAnalysisApiKey.length > 0;
          const input = text
            .setPlaceholder(hasKey ? "Chave local guardada" : "Introduzir chave API")
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
      .setName("Tempo limite")
      .setDesc("Segundos.")
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
          .setButtonText("Testar ligação")
          .onClick(async () => {
            testResultEl.setText("A testar ligação...");
            testResultEl.style.color = "var(--text-muted)";
            const result = await this.testAnalysisProviderConnection(
              localAnalysisProvider,
              localAnalysisModel,
              localAnalysisBaseUrl,
              localAnalysisTimeout
            );
            testResultEl.setText(result);
            testResultEl.style.color = result === "Ligação testada com sucesso." ? "var(--text-success)" : "var(--text-error)";
          })
      );

    // Separador
    containerEl.createEl("hr");

    // ============================================================
    // EMBEDDINGS
    // ============================================================
    containerEl.createEl("h3", { text: "Embeddings" });

    // Ativar embeddings (guardado em data.json por ser preferência geral)
    new Setting(containerEl)
      .setName("Ativar embeddings")
      .setDesc("Permite gerar embeddings dos chunks para pesquisa semântica e híbrida.")
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
          this.display();
        });
      });

    // Aviso de provider não implementado
    const isEmbeddingImplemented = localEmbeddingProvider === "ollama";
    if (!isEmbeddingImplemented) {
      containerEl.createEl("p", {
        text: "Provider ainda não implementado nesta versão.",
        attr: { style: "font-size: 0.85em; color: var(--text-warning); font-style: italic; padding: 4px 8px; background: var(--background-modifier-hover); border-radius: 4px;" }
      });
    }

    // Modelo
    const localEmbeddingModel = getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || "";
    new Setting(containerEl)
      .setName("Modelo")
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
      .setName("URL base")
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
        .setName("Chave API")
        .setDesc("A chave API é guardada apenas neste dispositivo.")
        .addText((text) => {
          const hasKey = localEmbeddingApiKey.length > 0;
          const input = text
            .setPlaceholder(hasKey ? "Chave local guardada" : "Introduzir chave API")
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
      .setName("Tamanho do lote")
      .setDesc("Número máximo de chunks a processar em cada execução.")
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
      .setName("Tempo limite")
      .setDesc("Segundos.")
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
    containerEl.createEl("h3", { text: "Pasta Inbox" });

    new Setting(containerEl)
      .setName("Pasta Inbox")
      .setDesc("Pasta onde o Lina deve procurar notas para análise em lote. A pasta não é criada automaticamente.")
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
      .setName("Número máximo de notas da Inbox a analisar")
      .setDesc("Limite de notas Markdown analisadas em cada execução. Valor entre 1 e 20.")
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
    containerEl.createEl("h3", { text: "Índice" });

    new Setting(containerEl)
      .setName("Verificar sincronização ao iniciar")
      .setDesc("Verifica se o índice está desatualizado quando o plugin é carregado, sem alterar o índice.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.checkSyncOnStartup ?? false)
          .onChange(async (value) => {
            this.plugin.settings.checkSyncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Atualizar índice ao iniciar")
      .setDesc("Atualiza o índice de forma incremental quando o plugin é carregado, sem gerar embeddings.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.updateIndexOnStartup ?? false)
          .onChange(async (value) => {
            this.plugin.settings.updateIndexOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Atualizar índice automaticamente")
      .setDesc("Atualiza o índice textual quando notas Markdown são criadas, modificadas, apagadas ou renomeadas.")
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
      .setName("Modo de diagnóstico do índice")
      .setDesc("Mostra informação de diagnóstico sobre eventos do vault e atualização automática do índice.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugIndexUpdates ?? false)
          .onChange(async (value) => {
            this.plugin.settings.debugIndexUpdates = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Exclusões do índice" });

    new Setting(containerEl)
      .setName("Pastas excluídas")
      .setDesc("Uma pasta por linha. As notas dentro destas pastas não entram no índice do Lina.")
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
      .setName("Termos excluídos no caminho")
      .setDesc("Um termo por linha. Se o caminho da nota contiver algum destes termos, a nota não entra no índice do Lina.")
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
      text: "As pastas .lina/ e .obsidian/ são sempre excluídas automaticamente.",
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" }
    });

    // ============================================================
    // PESQUISA HÍBRIDA
    // ============================================================
    containerEl.createEl("h3", { text: "Pesquisa híbrida" });

    new Setting(containerEl)
      .setName("Peso da pesquisa textual")
      .setDesc("Peso usado na pontuação final da pesquisa híbrida. Valor entre 0 e 1.")
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
      .setName("Peso da pesquisa semântica")
      .setDesc("Peso usado na pontuação final da pesquisa híbrida. Valor entre 0 e 1.")
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
    containerEl.createEl("h3", { text: "YAML / propriedades das notas" });

    new Setting(containerEl)
      .setName("Ativar sugestão de YAML")
      .setDesc("Permite que o Lina sugira YAML na análise de notas. Não altera notas; apenas mostra sugestões.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.yamlSuggestionsEnabled ?? true)
          .onChange(async (value) => {
            this.plugin.settings.yamlSuggestionsEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Propriedades YAML permitidas")
      .setDesc("Lista de propriedades que o Lina pode sugerir no YAML. Separar por vírgulas.")
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
      .setName("Incluir tags dentro do YAML")
      .setDesc("Se ativo, o YAML sugerido inclui uma lista de tags. Não altera notas; apenas mostra sugestões.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.yamlIncludeTags ?? true)
          .onChange(async (value) => {
            this.plugin.settings.yamlIncludeTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Máximo de tags sugeridas")
      .setDesc("Número máximo de tags a sugerir no YAML e na lista de tags.")
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

    containerEl.createEl("h3", { text: "Apoiar o projeto" });
    containerEl.createEl("p", {
      text: "O Lina é desenvolvido de forma independente. O apoio através de Buy Me a Coffee ajuda a manter o desenvolvimento do projeto."
    });
    containerEl.createEl("a", {
      href: "https://www.buymeacoffee.com/apinheiro",
      text: "Apoiar o projeto",
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });
  }
}
