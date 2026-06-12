import { App, Modal, Notice, TFile } from "obsidian";
import { Chunk } from "../index/chunker";
import { IndexedNote } from "../index/indexStore";
import { HybridSearchConfig, HybridSearchResult, runHybridSearch } from "./hybridSearch";

export class HybridSearchModal extends Modal {
  private readonly notes: IndexedNote[];
  private readonly chunks: Chunk[];
  private readonly config: HybridSearchConfig;
  private queryInput!: HTMLInputElement;
  private resultsContainer!: HTMLDivElement;
  private searchButton!: HTMLButtonElement;

  constructor(app: App, notes: IndexedNote[], chunks: Chunk[], config: HybridSearchConfig) {
    super(app);
    this.notes = notes;
    this.chunks = chunks;
    this.config = config;
    this.setTitle("Pesquisar no Lina");
  }

  onOpen() {
    const { contentEl } = this;

    this.queryInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Escreve o que queres procurar...",
    });
    this.queryInput.style.width = "100%";
    this.queryInput.style.marginBottom = "8px";
    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.doSearch();
      }
    });

    this.searchButton = contentEl.createEl("button", { text: "Pesquisar" });
    this.searchButton.addEventListener("click", () => void this.doSearch());

    this.resultsContainer = contentEl.createDiv("lina-hybridsearch-results");
    this.resultsContainer.style.marginTop = "12px";

    setTimeout(() => this.queryInput.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }

  private async doSearch() {
    const query = this.queryInput.value.trim();
    this.resultsContainer.empty();

    if (!query) {
      return;
    }

    const statusEl = this.resultsContainer.createEl("p", { text: "A pesquisar no Lina..." });

    const result = await runHybridSearch(this.app, this.notes, this.chunks, query, this.config);

    statusEl.remove();

    for (const warning of result.warnings) {
      const warningEl = this.resultsContainer.createEl("p", { text: warning });
      warningEl.style.fontSize = "0.85em";
      warningEl.style.color = "var(--text-muted)";
      warningEl.style.marginBottom = "10px";
    }

    if (result.results.length === 0) {
      this.resultsContainer.createEl("p", { text: "Sem resultados." });
      return;
    }

    for (const item of result.results) {
      this.renderResult(item);
    }
  }

  private renderResult(result: HybridSearchResult) {
    const card = this.resultsContainer.createDiv("lina-hybridsearch-card");
    card.style.marginBottom = "8px";
    card.style.padding = "10px";
    card.style.border = "1px solid var(--background-modifier-border)";
    card.style.borderRadius = "4px";
    card.style.cursor = "pointer";

    const titleEl = card.createEl("strong", { text: result.basename });
    titleEl.style.display = "block";

    const pathEl = card.createDiv({ text: result.path });
    pathEl.style.fontSize = "0.85em";
    pathEl.style.color = "var(--text-muted)";
    pathEl.style.marginTop = "4px";

    const metaEl = card.createDiv();
    metaEl.style.fontSize = "0.85em";
    metaEl.style.color = "var(--text-muted)";
    metaEl.style.marginTop = "6px";

    metaEl.createDiv({ text: `Origem: ${this.formatSource(result.source)}` });

    if (typeof result.textScore === "number") {
      metaEl.createDiv({ text: `Relevância textual: ${result.textScore}` });
    }

    if (typeof result.semanticSimilarity === "number") {
      metaEl.createDiv({ text: `Semelhança semântica: ${result.semanticSimilarity}%` });
    }

    metaEl.createDiv({ text: `Pontuação final: ${result.finalScore}` });

    const snippetEl = card.createDiv({ text: this.limitText(result.snippet, 280) });
    snippetEl.style.fontSize = "0.85em";
    snippetEl.style.marginTop = "8px";
    snippetEl.style.padding = "4px 6px";
    snippetEl.style.backgroundColor = "var(--background-primary-alt)";
    snippetEl.style.borderRadius = "3px";
    snippetEl.style.whiteSpace = "pre-wrap";
    snippetEl.style.wordBreak = "break-word";

    const clickableEl = card.createDiv({ text: "Clicar no cartão para abrir a nota." });
    clickableEl.style.fontSize = "0.8em";
    clickableEl.style.color = "var(--text-muted)";
    clickableEl.style.marginTop = "8px";

    card.addEventListener("click", () => this.openNote(result.path));
  }

  private formatSource(source: HybridSearchResult["source"]): string {
    switch (source) {
      case "hibrida":
        return "Híbrida";
      case "semantica":
        return "Semântica";
      case "textual":
      default:
        return "Textual";
    }
  }

  private limitText(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  }

  private openNote(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path) as TFile | null;

    if (!file) {
      new Notice("Nota não encontrada no vault.");
      return;
    }

    this.app.workspace.getLeaf().openFile(file);
    this.close();
  }
}