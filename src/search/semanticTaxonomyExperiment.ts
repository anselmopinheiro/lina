import { RuntimeEmbeddingIndex } from "./runtimeEmbeddingIndex";
import { findSemanticNeighborhood, SemanticNeighbor, SemanticNeighborhoodStatus } from "./semanticNeighborhood";
import { readYamlMetadataScalars, yamlComparisonKey, type YamlMetadataScalar } from "./yamlRecommendation";
import { TAXONOMY_MINIMUM_SUPPORT } from "./taxonomyPlan";

type MetadataTag = { readonly tag: string };
type MetadataFileCache = {
  readonly tags?: readonly MetadataTag[];
  readonly frontmatter?: Readonly<Record<string, unknown>>;
};

/** Structural subset of Obsidian's public metadataCache used by this experiment. */
export interface SemanticTaxonomyMetadataCache {
  getFileCache(file: unknown): MetadataFileCache | null;
  getTags?(): Readonly<Record<string, number>>;
}

export interface SemanticTaxonomyFileResolver {
  getAbstractFileByPath(path: string): unknown;
}

export interface LocalTagRecommendation {
  readonly tag: string;
  readonly neighborCount: number;
  readonly neighborTotal: number;
  readonly similarityTotal: number;
  readonly globalUsageCount?: number;
}

export interface LocalYamlRecommendation {
  readonly property: string;
  readonly value: YamlMetadataScalar;
  readonly neighborCount: number;
  readonly neighborTotal: number;
  readonly similarityTotal: number;
}

export interface SemanticTaxonomyExperimentResult {
  readonly neighborhoodStatus: SemanticNeighborhoodStatus;
  readonly neighbors: readonly SemanticNeighbor[];
  readonly current: { readonly tags: readonly string[]; readonly yaml: Readonly<Record<string, unknown>> };
  readonly local: {
    readonly tags: readonly LocalTagRecommendation[];
    readonly yaml: readonly LocalYamlRecommendation[];
    /** Every observed property/value with its support, sorted; `yaml` holds only the winners. */
    readonly yamlEvidence: readonly LocalYamlRecommendation[];
  };
}

export interface SemanticTaxonomyExperimentOptions {
  readonly topK: number;
  readonly maxTags: number;
  readonly yamlAllowedProperties: string;
  readonly minimumTagSupport?: number;
  readonly minimumYamlSupport?: number;
  readonly current?: { readonly tags?: readonly string[]; readonly yaml?: Readonly<Record<string, unknown>> };
}

type TagEvidence = LocalTagRecommendation;
type YamlEvidence = LocalYamlRecommendation;

function tagIdentity(tag: string): string {
  return tag.trim().replace(/^#/, "").toLocaleLowerCase();
}

function readMetadataTags(cache: MetadataFileCache): string[] {
  const tags = new Map<string, string>();
  for (const tag of cache.tags ?? []) {
    const preserved = tag.tag.trim().replace(/^#/, "");
    if (preserved) tags.set(tagIdentity(preserved), preserved);
  }
  const frontmatterTags = cache.frontmatter?.tags;
  const values = Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const preserved = value.trim().replace(/^#/, "");
    if (preserved) tags.set(tagIdentity(preserved), preserved);
  }
  return [...tags.values()];
}

function allowedYamlProperties(value: string): Set<string> {
  return new Set(value.split(",").map(property => property.trim().toLocaleLowerCase()).filter(Boolean));
}

/**
 * Builds an experimental, local-only taxonomy from semantic neighbors and
 * Obsidian metadata. It never reads note contents, generates embeddings, or
 * invokes a provider; the caller supplies the already-resident runtime index.
 */
export function runSemanticTaxonomyExperiment(
  index: RuntimeEmbeddingIndex,
  sourcePath: string,
  metadataCache: SemanticTaxonomyMetadataCache,
  files: SemanticTaxonomyFileResolver,
  options: SemanticTaxonomyExperimentOptions,
): SemanticTaxonomyExperimentResult {
  const current = { tags: options.current?.tags ?? [], yaml: options.current?.yaml ?? {} };
  const neighborhood = findSemanticNeighborhood(index, sourcePath, options.topK);
  if (neighborhood.status !== "ok") {
    return { neighborhoodStatus: neighborhood.status, neighbors: [], current, local: { tags: [], yaml: [], yamlEvidence: [] } };
  }

  const neighborTotal = neighborhood.neighbors.length;
  const tagEvidence = new Map<string, TagEvidence>();
  const yamlEvidence = new Map<string, YamlEvidence>();
  const allowed = allowedYamlProperties(options.yamlAllowedProperties);
  const globalTags = metadataCache.getTags?.() ?? {};

  for (const neighbor of neighborhood.neighbors) {
    const file = files.getAbstractFileByPath(neighbor.path);
    if (!file) continue;
    const metadata = metadataCache.getFileCache(file);
    if (!metadata) continue;

    for (const tag of readMetadataTags(metadata)) {
      const key = tagIdentity(tag);
      const previous = tagEvidence.get(key);
      tagEvidence.set(key, {
        tag: previous?.tag ?? tag,
        neighborCount: (previous?.neighborCount ?? 0) + 1,
        neighborTotal,
        similarityTotal: (previous?.similarityTotal ?? 0) + neighbor.score,
        ...(previous?.globalUsageCount !== undefined
          ? { globalUsageCount: previous.globalUsageCount }
          : typeof globalTags[`#${tag}`] === "number" ? { globalUsageCount: globalTags[`#${tag}`] } : {}),
      });
    }

    for (const [property, rawValue] of Object.entries(metadata.frontmatter ?? {})) {
      const propertyKey = property.toLocaleLowerCase();
      if (!allowed.has(propertyKey) || propertyKey === "tags") continue;
      const valuesInNeighbor = new Set<string>();
      for (const value of readYamlMetadataScalars(rawValue) ?? []) {
        const valueKey = yamlComparisonKey(value);
        if (!valueKey) continue;
        if (valuesInNeighbor.has(valueKey)) continue;
        valuesInNeighbor.add(valueKey);
        const key = `${propertyKey}\u0000${valueKey}`;
        const previous = yamlEvidence.get(key);
        yamlEvidence.set(key, {
          property: previous?.property ?? property,
          value: previous?.value ?? value,
          neighborCount: (previous?.neighborCount ?? 0) + 1,
          neighborTotal,
          similarityTotal: (previous?.similarityTotal ?? 0) + neighbor.score,
        });
      }
    }
  }

  const minimumTagSupport = options.minimumTagSupport ?? TAXONOMY_MINIMUM_SUPPORT;
  const tags = [...tagEvidence.values()].sort((left, right) =>
    (right.neighborCount >= minimumTagSupport ? 1 : 0) - (left.neighborCount >= minimumTagSupport ? 1 : 0)
    || right.neighborCount - left.neighborCount
    || right.similarityTotal - left.similarityTotal
    || (right.globalUsageCount ?? 0) - (left.globalUsageCount ?? 0)
    || left.tag.localeCompare(right.tag),
  ).slice(0, options.maxTags);

  const minimumYamlSupport = options.minimumYamlSupport ?? TAXONOMY_MINIMUM_SUPPORT;
  const yamlByProperty = new Map<string, YamlEvidence[]>();
  for (const evidence of yamlEvidence.values()) {
    const values = yamlByProperty.get(evidence.property.toLocaleLowerCase()) ?? [];
    values.push(evidence);
    yamlByProperty.set(evidence.property.toLocaleLowerCase(), values);
  }
  const yaml: LocalYamlRecommendation[] = [];
  const yamlEvidenceSorted: LocalYamlRecommendation[] = [];
  for (const values of yamlByProperty.values()) {
    values.sort((left, right) => right.neighborCount - left.neighborCount || right.similarityTotal - left.similarityTotal || String(left.value).localeCompare(String(right.value)));
    const winner = values[0];
    const runnerUp = values[1];
    yamlEvidenceSorted.push(...values);
    if (!winner || winner.neighborCount < minimumYamlSupport) continue;
    if (runnerUp && runnerUp.neighborCount === winner.neighborCount && Math.abs(runnerUp.similarityTotal - winner.similarityTotal) < 0.000001) continue;
    yaml.push(winner);
  }
  yaml.sort((left, right) => left.property.localeCompare(right.property));
  // Array#sort is stable: the per-property support ordering above is preserved.
  yamlEvidenceSorted.sort((left, right) => left.property.localeCompare(right.property));

  return {
    neighborhoodStatus: "ok",
    neighbors: neighborhood.neighbors,
    current,
    local: { tags, yaml, yamlEvidence: yamlEvidenceSorted },
  };
}
