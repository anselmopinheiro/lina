import { Notice, Plugin, TFolder, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  LinaSettings,
  LinaSettingTab,
  buildDefaultAiProfiles,
  getLocalEmbeddingsBaseUrl,
  getLocalEmbeddingsModel,
  getLocalEmbeddingsBatchSize,
  getLocalEmbeddingsTimeout,
  getLocalEmbeddingsProvider,
  getLocalAnalysisProvider,
  getLocalAnalysisBaseUrl,
  getLocalAnalysisModel,
  getLocalAnalysisTimeout,
  getLocalAnalysisApiKey
} from "./src/settings";
import { buildIndex, IndexData, updateIndexIncrementally } from "./src/indexStore";
import { getIndexSyncStatus } from "./src/indexSyncStatus";
import { scanVaultForNotes, scanVaultForNotesWithExclusions } from "./src/index/noteScanner";
import { createTextIndex, saveTextIndex, readTextIndexStatus, readIndexedNotes, readIndexedChunks } from "./src/index/indexStore";
import { getAlwaysExcludedFolders, parseMultilineSetting, shouldExcludePath } from "./src/index/indexExclusions";
import { chunkText } from "./src/index/chunker";
import { hashContent } from "./src/index/noteHasher";
import { IndexStatusModal } from "./src/index/indexStatusModal";
import { TextSearchModal } from "./src/search/textSearchModal";
import { generateEmbeddingsForChunks, updateManifestWithEmbeddings, readEmbeddingStatus } from "./src/index/embeddingGenerator";
import { EmbeddingProgressModal } from "./src/index/embeddingProgressModal";
import { SemanticSearchModal as NewSemanticSearchModal } from "./src/search/semanticSearchModal";
import { HybridSearchModal } from "./src/search/hybridSearchModal";
import { IndexDiagnosticModal } from "./src/indexDiagnosticModal";
import { LINA_SEARCH_VIEW_TYPE, LinaSearchView } from "./src/search/linaSearchView";
import { getStrings, UiStrings } from "./src/i18n/strings";

export interface LinaActionResult {
  success: boolean;
  message: string;
}

export default class LinaPlugin extends Plugin {
  settings!: LinaSettings;
  indexData?: IndexData;
  indexedNotes: IndexedNote[] = []; // Adicionado para persistir o índice textual
  indexedChunks: TextChunk[] = []; // Adicionado para persistir os chunks textuais
  private vaultEventListeners: (() => void)[] = [];
  private modifyDebouncer?: any;
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
      callback: async () => {
        try {
          await this.activateLinaSearchView();
        } catch (error) {
          console.error("Lina: erro ao abrir pesquisa lateral", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeOpenSideSearchErrorPrefix}. ${message}`);
        }
      },
    });

    this.addCommand({
      id: "reconstruir-indice-textual",
      name: this.L.mainCommandRebuildTextIndex,
      callback: async () => {
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
      },
    });

    this.addCommand({
      id: "mostrar-estado-indice-textual",
      name: this.L.mainCommandShowIndexState,
      callback: async () => {
        try {
          const status = await readTextIndexStatus(this.app);
          new IndexStatusModal(this.app, status).open();
        } catch (error) {
          console.error("Erro ao ler estado do índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeReadTextIndexStateErrorPrefix}. ${message}`);
        }
      },
    });

    this.addCommand({
      id: "pesquisar-indice-textual",
      name: this.L.mainCommandSearchTextIndex,
      callback: async () => {
        try {
          if (this.indexedNotes.length === 0) {
            new Notice(this.L.mainNoticeTextIndexEmpty);
            return;
          }
          new TextSearchModal(this.app, this.indexedNotes, this.indexedChunks).open();
        } catch (error) {
          console.error("Erro ao pesquisar no índice textual", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeSearchTextIndexErrorPrefix}. ${message}`);
        }
      },
    });

    this.addCommand({
      id: "gerar-embeddings-locais",
      name: this.L.mainCommandGenerateLocalEmbeddings,
      callback: async () => {
        try {
          const result = await this.generateLocalEmbeddings();
          new Notice(result.message);
        } catch (error) {
          console.error("Erro ao gerar embeddings locais:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeGenerateEmbeddingsErrorPrefix}. ${msg}`);
        }
      },
    });

    this.addCommand({
      id: "estado-embeddings-locais",
      name: this.L.mainCommandShowEmbeddingsState,
      callback: async () => {
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

    workspace.revealLeaf(leaf);
  }

  async rebuildTextIndex(): Promise<LinaActionResult> {
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
      enabled: true,
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

    if (!success) {
      return {
        success: false,
        message: "Erro ao guardar índice textual.",
      };
    }

    return {
      success: true,
      message: `Índice textual construído com sucesso. ${indexedNotes.length} notas indexadas, ${allChunks.length} blocos criados, ${scanResult.excludedCount} notas excluídas.`,
    };
  }

  async generateLocalEmbeddings(onProgress?: (message: string) => void): Promise<LinaActionResult> {
    const chunks = await readIndexedChunks(this.app);
    if (!chunks || chunks.length === 0) {
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

    const result = await generateEmbeddingsForChunks(this.app, chunks, {
      baseUrl,
      model,
      provider: "ollama",
      timeoutMs,
      incremental: this.settings.generateOnlyMissingEmbeddings ?? this.settings.autoGenerateEmbeddingsOnlyWhenNeeded ?? true,
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
      console.log("Lina: atualização automática desativada, listeners não registados");
      return;
    }

    console.log("Lina: a registar listeners para atualização automática");

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
    this.modifyDebouncer = this.createDebouncer(this.handleDebouncedModify.bind(this), 2000);

    console.log("Lina: listeners registados com sucesso");
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

    if (shouldExcludePath(file.path, exclusions).excluded) {
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
      const existingNotes = await readIndexedNotes(this.app);
      const existingChunks = await readIndexedChunks(this.app);

      // Ler o conteúdo atual do ficheiro (se existir)
      let fileContent = "";
      if (changeType !== "delete" && file instanceof TFile) {
        try {
          fileContent = await this.app.vault.read(file);
        } catch (readError) {
          console.warn(`Não foi possível ler conteúdo de ${file.path}:`, readError);
          return;
        }
      }

      // Atualizar o índice com base no tipo de mudança
      let updatedNotes = [...this.indexedNotes]; // Usar as notas em memória
      let updatedChunks = [...this.indexedChunks]; // Usar os chunks em memória

      switch (changeType) {
        case "create":
        case "modify":
          // Remover chunks antigos da mesma nota (se existir)
          const noteIndex = updatedNotes.findIndex(n => n.path === file.path);
          const noteChunks = updatedChunks.filter(c => c.path === file.path);

          // Para modify, verificar se o conteúdo realmente mudou
          if (changeType === "modify" && noteIndex >= 0) {
            const oldContentHash = updatedNotes[noteIndex].contentHash;
            const newContentHash = hashContent(fileContent);

            // Se o conteúdo não mudou, não fazer nada
            if (oldContentHash === newContentHash) {
              console.log(`Lina: conteúdo de ${file.path} não mudou, índice já está atualizado`);
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

        case "delete":
          // Remover nota e chunks associados
          updatedNotes = updatedNotes.filter(n => n.path !== oldPath);
          updatedChunks = updatedChunks.filter(c => c.path !== oldPath);
          break;

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
      const excludedFolders = parseMultilineSetting(excludedFoldersSetting);
      const excludedPathContains = parseMultilineSetting(excludedPathContainsSetting);

      const exclusionsInfo = {
        enabled: true,
        alwaysExcludedFolders: getAlwaysExcludedFolders(),
        excludedFoldersCount: excludedFolders.length,
        excludedPathContainsCount: excludedPathContains.length,
      };

      const success = await saveTextIndex(
        this.app,
        updatedNotes,
        updatedChunks,
        chunkingOptions,
        existingNotes.length - updatedNotes.length, // notas excluídas
        exclusionsInfo
      );

      if (success) {
        console.log(`Lina: índice atualizado após ${changeType} de ${file.path}`);
        if (changeType !== "modify") {
          new Notice(`Lina: índice atualizado após ${changeType} de ${file.basename}`);
        }
      } else {
        console.error(`Lina: falha ao atualizar índice após ${changeType} de ${file.path}`);
      }
    } catch (error) {
      console.error(`Lina: erro ao processar ${changeType} para ${file.path}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Lina: erro ao atualizar índice. ${message}`);
    }
  }

  private createDebouncer(fn: (...args: any[]) => void, delay: number): (...args: any[]) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return (...args: any[]) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
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

   async loadDataFromDisk() {
     const raw = await this.loadData();
     const data = raw as {
       settings?: LinaSettings;
       index?: IndexData;
     } | null;

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
         'checkSyncOnStartup',
         'updateIndexOnStartup',
         'autoUpdateIndexOnFileChanges',
         'debugIndexUpdates'
       ];

       // Restaurar valores do utilizador para campos que já tinham valores definidos
       for (const field of userFieldsToPreserve) {
         if (data.settings[field] !== undefined) {
           (this.settings[field] as any) = data.settings[field];
         }
       }

       if (!Array.isArray(data.settings.aiProfiles) || data.settings.aiProfiles.length === 0) {
         this.settings.aiProfiles = buildDefaultAiProfiles(this.settings);
       }
     }

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
      if (!chunks || chunks.length === 0) {
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

  private updateDiagnosticStats() {
    if (!this.settings.debugIndexUpdates) {
      return;
    }

    // Update stats asynchronously to avoid blocking
    setTimeout(async () => {
      try {
        const notes = await readIndexedNotes(this.app);
        const chunks = await readIndexedChunks(this.app);

        this.indexDiagnostic.totalNotes = notes?.length;
        this.indexDiagnostic.totalChunks = chunks?.length;
        this.indexDiagnostic.lastUpdatedAt = new Date().toLocaleString();
      } catch (error) {
        console.warn("Lina: erro ao atualizar estatísticas de diagnóstico:", error);
      }
    }, 100);
  }

  /**
   * Método público para atualizar os listeners quando a setting de atualização automática muda
   */
  public updateVaultEventListeners() {
    console.log(`Lina: atualizando listeners (autoUpdateIndexOnFileChanges: ${this.settings.autoUpdateIndexOnFileChanges})`);
    this.registerVaultEventListeners();

    // Adicionar evento de diagnóstico
    this.addDiagnosticEvent({
      eventType: "index",
      path: "settings",
      message: this.settings.autoUpdateIndexOnFileChanges ? "listeners registados" : "listeners removidos"
    });
  }
}
