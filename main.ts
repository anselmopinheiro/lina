import { Notice, Plugin, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  LinaSettings,
  LinaSettingTab,
  buildDefaultAiProfiles,
  getLocalEmbeddingsBaseUrl,
  getLocalEmbeddingsModel,
  getLocalEmbeddingsTimeout,
  setDeviceSettingsContext
} from "./src/settings";
import { IndexData, updateIndexIncrementally } from "./src/indexStore";
import { getIndexSyncStatus } from "./src/indexSyncStatus";
import { scanVaultForNotesWithExclusions } from "./src/index/noteScanner";
import { saveTextIndex, readTextIndexStatus, readIndexedNotes, readIndexedChunks, IndexedNote } from "./src/index/indexStore";
import { getAlwaysExcludedFolders, parseContentExclusionTerms, parseMultilineSetting, shouldExcludeContent, shouldExcludePath } from "./src/index/indexExclusions";
import { chunkText, Chunk as TextChunk } from "./src/index/chunker";
import { hashContent } from "./src/index/noteHasher";
import { IndexStatusModal } from "./src/index/indexStatusModal";
import { TextSearchModal } from "./src/search/textSearchModal";
import { generateEmbeddingsForChunks, updateManifestWithEmbeddings, readEmbeddingStatus } from "./src/index/embeddingGenerator";
import { SemanticSearchModal as NewSemanticSearchModal } from "./src/search/semanticSearchModal";
import { IndexDiagnosticModal } from "./src/indexDiagnosticModal";
import { LINA_SEARCH_VIEW_TYPE, LinaSearchView } from "./src/search/linaSearchView";
import { getStrings, UiStrings } from "./src/i18n/strings";

export interface LinaActionResult {
  success: boolean;
  message: string;
}

interface LinaStoredData {
  settings?: Partial<LinaSettings>;
  index?: IndexData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLinaStoredData(value: unknown): value is LinaStoredData {
  if (!isRecord(value)) return false;

  const settings = value.settings;
  const index = value.index;

  return (settings === undefined || isRecord(settings)) && (index === undefined || isRecord(index));
}

export default class LinaPlugin extends Plugin {
  settings!: LinaSettings;
  indexData?: IndexData;
  indexedNotes: IndexedNote[] = []; // Adicionado para persistir o índice textual
  indexedChunks: TextChunk[] = []; // Adicionado para persistir os chunks textuais
  private vaultEventListeners: (() => void)[] = [];
  private modifyDebouncer?: (file: TFile) => void;
  private indexDiagnostic: {
    autoUpdateEnabled: boolean;
    debugEnabled: boolean;
    lastEvent?: string;
    lastEventPath?: string;
    lastAction?: string;
    lastResult?: string;
    lastUpdatedAt?: string;
    lastError?: string;
    totalNotes?: number;
    totalChunks?: number;
    pendingDebounces: Set<string>;
    recentEvents: Array<{
      timestamp: string;
      eventType: "create" | "modify" | "delete" | "rename" | "debounce" | "index" | "ignored" | "error";
      path: string;
      message: string;
    }>;
  } = {
    autoUpdateEnabled: false,
    debugEnabled: false,
    pendingDebounces: new Set(),
    recentEvents: []
  };

  private get L(): UiStrings {
    return getStrings(this.settings?.interfaceLanguage ?? "pt-PT");
  }

  private getExcludedContentTerms(): string[] {
    return parseContentExclusionTerms(this.settings.indexExcludedContentContains ?? "");
  }

  private isContentExcludedByUserRules(content: string): boolean {
    const excludedContentContains = this.getExcludedContentTerms();
    if (excludedContentContains.length === 0) {
      return false;
    }

    return shouldExcludeContent(content, excludedContentContains).excluded;
  }

  private filterChunksByUserContentRules(chunks: TextChunk[]): TextChunk[] {
    const excludedContentContains = this.getExcludedContentTerms();
    if (excludedContentContains.length === 0) {
      return chunks;
    }

    return chunks.filter((chunk) => !shouldExcludeContent(chunk.text, excludedContentContains).excluded);
  }

  private filterNotesByChunkPaths(notes: IndexedNote[], chunks: TextChunk[]): IndexedNote[] {
    const excludedContentContains = this.getExcludedContentTerms();
    if (excludedContentContains.length === 0) {
      return notes;
    }

    const allowedPaths = new Set(chunks.map((chunk) => chunk.path));
    const indexedChunkPaths = new Set(this.indexedChunks.map((chunk) => chunk.path));
    return notes.filter((note) => allowedPaths.has(note.path) || !indexedChunkPaths.has(note.path));
  }

  async onload() {
    await this.loadDataFromDisk();

    // Carregar o índice textual do disco para memória uma única vez ao iniciar
    try {
      this.indexedNotes = await readIndexedNotes(this.app) ?? [];
      this.indexedChunks = await readIndexedChunks(this.app) ?? [];
      if (this.indexedNotes.length > 0 || this.indexedChunks.length > 0) {
        console.log(`Lina: índice textual carregado. ${this.indexedNotes.length} notas, ${this.indexedChunks.length} chunks.`);
      } else {
        console.log("Lina: índice textual vazio ou não encontrado ao iniciar.");
      }
    } catch (error) {
      console.error("Lina: erro ao carregar índice textual no arranque:", error);
      new Notice(`${this.L.mainNoticeTextIndexLoadErrorPrefix}: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.registerView(
      LINA_SEARCH_VIEW_TYPE,
      (leaf) => new LinaSearchView(leaf, this)
    );

    this.addRibbonIcon("search", this.L.mainRibbonOpenLina, () => {
      void this.activateLinaSearchView().catch((error) => {
        console.error("Lina: erro ao abrir pesquisa lateral pela ribbon", error);
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`${this.L.mainNoticeOpenLinaErrorPrefix}. ${message}`);
      });
    });

    new Notice(this.L.mainNoticeLinaLoaded);

    // --- Comandos essenciais para o utilizador ---

    this.addCommand({
      id: "pesquisar",
      name: this.L.mainCommandSearch,
      callback: () => {
        void (async () => {
        try {
          await this.activateLinaSearchView();
        } catch (error) {
          console.error("Lina: erro ao abrir pesquisa lateral", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeOpenSideSearchErrorPrefix}. ${message}`);
        }

        })();
      },
    });

    this.addCommand({
      id: "reconstruir-indice-textual",
      name: this.L.mainCommandRebuildTextIndex,
      callback: () => {
        void (async () => {
        try {
          new Notice(this.L.mainNoticeRebuildingTextIndex);
          const result = await this.rebuildTextIndex();
          if (result.success) {
            // Atualizar as propriedades em memória após reconstrução
            this.indexedNotes = await readIndexedNotes(this.app) ?? [];
            this.indexedChunks = await readIndexedChunks(this.app) ?? [];
          }
          new Notice(result.message);
        } catch (error) {
          console.error("Erro ao reconstruir índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeRebuildTextIndexErrorPrefix}. ${message}`);
        }

        })();
      },
    });

    this.addCommand({
      id: "mostrar-estado-indice-textual",
      name: this.L.mainCommandShowIndexState,
      callback: () => {
        void (async () => {
        try {
          const status = await readTextIndexStatus(this.app);
          new IndexStatusModal(this.app, status).open();
        } catch (error) {
          console.error("Erro ao ler estado do índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeReadTextIndexStateErrorPrefix}. ${message}`);
        }

        })();
      },
    });

    this.addCommand({
      id: "pesquisar-indice-textual",
      name: this.L.mainCommandSearchTextIndex,
      callback: () => {
        void (async () => {
        try {
          if (this.indexedNotes.length === 0) {
            new Notice(this.L.mainNoticeTextIndexEmpty);
            return;
          }
          const safeChunks = this.filterChunksByUserContentRules(this.indexedChunks);
          const safeNotes = this.filterNotesByChunkPaths(this.indexedNotes, safeChunks);
          new TextSearchModal(this.app, safeNotes, safeChunks).open();
        } catch (error) {
          console.error("Erro ao pesquisar no índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeSearchTextIndexErrorPrefix}. ${message}`);
        }

        })();
      },
    });

    this.addCommand({
      id: "gerar-embeddings-locais",
      name: this.L.mainCommandGenerateLocalEmbeddings,
      callback: () => {
        void (async () => {
        try {
          const result = await this.generateLocalEmbeddings();
          new Notice(result.message);
        } catch (error) {
          console.error("Erro ao gerar embeddings locais:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeGenerateEmbeddingsErrorPrefix}. ${msg}`);
        }

        })();
      },
    });

    this.addCommand({
      id: "estado-embeddings-locais",
      name: this.L.mainCommandShowEmbeddingsState,
      callback: () => {
        void (async () => {
        try {
          const status = await readEmbeddingStatus(this.app);
          if (!status || !status.exists) {
            new Notice(this.L.mainNoticeNoLocalEmbeddings);
            return;
          }

          new Notice(
            `${status.validCount} válidos de ${status.totalChunks} chunks, ` +
            `${status.totalEmbeddings} total linhas em embeddings.jsonl, ` +
            `${status.missingCount} em falta, ${status.obsoleteCount} obsoletos, ` +
            `modelo ${status.model}, dimensão ${status.dimensions}.`
          );
        } catch (error) {
          console.error("Erro ao ler estado dos embeddings:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeReadEmbeddingsStateErrorPrefix}. ${msg}`);
        }

        })();
      },
    });

    this.addCommand({
      id: "pesquisar-semanticamente",
      name: this.L.mainCommandSemanticSearch,
      callback: () => {
        try {
          const baseUrl = this.settings.embeddingBaseUrl || this.settings.aiBaseUrl || "http://localhost:11434";
          const model = this.settings.embeddingModel || "nomic-embed-text";
          const timeoutMs = (this.settings.embeddingRequestTimeoutSeconds || 60) * 1000;

          if (!baseUrl) {
            new Notice(this.L.mainNoticeOllamaUrlMissing);
            return;
          }

          new NewSemanticSearchModal(this.app, baseUrl, model, timeoutMs, this).open();
        } catch (error) {
          console.error("Erro ao abrir pesquisa semântica:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeOpenSemanticSearchErrorPrefix}. ${msg}`);
        }
      },
    });

    this.addCommand({
      id: "mostrar-diagnostico-indice",
      name: this.L.mainCommandShowIndexDiagnostic,
      callback: () => {
        try {
          new IndexDiagnosticModal(this.app, this).open();
        } catch (error) {
          console.error("Erro ao abrir diagnóstico do índice:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeOpenIndexDiagnosticErrorPrefix}. ${msg}`);
        }
      },
    });

    this.addSettingTab(new LinaSettingTab(this.app, this));

    // Registrar listeners de eventos do vault para atualização automática
    this.registerVaultEventListeners();

    // Adicionar evento de diagnóstico para registo de listeners
    this.addDiagnosticEvent({
      eventType: this.settings.autoUpdateIndexOnFileChanges ? "index" : "ignored",
      path: "plugin",
      message: this.settings.autoUpdateIndexOnFileChanges ? "listeners registados" : "atualização automática desativada"
    });

    // Automacao no arranque (sem comando visivel)
    void this.runStartupIndexAutomation();
    void this.runStartupEmbeddingAutomation();
  }

  onunload() {
    this.cleanupVaultEventListeners();
  }

  async activateLinaSearchView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(LINA_SEARCH_VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) {
        throw new Error("Não foi possível criar painel direito para o Lina.");
      }
      leaf = rightLeaf;
      await leaf.setViewState({ type: LINA_SEARCH_VIEW_TYPE, active: true });
    }

    await workspace.revealLeaf(leaf);
  }

  async rebuildTextIndex(): Promise<LinaActionResult> {
    const excludedFoldersSetting = this.settings.indexExcludedFolders ?? "";
    const excludedPathContainsSetting = this.settings.indexExcludedPathContains ?? "";
    const excludedContentContainsSetting = this.settings.indexExcludedContentContains ?? "";

    const excludedFolders = parseMultilineSetting(excludedFoldersSetting);
    const excludedPathContains = parseMultilineSetting(excludedPathContainsSetting);
    const excludedContentContains = parseContentExclusionTerms(excludedContentContainsSetting);

    const exclusions = { excludedFolders, excludedPathContains };
    const obsidianConfigDir = this.app.vault.configDir;

    const shouldExcludeFn = (path: string): boolean => {
      return shouldExcludePath(path, exclusions, obsidianConfigDir).excluded;
    };

    const markdownFiles = this.app.vault.getMarkdownFiles();
    const scanResult = scanVaultForNotesWithExclusions(markdownFiles, shouldExcludeFn);

    const indexedNotes: IndexedNote[] = [];
    const allChunks: TextChunk[] = [];
    const now = new Date().toISOString();
    let contentExcludedCount = 0;

    for (const note of scanResult.included) {
      try {
        const file = this.app.vault.getAbstractFileByPath(note.path);
        if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          if (shouldExcludeContent(content, excludedContentContains).excluded) {
            contentExcludedCount++;
            continue;
          }

          indexedNotes.push({
            path: note.path,
            basename: note.basename,
            extension: note.extension,
            size: note.size,
            mtime: note.mtime,
            contentHash: hashContent(content),
            indexedAt: now,
          });

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
      enabled: true,
      alwaysExcludedFolders: getAlwaysExcludedFolders(obsidianConfigDir),
      excludedFoldersCount: excludedFolders.length,
      excludedPathContainsCount: excludedPathContains.length,
      excludedContentContainsCount: excludedContentContains.length,
    };

    const totalExcludedCount = scanResult.excludedCount + contentExcludedCount;

    const success = await saveTextIndex(
      this.app,
      indexedNotes,
      allChunks,
      chunkingOptions,
      totalExcludedCount,
      exclusionsInfo
    );

    if (!success) {
      return {
        success: false,
        message: "Erro ao guardar índice textual.",
      };
    }

    this.indexedNotes = indexedNotes;
    this.indexedChunks = allChunks;

    return {
      success: true,
      message: `Índice textual construído com sucesso. ${indexedNotes.length} notas indexadas, ${allChunks.length} blocos criados, ${totalExcludedCount} notas excluídas.`,
    };
  }

  async generateLocalEmbeddings(onProgress?: (message: string) => void): Promise<LinaActionResult> {
    const chunks = await readIndexedChunks(this.app);
    const safeChunks = chunks ? this.filterChunksByUserContentRules(chunks) : null;
    if (!safeChunks || safeChunks.length === 0) {
      return {
        success: false,
        message: "Índice textual vazio ou inexistente. Reconstrói o índice primeiro.",
      };
    }

    const baseUrl = getLocalEmbeddingsBaseUrl() || this.settings.embeddingBaseUrl || this.settings.embeddingLocalBaseUrl || this.settings.aiBaseUrl || "http://localhost:11434";
    const model = getLocalEmbeddingsModel() || this.settings.embeddingModel || this.settings.embeddingLocalModel || "nomic-embed-text";
    const timeoutMs = parseInt(getLocalEmbeddingsTimeout() || String(this.settings.embeddingRequestTimeoutSeconds || 60)) * 1000;

    if (!baseUrl) {
      return {
        success: false,
        message: "URL de embeddings não configurada. Define nas definições do plugin.",
      };
    }

    const result = await generateEmbeddingsForChunks(this.app, safeChunks, {
      baseUrl,
      model,
      provider: "ollama",
      timeoutMs,
      incremental: this.settings.generateOnlyMissingEmbeddings ?? this.settings.autoGenerateEmbeddingsOnlyWhenNeeded ?? true,
      shouldExcludeContent: (content) => this.isContentExcludedByUserRules(content),
      onProgress: (progress) => {
        if (onProgress) {
          onProgress(`A gerar embeddings locais... ${progress.current}/${progress.total}`);
        }
      },
    });

    if (!(result.success && result.total > 0)) {
      return {
        success: false,
        message: "Erro ao gerar embeddings locais.",
      };
    }

    const manifestOk = await updateManifestWithEmbeddings(
      this.app,
      result.total,
      result.dimensions,
      model,
      "ollama"
    );

    if (!manifestOk) {
      return {
        success: false,
        message: "Erro ao atualizar o manifesto dos embeddings.",
      };
    }

    return {
      success: true,
      message: result.generated > 0
        ? `Embeddings locais gerados com sucesso. ${result.generated} novos, ${result.kept} mantidos.`
        : `Embeddings locais atualizados com sucesso. ${result.kept} embeddings válidos mantidos.`,
    };
  }

  private registerVaultEventListeners(): void {
    // Limpar listeners existentes primeiro
    this.cleanupVaultEventListeners();

    // Só registar listeners se a atualização automática estiver ativa
    if (!this.settings.autoUpdateIndexOnFileChanges) {
      this.addDiagnosticEvent({
        eventType: "ignored",
        path: "plugin",
        message: "atualização automática desativada, listeners não registados"
      });
      return;
    }

    // Registrar listener para eventos de criação de ficheiros
    const createListener = this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        this.handleVaultFileChange("create", file);
      }
    });

    // Registrar listener para eventos de modificação de ficheiros
    const modifyListener = this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        this.handleVaultFileChange("modify", file);
      }
    });

    // Registrar listener para eventos de eliminação de ficheiros
    const deleteListener = this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        this.handleVaultFileChange("delete", file);
      }
    });

    // Registrar listener para eventos de renomeação de ficheiros
    const renameListener = this.app.vault.on("rename", (file, oldPath: string) => {
      if (file instanceof TFile && file.extension === "md") {
        this.handleVaultFileChange("rename", file, oldPath);
      }
    });

    // Guardar referências para cleanup
    this.vaultEventListeners.push(
      () => this.app.vault.offref(createListener),
      () => this.app.vault.offref(modifyListener),
      () => this.app.vault.offref(deleteListener),
      () => this.app.vault.offref(renameListener)
    );

    // Configurar debouncer para eventos de modificação
    this.modifyDebouncer = this.createDebouncer((file: TFile) => {
      void this.handleDebouncedModify(file);
    }, 2000);

    this.addDiagnosticEvent({
      eventType: "index",
      path: "plugin",
      message: "listeners do vault registados"
    });
  }

  private cleanupVaultEventListeners(): void {
    // Remover todos os listeners registados
    for (const unregister of this.vaultEventListeners) {
      try {
        unregister();
      } catch (error) {
        console.warn("Erro ao remover listener do vault:", error);
      }
    }
    this.vaultEventListeners = [];
  }

  private handleVaultFileChange(
    changeType: "create" | "modify" | "delete" | "rename",
    file: TFile,
    oldPath?: string
  ): void {
    // Add diagnostic event for received event
    this.addDiagnosticEvent({
      eventType: changeType,
      path: file.path,
      message: "evento recebido"
    });

    // Verificar se a atualização automática está ativada
    if (!this.settings.autoUpdateIndexOnFileChanges) {
      this.addDiagnosticEvent({
        eventType: "ignored",
        path: file.path,
        message: "atualização automática desativada"
      });
      return;
    }

    // Ignorar ficheiros que não são markdown
    if (file.extension !== "md") {
      this.addDiagnosticEvent({
        eventType: "ignored",
        path: file.path,
        message: "não é ficheiro Markdown"
      });
      return;
    }

    // Ignorar ficheiros em pastas excluídas
    const excludedFoldersSetting = this.settings.indexExcludedFolders ?? "";
    const excludedPathContainsSetting = this.settings.indexExcludedPathContains ?? "";
    const excludedFolders = parseMultilineSetting(excludedFoldersSetting);
    const excludedPathContains = parseMultilineSetting(excludedPathContainsSetting);
    const exclusions = { excludedFolders, excludedPathContains };

    if (shouldExcludePath(file.path, exclusions, this.app.vault.configDir).excluded) {
      this.addDiagnosticEvent({
        eventType: "ignored",
        path: file.path,
        message: "excluído por configuração de exclusão"
      });
      return;
    }

    // Para eventos de modificação, usar debouncer
    if (changeType === "modify") {
      // Adicionar ao conjunto de debounces pendentes
      this.indexDiagnostic.pendingDebounces.add(file.path);

      this.addDiagnosticEvent({
        eventType: "debounce",
        path: file.path,
        message: "debounce agendado"
      });
      this.modifyDebouncer?.(file);
      return;
    }

    // Para outros eventos, processar imediatamente
    this.updateTextIndexForFileChange(changeType, file, oldPath).catch(error => {
      console.error(`Erro ao processar ${changeType} para ${file.path}:`, error);
      this.addDiagnosticEvent({
        eventType: "error",
        path: file.path,
        message: `erro ao processar ${changeType}: ${error instanceof Error ? error.message : String(error)}`
      });
    });
  }

  private async handleDebouncedModify(file: TFile): Promise<void> {
    // Remover do conjunto de debounces pendentes
    this.indexDiagnostic.pendingDebounces.delete(file.path);

    this.addDiagnosticEvent({
      eventType: "debounce",
      path: file.path,
      message: "debounce executado"
    });

    await this.updateTextIndexForFileChange("modify", file).catch(error => {
      console.error(`Erro ao processar modificação debounced para ${file.path}:`, error);
      this.addDiagnosticEvent({
        eventType: "error",
        path: file.path,
        message: `erro no debounce: ${error instanceof Error ? error.message : String(error)}`
      });
    });
  }

  private async updateTextIndexForFileChange(
    changeType: "create" | "modify" | "delete" | "rename",
    file: TFile,
    oldPath?: string
  ): Promise<void> {
    try {
      const existingNotes = await readIndexedNotes(this.app) ?? [];
      const existingStatus = await readTextIndexStatus(this.app);
      const existingExcludedNotes = existingStatus.excludedNotes ?? existingStatus.manifest?.excludedNotes ?? 0;

      // Ler o conteúdo atual do ficheiro (se existir)
      let fileContent = "";
      if (changeType !== "delete" && file instanceof TFile) {
        try {
          fileContent = await this.app.vault.read(file);
        } catch (readError) {
          console.warn(`Não foi possível ler conteúdo de ${file.path}:`, readError);
          this.addDiagnosticEvent({
            eventType: "error",
            path: file.path,
            message: `erro ao ler conteúdo: ${readError instanceof Error ? readError.message : String(readError)}`
          });
          return;
        }
      }

      // Atualizar o índice com base no tipo de mudança
      let updatedNotes = [...existingNotes];
      let updatedChunks = [...((await readIndexedChunks(this.app)) ?? this.indexedChunks)];

      if (changeType !== "delete" && this.isContentExcludedByUserRules(fileContent)) {
        const pathsToRemove = new Set([file.path, oldPath].filter((path): path is string => !!path));
        updatedNotes = updatedNotes.filter(n => !pathsToRemove.has(n.path));
        updatedChunks = updatedChunks.filter(c => !pathsToRemove.has(c.path));
        this.addDiagnosticEvent({
          eventType: "ignored",
          path: file.path,
          message: "conteúdo excluído por regra configurada"
        });
      } else {
        switch (changeType) {
        case "create":
        case "modify": {
          // Remover chunks antigos da mesma nota (se existir)
          const noteIndex = updatedNotes.findIndex(n => n.path === file.path);
          const noteChunks = updatedChunks.filter(c => c.path === file.path);

          // Para modify, verificar se o conteúdo realmente mudou
          if (changeType === "modify" && noteIndex >= 0) {
            const oldContentHash = updatedNotes[noteIndex].contentHash;
            const newContentHash = hashContent(fileContent);

            // Se o conteúdo não mudou, não fazer nada
            if (oldContentHash === newContentHash) {
              this.addDiagnosticEvent({
                eventType: "ignored",
                path: file.path,
                message: "conteúdo sem alterações"
              });
              return;
            }
          }

          // Remover chunks antigos
          if (noteChunks.length > 0) {
            updatedChunks = updatedChunks.filter(c => c.path !== file.path);
          }

          // Criar novo registro de nota
          const newNote = {
            path: file.path,
            basename: file.basename,
            extension: file.extension,
            size: file.stat.size,
            mtime: file.stat.mtime,
            contentHash: hashContent(fileContent),
            indexedAt: new Date().toISOString(),
          };

          // Atualizar ou adicionar nota
          if (noteIndex >= 0) {
            updatedNotes[noteIndex] = newNote;
          } else {
            updatedNotes.push(newNote);
          }

          // Criar novos chunks
          const newChunks = chunkText(file.path, fileContent, { chunkSize: 1200, overlap: 150 });
          updatedChunks.push(...newChunks);
          break;
        }

        case "delete": {
          // Remover nota e chunks associados.
          // Para delete, usar file.path (oldPath não é passado pelo listener de delete).
          const deletePath = oldPath ?? file.path;
          updatedNotes = updatedNotes.filter(n => n.path !== deletePath);
          updatedChunks = updatedChunks.filter(c => c.path !== deletePath);
          break;
        }

        case "rename":
          if (oldPath) {
            // Atualizar caminho nos chunks e notas existentes
            updatedNotes = updatedNotes.map(n =>
              n.path === oldPath ? { ...n, path: file.path, basename: file.basename } : n
            );

            updatedChunks = updatedChunks.map(c =>
              c.path === oldPath ? { ...c, path: file.path, chunkId: `${file.path}::${c.chunkIndex}` } : c
            );
          }
          break;
      }

      }

      // Guardar o índice atualizado para disco E para memória
      this.indexedNotes = updatedNotes; // Atualizar propriedade em memória
      this.indexedChunks = updatedChunks; // Atualizar propriedade em memória

      const chunkingOptions = {
        enabled: true,
        chunkSize: 1200,
        overlap: 150,
      };

      const excludedFoldersSetting = this.settings.indexExcludedFolders ?? "";
      const excludedPathContainsSetting = this.settings.indexExcludedPathContains ?? "";
      const excludedContentContainsSetting = this.settings.indexExcludedContentContains ?? "";
      const excludedFolders = parseMultilineSetting(excludedFoldersSetting);
      const excludedPathContains = parseMultilineSetting(excludedPathContainsSetting);
      const excludedContentContains = parseContentExclusionTerms(excludedContentContainsSetting);

      const exclusionsInfo = {
        enabled: true,
        alwaysExcludedFolders: getAlwaysExcludedFolders(this.app.vault.configDir),
        excludedFoldersCount: excludedFolders.length,
        excludedPathContainsCount: excludedPathContains.length,
        excludedContentContainsCount: excludedContentContains.length,
      };

      const success = await saveTextIndex(
        this.app,
        updatedNotes,
        updatedChunks,
        chunkingOptions,
        existingExcludedNotes,
        exclusionsInfo
      );

      if (success) {
        if (this.settings.debugIndexUpdates) {
          console.debug(`Lina: índice atualizado após ${changeType} de ${file.path}`);
        }
        this.indexDiagnostic.totalNotes = updatedNotes.length;
        this.indexDiagnostic.totalChunks = updatedChunks.length;
        this.indexDiagnostic.lastResult = "índice incremental guardado";
        this.indexDiagnostic.lastUpdatedAt = new Date().toISOString();
        this.addDiagnosticEvent({
          eventType: "index",
          path: file.path,
          message: `índice atualizado após ${changeType}`
        });
      } else {
        console.error(`Lina: falha ao atualizar índice após ${changeType} de ${file.path}`);
        this.indexDiagnostic.lastResult = "erro no save";
        this.addDiagnosticEvent({
          eventType: "error",
          path: file.path,
          message: `falha ao atualizar índice após ${changeType}`
        });
      }
    } catch (error) {
      console.error(`Lina: erro ao processar ${changeType} para ${file.path}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      this.addDiagnosticEvent({
        eventType: "error",
        path: file.path,
        message: `erro ao atualizar índice: ${message}`
      });
    }
  }

  private createDebouncer<TArgs extends unknown[]>(fn: (...args: TArgs) => void, delay: number): (...args: TArgs) => void {
    let timeoutId: number | null = null;

    return (...args: TArgs) => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        fn(...args);
        timeoutId = null;
      }, delay);
    };
  }

  async loadSettings() {
    await this.loadDataFromDisk();
  }

  async saveSettings() {
    await this.saveDataToDisk();
  }

  private assignSettingValue<K extends keyof LinaSettings>(field: K, value: LinaSettings[K]): void {
    this.settings[field] = value;
  }

   async loadDataFromDisk() {
     const raw: unknown = await this.loadData();
     const data = isLinaStoredData(raw) ? raw : null;

     // Preservar valores do utilizador: carregar settings existentes primeiro, depois aplicar defaults apenas para campos em falta
     this.settings = Object.assign(
       {},
       DEFAULT_SETTINGS,
       data?.settings ?? {}
     );

     // Garantir que campos críticos do utilizador não são sobrescritos
     if (data?.settings) {
       // Lista de campos que devem ser preservados se já existirem
       const userFieldsToPreserve: Array<keyof LinaSettings> = [
         'aiProvider',
         'aiBaseUrl',
         'aiAnalysisModel',
         'aiRequestTimeoutSeconds',
         'aiOutputLanguage',
         'aiProfiles',
         'embeddingsEnabled',
         'embeddingProvider',
         'embeddingBaseUrl',
         'embeddingModel',
         'embeddingBatchSize',
         'embeddingRequestTimeoutSeconds',
         'generateEmbeddingsOnStartup',
         'generateOnlyMissingEmbeddings',
         'yamlSuggestionsEnabled',
         'yamlAllowedProperties',
         'yamlIncludeTags',
         'maxSuggestedTags',
         'inboxFolderPath',
          'maxInboxNotesToAnalyze',
          'folderAnalysisMaxNotes',
          'folderAnalysisIncludeSubfolders',
          'lastAnalyzedFolderPath',
          'checkSyncOnStartup',
          'updateIndexOnStartup',
          'indexExcludedContentContains',
          'autoUpdateIndexOnFileChanges',
          'debugIndexUpdates',
          'deviceSettingsById'
        ];

       // Restaurar valores do utilizador para campos que já tinham valores definidos
       for (const field of userFieldsToPreserve) {
         if (data.settings[field] !== undefined) {
            this.assignSettingValue(field, data.settings[field]);
          }
        }

       if (!Array.isArray(data.settings.aiProfiles) || data.settings.aiProfiles.length === 0) {
         this.settings.aiProfiles = buildDefaultAiProfiles(this.settings);
       }
      }

      setDeviceSettingsContext(this.settings, () => {
        void this.saveSettings();
      });

      this.indexData = data?.index ?? undefined;
    }

  async saveDataToDisk() {
    await this.saveData({
      settings: this.settings,
      index: this.indexData,
    });
  }

  private async runStartupEmbeddingAutomation(): Promise<void> {
    if (!this.settings.generateEmbeddingsOnStartup && !this.settings.autoGenerateEmbeddingsOnStartup) {
      return;
    }

    if (!this.settings.embeddingsEnabled && !this.settings.embeddingLocalEnabled) {
      return;
    }

    try {
      const chunks = await readIndexedChunks(this.app);
      const safeChunks = chunks ? this.filterChunksByUserContentRules(chunks) : null;
      if (!safeChunks || safeChunks.length === 0) {
        return;
      }

      const baseUrl = this.settings.embeddingBaseUrl || this.settings.embeddingLocalBaseUrl || this.settings.aiBaseUrl || "http://localhost:11434";
      const model = this.settings.embeddingModel || this.settings.embeddingLocalModel || "nomic-embed-text";
      const timeoutMs = (this.settings.embeddingRequestTimeoutSeconds || 60) * 1000;

      if (!baseUrl) {
        return;
      }

      const statusBarItem = this.addStatusBarItem();
      statusBarItem.setText("Lina: a verificar embeddings...");

      const incremental = this.settings.generateOnlyMissingEmbeddings ?? this.settings.autoGenerateEmbeddingsOnlyWhenNeeded ?? true;

      const result = await generateEmbeddingsForChunks(this.app, safeChunks, {
        baseUrl,
        model,
        provider: "ollama",
        timeoutMs,
        incremental,
        shouldExcludeContent: (content) => this.isContentExcludedByUserRules(content),
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
        console.log(`Lina: ${result.generated} novos embeddings gerados automaticamente.`);
      }
    } catch (error) {
      console.warn("Lina: erro na geracao automatica de embeddings:", error);
    }
  }

  private async runStartupIndexAutomation(): Promise<void> {
    if (this.settings.updateIndexOnStartup) {
      const result = await updateIndexIncrementally(this.app.vault, this.indexData, {
        shouldExcludeContent: (content) => this.isContentExcludedByUserRules(content),
      });
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

  // Diagnostic methods
  public getIndexDiagnosticData() {
    return {
      autoUpdateEnabled: this.settings.autoUpdateIndexOnFileChanges ?? false,
      debugEnabled: this.settings.debugIndexUpdates ?? false,
      lastEvent: this.indexDiagnostic.lastEvent,
      lastEventPath: this.indexDiagnostic.lastEventPath,
      lastAction: this.indexDiagnostic.lastAction,
      lastResult: this.indexDiagnostic.lastResult,
      lastUpdatedAt: this.indexDiagnostic.lastUpdatedAt,
      lastError: this.indexDiagnostic.lastError,
      totalNotes: this.indexDiagnostic.totalNotes,
      totalChunks: this.indexDiagnostic.totalChunks,
      pendingDebounces: this.indexDiagnostic.pendingDebounces.size,
      recentEvents: [...this.indexDiagnostic.recentEvents]
    };
  }

  public clearIndexDiagnosticEvents() {
    this.indexDiagnostic.recentEvents = [];
    this.indexDiagnostic.lastError = undefined;
  }

  private addDiagnosticEvent(event: {
    eventType: "create" | "modify" | "delete" | "rename" | "debounce" | "index" | "ignored" | "error";
    path: string;
    message: string;
  }) {
    // Only add events if debug mode is enabled
    if (!this.settings.debugIndexUpdates) {
      return;
    }

    // Limit to 50 recent events to prevent memory issues
    if (this.indexDiagnostic.recentEvents.length >= 50) {
      this.indexDiagnostic.recentEvents.shift(); // Remove oldest event
    }

    this.indexDiagnostic.recentEvents.push({
      timestamp: new Date().toLocaleTimeString(),
      ...event
    });

    // Update last event info
    this.indexDiagnostic.lastEvent = event.eventType;
    this.indexDiagnostic.lastEventPath = event.path;
    this.indexDiagnostic.lastAction = event.message;

    if (event.eventType === "error") {
      this.indexDiagnostic.lastError = event.message;
    }
  }

  /**
   * Método público para atualizar os listeners quando a setting de atualização automática muda
   */
  public updateVaultEventListeners() {
    this.registerVaultEventListeners();

    // Adicionar evento de diagnóstico
    this.addDiagnosticEvent({
      eventType: "index",
      path: "settings",
      message: this.settings.autoUpdateIndexOnFileChanges ? "listeners registados" : "listeners removidos"
    });
  }
}
