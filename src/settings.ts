import { App, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";

export interface LinaSettings {
  ollamaUrl: string;
  provider: "ollama" | "openrouter";
  chatModel: string;
  embeddingModel: string;
}

export const DEFAULT_SETTINGS: LinaSettings = {
  ollamaUrl: "http://localhost:11434",
  provider: "ollama",
  chatModel: "gemma4:12b",
  embeddingModel: "nomic-embed-text"
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

    new Setting(containerEl)
      .setName("Provider de IA")
      .setDesc("Selecione o provider de IA a utilizar")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("ollama", "Ollama (local)")
          .addOption("openrouter", "OpenRouter")
          .setValue(this.plugin.settings.provider);
      });

    new Setting(containerEl)
      .setName("URL do Ollama")
      .setDesc("Endereço do servidor Ollama para futuras consultas")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaUrl = value;
            await this.plugin.saveSettings();
          })
      );

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
  }
}