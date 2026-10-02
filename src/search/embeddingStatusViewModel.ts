import { EmbeddingOperationState } from "../index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../index/embeddingWorkStatusController";
import { UiStrings } from "../i18n/strings";
import { EmbeddingLifecycleSnapshot } from "../index/embeddingLifecycleModel";
import { type EmbeddingWritePathDecision, deriveEmbeddingWritePathDecision } from "../index/embeddingLifecycleWritePath";

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
  lifecycleSnapshot: EmbeddingLifecycleSnapshot;
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

function formatMode(mode: string | undefined, strings: UiStrings): string {
  if (mode === "initial-build") return strings.diagnosticEmbeddingModeInitialBuild;
  if (mode === "incremental") return strings.diagnosticEmbeddingModeIncremental;
  if (mode === "full-rebuild") return strings.diagnosticEmbeddingModeFullRebuild;
  return strings.stateUnknown;
}

function isOperationActive(state: EmbeddingOperationState): boolean {
  return state.status === "running" || state.status === "cancelling";
}

function getRuntimeLabel(workState: EmbeddingWorkRuntimeState, strings: UiStrings, lifecycleSnapshot: EmbeddingLifecycleSnapshot): string {
  if (lifecycleSnapshot.primary === "ERROR") return strings.diagnosticEmbeddingRuntimeError;
  if (lifecycleSnapshot.primary === "VERIFYING") return strings.diagnosticEmbeddingRuntimeCalculating;
  if (lifecycleSnapshot.primary === "INDETERMINATE") return strings.diagnosticEmbeddingRuntimeUnknown;
  if (lifecycleSnapshot.primary === "UPDATE_AVAILABLE" || lifecycleSnapshot.write.updateRequired) return strings.diagnosticEmbeddingRuntimeDirty;
  return strings.diagnosticEmbeddingRuntimeReady;
}

function getHeadline(input: BuildEmbeddingStatusViewModelInput & { lifecycleSnapshot: EmbeddingLifecycleSnapshot }): { text: string; tone: EmbeddingDiagnosticTone } {
  const { operationState, indexReady, strings, lifecycleSnapshot } = input;
  const operationActive = isOperationActive(operationState) || (lifecycleSnapshot.process.phase === "generating" || lifecycleSnapshot.process.phase === "preparing" || lifecycleSnapshot.primary === "UPDATING" || lifecycleSnapshot.primary === "CANCELLING");
  if (operationActive) {
    return { text: strings.diagnosticEmbeddingActiveOperation, tone: "running" };
  }
  if (!indexReady || lifecycleSnapshot.primary === "NO_TEXT_INDEX") {
    return { text: strings.diagnosticEmbeddingTextIndexMissing, tone: "warning" };
  }
  if (lifecycleSnapshot.primary === "ERROR") {
    return { text: strings.statusEmbeddingsError, tone: "error" };
  }
  if (lifecycleSnapshot.process.phase === "checking") {
    return { text: strings.diagnosticEmbeddingRuntimeCalculating, tone: "neutral" };
  }
  if (lifecycleSnapshot.primary === "INDETERMINATE") {
    return { text: strings.diagnosticEmbeddingRuntimeUnknown, tone: "neutral" };
  }
  if (lifecycleSnapshot.primary === "INCOMPATIBLE" || lifecycleSnapshot.write.work.mode === "full-rebuild") {
    return { text: strings.diagnosticEmbeddingFullRebuildRequired, tone: "warning" };
  }
  if (lifecycleSnapshot.primary === "INDEX_ONLY") {
    return { text: strings.diagnosticEmbeddingDetailsUnavailable, tone: "neutral" };
  }
  if (lifecycleSnapshot.primary === "UPDATE_AVAILABLE" || lifecycleSnapshot.write.updateRequired) {
    return { text: strings.stateEmbeddingUpdateAvailable, tone: "warning" };
  }
  return { text: strings.stateEmbeddingStatusUpToDate, tone: "success" };
}

/**
 * Presentation mapping of the canonical action. `retry` re-runs the pending work, so it is shown
 * as the button of the work it repeats; no state is reconstructed here.
 */
function mapDecisionToUiAction(
  decision: EmbeddingWritePathDecision
): Extract<EmbeddingDiagnosticActionKind, "generate" | "update" | "rebuild"> | undefined {
  switch (decision.action) {
    case "generate":
    case "update":
    case "rebuild":
      return decision.action;
    case "retry":
      if (decision.workMode === "initial-build") return "generate";
      if (decision.workMode === "full-rebuild") return "rebuild";
      if (decision.workMode === "incremental" || decision.workMode === "publish-only") return "update";
      return undefined;
    default:
      return undefined;
  }
}

function buildActions(input: BuildEmbeddingStatusViewModelInput & { lifecycleSnapshot: EmbeddingLifecycleSnapshot }): EmbeddingDiagnosticAction[] {
  const { operationState, workState, indexReady, strings, lifecycleSnapshot } = input;
  const operationActive = isOperationActive(operationState) || (lifecycleSnapshot.process.phase === "generating" || lifecycleSnapshot.process.phase === "preparing" || lifecycleSnapshot.primary === "UPDATING" || lifecycleSnapshot.primary === "CANCELLING");
  const actions: EmbeddingDiagnosticAction[] = [
    {
      kind: "refresh-status",
      label: strings.btnRefreshEmbeddingStatus,
      disabled: Boolean(operationActive || workState.summary?.resourceLimitCode === "mobile-bridge-read-limit-exceeded"),
    },
  ];

  if (operationActive) {
    actions.push({
      kind: "cancel",
      label: strings.btnCancelEmbeddingGeneration,
      disabled: operationState.status === "cancelling" || lifecycleSnapshot.primary === "CANCELLING",
    });
    return actions;
  }

  if (!indexReady || lifecycleSnapshot.primary === "NO_TEXT_INDEX") {
    return actions;
  }

  // The action is the canonical Write Path decision; the UI only presents it.
  const decision = deriveEmbeddingWritePathDecision(lifecycleSnapshot);
  const kind = mapDecisionToUiAction(decision);
  if (!kind) {
    return actions;
  }

  // Retained legacy guard (equivalence): without calculated details the caller already reports
  // published vectors as present, so an initial build must not be offered.
  if (kind === "generate" && !workState.summary && input.embeddingsReady) {
    return actions;
  }

  actions.push({
    kind,
    label: kind === "rebuild"
      ? strings.btnRebuildEmbeddings
      : kind === "generate"
        ? strings.btnGenerateEmbeddings
        : strings.btnUpdateEmbeddings,
    disabled: !decision.canExecute,
    requiresFullRebuildConfirmation: kind === "rebuild",
  });

  return actions;
}

export function buildEmbeddingStatusViewModel(input: BuildEmbeddingStatusViewModelInput): EmbeddingStatusViewModel {
  const summary = input.workState.summary;
  // Mandatory canonical snapshot; this view model never synthesises one (LINA-15D-B / S7: retained, not a production consumer).
  const lifecycleSnapshot = input.lifecycleSnapshot;

  const adaptedInput: BuildEmbeddingStatusViewModelInput & { lifecycleSnapshot: EmbeddingLifecycleSnapshot } = {
    ...input,
    lifecycleSnapshot,
  };

  const { workState, configuredProvider, configuredModel, strings } = adaptedInput;
  const detailsAvailable = !!summary && summary.detailsAvailable !== false;
  const headline = getHeadline(adaptedInput);
  const checkpointCount = lifecycleSnapshot.write.work.counts?.recoverableCheckpoint ?? summary?.recoverableCheckpointCount ?? 0;

  const counts: EmbeddingDiagnosticLine[] = [
    {
      label: strings.diagnosticValidForSearch,
      value: formatNumber(lifecycleSnapshot.write.work.counts?.reusableCanonical ?? (summary?.validForSearchCount ?? summary?.validCount)),
    },
    {
      label: strings.detailsEmbeddingsMissing,
      value: formatNumber(lifecycleSnapshot.write.work.counts?.missing ?? summary?.missingCount),
    },
    {
      label: strings.detailsEmbeddingsOutdated,
      value: formatNumber(lifecycleSnapshot.write.work.counts?.staleToReplace ?? summary?.staleCount),
    },
    {
      label: strings.diagnosticEmbeddingsObsolete,
      value: formatNumber(lifecycleSnapshot.write.work.counts?.obsoleteToDrop ?? summary?.obsoleteCount),
    },
  ];

  const published: EmbeddingDiagnosticLine[] = [
    { label: strings.detailsProvider, value: formatNullable(lifecycleSnapshot.read.compatibility.published?.provider ?? summary?.provider, strings.stateNotDefined) },
    { label: strings.detailsModel, value: formatNullable(lifecycleSnapshot.read.compatibility.published?.model ?? summary?.model, strings.stateNotDefined) },
    { label: strings.detailsDimension, value: formatNullable(lifecycleSnapshot.read.compatibility.published?.dimensions ?? summary?.dimensions, strings.stateNotDefined) },
    { label: strings.detailsLastEmbeddingUpdate, value: formatNullable(lifecycleSnapshot.info.embeddingsPublishedAt ?? summary?.updatedAt, strings.stateNotDefined) },
  ];

  const nextGeneration: EmbeddingDiagnosticLine[] = [
    { label: strings.detailsProvider, value: formatNullable(configuredProvider, strings.stateNotDefined) },
    { label: strings.detailsModel, value: formatNullable(configuredModel, strings.stateNotDefined) },
    { label: strings.detailsPrefixMode, value: formatNullable(lifecycleSnapshot.read.compatibility.device?.prefixMode ?? summary?.expectedPrefixMode, strings.stateNotDefined) },
    { label: strings.diagnosticEmbeddingPlanMode, value: formatMode(lifecycleSnapshot.write.work.mode, strings) },
    { label: strings.diagnosticEmbeddingToGenerate, value: formatNumber(lifecycleSnapshot.write.work.counts?.toGenerate) },
    { label: strings.diagnosticEmbeddingReusable, value: formatNumber((lifecycleSnapshot.write.work.counts?.reusableCanonical ?? 0) + (lifecycleSnapshot.write.work.counts?.recoverableCheckpoint ?? 0)) },
  ];

  let guidance: string | undefined;
  if (lifecycleSnapshot.primary === "INCOMPATIBLE" || lifecycleSnapshot.write.work.mode === "full-rebuild") {
    guidance = strings.diagnosticEmbeddingFullRebuildGuidance;
  } else if (checkpointCount > 0) {
    guidance = strings.diagnosticEmbeddingCheckpointGuidance;
  } else if (lifecycleSnapshot.primary === "UPDATE_AVAILABLE" && lifecycleSnapshot.write.applicable) {
    guidance = strings.diagnosticEmbeddingIncrementalGuidance;
  } else if (!lifecycleSnapshot.write.applicable && lifecycleSnapshot.capability.blockedReason === "companion") {
    guidance = strings.sidebarMaintenanceManagedByActiveProducer;
  } else if (!lifecycleSnapshot.write.applicable && lifecycleSnapshot.capability.blockedReason === "standby") {
    guidance = strings.sidebarMaintenanceStandbyNotice;
  }

  return {
    headline: headline.text,
    tone: headline.tone,
    detailsAvailable,
    detailsUnavailableLabel: strings.diagnosticEmbeddingDetailsUnavailable,
    runtimeLabel: getRuntimeLabel(workState, strings, lifecycleSnapshot),
    counts,
    published,
    nextGeneration,
    checkpointLabel: checkpointCount > 0
      ? `${strings.diagnosticEmbeddingCheckpointRecoverable}: ${checkpointCount}`
      : strings.diagnosticEmbeddingCheckpointNone,
    guidance,
    actions: buildActions(adaptedInput),
  };
}
