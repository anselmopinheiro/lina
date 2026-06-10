import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, LinaSettings, LinaSettingTab } from "./src/settings";
import { buildIndex, IndexData } from "./src/indexStore";

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
        this.indexData = buildIndex(this.app.vault);
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
        if (!this.indexData || this.indexData.entries.length === 0) {
          new Notice("Lina ainda não tem índice criado.");
          return;
        }
        new Notice(
          `Lina tem ${this.indexData.entries.length} notas no índice.`
        );
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