/**
 * Diagnostics UI / Status Panel (Phase D2.4.2)
 *
 * Read-only modal presenting Lina's current diagnostic state aggregating:
 * - Device identity, human-readable name, and configured role.
 * - Active producer ownership manifest state and epoch fencing.
 * - Artifact provenance validation states across text index, canonical embeddings, binary copies, and checkpoints.
 *
 * Architectural Invariants:
 * - Strictly read-only: Contains zero mutation controls (no role editing, no ownership transfer, no rebuild buttons, no sync triggers).
 * - Zero duplicated logic: Consumes the `DeviceDiagnostics` data model directly without inspecting vault files or recalculating epochs.
 */

import { App, Modal } from "obsidian";
import { DeviceDiagnostics, DeviceDiagnosticsArtifactItem } from "./deviceDiagnostics";
import { ArtifactProvenanceStatus } from "./artifactProvenanceValidation";

export class DeviceDiagnosticsModal extends Modal {
  constructor(
    app: App,
    private readonly diagnostics: DeviceDiagnostics
  ) {
    super(app);
    if (typeof this.setTitle === "function") {
      this.setTitle("Diagnóstico do Dispositivo e Sincronização");
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof contentEl.addClass === "function") {
      contentEl.addClass("lina-device-diagnostics-modal");
    }

    // 1. Device Section
    contentEl.createEl("h3", { text: "Dispositivo (Device)" });
    const deviceGrid = contentEl.createDiv({
      attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" },
    });

    deviceGrid.createDiv({ text: "Nome:", attr: { style: "font-weight: bold;" } });
    deviceGrid.createDiv({ text: this.diagnostics.device.name ?? "Não configurado" });

    deviceGrid.createDiv({ text: "Identificador (ID):", attr: { style: "font-weight: bold;" } });
    deviceGrid.createDiv({ text: this.diagnostics.device.id });

    deviceGrid.createDiv({ text: "Função (Role):", attr: { style: "font-weight: bold;" } });
    const roleLabel =
      this.diagnostics.device.role === "producer"
        ? "Produtor (Producer)"
        : this.diagnostics.device.role === "companion"
        ? "Companion"
        : "Não atribuída (Unassigned)";
    deviceGrid.createDiv({ text: roleLabel });

    deviceGrid.createDiv({ text: "Estado do perfil:", attr: { style: "font-weight: bold;" } });
    deviceGrid.createDiv({ text: this.diagnostics.device.isConfigured ? "Configurado" : "Inicial / Neutro" });

    // 2. Ownership Section
    contentEl.createEl("h3", { text: "Propriedade e Época (Ownership & Epoch)" });
    const ownershipGrid = contentEl.createDiv({
      attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" },
    });

    ownershipGrid.createDiv({ text: "Estado Local:", attr: { style: "font-weight: bold;" } });
    let localOwnershipLabel = "Não atribuído";
    if (this.diagnostics.ownership.isActiveProducer) {
      localOwnershipLabel = "Produtor Ativo (Autorizado a publicar)";
    } else if (this.diagnostics.ownership.isStandbyProducer) {
      localOwnershipLabel = "Produtor em Espera (Standby / Somente leitura)";
    } else if (this.diagnostics.ownership.isCompanion) {
      localOwnershipLabel = "Companion (Consumidor / Somente leitura)";
    } else if (this.diagnostics.ownership.isUnclaimed) {
      localOwnershipLabel = "Não reclamado (Sem produtor ativo)";
    }
    ownershipGrid.createDiv({ text: localOwnershipLabel });

    ownershipGrid.createDiv({ text: "Produtor Ativo Global:", attr: { style: "font-weight: bold;" } });
    ownershipGrid.createDiv({ text: this.diagnostics.ownership.activeProducerId ?? "Nenhum (Não reclamado)" });

    ownershipGrid.createDiv({ text: "Época Atual (Epoch):", attr: { style: "font-weight: bold;" } });
    ownershipGrid.createDiv({
      text:
        this.diagnostics.ownership.epoch !== undefined
          ? this.diagnostics.ownership.epoch.toString()
          : "Nenhuma",
    });

    if (this.diagnostics.ownership.reason) {
      ownershipGrid.createDiv({ text: "Motivo de aquisição:", attr: { style: "font-weight: bold;" } });
      ownershipGrid.createDiv({ text: this.diagnostics.ownership.reason });
    }

    // 3. Artifacts Section
    contentEl.createEl("h3", { text: "Estado dos Artefactos e Proveniência" });
    const artifactsContainer = contentEl.createDiv({
      attr: { style: "display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;" },
    });

    // A. Text Index
    this.renderArtifactCard(
      artifactsContainer,
      "Índice Textual",
      this.diagnostics.artifacts.index,
      this.diagnostics.artifacts.index.exists
        ? `${this.diagnostics.artifacts.index.totalNotes ?? 0} notas, ${this.diagnostics.artifacts.index.totalChunks ?? 0} blocos (chunks)`
        : "Manifesto ausente"
    );

    // B. Canonical Embeddings
    this.renderArtifactCard(
      artifactsContainer,
      "Embeddings Canónicos (JSONL)",
      this.diagnostics.artifacts.embeddings,
      this.diagnostics.artifacts.embeddings.exists
        ? `${this.diagnostics.artifacts.embeddings.provider ?? "N/A"} / ${this.diagnostics.artifacts.embeddings.model ?? "N/A"} (${this.diagnostics.artifacts.embeddings.dimensions ?? 0}d)`
        : "Secção de embeddings ausente"
    );

    // C. Binary Embeddings Copy
    this.renderArtifactCard(
      artifactsContainer,
      "Cópia Binária de Embeddings",
      this.diagnostics.artifacts.binary,
      this.diagnostics.artifacts.binary.exists
        ? `${this.diagnostics.artifacts.binary.recordCount ?? 0} registos (${this.diagnostics.artifacts.binary.dimensions ?? 0}d)`
        : "Manifesto binário ausente"
    );

    // D. Checkpoint (Optional)
    if (this.diagnostics.artifacts.checkpoint) {
      this.renderArtifactCard(
        artifactsContainer,
        "Checkpoint de Embeddings",
        this.diagnostics.artifacts.checkpoint,
        `${this.diagnostics.artifacts.checkpoint.completedRecords ?? 0} registos concluídos`
      );
    }

    // 4. Footer & Close Button
    const footer = contentEl.createDiv({
      attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-top: 16px; border-top: 1px solid var(--background-modifier-border); padding-top: 12px;" },
    });

    footer.createDiv({
      text: "Painel de leitura para diagnóstico e auditoria de estado do dispositivo e artefactos.",
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" },
    });

    const closeBtn = footer.createEl("button", { text: "Fechar" });
    if (typeof closeBtn.addClass === "function") {
      closeBtn.addClass("mod-cta");
    }
    closeBtn.addEventListener("click", () => this.close());
  }

  private renderArtifactCard(
    container: HTMLElement,
    title: string,
    artifact: DeviceDiagnosticsArtifactItem,
    details: string
  ): void {
    const card = container.createDiv({
      attr: {
        style:
          "border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px 14px; background: var(--background-secondary);",
      },
    });

    const header = card.createDiv({
      attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;" },
    });

    header.createEl("strong", { text: title });

    const badge = header.createSpan({
      attr: {
        style:
          "padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold;" +
          this.getStatusBadgeStyle(artifact.status),
      },
      text: this.getStatusBadgeText(artifact.status),
    });

    card.createDiv({
      text: `Detalhes: ${details}`,
      attr: { style: "font-size: 0.9em; color: var(--text-muted); margin-bottom: 2px;" },
    });

    card.createDiv({
      text: `Proveniência: ${artifact.diagnosticMessage}`,
      attr: { style: "font-size: 0.85em; color: var(--text-normal);" },
    });
  }

  private getStatusBadgeText(status: ArtifactProvenanceStatus): string {
    switch (status) {
      case "valid":
        return "✓ Válido";
      case "stale":
        return "⚠ Desatualizado";
      case "future":
        return "⚡ Futuro";
      case "unknown":
      default:
        return "❓ Desconhecido";
    }
  }

  private getStatusBadgeStyle(status: ArtifactProvenanceStatus): string {
    switch (status) {
      case "valid":
        return "background-color: var(--background-modifier-success); color: var(--text-on-accent);";
      case "stale":
        return "background-color: var(--background-modifier-warning); color: var(--text-normal);";
      case "future":
        return "background-color: var(--text-accent); color: var(--text-on-accent);";
      case "unknown":
      default:
        return "background-color: var(--background-modifier-border); color: var(--text-muted);";
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
