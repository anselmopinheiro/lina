import { App, Modal, Notice, TFile } from "obsidian";
import { IndexData, IndexEntry } from "./indexStore";
import { searchIndex, SearchResult } from "./indexSearch";

export class SearchModal extends Modal {
  private indexData: IndexData;
  private queryInput!: HTMLInputElement;
  private resultsContainer!: HTMLDivElement;

  constructor(app: App, indexData: IndexData) {
    super(app);
    this.indexData = indexData;
    this.setTitle("Lina — Pesquisar no índice");
  }

  onOpen() {
    const { contentEl } = this;

    this.queryInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Pesquisar notas…",
    });
    this.queryInput.addClass("lina-search-input");
    this.queryInput.addEventListener("input", () => this.updateResults());

    this.resultsContainer = contentEl.createDiv("lina-results");
    this.resultsContainer.style.marginTop = "12px";

    // foco automático no input
    setTimeout(() => this.queryInput.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private updateResults() {
    const query = this.queryInput.value;
    const results = searchIndex(this.indexData.entries, query);

    this.resultsContainer.empty();

    if (query.trim() && results.length === 0) {
      this.resultsContainer.createEl("p", { text: "Nenhum resultado encontrado." });
      return;
    }

    for (const result of results) {
      this.renderResult(result);
    }
  }

  private renderResult(result: SearchResult) {
    const { entry } = result;
    const card = this.resultsContainer.createDiv("lina-result-card");
    card.style.marginBottom = "8px";
    card.style.padding = "8px";
    card.style.border = "1px solid var(--background-modifier-border)";
    card.style.borderRadius = "4px";
    card.style.cursor = "pointer";

    card.createEl("strong", { text: entry.basename });

    const pathEl = card.createEl("div");
    pathEl.style.fontSize = "small";
    pathEl.style.color = "var(--text-muted)";
    pathEl.textContent = entry.path;

    const excerptEl = card.createEl("div");
    excerptEl.style.fontSize = "small";
    excerptEl.style.marginTop = "4px";
    excerptEl.textContent = entry.excerpt.slice(0, 150);

    card.addEventListener("click", () => this.openNote(entry));
  }

  private openNote(entry: IndexEntry) {
    const file: TFile | null = this.app.vault.getAbstractFileByPath(entry.path) as TFile | null;

    if (!file) {
      new Notice("Nota não encontrada no vault.");
      return;
    }

    this.app.workspace.getLeaf().openFile(file);
    this.close();
  }
}