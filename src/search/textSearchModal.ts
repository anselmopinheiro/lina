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
    this.queryInput.style.width = "100%";
    this.queryInput.style.marginBottom = "8px";
    this.queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.doSearch();
      }
    });

    this.searchButton = contentEl.createEl("button", { text: "Pesquisar" });
    this.searchButton.addEventListener("click", () => this.doSearch());

    this.resultsContainer = contentEl.createDiv("lina-textsearch-results");
    this.resultsContainer.style.marginTop = "12px";

    setTimeout(() => this.queryInput.focus(), 50);
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
    card.style.marginBottom = "8px";
    card.style.padding = "8px";
    card.style.border = "1px solid var(--background-modifier-border)";
    card.style.borderRadius = "4px";
    card.style.cursor = "pointer";

    // Header com nome, origem e pontuacao
    const header = card.createDiv();
    header.style.marginBottom = "4px";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";

    header.createEl("strong", { text: result.basename });

    const metaEl = header.createEl("span");
    metaEl.style.fontSize = "0.8em";
    metaEl.style.color = "var(--text-muted)";
    metaEl.textContent = this.originLabel(result.origin) + " \u00B7 ";

    const scoreEl = metaEl.createEl("span");
    scoreEl.style.color = "var(--text-accent)";
    scoreEl.textContent = "Pontuacao: " + result.score;

    // Caminho
    const pathEl = card.createDiv();
    pathEl.style.fontSize = "0.85em";
    pathEl.style.color = "var(--text-muted)";
    pathEl.textContent = result.path;

    // Excerto com termo destacado (construcao DOM segura)
    const snippetEl = card.createDiv();
    snippetEl.style.fontSize = "0.85em";
    snippetEl.style.marginTop = "6px";
    snippetEl.style.padding = "4px 6px";
    snippetEl.style.backgroundColor = "var(--background-primary-alt)";
    snippetEl.style.borderRadius = "3px";
    snippetEl.style.whiteSpace = "pre-wrap";
    snippetEl.style.wordBreak = "break-word";

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
        mark.style.backgroundColor = "var(--text-highlight-bg)";
        mark.style.color = "inherit";
        mark.textContent = part;
      } else {
        container.appendChild(document.createTextNode(part));
      }
    }
  }

  private openNote(path: string) {
    const file: TFile | null = this.app.vault.getAbstractFileByPath(path) as TFile | null;

    if (!file) {
      new Notice("Nota nao encontrada no vault.");
      return;
    }

    this.app.workspace.getLeaf().openFile(file);
    this.close();
  }
}
