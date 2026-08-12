import type { Setting, SettingGroup } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import type {
  ConnectionCredentialBindings,
  ConnectionCredentialBindingsState,
  ConnectionCredentialDomain,
  SafeConnectionFeedback,
  SafeCredentialFeedback,
} from "./declarativeSettingsConnectionCredentialBindings";
import type { CredentialDomain } from "./pureCredentialModel";

export type DeclarativeConnectionCredentialRenderer = (
  setting: Setting,
  group: SettingGroup,
) => void | (() => void);

export interface DeclarativeConnectionCredentialAction {
  run(): void;
  isDisabled(): boolean;
}

export interface DeclarativeSettingsConnectionCredentialRenderersOptions {
  bindings: ConnectionCredentialBindings;
  strings: UiStrings;
  ownerPrefix: string;
}

export interface DeclarativeSettingsConnectionCredentialRenderersDiagnosticSnapshot {
  readonly owners: readonly string[];
  readonly registeredCleanupCount: number;
  readonly rendererCount: number;
  readonly actionCount: number;
  readonly disposed: boolean;
  readonly readiness: "READY" | "DISPOSED";
  readonly state: ConnectionCredentialBindingsState;
}

export interface DeclarativeSettingsConnectionCredentialRenderers {
  createAnalysisCredentialRenderer(): DeclarativeConnectionCredentialRenderer;
  createEmbeddingsCredentialRenderer(): DeclarativeConnectionCredentialRenderer;
  createAnalysisConnectionAction(): DeclarativeConnectionCredentialAction;
  createEmbeddingsConnectionAction(): DeclarativeConnectionCredentialAction;
  createAnalysisFeedbackRenderer(): DeclarativeConnectionCredentialRenderer;
  createEmbeddingsFeedbackRenderer(): DeclarativeConnectionCredentialRenderer;
  getDiagnosticSnapshot(): DeclarativeSettingsConnectionCredentialRenderersDiagnosticSnapshot;
  dispose(): void;
}

type CredentialControl = { setDisabled(disabled: boolean): unknown };

const domainLabel = (domain: ConnectionCredentialDomain): "analysis" | "embeddings" => domain;

function credentialStatusText(strings: UiStrings, feedback: SafeCredentialFeedback): string {
  const availability = feedback.available ? strings.settingsApiKeyLocalSaved : strings.settingsCredentialNotStored;
  return `${strings.settingsCredentialStatus}: ${availability}`;
}

function credentialFeedbackText(strings: UiStrings, feedback: SafeCredentialFeedback): string {
  switch (feedback.status) {
    case "saving": return strings.settingsCredentialSaving;
    case "clearing": return strings.settingsCredentialClearing;
    case "success": return feedback.operation === "clear"
      ? strings.settingsCredentialClearSuccess
      : strings.settingsCredentialSaveSuccess;
    case "error": return strings.settingsCredentialOperationError;
    case "absent":
    case "stored": return "";
  }
}

function connectionFeedbackText(
  strings: UiStrings,
  domain: ConnectionCredentialDomain,
  feedback: SafeConnectionFeedback,
): string {
  if (feedback.status === "idle") return "";
  if (feedback.status === "pending") return strings.settingsTestingConnection;
  if (feedback.status === "success") return strings.settingsConnectionSuccess;

  switch (feedback.messageKey) {
    case "analysis-api-key-missing": return strings.settingsApiKeyMissing;
    case "embeddings-api-key-missing": return strings.settingsEmbeddingTestMistralApiKeyMissing;
    case "embedding-test-failed": return strings.settingsEmbeddingTestFailed;
    case "connection-failed": return domain === "embeddings"
      ? strings.settingsEmbeddingTestFailed
      : strings.settingsConnectionFailed;
    case "connection-success": return strings.settingsConnectionSuccess;
    default: return domain === "embeddings"
      ? strings.settingsEmbeddingTestFailed
      : strings.settingsConnectionFailed;
  }
}

/**
 * Candidate-only renderer factory. It owns ephemeral renderer drafts, while
 * connection testing and credential mutation remain owned by the injected binding.
 */
export function createDeclarativeSettingsConnectionCredentialRenderers(
  options: DeclarativeSettingsConnectionCredentialRenderersOptions,
): DeclarativeSettingsConnectionCredentialRenderers {
  let disposed = false;
  let rendererCount = 0;
  let actionCount = 0;
  let nextRendererId = 0;
  const registeredCleanups = new Map<string, { owner: string; id: string }>();

  const ownerFor = (domain: CredentialDomain): string => `${options.ownerPrefix}-credential-${domain}`;
  const currentCredential = (domain: CredentialDomain): SafeCredentialFeedback =>
    options.bindings.getState()[domainLabel(domain)].credential;
  const currentConnection = (domain: ConnectionCredentialDomain): SafeConnectionFeedback =>
    options.bindings.getState()[domain].connection;

  const createCredentialRenderer = (domain: CredentialDomain): DeclarativeConnectionCredentialRenderer => {
    rendererCount += 1;
    return (setting, _group) => {
      if (disposed) return;

      let draft = "";
      let rendererDisposed = false;
      const cleanupId = `renderer-${nextRendererId += 1}`;
      const cleanupOwner = ownerFor(domain);
      const cleanupKey = `${cleanupOwner}/${cleanupId}`;
      const controls: CredentialControl[] = [];
      let draftInput: { setValue(value: string): unknown; inputEl: HTMLInputElement } | undefined;

      const cleanup = (): void => {
        if (rendererDisposed) return;
        rendererDisposed = true;
        draft = "";
        draftInput?.setValue("");
        registeredCleanups.delete(cleanupKey);
      };

      const getFeedback = (): SafeCredentialFeedback => currentCredential(domain);
      const applyState = (): void => {
        const feedback = getFeedback();
        statusEl.setText(credentialStatusText(options.strings, feedback));
        feedbackEl.setText(credentialFeedbackText(options.strings, feedback));
        const pending = feedback.status === "saving" || feedback.status === "clearing";
        for (const control of controls) {
          control.setDisabled(pending || control === controls[0] && draft.trim().length === 0);
        }
      };

      setting.setName(options.strings.settingsApiKey).setDesc(options.strings.settingsApiKeyDescription);
      const statusEl = setting.descEl.createEl("p", { text: "" });
      const feedbackEl = setting.descEl.createEl("p", { text: "", attr: { "aria-live": "polite" } });

      setting.addText((text) => {
        draftInput = text;
        text
          .setPlaceholder(currentCredential(domain).available
            ? options.strings.settingsApiKeyLocalSaved
            : options.strings.settingsApiKeyPlaceholder)
          .setValue("")
          .onChange((value) => {
            if (rendererDisposed || disposed) return;
            draft = value;
            applyState();
          });
        text.inputEl.type = "password";
      });

      setting.addButton((button) => {
        controls.push(button);
        button
          .setButtonText(options.strings.settingsCredentialSave)
          .setCta()
          .onClick(() => {
            if (disposed || rendererDisposed || draft.trim().length === 0) return;
            void options.bindings.saveCredential(domain, draft, () => {
              if (disposed || rendererDisposed) return;
              draft = "";
              draftInput?.setValue("");
            }).then(() => {
              if (!disposed && !rendererDisposed) applyState();
            }, () => {
              if (!disposed && !rendererDisposed) applyState();
            });
          });
      });

      if (currentCredential(domain).available) {
        setting.addButton((button) => {
          controls.push(button);
          button
            .setButtonText(options.strings.settingsCredentialClear)
            .setDestructive()
            .onClick(() => {
              if (disposed || rendererDisposed) return;
              void options.bindings.clearCredential(domain).then(() => {
                if (!disposed && !rendererDisposed) applyState();
              }, () => {
                if (!disposed && !rendererDisposed) applyState();
              });
            });
        });
      }

      applyState();
      if (options.bindings.registerCleanup(cleanupOwner, cleanupId, cleanup)) {
        registeredCleanups.set(cleanupKey, { owner: cleanupOwner, id: cleanupId });
      } else {
        cleanup();
      }
      return () => {
        if (!options.bindings.removeCleanup(cleanupOwner, cleanupId)) cleanup();
      };
    };
  };

  const createConnectionAction = (domain: ConnectionCredentialDomain): DeclarativeConnectionCredentialAction => {
    actionCount += 1;
    return {
      run() {
        if (disposed || currentConnection(domain).status === "pending") return;
        void options.bindings.runConnectionTest(domain);
      },
      isDisabled() {
        return disposed || currentConnection(domain).status === "pending";
      },
    };
  };

  const createFeedbackRenderer = (domain: ConnectionCredentialDomain): DeclarativeConnectionCredentialRenderer => {
    rendererCount += 1;
    return (setting, _group) => {
      if (disposed) return;
      setting.setName(domain === "analysis"
        ? options.strings.settingsTestConnection
        : options.strings.settingsTestEmbeddingsConnection);
      setting.descEl.createEl("p", {
        text: connectionFeedbackText(options.strings, domain, currentConnection(domain)),
        attr: { "aria-live": "polite" },
      });
    };
  };

  return {
    createAnalysisCredentialRenderer: () => createCredentialRenderer("analysis"),
    createEmbeddingsCredentialRenderer: () => createCredentialRenderer("embeddings"),
    createAnalysisConnectionAction: () => createConnectionAction("analysis"),
    createEmbeddingsConnectionAction: () => createConnectionAction("embeddings"),
    createAnalysisFeedbackRenderer: () => createFeedbackRenderer("analysis"),
    createEmbeddingsFeedbackRenderer: () => createFeedbackRenderer("embeddings"),
    getDiagnosticSnapshot() {
      const state = options.bindings.getState();
      return {
        owners: [...new Set([...registeredCleanups.values()].map(({ owner }) => owner))],
        registeredCleanupCount: registeredCleanups.size,
        rendererCount,
        actionCount,
        disposed,
        readiness: disposed ? "DISPOSED" : "READY",
        state,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { owner, id } of [...registeredCleanups.values()]) {
        if (!options.bindings.removeCleanup(owner, id)) continue;
      }
      registeredCleanups.clear();
    },
  };
}
