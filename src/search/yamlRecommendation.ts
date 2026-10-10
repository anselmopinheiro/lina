/** UI-independent YAML suggestion validation and proposal preparation. */

export type YamlSuggestionValue = string | string[];
export type YamlSuggestions = Record<string, YamlSuggestionValue>;

export type YamlProposalStatus = "already_exists" | "conflict" | "new";

export interface YamlProposal {
  readonly property: string;
  readonly value: YamlSuggestionValue;
  readonly valueText: string;
  readonly status: YamlProposalStatus;
  readonly existingValue?: string;
}

export interface YamlProposalOptions {
  readonly keyMatching: "exact" | "case-insensitive";
  readonly emptyExistingValue: "new" | "already_exists";
}

export interface RelatedYamlSource {
  readonly yaml: YamlSuggestions;
  readonly score?: number;
}

export interface ContextualYamlCandidate {
  readonly property: string;
  readonly value: YamlSuggestionValue;
  readonly valueText: string;
  readonly pairNoteCount: number;
  readonly relatedScore: number;
  readonly propertyNoteCount: number;
}

/** Keeps the established allow-list behavior and reserves tags for its own flow. */
export function filterAllowedYamlProperties(
  yaml: YamlSuggestions,
  allowedProperties: string,
): YamlSuggestions {
  const allowed = allowedProperties.split(",").map(property => property.trim().toLowerCase());
  const filtered: YamlSuggestions = {};

  for (const [property, value] of Object.entries(yaml)) {
    if (allowed.includes(property.toLowerCase()) && property.toLowerCase() !== "tags") {
      filtered[property] = value;
    }
  }

  return filtered;
}

/** Parses the lightweight frontmatter representation already used by Lina. */
export function parseFrontmatterProperties(frontmatter: string): Map<string, string> {
  const properties = new Map<string, string>();

  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const property = trimmed.substring(0, colonIndex).trim();
      properties.set(property, trimmed.substring(colonIndex + 1).trim());
    }
  }

  return properties;
}

export function findYamlExistingProperty(
  existingProperties: ReadonlyMap<string, string>,
  property: string,
  keyMatching: YamlProposalOptions["keyMatching"],
): string | undefined {
  if (keyMatching === "exact") return existingProperties.get(property);

  for (const [existingProperty, existingValue] of existingProperties) {
    if (existingProperty.toLowerCase() === property.toLowerCase()) return existingValue;
  }

  return undefined;
}

/** Builds neutral proposal states while preserving each existing caller's comparison rules. */
export function buildYamlProposals(
  yaml: YamlSuggestions,
  existingProperties: ReadonlyMap<string, string>,
  options: YamlProposalOptions,
): YamlProposal[] {
  return Object.entries(yaml).map(([property, value]) => {
    const valueText = Array.isArray(value) ? value.join(", ") : String(value);
    const existingValue = findYamlExistingProperty(existingProperties, property, options.keyMatching);
    const exists = existingValue !== undefined && (
      existingValue.length > 0 || options.emptyExistingValue === "already_exists"
    );

    if (!exists) return { property, value, valueText, status: "new" };
    if (existingValue === valueText || existingValue.length === 0) {
      return { property, value, valueText, status: "already_exists" };
    }
    return { property, value, valueText, status: "conflict", existingValue };
  });
}

/**
 * Aggregates real frontmatter values from already-selected related notes.
 * Pair frequency is primary; existing related-note scores and the property
 * frequency only break ties, leaving a stable lexical final tie-break.
 */
export function buildContextualYamlCandidates(
  relatedSources: readonly RelatedYamlSource[],
  allowedProperties: string,
): ContextualYamlCandidate[] {
  const candidates = new Map<string, {
    property: string;
    value: YamlSuggestionValue;
    valueText: string;
    pairNoteCount: number;
    relatedScore: number;
  }>();
  const propertyNoteCounts = new Map<string, number>();

  for (const source of relatedSources) {
    const score = Number.isFinite(source.score) ? source.score ?? 0 : 0;
    const eligible = filterAllowedYamlProperties(source.yaml, allowedProperties);

    for (const [property, value] of Object.entries(eligible)) {
      const valueText = Array.isArray(value) ? value.join(", ") : String(value);
      const candidateKey = `${property}\u0000${valueText}`;
      const existing = candidates.get(candidateKey);
      candidates.set(candidateKey, {
        property,
        value,
        valueText,
        pairNoteCount: (existing?.pairNoteCount ?? 0) + 1,
        relatedScore: (existing?.relatedScore ?? 0) + score,
      });
      propertyNoteCounts.set(property, (propertyNoteCounts.get(property) ?? 0) + 1);
    }
  }

  return Array.from(candidates.values(), candidate => ({
    ...candidate,
    propertyNoteCount: propertyNoteCounts.get(candidate.property) ?? 0,
  })).sort((left, right) =>
    right.pairNoteCount - left.pairNoteCount ||
    right.relatedScore - left.relatedScore ||
    right.propertyNoteCount - left.propertyNoteCount ||
    left.property.localeCompare(right.property) ||
    left.valueText.localeCompare(right.valueText),
  );
}

/**
 * Uses the existing LLM property count as a fixed capacity. Contextual values
 * may replace LLM values but cannot increase the final number of properties.
 */
export function mergeYamlRecommendations(
  llmYaml: YamlSuggestions,
  contextualCandidates: readonly ContextualYamlCandidate[],
  allowedProperties: string,
): YamlSuggestions {
  const allowedLlmYaml = filterAllowedYamlProperties(llmYaml, allowedProperties);
  const capacity = Object.keys(allowedLlmYaml).length;
  if (capacity === 0 || contextualCandidates.length === 0) return allowedLlmYaml;

  const merged: YamlSuggestions = {};
  for (const candidate of contextualCandidates) {
    if (Object.prototype.hasOwnProperty.call(merged, candidate.property)) continue;
    merged[candidate.property] = candidate.value;
    if (Object.keys(merged).length === capacity) return merged;
  }

  for (const [property, value] of Object.entries(allowedLlmYaml)) {
    if (Object.prototype.hasOwnProperty.call(merged, property)) continue;
    merged[property] = value;
    if (Object.keys(merged).length === capacity) break;
  }

  return merged;
}
