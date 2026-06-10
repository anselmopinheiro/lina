import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, LinaSettings, LinaSettingTab } from "./src/settings";
import { buildIndex, IndexData, updateIndexIncrementally } from "./src/indexStore";
import { SearchModal } from "./src/searchModal";
import { testOllamaConnection, generateOllamaEmbedding, generateOllamaText } from "./src/ai/ollamaProvider";
import { getEmbeddingStats, findEntriesMissingEmbeddings, updateEntryEmbedding } from "./src/indexStore";
import { SemanticSearchModal } from "./src/semanticSearchModal";
import { LinaStatusModal } from "./src/statusModal";
import { getIndexSyncStatus } from "./src/indexSyncStatus";
import { AIResponseModal } from "./src/aiResponseModal";
import { scanVaultForNotes } from "./src/index/noteScanner";
import { createTextIndex, saveTextIndex } from "./src/index/indexStore";

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
        this.indexData = await buildIndex(this.app.vault, this.indexData);
        await this.saveDataToDisk();
        new Notice(
          `Lina indexou ${this.indexData.entries.length} notas Markdown.`
        );
      },
    });

    this.addCommand({
      id: "atualizar-indice",
      name: "Lina: atualizar índice",
      callback: async () => {
        const result = await updateIndexIncrementally(this.app.vault, this.indexData);
        this.indexData = result.indexData;
        await this.saveDataToDisk();

        new Notice(
          `Índice atualizado: ${result.addedCount} novas, ${result.updatedCount} alteradas, ${result.removedCount} removidas.`
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

    this.addCommand({
      id: "testar-resposta-ia",
      name: "Lina: testar resposta IA",
      callback: async () => {
        const ollamaUrl = this.settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;
        const chatModel = this.settings.chatModel || DEFAULT_SETTINGS.chatModel;
        // Prompt fixo: resposta curta, única frase, sem Markdown, listas ou opções
        const prompt = "Responde em português europeu, numa única frase curta, sem Markdown, sem listas, sem alternativas e sem explicações adicionais. Pergunta: O que é o plugin Lina para Obsidian?";

        if (!ollamaUrl || !chatModel) {
          new Notice("URL do Ollama ou modelo de chat não definidos nas configurações.");
          return;
        }

        // Abrir modal imediatamente com estado inicial
        const modal = new AIResponseModal(this.app, chatModel, prompt, "A gerar resposta...");
        modal.open();

        // Chamar Ollama e atualizar modal
        const status = await generateOllamaText(ollamaUrl, chatModel, prompt);

        if (status.success && status.text) {
          modal.updateResponse(status.text);
        } else {
          modal.updateResponse(null, status.message);
        }
      },
    });

    this.addCommand({
      id: "reconstruir-indice-textual",
      name: "Lina: reconstruir índice textual",
      callback: async () => {
        new Notice("Lina: a reconstruir índice textual...");

        try {
          const scannedNotes = await scanVaultForNotes(this.app.vault);
          const indexedNotes = await createTextIndex(this.app.vault, scannedNotes);
          const success = await saveTextIndex(this.app.vault, indexedNotes);

          if (success) {
            new Notice(`Lina indexou ${indexedNotes.length} notas no índice textual.`);
          } else {
            new Notice("Erro ao guardar índice textual.");
          }
        } catch (error) {
          console.error("Error rebuilding text index:", error);
          new Notice("Erro ao reconstruir índice textual.");
        }
      },
    });

    // Command: gerar embeddings para lote limitado de notas
    this.addCommand({
      id: "gerar-embeddings-teste",
      name: "Lina: gerar embeddings",
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

        const batchSize = this.settings.embeddingBatchSize || 10;
        const entriesToProcess = findEntriesMissingEmbeddings(this.indexData, embeddingModel, batchSize);

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

        const stats = getEmbeddingStats(this.indexData);
        new Notice(`Lina gerou embeddings para ${processedCount} notas. Estado: ${stats.withEmbedding} de ${stats.total} notas com embeddings.`);
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

    // Command: pesquisa semântica
    this.addCommand({
      id: "pesquisa-semantica-teste",
      name: "Lina: pesquisa semântica",
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

    // Command: estado geral
    this.addCommand({
      id: "estado-geral",
      name: "Lina: estado geral",
      callback: () => {
        new LinaStatusModal(this.app, this.settings, this.indexData).open();
      },
    });

    this.addCommand({
      id: "verificar-sincronizacao-indice",
      name: "Lina: verificar sincronização do índice",
      callback: () => {
        if (!this.indexData || this.indexData.entries.length === 0) {
          new Notice("Lina ainda não tem índice criado.");
          return;
        }

        const syncStatus = getIndexSyncStatus(this.app.vault, this.indexData);
        new Notice(
          `Sincronização: ${syncStatus.newNotes.length} novas, ${syncStatus.changedNotes.length} alteradas, ${syncStatus.removedNotes.length} removidas.`
        );
      },
    });

    this.addSettingTab(new LinaSettingTab(this.app, this));

    void this.runStartupIndexAutomation();
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

  private async runStartupIndexAutomation(): Promise<void> {
    if (this.settings.updateIndexOnStartup) {
      const result = await updateIndexIncrementally(this.app.vault, this.indexData);
      const hadPreviousIndex = !!this.indexData && this.indexData.entries.length > 0;
      const hasChanges =
        result.addedCount > 0 ||
        result.updatedCount > 0 ||
        result.removedCount > 0;

      this.indexData = result.indexData;

      if (!hadPreviousIndex) {
        await this.saveDataToDisk();
        new Notice(`Lina criou o índice com ${result.indexData.entries.length} notas.`);
        return;
      }

      if (hasChanges) {
        await this.saveDataToDisk();
        new Notice(
          `Lina atualizou o índice: ${result.addedCount} novas, ${result.updatedCount} alteradas, ${result.removedCount} removidas.`
        );
      }

      return;
    }

    if (!this.settings.checkSyncOnStartup) {
      return;
    }

    if (!this.indexData || this.indexData.entries.length === 0) {
      new Notice("Lina: índice ainda não criado.");
      return;
    }

    const syncStatus = getIndexSyncStatus(this.app.vault, this.indexData);
    const hasChanges =
      syncStatus.newNotes.length > 0 ||
      syncStatus.changedNotes.length > 0 ||
      syncStatus.removedNotes.length > 0;

    if (hasChanges) {
      new Notice(
        `Lina: índice desatualizado. ${syncStatus.newNotes.length} novas, ${syncStatus.changedNotes.length} alteradas, ${syncStatus.removedNotes.length} removidas.`
      );
    }
  }
}