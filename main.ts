import { Notice, Plugin, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, LinaSettings, LinaSettingTab } from "./src/settings";
import { buildIndex, IndexData, updateIndexIncrementally } from "./src/indexStore";
import { SearchModal } from "./src/searchModal";
import { testOllamaConnection, generateOllamaEmbedding, generateOllamaText } from "./src/ai/ollamaProvider";
import { getEmbeddingStats, findEntriesMissingEmbeddings, updateEntryEmbedding } from "./src/indexStore";
import { SemanticSearchModal } from "./src/semanticSearchModal";
import { LinaStatusModal } from "./src/statusModal";
import { getIndexSyncStatus } from "./src/indexSyncStatus";
import { AIResponseModal } from "./src/aiResponseModal";
import { scanVaultForNotes, scanVaultForNotesWithExclusions } from "./src/index/noteScanner";
import { createTextIndex, saveTextIndex, readTextIndexStatus, readIndexedNotes, readIndexedChunks } from "./src/index/indexStore";
import { getAlwaysExcludedFolders, parseMultilineSetting, shouldExcludePath } from "./src/index/indexExclusions";
import { chunkText } from "./src/index/chunker";
import { IndexStatusModal } from "./src/index/indexStatusModal";
import { TextSearchModal } from "./src/search/textSearchModal";
import { generateEmbeddingsForChunks, updateManifestWithEmbeddings, readEmbeddingStatus } from "./src/index/embeddingGenerator";
import { EmbeddingProgressModal } from "./src/index/embeddingProgressModal";

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
        const prompt = "Responde em português europeu, numa única frase curta, sem Markdown, sem listas, sem alternativas e sem explicações adicionais. Pergunta: O que é o plugin Lina para Obsidian?";

        if (!ollamaUrl || !chatModel) {
          new Notice("URL do Ollama ou modelo de chat não definidos nas configurações.");
          return;
        }

        const modal = new AIResponseModal(this.app, chatModel, prompt, "A gerar resposta...");
        modal.open();

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
        new Notice("Lina: a reconstruir índice textual e blocos...");

        try {
          // Carregar definicoes de exclusao das settings
          const excludedFoldersSetting = this.settings.indexExcludedFolders ?? "";
          const excludedPathContainsSetting = this.settings.indexExcludedPathContains ?? "";

          const excludedFolders = parseMultilineSetting(excludedFoldersSetting);
          const excludedPathContains = parseMultilineSetting(excludedPathContainsSetting);

          const exclusions = { excludedFolders, excludedPathContains };

          // Criar funcao shouldExclude encerrando as exclusions
          const shouldExcludeFn = (path: string): boolean => {
            return shouldExcludePath(path, exclusions).excluded;
          };

          // Aplicar exclusoes no scan das notas
          const markdownFiles = this.app.vault.getMarkdownFiles();
          const scanResult = scanVaultForNotesWithExclusions(markdownFiles, shouldExcludeFn);

          const indexedNotes = await createTextIndex(this.app.vault, scanResult.included);

          const allChunks = [];

          for (const note of scanResult.included) {
            try {
              const file = this.app.vault.getAbstractFileByPath(note.path);
              if (file && !(file instanceof TFolder)) {
                const content = await this.app.vault.read(file as any);
                const chunks = chunkText(note.path, content, { chunkSize: 1200, overlap: 150 });
                allChunks.push(...chunks);
              }
            } catch (error) {
              console.warn(`Erro ao processar chunks para ${note.path}:`, error);
            }
          }

          const chunkingOptions = {
            enabled: true,
            chunkSize: 1200,
            overlap: 150,
          };

          const exclusionsInfo = {
            enabled: (excludedFolders.length > 0 || excludedPathContains.length > 0) || true,
            alwaysExcludedFolders: getAlwaysExcludedFolders(),
            excludedFoldersCount: excludedFolders.length,
            excludedPathContainsCount: excludedPathContains.length,
          };

          const success = await saveTextIndex(
            this.app,
            indexedNotes,
            allChunks,
            chunkingOptions,
            scanResult.excludedCount,
            exclusionsInfo
          );

          if (success) {
            new Notice(`Lina: índice reconstruído. ${indexedNotes.length} notas indexadas, ${allChunks.length} blocos criados, ${scanResult.excludedCount} notas excluídas.`);
          } else {
            new Notice("Erro ao guardar índice textual.");
          }
        } catch (error) {
          console.error("Lina: erro ao reconstruir índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao reconstruir índice textual. ${message}`);
        }
      },
    });

    this.addCommand({
      id: "mostrar-estado-indice-textual",
      name: "Lina: mostrar estado do índice",
      callback: async () => {
        try {
          const status = await readTextIndexStatus(this.app);
          new IndexStatusModal(this.app, status).open();
        } catch (error) {
          console.error("Lina: erro ao ler estado do índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao ler estado do índice textual. ${message}`);
        }
      },
    });

    this.addCommand({
      id: "pesquisar-indice-textual",
      name: "Lina: pesquisar no índice textual",
      callback: async () => {
        try {
          const notes = await readIndexedNotes(this.app);
          if (!notes) {
            new Notice("Lina: índice textual ainda não existe. Reconstrói o índice primeiro.");
            return;
          }

          const chunks = await readIndexedChunks(this.app);
          new TextSearchModal(this.app, notes, chunks ?? []).open();
        } catch (error) {
          console.error("Lina: erro ao pesquisar no índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao pesquisar no índice textual. ${message}`);
        }
      },
    });

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

    this.addCommand({
      id: "estado-geral",
      name: "Lina: estado geral",
      callback: () => {
        new LinaStatusModal(this.app, this.settings, this.indexData).open();
      },
    });

    this.addCommand({
      id: "gerar-embeddings-locais",
      name: "Lina: gerar embeddings locais",
      callback: async () => {
        try {
          const chunks = await readIndexedChunks(this.app);
          if (!chunks || chunks.length === 0) {
            new Notice("Lina: índice textual vazio ou inexistente. Reconstrói o índice primeiro.");
            return;
          }

          const baseUrl = this.settings.embeddingLocalBaseUrl || this.settings.ollamaUrl || "http://localhost:11434";
          const model = this.settings.embeddingLocalModel || "nomic-embed-text";
          const timeoutMs = this.settings.embeddingLocalTimeoutMs || 60000;

          if (!baseUrl) {
            new Notice("Lina: URL do Ollama não configurada. Define nas definições do plugin.");
            return;
          }

          // Abrir modal de progresso
          const progressModal = new EmbeddingProgressModal(this.app);
          progressModal.open();

          const result = await generateEmbeddingsForChunks(this.app, chunks, {
            baseUrl,
            model,
            provider: "ollama",
            timeoutMs,
            incremental: this.settings.autoGenerateEmbeddingsOnlyWhenNeeded ?? true,
            onProgress: (progress) => {
              progressModal.updateProgress(progress);
            },
          });

          if (result.success && result.total > 0) {
            const manifestOk = await updateManifestWithEmbeddings(
              this.app,
              result.total,
              result.dimensions,
              model,
              "ollama"
            );

            if (manifestOk) {
              if (result.generated > 0) {
                progressModal.setMessage(`Concluído. ${result.generated} novos, ${result.kept} mantidos.`);
              } else {
                progressModal.setMessage(`Tudo atualizado. ${result.kept} embeddings válidos.`);
              }
            } else {
              progressModal.setMessage("Erro ao atualizar o manifesto.");
            }
          } else {
            progressModal.setMessage("Falha ao gerar embeddings. Nenhum ficheiro foi alterado.");
          }

          // Fechar modal após 2 segundos
          setTimeout(() => {
            progressModal.close();
          }, 2000);
        } catch (error) {
          console.error("Lina: erro ao gerar embeddings locais:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao gerar embeddings locais. ${msg}`);
        }
      },
    });

    this.addCommand({
      id: "estado-embeddings-locais",
      name: "Lina: mostrar estado dos embeddings locais",
      callback: async () => {
        try {
          const status = await readEmbeddingStatus(this.app);
          if (!status || !status.exists) {
            new Notice("Lina: ainda não existem embeddings locais. Gera primeiro com 'Lina: gerar embeddings locais'.");
            return;
          }

          new Notice(
            `Lina: ${status.totalEmbeddings} embeddings, ${status.totalChunks} chunks, ` +
            `${status.missingCount} em falta, modelo ${status.model}, ` +
            `dimensão ${status.dimensions}.`
          );
        } catch (error) {
          console.error("Lina: erro ao ler estado dos embeddings:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao ler estado dos embeddings. ${msg}`);
        }
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
    void this.runStartupEmbeddingAutomation();
  }

  onunload() {}

  async loadSettings() {
    await this.loadDataFromDisk();
  }

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

  private async runStartupEmbeddingAutomation(): Promise<void> {
    if (!this.settings.autoGenerateEmbeddingsOnStartup) {
      return;
    }

    if (!this.settings.embeddingLocalEnabled) {
      return;
    }

    try {
      const chunks = await readIndexedChunks(this.app);
      if (!chunks || chunks.length === 0) {
        return;
      }

      const baseUrl = this.settings.embeddingLocalBaseUrl || this.settings.ollamaUrl || "http://localhost:11434";
      const model = this.settings.embeddingLocalModel || "nomic-embed-text";
      const timeoutMs = this.settings.embeddingLocalTimeoutMs || 60000;

      if (!baseUrl) {
        return;
      }

      // Usar status bar para progresso
      const statusBarItem = this.addStatusBarItem();
      statusBarItem.setText("Lina: a verificar embeddings...");

      const incremental = this.settings.autoGenerateEmbeddingsOnlyWhenNeeded ?? true;

      const result = await generateEmbeddingsForChunks(this.app, chunks, {
        baseUrl,
        model,
        provider: "ollama",
        timeoutMs,
        incremental,
      });

      statusBarItem.remove();

      if (result.success && result.generated > 0) {
        await updateManifestWithEmbeddings(
          this.app,
          result.total,
          result.dimensions,
          model,
          "ollama"
        );
        new Notice(`Lina: ${result.generated} novos embeddings gerados automaticamente.`);
      }
    } catch (error) {
      console.warn("Lina: erro na geracao automatica de embeddings:", error);
    }
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