import { EmbeddingOperationState } from "../index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../index/embeddingWorkStatusController";
import { EmbeddingUpdateMode } from "../index/embeddingUpdatePlan";
import { UiStrings } from "../i18n/strings";

export type EmbeddingDiagnosticTone = "neutral" | "success" | "warning" | "error" | "running";

export type EmbeddingDiagnosticActionKind =
  | "refresh-status"
  | "generate"
  | "update"
  | "rebuild"
  | "cancel";

export interface EmbeddingDiagnosticAction {
  kind: EmbeddingDiagnosticActionKind;
  label: string;
  disabled: boolean;
  requiresFullRebuildConfirmation?: boolean;
}

export interface EmbeddingDiagnosticLine {
  label: string;
  value: string;
}

export interface EmbeddingStatusViewModel {
  headline: string;
  tone: EmbeddingDiagnosticTone;
  detailsAvailable: boolean;
  detailsUnavailableLabel: string;
  runtimeLabel: string;
  counts: EmbeddingDiagnosticLine[];
  published: EmbeddingDiagnosticLine[];
  nextGeneration: EmbeddingDiagnosticLine[];
  checkpointLabel?: string;
  guidance?: string;
  actions: EmbeddingDiagnosticAction[];
}

export interface BuildEmbeddingStatusViewModelInput {
  workState: EmbeddingWorkRuntimeState;
  operationState: EmbeddingOperationState;
  configuredProvider: string;
  configuredModel: string;
  indexReady: boolean;
  embeddingsReady: boolean;
  strings: UiStrings;
}

function formatNumber(value: number | undefined): string {
  return String(Math.max(0, value ?? 0));
}

function formatNullable(value: string | number | undefined, fallback: string): string {
  if (typeof value === "number") {
    return value > 0 ? String(value) : fallback;
  }
  return value && value.trim().length > 0 ? value : fallback;
}

function formatMode(mode: EmbeddingUpdateMode | undefined, strings: UiStrings): string {
  if (mode === "initial-build") return strings.diagnosticEmbeddingModeInitialBuild;
  if (mode === "incremental") return strings.diagnosticEmbeddingModeIncremental;
  if (mode === "full-rebuild") return strings.diagnosticEmbeddingModeFullRebuild;
  return strings.stateUnknown;
}

function isOperationActive(state: EmbeddingOperationState): boolean {
  return state.status === "running" || state.status === "cancelling";
}

function getRuntimeLabel(workState: EmbeddingWorkRuntimeState, strings: UiStrings): string {
  if (workState.status === "unknown") return strings.diagnosticEmbeddingRuntimeUnknown;
  if (workState.status === "dirty") return strings.diagnosticEmbeddingRuntimeDirty;
  if (workState.status === "calculating") return strings.diagnosticEmbeddingRuntimeCalculating;
  if (workState.status === "ready") return strings.diagnosticEmbeddingRuntimeReady;
  if (workState.status === "error") return strings.diagnosticEmbeddingRuntimeError;
  return strings.stateUnknown;
}

function getHeadline(input: BuildEmbeddingStatusViewModelInput): { text: string; tone: EmbeddingDiagnosticTone } {
  const { workState, operationState, indexReady, strings } = input;
  if (isOperationActive(operationState)) {
    return { text: strings.diagnosticEmbeddingActiveOperation, tone: "running" };
  }
  if (!indexReady) {
    return { text: strings.diagnosticEmbeddingTextIndexMissing, tone: "warning" };
  }
  if (workState.status === "error") {
    return { text: strings.statusEmbeddingsError, tone: "error" };
  }
  if (workState.status === "unknown" || workState.status === "dirty" || workState.status === "calculating") {
    return { text: getRuntimeLabel(workState, strings), tone: "neutral" };
  }
  if (workState.summary?.updatePlan?.mode === "full-rebuild") {
    return { text: strings.diagnosticEmbeddingFullRebuildRequired, tone: "warning" };
  }
  if (workState.workAvailable) {
    return { text: strings.stateEmbeddingUpdateAvailable, tone: "warning" };
  }
  return { text: strings.stateEmbeddingStatusUpToDate, tone: "success" };
}

function buildActions(input: BuildEmbeddingStatusViewModelInput): EmbeddingDiagnosticAction[] {
  const { operationState, workState, indexReady, embeddingsReady, strings } = input;
  const operationActive = isOperationActive(operationState);
  const actions: EmbeddingDiagnosticAction[] = [
    {
      kind: "refresh-status",
      label: strings.btnRefreshEmbeddingStatus,
      disabled: operationActive || workState.summary?.resourceLimitCode === "mobile-bridge-read-limit-exceeded",
    },
  ];

  if (operationActive) {
    actions.push({
      kind: "cancel",
      label: strings.btnCancelEmbeddingGeneration,
      disabled: operationState.status === "cancelling",
    });
    return actions;
  }

  if (!indexReady) {
    return actions;
  }

  if (workState.summary?.detailsAvailable === false) {
    return actions;
  }

  const mode = workState.summary?.updatePlan?.mode;
  if (!embeddingsReady && mode !== "incremental") {
    actions.push({
      kind: "generate",
      label: strings.btnGenerateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: mode === "full-rebuild",
    });
    return actions;
  }

  if (workState.workAvailable || mode === "full-rebuild") {
    actions.push({
      kind: mode === "full-rebuild" ? "rebuild" : "update",
      label: mode === "full-rebuild" ? strings.btnRebuildEmbeddings : strings.btnUpdateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: mode === "full-rebuild",
    });
  }

  return actions;
}

export function buildEmbeddingStatusViewModel(input: BuildEmbeddingStatusViewModelInput): EmbeddingStatusViewModel {
  const { workState, configuredProvider, configuredModel, strings } = input;
  const summary = workState.summary;
  const detailsAvailable = !!summary && summary.detailsAvailable !== false;
  const plan = summary?.updatePlan;
  const headline = getHeadline(input);
  const checkpointCount = summary?.recoverableCheckpointCount ?? plan?.recoverableCheckpointCount ?? 0;

  const counts: EmbeddingDiagnosticLine[] = [
    { label: strings.diagnosticValidForSearch, value: formatNumber(summary?.validForSearchCount ?? summary?.validCount) },
    { label: strings.detailsEmbeddingsMissing, value: formatNumber(summary?.missingCount) },
    { label: strings.detailsEmbeddingsOutdated, value: formatNumber(summary?.staleCount) },
    { label: strings.diagnosticEmbeddingsObsolete, value: formatNumber(summary?.obsoleteCount) },
  ];

  const published: EmbeddingDiagnosticLine[] = [
    { label: strings.detailsProvider, value: formatNullable(summary?.provider, strings.stateNotDefined) },
    { label: strings.detailsModel, value: formatNullable(summary?.model, strings.stateNotDefined) },
    { label: strings.detailsDimension, value: formatNullable(summary?.dimensions, strings.stateNotDefined) },
    { label: strings.detailsLastEmbeddingUpdate, value: formatNullable(summary?.updatedAt, strings.stateNotDefined) },
  ];

  const nextGeneration: EmbeddingDiagnosticLine[] = [
    { label: strings.detailsProvider, value: formatNullable(configuredProvider, strings.stateNotDefined) },
    { label: strings.detailsModel, value: formatNullable(configuredModel, strings.stateNotDefined) },
    { label: strings.detailsPrefixMode, value: formatNullable(plan?.targetIdentity.prefixMode ?? summary?.expectedPrefixMode, strings.stateNotDefined) },
    { label: strings.diagnosticEmbeddingPlanMode, value: formatMode(plan?.mode, strings) },
    { label: strings.diagnosticEmbeddingToGenerate, value: formatNumber(plan?.toGenerateCount) },
    { label: strings.diagnosticEmbeddingReusable, value: formatNumber((plan?.reusableCanonicalCount ?? 0) + (plan?.recoverableCheckpointCount ?? 0)) },
  ];

  let guidance: string | undefined;
  if (plan?.mode === "full-rebuild") {
    guidance = strings.diagnosticEmbeddingFullRebuildGuidance;
  } else if (checkpointCount > 0) {
    guidance = strings.diagnosticEmbeddingCheckpointGuidance;
  } else if (workState.workAvailable) {
    guidance = strings.diagnosticEmbeddingIncrementalGuidance;
  }

  return {
    headline: headline.text,
    tone: headline.tone,
    detailsAvailable,
    detailsUnavailableLabel: strings.diagnosticEmbeddingDetailsUnavailable,
    runtimeLabel: getRuntimeLabel(workState, strings),
    counts,
    published,
    nextGeneration,
    checkpointLabel: checkpointCount > 0
      ? `${strings.diagnosticEmbeddingCheckpointRecoverable}: ${checkpointCount}`
      : strings.diagnosticEmbeddingCheckpointNone,
    guidance,
    actions: buildActions(input),
  };
}
