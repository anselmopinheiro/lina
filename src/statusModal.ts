import { App, Modal, Notice } from "obsidian";
import { LinaSettings, DEFAULT_SETTINGS } from "./settings";
import { IndexData } from "./indexStore";
import { getEmbeddingStats } from "./indexStore";
import { testOllamaConnection } from "./ai/ollamaProvider";
import { getIndexSyncStatus } from "./indexSyncStatus";

/**
 * Modal que mostra o estado geral do plugin Lina.
 */
export class LinaStatusModal extends Modal {
  private settings: LinaSettings;
  private indexData?: IndexData;
  private ollamaStatusEl!: HTMLParagraphElement;
  private syncStatusEl!: HTMLDivElement;

  constructor(app: App, settings: LinaSettings, indexData?: IndexData) {
    super(app);
    this.settings = settings;
    this.indexData = indexData;
    this.setTitle("Estado geral do Lina");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const providerLabel = this.getProviderLabel(this.settings.provider);

    // Secção: Configuração
    contentEl.createEl("h3", { text: "Configuração" });
    contentEl.createEl("p", {
      text: `Provider de IA: ${providerLabel}`,
    });
    contentEl.createEl("p", {
      text: `URL do Ollama: ${this.settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl}`,
    });
    contentEl.createEl("p", {
      text: `Modelo de chat: ${this.settings.chatModel || DEFAULT_SETTINGS.chatModel}`,
    });
    contentEl.createEl("p", {
      text: `Modelo de embeddings: ${this.settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel}`,
    });

    // Secção: Índice
    contentEl.createEl("h3", { text: "Índice" });
    if (this.indexData && this.indexData.entries.length > 0) {
      const totalNotas = this.indexData.entries.length;
      const totalPalavras = this.indexData.entries.reduce(
        (sum, e) => sum + e.wordCount,
        0
      );

      contentEl.createEl("p", {
        text: `Notas no índice: ${totalNotas}`,
      });
      contentEl.createEl("p", {
        text: `Total de palavras analisadas: ${totalPalavras}`,
      });
    } else {
      contentEl.createEl("p", {
        text: "Índice: ainda não criado",
      });
    }

    // Secção: Embeddings
    contentEl.createEl("h3", { text: "Embeddings" });
    if (this.indexData && this.indexData.entries.length > 0) {
      const stats = getEmbeddingStats(this.indexData);
      contentEl.createEl("p", {
        text: `Notas com embeddings: ${stats.withEmbedding} de ${stats.total}`,
      });
    } else {
      contentEl.createEl("p", {
        text: "Índice não disponível",
      });
    }
    contentEl.createEl("p", {
      text: `Tamanho do lote: ${this.settings.embeddingBatchSize || DEFAULT_SETTINGS.embeddingBatchSize}`,
    });

    // Secção: Sincronização
    contentEl.createEl("h3", { text: "Sincronização" });
    this.syncStatusEl = contentEl.createDiv(); // Placeholder para o estado de sincronização
    this.updateSyncStatus();

    // Secção: Ligação
    contentEl.createEl("h3", { text: "Ligação" });
    this.ollamaStatusEl = contentEl.createEl("p", {
      text: "Ollama: a verificar…",
    });

    this.checkOllamaConnection();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async updateSyncStatus() {
    if (!this.indexData || this.indexData.entries.length === 0) {
      this.syncStatusEl.empty();
      this.syncStatusEl.createEl("p", { text: "Índice ainda não criado." });
      return;
    }

    const syncStatus = getIndexSyncStatus(this.app.vault, this.indexData);

    this.syncStatusEl.empty();
    this.syncStatusEl.createEl("p", { text: `Notas no vault: ${syncStatus.totalVaultNotes}` });
    this.syncStatusEl.createEl("p", { text: `Notas no índice: ${syncStatus.totalIndexedNotes}` });
    this.syncStatusEl.createEl("p", { text: `Notas novas: ${syncStatus.newNotes.length}` });
    this.syncStatusEl.createEl("p", { text: `Notas alteradas: ${syncStatus.changedNotes.length}` });
    this.syncStatusEl.createEl("p", { text: `Notas removidas: ${syncStatus.removedNotes.length}` });
    this.syncStatusEl.createEl("p", { text: `Notas sem embedding: ${syncStatus.notesWithoutEmbedding.length}` });
    this.syncStatusEl.createEl("p", { text: `Embeddings possivelmente desatualizados: ${syncStatus.outdatedEmbeddings.length}` });
  }

  private async checkOllamaConnection() {
    const ollamaUrl = this.settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;

    if (!ollamaUrl) {
      this.ollamaStatusEl.textContent = "Ollama: URL não definida"; // Corrected to match initial display format
      return;
    }

    try {
      const status = await testOllamaConnection(ollamaUrl);
      if (status.success) {
        this.ollamaStatusEl.textContent = "Ollama: estabelecida"; // Corrected to match initial display format
      } else {
        this.ollamaStatusEl.textContent = "Ollama: não foi possível ligar"; // Corrected to match initial display format
      }
    } catch {
      this.ollamaStatusEl.textContent = "Ollama: não foi possível ligar"; // Corrected to match initial display format
    }
  }

  private getProviderLabel(provider: string): string {
    const map: Record<string, string> = {
      ollama: "Ollama (local)",
      openrouter: "OpenRouter",
      openai: "OpenAI",
      anthropic: "Claude / Anthropic",
      gemini: "Gemini",
    };
    return map[provider] || provider;
  }
}
