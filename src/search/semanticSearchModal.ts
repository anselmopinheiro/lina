import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import { generateSingleEmbedding } from "../index/embeddingGenerator";
import { readIndexedChunks } from "../index/indexStore";
import { EmbeddingRecord } from "../index/embeddingGenerator";
import { searchSemanticIndex, SemanticSearchResult } from "./semanticSearch";

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
  private config: EmbeddingConfig;

  constructor(app: App, baseUrl: string, model: string, timeoutMs: number) {
    super(app);
    this.config = { baseUrl, model, timeoutMs };
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

    setTimeout(() => this.queryInput.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async doSearch() {
    const query = this.queryInput.value.trim();
    this.resultsContainer.empty();

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

    const queryEmbedding = await generateSingleEmbedding(
      this.config.baseUrl,
      this.config.model,
      query,
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

    const results = searchSemanticIndex(queryEmbedding, embeddings, chunks);

    statusEl.remove();

    if (results.length === 0) {
      this.resultsContainer.createEl("p", { text: "Sem resultados." });
      return;
    }

    for (const result of results) {
      this.renderResult(result);
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
}