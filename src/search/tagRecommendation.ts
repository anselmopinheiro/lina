/**
 * UI-independent tag inventory and proposal preparation.
 *
 * This module deliberately does not generate recommendations. It preserves the
 * existing LLM-provided tags, then normalizes and annotates them for consumers.
 */

export interface ExistingVaultTag {
  /** Comparison key only; never render or write this value as a tag. */
  readonly comparisonKey: string;
  /** The tag identity supplied by Obsidian's metadata cache. */
  readonly identity: string;
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

/**
 * Preserves a tag value for display and writing. Obsidian already supplies
 * valid tag values; this only removes presentation syntax and invalid legacy
 * punctuation. In particular, hierarchy separators remain part of identity.
 */
export function preserveTagIdentity(tag: string): string {
  let identity = tag.trim().replace(/^#/, "");
  identity = identity.normalize("NFC").replace(/\s+/g, "_");
  return identity.replace(/[^\p{L}\p{N}_/-]/gu, "");
}

/**
 * Produces a comparison-only key. It retains `/` so a hierarchical tag can
 * never collide with the equivalent flattened spelling.
 */
export function normalizeTagComparisonKey(tag: string): string {
  let normalized = tag.trim().toLowerCase();
  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  normalized = normalized.replace(/\s+/g, "_");
  return normalized.replace(/[^a-z0-9_/-]/g, "");
}

/**
 * Backward-compatible comparison export for existing callers. New taxonomy
 * code must keep display/write identity separate through preserveTagIdentity.
 */
export function normalizeTag(tag: string): string {
  return normalizeTagComparisonKey(tag);
}

/** Backward-compatible normalized suggestion list for existing callers. */
export function normalizeTags(tags: readonly string[]): string[] {
  return normalizeLlmTagIdentities(tags);
}

/** Keeps the first real identity for each comparison-equivalent tag. */
export function preserveTagIdentities(tags: readonly string[]): string[] {
  const identities = new Map<string, string>();
  for (const rawTag of tags) {
    const identity = preserveTagIdentity(rawTag);
    const comparisonKey = normalizeTagComparisonKey(identity);
    if (identity && comparisonKey && !identities.has(comparisonKey)) {
      identities.set(comparisonKey, identity);
    }
  }
  return [...identities.values()];
}

/** Keeps historical LLM suggestion spelling while using comparison keys. */
function normalizeLlmTagIdentities(tags: readonly string[]): string[] {
  const identities = new Map<string, string>();
  for (const rawTag of tags) {
    const comparisonKey = normalizeTagComparisonKey(rawTag);
    if (comparisonKey && !identities.has(comparisonKey)) {
      identities.set(comparisonKey, comparisonKey);
    }
  }
  return [...identities.values()];
}

/**
 * Identifies only the narrow lexical shape that can support a weak
 * entity-specificity signal. It deliberately excludes acronyms, multi-word
 * tags, and ordinary normalized tags; it never classifies a tag as a person.
 */
export function hasEntityLikeShape(rawTag: string): boolean {
  return /^\p{Lu}\p{Ll}+$/u.test(rawTag.trim());
}

/** Builds a normalized inventory from Obsidian's metadata-cache tag counts. */
export function buildTagInventory(rawTags: VaultTagCounts): Map<string, ExistingVaultTag> {
  const inventory = new Map<string, ExistingVaultTag>();

  for (const [original, rawCount] of Object.entries(rawTags)) {
    const identity = preserveTagIdentity(original);
    const comparisonKey = normalizeTagComparisonKey(identity);
    if (!identity || !comparisonKey) continue;
    const count = typeof rawCount === "number" ? rawCount : 0;
    const existing = inventory.get(comparisonKey);
    inventory.set(comparisonKey, {
      comparisonKey,
      // Preserve the first cache identity deterministically when equivalent
      // spellings are reported by separate metadata sources.
      identity: existing?.identity ?? identity,
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
  const identities = normalizeLlmTagIdentities(rawTags);
  const limited = maximum === undefined ? identities : identities.slice(0, maximum);

  return limited.map((tag) => {
    const comparisonKey = normalizeTagComparisonKey(tag);
    const existing = inventory.get(comparisonKey);
    const existsInNote = existingNoteTags === undefined
      ? undefined
      : [...existingNoteTags].some(existingTag => normalizeTagComparisonKey(existingTag) === comparisonKey);
    return {
      tag: existing?.identity ?? tag,
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
  const candidates = new Map<string, { tag: string; relatedNoteCount: number; relatedScore: number }>();

  for (const source of relatedSources) {
    const score = Number.isFinite(source.score) ? source.score ?? 0 : 0;
    for (const tag of preserveTagIdentities(source.tags)) {
      const comparisonKey = normalizeTagComparisonKey(tag);
      const existing = candidates.get(comparisonKey) ?? {
        tag: inventory.get(comparisonKey)?.identity ?? tag,
        relatedNoteCount: 0,
        relatedScore: 0,
      };
      candidates.set(comparisonKey, {
        tag: existing.tag,
        relatedNoteCount: existing.relatedNoteCount + 1,
        relatedScore: existing.relatedScore + score,
      });
    }
  }

  return Array.from(candidates, ([comparisonKey, evidence]) => {
    const globalUsageCount = inventory.get(comparisonKey)?.count;
    return {
      tag: evidence.tag,
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
  inventory: ReadonlyMap<string, ExistingVaultTag> = new Map(),
): string[] {
  // Preserve the historical LLM-only fallback exactly when no context exists.
  if (contextualCandidates.length === 0) return normalizeLlmTagIdentities(llmTags).slice(0, maximum);

  const contextualTags = new Set(contextualCandidates.map(candidate => normalizeTagComparisonKey(candidate.tag)));
  const ranked = [
    ...contextualCandidates.map((candidate, index) => ({
      tag: candidate.tag,
      baselineRank: index,
      weakEntityEvidence: false,
    })),
    ...llmTags.map((rawTag, index) => ({
      tag: normalizeTagComparisonKey(rawTag),
      baselineRank: contextualCandidates.length + index,
      weakEntityEvidence: hasEntityLikeShape(rawTag),
    })).filter(candidate => candidate.tag.length > 0 && !contextualTags.has(normalizeTagComparisonKey(candidate.tag))),
  ].map(candidate => {
    const comparisonKey = normalizeTagComparisonKey(candidate.tag);
    const contextual = contextualCandidates.find(item => normalizeTagComparisonKey(item.tag) === comparisonKey);
    const globalUsageCount = inventory.get(comparisonKey)?.count ?? 0;
    const weakTaxonomy = globalUsageCount <= 1 && (contextual?.relatedNoteCount ?? 0) <= 1;
    return {
      ...candidate,
      // A demotion, never an exclusion: a candidate remains eligible if space remains.
      penalty: candidate.weakEntityEvidence && weakTaxonomy ? 1 : 0,
    };
  });

  return ranked
    .sort((left, right) => left.penalty - right.penalty || left.baselineRank - right.baselineRank)
    .reduce<string[]>((tags, candidate) => {
      if (!tags.some(tag => normalizeTagComparisonKey(tag) === normalizeTagComparisonKey(candidate.tag))) {
        tags.push(candidate.tag);
      }
      return tags;
    }, [])
    .slice(0, maximum);
}

/** Formats the existing usage label without coupling proposals to UI strings. */
export function formatTagUsageLabel(count: number, alreadyUsedLabel: string): string {
  return `${alreadyUsedLabel}: ${count}`;
}
