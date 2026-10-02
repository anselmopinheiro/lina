/**
 * Provider Capability Model (Phase 0.2.2.1)
 *
 * Defines the technical characteristics of embedding providers without
 * business rules, UI logic, or user preferences.
 */

import { isLoopbackEndpoint } from "./endpointLocality";

export interface EmbeddingProviderCapability {
  readonly providerId: string;
  /** Static capability: the provider is able to run on this machine. Effective locality also depends on the endpoint (see `resolveEndpointProviderCapability`). */
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
 * True only when the provider *can* run on this machine AND the configured endpoint is loopback.
 * The static `isLocal` of the capability table says what a provider is able to do; it never proves
 * where the configured service actually runs (e.g. an Ollama server on another host).
 */
export function isProviderEndpointLocal(providerId: string, baseUrl: string | null | undefined): boolean {
  return getEmbeddingProviderCapability(providerId).isLocal && isLoopbackEndpoint(baseUrl);
}

/**
 * Capability with the effective locality of the configured endpoint (LINA-15F). `hasExternalCost`
 * is a property of the provider and is left untouched: a remote Ollama is not billed per call,
 * but note content still leaves the device, so `isLocal` becomes `false`.
 */
export function resolveEndpointProviderCapability(
  providerId: string,
  baseUrl: string | null | undefined
): EmbeddingProviderCapability {
  const capability = getEmbeddingProviderCapability(providerId);
  if (capability.isLocal && !isLoopbackEndpoint(baseUrl)) {
    return { ...capability, isLocal: false };
  }
  return capability;
}

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
