import { App, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";
import { AIProvider, DEFAULT_AI_PROVIDER_SETTINGS, AIProviderSettings } from "./ai/types";

export interface LinaSettings {
  provider: AIProvider;
  ollamaUrl?: string;
  openrouterUrl?: string;
  openaiUrl?: string;
  anthropicUrl?: string;
  geminiUrl?: string;
  chatModel: string;
  embeddingModel: string;
  embeddingBatchSize?: number;
  checkSyncOnStartup?: boolean;
  updateIndexOnStartup?: boolean;
  indexExcludedFolders?: string;
  indexExcludedPathContains?: string;
}

export const DEFAULT_SETTINGS: LinaSettings = {
  provider: "ollama",
  ollamaUrl: DEFAULT_AI_PROVIDER_SETTINGS.ollamaUrl,
  openaiUrl: "",
  anthropicUrl: "",
  geminiUrl: "",
  chatModel: DEFAULT_AI_PROVIDER_SETTINGS.chatModel!,
  embeddingModel: DEFAULT_AI_PROVIDER_SETTINGS.embeddingModel!,
  embeddingBatchSize: 10,
  checkSyncOnStartup: false,
  updateIndexOnStartup: false,
  indexExcludedFolders: "03_Pessoal/",
  indexExcludedPathContains: "senha\nsenhas\npassword\npasswords\npalavra-passe\npalavras-passe\nwifi\nwi-fi\nrouter\nrouters\ntoken\ntokens\nsecret\nsecrets\napi key\napi-key\nchave\nchaves",
};

export class LinaSettingTab extends PluginSettingTab {
  plugin: LinaPlugin;

  constructor(app: App, plugin: LinaPlugin) {
    super(app, plugin);
    this.plugin = plugin;
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

    new Setting(containerEl)
      .setName("Provider de IA")
      .setDesc("Selecione o provider de IA a utilizar")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("ollama", "Ollama (local)")
          .addOption("openrouter", "OpenRouter")
          .addOption("openai", "OpenAI")
          .addOption("anthropic", "Claude / Anthropic")
          .addOption("gemini", "Gemini")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as AIProvider;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.provider === "ollama") {
      new Setting(containerEl)
        .setName("URL do Ollama")
        .setDesc("Endereço do servidor Ollama para futuras consultas")
        .addText((text) =>
          text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaUrl ?? "")
            .onChange(async (value) => {
              this.plugin.settings.ollamaUrl = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.provider === "openrouter") {
      new Setting(containerEl)
        .setName("OpenRouter URL")
        .setDesc("Endereço do servidor OpenRouter")
        .addText((text) =>
          text
            .setPlaceholder("https://openrouter.ai/api")
            .setValue(this.plugin.settings.openrouterUrl ?? "")
            .onChange(async (value) => {
              this.plugin.settings.openrouterUrl = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.provider === "openai") {
      new Setting(containerEl)
        .setName("OpenAI URL")
        .setDesc("Endereço do servidor OpenAI (ex: https://api.openai.com)")
        .addText((text) =>
          text
            .setPlaceholder("https://api.openai.com")
            .setValue(this.plugin.settings.openaiUrl ?? "")
            .onChange(async (value) => {
              this.plugin.settings.openaiUrl = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.provider === "anthropic") {
      new Setting(containerEl)
        .setName("Anthropic URL")
        .setDesc("Endereço do servidor Anthropic (ex: https://api.anthropic.com)")
        .addText((text) =>
          text
            .setPlaceholder("https://api.anthropic.com")
            .setValue(this.plugin.settings.anthropicUrl ?? "")
            .onChange(async (value) => {
              this.plugin.settings.anthropicUrl = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.provider === "gemini") {
      new Setting(containerEl)
        .setName("Gemini URL")
        .setDesc("Endereço do servidor Gemini (ex: https://generativelanguage.googleapis.com)")
        .addText((text) =>
          text
            .setPlaceholder("https://generativelanguage.googleapis.com")
            .setValue(this.plugin.settings.geminiUrl ?? "")
            .onChange(async (value) => {
              this.plugin.settings.geminiUrl = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Modelo de chat")
      .setDesc("Modelo de linguagem para chat/conversação")
      .addText((text) =>
        text
          .setPlaceholder("gemma4:12b")
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (value) => {
            this.plugin.settings.chatModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Modelo de embeddings")
      .setDesc("Modelo para geração de embeddings")
      .addText((text) =>
        text
          .setPlaceholder("nomic-embed-text")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingModel = value;
            await this.plugin.saveSettings();
          })
      );

    function clamp(val: number, min: number, max: number): number {
      return Math.min(max, Math.max(min, val));
    }

    new Setting(containerEl)
      .setName("Tamanho do lote de embeddings")
      .setDesc("Número máximo de notas a processar em cada execução.")
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.embeddingBatchSize || 10))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            const clamped = clamp(isNaN(num) ? 10 : num, 1, 50);
            this.plugin.settings.embeddingBatchSize = clamped;
            await this.plugin.saveSettings();
            text.setValue(String(clamped));
          })
      );

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