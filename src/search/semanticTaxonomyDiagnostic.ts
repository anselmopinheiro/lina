import { normalizeTagComparisonKey } from "./tagRecommendation";
import type { SemanticTaxonomyExperimentResult } from "./semanticTaxonomyExperiment";
import { TAXONOMY_MINIMUM_SUPPORT, type TaxonomyPlan, type TaxonomyYamlPropertyPlan } from "./taxonomyPlan";

/**
 * TEMPORARY (taxonomy validation phase): read-only comparison between the
 * current engine and the local semantic-neighborhood engine. Pure formatting
 * only; nothing here applies, persists, or requests anything.
 */

export interface SemanticTaxonomyComparisonMetrics {
  readonly sharedTags: readonly string[];
  readonly currentTagCount: number;
  readonly localTagCount: number;
  readonly sharedYaml: readonly string[];
  readonly currentYamlCount: number;
  readonly localYamlCount: number;
  readonly neighborsWithSupport: number;
}

export interface SemanticTaxonomyDiagnostic {
  readonly status: SemanticTaxonomyExperimentResult["neighborhoodStatus"];
  readonly lines: readonly string[];
  readonly metrics: SemanticTaxonomyComparisonMetrics;
}

const MINIMUM_SUPPORT = TAXONOMY_MINIMUM_SUPPORT;
const MAX_NEIGHBORS_LISTED = 10;

const YAML_REASON_LABELS: Record<TaxonomyYamlPropertyPlan["reason"], string> = {
  "local-supported": "local",
  "no-candidate": "IA necessária (sem candidato)",
  "insufficient-support": "IA necessária (suporte insuficiente)",
  "ambiguous": "IA necessária (valores concorrentes)",
  "not-writable": "sem proposta (valor tipado não gravável)",
  "neighborhood-unavailable": "IA necessária (vizinhança indisponível)",
};

function planLines(plan: TaxonomyPlan): string[] {
  const lines = ["", "PLANO"];
  lines.push(plan.tags.needsAi
    ? `Tags: IA necessária (${plan.tags.evidence.qualifyingCount}/${plan.tags.evidence.requiredCount} com suporte ≥${plan.tags.evidence.minimumSupport})`
    : `Tags: local (${plan.tags.candidates.map(item => `${item.tag} ${item.support}/${item.neighborTotal}`).join(", ")})`);
  if (!plan.yaml.enabled) {
    lines.push("YAML: desativado");
    return lines;
  }
  lines.push("YAML:");
  if (plan.yaml.properties.length === 0) lines.push("- —");
  for (const property of plan.yaml.properties) {
    const detail = property.candidate
      ? `${String(property.candidate.value)} · suporte ${property.candidate.support}/${property.candidate.neighborTotal}`
      : YAML_REASON_LABELS[property.reason];
    lines.push(`- ${property.property}: ${property.source === "local" ? `local (${detail})` : detail}`);
  }
  return lines;
}

function yamlPairKey(property: string, value: unknown): string {
  return `${property.trim().toLocaleLowerCase()}=${String(value).trim().toLocaleLowerCase()}`;
}

function currentYamlPairs(yaml: Readonly<Record<string, unknown>>): Array<{ label: string; key: string }> {
  const pairs: Array<{ label: string; key: string }> = [];
  for (const [property, raw] of Object.entries(yaml)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value === undefined || value === null) continue;
      pairs.push({ label: `${property}=${String(value)}`, key: yamlPairKey(property, value) });
    }
  }
  return pairs;
}

export function buildSemanticTaxonomyDiagnostic(
  result: SemanticTaxonomyExperimentResult,
  plan?: TaxonomyPlan,
): SemanticTaxonomyDiagnostic {
  const currentTags = result.current.tags;
  const currentYaml = currentYamlPairs(result.current.yaml);
  const lines: string[] = [];

  lines.push("MOTOR ATUAL");
  lines.push(`Tags: ${currentTags.length > 0 ? currentTags.join(", ") : "—"}`);
  lines.push(`YAML: ${currentYaml.length > 0 ? currentYaml.map(pair => pair.label).join(", ") : "—"}`);
  lines.push("");
  lines.push("MOTOR LOCAL");

  if (result.neighborhoodStatus !== "ok") {
    lines.push(`Vizinhança indisponível: ${result.neighborhoodStatus}`);
    if (plan) lines.push(...planLines(plan));
    return {
      status: result.neighborhoodStatus,
      lines,
      metrics: {
        sharedTags: [],
        currentTagCount: currentTags.length,
        localTagCount: 0,
        sharedYaml: [],
        currentYamlCount: currentYaml.length,
        localYamlCount: 0,
        neighborsWithSupport: 0,
      },
    };
  }

  const total = result.neighbors.length;
  const currentTagKeys = new Set(currentTags.map(normalizeTagComparisonKey));
  const sharedTags = result.local.tags
    .map(entry => entry.tag)
    .filter(tag => currentTagKeys.has(normalizeTagComparisonKey(tag)));

  lines.push("Tags:");
  if (result.local.tags.length === 0) {
    lines.push("  —");
  } else {
    for (const entry of result.local.tags) {
      const weak = entry.neighborCount < MINIMUM_SUPPORT ? " · suporte fraco" : "";
      const global = entry.globalUsageCount !== undefined ? ` · vault ${entry.globalUsageCount}` : "";
      lines.push(`  ${entry.tag} — suporte ${entry.neighborCount}/${entry.neighborTotal} · Σsim ${entry.similarityTotal.toFixed(2)}${global}${weak}`);
    }
  }

  lines.push("YAML:");
  if (result.local.yaml.length === 0) {
    lines.push("  —");
  } else {
    for (const entry of result.local.yaml) {
      lines.push(`  ${entry.property}=${String(entry.value)} — suporte ${entry.neighborCount}/${entry.neighborTotal}`);
    }
  }

  const currentYamlKeys = new Set(currentYaml.map(pair => pair.key));
  const sharedYaml = result.local.yaml
    .filter(entry => currentYamlKeys.has(yamlPairKey(entry.property, entry.value)))
    .map(entry => `${entry.property}=${String(entry.value)}`);
  const neighborsWithSupport = result.local.tags.filter(entry => entry.neighborCount >= MINIMUM_SUPPORT).length;

  lines.push("");
  lines.push("Evidência:");
  lines.push(`  Vizinhos usados: ${total}`);
  for (const neighbor of result.neighbors.slice(0, MAX_NEIGHBORS_LISTED)) {
    lines.push(`  ${neighbor.path} (${neighbor.score.toFixed(2)})`);
  }
  lines.push(`  Tags em comum: ${sharedTags.length}/${Math.max(currentTags.length, result.local.tags.length)}`);
  lines.push(`  YAML coincidente: ${sharedYaml.length}/${Math.max(currentYaml.length, result.local.yaml.length)}`);
  lines.push(`  Tags locais com suporte ≥${MINIMUM_SUPPORT}: ${neighborsWithSupport}`);
  if (plan) lines.push(...planLines(plan));

  return {
    status: "ok",
    lines,
    metrics: {
      sharedTags,
      currentTagCount: currentTags.length,
      localTagCount: result.local.tags.length,
      sharedYaml,
      currentYamlCount: currentYaml.length,
      localYamlCount: result.local.yaml.length,
      neighborsWithSupport,
    },
  };
}
