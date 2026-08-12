import { App, Modal, Notice, Platform, TFile, normalizePath } from "obsidian";
import {
  filterSearchableEmbeddingRecords,
  generateSingleEmbedding,
  getNextGenerationEmbeddingIdentity,
  readEmbeddingStatus,
  getPrefixModeForModel,
  applyEmbeddingPrefix,
} from "../index/embeddingGenerator";
import { readIndexedChunks } from "../index/indexStore";
import { EmbeddingRecord } from "../index/embeddingGenerator";
import { searchRuntimeSemanticIndex, searchSemanticIndexWithDiagnostics, SemanticSearchResult, SemanticSearchResults } from "./semanticSearch";
import LinaPlugin from "../../main";
import {
  getLocalEmbeddingsProvider,
  getLocalEmbeddingsModel,
  InterfaceLanguage,
  normalizeSupportedProvider,
} from "../settings";
import { parseMultilineSetting, shouldExcludeContent } from "../index/indexExclusions";
import { getStrings, UiStrings } from "../i18n/strings";
import { evaluateEmbeddingBridgeRead } from "../index/embeddingResourceGuard";

interface EmbeddingConfig {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey: string;
}

/**
 * Carrega embeddings.jsonl para um array de EmbeddingRecord.
 */
async function loadEmbeddings(app: App): Promise<EmbeddingRecord[] | null> {
  try {
    const adapter = app.vault.adapter;
    const path = normalizePath(".lina/index/embeddings.jsonl");
    const stat = await adapter.stat(path);
    if (!stat || stat.type !== "file") {
      return null;
    }
    if (!evaluateEmbeddingBridgeRead(stat.size, typeof Platform !== "undefined" && Platform.isMobile ? "mobile" : "desktop").allowed) {
      return null;
    }
    const content = await adapter.read(path);
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    const records: EmbeddingRecord[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as EmbeddingRecord);
      } catch {
        // ignorar linhas mal formatadas
      }
    }
    return records;
  } catch {
    return null;
  }
}

export class SemanticSearchModal extends Modal {
  private queryInput!: HTMLInputElement;
  private resultsContainer!: HTMLDivElement;
  private searchButton!: HTMLButtonElement;
  private diagnosticContainer!: HTMLDivElement;
  private config: EmbeddingConfig;
  private plugin?: LinaPlugin;

  constructor(app: App, config: EmbeddingConfig, plugin?: LinaPlugin) {
    super(app);
    this.config = config;
    this.plugin = plugin;
    this.setTitle(this.L.semanticModalTitle);
  }

  /** Obtém o objeto de strings traduzidas para o idioma atual, com fallback pt-PT. */
  private get L(): UiStrings {
    const lang: InterfaceLanguage = this.plugin?.settings.interfaceLanguage ?? "pt-PT";
    return getStrings(lang);
  }

  onOpen() {
    const { contentEl } = this;

    this.queryInput = contentEl.createEl("input", {
      type: "text",
      placeholder: this.L.semanticModalPlaceholder,
    });
    this.queryInput.addClass("lina-w-full");
    this.queryInput.addClass("lina-mb-8");
    this.queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        void this.doSearch();
      }
    });

    this.searchButton = contentEl.createEl("button", { text: this.L.searchButton });
    this.searchButton.addEventListener("click", () => void this.doSearch());

    this.resultsContainer = contentEl.createDiv("lina-semanticsearch-results");
    this.resultsContainer.addClass("lina-mt-12");

    // Container para informações de diagnóstico
    this.diagnosticContainer = contentEl.createDiv("lina-diagnostic");
    this.diagnosticContainer.addClass("lina-mt-16");
    this.diagnosticContainer.addClass("lina-hidden"); // Oculto por padrão

    window.setTimeout(() => this.queryInput.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async doSearch() {
    const query = this.queryInput.value.trim();
    this.resultsContainer.empty();
    this.diagnosticContainer.empty();
    this.diagnosticContainer.addClass("lina-hidden");

    if (!query) {
      return;
    }

    // 1. Validar compatibilidade dos embeddings usando o estado do manifesto
    const statusEl = this.resultsContainer.createEl("p", { text: this.L.semanticStatusLoadingEmbeddingState });

    const settingsProvider = normalizeSupportedProvider(getLocalEmbeddingsProvider() || this.config.provider || this.plugin?.settings.embeddingProvider);
    const settingsModel = getLocalEmbeddingsModel() || this.config.model || this.plugin?.settings.embeddingModel || "nomic-embed-text";
    const nextIdentity = getNextGenerationEmbeddingIdentity(settingsProvider, settingsModel);
    const runtimeChunks = await readIndexedChunks(this.app);
    if (this.plugin && runtimeChunks) {
      const runtimeIndex = await this.plugin.getRuntimeEmbeddingIndex(runtimeChunks);
      if (!runtimeIndex) {
        statusEl.textContent = this.L.semanticEmbeddingsUnavailableGenerate;
        return;
      }
      if (
        runtimeIndex.provider.toLowerCase() !== settingsProvider
        || runtimeIndex.model !== settingsModel
        || runtimeIndex.sourceIdentity.inputVersion !== nextIdentity.inputVersion
        || runtimeIndex.sourceIdentity.prefixMode !== nextIdentity.prefixMode
      ) {
        statusEl.textContent = this.L.semanticPrefixMismatch;
        return;
      }
      const excludedContentContains = parseMultilineSetting(this.plugin.settings.indexExcludedContentContains ?? "");
      const safeChunks = excludedContentContains.length > 0
        ? runtimeChunks.filter((chunk) => !shouldExcludeContent(chunk.text, excludedContentContains).excluded)
        : runtimeChunks;
      const queryResult = await generateSingleEmbedding(
        this.config.baseUrl,
        this.config.model,
        applyEmbeddingPrefix(query, getPrefixModeForModel(this.config.model), true),
        this.config.timeoutMs,
        settingsProvider,
        this.config.apiKey
      );
      if (!queryResult.embedding || queryResult.embedding.length !== runtimeIndex.dimensions) {
        statusEl.textContent = `${this.L.semanticEmbeddingError}.`;
        return;
      }
      const results = searchRuntimeSemanticIndex(queryResult.embedding, runtimeIndex, safeChunks);
      statusEl.remove();
      if (results.length === 0) this.resultsContainer.createEl("p", { text: this.L.searchNoResults });
      else for (const result of results) this.renderResult(result);
      return;
    }
    const embeddingStatus = await readEmbeddingStatus(this.app, { nextGenerationIdentity: nextIdentity });
    if (!embeddingStatus || !embeddingStatus.exists || embeddingStatus.validForSearchCount === 0) {
      statusEl.textContent = this.L.semanticEmbeddingsUnavailableGenerate;
      return;
    }

    const indexProvider = (embeddingStatus.provider || "").toLowerCase();
    const indexModel = embeddingStatus.model || "";

    // Validar provider
    if (indexProvider && indexProvider !== settingsProvider) {
      statusEl.textContent = `${this.L.semanticProviderMismatch} «${embeddingStatus.provider}», ${this.L.semanticConfiguredFor} «${settingsProvider}». ${this.L.semanticUpdateBeforeUse}`;
      return;
    }

    // Validar modelo
    if (indexModel && indexModel !== settingsModel) {
      statusEl.textContent = `${this.L.semanticModelMismatch} «${indexModel}», ${this.L.semanticConfiguredFor} «${settingsModel}». ${this.L.semanticUpdateBeforeUse}`;
      return;
    }

    // Validar modo de prefixo
    if (
      embeddingStatus.publishedIdentity.inputVersion !== nextIdentity.inputVersion
      || embeddingStatus.publishedIdentity.prefixMode !== nextIdentity.prefixMode
    ) {
      statusEl.textContent = this.L.semanticPrefixMismatch;
      return;
    }

    // 2. Carregar embeddings
    statusEl.textContent = this.L.semanticLoadingEmbeddings;

    const embeddings = await loadEmbeddings(this.app);
    const searchableEmbeddings = embeddings
      ? filterSearchableEmbeddingRecords(embeddings, embeddingStatus)
      : [];
    if (searchableEmbeddings.length === 0) {
      statusEl.textContent = this.L.semanticEmbeddingsMissingGenerate;
      return;
    }

    const chunks = await readIndexedChunks(this.app);
    const excludedContentContains = this.plugin
      ? parseMultilineSetting(this.plugin.settings.indexExcludedContentContains ?? "")
      : [];
    const safeChunks = chunks && excludedContentContains.length > 0
      ? chunks.filter((chunk) => !shouldExcludeContent(chunk.text, excludedContentContains).excluded)
      : chunks;
    if (!safeChunks || safeChunks.length === 0) {
      statusEl.textContent = this.L.semanticNoChunks;
      return;
    }

    // Validar consistência da dimensão no primeiro embedding carregado
    const expectedDimension = embeddingStatus.dimensions || 0;
    if (expectedDimension > 0 && searchableEmbeddings[0]?.dimensions !== expectedDimension) {
      statusEl.textContent = this.L.semanticDimensionMismatch;
      return;
    }

    // 3. Gerar embedding da query
    statusEl.textContent = this.L.semanticGeneratingQuery;

    // Aplicar prefixo à query se o modelo suportar
    const prefixMode = getPrefixModeForModel(this.config.model);
    const prefixedQuery = applyEmbeddingPrefix(query, prefixMode, true);

    const queryResult = await generateSingleEmbedding(
      this.config.baseUrl,
      this.config.model,
      prefixedQuery,
      this.config.timeoutMs,
      settingsProvider,
      this.config.apiKey
    );

    if (!queryResult.embedding) {
      statusEl.textContent = `${this.L.semanticEmbeddingError}.`;
      return;
    }

    // Validar dimensão
    const expectedDim = expectedDimension;
    if (queryResult.embedding.length !== expectedDim) {
      statusEl.textContent = `${this.L.semanticQueryDimensionMismatch} (${queryResult.embedding.length}/${expectedDim})`;
      return;
    }

    // 4. Pesquisar
    statusEl.textContent = this.L.semanticComparing;

    // Usar função de diagnóstico para obter resultados brutos e finais
    const queryEmbedding = queryResult.embedding;
    const diagnosticResults = searchSemanticIndexWithDiagnostics(queryEmbedding, searchableEmbeddings, safeChunks);
    const results = diagnosticResults.finalResults;

    statusEl.remove();

    if (results.length === 0) {
      this.resultsContainer.createEl("p", { text: this.L.searchNoResults });
    } else {
      for (const result of results) {
        this.renderResult(result);
      }
    }

    // Mostrar informações de diagnóstico se o modo de diagnóstico estiver ativo
    if (this.plugin?.settings.debugIndexUpdates) {
      this.showDiagnosticInformationWithRawResults(query, queryEmbedding, diagnosticResults);
    }
  }

  private renderResult(result: SemanticSearchResult) {
    const card = this.resultsContainer.createDiv("lina-semanticsearch-card");
    card.addClass("lina-mb-8");
    card.addClass("lina-p-8");
    card.addClass("lina-border");
    card.addClass("lina-radius-4");
    card.addClass("lina-cursor-pointer");

    // Header com nome e metadados - NOVO FORMATO: (NN%) Título
    const header = card.createDiv();
    header.addClass("lina-mb-4");
    header.addClass("lina-display-flex");
    header.addClass("lina-items-center");
    header.addClass("lina-gap-8");

    const simPct = Math.round(result.similarity * 100);
    const scoreEl = header.createSpan();
    scoreEl.addClass("lina-fs-085");
    scoreEl.addClass("lina-color-accent");
    scoreEl.addClass("lina-fw-bold");
    scoreEl.textContent = `(${simPct}%) `;

    header.createEl("strong", { text: result.basename });

    // Caminho
    const pathEl = card.createDiv();
    pathEl.addClass("lina-fs-085");
    pathEl.addClass("lina-color-muted");
    pathEl.textContent = result.path;

    // Excerto
    const snippetEl = card.createDiv();
    snippetEl.addClass("lina-fs-085");
    snippetEl.addClass("lina-mt-6");
    snippetEl.addClass("lina-p-4-6");
    snippetEl.addClass("lina-bg-primary-alt");
    snippetEl.addClass("lina-radius-3");
    snippetEl.addClass("lina-pre-wrap");
    snippetEl.addClass("lina-break-word");
    snippetEl.textContent = result.snippet;

    // Clicar abre a nota
    card.addEventListener("click", () => this.openNote(result.path));
  }

  private openNote(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      new Notice(this.L.errorNoteNotFound);
      return;
    }

    void this.app.workspace.getLeaf().openFile(file);
    this.close();
  }

  private showDiagnosticInformationWithRawResults(
    query: string,
    queryEmbedding: number[],
    diagnosticResults: SemanticSearchResults
  ) {
    this.diagnosticContainer.removeClass("lina-hidden");
    this.diagnosticContainer.addClass("lina-display-block");
    this.diagnosticContainer.createEl("h3", {
      text: this.L.diagnosticTitle,
      attr: { style: "margin-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 4px;" }
    });

    // Informação básica da pesquisa
    const basicInfo = this.diagnosticContainer.createDiv();
    basicInfo.addClass("lina-mb-12");

    basicInfo.createEl("strong", { text: `${this.L.diagnosticQueryLabel}: ` });
    basicInfo.createSpan({ text: query });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: `${this.L.diagnosticProviderLabel}: ` });
    basicInfo.createSpan({ text: "Ollama" });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: `${this.L.diagnosticModelLabel}: ` });
    basicInfo.createSpan({ text: this.config.model });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: `${this.L.diagnosticDimensionLabel}: ` });
    basicInfo.createSpan({ text: queryEmbedding.length.toString() });
    basicInfo.createEl("br");

    // Informação sobre prefixos
    const prefixMode = getPrefixModeForModel(this.config.model);
    const queryPrefix = prefixMode === "nomic-search-query-document" ? "search_query: " : this.L.diagnosticPrefixNone;
    const documentPrefix = prefixMode === "nomic-search-query-document" ? "search_document: " : this.L.diagnosticPrefixNone;

    basicInfo.createEl("strong", { text: `${this.L.diagnosticPrefixModeLabel}: ` });
    basicInfo.createSpan({ text: prefixMode === "none" ? this.L.diagnosticPrefixNone : this.L.diagnosticPrefixNomic });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: `${this.L.diagnosticQueryPrefixLabel}: ` });
    basicInfo.createSpan({ text: queryPrefix });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: `${this.L.diagnosticDocPrefixLabel}: ` });
    basicInfo.createSpan({ text: documentPrefix });
    basicInfo.createEl("br");

    // Estatísticas do índice
    const statsInfo = this.diagnosticContainer.createDiv();
    statsInfo.addClass("lina-mb-12");

    statsInfo.createEl("strong", { text: `${this.L.diagnosticTotalEvaluated}: ` });
    statsInfo.createSpan({ text: diagnosticResults.totalEmbeddingsEvaluated.toString() });
    statsInfo.createEl("br");

    statsInfo.createEl("strong", { text: `${this.L.diagnosticValidEmbeddings}: ` });
    statsInfo.createSpan({ text: diagnosticResults.validEmbeddingsCount.toString() });
    statsInfo.createEl("br");

    statsInfo.createEl("strong", { text: `${this.L.diagnosticFinalResults}: ` });
    statsInfo.createSpan({ text: diagnosticResults.finalResults.length.toString() });
    statsInfo.createEl("br");

    // Threshold information
    statsInfo.createEl("strong", { text: `${this.L.diagnosticThresholdLabel}: ` });
    statsInfo.createSpan({ text: `${diagnosticResults.threshold} (${Math.round(diagnosticResults.threshold * 100)}%)` });
    statsInfo.createEl("br");

    // Top 10 resultados brutos - SEMPRE mostrados
    this.diagnosticContainer.createEl("h4", {
      text: `${this.L.diagnosticRawTop10}:`,
      attr: { style: "margin-top: 12px; margin-bottom: 8px;" }
    });

    const resultsTable = this.diagnosticContainer.createDiv({
      attr: { style: "border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 8px; margin-bottom: 12px;" }
    });

    if (diagnosticResults.rawResults.length > 0) {
      diagnosticResults.rawResults.forEach((result, index) => {
        const resultRow = resultsTable.createDiv({
          attr: { style: `padding: 6px; border-bottom: 1px solid var(--background-modifier-border); ${index % 2 === 0 ? 'background-color: var(--background-modifier-hover);' : ''}` }
        });

        resultRow.createEl("strong", { text: `#${index + 1} - ${result.basename} ` });
        resultRow.createSpan({ text: `(${this.L.diagnosticScoreLabel}: ${result.similarity.toFixed(4)} / ${Math.round(result.similarity * 100)}%)`, attr: { style: "color: var(--text-accent); margin-left: 8px;" } });
        resultRow.createEl("br");

        resultRow.createDiv({ text: result.path, attr: { style: "font-size: small; color: var(--text-muted); margin-top: 2px;" } });

        if (result.snippet) {
          const excerptText = result.snippet.length > 100 ? result.snippet.slice(0, 100) + "..." : result.snippet;
          resultRow.createDiv({ text: excerptText, attr: { style: "font-size: small; margin-top: 4px; color: var(--text-normal);" } });
        }

        // Indicar status do threshold
        const passedThreshold = result.similarity >= diagnosticResults.threshold;
        const thresholdStatus = `${this.L.diagnosticPassedThreshold}: ${passedThreshold ? this.L.diagnosticYes : this.L.diagnosticNo}`;
        const statusColor = passedThreshold ? "var(--text-success)" : "var(--text-error)";
        resultRow.createDiv({
          text: thresholdStatus,
          attr: { style: `font-size: small; margin-top: 4px; color: ${statusColor}; font-weight: bold;` }
        });
      });
    } else {
      resultsTable.createEl("p", {
        text: this.L.diagnosticNoRawResults,
        attr: { style: "color: var(--text-muted); font-style: italic;" }
      });
    }

    // Informação sobre resultados finais
    if (diagnosticResults.finalResults.length === 0 && diagnosticResults.rawResults.length > 0) {
      this.diagnosticContainer.createEl("p", {
        text: this.L.diagnosticNonePassedThreshold,
        attr: { style: "margin-top: 12px; color: var(--text-warning); font-weight: bold;" }
      });
    }
  }
}
