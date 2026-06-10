import { App, PluginSettingTab, Setting } from "obsidian";
import LinaPlugin from "../main";

export interface LinaSettings {
  ollamaUrl: string;
}

export const DEFAULT_SETTINGS: LinaSettings = {
  ollamaUrl: "http://localhost:11434",
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
      .setName("URL do Ollama")
      .setDesc("Endereço do servidor Ollama para futuras consultas.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaUrl = value;
            await this.plugin.saveSettings();
          })
      );
  }
}