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
  private barFill!: HTMLDivElement;
  private percentEl!: HTMLSpanElement;
  private messageEl!: HTMLSpanElement;

  constructor(app: App) {
    super(app);
    this.setTitle("Gerar embeddings locais");
  }

  onOpen() {
    const { contentEl } = this;

    this.messageEl = contentEl.createEl("p", { text: "A processar blocos..." });
    this.messageEl.style.marginBottom = "8px";

    // Contador: "120 / 556"
    const counterEl = contentEl.createDiv();
    counterEl.style.marginBottom = "8px";
    this.currentEl = counterEl.createEl("span", { text: "0" });
    counterEl.createEl("span", { text: " / " });
    this.totalEl = counterEl.createEl("span", { text: "0" });

    // Barra de progresso
    const barOuter = contentEl.createDiv();
    barOuter.style.width = "100%";
    barOuter.style.height = "20px";
    barOuter.style.backgroundColor = "var(--background-modifier-border)";
    barOuter.style.borderRadius = "4px";
    barOuter.style.overflow = "hidden";

    this.barFill = barOuter.createDiv();
    this.barFill.style.width = "0%";
    this.barFill.style.height = "100%";
    this.barFill.style.backgroundColor = "var(--interactive-accent)";
    this.barFill.style.transition = "width 0.3s ease";

    // Percentagem
    this.percentEl = contentEl.createEl("p");
    this.percentEl.style.marginTop = "6px";
    this.percentEl.style.fontSize = "0.85em";
    this.percentEl.style.color = "var(--text-muted)";
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

    this.barFill.style.width = `${pct}%`;
    this.percentEl.textContent = `${pct}%`;

    if (progress.current === progress.total) {
      this.messageEl.textContent = "Concluído.";
    }
  }
}