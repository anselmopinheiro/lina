import { EmbeddingOperationState } from "../index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../index/embeddingWorkStatusController";
import { UiStrings } from "../i18n/strings";
import { EmbeddingLifecycleSnapshot } from "../index/embeddingLifecycleModel";

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
  lifecycleSnapshot?: EmbeddingLifecycleSnapshot;
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

function getRuntimeLabel(workState: EmbeddingWorkRuntimeState, strings: UiStrings, lifecycleSnapshot?: EmbeddingLifecycleSnapshot): string {
  if (lifecycleSnapshot) {
    if (lifecycleSnapshot.primary === "ERROR") return strings.diagnosticEmbeddingRuntimeError;
    if (lifecycleSnapshot.primary === "VERIFYING") return strings.diagnosticEmbeddingRuntimeCalculating;
    if (lifecycleSnapshot.primary === "INDETERMINATE") return strings.diagnosticEmbeddingRuntimeUnknown;
    if (lifecycleSnapshot.primary === "UPDATE_AVAILABLE" || lifecycleSnapshot.write.updateRequired) return strings.diagnosticEmbeddingRuntimeDirty;
    return strings.diagnosticEmbeddingRuntimeReady;
  }
  if (workState.status === "unknown") return strings.diagnosticEmbeddingRuntimeUnknown;
  if (workState.status === "dirty") return strings.diagnosticEmbeddingRuntimeDirty;
  if (workState.status === "calculating") return strings.diagnosticEmbeddingRuntimeCalculating;
  if (workState.status === "ready") return strings.diagnosticEmbeddingRuntimeReady;
  if (workState.status === "error") return strings.diagnosticEmbeddingRuntimeError;
  return strings.stateUnknown;
}

function getHeadline(input: BuildEmbeddingStatusViewModelInput): { text: string; tone: EmbeddingDiagnosticTone } {
  const { workState, operationState, indexReady, strings, lifecycleSnapshot } = input;
  const operationActive = isOperationActive(operationState) || (lifecycleSnapshot && (lifecycleSnapshot.process.phase === "generating" || lifecycleSnapshot.process.phase === "preparing" || lifecycleSnapshot.primary === "UPDATING" || lifecycleSnapshot.primary === "CANCELLING"));
  if (operationActive) {
    return { text: strings.diagnosticEmbeddingActiveOperation, tone: "running" };
  }
  if (!indexReady || lifecycleSnapshot?.primary === "NO_TEXT_INDEX") {
    return { text: strings.diagnosticEmbeddingTextIndexMissing, tone: "warning" };
  }
  if (lifecycleSnapshot?.primary === "ERROR" || workState.status === "error") {
    return { text: strings.statusEmbeddingsError, tone: "error" };
  }
  if (lifecycleSnapshot) {
    if (lifecycleSnapshot.primary === "VERIFYING") {
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
  if (workState.status === "unknown" || workState.status === "dirty" || workState.status === "calculating") {
    return { text: getRuntimeLabel(workState, strings), tone: "neutral" };
  }
  if (workState.summary?.updatePlan?.mode === "full-rebuild") {
    return { text: strings.diagnosticEmbeddingFullRebuildRequired, tone: "warning" };
  }
  if (!workState.summary || workState.summary.detailsAvailable === false) {
    return { text: strings.diagnosticEmbeddingDetailsUnavailable, tone: "neutral" };
  }
  if (workState.workAvailable) {
    return { text: strings.stateEmbeddingUpdateAvailable, tone: "warning" };
  }
  return { text: strings.stateEmbeddingStatusUpToDate, tone: "success" };
}

function buildActions(input: BuildEmbeddingStatusViewModelInput): EmbeddingDiagnosticAction[] {
  const { operationState, workState, indexReady, embeddingsReady, strings, lifecycleSnapshot } = input;
  const operationActive = isOperationActive(operationState) || (lifecycleSnapshot && (lifecycleSnapshot.process.phase === "generating" || lifecycleSnapshot.process.phase === "preparing" || lifecycleSnapshot.primary === "UPDATING" || lifecycleSnapshot.primary === "CANCELLING"));
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
      disabled: operationState.status === "cancelling" || lifecycleSnapshot?.primary === "CANCELLING",
    });
    return actions;
  }

  if (!indexReady || lifecycleSnapshot?.primary === "NO_TEXT_INDEX") {
    return actions;
  }

  // If lifecycle snapshot explicitly marks write as non-applicable (e.g. Companion, Standby), do not emit write actions
  if (lifecycleSnapshot && !lifecycleSnapshot.write.applicable) {
    return actions;
  }

  const mode = lifecycleSnapshot?.write.work.mode ?? workState.summary?.updatePlan?.mode;
  if (mode === "full-rebuild" || lifecycleSnapshot?.primary === "INCOMPATIBLE") {
    actions.push({
      kind: "rebuild",
      label: strings.btnRebuildEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: true,
    });
    return actions;
  }

  if (!lifecycleSnapshot && (workState.summary?.detailsAvailable === false)) {
    return actions;
  }

  const isReady = lifecycleSnapshot ? (lifecycleSnapshot.read.semanticAvailable || lifecycleSnapshot.primary === "READY") : embeddingsReady;
  if (!isReady && mode !== "incremental") {
    actions.push({
      kind: "generate",
      label: strings.btnGenerateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: false,
    });
    return actions;
  }

  const updateAvailable = lifecycleSnapshot ? lifecycleSnapshot.write.updateRequired : workState.workAvailable;
  if (updateAvailable) {
    actions.push({
      kind: "update",
      label: strings.btnUpdateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: false,
    });
  }

  return actions;
}

export function buildEmbeddingStatusViewModel(input: BuildEmbeddingStatusViewModelInput): EmbeddingStatusViewModel {
  const { workState, configuredProvider, configuredModel, strings, lifecycleSnapshot } = input;
  const summary = workState.summary;
  const detailsAvailable = !!summary && summary.detailsAvailable !== false;
  const plan = summary?.updatePlan;
  const headline = getHeadline(input);
  const checkpointCount = summary?.recoverableCheckpointCount ?? plan?.recoverableCheckpointCount ?? (lifecycleSnapshot?.write.work.counts?.recoverableCheckpoint ?? 0);

  const counts: EmbeddingDiagnosticLine[] = [
    {
      label: strings.diagnosticValidForSearch,
      value: formatNumber(lifecycleSnapshot?.write.work.counts?.reusableCanonical ?? (summary?.validForSearchCount ?? summary?.validCount)),
    },
    {
      label: strings.detailsEmbeddingsMissing,
      value: formatNumber(lifecycleSnapshot?.write.work.counts?.missing ?? summary?.missingCount),
    },
    {
      label: strings.detailsEmbeddingsOutdated,
      value: formatNumber(lifecycleSnapshot?.write.work.counts?.staleToReplace ?? summary?.staleCount),
    },
    {
      label: strings.diagnosticEmbeddingsObsolete,
      value: formatNumber(lifecycleSnapshot?.write.work.counts?.obsoleteToDrop ?? summary?.obsoleteCount),
    },
  ];

  const published: EmbeddingDiagnosticLine[] = [
    { label: strings.detailsProvider, value: formatNullable(lifecycleSnapshot?.read.compatibility.published?.provider ?? summary?.provider, strings.stateNotDefined) },
    { label: strings.detailsModel, value: formatNullable(lifecycleSnapshot?.read.compatibility.published?.model ?? summary?.model, strings.stateNotDefined) },
    { label: strings.detailsDimension, value: formatNullable(lifecycleSnapshot?.read.compatibility.published?.dimensions ?? summary?.dimensions, strings.stateNotDefined) },
    { label: strings.detailsLastEmbeddingUpdate, value: formatNullable(lifecycleSnapshot?.info.embeddingsPublishedAt ?? summary?.updatedAt, strings.stateNotDefined) },
  ];

  const nextGeneration: EmbeddingDiagnosticLine[] = [
    { label: strings.detailsProvider, value: formatNullable(configuredProvider, strings.stateNotDefined) },
    { label: strings.detailsModel, value: formatNullable(configuredModel, strings.stateNotDefined) },
    { label: strings.detailsPrefixMode, value: formatNullable(lifecycleSnapshot?.read.compatibility.device?.prefixMode ?? (plan?.targetIdentity.prefixMode ?? summary?.expectedPrefixMode), strings.stateNotDefined) },
    { label: strings.diagnosticEmbeddingPlanMode, value: formatMode(lifecycleSnapshot?.write.work.mode ?? plan?.mode, strings) },
    { label: strings.diagnosticEmbeddingToGenerate, value: formatNumber(lifecycleSnapshot?.write.work.counts?.toGenerate ?? plan?.toGenerateCount) },
    { label: strings.diagnosticEmbeddingReusable, value: formatNumber((lifecycleSnapshot?.write.work.counts?.reusableCanonical ?? (plan?.reusableCanonicalCount ?? 0)) + (lifecycleSnapshot?.write.work.counts?.recoverableCheckpoint ?? (plan?.recoverableCheckpointCount ?? 0))) },
  ];

  let guidance: string | undefined;
  if (lifecycleSnapshot) {
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
  } else if (plan?.mode === "full-rebuild") {
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
    runtimeLabel: getRuntimeLabel(workState, strings, lifecycleSnapshot),
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
