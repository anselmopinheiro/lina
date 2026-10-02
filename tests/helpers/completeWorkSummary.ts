import {
  EmbeddingWorkStatusController,
  type EmbeddingWorkStatusControllerOptions,
  type EmbeddingWorkSummary,
} from "../../src/index/embeddingWorkStatusController";
import { activeProducerRuntime } from "./producerRuntimeState";

/**
 * Completes a count-based legacy fixture with the facts production always provides
 * (real published identity and an update plan), so tests do not rely on fabricated defaults.
 */
export function completeSummary(summary: EmbeddingWorkSummary): EmbeddingWorkSummary {
  const identity = {
    provider: summary.provider ?? "ollama",
    model: summary.model ?? "nomic-embed-text",
    dimensions: summary.dimensions && summary.dimensions > 0 ? summary.dimensions : 768,
    inputVersion: 1,
    prefixMode: "none" as const,
  };
  const missing = summary.missingCount ?? 0;
  const stale = summary.staleCount ?? 0;
  const obsolete = summary.obsoleteCount ?? 0;
  return {
    ...summary,
    publishedIdentity: summary.publishedIdentity ?? identity,
    updatePlan: summary.updatePlan ? { ...summary.updatePlan, targetIdentity: summary.updatePlan.targetIdentity ?? identity } : {
      mode: "incremental",
      totalChunks: summary.totalChunks ?? 0,
      missingCount: missing,
      staleToReplaceCount: stale,
      obsoleteToDropCount: obsolete,
      toGenerateCount: missing + stale,
      reusableCanonicalCount: summary.validCount ?? 0,
      recoverableCheckpointCount: summary.recoverableCheckpointCount ?? 0,
      requiresPublication:
        missing > 0 || stale > 0 || obsolete > 0 || (summary.duplicateRecordCount ?? 0) > 0 || (summary.invalidRecordCount ?? 0) > 0,
      reasons: [],
      targetIdentity: identity,
    },
  };
}

/** Controller whose summaries carry the production facts and whose runtime is an active Producer. */
export function createControllerWithFacts(
  options: Omit<EmbeddingWorkStatusControllerOptions, "getDeviceRuntimeState"> & {
    getDeviceRuntimeState?: EmbeddingWorkStatusControllerOptions["getDeviceRuntimeState"];
  }
): EmbeddingWorkStatusController {
  return new EmbeddingWorkStatusController({
    getDeviceRuntimeState: () => activeProducerRuntime(),
    ...options,
    refreshSummary: async () => {
      const summary = await options.refreshSummary();
      return summary ? completeSummary(summary) : summary;
    },
  });
}
