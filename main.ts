import { Notice, Plugin, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, LinaSettings, LinaSettingTab } from "./src/settings";
import { buildIndex, IndexData, updateIndexIncrementally } from "./src/indexStore";
import { getIndexSyncStatus } from "./src/indexSyncStatus";
import { scanVaultForNotes, scanVaultForNotesWithExclusions } from "./src/index/noteScanner";
import { createTextIndex, saveTextIndex, readTextIndexStatus, readIndexedNotes, readIndexedChunks } from "./src/index/indexStore";
import { getAlwaysExcludedFolders, parseMultilineSetting, shouldExcludePath } from "./src/index/indexExclusions";
import { chunkText } from "./src/index/chunker";
import { IndexStatusModal } from "./src/index/indexStatusModal";
import { TextSearchModal } from "./src/search/textSearchModal";
import { generateEmbeddingsForChunks, updateManifestWithEmbeddings, readEmbeddingStatus } from "./src/index/embeddingGenerator";
import { EmbeddingProgressModal } from "./src/index/embeddingProgressModal";
import { SemanticSearchModal as NewSemanticSearchModal } from "./src/search/semanticSearchModal";

export default class LinaPlugin extends Plugin {
  settings!: LinaSettings;
  indexData?: IndexData;

  async onload() {
    await this.loadDataFromDisk();

    new Notice("Lina carregado.");

    // --- Comandos essenciais para o utilizador ---

    this.addCommand({
      id: "reconstruir-indice-textual",
      name: "Lina: reconstruir índice textual",
      callback: async () => {
        new Notice("Lina: a reconstruir índice textual e blocos...");

        try {
          const excludedFoldersSetting = this.settings.indexExcludedFolders ?? "";
          const excludedPathContainsSetting = this.settings.indexExcludedPathContains ?? "";

          const excludedFolders = parseMultilineSetting(excludedFoldersSetting);
          const excludedPathContains = parseMultilineSetting(excludedPathContainsSetting);

          const exclusions = { excludedFolders, excludedPathContains };

          const shouldExcludeFn = (path: string): boolean => {
            return shouldExcludePath(path, exclusions).excluded;
          };

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
            `Lina: ${status.validCount} válidos de ${status.totalChunks} chunks, ` +
            `${status.totalEmbeddings} total linhas em embeddings.jsonl, ` +
            `${status.missingCount} em falta, ${status.obsoleteCount} obsoletos, ` +
            `modelo ${status.model}, dimensão ${status.dimensions}.`
          );
        } catch (error) {
          console.error("Lina: erro ao ler estado dos embeddings:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao ler estado dos embeddings. ${msg}`);
        }
      },
    });

    this.addCommand({
      id: "pesquisar-semanticamente",
      name: "Lina: pesquisar semanticamente",
      callback: () => {
        try {
          const baseUrl = this.settings.embeddingLocalBaseUrl || this.settings.ollamaUrl || "http://localhost:11434";
          const model = this.settings.embeddingLocalModel || "nomic-embed-text";
          const timeoutMs = this.settings.embeddingLocalTimeoutMs || 60000;

          if (!baseUrl) {
            new Notice("Lina: URL do Ollama não configurada. Define nas definições do plugin.");
            return;
          }

          new NewSemanticSearchModal(this.app, baseUrl, model, timeoutMs).open();
        } catch (error) {
          console.error("Lina: erro ao abrir pesquisa semântica:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao abrir pesquisa semântica. ${msg}`);
        }
      },
    });

    this.addSettingTab(new LinaSettingTab(this.app, this));

    // Automacao no arranque (sem comando visivel)
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