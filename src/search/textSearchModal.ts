import { App, Modal, Notice, TFile } from "obsidian";
import { searchTextIndex, SearchResult } from "./textSearch";
import { IndexedNote } from "../index/indexStore";
import { Chunk } from "../index/chunker";

export class TextSearchModal extends Modal {
  private notes: IndexedNote[];
  private chunks: Chunk[];
  private queryInput!: HTMLInputElement;
  private resultsContainer!: HTMLDivElement;
  private searchButton!: HTMLButtonElement;

  constructor(app: App, notes: IndexedNote[], chunks: Chunk[]) {
    super(app);
    this.notes = notes;
    this.chunks = chunks;
    this.setTitle("Pesquisar no índice textual");
  }

  onOpen() {
    const { contentEl } = this;

    this.queryInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Escreve o que queres procurar...",
    });
    this.queryInput.addClass("lina-w-full");
    this.queryInput.addClass("lina-mb-8");
    this.queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.doSearch();
      }
    });

    this.searchButton = contentEl.createEl("button", { text: "Pesquisar" });
    this.searchButton.addEventListener("click", () => this.doSearch());

    this.resultsContainer = contentEl.createDiv("lina-textsearch-results");
    this.resultsContainer.addClass("lina-mt-12");

    window.setTimeout(() => this.queryInput.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private doSearch() {
    const query = this.queryInput.value;
    this.resultsContainer.empty();

    if (!query.trim()) {
      return;
    }

    const results = searchTextIndex(this.notes, this.chunks, query, {
      maxResults: 30,
      maxChunksPerNote: 3,
    });

    if (results.length === 0) {
      this.resultsContainer.createEl("p", { text: "Sem resultados." });
      return;
    }

    for (const result of results) {
      this.renderResult(result, query);
    }
  }

  private originLabel(origin: SearchResult["origin"]): string {
    switch (origin) {
      case "nome": return "Origem: Nome";
      case "caminho": return "Origem: Caminho";
      case "conteudo": return "Origem: Conteudo";
    }
  }

  private renderResult(result: SearchResult, query: string) {
    const card = this.resultsContainer.createDiv("lina-textsearch-card");
    card.addClass("lina-mb-8");
    card.addClass("lina-p-8");
    card.addClass("lina-border");
    card.addClass("lina-radius-4");
    card.addClass("lina-cursor-pointer");

    // Header com nome, origem e pontuacao
    const header = card.createDiv();
    header.addClass("lina-mb-4");
    header.addClass("lina-display-flex");
    header.addClass("lina-items-center");
    header.addClass("lina-gap-8");

    header.createEl("strong", { text: result.basename });

    const metaEl = header.createEl("span");
    metaEl.addClass("lina-fs-08");
    metaEl.addClass("lina-color-muted");
    metaEl.textContent = this.originLabel(result.origin) + " \u00B7 ";

    const scoreEl = metaEl.createEl("span");
    scoreEl.addClass("lina-color-accent");
    scoreEl.textContent = "Pontuacao: " + result.score;

    // Caminho
    const pathEl = card.createDiv();
    pathEl.addClass("lina-fs-085");
    pathEl.addClass("lina-color-muted");
    pathEl.textContent = result.path;

    // Excerto com termo destacado (construcao DOM segura)
    const snippetEl = card.createDiv();
    snippetEl.addClass("lina-fs-085");
    snippetEl.addClass("lina-mt-6");
    snippetEl.addClass("lina-p-4-6");
    snippetEl.addClass("lina-bg-primary-alt");
    snippetEl.addClass("lina-radius-3");
    snippetEl.addClass("lina-pre-wrap");
    snippetEl.addClass("lina-break-word");

    const displayText = result.snippet.length > 240
      ? result.snippet.substring(0, 240) + "..."
      : result.snippet;
    this.buildHighlightedContent(snippetEl, displayText, query);

    // Clicar no card abre a nota
    card.addEventListener("click", () => this.openNote(result.path));
  }

  private buildHighlightedContent(container: HTMLDivElement, text: string, query: string) {
    if (!query.trim()) {
      container.textContent = text;
      return;
    }

    // Escapar caracteres especiais para a regex
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Regex sem flag g para teste (nao altera lastIndex)
    const testRe = new RegExp(escaped, 'i');

    // Regex com flag g para split
    const splitRe = new RegExp(`(${escaped})`, 'gi');

    // Split retorna intercalado: [texto, match, texto, match, ...]
    const parts = text.split(splitRe);

    for (const part of parts) {
      if (part.length === 0) continue;

      if (testRe.test(part)) {
        const mark = container.createEl("mark");
        mark.addClass("lina-bg-highlight");
        mark.addClass("lina-color-inherit");
        mark.textContent = part;
      } else {
        container.appendChild(container.ownerDocument.createTextNode(part));
      }
    }
  }

  private openNote(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      new Notice("Nota nao encontrada no vault.");
      return;
    }

    void this.app.workspace.getLeaf().openFile(file);
    this.close();
  }
}
