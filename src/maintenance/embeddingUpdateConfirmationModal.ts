/**
 * Embedding Update Confirmation Modal (Phase 0.2.2.3)
 *
 * User confirmation UI requesting explicit user authorization before
 * executing embedding updates.
 *
 * Architectural Invariant:
 * - UI only; zero generation logic, zero worker invocation, zero network requests inside the modal.
 * - Resolves a boolean promise reflecting user authorization.
 */

import { App, Modal } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import { getStrings } from "../i18n/strings";
import type { EmbeddingUpdateConfirmationRequest } from "./embeddingUpdateConfirmation";

export class EmbeddingUpdateConfirmationModal extends Modal {
  private readonly L: UiStrings;
  private settled = false;
  private resolvePromise?: (confirmed: boolean) => void;

  constructor(
    app: App,
    private readonly request: EmbeddingUpdateConfirmationRequest,
    strings?: UiStrings,
  ) {
    super(app);
    this.L = strings ?? getStrings("pt-PT");
    if (typeof this.setTitle === "function") {
      this.setTitle(this.L.confirmEmbeddingUpdateModalTitle);
    }
  }

  /**
   * Opens the confirmation modal and returns a promise that resolves
   * to true if confirmed by the user, or false if cancelled.
   */
  openModal(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof contentEl.addClass === "function") {
      contentEl.addClass("lina-embedding-confirmation-modal");
    }

    // 1. Provider & Model Identity Section
    const infoGrid = contentEl.createDiv({
      attr: {
        style: "display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; margin-bottom: 16px; font-size: 0.9em;",
      },
    });

    infoGrid.createDiv({ text: this.L.confirmEmbeddingUpdateProviderLabel, attr: { style: "font-weight: bold;" } });
    infoGrid.createDiv({ text: this.request.providerId });

    if (this.request.modelName) {
      infoGrid.createDiv({ text: this.L.confirmEmbeddingUpdateModelLabel, attr: { style: "font-weight: bold;" } });
      infoGrid.createDiv({ text: this.request.modelName });
    }

    // 2. Scope of Work Section
    contentEl.createEl("h4", {
      text: this.L.confirmEmbeddingUpdateScopeLabel,
      attr: { style: "margin: 12px 0 6px 0; font-size: 0.95em;" },
    });

    const scopeList = contentEl.createEl("ul", {
      attr: { style: "margin: 4px 0 14px 20px; padding: 0; font-size: 0.9em; line-height: 1.5;" },
    });

    if (this.request.isFullRebuild) {
      scopeList.createEl("li", {
        text: this.L.confirmEmbeddingUpdateFullRebuildNotice,
        attr: { style: "font-weight: bold; color: var(--text-warning, #d97706);" },
      });
    }

    if (this.request.missingCount > 0) {
      scopeList.createEl("li", {
        text: this.L.confirmEmbeddingUpdateToGenerate.replace("{count}", String(this.request.missingCount)),
      });
    }

    if (this.request.staleCount > 0) {
      scopeList.createEl("li", {
        text: this.L.confirmEmbeddingUpdateStaleToReplace.replace("{count}", String(this.request.staleCount)),
      });
    }

    if (this.request.missingCount === 0 && this.request.staleCount === 0 && this.request.totalToGenerate > 0) {
      scopeList.createEl("li", {
        text: this.L.confirmEmbeddingUpdateToGenerate.replace("{count}", String(this.request.totalToGenerate)),
      });
    }

    // 3. Search Impact
    const impactBox = contentEl.createDiv({
      attr: { style: "margin-bottom: 14px; font-size: 0.88em; color: var(--text-muted);" },
    });
    const impactText =
      this.request.semanticSearchImpact === "unavailable"
        ? this.L.embeddingExplanationImpactUnavailable
        : this.L.embeddingExplanationImpactPartial;
    impactBox.createSpan({ text: `${this.L.confirmEmbeddingUpdateImpactLabel} `, attr: { style: "font-weight: bold;" } });
    impactBox.createSpan({ text: impactText });

    // 4. API Cost Warning Callout
    if (this.request.hasExternalCost) {
      const warningBox = contentEl.createDiv({
        attr: {
          style:
            "border-left: 4px solid var(--text-warning, #d97706); background: var(--background-secondary); padding: 10px 14px; border-radius: 4px; margin-bottom: 20px;",
        },
      });
      warningBox.createDiv({
        text: this.L.confirmEmbeddingUpdateCostWarningTitle,
        attr: { style: "font-weight: bold; margin-bottom: 4px; color: var(--text-warning, #d97706);" },
      });
      warningBox.createDiv({
        text: this.request.costWarningMessage ?? this.L.confirmEmbeddingUpdateCostWarningText.replace("{provider}", this.request.providerId),
        attr: { style: "font-size: 0.88em; line-height: 1.4; color: var(--text-normal);" },
      });
    } else {
      const infoBox = contentEl.createDiv({
        attr: {
          style:
            "border-left: 4px solid var(--interactive-accent, #7c3aed); background: var(--background-secondary); padding: 8px 12px; border-radius: 4px; margin-bottom: 20px;",
        },
      });
      infoBox.createDiv({
        text: this.request.costWarningMessage ?? this.L.confirmEmbeddingUpdateLocalNoCost,
        attr: { style: "font-size: 0.88em; color: var(--text-normal);" },
      });
    }

    // 5. Action Buttons
    const buttonRow = contentEl.createDiv({
      attr: { style: "display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;" },
    });

    const cancelBtn = buttonRow.createEl("button", {
      text: this.L.confirmEmbeddingUpdateButtonCancel,
    });
    cancelBtn.addEventListener("click", () => {
      this.settle(false);
    });

    const confirmBtn = buttonRow.createEl("button", {
      text: this.L.confirmEmbeddingUpdateButtonConfirm,
    });
    if (typeof confirmBtn.addClass === "function") {
      confirmBtn.addClass(this.request.hasExternalCost ? "mod-warning" : "mod-cta");
    }
    confirmBtn.addEventListener("click", () => {
      this.settle(true);
    });
  }

  private settle(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.resolvePromise?.(confirmed);
  }

  onClose(): void {
    this.settle(false);
    this.contentEl.empty();
  }
}
