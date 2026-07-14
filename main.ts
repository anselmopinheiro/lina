import { Notice, Plugin, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  LinaSettings,
  LinaSettingTab,
  buildDefaultAiProfiles,
  getLocalEmbeddingsBaseUrl,
  getLocalEmbeddingsModel,
  getLocalEmbeddingsTimeout,
  getLocalEmbeddingsProvider,
  getLocalEmbeddingsApiKey,
  getLocalAnalysisProvider,
  getLocalAnalysisBaseUrl,
  getLocalAnalysisModel,
  getLocalAnalysisTimeout,
  getLocalAnalysisApiKey,
  setPluginSettingsRef,
  setDeviceSettingsContext
} from "./src/settings";
import {
  chooseProviderDefaultBaseUrl,
  chooseProviderDefaultModel,
  getEmbeddingProviderDefaults,
  OLLAMA_DEFAULT_BASE_URL
} from "./src/ai/providerDefaults";
import { IndexData, updateIndexIncrementally } from "./src/indexStore";
import { getIndexSyncStatus } from "./src/indexSyncStatus";
import { scanVaultForNotesWithExclusions } from "./src/index/noteScanner";
import { saveTextIndex, persistAndActivateTextIndexCandidate, readTextIndexStatus, readIndexedNotes, readIndexedChunks, IndexedNote } from "./src/index/indexStore";
import { getAlwaysExcludedFolders, parseContentExclusionTerms, parseMultilineSetting, shouldExcludeContent, shouldExcludePath } from "./src/index/indexExclusions";
import {
  AutomaticUpdateChangeType,
  buildStartupReconciliationPlan,
  coalesceAutomaticUpdateEvent,
  createPathScopedDebouncer,
  getInternalAutomaticUpdateIgnoreReason,
  getVaultEventPath,
  getVaultRenameOldPath,
  isMarkdownPath,
  PathScopedDebouncer,
} from "./src/index/automaticUpdateEvents";
import { chunkText, Chunk as TextChunk } from "./src/index/chunker";
import { hashContent } from "./src/index/noteHasher";
import { IndexStatusModal } from "./src/index/indexStatusModal";
import { TextSearchModal } from "./src/search/textSearchModal";
import { generateEmbeddingsForChunks, updateManifestWithEmbeddings, readEmbeddingStatus } from "./src/index/embeddingGenerator";
import {
  EmbeddingOperationManager,
  EmbeddingOperationOrigin,
  EmbeddingOperationRequestResult,
  EmbeddingOperationState
} from "./src/index/embeddingOperationManager";
import {
  IndexWriteCoordinator,
  IndexWriteCoordinatorResult,
  IndexWriteCoordinatorToken
} from "./src/index/indexWriteCoordinator";
import { SemanticSearchModal as NewSemanticSearchModal } from "./src/search/semanticSearchModal";
import { IndexDiagnosticModal } from "./src/indexDiagnosticModal";
import { LINA_SEARCH_VIEW_TYPE, LinaSearchView } from "./src/search/linaSearchView";
import { getStrings, UiStrings } from "./src/i18n/strings";

export interface LinaActionResult {
  success: boolean;
  message: string;
}

export type EmbeddingIndexGenerationRequestResult =
  | EmbeddingOperationRequestResult
  | {
    status: "text-index-busy";
    state: EmbeddingOperationState;
  };

export type TextIndexRebuildStatus = "idle" | "running" | "cancelling" | "completed" | "failed" | "cancelled";

export interface TextIndexRebuildProgress {
  status: TextIndexRebuildStatus;
  total: number;
  processed: number;
  skipped: number;
  errors: number;
}

const TEXT_INDEX_REBUILD_BATCH_SIZE = 10;
const AUTOMATIC_UPDATE_STARTUP_GRACE_MS = 5000;
const AUTOMATIC_UPDATE_PENDING_FLUSH_MS = 1000;

type TextIndexLoadReason =
  | "startup"
  | "layout-ready"
  | "view-open"
  | "text-search"
  | "hybrid-search"
  | "automatic-update"
  | "vault-create"
  | "vault-modify"
  | "vault-delete"
  | "vault-rename"
  | "manual-embeddings";

interface LinaStoredData {
  settings?: Partial<LinaSettings>;
  index?: IndexData;
}

interface PendingAutomaticIndexUpdate {
  changeType: AutomaticUpdateChangeType;
  file?: TFile;
  path: string;
  oldPath?: string;
  receivedAt: string;
}

interface SkippedAutomaticIndexCandidate {
  changeType: AutomaticUpdateChangeType;
  path: string;
  reason: string;
}

interface AutomaticBatchProcessingOptions {
  allowEmbeddingReservation?: boolean;
}

const AUTOMATIC_UPDATE_LOG_PATH_LIMIT = 20;

function summarizeAutomaticUpdates(updates: PendingAutomaticIndexUpdate[]): Record<string, unknown> {
  const eventCounts: Record<AutomaticUpdateChangeType, number> = {
    create: 0,
    modify: 0,
    delete: 0,
    rename: 0,
  };

  for (const update of updates) {
    eventCounts[update.changeType]++;
  }

  const paths = updates.map((update) => update.oldPath ? `${update.oldPath} -> ${update.path}` : update.path);
  const includedPaths = paths.slice(0, AUTOMATIC_UPDATE_LOG_PATH_LIMIT);

  return {
    eventTypes: Object.entries(eventCounts)
      .filter(([, count]) => count > 0)
      .map(([eventType]) => eventType),
    eventCounts,
    firstPath: updates[0]?.path,
    paths: includedPaths,
    omittedPaths: Math.max(0, paths.length - includedPaths.length),
  };
}

function summarizeSkippedAutomaticIndexCandidates(
  candidates: SkippedAutomaticIndexCandidate[]
): Record<string, unknown> {
  const reasonCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    reasonCounts[candidate.reason] = (reasonCounts[candidate.reason] ?? 0) + 1;
  }

  const includedCandidates = candidates
    .slice(0, AUTOMATIC_UPDATE_LOG_PATH_LIMIT)
    .map((candidate) => ({
      path: candidate.path,
      changeType: candidate.changeType,
      reason: candidate.reason,
    }));

  return {
    skippedCandidateCount: candidates.length,
    skippedReasonCounts: reasonCounts,
    skippedCandidates: includedCandidates,
    omittedSkippedCandidates: Math.max(0, candidates.length - includedCandidates.length),
  };
}

export interface EffectiveEmbeddingConfig {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey: string;
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
  indexedNotes: IndexedNote[] = [];
  indexedChunks: TextChunk[] = [];
  private textIndexLoaded = false;
  private vaultEventListeners: (() => void)[] = [];
  private modifyDebouncer?: PathScopedDebouncer<TFile>;
  private textIndexRebuildProgress: TextIndexRebuildProgress = {
    status: "idle", total: 0, processed: 0, skipped: 0, errors: 0
  };
  private textIndexRebuildListeners = new Set<(progress: TextIndexRebuildProgress) => void>();
  private activeAutomaticIndexUpdates = 0;
  private automaticUpdatesReady = false;
  private automaticUpdateInProgress = false;
  private automaticUpdatePromise: Promise<void> | null = null;
  private automaticUpdatePending = false;
  private startupReconciliationNeeded = false;
  private startupReconciliationInProgress = false;
  private startupIgnoredEventCount = 0;
  private embeddingOperationManager?: EmbeddingOperationManager;
  private embeddingOperationManagerDisposed = false;
  private indexWriteCoordinator?: IndexWriteCoordinator;
  private indexWriteCoordinatorDisposed = false;
  private textIndexLoadPromise: Promise<boolean> | null = null;
  private pendingAutomaticUpdates = new Map<string, PendingAutomaticIndexUpdate>();
  private pendingAutomaticUpdatesFlushTimer: number | null = null;
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
    this.automaticUpdatesReady = false;
    await this.loadDataFromDisk();

    setPluginSettingsRef(this.settings, () => this.saveSettings());

    await this.logTextIndexStartupStatus();

    this.registerView(
      LINA_SEARCH_VIEW_TYPE,
      (leaf) => new LinaSearchView(leaf, this)
    );

    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => {
        void this.completeAutomaticUpdatesStartup().catch((error) => {
          console.error("Lina: failed to complete automatic update startup:", error);
        });
      }, AUTOMATIC_UPDATE_STARTUP_GRACE_MS);
    });

    this.addRibbonIcon("search", this.L.mainRibbonOpenLina, () => {
      void this.activateLinaSearchView().catch((error) => {
        console.error("Lina: failed to open side search from ribbon", error);
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`${this.L.mainNoticeOpenLinaErrorPrefix}. ${message}`);
      });
    });

    new Notice(this.L.mainNoticeLinaLoaded);

    this.addCommand({
      id: "pesquisar",
      name: this.L.mainCommandSearch,
      callback: () => {
        void (async () => {
        try {
          await this.activateLinaSearchView();
        } catch (error) {
          console.error("Lina: failed to open side search", error);
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
          new Notice(result.message);
        } catch (error) {
          console.error("Lina: failed to rebuild text index", error);
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
          console.error("Lina: failed to read text index status", error);
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
          const loaded = await this.ensureTextIndexLoaded("text-search");
          if (!loaded || this.indexedNotes.length === 0) {
            new Notice(this.L.mainNoticeTextIndexEmpty);
            return;
          }
          const safeChunks = this.filterChunksByUserContentRules(this.indexedChunks);
          const safeNotes = this.filterNotesByChunkPaths(this.indexedNotes, safeChunks);
          new TextSearchModal(this.app, safeNotes, safeChunks).open();
        } catch (error) {
          console.error("Lina: failed to search text index", error);
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
          const request = this.requestEmbeddingIndexGeneration("command");
          if (request.status !== "accepted") {
            if (request.status === "already-running") {
              new Notice(this.L.toastEmbeddingsAlreadyRunning);
              return;
            }
            if (request.status === "text-index-busy") {
              new Notice(this.L.mainNoticeTextIndexBusyForEmbeddings);
              return;
            }
            new Notice(this.L.toastEmbeddingsError);
            return;
          }

          new Notice(this.L.toastGeneratingEmbeddings);
          const completion = await request.completion;
          new Notice(completion.result.message);
        } catch (error) {
          console.error("Lina: failed to generate embeddings:", error);
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
          console.error("Lina: failed to read embedding status:", error);
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
          const embeddingConfig = this.getEffectiveEmbeddingConfig();
          if (!embeddingConfig.baseUrl) {
            new Notice(this.L.mainNoticeOllamaUrlMissing);
            return;
          }
          new NewSemanticSearchModal(this.app, embeddingConfig, this).open();
        } catch (error) {
          console.error("Lina: failed to open semantic search:", error);
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
          console.error("Lina: failed to open index diagnostic:", error);
          const msg = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.mainNoticeOpenIndexDiagnosticErrorPrefix}. ${msg}`);
        }
      },
    });

    this.addSettingTab(new LinaSettingTab(this.app, this));

    this.registerVaultEventListeners();

    this.addDiagnosticEvent({
      eventType: this.settings.autoUpdateIndexOnFileChanges ? "index" : "ignored",
      path: "plugin",
      message: this.settings.autoUpdateIndexOnFileChanges ? "listeners registered" : "automatic update disabled"
    });

    void this.runStartupIndexAutomation();
    void this.runStartupEmbeddingAutomation();
  }

  onunload() {
    this.embeddingOperationManager?.dispose();
    this.embeddingOperationManagerDisposed = true;
    this.indexWriteCoordinator?.dispose();
    this.indexWriteCoordinatorDisposed = true;
    this.modifyDebouncer?.cancelAll();
    this.modifyDebouncer = undefined;
    this.indexDiagnostic.pendingDebounces.clear();
    if (this.pendingAutomaticUpdatesFlushTimer !== null) {
      window.clearTimeout(this.pendingAutomaticUpdatesFlushTimer);
      this.pendingAutomaticUpdatesFlushTimer = null;
    }
    this.pendingAutomaticUpdates.clear();
    this.automaticUpdatePromise = null;
    this.automaticUpdatePending = false;
    this.textIndexLoadPromise = null;
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

  getTextIndexRebuildProgress(): TextIndexRebuildProgress {
    return { ...this.textIndexRebuildProgress };
  }

  getEmbeddingOperationState(): EmbeddingOperationState {
    return this.getEmbeddingOperationManager().getState();
  }

  onEmbeddingOperationStateChange(listener: (state: EmbeddingOperationState) => void): () => void {
    return this.getEmbeddingOperationManager().subscribe(listener);
  }

  requestEmbeddingIndexGeneration(
    origin: EmbeddingOperationOrigin,
    onProgress?: (message: string) => void
  ): EmbeddingIndexGenerationRequestResult {
    if (this.textIndexRebuildProgress.status === "running" || this.textIndexRebuildProgress.status === "cancelling") {
      return {
        status: "text-index-busy",
        state: this.getEmbeddingOperationManager().getState(),
      };
    }

    const manager = this.getEmbeddingOperationManager();
    const currentEmbeddingState = manager.getState();
    if (currentEmbeddingState.status === "running") {
      return {
        status: "already-running",
        state: currentEmbeddingState,
      };
    }

    const reservation = this.getIndexWriteCoordinator().requestEmbeddingGenerationPreparation();
    if (reservation.status !== "accepted") {
      return {
        status: reservation.status === "disposed" ? "disposed" : "text-index-busy",
        state: currentEmbeddingState,
      };
    }

    const request = manager.request(
      origin,
      async () => {
        let generationToken: IndexWriteCoordinatorToken | undefined;
        try {
          await this.drainAutomaticUpdatesBeforeEmbeddingGeneration();

          const activation = this.getIndexWriteCoordinator().startEmbeddingGeneration();
          if (activation.status !== "accepted") {
            return {
              success: false,
              message: this.getEmbeddingGenerationBlockedByTextIndexMessage(activation),
            };
          }

          generationToken = activation.token;
          return await this.runGenerateLocalEmbeddings(onProgress);
        } finally {
          if (generationToken) {
            this.getIndexWriteCoordinator().finish(generationToken);
          } else {
            this.getIndexWriteCoordinator().cancelEmbeddingGenerationPreparation();
          }
          this.schedulePendingAutomaticUpdatesFlush();
        }
      }
    );

    if (request.status !== "accepted") {
      this.getIndexWriteCoordinator().cancelEmbeddingGenerationPreparation();
    }

    return request;
  }

  async ensureTextIndexLoaded(reason: TextIndexLoadReason): Promise<boolean> {
    if (this.textIndexLoaded) {
      return true;
    }

    if (this.textIndexLoadPromise) {
      return this.textIndexLoadPromise;
    }

    this.textIndexLoadPromise = this.loadTextIndexIntoMemory(reason);
    try {
      return await this.textIndexLoadPromise;
    } finally {
      this.textIndexLoadPromise = null;
    }
  }

  private async loadTextIndexIntoMemory(reason: TextIndexLoadReason): Promise<boolean> {
    this.logAutomaticUpdateDiagnostic("text index lazy load", {
      reason,
      timestamp: new Date().toISOString(),
    });
    const notes = await readIndexedNotes(this.app);
    const chunks = await readIndexedChunks(this.app);
    if (!notes || !chunks) {
      this.indexedNotes = [];
      this.indexedChunks = [];
      this.textIndexLoaded = false;
      this.logAutomaticUpdateDiagnostic("text index lazy load failed", {
        reason,
        notesAvailable: !!notes,
        chunksAvailable: !!chunks,
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    this.indexedNotes = notes;
    this.indexedChunks = chunks;
    this.textIndexLoaded = true;
    this.logAutomaticUpdateDiagnostic("text index lazy load completed", {
      reason,
      notes: notes.length,
      chunks: chunks.length,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  private async logTextIndexStartupStatus(): Promise<void> {
    try {
      const status = await readTextIndexStatus(this.app);
      if (status.exists) {
        console.debug(`Lina: text index available. ${status.totalNotes ?? 0} notes, ${status.totalChunks ?? 0} chunks.`);
      } else {
        console.debug("Lina: text index empty or not found at startup.");
      }
    } catch (error) {
      console.error("Lina: failed to read text index status at startup:", error);
      new Notice(`${this.L.mainNoticeTextIndexLoadErrorPrefix}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private logStartupReconciliation(message: string, details?: Record<string, unknown>): void {
    console.debug("[Lina startup reconciliation]", {
      message,
      ...details,
    });
  }

  private async completeAutomaticUpdatesStartup(): Promise<void> {
    const ignoredEventCount = this.startupIgnoredEventCount;
    const reconciliationWasNeeded = this.startupReconciliationNeeded;

    try {
      this.startupReconciliationInProgress = true;
      await this.reconcileTextIndexAtStartup();
    } catch (error) {
      console.error("Lina: startup reconciliation failed:", error);
      this.logStartupReconciliation("Startup reconciliation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.startupReconciliationNeeded = false;
      this.startupIgnoredEventCount = 0;
      this.automaticUpdatesReady = true;
      this.startupReconciliationInProgress = false;
      this.logStartupReconciliation("Startup reconciliation completed", {
        ignoredEventCount,
        reconciliationWasNeeded,
      });
      this.logAutomaticUpdateDiagnostic("automatic updates ready", {
        timestamp: new Date().toISOString(),
        pendingUpdates: this.pendingAutomaticUpdates.size,
        startupReconciliationNeeded: reconciliationWasNeeded,
        startupIgnoredEventCount: ignoredEventCount,
      });
      this.schedulePendingAutomaticUpdatesFlush();
    }
  }

  private async reconcileTextIndexAtStartup(): Promise<void> {
    this.logStartupReconciliation("Startup reconciliation started");

    if (!this.settings.autoUpdateIndexOnFileChanges) {
      this.logStartupReconciliation("Startup reconciliation skipped", {
        reason: "automatic-update-disabled",
      });
      return;
    }

    const status = await readTextIndexStatus(this.app);
    if (!status.exists) {
      this.logStartupReconciliation("Startup reconciliation skipped", {
        reason: status.error ?? "text-index-unavailable",
      });
      return;
    }

    const indexedNotes = await readIndexedNotes(this.app);
    if (!indexedNotes) {
      this.logStartupReconciliation("Startup reconciliation skipped", {
        reason: "indexed-notes-unavailable",
      });
      return;
    }

    const excludedFolders = parseMultilineSetting(this.settings.indexExcludedFolders ?? "");
    const excludedPathContains = parseMultilineSetting(this.settings.indexExcludedPathContains ?? "");
    const excludedContentContains = parseContentExclusionTerms(this.settings.indexExcludedContentContains ?? "");
    const exclusions = { excludedFolders, excludedPathContains };
    const vaultFiles = this.app.vault.getMarkdownFiles().filter((file) => {
      return !shouldExcludePath(file.path, exclusions, this.app.vault.configDir).excluded;
    });
    const filesByPath = new Map(vaultFiles.map((file) => [file.path, file]));
    const plan = buildStartupReconciliationPlan(
      vaultFiles.map((file) => ({
        path: file.path,
        size: file.stat.size,
        mtime: file.stat.mtime,
      })),
      indexedNotes
    );

    this.logStartupReconciliation("Startup reconciliation differences calculated", {
      vaultFiles: vaultFiles.length,
      indexedFiles: indexedNotes.length,
      new: plan.newCount,
      modified: plan.modifiedCount,
      deleted: plan.deletedCount,
    });

    if (plan.events.length === 0) {
      this.logStartupReconciliation("No differences detected");
      return;
    }

    const skippedCandidates: SkippedAutomaticIndexCandidate[] = [];
    for (const event of plan.events) {
      const file = event.changeType === "delete" ? undefined : filesByPath.get(event.path);
      if (event.changeType !== "delete" && !file) {
        console.warn("Lina: startup reconciliation skipped a path that is no longer available.", {
          path: event.path,
          changeType: event.changeType,
        });
        continue;
      }

      if (event.changeType === "create" && file && excludedContentContains.length > 0) {
        try {
          const content = await this.app.vault.read(file);
          if (shouldExcludeContent(content, excludedContentContains).excluded) {
            skippedCandidates.push({
              changeType: event.changeType,
              path: event.path,
              reason: "content-excluded",
            });
            this.addDiagnosticEvent({
              eventType: "ignored",
              path: event.path,
              message: "startup candidate excluded by configured content rule"
            });
            continue;
          }
        } catch (readError) {
          skippedCandidates.push({
            changeType: event.changeType,
            path: event.path,
            reason: "content-read-error",
          });
          console.warn("Lina: startup reconciliation skipped a create candidate because content could not be read.", {
            path: event.path,
            error: readError instanceof Error ? readError.message : String(readError),
          });
          this.addDiagnosticEvent({
            eventType: "error",
            path: event.path,
            message: `startup candidate read error: ${readError instanceof Error ? readError.message : String(readError)}`
          });
          continue;
        }
      }

      this.queueAutomaticIndexUpdate({
        ...event,
        file,
        receivedAt: new Date().toISOString(),
      }, "startup reconciliation");
    }

    this.logStartupReconciliation("Startup reconciliation queue prepared", {
      queueSize: this.pendingAutomaticUpdates.size,
      ...summarizeAutomaticUpdates([...this.pendingAutomaticUpdates.values()]),
      ...summarizeSkippedAutomaticIndexCandidates(skippedCandidates),
    });

    if (this.pendingAutomaticUpdates.size === 0) {
      this.logStartupReconciliation("No differences detected");
      return;
    }

    this.logStartupReconciliation("Batch started", {
      batchSize: this.pendingAutomaticUpdates.size,
    });
    await this.processNextAutomaticUpdateBatch();
    this.logStartupReconciliation("Batch completed");
  }

  onTextIndexRebuildProgress(listener: (progress: TextIndexRebuildProgress) => void): () => void {
    this.textIndexRebuildListeners.add(listener);
    listener(this.getTextIndexRebuildProgress());
    return () => this.textIndexRebuildListeners.delete(listener);
  }

  cancelTextIndexRebuild(): void {
    if (this.textIndexRebuildProgress.status !== "running") return;
    this.setTextIndexRebuildProgress({ status: "cancelling" });
  }

  private setTextIndexRebuildProgress(update: Partial<TextIndexRebuildProgress>): void {
    this.textIndexRebuildProgress = { ...this.textIndexRebuildProgress, ...update };
    const snapshot = this.getTextIndexRebuildProgress();
    for (const listener of this.textIndexRebuildListeners) listener(snapshot);
  }

  private async yieldToRenderer(): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  async rebuildTextIndex(): Promise<LinaActionResult> {
    if (this.textIndexRebuildProgress.status === "running" || this.textIndexRebuildProgress.status === "cancelling") {
      return { success: false, message: this.L.mainNoticeTextIndexRebuildAlreadyRunning };
    }

    const coordinatorState = this.getIndexWriteCoordinator().getState();
    if (coordinatorState.disposed) {
      return {
        success: false,
        message: this.L.statusIndexError,
      };
    }
    if (coordinatorState.embeddingGenerationRequested || coordinatorState.activeOperation === "embedding-generation") {
      return {
        success: false,
        message: this.getTextIndexBlockedByEmbeddingGenerationMessage(),
      };
    }

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

    this.setTextIndexRebuildProgress({
      status: "running",
      total: scanResult.included.length,
      processed: 0,
      skipped: scanResult.excludedCount,
      errors: 0,
    });

    while (this.activeAutomaticIndexUpdates > 0) {
      await this.yieldToRenderer();
    }
    if (this.getTextIndexRebuildProgress().status === "cancelling") {
      this.setTextIndexRebuildProgress({ status: "cancelled" });
      return { success: false, message: this.L.mainNoticeTextIndexRebuildCancelled };
    }

    const coordinatorResult = this.getIndexWriteCoordinator().startTextRebuild();
    if (coordinatorResult.status !== "accepted") {
      this.setTextIndexRebuildProgress({ status: "idle", total: 0, processed: 0, skipped: 0, errors: 0 });
      return {
        success: false,
        message: coordinatorResult.status === "disposed"
          ? this.L.statusIndexError
          : this.getTextIndexBlockedByEmbeddingGenerationMessage(),
      };
    }

    const rebuildToken = coordinatorResult.token;

    try {
      const indexedNotes: IndexedNote[] = [];
      const allChunks: TextChunk[] = [];
      const now = new Date().toISOString();
      let contentExcludedCount = 0;

      try {
        for (let offset = 0; offset < scanResult.included.length; offset += TEXT_INDEX_REBUILD_BATCH_SIZE) {
          const batch = scanResult.included.slice(offset, offset + TEXT_INDEX_REBUILD_BATCH_SIZE);
          for (const note of batch) {
            try {
              const file = this.app.vault.getAbstractFileByPath(note.path);
              if (!(file instanceof TFile)) {
                this.setTextIndexRebuildProgress({ skipped: this.textIndexRebuildProgress.skipped + 1 });
                continue;
              }
              const content = await this.app.vault.read(file);
              if (shouldExcludeContent(content, excludedContentContains).excluded) {
                contentExcludedCount++;
                this.setTextIndexRebuildProgress({ skipped: this.textIndexRebuildProgress.skipped + 1 });
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
            } catch (error) {
              this.setTextIndexRebuildProgress({ errors: this.textIndexRebuildProgress.errors + 1 });
              console.warn(`Lina: failed to process chunks for ${note.path}:`, error);
            } finally {
              this.setTextIndexRebuildProgress({ processed: this.textIndexRebuildProgress.processed + 1 });
            }
          }
          if (this.getTextIndexRebuildProgress().status === "cancelling") {
            this.setTextIndexRebuildProgress({ status: "cancelled" });
            return { success: false, message: this.L.mainNoticeTextIndexRebuildCancelled };
          }
          await this.yieldToRenderer();
        }
      } catch (error) {
        this.setTextIndexRebuildProgress({ status: "failed" });
        throw error;
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
        this.setTextIndexRebuildProgress({ status: "failed" });
        return {
          success: false,
          message: "Erro ao guardar índice textual.",
        };
      }

      this.indexedNotes = indexedNotes;
      this.indexedChunks = allChunks;
      this.textIndexLoaded = true;
      this.setTextIndexRebuildProgress({ status: "completed" });

      return {
        success: true,
        message: `Índice textual construído com sucesso. ${indexedNotes.length} notas indexadas, ${allChunks.length} blocos criados, ${totalExcludedCount} notas excluídas.`,
      };
    } finally {
      this.getIndexWriteCoordinator().finish(rebuildToken);
    }
  }

  private getEffectiveEmbeddingApiKey(provider: string): string {
    if (provider === "mistral") {
      return getLocalEmbeddingsApiKey()
        || getLocalAnalysisApiKey()
        || this.settings.embeddingApiKey
        || this.settings.aiApiKey
        || "";
    }

    return getLocalEmbeddingsApiKey() || this.settings.embeddingApiKey || "";
  }

  getEffectiveEmbeddingConfig(): EffectiveEmbeddingConfig {
    const provider = (getLocalEmbeddingsProvider() || this.settings.embeddingProvider || "ollama").toLowerCase();
    const defaults = getEmbeddingProviderDefaults(provider);
    const configuredBaseUrl = getLocalEmbeddingsBaseUrl()
      || this.settings.embeddingBaseUrl
      || this.settings.embeddingLocalBaseUrl
      || (provider === "ollama" ? this.settings.aiBaseUrl : "")
      || defaults.baseUrl;
    const baseUrl = chooseProviderDefaultBaseUrl(configuredBaseUrl, provider)
      || OLLAMA_DEFAULT_BASE_URL;
    const configuredModel = getLocalEmbeddingsModel()
      || this.settings.embeddingModel
      || this.settings.embeddingLocalModel
      || defaults.model;
    const model = chooseProviderDefaultModel(configuredModel, provider, "embedding")
      || "nomic-embed-text";
    const timeoutMs = parseInt(getLocalEmbeddingsTimeout() || String(this.settings.embeddingRequestTimeoutSeconds || 60), 10) * 1000;

    return {
      provider,
      baseUrl,
      model,
      timeoutMs,
      apiKey: this.getEffectiveEmbeddingApiKey(provider),
    };
  }

  private getEmbeddingOperationManager(): EmbeddingOperationManager {
    if (!this.embeddingOperationManager) {
      this.embeddingOperationManager = new EmbeddingOperationManager();
      if (this.embeddingOperationManagerDisposed) {
        this.embeddingOperationManager.dispose();
      }
    }

    return this.embeddingOperationManager;
  }

  private getIndexWriteCoordinator(): IndexWriteCoordinator {
    if (!this.indexWriteCoordinator) {
      this.indexWriteCoordinator = new IndexWriteCoordinator();
      if (this.indexWriteCoordinatorDisposed) {
        this.indexWriteCoordinator.dispose();
      }
    }

    return this.indexWriteCoordinator;
  }

  private getEmbeddingGenerationBlockedByTextIndexMessage(
    result: IndexWriteCoordinatorResult | { status: "text-index-busy" | "disposed" }
  ): string {
    if (result.status === "disposed") {
      return this.L.toastEmbeddingsError;
    }

    return this.L.mainNoticeTextIndexBusyForEmbeddings;
  }

  private getTextIndexBlockedByEmbeddingGenerationMessage(): string {
    return this.L.mainNoticeEmbeddingsBusyForTextIndex;
  }

  private async drainAutomaticUpdatesBeforeEmbeddingGeneration(): Promise<void> {
    while (true) {
      if (this.automaticUpdatePromise) {
        await this.automaticUpdatePromise;
        continue;
      }

      if (this.pendingAutomaticUpdates.size === 0) {
        return;
      }

      const updates = [...this.pendingAutomaticUpdates.values()];
      this.pendingAutomaticUpdates.clear();
      await this.processAutomaticIndexUpdateBatch(updates, { allowEmbeddingReservation: true });
    }
  }

  private async runGenerateLocalEmbeddings(onProgress?: (message: string) => void): Promise<LinaActionResult> {
    const chunks = await readIndexedChunks(this.app);
    const safeChunks = chunks ? this.filterChunksByUserContentRules(chunks) : null;
    if (!safeChunks || safeChunks.length === 0) {
      return {
        success: false,
        message: "Índice textual vazio ou inexistente. Reconstrói o índice primeiro.",
      };
    }

    const embeddingConfig = this.getEffectiveEmbeddingConfig();

    if (!embeddingConfig.baseUrl) {
      return {
        success: false,
        message: "URL de embeddings não configurada. Define nas definições do plugin.",
      };
    }

    // Bloquear antes de iniciar se o provider for Mistral e faltar API key
    if (embeddingConfig.provider === "mistral" && !embeddingConfig.apiKey.trim()) {
      return {
        success: false,
        message: "Configure a chave API da Mistral antes de gerar embeddings Mistral.",
      };
    }

    const providerLabel = embeddingConfig.provider === "mistral" ? "Mistral" : "Ollama";
    const progressBase = `A gerar embeddings com ${providerLabel}`;

    const result = await generateEmbeddingsForChunks(this.app, safeChunks, {
      baseUrl: embeddingConfig.baseUrl,
      model: embeddingConfig.model,
      provider: embeddingConfig.provider,
      apiKey: embeddingConfig.apiKey,
      timeoutMs: embeddingConfig.timeoutMs,
      incremental: this.settings.generateOnlyMissingEmbeddings ?? this.settings.autoGenerateEmbeddingsOnlyWhenNeeded ?? true,
      shouldExcludeContent: (content) => this.isContentExcludedByUserRules(content),
      onProgress: (progress) => {
        if (onProgress) {
          onProgress(`${progressBase}... ${progress.current}/${progress.total}`);
        }
      },
    });

    if (!(result.success && result.total > 0)) {
      const providerHint = embeddingConfig.provider === "mistral"
        ? `Não foi possível gerar embeddings com Mistral. Verifica o modelo (${embeddingConfig.model}), URL base (${embeddingConfig.baseUrl}) e chave API.`
        : `Não foi possível gerar embeddings com Ollama. Verifica o modelo (${embeddingConfig.model}), URL base (${embeddingConfig.baseUrl}) e se o Ollama está ativo.`;
      return {
        success: false,
        message: providerHint,
      };
    }

    const manifestOk = await updateManifestWithEmbeddings(
      this.app,
      result.total,
      result.dimensions,
      embeddingConfig.model,
      embeddingConfig.provider
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
        ? `Embeddings gerados com sucesso. ${result.generated} novos, ${result.kept} mantidos.`
        : `Embeddings atualizados com sucesso. ${result.kept} embeddings válidos mantidos.`,
    };
  }

  private registerVaultEventListeners(): void {
    this.cleanupVaultEventListeners();
    this.modifyDebouncer?.cancelAll();
    this.modifyDebouncer = undefined;
    this.indexDiagnostic.pendingDebounces.clear();

    if (!this.settings.autoUpdateIndexOnFileChanges) {
      this.addDiagnosticEvent({
        eventType: "ignored",
        path: "plugin",
        message: "automatic update disabled, listeners not registered"
      });
      return;
    }

    const createListener = this.app.vault.on("create", (file) => {
      this.handleVaultEvent("create", file);
    });

    const modifyListener = this.app.vault.on("modify", (file) => {
      this.handleVaultEvent("modify", file);
    });

    const deleteListener = this.app.vault.on("delete", (file) => {
      this.handleVaultEvent("delete", file);
    });

    const renameListener = this.app.vault.on("rename", (file, oldPath: string) => {
      this.handleVaultEvent("rename", file, oldPath);
    });

    this.vaultEventListeners.push(
      () => this.app.vault.offref(createListener),
      () => this.app.vault.offref(modifyListener),
      () => this.app.vault.offref(deleteListener),
      () => this.app.vault.offref(renameListener)
    );

    this.modifyDebouncer = createPathScopedDebouncer((file: TFile) => {
      void this.handleDebouncedModify(file);
    }, 2000, {
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });

    this.addDiagnosticEvent({
      eventType: "index",
      path: "plugin",
      message: "listeners do vault registados"
    });
  }

  private cleanupVaultEventListeners(): void {
    for (const unregister of this.vaultEventListeners) {
      try {
        unregister();
      } catch (error) {
        console.warn("Lina: failed to remove vault listener:", error);
      }
    }
    this.vaultEventListeners = [];
  }

  private getAutomaticUpdateIgnoreReason(path: string, oldPath?: string): string | null {
    const pathReason = getInternalAutomaticUpdateIgnoreReason(path, {
      configDir: this.app.vault.configDir,
      pluginId: this.manifest.id,
    });
    if (pathReason) {
      return pathReason;
    }

    if (oldPath) {
      const oldPathReason = getInternalAutomaticUpdateIgnoreReason(oldPath, {
        configDir: this.app.vault.configDir,
        pluginId: this.manifest.id,
      });
      if (oldPathReason) {
        return `old-${oldPathReason}`;
      }
    }

    return null;
  }

  private logVaultEventDiagnostic(
    eventType: AutomaticUpdateChangeType,
    path?: string,
    oldPath?: string,
    ignoredReason?: string
  ): void {
    this.logAutomaticUpdateDiagnostic("vault event", {
      eventType,
      path,
      oldPath,
      ignoredReason,
      automaticUpdatesReady: this.automaticUpdatesReady,
      updateInProgress: this.automaticUpdateInProgress,
      pendingUpdates: this.pendingAutomaticUpdates.size,
      activeAutomaticIndexUpdates: this.activeAutomaticIndexUpdates,
      timestamp: new Date().toISOString(),
    });
  }

  private logAutomaticUpdateDiagnostic(message: string, details: Record<string, unknown>): void {
    if (!this.settings?.debugIndexUpdates) {
      return;
    }

    console.debug("[Lina automatic index diagnostic]", {
      message,
      ...details,
    });
  }

  private handleVaultEvent(
    changeType: AutomaticUpdateChangeType,
    file: unknown,
    oldPathInput?: unknown
  ): void {
    const path = getVaultEventPath(file);
    const oldPath = getVaultRenameOldPath(oldPathInput);

    if (!path) {
      this.logVaultEventDiagnostic(changeType, undefined, oldPath, "missing-path");
      return;
    }

    const ignoredReason = this.getAutomaticUpdateIgnoreReason(path, oldPath);
    if (ignoredReason) {
      this.logVaultEventDiagnostic(changeType, path, oldPath, ignoredReason);
      return;
    }

    if (!isMarkdownPath(path)) {
      this.logVaultEventDiagnostic(changeType, path, oldPath, "not-markdown");
      return;
    }

    if (!(file instanceof TFile)) {
      this.logVaultEventDiagnostic(changeType, path, oldPath, "not-tfile");
      return;
    }

    this.handleVaultFileChange(changeType, file, path, oldPath);
  }

  private handleVaultFileChange(
    changeType: AutomaticUpdateChangeType,
    file: TFile,
    path: string,
    oldPath?: string
  ): void {
    this.addDiagnosticEvent({
      eventType: changeType,
      path,
      message: "event received"
    });

    if (!this.settings.autoUpdateIndexOnFileChanges) {
      this.addDiagnosticEvent({
        eventType: "ignored",
        path,
        message: "automatic update disabled"
      });
      return;
    }

    const excludedFoldersSetting = this.settings.indexExcludedFolders ?? "";
    const excludedPathContainsSetting = this.settings.indexExcludedPathContains ?? "";
    const excludedFolders = parseMultilineSetting(excludedFoldersSetting);
    const excludedPathContains = parseMultilineSetting(excludedPathContainsSetting);
    const exclusions = { excludedFolders, excludedPathContains };

    if (shouldExcludePath(path, exclusions, this.app.vault.configDir).excluded) {
      this.addDiagnosticEvent({
        eventType: "ignored",
        path,
        message: "excluded by configured path rules"
      });
      return;
    }

    if (changeType === "modify") {
      this.indexDiagnostic.pendingDebounces.add(path);
      this.addDiagnosticEvent({
        eventType: "debounce",
        path,
        message: "debounce scheduled"
      });
      this.modifyDebouncer?.schedule(path, file);
      return;
    }

    this.queueOrRunAutomaticIndexUpdate(changeType, file, path, oldPath);
  }

  private async handleDebouncedModify(file: TFile): Promise<void> {
    const path = getVaultEventPath(file);
    if (!path) {
      this.logVaultEventDiagnostic("modify", undefined, undefined, "missing-path");
      return;
    }

    this.indexDiagnostic.pendingDebounces.delete(path);
    this.addDiagnosticEvent({
      eventType: "debounce",
      path,
      message: "debounce executed"
    });
    this.queueOrRunAutomaticIndexUpdate("modify", file, path);
  }

  private queueOrRunAutomaticIndexUpdate(
    changeType: AutomaticUpdateChangeType,
    file: TFile,
    path: string,
    oldPath?: string
  ): void {
    const update: PendingAutomaticIndexUpdate = {
      changeType,
      file,
      path,
      oldPath,
      receivedAt: new Date().toISOString(),
    };

    if (!this.automaticUpdatesReady) {
      if (this.startupReconciliationInProgress) {
        this.queueAutomaticIndexUpdate(update, "startup reconciliation in progress");
        return;
      }
      this.startupReconciliationNeeded = true;
      this.startupIgnoredEventCount++;
      this.logVaultEventDiagnostic(changeType, path, oldPath, "startup-compacted");
      return;
    }

    this.queueAutomaticIndexUpdate(update, this.automaticUpdateInProgress ? "update in progress" : "ready");
  }

  private queueAutomaticIndexUpdate(update: PendingAutomaticIndexUpdate, reason: string): void {
    coalesceAutomaticUpdateEvent(this.pendingAutomaticUpdates, update);
    this.addDiagnosticEvent({
      eventType: "index",
      path: update.path,
      message: `automatic update queued: ${reason}`
    });
    this.logVaultEventDiagnostic(update.changeType, update.path, update.oldPath, reason);

    this.schedulePendingAutomaticUpdatesFlush();
  }

  private schedulePendingAutomaticUpdatesFlush(): void {
    if (!this.automaticUpdatesReady || this.pendingAutomaticUpdates.size === 0) {
      return;
    }

    const coordinatorState = this.getIndexWriteCoordinator().getState();
    if (coordinatorState.embeddingGenerationRequested || coordinatorState.activeOperation === "embedding-generation") {
      this.automaticUpdatePending = true;
      return;
    }

    if (this.automaticUpdatePromise) {
      this.automaticUpdatePending = true;
      return;
    }

    if (this.pendingAutomaticUpdatesFlushTimer !== null) {
      return;
    }

    this.pendingAutomaticUpdatesFlushTimer = window.setTimeout(() => {
      this.pendingAutomaticUpdatesFlushTimer = null;
      void this.flushPendingAutomaticUpdates();
    }, AUTOMATIC_UPDATE_PENDING_FLUSH_MS);
  }

  private async flushPendingAutomaticUpdates(): Promise<void> {
    if (!this.automaticUpdatesReady || this.pendingAutomaticUpdates.size === 0) {
      return;
    }

    const coordinatorState = this.getIndexWriteCoordinator().getState();
    if (coordinatorState.embeddingGenerationRequested || coordinatorState.activeOperation === "embedding-generation") {
      this.automaticUpdatePending = true;
      return;
    }

    if (this.automaticUpdatePromise) {
      this.automaticUpdatePending = true;
      return;
    }

    this.automaticUpdatePromise = this.processNextAutomaticUpdateBatch();
    try {
      await this.automaticUpdatePromise;
    } finally {
      this.automaticUpdatePromise = null;
      if (this.automaticUpdatePending || this.pendingAutomaticUpdates.size > 0) {
        this.automaticUpdatePending = false;
        this.schedulePendingAutomaticUpdatesFlush();
      }
    }
  }

  private async processNextAutomaticUpdateBatch(): Promise<void> {
    const updates = [...this.pendingAutomaticUpdates.values()];
    if (updates.length === 0) {
      return;
    }

    if (this.textIndexRebuildProgress.status === "running" || this.textIndexRebuildProgress.status === "cancelling") {
      this.automaticUpdatePending = true;
      return;
    }

    const batchReservation = this.getIndexWriteCoordinator().startAutomaticBatch();
    if (batchReservation.status !== "accepted") {
      this.automaticUpdatePending = true;
      return;
    }

    this.pendingAutomaticUpdates.clear();
    await this.processAutomaticIndexUpdateBatch(updates, {}, batchReservation.token);
  }

  private requeueAutomaticIndexUpdates(updates: PendingAutomaticIndexUpdate[]): void {
    for (const update of updates) {
      coalesceAutomaticUpdateEvent(this.pendingAutomaticUpdates, update);
    }
    if (updates.length > 0) {
      this.automaticUpdatePending = true;
    }
  }

  private async processAutomaticIndexUpdateBatch(
    updates: PendingAutomaticIndexUpdate[],
    options: AutomaticBatchProcessingOptions = {},
    reservedBatchToken?: IndexWriteCoordinatorToken
  ): Promise<void> {
    let automaticUpdateRegistered = false;
    let batchToken = reservedBatchToken;
    try {
      if (updates.length === 0) {
        return;
      }
      if (this.textIndexRebuildProgress.status === "running" || this.textIndexRebuildProgress.status === "cancelling") {
        this.requeueAutomaticIndexUpdates(updates);
        return;
      }

      if (!batchToken) {
        const batchReservation = this.getIndexWriteCoordinator().startAutomaticBatch({
          allowEmbeddingReservation: options.allowEmbeddingReservation,
        });
        if (batchReservation.status !== "accepted") {
          this.requeueAutomaticIndexUpdates(updates);
          return;
        }
        batchToken = batchReservation.token;
      }

      this.automaticUpdateInProgress = true;
      this.activeAutomaticIndexUpdates++;
      automaticUpdateRegistered = true;
      this.logAutomaticUpdateDiagnostic("automatic batch started", {
        batchSize: updates.length,
        ...summarizeAutomaticUpdates(updates),
        updateInProgress: this.automaticUpdateInProgress,
        pendingUpdates: this.pendingAutomaticUpdates.size,
        timestamp: new Date().toISOString(),
      });

      const status = await readTextIndexStatus(this.app);
      if (!status.exists) {
        this.logAutomaticUpdateDiagnostic("automatic batch skipped because index is not ready", {
          reason: status.error ?? "index-unavailable",
          batchSize: updates.length,
          pendingUpdates: this.pendingAutomaticUpdates.size,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const loaded = await this.ensureTextIndexLoaded("automatic-update");
      if (!loaded) {
        this.logAutomaticUpdateDiagnostic("automatic batch skipped because index could not be loaded", {
          batchSize: updates.length,
          pendingUpdates: this.pendingAutomaticUpdates.size,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      let updatedNotes = [...this.indexedNotes];
      let updatedChunks = [...this.indexedChunks];
      let hasIndexChanges = false;
      const skippedCandidates: SkippedAutomaticIndexCandidate[] = [];

      for (const update of updates) {
        const { changeType, file, path, oldPath } = update;
        let fileContent = "";

        if (changeType !== "delete") {
          if (!file) {
            console.warn("Lina: automatic index update skipped because the file is unavailable.", {
              path,
              changeType,
            });
            continue;
          }
          try {
            fileContent = await this.app.vault.read(file);
          } catch (readError) {
            console.warn(`Lina: could not read file content for automatic index update: ${path}`, readError);
            skippedCandidates.push({
              changeType,
              path,
              reason: "content-read-error",
            });
            this.addDiagnosticEvent({
              eventType: "error",
              path,
              message: `content read error: ${readError instanceof Error ? readError.message : String(readError)}`
            });
            continue;
          }
        }

        if (changeType !== "delete" && this.isContentExcludedByUserRules(fileContent)) {
          const pathsToRemove = new Set([path, oldPath].filter((item): item is string => !!item));
          const previousNotesLength = updatedNotes.length;
          const previousChunksLength = updatedChunks.length;
          updatedNotes = updatedNotes.filter(n => !pathsToRemove.has(n.path));
          updatedChunks = updatedChunks.filter(c => !pathsToRemove.has(c.path));
          hasIndexChanges = hasIndexChanges || previousNotesLength !== updatedNotes.length || previousChunksLength !== updatedChunks.length;
          this.addDiagnosticEvent({
            eventType: "ignored",
            path,
            message: "content excluded by configured rule"
          });
          skippedCandidates.push({
            changeType,
            path,
            reason: pathsToRemove.size > 0 && (previousNotesLength !== updatedNotes.length || previousChunksLength !== updatedChunks.length)
              ? "content-excluded-removed-existing-index-entry"
              : "content-excluded-no-existing-index-entry",
          });
          continue;
        }

        switch (changeType) {
          case "create":
          case "modify": {
            if (!file) {
              continue;
            }
            const noteIndex = updatedNotes.findIndex(n => n.path === path);
            const noteChunks = updatedChunks.filter(c => c.path === path);

            if (changeType === "modify" && noteIndex >= 0) {
              const oldContentHash = updatedNotes[noteIndex].contentHash;
              const newContentHash = hashContent(fileContent);
              if (oldContentHash === newContentHash) {
                skippedCandidates.push({
                  changeType,
                  path,
                  reason: "content-unchanged",
                });
                this.addDiagnosticEvent({
                  eventType: "ignored",
                  path,
                  message: "content unchanged"
                });
                continue;
              }
            }

            if (noteChunks.length > 0) {
              updatedChunks = updatedChunks.filter(c => c.path !== path);
            }

            const newNote = {
              path,
              basename: file.basename,
              extension: file.extension,
              size: file.stat.size,
              mtime: file.stat.mtime,
              contentHash: hashContent(fileContent),
              indexedAt: new Date().toISOString(),
            };

            if (noteIndex >= 0) {
              updatedNotes[noteIndex] = newNote;
            } else {
              updatedNotes.push(newNote);
            }

            const newChunks = chunkText(path, fileContent, { chunkSize: 1200, overlap: 150 });
            updatedChunks.push(...newChunks);
            hasIndexChanges = true;
            break;
          }
          case "delete": {
            const deletePath = oldPath ?? path;
            const previousNotesLength = updatedNotes.length;
            const previousChunksLength = updatedChunks.length;
            updatedNotes = updatedNotes.filter(n => n.path !== deletePath);
            updatedChunks = updatedChunks.filter(c => c.path !== deletePath);
            hasIndexChanges = hasIndexChanges || previousNotesLength !== updatedNotes.length || previousChunksLength !== updatedChunks.length;
            break;
          }
          case "rename": {
            if (oldPath && file) {
              const hadOldPath = updatedNotes.some(n => n.path === oldPath) || updatedChunks.some(c => c.path === oldPath);
              updatedNotes = updatedNotes.map(n =>
                n.path === oldPath ? { ...n, path, basename: file.basename } : n
              );
              updatedChunks = updatedChunks.map(c =>
                c.path === oldPath ? { ...c, path, chunkId: `${path}::${c.chunkIndex}` } : c
              );
              hasIndexChanges = hasIndexChanges || hadOldPath;
            }
            break;
          }
        }
      }

      if (!hasIndexChanges) {
        this.addDiagnosticEvent({
          eventType: "ignored",
          path: updates[0].path,
          message: "automatic batch had no index changes"
        });
        this.logAutomaticUpdateDiagnostic("automatic batch completed without changes", {
          batchSize: updates.length,
          ...summarizeAutomaticUpdates(updates),
          ...summarizeSkippedAutomaticIndexCandidates(skippedCandidates),
          pendingUpdates: this.pendingAutomaticUpdates.size,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const excludedFolders = parseMultilineSetting(this.settings.indexExcludedFolders ?? "");
      const excludedPathContains = parseMultilineSetting(this.settings.indexExcludedPathContains ?? "");
      const excludedContentContains = parseContentExclusionTerms(this.settings.indexExcludedContentContains ?? "");

      const success = await persistAndActivateTextIndexCandidate(
        () => saveTextIndex(
          this.app,
          updatedNotes,
          updatedChunks,
          { enabled: true, chunkSize: 1200, overlap: 150 },
          status.excludedNotes ?? 0,
          {
            enabled: true,
            alwaysExcludedFolders: getAlwaysExcludedFolders(this.app.vault.configDir),
            excludedFoldersCount: excludedFolders.length,
            excludedPathContainsCount: excludedPathContains.length,
            excludedContentContainsCount: excludedContentContains.length,
          }
        ),
        () => {
          this.indexedNotes = updatedNotes;
          this.indexedChunks = updatedChunks;
          this.textIndexLoaded = true;
        }
      );

      if (success) {
        this.indexDiagnostic.totalNotes = updatedNotes.length;
        this.indexDiagnostic.totalChunks = updatedChunks.length;
        this.indexDiagnostic.lastResult = "incremental index saved";
        this.indexDiagnostic.lastUpdatedAt = new Date().toISOString();
        this.logAutomaticUpdateDiagnostic("automatic batch completed", {
          batchSize: updates.length,
          totalNotes: updatedNotes.length,
          totalChunks: updatedChunks.length,
          pendingUpdates: this.pendingAutomaticUpdates.size,
          timestamp: new Date().toISOString(),
        });
        this.addDiagnosticEvent({
          eventType: "index",
          path: updates[0].path,
          message: `index updated after automatic batch with ${updates.length} event(s)`
        });
      } else {
        console.error(`Lina: failed to update index after automatic batch with ${updates.length} event(s).`);
        this.indexDiagnostic.lastResult = "erro no save";
        this.addDiagnosticEvent({
          eventType: "error",
          path: updates[0].path,
          message: "failed to update index after automatic batch"
        });
      }
    } catch (error) {
      console.error("Lina: failed to process automatic index batch:", error);
      this.addDiagnosticEvent({
        eventType: "error",
        path: updates[0]?.path ?? "batch",
        message: `index update error: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      this.getIndexWriteCoordinator().finish(batchToken);
      if (automaticUpdateRegistered) {
        this.activeAutomaticIndexUpdates = Math.max(0, this.activeAutomaticIndexUpdates - 1);
      }
      this.automaticUpdateInProgress = false;
    }
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

     this.settings = Object.assign(
       {},
       DEFAULT_SETTINGS,
       data?.settings ?? {}
     );

     if (data?.settings) {
       const userFieldsToPreserve: Array<keyof LinaSettings> = [
         'aiProvider', 'aiBaseUrl', 'aiAnalysisModel', 'aiRequestTimeoutSeconds',
         'aiOutputLanguage', 'aiProfiles', 'embeddingsEnabled', 'embeddingProvider',
         'embeddingBaseUrl', 'embeddingModel', 'embeddingBatchSize', 'embeddingRequestTimeoutSeconds',
         'generateEmbeddingsOnStartup', 'generateOnlyMissingEmbeddings', 'yamlSuggestionsEnabled',
         'yamlAllowedProperties', 'yamlIncludeTags', 'maxSuggestedTags', 'inboxFolderPath',
         'maxInboxNotesToAnalyze', 'folderAnalysisMaxNotes', 'folderAnalysisIncludeSubfolders',
         'lastAnalyzedFolderPath', 'checkSyncOnStartup', 'updateIndexOnStartup',
         'indexExcludedContentContains', 'autoUpdateIndexOnFileChanges', 'debugIndexUpdates',
         'deviceSettingsById'
       ];

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
    console.warn("Lina: automatic embedding generation at startup was skipped to keep startup lightweight.");
  }

  private async runStartupIndexAutomation(): Promise<void> {
    if (this.settings.updateIndexOnStartup) {
      const result = await updateIndexIncrementally(this.app.vault, this.indexData, {
        shouldExcludeContent: (content) => this.isContentExcludedByUserRules(content),
      });
      const hadPreviousIndex = !!this.indexData && this.indexData.entries.length > 0;
      const hasChanges = result.addedCount > 0 || result.updatedCount > 0 || result.removedCount > 0;
      this.indexData = result.indexData;
      if (!hadPreviousIndex) {
        await this.saveDataToDisk();
        new Notice(`Lina criou o índice com ${result.indexData.entries.length} notas.`);
        return;
      }
      if (hasChanges) {
        await this.saveDataToDisk();
        new Notice(`Lina atualizou o índice: ${result.addedCount} novas, ${result.updatedCount} alteradas, ${result.removedCount} removidas.`);
      }
      return;
    }
    if (!this.settings.checkSyncOnStartup) return;
    if (!this.indexData || this.indexData.entries.length === 0) {
      new Notice("Lina: índice ainda não criado.");
      return;
    }
    const syncStatus = getIndexSyncStatus(this.app.vault, this.indexData);
    const hasChanges = syncStatus.newNotes.length > 0 || syncStatus.changedNotes.length > 0 || syncStatus.removedNotes.length > 0;
    if (hasChanges) {
      new Notice(`Lina: índice desatualizado. ${syncStatus.newNotes.length} novas, ${syncStatus.changedNotes.length} alteradas, ${syncStatus.removedNotes.length} removidas.`);
    }
  }

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
    if (!this.settings.debugIndexUpdates) return;
    if (this.indexDiagnostic.recentEvents.length >= 50) {
      this.indexDiagnostic.recentEvents.shift();
    }
    this.indexDiagnostic.recentEvents.push({
      timestamp: new Date().toLocaleTimeString(),
      ...event
    });
    this.indexDiagnostic.lastEvent = event.eventType;
    this.indexDiagnostic.lastEventPath = event.path;
    this.indexDiagnostic.lastAction = event.message;
    if (event.eventType === "error") {
      this.indexDiagnostic.lastError = event.message;
    }
  }

  public updateVaultEventListeners() {
    this.registerVaultEventListeners();
    this.addDiagnosticEvent({
      eventType: "index",
      path: "settings",
      message: this.settings.autoUpdateIndexOnFileChanges ? "listeners registados" : "listeners removidos"
    });
  }
}
