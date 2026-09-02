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

export function isEmbeddingUpdateMode(value: unknown): value is EmbeddingUpdateMode {
  return value === "manual" || value === "automatic-local-only";
}

export function normalizeEmbeddingUpdateMode(value: unknown): EmbeddingUpdateMode {
  return isEmbeddingUpdateMode(value) ? value : "manual";
}
