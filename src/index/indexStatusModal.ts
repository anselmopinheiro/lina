import { App, Modal } from "obsidian";
import { TextIndexStatus } from "./indexStore";

export class IndexStatusModal extends Modal {
  constructor(
    app: App,
    private readonly status: TextIndexStatus
  ) {
    super(app);
    this.setTitle("Estado do Índice Textual");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    if (!this.status.exists) {
      contentEl.createEl("p", {
        text: "Ainda não existe índice textual.",
      });
      contentEl.createEl("p", {
        text: 'Executa primeiro o comando "Lina: reconstruir índice textual".',
      });
      return;
    }

    const manifest = this.status.manifest;
    if (!manifest) {
      contentEl.createEl("p", {
        text: "Erro ao ler o índice textual.",
      });
      if (this.status.error) {
        contentEl.createEl("p", {
          text: `Detalhe: ${this.status.error}`,
        });
      }
      return;
    }

    // Índice encontrado
    contentEl.createEl("p", {
      text: "Índice encontrado: sim",
    });

    contentEl.createEl("p", {
      text: `Tipo: ${manifest.indexType}`,
    });

    contentEl.createEl("p", {
      text: `Embeddings: ${manifest.embeddingsEnabled ? "ativos" : "inativos"}`,
    });

    contentEl.createEl("p", {
      text: `Notas indexadas: ${this.status.totalNotes || 0}`,
    });

    // Formatar data
    let formattedDate = "desconhecida";
    if (manifest.updatedAt) {
      try {
        const date = new Date(manifest.updatedAt);
        formattedDate = date.toLocaleString("pt-PT", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch (error) {
        formattedDate = manifest.updatedAt;
      }
    }

    contentEl.createEl("p", {
      text: `Última atualização: ${formattedDate}`,
    });

    contentEl.createEl("p", {
      text: "Localização:",
    });

    contentEl.createEl("p", {
      text: ".lina/index/manifest.json",
      cls: "index-path",
    });

    contentEl.createEl("p", {
      text: ".lina/index/notes.json",
      cls: "index-path",
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}