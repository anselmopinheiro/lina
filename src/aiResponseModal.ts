import { App, Modal } from "obsidian";

export class AIResponseModal extends Modal {
  private responseElement?: HTMLElement;
  private errorElement?: HTMLElement;

  constructor(
    app: App,
    private readonly model: string,
    private readonly prompt: string,
    private readonly responseText: string
  ) {
    super(app);
    this.setTitle("Resposta da IA");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Modelo usado
    contentEl.createEl("h3", { text: "Modelo usado" });
    contentEl.createEl("p", { text: this.model });

    // Pergunta enviada
    contentEl.createEl("h3", { text: "Pergunta enviada" });
    contentEl.createEl("p", { text: this.prompt });

    // Resposta gerada
    contentEl.createEl("h3", { text: "Resposta gerada" });
    this.responseElement = contentEl.createEl("p", {
      text: this.responseText && this.responseText.trim().length > 0 ? this.responseText : "Resposta vazia.",
    });
    // Preserve line breaks if any
    this.responseElement.addClass("lina-ai-response-text");
  }

  updateResponse(responseText: string | null, errorMessage?: string) {
    if (!this.responseElement) return;

    // Limpar elemento de erro anterior, se existir
    if (this.errorElement) {
      this.errorElement.remove();
      this.errorElement = undefined;
    }

    // Atualizar resposta
    if (responseText) {
      this.responseElement.setText(responseText && responseText.trim().length > 0 ? responseText : "Resposta vazia.");
    } else {
      this.responseElement.setText("Não foi possível gerar resposta com IA.");
    }

    // Adicionar erro, se fornecido
    if (errorMessage && this.contentEl) {
      this.errorElement = this.contentEl.createEl("p", {
        text: `Erro: ${errorMessage}`,
      });
      this.errorElement.addClass("lina-ai-response-error");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
