import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, LinaSettings, LinaSettingTab } from "./src/settings";
import { buildIndex, IndexData } from "./src/indexStore";
import { SearchModal } from "./src/searchModal";
import { testOllamaConnection } from "./src/ai/ollamaProvider"; // Import the new function

export default class LinaPlugin extends Plugin {
  settings!: LinaSettings;
  indexData?: IndexData;

  async onload() {
    await this.loadDataFromDisk();

    new Notice("Lina carregado.");

    this.addCommand({
      id: "testar-plugin",
      name: "Lina: testar plugin",
      callback: () => {
        new Notice("Lina está ativo.");
      },
    });

    this.addCommand({
      id: "analisar-vault",
      name: "Lina: analisar vault",
      callback: () => {
        const notes = this.app.vault.getMarkdownFiles();
        new Notice(`Lina encontrou ${notes.length} notas Markdown.`);
      },
    });

    this.addCommand({
      id: "reconstruir-indice",
      name: "Lina: reconstruir índice",
      callback: async () => {
        this.indexData = await buildIndex(this.app.vault);
        await this.saveDataToDisk();
        new Notice(
          `Lina indexou ${this.indexData.entries.length} notas Markdown.`
        );
      },
    });

    this.addCommand({
      id: "estado-indice",
      name: "Lina: estado do índice",
      callback: () => {
        const entries = this.indexData?.entries;
        if (!entries || entries.length === 0) {
          new Notice("Lina ainda não tem índice criado.");
          return;
        }
        const totalWords = entries.reduce(
          (sum, e) => sum + e.wordCount,
          0
        );
        new Notice(
          `Lina tem ${entries.length} notas no índice, com ${totalWords} palavras analisadas.`
        );
      },
    });

    this.addCommand({
      id: "pesquisar-indice",
      name: "Lina: pesquisar no índice",
      callback: () => {
        if (!this.indexData || this.indexData.entries.length === 0) {
          new Notice("Lina ainda não tem índice criado.");
          return;
        }
        new SearchModal(this.app, this.indexData).open();
      },
    });

    // New command for testing Ollama connection
    this.addCommand({
      id: "testar-ligacao-ollama",
      name: "Lina: testar ligação ao Ollama",
      callback: async () => {
        const ollamaUrl = this.settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;
        if (!ollamaUrl) {
          new Notice("URL do Ollama não definida nas configurações.");
          return;
        }

        const status = await testOllamaConnection(ollamaUrl);
        new Notice(status.message);

        // Optionally, display model list if connection is successful and models are returned
        if (status.success && status.models && status.models.length > 0) {
          // For now, just log to console, as per requirements not to overcomplicate UI
          console.log("Ollama Models:", status.models);
        }
      },
    });


    this.addSettingTab(new LinaSettingTab(this.app, this));
  }

  onunload() {}

  /** @deprecated Usa loadDataFromDisk internamente */
  async loadSettings() {
    await this.loadDataFromDisk();
  }

  /** @deprecated Usa saveDataToDisk internamente */
  async saveSettings() {
    await this.saveDataToDisk();
  }

  async loadDataFromDisk() {
    const raw = await this.loadData();
    const data = raw as {
      settings?: LinaSettings;
      index?: IndexData;
    } | null;

    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      data?.settings ?? {}
    );

    this.indexData = data?.index ?? undefined;
  }

  async saveDataToDisk() {
    await this.saveData({
      settings: this.settings,
      index: this.indexData,
    });
  }
}