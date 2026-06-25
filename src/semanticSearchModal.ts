import { App, Modal, Notice, TFile } from "obsidian";
import { IndexEntry } from "./indexStore";
import { SemanticSearchResult, searchSemanticIndex } from "./semanticSearch";
import { generateOllamaEmbedding } from "./ai/ollamaProvider";

/**
 * Modal para pesquisa semântica experimental.
 * Usa embeddings guardados no índice e similaridade cosseno.
 */
export class SemanticSearchModal extends Modal {
  private entries: IndexEntry[];
  private ollamaUrl: string;
  private embeddingModel: string;
  private queryInput!: HTMLInputElement;
  private resultsContainer!: HTMLDivElement;
  private searchButton!: HTMLButtonElement;
  private isSearching: boolean = false;

  constructor(
    app: App,
    entries: IndexEntry[],
    ollamaUrl: string,
    embeddingModel: string
  ) {
    super(app);
    this.entries = entries;
    this.ollamaUrl = ollamaUrl;
    this.embeddingModel = embeddingModel;
    this.setTitle("Lina — Pesquisa semântica de teste");
  }

  onOpen() {
    const { contentEl } = this;

    this.queryInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Escreva a sua pesquisa…",
    });
    this.queryInput.addClass("lina-search-input");
    this.queryInput.style.marginBottom = "8px";
    this.queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        void this.performSearch();
      }
    });

    this.searchButton = contentEl.createEl("button", {
      text: "Pesquisar",
    });
    this.searchButton.style.marginBottom = "12px";
    this.searchButton.addEventListener("click", () => void this.performSearch());

    this.resultsContainer = contentEl.createDiv("lina-results");
    this.resultsContainer.style.marginTop = "12px";

    // foco automático no input
    setTimeout(() => this.queryInput.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async performSearch() {
    if (this.isSearching) return;

    const query = this.queryInput.value.trim();
    if (!query) return;

    this.isSearching = true;
    this.searchButton.setText("A pesquisar…");
    this.searchButton.disabled = true;
    this.resultsContainer.empty();
    this.resultsContainer.createEl("p", { text: "A gerar embedding da pesquisa…" });

    try {
      // Gerar embedding apenas para a query
      const status = await generateOllamaEmbedding(
        this.ollamaUrl,
        this.embeddingModel,
        query
      );

      if (!status.success || !status.embedding || !status.dimension) {
        this.resultsContainer.empty();
        this.resultsContainer.createEl("p", {
          text: `Erro ao gerar embedding: ${status.message}`,
        });
        return;
      }

      // Pesquisa semântica usando o embedding da query
      const results: SemanticSearchResult[] = searchSemanticIndex(
        this.entries,
        status.embedding,
        10
      );

      this.resultsContainer.empty();

      if (results.length === 0) {
        this.resultsContainer.createEl("p", {
          text: "Nenhum resultado encontrado para a pesquisa.",
        });
        return;
      }

      for (const result of results) {
        this.renderResult(result);
      }
    } catch (error) {
      console.error("Erro na pesquisa semântica:", error);
      this.resultsContainer.empty();
      this.resultsContainer.createEl("p", {
        text: "Ocorreu um erro durante a pesquisa semântica.",
      });
    } finally {
      this.isSearching = false;
      this.searchButton.setText("Pesquisar");
      this.searchButton.disabled = false;
    }
  }

  private renderResult(result: SemanticSearchResult) {
    const { entry, score } = result;
    const card = this.resultsContainer.createDiv("lina-result-card");
    card.style.marginBottom = "8px";
    card.style.padding = "8px";
    card.style.border = "1px solid var(--background-modifier-border)";
    card.style.borderRadius = "4px";
    card.style.cursor = "pointer";

    // Nome e pontuação
    const headerEl = card.createDiv();
    headerEl.style.display = "flex";
    headerEl.style.justifyContent = "space-between";
    headerEl.style.alignItems = "center";

    headerEl.createEl("strong", { text: entry.basename });

    const scoreEl = headerEl.createEl("span");
    scoreEl.textContent = score.toFixed(2);
    scoreEl.style.fontSize = "small";
    scoreEl.style.color = "var(--text-accent)";

    // Caminho
    const pathEl = card.createEl("div");
    pathEl.style.fontSize = "small";
    pathEl.style.color = "var(--text-muted)";
    pathEl.textContent = entry.path;

    // Excerto
    const excerptText = entry.excerpt ? entry.excerpt.slice(0, 150) : "";
    if (excerptText) {
      const excerptEl = card.createEl("div");
      excerptEl.style.fontSize = "small";
      excerptEl.style.marginTop = "4px";
      excerptEl.textContent = excerptText;
    }

    card.addEventListener("click", () => this.openNote(entry));
  }

  private openNote(entry: IndexEntry) {
    const file: TFile | null = this.app.vault.getAbstractFileByPath(
      entry.path
    ) as TFile | null;

    if (!file) {
      new Notice("Nota não encontrada no vault.");
      return;
    }

    void this.app.workspace.getLeaf().openFile(file);
    this.close();
  }
}
