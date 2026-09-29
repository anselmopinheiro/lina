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

import { App, Modal, Notice } from "obsidian";
import {
  DeviceDiagnostics,
  DeviceDiagnosticsArtifactItem,
  readDeviceDiagnostics,
} from "./deviceDiagnostics";
import { ArtifactProvenanceStatus } from "./artifactProvenanceValidation";
import { OwnershipRecoveryStatus } from "./ownershipRecoveryDiagnostics";
import { OwnershipDataAdapter } from "./deviceOwnership";
import { prepareOwnershipTransferPreview } from "./ownershipTransferSafety";
import { OwnershipTransferConfirmationModal } from "./ownershipTransferConfirmationModal";
import { getStrings, UiStrings } from "../i18n/strings";

export interface DeviceDiagnosticsMaintenanceActions {
  canExecuteMaintenance: boolean;
  onRebuildTextIndex?: () => Promise<void>;
  onUpdateEmbeddings?: () => Promise<void>;
  isRebuildingIndex?: boolean;
  isGeneratingEmbeddings?: boolean;
  gatingNotice?: string;
}

export class DeviceDiagnosticsModal extends Modal {
  private readonly L: UiStrings;
  private diagnostics: DeviceDiagnostics;
  private readonly adapter?: OwnershipDataAdapter;
  private readonly onRefreshRequested?: () => Promise<DeviceDiagnostics> | DeviceDiagnostics;
  private readonly maintenance?: DeviceDiagnosticsMaintenanceActions;

  constructor(
    app: App,
    diagnostics: DeviceDiagnostics,
    strings?: UiStrings,
    adapter?: OwnershipDataAdapter,
    onRefreshRequested?: () => Promise<DeviceDiagnostics> | DeviceDiagnostics,
    maintenance?: DeviceDiagnosticsMaintenanceActions
  ) {
    super(app);
    this.diagnostics = diagnostics;
    this.L = strings ?? getStrings("pt-PT");
    this.adapter = adapter;
    this.onRefreshRequested = onRefreshRequested;
    this.maintenance = maintenance;
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
    let roleLabel = this.L.deviceDiagnosticsRoleUnassigned;
    if (this.diagnostics.device.assignmentState === "legacy-fallback") {
      roleLabel =
        this.diagnostics.device.effectiveRole === "producer"
          ? this.L.deviceDiagnosticsRoleLegacyProducer
          : this.L.deviceDiagnosticsRoleLegacyCompanion;
    } else if (this.diagnostics.device.assignmentState === "assigned") {
      roleLabel =
        this.diagnostics.device.effectiveRole === "producer"
          ? this.L.deviceDiagnosticsRoleAssignedProducer
          : this.L.deviceDiagnosticsRoleAssignedCompanion;
    } else if (this.diagnostics.device.role === "producer") {
      roleLabel = this.L.deviceDiagnosticsRoleProducer;
    } else if (this.diagnostics.device.role === "companion") {
      roleLabel = this.L.deviceDiagnosticsRoleCompanion;
    }
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

    if (this.diagnostics.transfer) {
      ownershipGrid.createDiv({ text: this.L.deviceDiagnosticsTransferReadinessLabel, attr: { style: "font-weight: bold;" } });
      const transferCell = ownershipGrid.createDiv({
        attr: { style: "display: flex; align-items: center; justify-content: space-between; gap: 8px;" },
      });

      let transferLabel = this.L.deviceDiagnosticsTransferUnassigned;
      if (this.diagnostics.transfer.canTransferOwnership) {
        transferLabel = this.L.deviceDiagnosticsTransferEligible;
      } else if (this.diagnostics.transfer.isLocalActiveProducer) {
        transferLabel = this.L.deviceDiagnosticsTransferCurrentOwner;
      } else if (this.diagnostics.transfer.eligibilityReason === "missing-ownership") {
        transferLabel = this.L.deviceDiagnosticsTransferNoOwnership;
      } else if (this.diagnostics.transfer.eligibilityReason === "companion-role") {
        transferLabel = this.L.deviceDiagnosticsTransferCompanion;
      } else if (this.diagnostics.transfer.eligibilityReason === "unassigned-role") {
        transferLabel = this.L.deviceDiagnosticsTransferUnassigned;
      }
      transferCell.createSpan({ text: transferLabel });

      if (this.diagnostics.transfer.canTransferOwnership && this.adapter) {
        const transferBtn = transferCell.createEl("button", {
          text: this.L.deviceDiagnosticsTransferButton,
        });
        if (typeof transferBtn.addClass === "function") {
          transferBtn.addClass("mod-warning");
        }
        transferBtn.addEventListener("click", () => {
          void this.handleTransferClick();
        });
      }
    }

    // 3. Ownership Recovery Section (Phase D2.5.7)
    if (this.diagnostics.recovery) {
      contentEl.createEl("h3", { text: this.L.deviceDiagnosticsSectionRecovery });
      const recoveryGrid = contentEl.createDiv({
        attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" },
      });

      recoveryGrid.createDiv({ text: this.L.deviceDiagnosticsRecoveryStatusLabel, attr: { style: "font-weight: bold;" } });
      const statusCell = recoveryGrid.createDiv({
        attr: { style: "display: flex; align-items: center; gap: 8px;" },
      });
      statusCell.createSpan({
        attr: {
          style:
            "padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold;" +
            this.getRecoveryStatusBadgeStyle(this.diagnostics.recovery.status),
        },
        text: this.getRecoveryStatusBadgeText(this.diagnostics.recovery.status),
      });

      recoveryGrid.createDiv({ text: this.L.deviceDiagnosticsRecoveryManifestEpochLabel, attr: { style: "font-weight: bold;" } });
      recoveryGrid.createDiv({
        text:
          this.diagnostics.recovery.currentEpoch !== undefined
            ? this.diagnostics.recovery.currentEpoch.toString()
            : this.L.deviceDiagnosticsOwnershipNoEpoch,
      });

      recoveryGrid.createDiv({ text: this.L.deviceDiagnosticsRecoveryAuditEpochLabel, attr: { style: "font-weight: bold;" } });
      recoveryGrid.createDiv({
        text:
          this.diagnostics.recovery.latestAuditEpoch !== undefined
            ? this.diagnostics.recovery.latestAuditEpoch.toString()
            : this.L.deviceDiagnosticsOwnershipNoEpoch,
      });

      recoveryGrid.createDiv({ text: this.L.deviceDiagnosticsRecoveryLastProducerLabel, attr: { style: "font-weight: bold;" } });
      recoveryGrid.createDiv({
        text: this.diagnostics.recovery.lastKnownProducerId ?? this.L.deviceDiagnosticsOwnershipNone,
      });

      recoveryGrid.createDiv({ text: this.L.deviceDiagnosticsRecoveryTotalEventsLabel, attr: { style: "font-weight: bold;" } });
      recoveryGrid.createDiv({
        text: this.diagnostics.recovery.totalAuditEvents.toString(),
      });

      if (this.diagnostics.recovery.warnings && this.diagnostics.recovery.warnings.length > 0) {
        recoveryGrid.createDiv({ text: this.L.deviceDiagnosticsRecoveryWarningsLabel, attr: { style: "font-weight: bold;" } });
        const warningsList = recoveryGrid.createEl("ul", {
          attr: { style: "margin: 0; padding-left: 20px; color: var(--text-warning);" },
        });
        for (const warning of this.diagnostics.recovery.warnings) {
          warningsList.createEl("li", { text: warning });
        }
      }
    }

    // 4. Search Capability / Companion Search Section (Phase 0.4.2.1 / LINA-03)
    if (this.diagnostics.companionSearch) {
      const isProducer = this.diagnostics.ownership?.isActiveProducer || this.diagnostics.transfer?.isLocalActiveProducer || this.diagnostics.device?.effectiveRole === "producer";
      const sectionTitle = isProducer
        ? this.L.deviceDiagnosticsSectionSearchCapability
        : this.L.deviceDiagnosticsSectionCompanionSearch;
      contentEl.createEl("h3", { text: sectionTitle });
      const compGrid = contentEl.createDiv({
        attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px;" },
      });

      // Status
      compGrid.createDiv({ text: this.L.deviceDiagnosticsCompanionStatusLabel, attr: { style: "font-weight: bold;" } });
      const compStatusCell = compGrid.createDiv({
        attr: { style: "display: flex; align-items: center; gap: 8px;" },
      });
      const runtimeEmbeddings = this.diagnostics.runtime?.embeddings;
      const effectiveDisplayMode = runtimeEmbeddings?.effectiveMode
        ?? this.diagnostics.companionSearch.operationalMode
        ?? this.diagnostics.companionSearch.mode;
      const isSearchAvailable = runtimeEmbeddings
        ? (runtimeEmbeddings.effectiveMode !== "unavailable")
        : this.diagnostics.companionSearch.available;

      compStatusCell.createSpan({
        attr: {
          style:
            "padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold;" +
            this.getCompanionStatusBadgeStyle(isSearchAvailable),
        },
        text: isSearchAvailable
          ? this.L.deviceDiagnosticsCompanionStatusAvailable
          : this.L.deviceDiagnosticsCompanionStatusUnavailable,
      });

      // Mode (reflects operational search capability)
      compGrid.createDiv({ text: this.L.deviceDiagnosticsCompanionModeLabel, attr: { style: "font-weight: bold;" } });
      compGrid.createDiv({ text: this.getCompanionModeLabel(effectiveDisplayMode) });

      // Artifacts (reflects published artifacts)
      compGrid.createDiv({ text: this.L.deviceDiagnosticsCompanionArtifactsLabel, attr: { style: "font-weight: bold;" } });
      const artifactsList = [];
      const hasTextIndex = runtimeEmbeddings ? runtimeEmbeddings.textIndexAvailable : this.diagnostics.companionSearch.textIndexAvailable;
      const hasEmbeddings = runtimeEmbeddings
        ? runtimeEmbeddings.semanticAvailable
        : Boolean(this.diagnostics.companionSearch.operationalSemanticAvailable ?? this.diagnostics.companionSearch.embeddingsAvailable);

      if (hasTextIndex) {
        artifactsList.push(this.L.deviceDiagnosticsCompanionTextIndexAvailable);
      } else {
        artifactsList.push(this.L.deviceDiagnosticsCompanionTextIndexMissing);
      }
      if (hasEmbeddings) {
        artifactsList.push(this.L.deviceDiagnosticsCompanionEmbeddingsAvailable);
      } else {
        artifactsList.push(this.L.deviceDiagnosticsCompanionEmbeddingsMissing);
      }
      compGrid.createDiv({ text: artifactsList.join(" • ") });

      // Reason (if any)
      const displayReason = runtimeEmbeddings?.reason
        || this.diagnostics.companionSearch.operationalReason
        || this.diagnostics.companionSearch.reason;
      if (displayReason) {
        compGrid.createDiv({ text: this.L.deviceDiagnosticsCompanionReasonLabel, attr: { style: "font-weight: bold;" } });
        compGrid.createDiv({ text: displayReason });
      }
    }

    // 5. Artifacts Section
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

    // 6. Maintenance Section
    if (this.maintenance) {
      contentEl.createEl("h3", { text: this.L.deviceDiagnosticsSectionMaintenance ?? "Manutenção" });
      const maintenanceContainer = contentEl.createDiv({
        attr: { style: "display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;" },
      });

      if (this.maintenance.canExecuteMaintenance) {
        const actionsRow = maintenanceContainer.createDiv({
          attr: { style: "display: flex; flex-wrap: wrap; gap: 8px;" },
        });

        if (this.maintenance.onRebuildTextIndex) {
          const rebuildBtn = actionsRow.createEl("button", {
            text: this.L.deviceDiagnosticsMaintenanceRebuildIndex ?? this.L.btnRebuildIndex,
          });
          rebuildBtn.disabled = this.maintenance.isRebuildingIndex ?? false;
          rebuildBtn.addEventListener("click", () => {
            void (async () => {
              try {
                if (this.maintenance?.onRebuildTextIndex) {
                  await this.maintenance.onRebuildTextIndex();
                  if (this.onRefreshRequested) {
                    this.diagnostics = await this.onRefreshRequested();
                  }
                  this.onOpen();
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new Notice(`${this.L.mainNoticeRebuildTextIndexErrorPrefix}. ${msg}`);
              }
            })();
          });
        }

        if (this.maintenance.onUpdateEmbeddings) {
          const updateEmbeddingsBtn = actionsRow.createEl("button", {
            text: this.L.deviceDiagnosticsMaintenanceUpdateEmbeddings ?? this.L.btnUpdateEmbeddings,
          });
          updateEmbeddingsBtn.disabled = this.maintenance.isGeneratingEmbeddings ?? false;
          updateEmbeddingsBtn.addEventListener("click", () => {
            void (async () => {
              try {
                if (this.maintenance?.onUpdateEmbeddings) {
                  await this.maintenance.onUpdateEmbeddings();
                  if (this.onRefreshRequested) {
                    this.diagnostics = await this.onRefreshRequested();
                  }
                  this.onOpen();
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new Notice(`${this.L.mainNoticeGenerateEmbeddingsErrorPrefix}. ${msg}`);
              }
            })();
          });
        }
      } else {
        const notice = maintenanceContainer.createDiv({
          attr: {
            style: "padding: 8px 12px; border-radius: 4px; background: var(--background-secondary); border: 1px dashed var(--background-modifier-border); font-size: 0.9em; color: var(--text-muted);",
          },
        });
        const noticeText = this.maintenance.gatingNotice || this.L.sidebarMaintenanceManagedByActiveProducer;
        notice.createSpan({ text: `ℹ️ ${noticeText}` });
      }
    }

    // 7. Footer & Close Button
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

    header.createSpan({
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
      case "stale":
        return this.L.deviceDiagnosticsBadgeValid;
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
      case "stale":
        return "background-color: var(--background-modifier-success); color: var(--text-on-accent);";
      case "future":
        return "background-color: var(--text-accent); color: var(--text-on-accent);";
      case "unknown":
      default:
        return "background-color: var(--background-modifier-border); color: var(--text-muted);";
    }
  }

  private getRecoveryStatusBadgeText(status: OwnershipRecoveryStatus): string {
    switch (status) {
      case "healthy":
        return this.L.deviceDiagnosticsRecoveryStatusHealthy;
      case "missing-manifest":
        return this.L.deviceDiagnosticsRecoveryStatusMissingManifest;
      case "missing-history":
        return this.L.deviceDiagnosticsRecoveryStatusMissingHistory;
      case "history-ahead-of-manifest":
        return this.L.deviceDiagnosticsRecoveryStatusHistoryAhead;
      case "epoch-inconsistency":
        return this.L.deviceDiagnosticsRecoveryStatusEpochInconsistency;
      case "unknown":
      default:
        return this.L.deviceDiagnosticsRecoveryStatusUnknown;
    }
  }

  private getRecoveryStatusBadgeStyle(status: OwnershipRecoveryStatus): string {
    switch (status) {
      case "healthy":
        return "background-color: var(--background-modifier-success); color: var(--text-on-accent);";
      case "missing-history":
      case "missing-manifest":
        return "background-color: var(--background-modifier-warning); color: var(--text-normal);";
      case "history-ahead-of-manifest":
      case "epoch-inconsistency":
        return "background-color: var(--background-modifier-error); color: var(--text-on-accent);";
      case "unknown":
      default:
        return "background-color: var(--background-modifier-border); color: var(--text-muted);";
    }
  }

  private getCompanionModeLabel(mode: "full" | "text-only" | "degraded" | "unavailable"): string {
    switch (mode) {
      case "full":
        return this.L.deviceDiagnosticsCompanionModeFull;
      case "text-only":
        return this.L.deviceDiagnosticsCompanionModeTextOnly;
      case "degraded":
        return this.L.deviceDiagnosticsCompanionModeDegraded;
      case "unavailable":
      default:
        return this.L.deviceDiagnosticsCompanionModeUnavailable;
    }
  }

  private getCompanionStatusBadgeStyle(available: boolean): string {
    if (available) {
      return "background-color: var(--background-modifier-success); color: var(--text-on-accent);";
    }
    return "background-color: var(--background-modifier-border); color: var(--text-muted);";
  }

  private async handleTransferClick(): Promise<void> {
    if (!this.adapter) return;

    try {
      const previewResult = await prepareOwnershipTransferPreview(this.adapter, this.diagnostics.device.id);
      if (!previewResult.success) {
        new Notice(`${this.L.ownershipTransferErrorPrefix}: ${previewResult.reason}`);
        return;
      }

      const modal = new OwnershipTransferConfirmationModal(
        this.app,
        previewResult.preview,
        this.adapter,
        async () => {
          if (this.onRefreshRequested) {
            this.diagnostics = await this.onRefreshRequested();
          } else if (this.adapter) {
            this.diagnostics = await readDeviceDiagnostics(this.adapter, this.diagnostics.device.id);
          }
          this.onOpen();
        },
        this.L
      );
      modal.open();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${this.L.ownershipTransferErrorPrefix}: ${msg}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
