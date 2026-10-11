import {
  mergeTagRecommendations,
  type ContextualTagCandidate,
} from "./tagRecommendation";
import {
  filterAllowedYamlProperties,
  toYamlSuggestionValue,
  type YamlSuggestions,
} from "./yamlRecommendation";
import { listPlannableYamlProperties, type TaxonomyPlan } from "./taxonomyPlan";

export interface TaxonomyAiRequest {
  readonly requestTags: boolean;
  readonly requestedYamlProperties: readonly string[];
  readonly omittedYamlProperties: readonly string[];
}

export type TaxonomyResultSource = "local" | "ai" | "none";

export interface TaxonomyReconciliation {
  readonly tags: readonly string[];
  readonly yaml: YamlSuggestions;
  readonly request: TaxonomyAiRequest;
  readonly tagSource: TaxonomyResultSource;
  readonly yamlSources: Readonly<Record<string, TaxonomyResultSource>>;
}

/**
 * Turns a local plan into the exact taxonomy gaps the existing analysis call
 * may request. No plan means the historical prompt and reconciliation remain
 * in control of the caller.
 */
export function buildTaxonomyAiRequest(plan: TaxonomyPlan): TaxonomyAiRequest {
  const requestedYamlProperties = plan.yaml.properties
    .filter(property => property.needsAi)
    .map(property => property.property);
  const omittedYamlProperties = plan.yaml.properties
    .filter(property => !property.needsAi)
    .map(property => property.property);
  return {
    requestTags: plan.tags.needsAi,
    requestedYamlProperties,
    omittedYamlProperties,
  };
}

function sameProperty(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

/**
 * Combines a precomputed local plan with one existing AI response. Supported
 * local evidence is authoritative; AI is only admitted for explicit gaps.
 */
export function reconcileTaxonomyRecommendations(
  plan: TaxonomyPlan,
  aiTags: readonly string[] | undefined,
  aiYaml: Readonly<Record<string, unknown>> | undefined,
  allowedProperties: string,
  maximumTags: number,
): TaxonomyReconciliation {
  const request = buildTaxonomyAiRequest(plan);
  const localTagCandidates: ContextualTagCandidate[] = plan.tags.needsAi
    ? []
    : plan.tags.candidates.map(candidate => ({
      tag: candidate.tag,
      relatedNoteCount: candidate.support,
      relatedScore: candidate.support,
    }));
  const tags = mergeTagRecommendations(
    request.requestTags ? aiTags ?? [] : [],
    localTagCandidates,
    maximumTags,
  );

  const allowedAiYaml = filterAllowedYamlProperties(aiYaml ?? {}, allowedProperties);
  const yaml: YamlSuggestions = {};
  const yamlSources: Record<string, TaxonomyResultSource> = {};

  for (const property of plan.yaml.properties) {
    if (property.source !== "local" || !property.candidate) continue;
    const value = toYamlSuggestionValue(property.candidate.value);
    if (value === undefined) continue;
    yaml[property.property] = value;
    yamlSources[property.property] = "local";
  }

  for (const requestedProperty of request.requestedYamlProperties) {
    const entry = Object.entries(allowedAiYaml)
      .find(([property]) => sameProperty(property, requestedProperty));
    if (!entry || Object.keys(yaml).some(property => sameProperty(property, requestedProperty))) continue;
    yaml[requestedProperty] = entry[1];
    yamlSources[requestedProperty] = "ai";
  }

  for (const property of listPlannableYamlProperties(allowedProperties)) {
    if (!(property in yamlSources)) yamlSources[property] = "none";
  }

  return {
    tags,
    yaml,
    request,
    tagSource: plan.tags.needsAi ? (tags.length > 0 ? "ai" : "none") : "local",
    yamlSources,
  };
}
