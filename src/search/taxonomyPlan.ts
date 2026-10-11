import type {
  LocalTagRecommendation,
  LocalYamlRecommendation,
  SemanticTaxonomyExperimentResult,
} from "./semanticTaxonomyExperiment";
import { toYamlSuggestionValue, type YamlMetadataScalar } from "./yamlRecommendation";

/**
 * Local-first taxonomy planning.
 *
 * Pure and deterministic: decides, from an already computed local result, what
 * can be resolved locally and what still needs AI. It never calls a provider,
 * never generates embeddings, never reads or writes notes, and carries only
 * counts and the chosen candidate (no vectors, no probabilities).
 */

/** Neighbors that must use an item before local evidence is trusted. */
export const TAXONOMY_MINIMUM_SUPPORT = 2;
/** Tags with that support that make the local tag result sufficient. */
export const TAXONOMY_MINIMUM_QUALIFYING_TAGS = 1;

export type TaxonomyLocalSufficiency = "LOCAL_SUFFICIENT" | "LOCAL_INSUFFICIENT";
export type TaxonomyPlanSource = "local" | "ai-needed" | "none";

export type TaxonomyTagPlanReason = "local-supported" | "no-qualifying-tag" | "neighborhood-unavailable";
export type TaxonomyYamlPlanReason =
  | "local-supported"
  | "no-candidate"
  | "insufficient-support"
  | "ambiguous"
  | "not-writable"
  | "neighborhood-unavailable";

export interface TaxonomyTagCandidatePlan {
  readonly tag: string;
  readonly support: number;
  readonly neighborTotal: number;
}

export interface TaxonomyTagPlan {
  readonly sufficiency: TaxonomyLocalSufficiency;
  readonly source: Exclude<TaxonomyPlanSource, "none">;
  readonly needsAi: boolean;
  readonly reason: TaxonomyTagPlanReason;
  readonly candidates: readonly TaxonomyTagCandidatePlan[];
  readonly evidence: {
    readonly neighborTotal: number;
    readonly minimumSupport: number;
    readonly qualifyingCount: number;
    readonly requiredCount: number;
  };
}

export interface TaxonomyYamlPropertyPlan {
  readonly property: string;
  readonly source: TaxonomyPlanSource;
  readonly needsAi: boolean;
  readonly reason: TaxonomyYamlPlanReason;
  readonly candidate?: {
    readonly value: YamlMetadataScalar;
    readonly support: number;
    readonly neighborTotal: number;
  };
  readonly evidence: {
    readonly neighborTotal: number;
    readonly minimumSupport: number;
    readonly bestSupport: number;
  };
}

export interface TaxonomyPlan {
  readonly neighborhoodStatus: SemanticTaxonomyExperimentResult["neighborhoodStatus"];
  readonly neighborTotal: number;
  readonly tags: TaxonomyTagPlan;
  readonly yaml: {
    readonly enabled: boolean;
    readonly properties: readonly TaxonomyYamlPropertyPlan[];
    readonly needsAi: boolean;
  };
  readonly needsAi: boolean;
}

export interface TaxonomyPlanOptions {
  readonly yamlAllowedProperties: string;
  /** When false the YAML suggestion feature is off and the YAML plan is empty. */
  readonly yamlEnabled?: boolean;
  readonly minimumSupport?: number;
  readonly minimumQualifyingTags?: number;
}

/** Allowed properties in configured order, case-insensitively unique, without `tags`. */
export function listPlannableYamlProperties(allowedProperties: string): string[] {
  const seen = new Set<string>();
  const properties: string[] = [];
  for (const raw of allowedProperties.split(",")) {
    const property = raw.trim();
    const key = property.toLocaleLowerCase();
    if (!property || key === "tags" || seen.has(key)) continue;
    seen.add(key);
    properties.push(property);
  }
  return properties;
}

function planTags(
  tags: readonly LocalTagRecommendation[],
  neighborTotal: number,
  available: boolean,
  minimumSupport: number,
  requiredCount: number,
): TaxonomyTagPlan {
  const candidates = tags
    .filter(tag => tag.neighborCount >= minimumSupport)
    .map(tag => ({ tag: tag.tag, support: tag.neighborCount, neighborTotal: tag.neighborTotal }));
  const sufficient = available && candidates.length >= requiredCount;
  return {
    sufficiency: sufficient ? "LOCAL_SUFFICIENT" : "LOCAL_INSUFFICIENT",
    source: sufficient ? "local" : "ai-needed",
    needsAi: !sufficient,
    reason: !available ? "neighborhood-unavailable" : sufficient ? "local-supported" : "no-qualifying-tag",
    candidates: sufficient ? candidates : [],
    evidence: { neighborTotal, minimumSupport, qualifyingCount: candidates.length, requiredCount },
  };
}

function planYamlProperty(
  property: string,
  winners: readonly LocalYamlRecommendation[],
  evidence: readonly LocalYamlRecommendation[],
  neighborTotal: number,
  available: boolean,
  minimumSupport: number,
): TaxonomyYamlPropertyPlan {
  const key = property.toLocaleLowerCase();
  const evidenceBase = { neighborTotal, minimumSupport };
  if (!available) {
    return { property, source: "ai-needed", needsAi: true, reason: "neighborhood-unavailable", evidence: { ...evidenceBase, bestSupport: 0 } };
  }

  const candidates = evidence.filter(item => item.property.toLocaleLowerCase() === key);
  const bestSupport = candidates.reduce((best, item) => Math.max(best, item.neighborCount), 0);
  const winner = winners.find(item => item.property.toLocaleLowerCase() === key);

  if (winner) {
    // Evidence may be typed (number/boolean). Only values the existing write
    // contract accepts can become a proposal; typing is never coerced.
    if (toYamlSuggestionValue(winner.value) === undefined) {
      return { property, source: "none", needsAi: false, reason: "not-writable", evidence: { ...evidenceBase, bestSupport } };
    }
    return {
      property,
      source: "local",
      needsAi: false,
      reason: "local-supported",
      candidate: { value: winner.value, support: winner.neighborCount, neighborTotal: winner.neighborTotal },
      evidence: { ...evidenceBase, bestSupport },
    };
  }

  const reason: TaxonomyYamlPlanReason = candidates.length === 0
    ? "no-candidate"
    : bestSupport >= minimumSupport ? "ambiguous" : "insufficient-support";
  return { property, source: "ai-needed", needsAi: true, reason, evidence: { ...evidenceBase, bestSupport } };
}

export function buildTaxonomyPlan(
  result: SemanticTaxonomyExperimentResult,
  options: TaxonomyPlanOptions,
): TaxonomyPlan {
  const minimumSupport = options.minimumSupport ?? TAXONOMY_MINIMUM_SUPPORT;
  const requiredTags = options.minimumQualifyingTags ?? TAXONOMY_MINIMUM_QUALIFYING_TAGS;
  const available = result.neighborhoodStatus === "ok";
  const neighborTotal = result.neighbors.length;
  const yamlEnabled = options.yamlEnabled ?? true;

  const tags = planTags(result.local.tags, neighborTotal, available, minimumSupport, requiredTags);
  const properties = yamlEnabled
    ? listPlannableYamlProperties(options.yamlAllowedProperties).map(property =>
      planYamlProperty(property, result.local.yaml, result.local.yamlEvidence, neighborTotal, available, minimumSupport))
    : [];
  const yamlNeedsAi = properties.some(property => property.needsAi);

  return {
    neighborhoodStatus: result.neighborhoodStatus,
    neighborTotal,
    tags,
    yaml: { enabled: yamlEnabled, properties, needsAi: yamlNeedsAi },
    needsAi: tags.needsAi || yamlNeedsAi,
  };
}
