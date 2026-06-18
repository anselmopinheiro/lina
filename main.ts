import { Notice, Plugin, TFolder, TFile } from "obsidian";
import { DEFAULT_SETTINGS, LinaSettings, LinaSettingTab, buildDefaultAiProfiles } from "./src/settings";
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

export interface LinaActionResult {
  success: boolean;
  message: string;
}

export default class LinaPlugin extends Plugin {
  settings!: LinaSettings;
  indexData?: IndexData;
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

  async onload() {
    await this.loadDataFromDisk();

    this.registerView(
      LINA_SEARCH_VIEW_TYPE,
      (leaf) => new LinaSearchView(leaf, this)
    );

    new Notice("Lina carregado.");

    // --- Comandos essenciais para o utilizador ---

    this.addCommand({
      id: "pesquisar-lina",
      name: "Lina: pesquisar",
      callback: async () => {
        try {
          await this.activateLinaSearchView();
        } catch (error) {
          console.error("Lina: erro ao abrir pesquisa lateral", error);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao abrir pesquisa lateral. ${message}`);
        }
      },
    });

    this.addCommand({
      id: "reconstruir-indice-textual",
      name: "Lina: reconstruir índice textual",
      callback: async () => {
        try {
          new Notice("Lina: a reconstruir índice textual e blocos...");
          const result = await this.rebuildTextIndex();
          new Notice(result.message);
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
          const result = await this.generateLocalEmbeddings();
          new Notice(result.message);
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
          const baseUrl = this.settings.embeddingBaseUrl || this.settings.aiBaseUrl || "http://localhost:11434";
          const model = this.settings.embeddingModel || "nomic-embed-text";
          const timeoutMs = (this.settings.embeddingRequestTimeoutSeconds || 60) * 1000;

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

    this.addCommand({
      id: "mostrar-diagnostico-indice",
      name: "Lina: mostrar diagnóstico do índice",
      callback: () => {
        try {
          new IndexDiagnosticModal(this.app, this).open();
        } catch (error) {
          console.error("Lina: erro ao abrir diagnóstico do índice:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`Lina: erro ao abrir diagnóstico do índice. ${msg}`);
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

    const baseUrl = this.settings.embeddingBaseUrl || this.settings.embeddingLocalBaseUrl || this.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.settings.embeddingModel || this.settings.embeddingLocalModel || "nomic-embed-text";
    const timeoutMs = (this.settings.embeddingRequestTimeoutSeconds || 60) * 1000;

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

      if (!existingNotes || !existingChunks) {
        console.warn("Índice textual não existe. Ignorando atualização incremental.");
        return;
      }

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
      let updatedNotes = [...existingNotes];
      let updatedChunks = [...existingChunks];

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

      // Guardar o índice atualizado
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
      data?.settings ?? {},
      DEFAULT_SETTINGS
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
        'maxInboxNotesToAnalyze'
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
