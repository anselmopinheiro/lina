import { activeProducerRuntime } from "./producerRuntimeState";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import type { EmbeddingLifecycleSnapshot } from "../../src/index/embeddingLifecycleModel";
import {
  buildEmbeddingStatusViewModel,
  type BuildEmbeddingStatusViewModelInput,
} from "../../src/search/embeddingStatusViewModel";

type ScenarioInput = Omit<BuildEmbeddingStatusViewModelInput, "lifecycleSnapshot"> & { lifecycleSnapshot?: EmbeddingLifecycleSnapshot };

/** Canonical snapshot for an embedding-status test scenario (test-only; LINA-15D-B / S7). */
export function embeddingStatusScenarioSnapshot(input: ScenarioInput): EmbeddingLifecycleSnapshot {
  const summary = input.workState.summary;
  const updatePlan = summary?.updatePlan;
  const identity = {
    provider: summary?.provider ?? input.configuredProvider,
    model: summary?.model ?? input.configuredModel,
    dimensions: summary?.dimensions ?? updatePlan?.targetIdentity?.dimensions ?? 768,
    inputVersion: updatePlan?.targetIdentity?.inputVersion ?? 1,
    prefixMode: (summary?.manifestPrefixMode ?? summary?.expectedPrefixMode ?? updatePlan?.targetIdentity?.prefixMode ?? "none") as "none" | "nomic-search-query-document",
  };
  return adaptCurrentStateToLifecycleSnapshot({
    deviceRuntimeState: activeProducerRuntime(),
    updatePlan,
    operationState: input.operationState,
    upstreamTextIndex: input.indexReady ? "ready" : "missing",
    canonicalExists: Boolean(summary) && (input.embeddingsReady || summary?.exists === true || summary?.updatePlan?.mode === "full-rebuild"),
    validForSearchCount: summary?.validForSearchCount ?? summary?.validCount ?? (input.embeddingsReady ? 1 : 0),
    publishedIdentity: summary || input.embeddingsReady ? identity : undefined,
    targetIdentity: {
      provider: input.configuredProvider,
      model: input.configuredModel,
      dimensions: updatePlan?.targetIdentity?.dimensions,
      inputVersion: updatePlan?.targetIdentity?.inputVersion ?? 1,
      prefixMode: updatePlan?.targetIdentity?.prefixMode ?? "none",
    },
  });
}

export function buildEmbeddingVmForScenario(input: ScenarioInput) {
  return buildEmbeddingStatusViewModel({ ...input, lifecycleSnapshot: input.lifecycleSnapshot ?? embeddingStatusScenarioSnapshot(input) });
}
