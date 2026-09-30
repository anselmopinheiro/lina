import { EmbeddingOperationState } from "../index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../index/embeddingWorkStatusController";
import { UiStrings } from "../i18n/strings";
import { EmbeddingLifecycleSnapshot } from "../index/embeddingLifecycleModel";
import { adaptCurrentStateToLifecycleSnapshot } from "../index/embeddingLifecycleAdapter";

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

  // If lifecycle snapshot explicitly marks write as non-applicable (e.g. Companion, Standby), do not emit write actions
  if (!lifecycleSnapshot.write.applicable) {
    return actions;
  }

  const mode = lifecycleSnapshot.write.work.mode ?? workState.summary?.updatePlan?.mode;
  if (mode === "full-rebuild" || lifecycleSnapshot.primary === "INCOMPATIBLE") {
    actions.push({
      kind: "rebuild",
      label: strings.btnRebuildEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: true,
    });
    return actions;
  }

  const isReady = lifecycleSnapshot.read.semanticAvailable || lifecycleSnapshot.primary === "READY" || (!workState.summary && Boolean(input.embeddingsReady));
  if (!isReady && mode !== "incremental") {
    actions.push({
      kind: "generate",
      label: strings.btnGenerateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: false,
    });
    return actions;
  }

  const updateAvailable = lifecycleSnapshot.write.updateRequired;
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
  const summary = input.workState.summary;
  const updatePlan = summary?.updatePlan;
  const hasSummary = Boolean(summary);
  const lifecycleSnapshot = input.lifecycleSnapshot ?? adaptCurrentStateToLifecycleSnapshot({
    updatePlan,
    operationState: input.operationState,
    upstreamTextIndex: input.indexReady ? "ready" : "missing",
    canonicalExists: hasSummary && (input.embeddingsReady || summary?.exists === true || summary?.updatePlan?.mode === "full-rebuild"),
    validForSearchCount: summary?.validForSearchCount ?? summary?.validCount ?? (input.embeddingsReady ? 1 : 0),
    publishedIdentity: summary ? {
      provider: summary.provider ?? input.configuredProvider,
      model: summary.model ?? input.configuredModel,
      dimensions: summary.dimensions ?? updatePlan?.targetIdentity?.dimensions,
      inputVersion: updatePlan?.targetIdentity?.inputVersion ?? 1,
      prefixMode: (summary.manifestPrefixMode ?? summary.expectedPrefixMode ?? updatePlan?.targetIdentity?.prefixMode ?? "none") as "none" | "nomic-search-query-document",
    } : (input.embeddingsReady ? {
      provider: input.configuredProvider,
      model: input.configuredModel,
      dimensions: 1536,
      inputVersion: 1,
      prefixMode: "none" as const,
    } : undefined),
    targetIdentity: {
      provider: input.configuredProvider,
      model: input.configuredModel,
      dimensions: updatePlan?.targetIdentity?.dimensions,
      inputVersion: updatePlan?.targetIdentity?.inputVersion ?? 1,
      prefixMode: updatePlan?.targetIdentity?.prefixMode ?? "none",
    },
  });

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
