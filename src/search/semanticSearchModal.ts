import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import { generateSingleEmbedding } from "../index/embeddingGenerator";
import { readIndexedChunks } from "../index/indexStore";
import { EmbeddingRecord } from "../index/embeddingGenerator";
import { searchSemanticIndex, searchSemanticIndexWithDiagnostics, SemanticSearchResult, SemanticSearchResults } from "./semanticSearch";
import LinaPlugin from "../../main";
import { getPrefixModeForModel, applyEmbeddingPrefix } from "../index/embeddingGenerator";

interface EmbeddingConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
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

  constructor(app: App, baseUrl: string, model: string, timeoutMs: number, plugin?: LinaPlugin) {
    super(app);
    this.config = { baseUrl, model, timeoutMs };
    this.plugin = plugin;
    this.setTitle("Pesquisar semanticamente");
  }

  onOpen() {
    const { contentEl } = this;

    this.queryInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Escreve uma ideia, tema ou pergunta...",
    });
    this.queryInput.style.width = "100%";
    this.queryInput.style.marginBottom = "8px";
    this.queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.doSearch();
      }
    });

    this.searchButton = contentEl.createEl("button", { text: "Pesquisar" });
    this.searchButton.addEventListener("click", () => this.doSearch());

    this.resultsContainer = contentEl.createDiv("lina-semanticsearch-results");
    this.resultsContainer.style.marginTop = "12px";

    // Container para informações de diagnóstico
    this.diagnosticContainer = contentEl.createDiv("lina-diagnostic");
    this.diagnosticContainer.style.marginTop = "16px";
    this.diagnosticContainer.style.display = "none"; // Oculto por padrão

    setTimeout(() => this.queryInput.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async doSearch() {
    const query = this.queryInput.value.trim();
    this.resultsContainer.empty();
    this.diagnosticContainer.empty();
    this.diagnosticContainer.style.display = "none";

    if (!query) {
      return;
    }

    // 1. Verificar se embeddings existem
    const statusEl = this.resultsContainer.createEl("p", { text: "A carregar embeddings locais..." });

    const embeddings = await loadEmbeddings(this.app);
    if (!embeddings || embeddings.length === 0) {
      statusEl.textContent = "Embeddings locais ainda não existem. Gera embeddings primeiro.";
      return;
    }

    const chunks = await readIndexedChunks(this.app);
    if (!chunks || chunks.length === 0) {
      statusEl.textContent = "Chunks não encontrados. Reconstrói o índice textual primeiro.";
      return;
    }

    // 2. Gerar embedding da query
    statusEl.textContent = "A gerar embedding da pesquisa...";

    // Aplicar prefixo à query se o modelo suportar
    const prefixMode = getPrefixModeForModel(this.config.model);
    const prefixedQuery = applyEmbeddingPrefix(query, prefixMode, true);

    const queryEmbedding = await generateSingleEmbedding(
      this.config.baseUrl,
      this.config.model,
      prefixedQuery,
      this.config.timeoutMs
    );

    if (!queryEmbedding) {
      statusEl.textContent = "Não foi possível gerar o embedding da pesquisa. Verifica se o Ollama está ativo.";
      return;
    }

    // 3. Validar dimensao
    const expectedDim = embeddings[0].dimensions;
    if (queryEmbedding.length !== expectedDim) {
      statusEl.textContent = `Dimensão do embedding da query (${queryEmbedding.length}) não coincide com a dos embeddings locais (${expectedDim}). Os embeddings parecem desatualizados. Gera embeddings novamente.`;
      return;
    }

    // 4. Pesquisar
    statusEl.textContent = "A comparar com os embeddings locais...";

    // Usar função de diagnóstico para obter resultados brutos e finais
    const diagnosticResults = searchSemanticIndexWithDiagnostics(queryEmbedding, embeddings, chunks);
    const results = diagnosticResults.finalResults;

    statusEl.remove();

    if (results.length === 0) {
      this.resultsContainer.createEl("p", { text: "Sem resultados." });
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
    card.style.marginBottom = "8px";
    card.style.padding = "8px";
    card.style.border = "1px solid var(--background-modifier-border)";
    card.style.borderRadius = "4px";
    card.style.cursor = "pointer";

    // Header com nome e metadados
    const header = card.createDiv();
    header.style.marginBottom = "4px";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";

    header.createEl("strong", { text: result.basename });

    const metaEl = header.createEl("span");
    metaEl.style.fontSize = "0.8em";
    metaEl.style.color = "var(--text-muted)";
    metaEl.textContent = "Origem: Semântica";

    const simPct = Math.round(result.similarity * 100);
    const scoreEl = metaEl.createEl("span");
    scoreEl.style.color = "var(--text-accent)";
    scoreEl.textContent = ` · Semelhan\u00E7a: ${simPct}%`;

    // Caminho
    const pathEl = card.createDiv();
    pathEl.style.fontSize = "0.85em";
    pathEl.style.color = "var(--text-muted)";
    pathEl.textContent = result.path;

    // Excerto
    const snippetEl = card.createDiv();
    snippetEl.style.fontSize = "0.85em";
    snippetEl.style.marginTop = "6px";
    snippetEl.style.padding = "4px 6px";
    snippetEl.style.backgroundColor = "var(--background-primary-alt)";
    snippetEl.style.borderRadius = "3px";
    snippetEl.style.whiteSpace = "pre-wrap";
    snippetEl.style.wordBreak = "break-word";
    snippetEl.textContent = result.snippet;

    // Clicar abre a nota
    card.addEventListener("click", () => this.openNote(result.path));
  }

  private openNote(path: string) {
    const file: TFile | null = this.app.vault.getAbstractFileByPath(path) as TFile | null;

    if (!file) {
      new Notice("Nota não encontrada no vault.");
      return;
    }

    this.app.workspace.getLeaf().openFile(file);
    this.close();
  }

  private showDiagnosticInformationWithRawResults(
    query: string,
    queryEmbedding: number[],
    diagnosticResults: SemanticSearchResults
  ) {
    this.diagnosticContainer.style.display = "block";
    this.diagnosticContainer.createEl("h3", {
      text: "Informação de diagnóstico",
      attr: { style: "margin-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 4px;" }
    });

    // Informação básica da pesquisa
    const basicInfo = this.diagnosticContainer.createDiv();
    basicInfo.style.marginBottom = "12px";

    basicInfo.createEl("strong", { text: "Query pesquisada: " });
    basicInfo.createEl("span", { text: query });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: "Provider de embeddings: " });
    basicInfo.createEl("span", { text: "Ollama" });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: "Modelo de embeddings: " });
    basicInfo.createEl("span", { text: this.config.model });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: "Dimensão do embedding: " });
    basicInfo.createEl("span", { text: queryEmbedding.length.toString() });
    basicInfo.createEl("br");

    // Informação sobre prefixos
    const prefixMode = getPrefixModeForModel(this.config.model);
    const queryPrefix = prefixMode === "nomic-search-query-document" ? "search_query: " : "nenhum";
    const documentPrefix = prefixMode === "nomic-search-query-document" ? "search_document: " : "nenhum";

    basicInfo.createEl("strong", { text: "Modo de prefixo: " });
    basicInfo.createEl("span", { text: prefixMode === "none" ? "Nenhum" : "Nomic search_query/search_document" });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: "Prefixo da query: " });
    basicInfo.createEl("span", { text: queryPrefix });
    basicInfo.createEl("br");

    basicInfo.createEl("strong", { text: "Prefixo dos documentos: " });
    basicInfo.createEl("span", { text: documentPrefix });
    basicInfo.createEl("br");

    // Estatísticas do índice
    const statsInfo = this.diagnosticContainer.createDiv();
    statsInfo.style.marginBottom = "12px";

    statsInfo.createEl("strong", { text: "Total de embeddings avaliados: " });
    statsInfo.createEl("span", { text: diagnosticResults.totalEmbeddingsEvaluated.toString() });
    statsInfo.createEl("br");

    statsInfo.createEl("strong", { text: "Embeddings válidos (dimensão correta): " });
    statsInfo.createEl("span", { text: diagnosticResults.validEmbeddingsCount.toString() });
    statsInfo.createEl("br");

    statsInfo.createEl("strong", { text: "Número de resultados finais apresentados: " });
    statsInfo.createEl("span", { text: diagnosticResults.finalResults.length.toString() });
    statsInfo.createEl("br");

    // Threshold information
    statsInfo.createEl("strong", { text: "Limiar mínimo de similaridade: " });
    statsInfo.createEl("span", { text: `${diagnosticResults.threshold} (${Math.round(diagnosticResults.threshold * 100)}%)` });
    statsInfo.createEl("br");

    // Top 10 resultados brutos - SEMPRE mostrados
    this.diagnosticContainer.createEl("h4", {
      text: "Top 10 resultados brutos (antes de aplicar threshold):",
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
        resultRow.createEl("span", { text: `(score: ${result.similarity.toFixed(4)} / ${Math.round(result.similarity * 100)}%)`, attr: { style: "color: var(--text-accent); margin-left: 8px;" } });
        resultRow.createEl("br");

        resultRow.createEl("div", { text: result.path, attr: { style: "font-size: small; color: var(--text-muted); margin-top: 2px;" } });

        if (result.snippet) {
          const excerptText = result.snippet.length > 100 ? result.snippet.slice(0, 100) + "..." : result.snippet;
          resultRow.createEl("div", { text: excerptText, attr: { style: "font-size: small; margin-top: 4px; color: var(--text-normal);" } });
        }

        // Indicar status do threshold
        const passedThreshold = result.similarity >= diagnosticResults.threshold;
        const thresholdStatus = passedThreshold ? "✓ Passou o limiar" : "✗ Não passou o limiar";
        const statusColor = passedThreshold ? "var(--text-success)" : "var(--text-error)";
        resultRow.createEl("div", {
          text: thresholdStatus,
          attr: { style: `font-size: small; margin-top: 4px; color: ${statusColor}; font-weight: bold;` }
        });
      });
    } else {
      resultsTable.createEl("p", {
        text: "Nenhum resultado bruto disponível.",
        attr: { style: "color: var(--text-muted); font-style: italic;" }
      });
    }

    // Informação sobre resultados finais
    if (diagnosticResults.finalResults.length === 0 && diagnosticResults.rawResults.length > 0) {
      this.diagnosticContainer.createEl("p", {
        text: "⚠️ Nenhum resultado passou o threshold mínimo. Todos os resultados brutos foram filtrados.",
        attr: { style: "margin-top: 12px; color: var(--text-warning); font-weight: bold;" }
      });
    }
  }
}
