import { App, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";
import { AIProvider, DEFAULT_AI_PROVIDER_SETTINGS, AIProviderSettings } from "./ai/types"; // Import AIProvider and related types

export interface LinaSettings {
  provider: AIProvider; // Use the new AIProvider type
  ollamaUrl?: string;
  openrouterUrl?: string;
  openaiUrl?: string;
  anthropicUrl?: string;
  geminiUrl?: string;
  chatModel: string;
  embeddingModel: string;
}

export const DEFAULT_SETTINGS: LinaSettings = {
  provider: "ollama", // Default provider
  ollamaUrl: DEFAULT_AI_PROVIDER_SETTINGS.ollamaUrl,
  openaiUrl: "", // Add default empty URLs for new providers
  anthropicUrl: "",
  geminiUrl: "",
  chatModel: DEFAULT_AI_PROVIDER_SETTINGS.chatModel!,
  embeddingModel: DEFAULT_AI_PROVIDER_SETTINGS.embeddingModel!,
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

// Botão/imagem Buy Me a Coffee
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

    // Provider dropdown
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
          .onChange(async (value) => { // Removed explicit type: AIProvider
            this.plugin.settings.provider = value as AIProvider; // Cast to AIProvider
            await this.plugin.saveSettings();
            this.display(); // Re-render settings to show/hide relevant fields
          });
      });

    // Conditional rendering for URLs based on provider
    if (this.plugin.settings.provider === "ollama") {
      new Setting(containerEl)
        .setName("URL do Ollama")
        .setDesc("Endereço do servidor Ollama para futuras consultas")
        .addText((text) =>
          text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaUrl ?? "") // Use ?? "" for safety
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

    // Model settings (always visible for now, as per requirements)
    new Setting(containerEl)
      .setName("Modelo de chat")
      .setDesc("Modelo de linguagem para chat/conversação")
      .addText((text) =>
        text
          .setPlaceholder("gemma4:12b") // Placeholder might need adjustment based on provider
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

// Section: Apoiar o projeto
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
