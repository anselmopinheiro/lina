/**
 * Diagnostics UI / Status Panel (Phase D2.4.2 & D2.4.4)
 *
 * Read-only modal presenting Lina's current diagnostic state aggregating:
 * - Device identity, human-readable name, and configured role.
 * - Active producer ownership manifest state and epoch fencing.
 * - Artifact provenance validation states across text index, canonical embeddings, binary copies, and checkpoints.
 *
 * Architectural Invariants:
 * - Strictly read-only: Contains zero mutation controls (no role editing, no ownership transfer, no rebuild buttons, no sync triggers).
 * - Zero duplicated logic: Consumes the `DeviceDiagnostics` data model directly without inspecting vault files or recalculating epochs.
 * - Internationalization compliant: All user-facing strings are resolved via `UiStrings`.
 */

import { App, Modal } from "obsidian";
import { DeviceDiagnostics, DeviceDiagnosticsArtifactItem } from "./deviceDiagnostics";
import { ArtifactProvenanceStatus } from "./artifactProvenanceValidation";
import { getStrings, UiStrings } from "../i18n/strings";

export class DeviceDiagnosticsModal extends Modal {
  private readonly L: UiStrings;

  constructor(
    app: App,
    private readonly diagnostics: DeviceDiagnostics,
    strings?: UiStrings
  ) {
    super(app);
    this.L = strings ?? getStrings("pt-PT");
    if (typeof this.setTitle === "function") {
      this.setTitle(this.L.deviceDiagnosticsModalTitle);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof contentEl.addClass === "function") {
      contentEl.addClass("lina-device-diagnostics-modal");
    }

    // 1. Device Section
    contentEl.createEl("h3", { text: this.L.deviceDiagnosticsSectionDevice });
    const deviceGrid = contentEl.createDiv({
      attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" },
    });

    deviceGrid.createDiv({ text: this.L.deviceDiagnosticsDeviceNameLabel, attr: { style: "font-weight: bold;" } });
    deviceGrid.createDiv({ text: this.diagnostics.device.name ?? this.L.deviceDiagnosticsDeviceNotConfigured });

    deviceGrid.createDiv({ text: this.L.deviceDiagnosticsDeviceIdLabel, attr: { style: "font-weight: bold;" } });
    deviceGrid.createDiv({ text: this.diagnostics.device.id });

    deviceGrid.createDiv({ text: this.L.deviceDiagnosticsDeviceRoleLabel, attr: { style: "font-weight: bold;" } });
    const roleLabel =
      this.diagnostics.device.role === "producer"
        ? this.L.deviceDiagnosticsRoleProducer
        : this.diagnostics.device.role === "companion"
        ? this.L.deviceDiagnosticsRoleCompanion
        : this.L.deviceDiagnosticsRoleUnassigned;
    deviceGrid.createDiv({ text: roleLabel });

    deviceGrid.createDiv({ text: this.L.deviceDiagnosticsDeviceStateLabel, attr: { style: "font-weight: bold;" } });
    deviceGrid.createDiv({
      text: this.diagnostics.device.isConfigured
        ? this.L.deviceDiagnosticsProfileConfigured
        : this.L.deviceDiagnosticsProfileNeutral,
    });

    // 2. Ownership Section
    contentEl.createEl("h3", { text: this.L.deviceDiagnosticsSectionOwnership });
    const ownershipGrid = contentEl.createDiv({
      attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" },
    });

    ownershipGrid.createDiv({ text: this.L.deviceDiagnosticsOwnershipLocalStateLabel, attr: { style: "font-weight: bold;" } });
    let localOwnershipLabel = this.L.deviceDiagnosticsOwnershipUnassigned;
    if (this.diagnostics.ownership.isActiveProducer) {
      localOwnershipLabel = this.L.deviceDiagnosticsOwnershipActive;
    } else if (this.diagnostics.ownership.isStandbyProducer) {
      localOwnershipLabel = this.L.deviceDiagnosticsOwnershipStandby;
    } else if (this.diagnostics.ownership.isCompanion) {
      localOwnershipLabel = this.L.deviceDiagnosticsOwnershipCompanion;
    } else if (this.diagnostics.ownership.isUnclaimed) {
      localOwnershipLabel = this.L.deviceDiagnosticsOwnershipUnclaimed;
    }
    ownershipGrid.createDiv({ text: localOwnershipLabel });

    ownershipGrid.createDiv({ text: this.L.deviceDiagnosticsOwnershipGlobalProducerLabel, attr: { style: "font-weight: bold;" } });
    ownershipGrid.createDiv({ text: this.diagnostics.ownership.activeProducerId ?? this.L.deviceDiagnosticsOwnershipNone });

    ownershipGrid.createDiv({ text: this.L.deviceDiagnosticsOwnershipEpochLabel, attr: { style: "font-weight: bold;" } });
    ownershipGrid.createDiv({
      text:
        this.diagnostics.ownership.epoch !== undefined
          ? this.diagnostics.ownership.epoch.toString()
          : this.L.deviceDiagnosticsOwnershipNoEpoch,
    });

    if (this.diagnostics.ownership.reason) {
      ownershipGrid.createDiv({ text: this.L.deviceDiagnosticsOwnershipReasonLabel, attr: { style: "font-weight: bold;" } });
      ownershipGrid.createDiv({ text: this.diagnostics.ownership.reason });
    }

    // 3. Artifacts Section
    contentEl.createEl("h3", { text: this.L.deviceDiagnosticsSectionArtifacts });
    const artifactsContainer = contentEl.createDiv({
      attr: { style: "display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;" },
    });

    // A. Text Index
    this.renderArtifactCard(
      artifactsContainer,
      this.L.deviceDiagnosticsArtifactTextIndex,
      this.diagnostics.artifacts.index,
      this.diagnostics.artifacts.index.exists
        ? `${this.diagnostics.artifacts.index.totalNotes ?? 0} ${this.L.deviceDiagnosticsArtifactNotes}, ${this.diagnostics.artifacts.index.totalChunks ?? 0} ${this.L.deviceDiagnosticsArtifactChunks}`
        : this.L.deviceDiagnosticsArtifactManifestMissing
    );

    // B. Canonical Embeddings
    this.renderArtifactCard(
      artifactsContainer,
      this.L.deviceDiagnosticsArtifactEmbeddings,
      this.diagnostics.artifacts.embeddings,
      this.diagnostics.artifacts.embeddings.exists
        ? `${this.diagnostics.artifacts.embeddings.provider ?? "N/A"} / ${this.diagnostics.artifacts.embeddings.model ?? "N/A"} (${this.diagnostics.artifacts.embeddings.dimensions ?? 0}d)`
        : this.L.deviceDiagnosticsArtifactEmbeddingsMissing
    );

    // C. Binary Embeddings Copy
    this.renderArtifactCard(
      artifactsContainer,
      this.L.deviceDiagnosticsArtifactBinary,
      this.diagnostics.artifacts.binary,
      this.diagnostics.artifacts.binary.exists
        ? `${this.diagnostics.artifacts.binary.recordCount ?? 0} ${this.L.deviceDiagnosticsArtifactRecords} (${this.diagnostics.artifacts.binary.dimensions ?? 0}d)`
        : this.L.deviceDiagnosticsArtifactBinaryMissing
    );

    // D. Checkpoint (Optional)
    if (this.diagnostics.artifacts.checkpoint) {
      this.renderArtifactCard(
        artifactsContainer,
        this.L.deviceDiagnosticsArtifactCheckpoint,
        this.diagnostics.artifacts.checkpoint,
        `${this.diagnostics.artifacts.checkpoint.completedRecords ?? 0} ${this.L.deviceDiagnosticsArtifactCompletedRecords}`
      );
    }

    // 4. Footer & Close Button
    const footer = contentEl.createDiv({
      attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-top: 16px; border-top: 1px solid var(--background-modifier-border); padding-top: 12px;" },
    });

    footer.createDiv({
      text: this.L.deviceDiagnosticsFooterDesc,
      attr: { style: "font-size: 0.85em; color: var(--text-muted);" },
    });

    const closeBtn = footer.createEl("button", { text: this.L.deviceDiagnosticsCloseButton });
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
      text: `${this.L.deviceDiagnosticsArtifactDetailsLabel} ${details}`,
      attr: { style: "font-size: 0.9em; color: var(--text-muted); margin-bottom: 2px;" },
    });

    card.createDiv({
      text: `${this.L.deviceDiagnosticsArtifactProvenanceLabel} ${this.getLocalizedProvenanceMessage(artifact)}`,
      attr: { style: "font-size: 0.85em; color: var(--text-normal);" },
    });
  }

  private getLocalizedProvenanceMessage(artifact: DeviceDiagnosticsArtifactItem): string {
    const { validation } = artifact;
    switch (validation.status) {
      case "valid": {
        const deviceTemplate = validation.isProducedByLocalDevice
          ? this.L.deviceDiagnosticsProvValidLocal
          : this.L.deviceDiagnosticsProvValidActive;
        return deviceTemplate.replace("{epoch}", (validation.ownershipEpoch ?? 0).toString());
      }
      case "stale": {
        if (validation.reason === "producer-mismatch") {
          return this.L.deviceDiagnosticsProvStaleMismatch.replace(
            "{epoch}",
            (validation.artifactProvenance?.producerEpoch ?? 0).toString()
          );
        }
        return this.L.deviceDiagnosticsProvStaleEpoch
          .replace("{epoch}", (validation.artifactProvenance?.producerEpoch ?? 0).toString())
          .replace("{activeEpoch}", (validation.ownershipEpoch ?? 0).toString());
      }
      case "future": {
        return this.L.deviceDiagnosticsProvFuture
          .replace("{epoch}", (validation.artifactProvenance?.producerEpoch ?? 0).toString())
          .replace("{activeEpoch}", (validation.ownershipEpoch ?? 0).toString());
      }
      case "unknown":
      default: {
        if (validation.reason === "ownership-unavailable") {
          return this.L.deviceDiagnosticsProvNoOwnership;
        }
        if (validation.reason === "provenance-invalid") {
          return this.L.deviceDiagnosticsProvMalformed;
        }
        return this.L.deviceDiagnosticsProvLegacy;
      }
    }
  }

  private getStatusBadgeText(status: ArtifactProvenanceStatus): string {
    switch (status) {
      case "valid":
        return this.L.deviceDiagnosticsBadgeValid;
      case "stale":
        return this.L.deviceDiagnosticsBadgeStale;
      case "future":
        return this.L.deviceDiagnosticsBadgeFuture;
      case "unknown":
      default:
        return this.L.deviceDiagnosticsBadgeUnknown;
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
