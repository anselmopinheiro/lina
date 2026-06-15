import { App, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";

export type AIProvider = "ollama" | "openai" | "openrouter" | "anthropic" | "gemini";
export type EmbeddingProvider = "ollama" | "openai" | "openrouter" | "gemini" | "other";

export interface LinaSettings {
  // IA / análise e organização de notas
  aiProvider: AIProvider;
  aiBaseUrl: string;
  aiApiKey: string;
  aiAnalysisModel: string;
  aiRequestTimeoutSeconds: number;

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

function migrarSettings(settings: LinaSettings): void {
  // Migrar IA / análise
  if (settings.provider && !settings.aiProvider) {
    settings.aiProvider = settings.provider as AIProvider;
  }
  if (settings.ollamaUrl && !settings.aiBaseUrl) {
    settings.aiBaseUrl = settings.ollamaUrl;
  }
  if (settings.chatModel && !settings.aiAnalysisModel) {
    settings.aiAnalysisModel = settings.chatModel;
  }

  // Migrar embeddings
  if (settings.embeddingLocalEnabled !== undefined && !settings.embeddingsEnabled) {
    settings.embeddingsEnabled = settings.embeddingLocalEnabled;
  }
  if (settings.embeddingLocalBaseUrl && !settings.embeddingBaseUrl) {
    settings.embeddingBaseUrl = settings.embeddingLocalBaseUrl;
  }
  if (settings.embeddingLocalModel && !settings.embeddingModel) {
    settings.embeddingModel = settings.embeddingLocalModel;
  }
  if (settings.embeddingModel && !settings.embeddingModel) {
    settings.embeddingModel = settings.embeddingModel;
  }
  if (settings.embeddingLocalTimeoutMs !== undefined && !settings.embeddingRequestTimeoutSeconds) {
    settings.embeddingRequestTimeoutSeconds = Math.round(settings.embeddingLocalTimeoutMs / 1000);
  }
  if (settings.autoGenerateEmbeddingsOnStartup !== undefined && !settings.generateEmbeddingsOnStartup) {
    settings.generateEmbeddingsOnStartup = settings.autoGenerateEmbeddingsOnStartup;
  }
  if (settings.autoGenerateEmbeddingsOnlyWhenNeeded !== undefined && !settings.generateOnlyMissingEmbeddings) {
    settings.generateOnlyMissingEmbeddings = settings.autoGenerateEmbeddingsOnlyWhenNeeded;
  }
}

export const DEFAULT_SETTINGS: LinaSettings = {
  // IA / análise e organização de notas
  aiProvider: "ollama",
  aiBaseUrl: "http://localhost:11434",
  aiApiKey: "",
  aiAnalysisModel: "gemma4:12b",
  aiRequestTimeoutSeconds: 60,

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
};

export class LinaSettingTab extends PluginSettingTab {
  plugin: LinaPlugin;

  constructor(app: App, plugin: LinaPlugin) {
    super(app, plugin);
    this.plugin = plugin;

    // Migrar settings antigas ao carregar as definições
    migrarSettings(this.plugin.settings);
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

    new Setting(containerEl)
      .setName("Provider de IA")
      .setDesc("Seleciona o serviço usado para análise, organização e sugestões sobre notas.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("ollama", "Ollama local")
          .addOption("openrouter", "OpenRouter")
          .addOption("openai", "OpenAI")
          .addOption("anthropic", "Claude / Anthropic")
          .addOption("gemini", "Gemini")
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = value as AIProvider;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // Aviso de provider ainda não implementado
    const selectedProvider = this.plugin.settings.aiProvider;
    if (selectedProvider !== "ollama") {
      const noticeEl = containerEl.createEl("p", {
        text: "Este provider ainda não está implementado nesta versão. A opção fica guardada para utilização futura.",
        attr: { style: "font-size: 0.85em; color: var(--text-warning); font-style: italic; padding: 4px 8px; background: var(--background-modifier-hover); border-radius: 4px;" }
      });
    }

    new Setting(containerEl)
      .setName("URL base da IA")
      .setDesc("Endereço do serviço de IA. Para Ollama local, normalmente http://localhost:11434.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiBaseUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chave API da IA")
      .setDesc("Chave usada por providers online. Ainda não é usada nesta versão.")
      .addText((text) => {
        const input = text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.aiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.aiApiKey = value;
            await this.plugin.saveSettings();
          });
        // Usar tipo password para ocultar a chave
        (input.inputEl as HTMLInputElement).type = "password";
        return input;
      });

    new Setting(containerEl)
      .setName("Modelo para análise e organização de notas")
      .setDesc("Modelo de linguagem usado para analisar notas, sugerir tags, pastas, YAML, links internos, tarefas e resumos.")
      .addText((text) =>
        text
          .setPlaceholder("gemma4:12b")
          .setValue(this.plugin.settings.aiAnalysisModel)
          .onChange(async (value) => {
            this.plugin.settings.aiAnalysisModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tempo limite para respostas da IA")
      .setDesc("Tempo máximo, em segundos, para respostas do modelo de linguagem.")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.aiRequestTimeoutSeconds))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 60 : num, 10, 300);
            this.plugin.settings.aiRequestTimeoutSeconds = clamped;
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