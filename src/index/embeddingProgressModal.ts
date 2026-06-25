import { Modal, App } from "obsidian";
import { EmbeddingProgress } from "./embeddingGenerator";

/**
 * Modal simples de progresso para geracao de embeddings.
 * Mostra titulo, contador, barra de progresso e percentagem.
 * Nao faz nada por si -- e apenas UI.
 */
export class EmbeddingProgressModal extends Modal {
  private currentEl!: HTMLSpanElement;
  private totalEl!: HTMLSpanElement;
  private progressEl!: HTMLProgressElement;
  private percentEl!: HTMLSpanElement;
  private messageEl!: HTMLSpanElement;

  constructor(app: App) {
    super(app);
    this.setTitle("Gerar embeddings locais");
  }

  onOpen() {
    const { contentEl } = this;

    this.messageEl = contentEl.createEl("p", { text: "A processar blocos..." });
    this.messageEl.addClass("lina-embedding-progress-message");

    // Contador: "120 / 556"
    const counterEl = contentEl.createDiv();
    counterEl.addClass("lina-embedding-progress-counter");
    this.currentEl = counterEl.createEl("span", { text: "0" });
    counterEl.createEl("span", { text: " / " });
    this.totalEl = counterEl.createEl("span", { text: "0" });

    // Barra de progresso
    this.progressEl = contentEl.createEl("progress");
    this.progressEl.addClass("lina-embedding-progress-bar");
    this.progressEl.max = 100;
    this.progressEl.value = 0;

    // Percentagem
    this.percentEl = contentEl.createEl("p");
    this.percentEl.addClass("lina-embedding-progress-percent");
    this.percentEl.textContent = "0%";
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  public setMessage(message: string): void {
    this.messageEl.textContent = message;
  }

  /** Atualiza a UI com o progresso atual */
  public updateProgress(progress: EmbeddingProgress): void {
    this.currentEl.textContent = String(progress.current);
    this.totalEl.textContent = String(progress.total);

    const pct = progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

    this.progressEl.value = pct;
    this.percentEl.textContent = `${pct}%`;

    if (progress.current === progress.total) {
      this.messageEl.textContent = "Concluído.";
    }
  }
}
