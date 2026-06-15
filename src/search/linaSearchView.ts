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

    // Mostrar estado da atualização automática
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
        const results = searchTextIndex(notes, chunks, query, {
          maxResults: 30,
          maxChunksPerNote: 3,
        });
        this.renderTextResults(results);
        return;
      }

      if (this.currentMode === "semantica") {
        await this.runSemanticSearch(query, chunks);
        return;
      }

      await this.runHybridMode(query, notes, chunks);
    } catch (error) {
      this.setStatus(`Erro na pesquisa: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runHybridMode(query: string, notes: Awaited<ReturnType<typeof readIndexedNotes>>, chunks: Chunk[]): Promise<void> {
    const textWeight = this.plugin.settings.hybridSearchTextWeight ?? 0.7;
    const semanticWeight = this.plugin.settings.hybridSearchSemanticWeight ?? 0.3;
    const totalWeight = textWeight + semanticWeight;
    const normalisedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.7;
    const normalisedSemanticWeight = totalWeight > 0 ? semanticWeight / totalWeight : 0.3;
    const baseUrl = this.plugin.settings.embeddingLocalBaseUrl || this.plugin.settings.ollamaUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingLocalModel || "nomic-embed-text";
    const timeoutMs = this.plugin.settings.embeddingLocalTimeoutMs || 60000;

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

    for (const item of result.results) {
      const meta: string[] = [];
      meta.push(`Origem: ${item.textOrigin ? this.formatTextOrigin(item.textOrigin) : this.formatHybridMode(item.source)}`);
      if (typeof item.textScore === "number") meta.push(`Relevância textual: ${item.textScore}`);
      if (typeof item.semanticSimilarity === "number") meta.push(`Semelhança semântica: ${item.semanticSimilarity}%`);
      meta.push(`Pontuação final: ${item.finalScore}`);
      this.renderCard(item.basename, item.path, item.snippet, meta);
    }
  }

  private async runSemanticSearch(query: string, chunks: Chunk[]): Promise<void> {
    const embeddings = await loadEmbeddings(this);
    if (!embeddings || embeddings.length === 0) {
      this.setStatus("Embeddings locais indisponíveis. A pesquisa foi feita apenas no índice textual.");
      this.renderTextResults(searchTextIndex(await readIndexedNotes(this.app) ?? [], chunks, query, {
        maxResults: 30,
        maxChunksPerNote: 3,
      }));
      return;
    }

    const baseUrl = this.plugin.settings.embeddingLocalBaseUrl || this.plugin.settings.ollamaUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingLocalModel || "nomic-embed-text";
    const timeoutMs = this.plugin.settings.embeddingLocalTimeoutMs || 60000;

    const queryEmbedding = await generateSingleEmbedding(baseUrl, model, query, timeoutMs);
    if (!queryEmbedding) {
      this.setStatus("Não foi possível usar a pesquisa semântica. Foram apresentados resultados textuais.");
      this.renderTextResults(searchTextIndex(await readIndexedNotes(this.app) ?? [], chunks, query, {
        maxResults: 30,
        maxChunksPerNote: 3,
      }));
      return;
    }

    const results = searchSemanticIndex(queryEmbedding, embeddings, chunks);
    if (results.length === 0) {
      this.setStatus("Sem resultados.");
      return;
    }

    this.setStatus("");
    for (const item of results) {
      this.renderSemanticCard(item);
    }
  }

  private renderTextResults(results: SearchResult[]): void {
    if (results.length === 0) {
      this.setStatus("Sem resultados.");
      return;
    }

    this.setStatus("");
    for (const result of results) {
      this.renderCard(result.basename, result.path, result.snippet, [
        `Origem: ${this.formatTextOrigin(result.origin)}`,
        `Pontuação textual: ${result.score}`,
      ]);
    }
  }

  private renderSemanticCard(result: SemanticSearchResult): void {
    this.renderCard(result.basename, result.path, result.snippet, [
      "Origem: Semântica",
      `Semelhança semântica: ${Math.round(result.similarity * 100)}%`,
    ]);
  }

  private renderCard(title: string, path: string, snippet: string, metaLines: string[]): void {
    const card = this.resultsEl.createDiv();
    card.style.marginBottom = "8px";
    card.style.padding = "10px";
    card.style.border = "1px solid var(--background-modifier-border)";
    card.style.borderRadius = "4px";
    card.style.cursor = "pointer";

    card.createEl("strong", { text: title });

    const pathEl = card.createDiv({ text: path });
    pathEl.style.fontSize = "0.85em";
    pathEl.style.color = "var(--text-muted)";
    pathEl.style.marginTop = "4px";

    const metaEl = card.createDiv();
    metaEl.style.fontSize = "0.85em";
    metaEl.style.color = "var(--text-muted)";
    metaEl.style.marginTop = "6px";
    for (const line of metaLines) {
      metaEl.createDiv({ text: line });
    }

    const snippetEl = card.createDiv({ text: snippet.length > 280 ? `${snippet.substring(0, 280)}...` : snippet });
    snippetEl.style.fontSize = "0.85em";
    snippetEl.style.marginTop = "8px";
    snippetEl.style.padding = "4px 6px";
    snippetEl.style.backgroundColor = "var(--background-primary-alt)";
    snippetEl.style.borderRadius = "3px";
    snippetEl.style.whiteSpace = "pre-wrap";
    snippetEl.style.wordBreak = "break-word";

    card.addEventListener("click", () => this.openNote(path));
  }

  private formatTextOrigin(origin: SearchResult["origin"]): string {
    switch (origin) {
      case "nome":
        return "Nome";
      case "caminho":
        return "Caminho";
      case "conteudo":
      default:
        return "Conteúdo";
    }
  }

  private formatHybridMode(mode: "textual" | "semantica" | "hibrida"): string {
    switch (mode) {
      case "hibrida":
        return "Híbrida";
      case "semantica":
        return "Semântica";
      case "textual":
      default:
        return "Textual";
    }
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