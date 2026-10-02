import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import type { EmbeddingLifecycleSnapshot } from "../../src/index/embeddingLifecycleModel";
import {
  buildSidebarStatusViewModel,
  type BuildSidebarStatusViewModelInput,
} from "../../src/search/sidebarStatusViewModel";

/** Explicit published identity of the scenarios below (a declared test fact). */
export const SCENARIO_IDENTITY = {
  provider: "ollama",
  model: "nomic-embed-text",
  dimensions: 768,
  inputVersion: 1,
  prefixMode: "none" as const,
};

/**
 * Builds the canonical snapshot for a sidebar test scenario from the flags the scenario declares.
 * Test-only: production always receives the live snapshot (LINA-15D-B / S5).
 */
export function scenarioSnapshot(input: Omit<BuildSidebarStatusViewModelInput, "lifecycleSnapshot">): EmbeddingLifecycleSnapshot {
  const isCompanion = Boolean(input.deviceRole === "companion" || input.companionState != null);
  const isStandby = Boolean(input.isStandbyProducer || (input.deviceRole === "producer" && input.isAuthorizedProducer === false));
  const isActive = Boolean(input.isAuthorizedProducer ?? (input.deviceRole === "producer" && !input.isStandbyProducer && (!input.ownership || input.ownership.activeProducerId === input.deviceId)));
  const hasValidVectors = Boolean(input.semanticAvailable || (input.runtimeEmbeddings?.semanticAvailable && input.semanticAvailable !== false));
  const isMismatch = Boolean(input.runtimeEmbeddings?.contractState === "mismatch" || input.semanticReasonCode === "model-incompatible" || input.runtimeEmbeddings?.reasonCode === "model-incompatible");
  const embeddingsPresent = Boolean(input.embeddingsReady || input.embeddingsUpdatedAt || input.runtimeEmbeddings?.exists);
  const identity = {
    ...SCENARIO_IDENTITY,
    provider: input.runtimeEmbeddings?.compatibility?.provider ?? SCENARIO_IDENTITY.provider,
    model: input.runtimeEmbeddings?.compatibility?.model ?? SCENARIO_IDENTITY.model,
    dimensions: input.runtimeEmbeddings?.compatibility?.dimensions ?? SCENARIO_IDENTITY.dimensions,
  };
  return adaptCurrentStateToLifecycleSnapshot({
    companionState: input.companionState,
    workAssessment: isMismatch
      ? { kind: "pending", mode: "full-rebuild", updateRequired: true, severity: "blocking", cost: "local", reasons: ["model-incompatible"] }
      : input.embeddingsWorkAvailable !== undefined
        ? {
          kind: input.embeddingsWorkAvailable ? "pending" : "none",
          mode: input.embeddingsWorkAvailable ? "incremental" : undefined,
          updateRequired: input.embeddingsWorkAvailable,
          severity: input.embeddingsWorkAvailable ? "action" : "none",
          cost: "local",
          reasons: input.embeddingsWorkAvailable ? ["work-available"] : ["up-to-date"],
        }
        : undefined,
    deviceRuntimeState: {
      deviceId: input.deviceId ?? "device-producer-1",
      effectiveRole: isCompanion ? "companion" : "producer",
      assignmentState: "assigned",
      isConfigured: true,
      ownershipExists: true,
      isActiveProducer: isActive,
      isStandbyProducer: isStandby,
      isCompanion,
      isUnassigned: false,
      canPublish: isActive,
      canTransferOwnership: false,
      transferEligibilityReason: "ready",
      embeddings: {
        configured: input.embeddingsEnabled ?? true,
        textIndexAvailable: input.textIndexReady ?? true,
        embeddingsDeclared: embeddingsPresent,
        exists: embeddingsPresent,
        vectorFileState: "available",
        provenance: { stale: false },
        compatibility: { compatible: !isMismatch },
        contractState: isMismatch ? "mismatch" : (input.runtimeEmbeddings?.contractState ?? "compatible"),
        readiness: { loaded: true, runtimeReady: true },
        runtimeState: "ready",
        semanticAvailable: hasValidVectors && !isMismatch,
        effectiveMode: hasValidVectors && !isMismatch ? "full" : "text-only",
      },
    },
    upstreamTextIndex: input.textIndexReady ? "ready" : (input.textIndexUsability === "missing" ? "missing" : "invalid"),
    canonicalExists: Boolean(embeddingsPresent || hasValidVectors || isMismatch),
    validForSearchCount: hasValidVectors && !isMismatch ? 1 : 0,
    factsChecking: input.embeddingsChecking,
    publishedIdentity: isMismatch || hasValidVectors || embeddingsPresent ? identity : undefined,
    targetIdentity: isMismatch ? undefined : (hasValidVectors || embeddingsPresent ? identity : undefined),
  });
}

/** `buildSidebarStatusViewModel` for a scenario: the canonical snapshot is derived from the declared facts. */
export function buildSidebarVmForScenario(
  input: Omit<BuildSidebarStatusViewModelInput, "lifecycleSnapshot"> & { lifecycleSnapshot?: EmbeddingLifecycleSnapshot }
) {
  return buildSidebarStatusViewModel({ ...input, lifecycleSnapshot: input.lifecycleSnapshot ?? scenarioSnapshot(input) });
}
