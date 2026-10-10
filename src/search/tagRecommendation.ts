/**
 * UI-independent tag inventory and proposal preparation.
 *
 * This module deliberately does not generate recommendations. It preserves the
 * existing LLM-provided tags, then normalizes and annotates them for consumers.
 */

export interface ExistingVaultTag {
  readonly normalized: string;
  readonly count: number;
}

export interface TagProposal {
  readonly tag: string;
  readonly existsInVault: boolean;
  readonly usageCount?: number;
  readonly existsInNote?: boolean;
}

/** Tag evidence collected from one already-selected related note. */
export interface RelatedTagSource {
  readonly tags: readonly string[];
  readonly score?: number;
}

/** A deterministic contextual candidate and the signals that produced it. */
export interface ContextualTagCandidate {
  readonly tag: string;
  readonly relatedNoteCount: number;
  readonly relatedScore: number;
  readonly globalUsageCount?: number;
}

export type VaultTagCounts = Readonly<Record<string, unknown>>;

/** Preserves the established normalization contract for Lina tag suggestions. */
export function normalizeTag(tag: string): string {
  let normalized = tag.trim().toLowerCase();
  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  normalized = normalized.replace(/\s+/g, "_");
  return normalized.replace(/[^a-z0-9_-]/g, "");
}

/** Normalizes, removes empty tags, and preserves the first occurrence order. */
export function normalizeTags(tags: readonly string[]): string[] {
  const normalized = tags.map(normalizeTag).filter((tag) => tag.length > 0);
  return [...new Set(normalized)];
}

/** Builds a normalized inventory from Obsidian's metadata-cache tag counts. */
export function buildTagInventory(rawTags: VaultTagCounts): Map<string, ExistingVaultTag> {
  const inventory = new Map<string, ExistingVaultTag>();

  for (const [original, rawCount] of Object.entries(rawTags)) {
    const normalized = normalizeTag(original);
    if (!normalized) continue;
    const count = typeof rawCount === "number" ? rawCount : 0;
    const existing = inventory.get(normalized);
    inventory.set(normalized, {
      normalized,
      count: (existing?.count ?? 0) + count,
    });
  }

  return inventory;
}

/**
 * Converts raw LLM output into UI-neutral proposals without adding any ranking.
 */
export function prepareTagProposals(
  rawTags: readonly string[],
  inventory: ReadonlyMap<string, ExistingVaultTag>,
  maximum?: number,
  existingNoteTags?: ReadonlySet<string>,
): TagProposal[] {
  const normalized = normalizeTags(rawTags);
  const limited = maximum === undefined ? normalized : normalized.slice(0, maximum);

  return limited.map((tag) => {
    const existing = inventory.get(tag);
    const existsInNote = existingNoteTags?.has(tag);
    return {
      tag,
      existsInVault: Boolean(existing),
      ...(existing ? { usageCount: existing.count } : {}),
      ...(existsInNote === undefined ? {} : { existsInNote }),
    };
  });
}

/**
 * Aggregates tags already present in related notes. Frequency is the primary
 * signal because it is the least speculative evidence; existing related-note
 * scores and vault usage only provide deterministic tie-breaks.
 */
export function buildContextualTagCandidates(
  relatedSources: readonly RelatedTagSource[],
  inventory: ReadonlyMap<string, ExistingVaultTag>,
): ContextualTagCandidate[] {
  const candidates = new Map<string, { relatedNoteCount: number; relatedScore: number }>();

  for (const source of relatedSources) {
    const score = Number.isFinite(source.score) ? source.score ?? 0 : 0;
    for (const tag of normalizeTags(source.tags)) {
      const existing = candidates.get(tag) ?? { relatedNoteCount: 0, relatedScore: 0 };
      candidates.set(tag, {
        relatedNoteCount: existing.relatedNoteCount + 1,
        relatedScore: existing.relatedScore + score,
      });
    }
  }

  return Array.from(candidates, ([tag, evidence]) => {
    const globalUsageCount = inventory.get(tag)?.count;
    return {
      tag,
      relatedNoteCount: evidence.relatedNoteCount,
      relatedScore: evidence.relatedScore,
      ...(globalUsageCount === undefined ? {} : { globalUsageCount }),
    };
  }).sort((left, right) =>
    right.relatedNoteCount - left.relatedNoteCount ||
    right.relatedScore - left.relatedScore ||
    (right.globalUsageCount ?? 0) - (left.globalUsageCount ?? 0) ||
    left.tag.localeCompare(right.tag),
  );
}

/**
 * Contextual tags lead the fixed-size list, followed by LLM-only candidates.
 * With no contextual candidate this is exactly the historical LLM pipeline.
 */
export function mergeTagRecommendations(
  llmTags: readonly string[],
  contextualCandidates: readonly ContextualTagCandidate[],
  maximum: number,
): string[] {
  const merged = [...contextualCandidates.map(candidate => candidate.tag), ...llmTags];
  return normalizeTags(merged).slice(0, maximum);
}

/** Formats the existing usage label without coupling proposals to UI strings. */
export function formatTagUsageLabel(count: number, alreadyUsedLabel: string): string {
  return `${alreadyUsedLabel}: ${count}`;
}
