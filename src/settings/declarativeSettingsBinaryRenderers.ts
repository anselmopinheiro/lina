import type { Setting, SettingGroup } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import type {
  DeclarativeBinarySnapshot,
  DeclarativeSettingsBinaryBindings,
} from "./declarativeSettingsBinaryBindings";
import {
  getPureBinaryStatusText,
  type PureBinaryStatusStrings,
} from "./pureSettingsAsyncActions";

export type DeclarativeBinaryStatusRenderer = (
  setting: Setting,
  group: SettingGroup,
) => void;

export type DeclarativeBinaryRemoveRenderer = (
  setting: Setting,
  group: SettingGroup,
) => void;

export interface DeclarativeBinaryAction {
  run(): void;
  isDisabled(): boolean;
}

export interface DeclarativeSettingsBinaryRenderersOptions {
  bindings: DeclarativeSettingsBinaryBindings;
  strings: UiStrings;
  ownerPrefix: string;
}

export interface DeclarativeSettingsBinaryRenderersDiagnosticSnapshot {
  readonly ownerIds: readonly string[];
  readonly rendererCount: number;
  readonly actionCount: number;
  readonly disposed: boolean;
  readonly readiness: "READY" | "DISPOSED";
  readonly state: DeclarativeBinarySnapshot;
}

export interface DeclarativeSettingsBinaryRenderers {
  createBinaryStatusRenderer(): DeclarativeBinaryStatusRenderer;
  createCheckBinaryAction(): DeclarativeBinaryAction;
  createCreateOrUpdateBinaryAction(): DeclarativeBinaryAction;
  createRemoveBinaryAction(): DeclarativeBinaryAction;
  createRemoveBinaryRenderer(removeAction: DeclarativeBinaryAction): DeclarativeBinaryRemoveRenderer;
  getDiagnosticSnapshot(): DeclarativeSettingsBinaryRenderersDiagnosticSnapshot;
  dispose(): void;
}

function statusStrings(strings: UiStrings): PureBinaryStatusStrings {
  return {
    copyState: strings.settingsBinaryCopyState,
    notChecked: strings.settingsBinaryStatusNotChecked,
    disabled: strings.settingsBinaryStatusDisabled,
    absent: strings.settingsBinaryStatusAbsent,
    valid: strings.settingsBinaryStatusValid,
    outdated: strings.settingsBinaryStatusOutdated,
    incomplete: strings.settingsBinaryStatusIncomplete,
    invalid: strings.settingsBinaryStatusInvalid,
    unsupported: strings.settingsBinaryStatusUnsupported,
    legacyManifest: strings.settingsBinaryStatusLegacyManifest,
    error: strings.settingsBinaryError,
    records: strings.settingsBinaryRecords,
    dimensions: strings.settingsBinaryDimensions,
  };
}

function feedbackText(strings: UiStrings, state: DeclarativeBinarySnapshot): string {
  switch (state.feedback) {
    case "idle": return "";
    case "pending": return strings.settingsBinaryWorking;
    case "success": return strings.settingsBinarySuccess;
    case "error": return strings.settingsBinaryError;
    case "blocked": return state.reasonCode === "legacy-manifest"
      ? strings.settingsBinaryStatusLegacyManifest
      : strings.settingsBinaryError;
  }
}

function statusText(strings: UiStrings, state: DeclarativeBinarySnapshot): string {
  const status = getPureBinaryStatusText(statusStrings(strings), state);
  const feedback = feedbackText(strings, state);
  return feedback ? `${status} · ${feedback}` : status;
}

function binaryReadDiagnosticLines(strings: UiStrings, state: DeclarativeBinarySnapshot): string[] {
  const diagnostic = state.readDiagnostic;
  const preference = diagnostic.configuredPreference === "prefer-binary" ? strings.settingsBinaryPrefer : "JSONL";
  const source = diagnostic.effectiveSource === "binary"
    ? strings.settingsBinarySourceBinary
    : diagnostic.effectiveSource === "jsonl"
      ? strings.settingsBinarySourceJsonl
      : strings.settingsBinaryNotLoaded;
  const fallbackLabels: Record<string, string> = {
    "binary-disabled": strings.settingsBinaryFallbackDisabled,
    "binary-missing": strings.settingsBinaryFallbackMissing,
    "binary-invalid": strings.settingsBinaryFallbackInvalid,
    "binary-outdated": strings.settingsBinaryFallbackOutdated,
    "legacy-manifest": strings.settingsBinaryFallbackLegacy,
    "digest-unavailable": strings.settingsBinaryFallbackDigest,
    "binary-read-failed": strings.settingsBinaryFallbackRead,
    "jsonl-read-failed": strings.settingsBinaryFallbackJsonl,
    "canonical-manifest-invalid": strings.settingsBinaryFallbackManifest,
    "resource-limit": strings.settingsBinaryFallbackResourceLimit,
    "binary-resource-limit": strings.settingsBinaryFallbackResourceLimit,
    "jsonl-resource-limit": strings.settingsEmbeddingSourceMemoryLimit,
    "configured-source-resource-limit": strings.settingsEmbeddingSourceMemoryLimit,
    "fallback-source-resource-limit": strings.settingsEmbeddingSourceMemoryLimit,
    "no-safe-source": strings.settingsEmbeddingSourceMemoryLimit,
    cancelled: strings.settingsBinaryFallbackCancelled,
  };
  const lines = [
    `${strings.settingsBinaryConfiguredPreference}: ${preference}`,
    `${strings.settingsBinaryEffectiveSource}: ${source}`,
  ];
  if (diagnostic.fallbackReason !== "none" && diagnostic.fallbackReason !== "binary-disabled") {
    const reasonLabel = diagnostic.configuredPreference === "prefer-binary"
      ? strings.settingsBinaryFallback
      : strings.settingsBinaryReadReason;
    lines.push(`${reasonLabel}: ${fallbackLabels[diagnostic.fallbackReason] ?? strings.settingsBinaryFallbackRead}`);
  }
  return lines;
}

/**
 * Candidate-only binary renderer/action factory. Binary operation ownership
 * remains entirely with the injected composition binding and its lifecycle.
 */
export function createDeclarativeSettingsBinaryRenderers(
  options: DeclarativeSettingsBinaryRenderersOptions,
): DeclarativeSettingsBinaryRenderers {
  let disposed = false;
  let rendererCount = 0;
  let actionCount = 0;
  const ownerIds = [`${options.ownerPrefix}-binary`];

  const createAction = (
    isAvailable: (state: DeclarativeBinarySnapshot) => boolean,
    invoke: () => Promise<boolean>,
  ): DeclarativeBinaryAction => {
    actionCount += 1;
    return {
      run() {
        if (disposed || !isAvailable(options.bindings.getSnapshot())) return;
        void invoke();
      },
      isDisabled() {
        return disposed || !isAvailable(options.bindings.getSnapshot());
      },
    };
  };

  return {
    createBinaryStatusRenderer() {
      rendererCount += 1;
      return (setting, _group) => {
        if (disposed) return;
        setting.setName(options.strings.settingsBinaryStatus);
        const state = options.bindings.getSnapshot();
        setting.descEl.createEl("p", {
          text: statusText(options.strings, state),
          attr: { "aria-live": "polite" },
        });
        for (const line of binaryReadDiagnosticLines(options.strings, state)) {
          setting.descEl.createEl("p", { text: line, attr: { "aria-live": "polite" } });
        }
      };
    },
    createCheckBinaryAction() {
      return createAction((state) => state.canCheck, () => options.bindings.check());
    },
    createCreateOrUpdateBinaryAction() {
      return createAction((state) => state.canCreateOrUpdate, () => options.bindings.createOrUpdate());
    },
    createRemoveBinaryAction() {
      return createAction((state) => state.canRemove, () => options.bindings.remove());
    },
    createRemoveBinaryRenderer(removeAction) {
      rendererCount += 1;
      return (setting, _group) => {
        if (disposed) return;
        setting
          .setName(options.strings.settingsBinaryRemove)
          .addButton((button) => button
            .setButtonText(options.strings.settingsBinaryRemove)
            .setDestructive()
            .setDisabled(removeAction.isDisabled())
            .onClick(() => removeAction.run()));
      };
    },
    getDiagnosticSnapshot() {
      return {
        ownerIds: [...ownerIds],
        rendererCount,
        actionCount,
        disposed,
        readiness: disposed ? "DISPOSED" : "READY",
        state: options.bindings.getSnapshot(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
}
