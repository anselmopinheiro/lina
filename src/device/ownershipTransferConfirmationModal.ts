/**
 * Manual Ownership Transfer Confirmation Modal (Phase D2.5.4)
 *
 * Provides a user-facing confirmation dialog before executing an ownership transfer:
 * - Displays current state (active producer ID, current epoch).
 * - Displays new state (target producer ID, next epoch).
 * - Displays an explicit warning describing the scope and safety of the transfer:
 *     1. Publication authority for text & embedding index shifts to target device.
 *     2. Device roles (Role != Ownership) are not modified.
 *     3. No files or notes are deleted.
 * - Enforces explicit user confirmation via `confirmAndExecuteOwnershipTransfer`.
 * - Emits notifications and triggers refresh callbacks on success.
 */

import { App, Modal, Notice } from "obsidian";
import { OwnershipDataAdapter } from "./deviceOwnership";
import {
  OwnershipTransferPreview,
  confirmAndExecuteOwnershipTransfer,
  OwnershipTransferExecutionFailureReason,
} from "./ownershipTransferSafety";
import { getStrings, UiStrings } from "../i18n/strings";

export class OwnershipTransferConfirmationModal extends Modal {
  private readonly L: UiStrings;
  private isExecuting = false;

  constructor(
    app: App,
    private readonly preview: OwnershipTransferPreview,
    private readonly adapter: OwnershipDataAdapter,
    private readonly onTransferSuccess?: () => Promise<void> | void,
    strings?: UiStrings
  ) {
    super(app);
    this.L = strings ?? getStrings("pt-PT");
    if (typeof this.setTitle === "function") {
      this.setTitle(this.L.ownershipTransferModalTitle);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof contentEl.addClass === "function") {
      contentEl.addClass("lina-ownership-transfer-modal");
    }

    // 1. Current State Section
    contentEl.createEl("h4", { text: this.L.ownershipTransferCurrentSection });
    const currentGrid = contentEl.createDiv({
      attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 6px; margin-bottom: 14px; font-size: 0.9em;" },
    });
    currentGrid.createDiv({ text: this.L.ownershipTransferCurrentProducerLabel, attr: { style: "font-weight: bold;" } });
    currentGrid.createDiv({ text: this.preview.currentProducerId });
    currentGrid.createDiv({ text: this.L.ownershipTransferCurrentEpochLabel, attr: { style: "font-weight: bold;" } });
    currentGrid.createDiv({ text: this.preview.currentEpoch.toString() });

    // 2. New State Section
    contentEl.createEl("h4", { text: this.L.ownershipTransferNewSection });
    const newGrid = contentEl.createDiv({
      attr: { style: "display: grid; grid-template-columns: auto 1fr; gap: 6px; margin-bottom: 14px; font-size: 0.9em;" },
    });
    newGrid.createDiv({ text: this.L.ownershipTransferTargetDeviceLabel, attr: { style: "font-weight: bold;" } });
    newGrid.createDiv({ text: this.preview.targetProducerId });
    newGrid.createDiv({ text: this.L.ownershipTransferNextEpochLabel, attr: { style: "font-weight: bold;" } });
    newGrid.createDiv({ text: this.preview.nextEpoch.toString() });

    // 3. Safety Warning Callout
    const warningBox = contentEl.createDiv({
      attr: {
        style:
          "border-left: 4px solid var(--text-warning, #d97706); background: var(--background-secondary); padding: 10px 14px; border-radius: 4px; margin-bottom: 20px;",
      },
    });
    warningBox.createDiv({
      text: this.L.ownershipTransferWarningTitle,
      attr: { style: "font-weight: bold; margin-bottom: 4px; color: var(--text-warning, #d97706);" },
    });
    warningBox.createDiv({
      text: this.L.ownershipTransferWarningText,
      attr: { style: "font-size: 0.88em; line-height: 1.4; color: var(--text-normal);" },
    });

    // 4. Action Buttons
    const buttonRow = contentEl.createDiv({
      attr: { style: "display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;" },
    });

    const cancelBtn = buttonRow.createEl("button", { text: this.L.ownershipTransferCancelButton });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", {
      text: this.L.ownershipTransferConfirmButton,
    });
    if (typeof confirmBtn.addClass === "function") {
      confirmBtn.addClass("mod-warning");
    }
    confirmBtn.addEventListener("click", () => {
      void this.handleConfirm(confirmBtn);
    });
  }

  private async handleConfirm(confirmBtn: HTMLButtonElement): Promise<void> {
    if (this.isExecuting) return;
    this.isExecuting = true;
    confirmBtn.disabled = true;

    try {
      const result = await confirmAndExecuteOwnershipTransfer(this.adapter, this.preview, {
        confirmed: true,
      });

      if (result.success) {
        new Notice(this.L.ownershipTransferSuccessNotice);
        this.close();
        if (this.onTransferSuccess) {
          try {
            await this.onTransferSuccess();
          } catch (callbackError) {
            console.error("Lina: error in ownership transfer success callback:", callbackError);
          }
        }
      } else {
        const message = this.resolveFailureMessage(result.reason);
        new Notice(`${this.L.ownershipTransferErrorPrefix}: ${message}`);
        this.isExecuting = false;
        confirmBtn.disabled = false;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${this.L.ownershipTransferErrorPrefix}: ${msg}`);
      this.isExecuting = false;
      confirmBtn.disabled = false;
    }
  }

  private resolveFailureMessage(reason: OwnershipTransferExecutionFailureReason): string {
    switch (reason) {
      case "epoch-mismatch":
        return this.L.ownershipTransferErrorEpochMismatch;
      case "already-active-producer":
        return this.L.ownershipTransferErrorAlreadyActive;
      case "missing-ownership":
        return this.L.ownershipTransferErrorMissingOwnership;
      case "invalid-target-device":
        return this.L.ownershipTransferErrorInvalidTarget;
      case "confirmation-required":
        return this.L.ownershipTransferErrorConfirmationRequired;
      case "persistence-failure":
      case "invalid-preview":
      default:
        return this.L.ownershipTransferErrorGeneric;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
