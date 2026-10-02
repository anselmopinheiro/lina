/**
 * Embedding Update Settings (Phase 0.2.2.4)
 *
 * Defines user preferences and configuration for vector embedding updates.
 * Purity: This module defines types and pure validation without executing generation or modifying runtime state.
 */

export type EmbeddingUpdateMode =
  | "manual"
  | "automatic-local-only";

export interface EmbeddingUpdateSettings {
  readonly mode: EmbeddingUpdateMode;
}

export const DEFAULT_EMBEDDING_UPDATE_SETTINGS: Readonly<EmbeddingUpdateSettings> = Object.freeze({
  mode: "manual",
});

/**
 * Embedding generation and the assessment of pending work are ALWAYS incremental (LINA-15F).
 *
 * The legacy preference `generateOnlyMissingEmbeddings` (and its predecessor
 * `autoGenerateEmbeddingsOnlyWhenNeeded`) is no longer honoured. With `false` it made the update
 * plan ignore the canonical embeddings, so the reported work never settled and, together with
 * `automatic-local-only`, triggered endless full regenerations. A persistent execution preference
 * must not alter the factual assessment; a full rebuild is decided by the planner (identity /
 * readability) or requested explicitly, always under confirmation.
 */
export const EMBEDDING_GENERATION_INCREMENTAL = true as const;

/** True when a persisted legacy preference asks for full regeneration (now ignored). */
export function isLegacyFullRegenerationPreferenceSet(settings: {
  readonly generateOnlyMissingEmbeddings?: unknown;
  readonly autoGenerateEmbeddingsOnlyWhenNeeded?: unknown;
}): boolean {
  if (settings.generateOnlyMissingEmbeddings !== undefined) {
    return settings.generateOnlyMissingEmbeddings === false;
  }
  return settings.autoGenerateEmbeddingsOnlyWhenNeeded === false;
}

export function isEmbeddingUpdateMode(value: unknown): value is EmbeddingUpdateMode {
  return value === "manual" || value === "automatic-local-only";
}

export function normalizeEmbeddingUpdateMode(value: unknown): EmbeddingUpdateMode {
  return isEmbeddingUpdateMode(value) ? value : "manual";
}
