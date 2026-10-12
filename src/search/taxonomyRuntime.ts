import type { SemanticTaxonomyExperimentResult } from "./semanticTaxonomyExperiment";
import { buildTaxonomyPlan, type TaxonomyPlan, type TaxonomyPlanOptions } from "./taxonomyPlan";
import {
  buildTaxonomyAiRequest,
  reconcileTaxonomyRecommendations,
  type TaxonomyAiRequest,
  type TaxonomyReconciliation,
} from "./taxonomyReconciliation";

/**
 * Pure boundary between locally collected evidence and the view. It decides what
 * the single existing AI call must still provide and how its answer is merged.
 * It performs no I/O, no network, no embedding and no write.
 */
export interface TaxonomyRuntimePlan {
  readonly experiment: SemanticTaxonomyExperimentResult;
  readonly plan: TaxonomyPlan;
  readonly request: TaxonomyAiRequest;
}

export function prepareTaxonomyRuntime(
  experiment: SemanticTaxonomyExperimentResult,
  options: TaxonomyPlanOptions,
): TaxonomyRuntimePlan {
  const plan = buildTaxonomyPlan(experiment, options);
  return { experiment, plan, request: buildTaxonomyAiRequest(plan) };
}

/** Reconciles one existing AI response; it never starts a second request. */
export function reconcileTaxonomyRuntime(
  runtime: TaxonomyRuntimePlan | undefined,
  aiTags: readonly string[] | undefined,
  aiYaml: Readonly<Record<string, unknown>> | undefined,
  allowedProperties: string,
  maximumTags: number,
): TaxonomyReconciliation | undefined {
  return runtime === undefined
    ? undefined
    : reconcileTaxonomyRecommendations(runtime.plan, aiTags, aiYaml, allowedProperties, maximumTags);
}

/** Local suggestions that remain reviewable when the existing AI request fails. */
export function fallbackTaxonomyRuntime(
  runtime: TaxonomyRuntimePlan | undefined,
  allowedProperties: string,
  maximumTags: number,
): TaxonomyReconciliation | undefined {
  return reconcileTaxonomyRuntime(runtime, [], {}, allowedProperties, maximumTags);
}
