import { App, Modal } from "obsidian";
import LinaPlugin from "../main";

interface DiagnosticEvent {
  timestamp: string;
  eventType: "create" | "modify" | "delete" | "rename" | "debounce" | "index" | "ignored" | "error";
  path: string;
  message: string;
}

export class IndexDiagnosticModal extends Modal {
  private plugin: LinaPlugin;

  constructor(app: App, plugin: LinaPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Diagnóstico do índice Lina");

    // Get diagnostic data from plugin
    const diag = this.plugin.getIndexDiagnosticData();

    // Show current state
    contentEl.createEl("h3", { text: "Estado atual" });

    const stateTable = contentEl.createEl("div", {
      attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" }
    });

    stateTable.createEl("div", { text: "Atualização automática:", attr: { style: "font-weight: bold;" } });
    stateTable.createEl("div", { text: diag.autoUpdateEnabled ? "Ativa" : "Inativa" });

    // Mostrar estado dos listeners
    stateTable.createEl("div", { text: "Listeners registados:", attr: { style: "font-weight: bold;" } });
    stateTable.createEl("div", { text: diag.autoUpdateEnabled ? "Sim" : "Não" });

    stateTable.createEl("div", { text: "Modo de diagnóstico:", attr: { style: "font-weight: bold;" } });
    stateTable.createEl("div", { text: diag.debugEnabled ? "Ativo" : "Inativo" });

    // Mostrar debounces pendentes
    const pendingCount = diag.pendingDebounces;
    if (pendingCount > 0) {
      stateTable.createEl("div", { text: "Debounces pendentes:", attr: { style: "font-weight: bold;" } });
      stateTable.createEl("div", { text: pendingCount.toString() });
    }

    if (diag.lastEvent) {
      stateTable.createEl("div", { text: "Último evento:", attr: { style: "font-weight: bold;" } });
      stateTable.createEl("div", { text: diag.lastEvent });

      stateTable.createEl("div", { text: "Último ficheiro:", attr: { style: "font-weight: bold;" } });
      stateTable.createEl("div", { text: diag.lastEventPath });

      stateTable.createEl("div", { text: "Última ação:", attr: { style: "font-weight: bold;" } });
      stateTable.createEl("div", { text: diag.lastAction });

      stateTable.createEl("div", { text: "Último resultado:", attr: { style: "font-weight: bold;" } });
      stateTable.createEl("div", { text: diag.lastResult });

      stateTable.createEl("div", { text: "Última atualização:", attr: { style: "font-weight: bold;" } });
      stateTable.createEl("div", { text: diag.lastUpdatedAt });
    }

    if (diag.lastError) {
      stateTable.createEl("div", { text: "Último erro:", attr: { style: "font-weight: bold; color: var(--text-error);" } });
      stateTable.createEl("div", { text: diag.lastError, attr: { style: "color: var(--text-error);" } });
    }

    // Show index stats if available
    if (diag.totalNotes !== undefined || diag.totalChunks !== undefined) {
      contentEl.createEl("h3", { text: "Estatísticas do índice", attr: { style: "margin-top: 16px;" } });

      const statsTable = contentEl.createEl("div", {
        attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" }
      });

      if (diag.totalNotes !== undefined) {
        statsTable.createEl("div", { text: "Total de notas:", attr: { style: "font-weight: bold;" } });
        statsTable.createEl("div", { text: diag.totalNotes.toString() });
      }

      if (diag.totalChunks !== undefined) {
        statsTable.createEl("div", { text: "Total de chunks:", attr: { style: "font-weight: bold;" } });
        statsTable.createEl("div", { text: diag.totalChunks.toString() });
      }
    }

    // Show recent events
    contentEl.createEl("h3", { text: "Eventos recentes", attr: { style: "margin-top: 16px;" } });

    if (diag.recentEvents.length === 0) {
      contentEl.createEl("p", { text: "Nenhum evento recente registado.", attr: { style: "color: var(--text-muted);" } });
    } else {
      const eventsList = contentEl.createEl("div", {
        attr: { style: "max-height: 300px; overflow-y: auto; border: 1px solid var(--background-modifier-border); padding: 8px; border-radius: 4px;" }
      });

      diag.recentEvents.forEach((event: DiagnosticEvent) => {
        const eventEl = eventsList.createEl("div", {
          attr: { style: "padding: 4px 0; border-bottom: 1px solid var(--background-modifier-border);" }
        });

        eventEl.createEl("span", {
          text: `[${event.timestamp}] `,
          attr: { style: "color: var(--text-muted); font-family: monospace;" }
        });

        eventEl.createEl("span", {
          text: `${event.eventType} — `,
          attr: { style: "font-weight: bold;" }
        });

        eventEl.createEl("span", {
          text: `${event.path} — `,
          attr: { style: "color: var(--text-accent);" }
        });

        eventEl.createEl("span", {
          text: event.message,
          attr: { style: "color: var(--text-normal);" }
        });
      });
    }

    // Add clear button
    contentEl.createEl("div", { attr: { style: "margin-top: 16px;" } }).createEl("button", {
      text: "Limpar eventos",
      attr: { style: "padding: 8px 16px; background-color: var(--background-modifier-border); border: none; border-radius: 4px;" }
    }).addEventListener("click", () => {
      this.plugin.clearIndexDiagnosticEvents();
      this.close();
      new IndexDiagnosticModal(this.app, this.plugin).open();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
