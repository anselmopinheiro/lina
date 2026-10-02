/**
 * Effective AI configuration (Phase LINA-15G)
 *
 * Single, pure source for the provider / model / Base URL that the runtime really uses, so the
 * Settings UI can show exactly the same values. Precedence (as implemented before this phase):
 *
 *   1. device-local persisted value (written by the Settings UI)
 *   2. legacy global persisted field (`embedding*`, `ai*`)
 *   3. provider default (`providerDefaults.ts`)
 *
 * No fabricated literals: the last resort is always the provider default. Pure: no I/O, no
 * dependency on `settings.ts`.
 */

import {
  chooseProviderDefaultBaseUrl,
  chooseProviderDefaultModel,
  getAnalysisProviderDefaults,
  getEmbeddingProviderDefaults,
} from "../ai/providerDefaults";
import { resolvePureLocalProviderId } from "./pureLocalSettingsModel";

export interface EffectiveAiConfig {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
}

/** Device-local (Settings UI) values; empty/undefined means "not chosen on this device". */
export interface LocalAiValues {
  readonly provider?: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

/** Structural subset of `LinaSettings` carrying the legacy global fallbacks. */
export interface LegacyGlobalAiSettings {
  readonly aiProvider?: unknown;
  readonly aiBaseUrl?: unknown;
  readonly aiAnalysisModel?: unknown;
  readonly embeddingProvider?: unknown;
  readonly embeddingBaseUrl?: unknown;
  readonly embeddingLocalBaseUrl?: unknown;
  readonly embeddingModel?: unknown;
  readonly embeddingLocalModel?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveProvider(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = text(candidate);
    if (value) return resolvePureLocalProviderId(value) ?? "ollama";
  }
  return "ollama";
}

export function resolveEffectiveEmbeddingsConfig(
  local: LocalAiValues,
  persistedSettings: object,
): EffectiveAiConfig {
  const settings: LegacyGlobalAiSettings = persistedSettings;
  const provider = resolveProvider(local.provider, settings.embeddingProvider);
  const defaults = getEmbeddingProviderDefaults(provider);
  const baseUrl = chooseProviderDefaultBaseUrl(
    text(local.baseUrl)
      || text(settings.embeddingBaseUrl)
      || text(settings.embeddingLocalBaseUrl)
      || (provider === "ollama" ? text(settings.aiBaseUrl) : "")
      || defaults.baseUrl,
    provider,
  );
  const model = chooseProviderDefaultModel(
    text(local.model) || text(settings.embeddingModel) || text(settings.embeddingLocalModel) || defaults.model,
    provider,
    "embedding",
  );
  return { provider, model, baseUrl };
}

export function resolveEffectiveAnalysisConfig(
  local: LocalAiValues,
  persistedSettings: object,
): EffectiveAiConfig {
  const settings: LegacyGlobalAiSettings = persistedSettings;
  const provider = resolveProvider(local.provider, settings.aiProvider);
  const defaults = getAnalysisProviderDefaults(provider);
  const baseUrl = chooseProviderDefaultBaseUrl(
    text(local.baseUrl) || text(settings.aiBaseUrl) || defaults.baseUrl,
    provider,
  );
  const model = chooseProviderDefaultModel(
    text(local.model) || text(settings.aiAnalysisModel) || defaults.model,
    provider,
    "analysis",
  );
  return { provider, model, baseUrl };
}
