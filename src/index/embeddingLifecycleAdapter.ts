/**
 * Embedding Lifecycle Canonical Adapter (Phase LINA-14B / LINA-14F)
 *
 * Adapts heterogeneous runtime and persisted state representations into the
 * unified canonical EmbeddingLifecycleSnapshot.
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
import { EmbeddingUpdatePlanPreview } from "./embeddingUpdatePlan";
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
  readonly workAssessment?: EmbeddingWorkAssessment | null;
  /** Accepts the runtime preview (`workState.summary.updatePlan`) or the full plan (a structural superset). */
  readonly updatePlan?: EmbeddingUpdatePlanPreview | null;
  readonly vectorContract?: VectorContractV1 | null;
  readonly vectorContractCompatibility?: { readonly status: "compatible" | "mismatch" } | null;
  readonly publishedIdentity?: PublishedEmbeddingIdentity | null;
  readonly targetIdentity?: PublishedEmbeddingIdentity | null;
  readonly operationState?: EmbeddingOperationState | null;
  readonly producerState?: ProducerStateV1 | null;
  readonly companionState?: CompanionArtifactConsumptionState | null;

  readonly upstreamTextIndex?: "ready" | "stale" | "missing" | "invalid";
  readonly textIndexAvailable?: boolean;
  readonly embeddingsDeclaredInManifest?: boolean;
  readonly factsChecking?: boolean;
  readonly canonicalExists?: boolean;
  readonly canonicalReadability?: "missing" | "empty" | "readable" | "unreadable";
  readonly validForSearchCount?: number;
  readonly activeSource?: "jsonl" | "binary" | "none";
  readonly isExternalProvider?: boolean;
  readonly requiresConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// 2. Adapter Functions
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
  const isCompanion = inputs.companionState != null || deviceRuntime?.effectiveRole === "companion";
  const deviceRole = isCompanion ? "companion" : (deviceRuntime?.effectiveRole ?? "producer");
  const isActiveProducer = isCompanion ? false : (deviceRuntime?.isActiveProducer ?? true);
  const embeddingsEnabled = deviceRuntime?.embeddings?.configured ?? true;

  const upstreamTextIndex = inputs.upstreamTextIndex ?? (
    deviceRuntime?.embeddings?.textIndexAvailable ? "ready" : "missing"
  );

  const publishedIdentity = toEmbeddingIdentitySummary(inputs.publishedIdentity) ??
    toEmbeddingIdentitySummary(inputs.vectorContract) ??
    toEmbeddingIdentitySummary(inputs.companionState?.vectorContract) ??
    (inputs.companionState?.vectorContractCompatibility?.status === "compatible" ? {
      provider: "default-producer",
      model: "default-model",
      dimensions: 768,
      inputVersion: 1,
      prefixMode: "none",
    } : undefined);

  const deviceIdentity = toEmbeddingIdentitySummary(inputs.targetIdentity) ??
    toEmbeddingIdentitySummary(inputs.vectorContract) ?? (
      inputs.companionState?.vectorContractCompatibility?.status === "mismatch" ? {
        provider: "mismatch-local",
        model: "mismatch-model",
        dimensions: 1024,
        inputVersion: 1,
        prefixMode: "none",
      } : publishedIdentity
    );

  const canonicalExists = inputs.canonicalExists ?? (
    inputs.companionState ? inputs.companionState.artifactAvailability.embeddings === "available" : (deviceRuntime?.embeddings?.exists ?? false)
  );
  const validForSearchCount = inputs.validForSearchCount ?? (
    inputs.companionState ? (inputs.companionState.vectorContractCompatibility?.status === "compatible" ? 1 : 0) : (canonicalExists ? 1 : 0)
  );
  const activeSource = inputs.activeSource ?? "jsonl";

  // Classify work using the update plan if provided, or direct assessment
  let workAssessment: EmbeddingWorkAssessment | undefined = inputs.workAssessment ?? undefined;
  if (inputs.updatePlan) {
    const targetSummary = toEmbeddingIdentitySummary(inputs.updatePlan.targetIdentity);
    const effectivePublished = publishedIdentity ?? (
      inputs.updatePlan.mode === "incremental" ? targetSummary : undefined
    );

    workAssessment = classifyEmbeddingWork({
      publishedIdentity: effectivePublished,
      targetIdentity: targetSummary,
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

  const effectivePublishedIdentity = publishedIdentity ?? (
    inputs.updatePlan?.mode === "incremental"
      ? toEmbeddingIdentitySummary(inputs.updatePlan.targetIdentity)
      : undefined
  );
  const effectiveDeviceIdentity = deviceIdentity ?? effectivePublishedIdentity;
  const provenance = inputs.companionState?.provenanceValidity ?? "unknown";

  return resolveEmbeddingLifecycle({
    revision,
    computedAt,
    deviceRole,
    isActiveProducer,
    embeddingsEnabled,
    upstreamTextIndex,
    publishedIdentity: effectivePublishedIdentity,
    deviceIdentity: effectiveDeviceIdentity,
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
