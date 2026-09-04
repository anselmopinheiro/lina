/**
 * Device Role Change Confirmation Modal (Phase 0.2.2.X.1.7)
 *
 * Provides a user-facing confirmation dialog before executing a device-role change:
 * - Displays current role and target role.
 * - If the current device is the Active Producer and changing to Companion,
 *   displays a high-impact warning that shared index & embedding maintenance will halt.
 * - If Standby Producer changing to Companion, explains consumer mode.
 * - If Companion changing to Producer, explains that the device will maintain search assets,
 *   operating in standby if another Active Producer exists.
 * - Invokes safe role change execution on confirmation with proper feedback.
 */

import { App, Modal, Notice } from "obsidian";
import { DeviceRole } from "./deviceRole";
import { getStrings, UiStrings } from "../i18n/strings";

export interface DeviceRoleChangeModalOptions {
  readonly currentRole: DeviceRole;
  readonly targetRole: DeviceRole;
  readonly isActiveProducer: boolean;
  readonly onConfirm: (targetRole: DeviceRole) => Promise<void>;
  readonly strings?: UiStrings;
  readonly onSuccess?: () => void;
}

export class DeviceRoleChangeModal extends Modal {
  private readonly L: UiStrings;
  private isExecuting = false;

  constructor(
    app: App,
    private readonly options: DeviceRoleChangeModalOptions
  ) {
    super(app);
    this.L = options.strings ?? getStrings("pt-PT");
    if (typeof this.setTitle === "function") {
      this.setTitle(this.L.deviceRoleChangeModalTitle);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof contentEl.addClass === "function") {
      contentEl.addClass("lina-device-role-change-modal");
    }

    const { currentRole, targetRole, isActiveProducer } = this.options;

    // 1. Role Transition Summary
    const summaryGrid = contentEl.createDiv({
      attr: {
        style:
          "display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 16px; font-size: 0.95em;",
      },
    });

    const currentBadge = currentRole === "producer" ? "🟢" : "🔵";
    const currentTitle =
      currentRole === "producer"
        ? this.L.settingsDeviceProducerOption
        : this.L.settingsDeviceCompanionOption;

    const targetBadge = targetRole === "producer" ? "🟢" : "🔵";
    const targetTitle =
      targetRole === "producer"
        ? this.L.settingsDeviceProducerOption
        : this.L.settingsDeviceCompanionOption;

    summaryGrid.createDiv({
      text: `${this.L.deviceDiagnosticsDeviceRoleLabel} atual:`,
      attr: { style: "font-weight: bold;" },
    });
    summaryGrid.createDiv({ text: `${currentBadge} ${currentTitle}` });

    summaryGrid.createDiv({
      text: "Novo papel pretendido:",
      attr: { style: "font-weight: bold;" },
    });
    summaryGrid.createDiv({ text: `${targetBadge} ${targetTitle}` });

    // 2. Contextual Warning / Information Box
    if (currentRole === "producer" && targetRole === "companion") {
      if (isActiveProducer) {
        // High impact warning for Active Producer demotion
        const warningBox = contentEl.createDiv({
          attr: {
            style:
              "border-left: 4px solid var(--text-warning, #d97706); background: var(--background-secondary); padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;",
          },
        });
        warningBox.createEl("h4", {
          text: this.L.deviceRoleChangeActiveProducerWarningTitle,
          attr: {
            style: "margin-top: 0; margin-bottom: 8px; color: var(--text-warning, #d97706);",
          },
        });
        warningBox.createEl("p", {
          text: this.L.deviceRoleChangeActiveProducerWarning,
          attr: { style: "margin: 0; font-size: 0.9em; line-height: 1.4;" },
        });
      } else {
        // Standby Producer demotion notice
        const noticeBox = contentEl.createDiv({
          attr: {
            style:
              "border-left: 4px solid var(--interactive-accent, #3b82f6); background: var(--background-secondary); padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;",
          },
        });
        noticeBox.createEl("p", {
          text: this.L.deviceRoleChangeStandbyProducerNotice,
          attr: { style: "margin: 0; font-size: 0.9em; line-height: 1.4;" },
        });
      }
    } else if (currentRole === "companion" && targetRole === "producer") {
      // Companion -> Producer notice
      const noticeBox = contentEl.createDiv({
        attr: {
          style:
            "border-left: 4px solid var(--interactive-accent, #3b82f6); background: var(--background-secondary); padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;",
        },
      });
      noticeBox.createEl("p", {
        text: this.L.deviceRoleChangeToProducerNotice,
        attr: { style: "margin: 0; font-size: 0.9em; line-height: 1.4;" },
      });
    }

    // 3. Action Buttons
    const buttonsContainer = contentEl.createDiv({
      attr: {
        style: "display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;",
      },
    });

    const cancelButton = buttonsContainer.createEl("button", {
      text: this.L.deviceRoleChangeCancelButton,
    });
    cancelButton.addEventListener("click", () => {
      if (!this.isExecuting) {
        this.close();
      }
    });

    const confirmButtonText =
      targetRole === "companion"
        ? this.L.deviceRoleChangeToCompanionTitle
        : this.L.deviceRoleChangeToProducerTitle;

    const confirmButton = buttonsContainer.createEl("button", {
      text: confirmButtonText,
    });

    if (isActiveProducer && targetRole === "companion") {
      confirmButton.addClass("mod-warning");
    } else {
      confirmButton.addClass("mod-cta");
    }

    confirmButton.addEventListener("click", () => {
      void (async () => {
        if (this.isExecuting) {
          return;
        }
        this.isExecuting = true;
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        confirmButton.setText("...");

        try {
          await this.options.onConfirm(targetRole);
          new Notice(this.L.deviceRoleChangeSuccess);
          this.close();
          this.options.onSuccess?.();
        } catch (error) {
          this.isExecuting = false;
          confirmButton.disabled = false;
          cancelButton.disabled = false;
          confirmButton.setText(confirmButtonText);
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`${this.L.deviceRoleChangeError}: ${message}`);
        }
      })();
    });
  }
}
