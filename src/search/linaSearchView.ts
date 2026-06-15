import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import LinaPlugin from "../../main";
import { Chunk } from "../index/chunker";
import { EmbeddingRecord, generateSingleEmbedding, readEmbeddingStatus } from "../index/embeddingGenerator";
import { readIndexedChunks, readIndexedNotes, readTextIndexStatus } from "../index/indexStore";
import { runHybridSearch } from "./hybridSearch";
import { searchSemanticIndex, SemanticSearchResult } from "./semanticSearch";
import { SearchResult, searchTextIndex } from "./textSearch";

export const LINA_SEARCH_VIEW_TYPE = "lina-search-view";

type SearchMode = "hibrida" | "textual" | "semantica";

const MAX_NOTES_DISPLAY = 20;
const RAW_REQUEST_MULTIPLIER = 3; // pedir mais resultados brutos para compensar agrupamento

async function loadEmbeddings(view: LinaSearchView): Promise<EmbeddingRecord[] | null> {
  try {
    const adapter = view.app.vault.adapter;
    const path = normalizePath(".lina/index/embeddings.jsonl");
    const stat = await adapter.stat(path);
    if (!stat || stat.type !== "file") {
      return null;
    }

    const content = await adapter.read(path);
    const lines = content.trim().split("\n").filter((line) => line.length > 0);
    const records: EmbeddingRecord[] = [];

    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as EmbeddingRecord);
      } catch {
        // ignorar linhas inválidas
      }
    }

    return records;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Interface única para cartão de nota agrupado
// ---------------------------------------------------------------------------
interface GroupedNoteCard {
  path: string;
  normalizedPath: string;
  basename: string;
  snippet: string;                // melhor excerto
  score: number;                  // score principal (finalScore, score, ou similarity)
  textScore?: number;             // melhor textScore (híbrida)
  semanticScore?: number;         // melhor semelhança semântica (híbrida)
  origin: string;                 // origem formatada
  termsFound: string[];           // termos agregados (sem duplicados)
  totalTerms: number;
  termCoverage: number;           // 0..1
  extraSnippets: string[];        // até 2 snippets adicionais diferentes do principal
  chunkCount: number;             // quantos chunks/resultados foram agrupados
}

// ---------------------------------------------------------------------------
// Agrupamento central: resultados brutos → cartões de nota
// ---------------------------------------------------------------------------
type AnyResult = {
  path: string;
  basename: string;
  snippet: string;
  score?: number;
  finalScore?: number;
  similarity?: number;
  textScore?: number;
  semanticSimilarity?: number;
  textOrigin?: string;
  source?: string;
  termCoverage?: number;
  termsFound?: string[];
  totalTerms?: number;
};

function normalizeResultPath(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase();
}

function groupResultsByNote(results: AnyResult[]): GroupedNoteCard[] {
  const groups = new Map<string, AnyResult[]>();

  for (const r of results) {
    const key = normalizeResultPath(r.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const cards: GroupedNoteCard[] = [];

  for (const [normalizedPath, items] of groups) {
    // Escolher resultado principal
    // Para híbrida: maior finalScore
    // Para textual: maior score
    // Para semântica: maior similarity
    items.sort((a, b) => {
      const scoreA = b.finalScore ?? b.score ?? b.similarity ?? 0;
      const scoreB = a.finalScore ?? a.score ?? a.similarity ?? 0;
      return scoreA - scoreB;
    });
    const main = items[0];

    // Agregar termos
    const allTerms = new Set<string>();
    let maxTotalTerms = 0;
    for (const item of items) {
      if (item.termsFound) item.termsFound.forEach(t => allTerms.add(t));
      if (item.totalTerms && item.totalTerms > maxTotalTerms) maxTotalTerms = item.totalTerms;
    }
    const coverage = maxTotalTerms > 0 ? allTerms.size / maxTotalTerms : 0;

    // Melhores scores agregados
    const bestTextScore = items.reduce((max, r) => Math.max(max, r.textScore ?? 0), 0);
    const bestSemanticScore = items.reduce((max, r) => Math.max(max, r.semanticSimilarity ?? 0), 0);

    // Origem
    let origin = "Desconhecida";
    if (main.textOrigin) {
      switch (main.textOrigin) {
        case "nome": origin = "Nome"; break;
        case "caminho": origin = "Caminho"; break;
        case "conteudo": origin = "Conteúdo"; break;
      }
    } else if (main.source) {
      switch (main.source) {
        case "hibrida": origin = "Híbrida"; break;
        case "semantica": origin = "Semântica"; break;
        case "textual": origin = "Textual"; break;
      }
    }

    // Excertos adicionais (até 2, diferentes do principal)
    const extraSnippets: string[] = [];
    for (const item of items) {
      if (item === main) continue;
      if (extraSnippets.length >= 2) break;
      if (item.snippet !== main.snippet && !extraSnippets.includes(item.snippet)) {
        extraSnippets.push(item.snippet);
      }
    }

    const mainScore = main.finalScore ?? main.score ?? main.similarity ?? 0;

    cards.push({
      path: main.path,
      normalizedPath,
      basename: main.basename,
      snippet: main.snippet,
      score: mainScore,
      textScore: bestTextScore > 0 ? bestTextScore : undefined,
      semanticScore: bestSemanticScore > 0 ? bestSemanticScore : undefined,
      origin,
      termsFound: Array.from(allTerms),
      totalTerms: maxTotalTerms,
      termCoverage: coverage,
      extraSnippets,
      chunkCount: items.length,
    });
  }

  // Ordenar cartões por score descendente
  cards.sort((a, b) => b.score - a.score);

  console.debug(`Lina agrupamento: ${results.length} resultados brutos → ${cards.length} notas únicas`);

  return cards;
}

// ---------------------------------------------------------------------------
// Destaque seguro de termos (sem innerHTML)
// ---------------------------------------------------------------------------

/** Palavras demasiado curtas ou vazias para destacar */
const MIN_TERM_LENGTH = 2;
const STOP_WORDS = new Set(["de", "e", "a", "o", "do", "da", "em", "no", "na", "os", "as", "dos", "das", "ao", "aos", "para", "com", "por", "que", "se", "é", "um", "uma"]);

/**
 * Verifica se um termo deve ser destacado.
 * Ignora termos curtos e stop words comuns.
 */
function shouldHighlightTerm(term: string): boolean {
  const t = term.trim().toLowerCase();
  return t.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(t);
}

/**
 * Constrói nós DOM seguros para texto com termos destacados.
 * @param container - elemento onde adicionar os spans
 * @param text - texto original
 * @param terms - lista de termos a destacar (case-insensitive, ignorando stop words)
 */
function renderHighlightedText(container: HTMLElement, text: string, terms: string[]): void {
  if (!text || !terms || terms.length === 0) {
    container.createSpan({ text });
    return;
  }

  // Filtrar termos válidos e escapar para regex
  const validTerms = terms.filter(shouldHighlightTerm).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (validTerms.length === 0) {
    container.createSpan({ text });
    return;
  }

  // Construir regex combinado case-insensitive
  const regex = new RegExp(`(${validTerms.join("|")})`, "gi");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Texto antes do match
    if (match.index > lastIndex) {
      container.createSpan({ text: text.substring(lastIndex, match.index) });
    }
    // Termo destacado
    const mark = container.createEl("mark");
    mark.textContent = match[0];
    mark.style.backgroundColor = "var(--text-highlight-bg)";
    mark.style.color = "inherit";
    mark.style.borderRadius = "2px";
    mark.style.padding = "0 2px";
    lastIndex = regex.lastIndex;
  }

  // Restante do texto
  if (lastIndex < text.length) {
    container.createSpan({ text: text.substring(lastIndex) });
  }
}

// ---------------------------------------------------------------------------
// View principal
// ---------------------------------------------------------------------------
export class LinaSearchView extends ItemView {
  private plugin: LinaPlugin;
  private stateContainer!: HTMLDivElement;
  private actionsContainer!: HTMLDivElement;
  private queryInput!: HTMLInputElement;
  private searchButton!: HTMLButtonElement;
  private modeSelect!: HTMLSelectElement;
  private statusEl!: HTMLDivElement;
  private resultsEl!: HTMLDivElement;
  private currentMode: SearchMode = "hibrida";

  constructor(leaf: WorkspaceLeaf, plugin: LinaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LINA_SEARCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Lina";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Lina" });

    this.stateContainer = contentEl.createDiv();
    this.stateContainer.style.marginBottom = "12px";

    this.actionsContainer = contentEl.createDiv();
    this.actionsContainer.style.display = "flex";
    this.actionsContainer.style.flexWrap = "wrap";
    this.actionsContainer.style.gap = "8px";
    this.actionsContainer.style.marginBottom = "12px";

    this.queryInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Escreve o que queres procurar...",
    });
    this.queryInput.style.width = "100%";
    this.queryInput.style.marginBottom = "8px";
    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.runSearch();
      }
    });

    const controlsRow = contentEl.createDiv();
    controlsRow.style.display = "flex";
    controlsRow.style.gap = "8px";
    controlsRow.style.marginBottom = "12px";

    this.modeSelect = controlsRow.createEl("select");
    this.modeSelect.createEl("option", { text: "Híbrida", value: "hibrida" });
    this.modeSelect.createEl("option", { text: "Textual", value: "textual" });
    this.modeSelect.createEl("option", { text: "Semântica", value: "semantica" });
    this.modeSelect.value = this.currentMode;
    this.modeSelect.addEventListener("change", () => {
      this.currentMode = this.modeSelect.value as SearchMode;
    });

    this.searchButton = controlsRow.createEl("button", { text: "Pesquisar" });
    this.searchButton.addEventListener("click", () => void this.runSearch());

    this.statusEl = contentEl.createDiv();
    this.statusEl.style.fontSize = "0.9em";
    this.statusEl.style.color = "var(--text-muted)";
    this.statusEl.style.marginBottom = "10px";

    this.resultsEl = contentEl.createDiv();

    await this.refreshState();

    window.setTimeout(() => this.queryInput.focus(), 50);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  private clearResults(): void {
    this.resultsEl.empty();
  }

  private async refreshState(): Promise<void> {
    const indexStatus = await readTextIndexStatus(this.app);
    const embeddingStatus = await readEmbeddingStatus(this.app);

    this.stateContainer.empty();
    this.actionsContainer.empty();

    this.stateContainer.createEl("h3", { text: "Estado do Lina" });

    const stateList = this.stateContainer.createDiv();
    stateList.style.fontSize = "0.9em";
    stateList.style.color = "var(--text-muted)";

    const autoUpdateEnabled = this.plugin.settings.autoUpdateIndexOnFileChanges ?? false;
    stateList.createDiv({ text: `Atualização automática: ${autoUpdateEnabled ? "ativa" : "inativa"}` });

    const manifest = indexStatus.manifest;
    const notesExist = indexStatus.exists && typeof indexStatus.totalNotes === "number";
    const chunksExist = indexStatus.exists && typeof indexStatus.totalChunks === "number";
    const indexReady = indexStatus.exists && notesExist && chunksExist;

    stateList.createDiv({ text: `Índice textual: ${indexReady ? "pronto" : "em falta"}` });
    stateList.createDiv({ text: `notes.json: ${notesExist ? "disponível" : "em falta"}` });
    stateList.createDiv({ text: `chunks.jsonl: ${chunksExist ? "disponível" : "em falta"}` });

    if (indexReady) {
      stateList.createDiv({ text: `Notas indexadas: ${indexStatus.totalNotes ?? 0}` });
      stateList.createDiv({ text: `Blocos textuais: ${indexStatus.totalChunks ?? 0}` });
      if (manifest?.updatedAt) {
        stateList.createDiv({ text: `Última atualização do índice: ${manifest.updatedAt}` });
      }
    } else {
      stateList.createDiv({ text: "Índice textual ainda não existe." });
    }

    const embeddingsReady = !!embeddingStatus?.exists && (embeddingStatus.validCount ?? 0) > 0;
    const embeddingsIncomplete = !!embeddingStatus && ((embeddingStatus.missingCount ?? 0) > 0 || (embeddingStatus.staleCount ?? 0) > 0 || (embeddingStatus.obsoleteCount ?? 0) > 0);

    stateList.createDiv({ text: `Embeddings: ${embeddingsReady ? (embeddingsIncomplete ? "incompletos" : "prontos") : "indisponíveis"}` });

    if (embeddingStatus) {
      stateList.createDiv({ text: `Embeddings válidos: ${embeddingStatus.validCount}` });
      stateList.createDiv({ text: `Embeddings em falta: ${embeddingStatus.missingCount}` });
      stateList.createDiv({ text: `Embeddings desatualizados: ${embeddingStatus.staleCount + embeddingStatus.obsoleteCount}` });
      if (embeddingStatus.model) {
        stateList.createDiv({ text: `Modelo: ${embeddingStatus.model}` });
      }
      if (embeddingStatus.provider) {
        stateList.createDiv({ text: `Provider: ${embeddingStatus.provider}` });
      }
      if (embeddingStatus.updatedAt) {
        stateList.createDiv({ text: `Última atualização dos embeddings: ${embeddingStatus.updatedAt}` });
      }
    }

    if (!indexReady) {
      this.actionsContainer.appendChild(this.createActionButton("Construir índice textual", async () => {
        this.setStatus("A construir índice textual...");
        const result = await this.plugin.rebuildTextIndex();
        this.setStatus(result.success ? "Índice textual construído com sucesso." : "Erro ao construir índice textual.");
        await this.refreshState();
      }));
      return;
    }

    this.actionsContainer.appendChild(this.createActionButton("Reconstruir índice textual", async () => {
      this.setStatus("A construir índice textual...");
      const result = await this.plugin.rebuildTextIndex();
      this.setStatus(result.success ? "Índice textual construído com sucesso." : "Erro ao construir índice textual.");
      await this.refreshState();
    }));

    if (!embeddingsReady) {
      stateList.createDiv({ text: "A pesquisa híbrida será feita apenas com o índice textual enquanto não existirem embeddings." });
      this.actionsContainer.appendChild(this.createActionButton("Gerar embeddings locais", async () => {
        this.setStatus("A gerar embeddings locais...");
        const result = await this.plugin.generateLocalEmbeddings((message) => this.setStatus(message));
        this.setStatus(result.success ? "Embeddings locais gerados com sucesso." : "Erro ao gerar embeddings locais.");
        await this.refreshState();
      }));
    } else if (embeddingsIncomplete) {
      stateList.createDiv({ text: "Embeddings locais incompletos ou desatualizados." });
      this.actionsContainer.appendChild(this.createActionButton("Atualizar embeddings locais", async () => {
        this.setStatus("A gerar embeddings locais...");
        const result = await this.plugin.generateLocalEmbeddings((message) => this.setStatus(message));
        this.setStatus(result.success ? "Embeddings locais gerados com sucesso." : "Erro ao gerar embeddings locais.");
        await this.refreshState();
      }));
    }
  }

  private createActionButton(label: string, onClick: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => void onClick());
    return button;
  }

  private async runSearch(): Promise<void> {
    const query = this.queryInput.value.trim();
    this.clearResults();
    this.setStatus("");

    if (!query) {
      return;
    }

    const notes = await readIndexedNotes(this.app);
    const chunks = await readIndexedChunks(this.app);

    if (!notes) {
      this.setStatus("Índice textual ainda não existe.");
      await this.refreshState();
      return;
    }

    if (!chunks) {
      this.setStatus("Índice textual ainda não existe.");
      await this.refreshState();
      return;
    }

    this.setStatus("A pesquisar...");

    try {
      if (this.currentMode === "textual") {
        // Pedir mais resultados brutos para compensar agrupamento
        const rawResults = searchTextIndex(notes, chunks, query, {
          maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
          maxChunksPerNote: 5,
        });
        const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
        this.renderGroupedCards(cards);
        return;
      }

      if (this.currentMode === "semantica") {
        await this.runSemanticSearchGrouped(query, chunks);
        return;
      }

      await this.runHybridModeGrouped(query, notes, chunks);
    } catch (error) {
      this.setStatus(`Erro na pesquisa: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runHybridModeGrouped(query: string, notes: Awaited<ReturnType<typeof readIndexedNotes>>, chunks: Chunk[]): Promise<void> {
    const textWeight = this.plugin.settings.hybridSearchTextWeight ?? 0.7;
    const semanticWeight = this.plugin.settings.hybridSearchSemanticWeight ?? 0.3;
    const totalWeight = textWeight + semanticWeight;
    const normalisedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.7;
    const normalisedSemanticWeight = totalWeight > 0 ? semanticWeight / totalWeight : 0.3;
    const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingModel || "nomic-embed-text";
    const timeoutMs = (this.plugin.settings.embeddingRequestTimeoutSeconds || 60) * 1000;

    const result = await runHybridSearch(this.app, notes ?? [], chunks, query, {
      baseUrl,
      model,
      timeoutMs,
      textWeight: normalisedTextWeight,
      semanticWeight: normalisedSemanticWeight,
    });

    if (result.warnings.length > 0) {
      this.setStatus(result.warnings.join(" "));
    } else {
      this.setStatus("");
    }

    if (result.results.length === 0) {
      this.setStatus(this.statusEl.textContent ? `${this.statusEl.textContent} Sem resultados.` : "Sem resultados.");
      return;
    }

    const cards = groupResultsByNote(result.results).slice(0, MAX_NOTES_DISPLAY);
    this.renderGroupedCards(cards);
  }

  private async runSemanticSearchGrouped(query: string, chunks: Chunk[]): Promise<void> {
    const embeddings = await loadEmbeddings(this);
    if (!embeddings || embeddings.length === 0) {
      this.setStatus("Embeddings locais indisponíveis. A pesquisa foi feita apenas no índice textual.");
      const rawResults = searchTextIndex(await readIndexedNotes(this.app) ?? [], chunks, query, {
        maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
        maxChunksPerNote: 5,
      });
      const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
      this.renderGroupedCards(cards);
      return;
    }

    const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingModel || "nomic-embed-text";
    const timeoutMs = (this.plugin.settings.embeddingRequestTimeoutSeconds || 60) * 1000;

    const queryEmbedding = await generateSingleEmbedding(baseUrl, model, query, timeoutMs);
    if (!queryEmbedding) {
      this.setStatus("Não foi possível usar a pesquisa semântica. Foram apresentados resultados textuais.");
      const rawResults = searchTextIndex(await readIndexedNotes(this.app) ?? [], chunks, query, {
        maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
        maxChunksPerNote: 5,
      });
      const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
      this.renderGroupedCards(cards);
      return;
    }

    const rawResults = searchSemanticIndex(queryEmbedding, embeddings, chunks, {
      maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
      maxResultsPerNote: 5,
    });
    const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
    this.renderGroupedCards(cards);
  }

  // -----------------------------------------------------------------------
  // Renderização de cartões agrupados
  // -----------------------------------------------------------------------
  private renderGroupedCards(cards: GroupedNoteCard[]): void {
    if (cards.length === 0) {
      this.setStatus("Sem resultados.");
      return;
    }
    this.setStatus("");

    for (const card of cards) {
      const meta: string[] = [];
      meta.push(`Origem: ${card.origin}`);
      if (typeof card.textScore === "number") meta.push(`Relevância textual: ${card.textScore}`);
      if (typeof card.semanticScore === "number") meta.push(`Semelhança semântica: ${card.semanticScore}%`);
      meta.push(`Pontuação final: ${typeof card.score === "number" ? Math.round(card.score) : card.score}`);
      if (card.termsFound.length > 0 && card.totalTerms > 0) {
        meta.push(`Termos encontrados: ${card.termsFound.join(", ")}`);
        meta.push(`Cobertura: ${card.termsFound.length}/${card.totalTerms}`);
      }
      if (card.chunkCount > 1) {
        meta.push(`Blocos encontrados: ${card.chunkCount}`);
      }

      this.renderHighlightedCard(card);

      // Excertos adicionais
      if (card.extraSnippets.length > 0) {
        const extrasContainer = this.resultsEl.createDiv();
        extrasContainer.style.marginTop = "2px";
        extrasContainer.style.marginBottom = "8px";
        extrasContainer.style.paddingLeft = "12px";
        extrasContainer.style.borderLeft = "2px solid var(--background-modifier-border)";

        for (const snippetText of card.extraSnippets) {
          const el = document.createElement("div");
          el.style.fontSize = "0.8em";
          el.style.color = "var(--text-muted)";
          el.style.padding = "2px 4px";
          el.style.marginTop = "2px";
          el.style.backgroundColor = "var(--background-primary-alt)";
          el.style.borderRadius = "2px";
          el.style.whiteSpace = "pre-wrap";
          el.style.wordBreak = "break-word";

          const displayText = snippetText.length > 180 ? `${snippetText.substring(0, 180)}...` : snippetText;
          renderHighlightedText(el, displayText, card.termsFound);

          extrasContainer.appendChild(el);
        }
      }
    }
  }

  /**
   * Renderiza cartão com destaque seguro de termos no título e no excerto.
   */
  private renderHighlightedCard(card: GroupedNoteCard): void {
    const cardEl = this.resultsEl.createDiv();
    cardEl.style.marginBottom = "8px";
    cardEl.style.padding = "10px";
    cardEl.style.border = "1px solid var(--background-modifier-border)";
    cardEl.style.borderRadius = "4px";
    cardEl.style.cursor = "pointer";

    // Título com destaque de termos
    const titleEl = cardEl.createEl("strong");
    renderHighlightedText(titleEl, card.basename, card.termsFound);

    // Caminho
    const pathEl = cardEl.createDiv({ text: card.path });
    pathEl.style.fontSize = "0.85em";
    pathEl.style.color = "var(--text-muted)";
    pathEl.style.marginTop = "4px";

    // Metadados
    const metaEl = cardEl.createDiv();
    metaEl.style.fontSize = "0.85em";
    metaEl.style.color = "var(--text-muted)";
    metaEl.style.marginTop = "6px";

    metaEl.createDiv({ text: `Origem: ${card.origin}` });
    if (typeof card.textScore === "number") metaEl.createDiv({ text: `Relevância textual: ${card.textScore}` });
    if (typeof card.semanticScore === "number") metaEl.createDiv({ text: `Semelhança semântica: ${card.semanticScore}%` });
    metaEl.createDiv({ text: `Pontuação final: ${typeof card.score === "number" ? Math.round(card.score) : card.score}` });
    if (card.termsFound.length > 0 && card.totalTerms > 0) {
      metaEl.createDiv({ text: `Termos encontrados: ${card.termsFound.join(", ")}` });
      metaEl.createDiv({ text: `Cobertura: ${card.termsFound.length}/${card.totalTerms}` });
    }
    if (card.chunkCount > 1) {
      metaEl.createDiv({ text: `Blocos encontrados: ${card.chunkCount}` });
    }

    // Excerto principal com destaque de termos
    const snippetEl = cardEl.createDiv();
    snippetEl.style.fontSize = "0.85em";
    snippetEl.style.marginTop = "8px";
    snippetEl.style.padding = "4px 6px";
    snippetEl.style.backgroundColor = "var(--background-primary-alt)";
    snippetEl.style.borderRadius = "3px";
    snippetEl.style.whiteSpace = "pre-wrap";
    snippetEl.style.wordBreak = "break-word";

    const displaySnippet = card.snippet.length > 280 ? `${card.snippet.substring(0, 280)}...` : card.snippet;
    renderHighlightedText(snippetEl, displaySnippet, card.termsFound);

    // Clique para abrir a nota
    cardEl.addEventListener("click", () => this.openNote(card.path));
  }

  private openNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path) as TFile | null;
    if (!file) {
      new Notice("Nota não encontrada no vault.");
      return;
    }

    void this.app.workspace.getLeaf().openFile(file);
  }
}