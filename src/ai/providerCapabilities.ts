/**
 * Provider Capability Model (Phase 0.2.2.1)
 *
 * Defines the technical characteristics of embedding providers without
 * business rules, UI logic, or user preferences.
 */

export interface EmbeddingProviderCapability {
  readonly providerId: string;
  readonly isLocal: boolean;
  readonly hasExternalCost: boolean;
  readonly requiresApiKey: boolean;
}

export const EMBEDDING_PROVIDER_CAPABILITIES: Readonly<Record<string, EmbeddingProviderCapability>> = Object.freeze({
  ollama: Object.freeze({
    providerId: "ollama",
    isLocal: true,
    hasExternalCost: false,
    requiresApiKey: false,
  }),
  mistral: Object.freeze({
    providerId: "mistral",
    isLocal: false,
    hasExternalCost: true,
    requiresApiKey: true,
  }),
  openrouter: Object.freeze({
    providerId: "openrouter",
    isLocal: false,
    hasExternalCost: true,
    requiresApiKey: true,
  }),
});

/**
 * Resolves the embedding capability profile for a provider identifier.
 * Unknown or custom providers safely default to conservative external cost characteristics.
 */
export function getEmbeddingProviderCapability(providerId: string): EmbeddingProviderCapability {
  const normalized = providerId.trim().toLowerCase();
  const known = EMBEDDING_PROVIDER_CAPABILITIES[normalized];
  if (known) {
    return known;
  }
  return {
    providerId: normalized,
    isLocal: false,
    hasExternalCost: true,
    requiresApiKey: true,
  };
}
