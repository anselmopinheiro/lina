import { App, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";

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
    const bmcImg = bmcLink.createEl("img", {
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
    // SECÇÃO 1: IA / ANÁLISE E ORGANIZAÇÃO DE NOTAS
    // ============================================================
    containerEl.createEl("h3", { text: "IA / análise e organização de notas" });

    const profiles = normalizeAiProfiles(this.plugin.settings);
    this.plugin.settings.aiProfiles = profiles;
    const activeProfile = getActiveAiProfile(this.plugin.settings);

    containerEl.createEl("h4", { text: "Dispositivo atual" });

    new Setting(containerEl)
      .setName("Nome deste dispositivo")
      .setDesc("Nome local usado apenas neste dispositivo. Não é guardado em data.json.")
      .addText((text) =>
        text
          .setPlaceholder("PC Ryzen, Surface antigo, Telemóvel...")
          .setValue(getLocalDeviceName())
          .onChange((value) => {
            setLocalDeviceName(value);
          })
      );

    new Setting(containerEl)
      .setName("Perfil de IA ativo neste dispositivo")
      .setDesc("Esta seleção é local ao dispositivo e não é sincronizada pelo data.json.")
      .addDropdown((dropdown) => {
        for (const profile of profiles) {
          dropdown.addOption(profile.id, `${profile.name} (${getProviderLabel(profile.provider)}, ${profile.model || "sem modelo configurado"})`);
        }
        dropdown
          .setValue(activeProfile.id)
          .onChange((value) => {
            setLocalActiveAiProfileId(value);
            this.display();
          });
      });

    containerEl.createEl("p", {
      text: `Perfil ativo local: ${activeProfile.name} - ${activeProfile.isLocal ? "local" : "remoto"} - ${activeProfile.model || "sem modelo configurado"}`,
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" }
    });

    if (!activeProfile.isLocal) {
      containerEl.createEl("p", {
        text: "Atenção: chaves de API remotas são guardadas localmente neste dispositivo. Se guardar chaves nas settings globais, elas podem ser sincronizadas pelo OneDrive.",
        attr: { style: "font-size: 0.85em; color: var(--text-warning);" }
      });

    }

    containerEl.createEl("h4", { text: "Perfis de IA" });

    new Setting(containerEl)
      .setName("Perfis configurados")
      .setDesc("Cada cartão representa um perfil de IA. O provider é escolhido dentro do próprio perfil.")
      .addButton((button) =>
        button
          .setButtonText("Adicionar perfil")
          .onClick(async () => {
            const defaults = getProviderDefaults("mistral", this.plugin.settings);
            const nextProfile: LinaAiProfile = {
              id: createGenericProfileId(profiles),
              name: "Novo perfil",
              ...defaults
            };
            profiles.push(nextProfile);
            this.plugin.settings.aiProfiles = profiles;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    for (const profile of profiles) {
      const profileEl = containerEl.createDiv();
      profileEl.style.border = "1px solid var(--background-modifier-border)";
      profileEl.style.borderRadius = "4px";
      profileEl.style.padding = "8px";
      profileEl.style.marginBottom = "8px";

      profileEl.createEl("strong", { text: profile.name });
      profileEl.createDiv({
        text: `${getProviderLabel(profile.provider)} - ${profile.isLocal ? "local" : "remoto"}`,
        attr: { style: "font-size: 0.85em; color: var(--text-muted); margin-top: 2px;" }
      });
      if (!isProviderImplemented(profile.provider)) {
        profileEl.createDiv({
          text: "Provider ainda não implementado nesta versão.",
          attr: { style: "font-size: 0.85em; color: var(--text-warning); margin-top: 4px;" }
        });
      }

      new Setting(profileEl)
        .setName("Nome do perfil")
        .addText((text) =>
          text
            .setValue(profile.name)
            .onChange(async (value) => {
              profile.name = value.trim() || getProviderLabel(profile.provider);
              this.plugin.settings.aiProfiles = profiles;
              await this.plugin.saveSettings();
            })
        );

      new Setting(profileEl)
        .setName("Provider")
        .addDropdown((dropdown) => {
          for (const option of AI_PROVIDER_OPTIONS) {
            dropdown.addOption(option.value, option.label);
          }

          dropdown
            .setValue(profile.provider)
            .onChange(async (value) => {
              const nextProvider = value as AIProvider;
              const defaults = getProviderDefaults(nextProvider, this.plugin.settings);
              profile.provider = nextProvider;
              profile.baseUrl = defaults.baseUrl;
              profile.model = defaults.model;
              profile.requestTimeoutSeconds = defaults.requestTimeoutSeconds;
              profile.isLocal = defaults.isLocal;
              profile.outputLanguage = defaults.outputLanguage;
              this.plugin.settings.aiProfiles = profiles;
              await this.plugin.saveSettings();
              this.display();
            });
        });

      new Setting(profileEl)
        .setName("Modelo")
        .addText((text) =>
          text
            .setValue(profile.model)
            .onChange(async (value) => {
              profile.model = value.trim();
              this.plugin.settings.aiProfiles = profiles;
              await this.plugin.saveSettings();
            })
        );

      new Setting(profileEl)
        .setName("URL base")
        .addText((text) =>
          text
            .setValue(profile.baseUrl)
            .onChange(async (value) => {
              profile.baseUrl = value.trim();
              this.plugin.settings.aiProfiles = profiles;
              await this.plugin.saveSettings();
            })
        );

      new Setting(profileEl)
        .setName("Tempo limite")
        .setDesc("Segundos.")
        .addText((text) =>
          text
            .setValue(String(profile.requestTimeoutSeconds))
            .onChange(async (value) => {
              const num = parseInt(value, 10);
              profile.requestTimeoutSeconds = clamp(isNaN(num) ? 60 : num, 10, 300);
              this.plugin.settings.aiProfiles = profiles;
              await this.plugin.saveSettings();
              text.setValue(String(profile.requestTimeoutSeconds));
            })
        );

      new Setting(profileEl)
        .setName("Local/remoto")
        .setDesc("Indica se este perfil usa um provider local neste dispositivo.")
        .addToggle((toggle) =>
          toggle
            .setValue(profile.isLocal ?? profile.provider === "ollama")
            .onChange(async (value) => {
              profile.isLocal = value;
              this.plugin.settings.aiProfiles = profiles;
              await this.plugin.saveSettings();
            })
        );

      if (!(profile.isLocal ?? profile.provider === "ollama")) {
        new Setting(profileEl)
          .setName("Chave API")
          .setDesc("A chave API é guardada apenas neste dispositivo.")
          .addText((text) => {
            const hasKey = getLocalAiProfileApiKey(profile.id).length > 0;
            const input = text
              .setPlaceholder(hasKey ? "Chave local guardada" : "Introduzir chave API")
              .setValue("")
              .onChange((value) => {
                setLocalAiProfileApiKey(profile.id, value);
              });
            (input.inputEl as HTMLInputElement).type = "password";
            return input;
          });
      }

      new Setting(profileEl)
        .addButton((button) =>
          button
            .setButtonText("Remover perfil")
            .setDisabled(profiles.length <= 1)
            .onClick(async () => {
              if (profiles.length <= 1) {
                return;
              }

              const confirmed = window.confirm(`Remover o perfil "${profile.name}"?`);
              if (!confirmed) {
                return;
              }

              const index = profiles.findIndex(item => item.id === profile.id);
              if (index < 0) {
                return;
              }

              profiles.splice(index, 1);
              if (getLocalActiveAiProfileId() === profile.id && profiles[0]) {
                setLocalActiveAiProfileId(profiles[0].id);
              }

              this.plugin.settings.aiProfiles = profiles;
              await this.plugin.saveSettings();
              this.display();
            })
        );
    }

    containerEl.createEl("p", {
      text: "As definições antigas de IA continuam guardadas para compatibilidade, mas as análises usam o perfil ativo local.",
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" }
    });

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
    // SECÇÃO 2: EMBEDDINGS
    // ============================================================
    containerEl.createEl("h3", { text: "Embeddings" });

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

    new Setting(containerEl)
      .setName("Provider de embeddings")
      .setDesc("Seleciona o serviço usado para gerar embeddings para pesquisa semântica e híbrida.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("ollama", "Ollama local")
          .addOption("openai", "OpenAI")
          .addOption("openrouter", "OpenRouter")
          .addOption("gemini", "Gemini")
          .addOption("other", "Outro / compatível")
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (value) => {
            this.plugin.settings.embeddingProvider = value as EmbeddingProvider;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // Aviso de provider de embeddings ainda não implementado
    const selectedEmbeddingProvider = this.plugin.settings.embeddingProvider;
    if (selectedEmbeddingProvider !== "ollama") {
      const noticeEl = containerEl.createEl("p", {
        text: "Provider ainda não implementado; a geração de embeddings local continua disponível apenas com Ollama.",
        attr: { style: "font-size: 0.85em; color: var(--text-warning); font-style: italic; padding: 4px 8px; background: var(--background-modifier-hover); border-radius: 4px;" }
      });
    }

    new Setting(containerEl)
      .setName("URL base dos embeddings")
      .setDesc("Endereço do serviço de embeddings. Para Ollama local, normalmente http://localhost:11434.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.embeddingBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.embeddingBaseUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chave API dos embeddings")
      .setDesc("Chave usada por providers online. Ainda não é usada nesta versão.")
      .addText((text) => {
        const input = text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.embeddingApiKey)
          .onChange(async (value) => {
            this.plugin.settings.embeddingApiKey = value;
            await this.plugin.saveSettings();
          });
        (input.inputEl as HTMLInputElement).type = "password";
        return input;
      });

    new Setting(containerEl)
      .setName("Modelo para embeddings")
      .setDesc("Modelo vetorial usado para gerar embeddings dos chunks. Serve apenas para pesquisa semântica e híbrida.")
      .addText((text) =>
        text
          .setPlaceholder("nomic-embed-text-v2-moe")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tamanho do lote de embeddings")
      .setDesc("Número máximo de chunks a processar em cada execução.")
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.embeddingBatchSize))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 10 : num, 1, 50);
            this.plugin.settings.embeddingBatchSize = clamped;
            await this.plugin.saveSettings();
            text.setValue(String(clamped));
          })
      );

    new Setting(containerEl)
      .setName("Tempo limite por pedido de embedding")
      .setDesc("Tempo máximo, em segundos, para cada pedido de embedding.")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.embeddingRequestTimeoutSeconds))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 60 : num, 10, 300);
            this.plugin.settings.embeddingRequestTimeoutSeconds = clamped;
            await this.plugin.saveSettings();
            text.setValue(String(clamped));
          })
      );

    new Setting(containerEl)
      .setName("Gerar embeddings automaticamente ao iniciar")
      .setDesc("Quando ativo, gera embeddings localmente automaticamente após o plugin carregar, apenas se houver blocos sem embedding ou desatualizados.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.generateEmbeddingsOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.generateEmbeddingsOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gerar apenas embeddings em falta ou desatualizados")
      .setDesc("Se ativo, evita regenerar embeddings que já estão atualizados. Recomendado manter ativo.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.generateOnlyMissingEmbeddings)
          .onChange(async (value) => {
            this.plugin.settings.generateOnlyMissingEmbeddings = value;
            await this.plugin.saveSettings();
          })
      );

    // ============================================================
    // SECÇÃO 3: ÍNDICE
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
    // SECÇÃO 4: PESQUISA HÍBRIDA
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
    // SECÇÃO 5: YAML / PROPRIEDADES DAS NOTAS
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
    const supportLink = containerEl.createEl("a", {
      href: "https://www.buymeacoffee.com/apinheiro",
      text: "Apoiar o projeto",
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });
  }
}
