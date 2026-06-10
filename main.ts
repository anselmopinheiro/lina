import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, LinaSettings, LinaSettingTab } from "./src/settings";
import { buildIndex, IndexData } from "./src/indexStore";
import { SearchModal } from "./src/searchModal";
import { testOllamaConnection, generateOllamaEmbedding } from "./src/ai/ollamaProvider";
import { getEmbeddingStats, findEntriesMissingEmbeddings, updateEntryEmbedding } from "./src/indexStore";
import { SemanticSearchModal } from "./src/semanticSearchModal";

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

    // Command for testing Ollama connection
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

        if (status.success && status.models && status.models.length > 0) {
          console.log("Ollama Models:", status.models);
        }
      },
    });

    // New command for testing embedding generation
    this.addCommand({
      id: "testar-embedding",
      name: "Lina: testar embedding",
      callback: async () => {
        const ollamaUrl = this.settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;
        const embeddingModel = this.settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel;
        const inputText = "Teste de embedding do Lina";

        if (!ollamaUrl || !embeddingModel) {
          new Notice("URL do Ollama ou modelo de embedding não definidos nas configurações.");
          return;
        }

        const status = await generateOllamaEmbedding(ollamaUrl, embeddingModel, inputText);
        
        if (status.success && status.dimension) {
          new Notice(`Embedding gerado com sucesso. Dimensão: ${status.dimension}.`);
        } else {
          new Notice(`Não foi possível gerar embedding. ${status.message}`);
        }
      },
    });


    // Command: gerar embeddings de teste para lote limitado de notas
    this.addCommand({
      id: "gerar-embeddings-teste",
      name: "Lina: gerar embeddings de teste",
      callback: async () => {
        if (!this.indexData || this.indexData.entries.length === 0) {
          new Notice("Lina ainda não tem índice criado.");
          return;
        }

        const ollamaUrl = this.settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;
        const embeddingModel = this.settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel;

        if (!ollamaUrl || !embeddingModel) {
          new Notice("URL do Ollama ou modelo de embedding não definidos nas configurações.");
          return;
        }

        const entriesToProcess = findEntriesMissingEmbeddings(this.indexData, embeddingModel, 10);

        if (entriesToProcess.length === 0) {
          new Notice("Todas as notas já têm embedding para o modelo atual.");
          return;
        }

        let processedCount = 0;

        for (const entry of entriesToProcess) {
          const text = entry.excerpt || entry.basename;
          if (!text) continue;

          const status = await generateOllamaEmbedding(ollamaUrl, embeddingModel, text);

          if (status.success && status.embedding && status.dimension) {
            updateEntryEmbedding(this.indexData, entry.path, status.embedding, embeddingModel, status.dimension);
            processedCount++;
          }
        }

        if (processedCount > 0) {
          await this.saveDataToDisk();
        }

        new Notice(`Lina gerou embeddings para ${processedCount} notas.`);
      },
    });

    // Command: estado dos embeddings
    this.addCommand({
      id: "estado-embeddings",
      name: "Lina: estado dos embeddings",
      callback: () => {
        if (!this.indexData || this.indexData.entries.length === 0) {
          new Notice("Lina ainda não tem índice criado.");
          return;
        }

        const stats = getEmbeddingStats(this.indexData);
        new Notice(`Lina tem ${stats.withEmbedding} de ${stats.total} notas com embeddings.`);
      },
    });

    // Command: pesquisa semântica de teste
    this.addCommand({
      id: "pesquisa-semantica-teste",
      name: "Lina: pesquisa semântica de teste",
      callback: () => {
        if (!this.indexData || this.indexData.entries.length === 0) {
          new Notice("Lina ainda não tem índice criado.");
          return;
        }

        const ollamaUrl = this.settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;
        const embeddingModel = this.settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel;

        if (!ollamaUrl || !embeddingModel) {
          new Notice("URL do Ollama ou modelo de embedding não definidos nas configurações.");
          return;
        }

        const entriesWithEmbeddings = this.indexData.entries.filter(
          (e) => e.embedding && e.embedding.length > 0
        );

        if (entriesWithEmbeddings.length === 0) {
          new Notice("Lina ainda não tem notas com embeddings. Execute primeiro 'Lina: gerar embeddings de teste'.");
          return;
        }

        new SemanticSearchModal(
          this.app,
          this.indexData.entries,
          ollamaUrl,
          embeddingModel
        ).open();
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