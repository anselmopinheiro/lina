/**
 * Embedding Lifecycle Shadow Adapter (Phase LINA-14B)
 *
 * Adapts existing heterogeneous runtime and persisted state representations into the
 * unified EmbeddingLifecycleSnapshot and performs shadow comparison between legacy
 * decisions and the new pure lifecycle model.
 *
 * This adapter is strictly observational and pure: it performs no file I/O, no network
 * calls, no mutations of application state, and does not alter existing runtime flows.
 */

import {
  EmbeddingIdentitySummary,
  EmbeddingLifecycleSnapshot,
  EmbeddingWorkAssessment,
  classifyEmbeddingWork,
  resolveEmbeddingLifecycle,
} from "./embeddingLifecycleModel";
import { PublishedEmbeddingIdentity } from "./embeddingState";
import { EmbeddingUpdatePlan } from "./embeddingUpdatePlan";
import { EmbeddingWorkflowState } from "./embeddingWorkflowState";
import { EmbeddingOperationState } from "./embeddingOperationManager";
import { VectorContractV1 } from "./vectorContract";
import { DeviceRuntimeState } from "../device/deviceRuntimeState";
import { ProducerStateV1 } from "../device/producerState";
import { CompanionArtifactConsumptionState } from "../companion/companionConsumptionState";

// ---------------------------------------------------------------------------
// 1. Adapter Input Types
// ---------------------------------------------------------------------------

export interface CurrentEmbeddingStateInputs {
  readonly revision?: number;
  readonly computedAt?: number;

  readonly deviceRuntimeState?: DeviceRuntimeState | null;
  readonly workflowState?: EmbeddingWorkflowState | null;
  readonly updatePlan?: EmbeddingUpdatePlan | null;
  readonly vectorContract?: VectorContractV1 | null;
  readonly publishedIdentity?: PublishedEmbeddingIdentity | null;
  readonly operationState?: EmbeddingOperationState | null;
  readonly producerState?: ProducerStateV1 | null;
  readonly companionState?: CompanionArtifactConsumptionState | null;

  readonly upstreamTextIndex?: "ready" | "stale" | "missing" | "invalid";
  readonly factsChecking?: boolean;
  readonly canonicalExists?: boolean;
  readonly canonicalReadability?: "missing" | "empty" | "readable" | "unreadable";
  readonly validForSearchCount?: number;
  readonly activeSource?: "jsonl" | "binary" | "none";
  readonly isExternalProvider?: boolean;
  readonly requiresConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// 2. Shadow Comparison Types
// ---------------------------------------------------------------------------

export type ShadowDifferenceSeverity = "info" | "warning" | "divergence";

export interface EmbeddingLifecycleDifference {
  readonly area: "read" | "write" | "process" | "primary" | "capability";
  readonly property: string;
  readonly legacyValue: unknown;
  readonly snapshotValue: unknown;
  readonly description: string;
  readonly severity: ShadowDifferenceSeverity;
}

export interface LegacyStateSummary {
  readonly semanticAvailable: boolean;
  readonly workflowStatus: string;
  readonly workAvailable: boolean;
  readonly role: string;
  readonly isActiveProducer: boolean;
}

export interface EmbeddingLifecycleShadowResult {
  readonly legacyStateSummary: LegacyStateSummary;
  readonly lifecycleSnapshot: EmbeddingLifecycleSnapshot;
  readonly differences: readonly EmbeddingLifecycleDifference[];
  readonly matchesPrimary: boolean;
}

// ---------------------------------------------------------------------------
// 3. Adapter Functions
// ---------------------------------------------------------------------------

/**
 * Converts a PublishedEmbeddingIdentity or VectorContract into a canonical EmbeddingIdentitySummary.
 */
export function toEmbeddingIdentitySummary(
  identity?: PublishedEmbeddingIdentity | VectorContractV1 | null
): EmbeddingIdentitySummary | undefined {
  if (!identity) return undefined;
  return {
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions,
    inputVersion: identity.inputVersion,
    prefixMode: identity.prefixMode,
    contractId: "contractId" in identity ? identity.contractId : undefined,
  };
}

/**
 * Pure adapter function converting current application state inputs into an EmbeddingLifecycleSnapshot.
 */
export function adaptCurrentStateToLifecycleSnapshot(
  inputs: CurrentEmbeddingStateInputs
): EmbeddingLifecycleSnapshot {
  const revision = inputs.revision ?? 1;
  const computedAt = inputs.computedAt ?? Date.now();

  const deviceRuntime = inputs.deviceRuntimeState;
  const deviceRole = deviceRuntime?.effectiveRole ?? "unassigned";
  const isActiveProducer = deviceRuntime?.isActiveProducer ?? false;
  const embeddingsEnabled = deviceRuntime?.embeddings?.configured ?? true;

  const upstreamTextIndex = inputs.upstreamTextIndex ?? (
    deviceRuntime?.embeddings?.textIndexAvailable ? "ready" : "missing"
  );

  const publishedIdentity = toEmbeddingIdentitySummary(inputs.publishedIdentity) ??
    toEmbeddingIdentitySummary(inputs.vectorContract);

  const deviceIdentity = toEmbeddingIdentitySummary(inputs.vectorContract) ?? publishedIdentity;

  const canonicalExists = inputs.canonicalExists ?? (deviceRuntime?.embeddings?.exists ?? false);
  const validForSearchCount = inputs.validForSearchCount ?? (canonicalExists ? 1 : 0);
  const activeSource = inputs.activeSource ?? "jsonl";

  // Classify work using the update plan if provided, or default fallback
  let workAssessment: EmbeddingWorkAssessment | undefined;
  if (inputs.updatePlan) {
    workAssessment = classifyEmbeddingWork({
      publishedIdentity,
      targetIdentity: toEmbeddingIdentitySummary(inputs.updatePlan.targetIdentity),
      canonicalExists,
      canonicalReadability: inputs.canonicalReadability ?? "readable",
      totalChunks: inputs.updatePlan.totalChunks,
      reusableCanonicalCount: inputs.updatePlan.reusableCanonicalCount,
      recoverableCheckpointCount: inputs.updatePlan.recoverableCheckpointCount,
      toGenerateCount: inputs.updatePlan.toGenerateCount,
      staleToReplaceCount: inputs.updatePlan.staleToReplaceCount,
      missingCount: inputs.updatePlan.missingCount,
      obsoleteToDropCount: inputs.updatePlan.obsoleteToDropCount,
      requiresPublication: inputs.updatePlan.requiresPublication,
      isExternalProvider: inputs.isExternalProvider ?? false,
    });
  } else if (inputs.workflowState) {
    workAssessment = {
      kind: inputs.workflowState.workAvailable ? "pending" : "none",
      mode: inputs.workflowState.workAvailable ? "incremental" : undefined,
      updateRequired: inputs.workflowState.workAvailable,
      severity: inputs.workflowState.workAvailable ? "action" : "none",
      cost: "local",
      reasons: inputs.workflowState.workAvailable ? ["legacy-work-available"] : ["up-to-date"],
    };
  }

  // Extract history from producerState or operationState
  const history = {
    lastSuccess: inputs.producerState?.embeddings?.lastSuccessfulPublicationAt
      ? {
          at: inputs.producerState.embeddings.lastSuccessfulPublicationAt,
        }
      : undefined,
    lastFailure: inputs.producerState?.maintenance?.lastError
      ? {
          category: inputs.producerState.maintenance.lastError,
        }
      : inputs.operationState?.error
      ? {
          category: "operation-failed",
          message: inputs.operationState.error ?? undefined,
        }
      : undefined,
    lastOperation: inputs.operationState?.status === "completed"
      ? { kind: "completed" as const, at: inputs.operationState.finishedAt ? new Date(inputs.operationState.finishedAt).toISOString() : undefined }
      : inputs.operationState?.status === "failed"
      ? { kind: "failed" as const, message: inputs.operationState.error ?? undefined }
      : inputs.operationState?.status === "cancelled"
      ? { kind: "cancelled" as const, message: inputs.operationState.message ?? undefined }
      : undefined,
  };

  const provenance = inputs.companionState?.provenanceValidity ?? "unknown";

  return resolveEmbeddingLifecycle({
    revision,
    computedAt,
    deviceRole,
    isActiveProducer,
    embeddingsEnabled,
    upstreamTextIndex,
    publishedIdentity,
    deviceIdentity,
    canonicalExists,
    validForSearchCount,
    activeSource,
    workAssessment,
    factsChecking: inputs.factsChecking,
    operationState: inputs.operationState ? {
      status: inputs.operationState.status,
      phase: inputs.operationState.phase ?? undefined,
      processedChunks: inputs.operationState.processedChunks,
      totalChunks: inputs.operationState.totalChunks ?? undefined,
      reusedChunks: inputs.operationState.reusedChunks ?? undefined,
      failedChunks: inputs.operationState.failedChunks ?? undefined,
      error: inputs.operationState.error ?? undefined,
      message: inputs.operationState.message ?? undefined,
      origin: inputs.operationState.origin ?? undefined,
    } : undefined,
    history,
    provenance,
    requiresConfirmation: inputs.requiresConfirmation ?? false,
  });
}

/**
 * Performs a shadow comparison between the legacy runtime state and the adapted lifecycle snapshot.
 */
export function compareLegacyWithLifecycleSnapshot(
  inputs: CurrentEmbeddingStateInputs,
  snapshot: EmbeddingLifecycleSnapshot
): EmbeddingLifecycleShadowResult {
  const legacySummary: LegacyStateSummary = {
    semanticAvailable: inputs.deviceRuntimeState?.embeddings?.semanticAvailable ?? false,
    workflowStatus: inputs.workflowState?.status ?? "unknown",
    workAvailable: inputs.workflowState?.workAvailable ?? false,
    role: inputs.deviceRuntimeState?.effectiveRole ?? "unassigned",
    isActiveProducer: inputs.deviceRuntimeState?.isActiveProducer ?? false,
  };

  const differences: EmbeddingLifecycleDifference[] = [];

  // 1. Semantic Availability (Read Path)
  if (legacySummary.semanticAvailable !== snapshot.read.semanticAvailable) {
    differences.push({
      area: "read",
      property: "semanticAvailable",
      legacyValue: legacySummary.semanticAvailable,
      snapshotValue: snapshot.read.semanticAvailable,
      description: `Legacy semanticAvailable is ${legacySummary.semanticAvailable} while snapshot is ${snapshot.read.semanticAvailable}`,
      severity: "divergence",
    });
  }

  // 2. Work Assessment (Write Path)
  if (legacySummary.workAvailable !== snapshot.write.updateRequired) {
    // In Companion role, this divergence is expected and intentional (C1 contract resolution)
    const isCompanionExpected = legacySummary.role === "companion" && !snapshot.write.applicable;
    differences.push({
      area: "write",
      property: "updateRequired",
      legacyValue: legacySummary.workAvailable,
      snapshotValue: snapshot.write.updateRequired,
      description: isCompanionExpected
        ? "Companion role intentionally disables write applicability in unified lifecycle model"
        : `Legacy workAvailable is ${legacySummary.workAvailable} while snapshot updateRequired is ${snapshot.write.updateRequired}`,
      severity: isCompanionExpected ? "info" : "divergence",
    });
  }

  // 3. Primary State vs Legacy Workflow Status
  const primaryEquivalentStatus = mapPrimaryToWorkflowStatus(snapshot.primary);
  const matchesPrimary = legacySummary.workflowStatus === primaryEquivalentStatus ||
    (legacySummary.workflowStatus === "unknown" && snapshot.primary === "VERIFYING");

  if (!matchesPrimary) {
    differences.push({
      area: "primary",
      property: "status",
      legacyValue: legacySummary.workflowStatus,
      snapshotValue: snapshot.primary,
      description: `Legacy workflow status is "${legacySummary.workflowStatus}" but snapshot primary status is "${snapshot.primary}"`,
      severity: "warning",
    });
  }

  return {
    legacyStateSummary: legacySummary,
    lifecycleSnapshot: snapshot,
    differences,
    matchesPrimary,
  };
}

/**
 * Creates the complete shadow comparison result from current embedding inputs.
 */
export function createEmbeddingLifecycleShadowComparison(
  inputs: CurrentEmbeddingStateInputs
): EmbeddingLifecycleShadowResult {
  const snapshot = adaptCurrentStateToLifecycleSnapshot(inputs);
  return compareLegacyWithLifecycleSnapshot(inputs, snapshot);
}

// ---------------------------------------------------------------------------
// 4. Internal Helper
// ---------------------------------------------------------------------------

function mapPrimaryToWorkflowStatus(primary: EmbeddingLifecycleSnapshot["primary"]): string {
  switch (primary) {
    case "READY":
      return "idle";
    case "UPDATE_AVAILABLE":
      return "update-required";
    case "UPDATING":
      return "generating";
    case "CANCELLING":
      return "preparing";
    case "ERROR":
      return "error";
    case "VERIFYING":
      return "checking";
    case "INCOMPATIBLE":
    case "INDEX_ONLY":
    case "NO_TEXT_INDEX":
    case "DISABLED":
    case "INDETERMINATE":
    case "STANDBY":
    default:
      return "idle";
  }
}
