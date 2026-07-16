import { Modal, App } from "obsidian";
import { EmbeddingOperationState } from "./embeddingOperationManager";

export type EmbeddingOperationStateSubscription = (
  listener: (state: EmbeddingOperationState) => void
) => () => void;

/**
 * Modal simples de progresso para geração de embeddings.
 * É apenas uma vista do estado central da operação; não inicia, cancela,
 * controla providers nem mantém lógica própria de progresso.
 */
export class EmbeddingProgressModal extends Modal {
  private currentEl!: HTMLSpanElement;
  private totalEl!: HTMLSpanElement;
  private progressEl!: HTMLProgressElement;
  private percentEl!: HTMLSpanElement;
  private messageEl!: HTMLSpanElement;
  private unsubscribe?: () => void;

  constructor(
    app: App,
    private readonly subscribeToEmbeddingOperation?: EmbeddingOperationStateSubscription
  ) {
    super(app);
    this.setTitle("Gerar embeddings");
  }

  onOpen(): void {
    const { contentEl } = this;

    this.messageEl = contentEl.createEl("p", { text: "A processar chunks..." });
    this.messageEl.addClass("lina-embedding-progress-message");

    const counterEl = contentEl.createDiv();
    counterEl.addClass("lina-embedding-progress-counter");
    this.currentEl = counterEl.createEl("span", { text: "0" });
    counterEl.createEl("span", { text: " / " });
    this.totalEl = counterEl.createEl("span", { text: "0" });

    this.progressEl = contentEl.createEl("progress");
    this.progressEl.addClass("lina-embedding-progress-bar");
    this.progressEl.max = 100;
    this.progressEl.value = 0;

    this.percentEl = contentEl.createEl("p");
    this.percentEl.addClass("lina-embedding-progress-percent");
    this.percentEl.textContent = "0%";

    this.unsubscribe = this.subscribeToEmbeddingOperation?.((state) => {
      this.updateFromOperationState(state);
    });
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
  }

  public updateFromOperationState(state: EmbeddingOperationState): void {
    const totalChunks = state.totalChunks ?? 0;
    this.currentEl.textContent = String(state.processedChunks);
    this.totalEl.textContent = String(totalChunks);

    const percentage = totalChunks > 0
      ? Math.max(0, Math.min(100, Math.round((state.processedChunks / totalChunks) * 100)))
      : 0;

    this.progressEl.value = percentage;
    this.percentEl.textContent = `${percentage}%`;

    if (state.message) {
      this.messageEl.textContent = state.message;
    }

    if (state.status === "completed") {
      this.messageEl.textContent = "Concluído.";
    }
  }
}
