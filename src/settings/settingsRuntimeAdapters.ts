import {
  isBooleanSettingValue,
  isDeclarativeGlobalSettingValue,
  isEmbeddingDefaultLanguage,
} from "./declarativeGlobalSettings";
import {
  normalizePureHybridSearchWeight,
  normalizePureInboxMaxNotes,
  normalizePureMaxSuggestedTags,
  type PureGlobalSettingEffect,
} from "./pureGlobalSettingAdapters";
import type { LocalSettingEffect } from "./pureLocalSettingAdapters";
import {
  isPureLocalEmbeddingStoragePreference,
  isPureLocalProviderId,
  resolvePureLocalProviderId,
  normalizePureLocalEmbeddingBatchSize,
  normalizePureLocalTimeout,
  type PureLocalSettingKey,
} from "./pureLocalSettingsModel";

export const SETTINGS_RUNTIME_GLOBAL_KEYS = [
  "embeddingsEnabled",
  "checkSyncOnStartup",
  "updateIndexOnStartup",
  "debugIndexUpdates",
  "indexExcludedFolders",
  "indexExcludedPathContains",
  "indexExcludedContentContains",
  "yamlSuggestionsEnabled",
  "yamlAllowedProperties",
  "yamlIncludeTags",
  "embeddingDefaultLanguage",
  "inboxFolderPath",
  "maxInboxNotesToAnalyze",
  "hybridSearchTextWeight",
  "hybridSearchSemanticWeight",
  "interfaceLanguage",
  "autoUpdateIndexOnFileChanges",
  "maxSuggestedTags",
] as const;

export type SettingsRuntimeGlobalKey = typeof SETTINGS_RUNTIME_GLOBAL_KEYS[number];
export type SettingsRuntimeGlobalValue<K extends SettingsRuntimeGlobalKey> =
  K extends "embeddingsEnabled" | "checkSyncOnStartup" | "updateIndexOnStartup" | "debugIndexUpdates" | "yamlSuggestionsEnabled" | "yamlIncludeTags" | "autoUpdateIndexOnFileChanges" ? boolean :
  K extends "maxInboxNotesToAnalyze" | "hybridSearchTextWeight" | "hybridSearchSemanticWeight" | "maxSuggestedTags" ? number :
  K extends "embeddingDefaultLanguage" ? "pt-PT" | "en" | "es" | "fr" | "multi" | "auto" :
  K extends "interfaceLanguage" ? "pt-PT" | "en" :
  string;

export type SettingsRuntimeLocalValue<K extends PureLocalSettingKey> =
  K extends "maintainBinaryEmbeddingCopy" ? boolean : string;
export type SettingsRuntimeEffect = LocalSettingEffect | PureGlobalSettingEffect;
export type SettingsRuntimeMutationError = "invalid-value" | "save-failed" | "effect-failed";
export type SettingsRuntimeMutationResult =
  | { ok: true }
  | { ok: false; error: SettingsRuntimeMutationError };

export interface SettingsRuntimeDeviceSettings {
  [key: string]: unknown;
}

export interface SettingsRuntimeSettings {
  deviceSettingsById?: Record<string, SettingsRuntimeDeviceSettings>;
  [key: string]: unknown;
}

/** Structural persisted-data boundary. It preserves the existing { settings, index } envelope. */
export interface SettingsRuntimeSnapshot {
  settings: SettingsRuntimeSettings;
  index?: unknown;
  [key: string]: unknown;
}

export interface SettingsRuntimeHost {
  getSnapshot(): SettingsRuntimeSnapshot;
  replaceSnapshot(next: SettingsRuntimeSnapshot): void;
  saveSnapshot(): Promise<void>;
  getCurrentDeviceId(): string;
  runEffect(effect: SettingsRuntimeEffect): Promise<void> | void;
}

export type SettingsRuntimeGlobalDefaults = Partial<{
  [K in SettingsRuntimeGlobalKey]: SettingsRuntimeGlobalValue<K>;
}>;

export interface SettingsRuntimeAdapterOptions {
  globalDefaults?: SettingsRuntimeGlobalDefaults;
}

export interface SettingsRuntimeAdapters {
  getGlobalValue<K extends SettingsRuntimeGlobalKey>(key: K): SettingsRuntimeGlobalValue<K> | undefined;
  setGlobalValue<K extends SettingsRuntimeGlobalKey>(
    key: K,
    value: SettingsRuntimeGlobalValue<K>,
    effects?: readonly SettingsRuntimeEffect[],
  ): Promise<SettingsRuntimeMutationResult>;
  getLocalValue<K extends PureLocalSettingKey>(key: K): SettingsRuntimeLocalValue<K> | undefined;
  setLocalValue<K extends PureLocalSettingKey>(
    key: K,
    value: SettingsRuntimeLocalValue<K>,
    effects?: readonly SettingsRuntimeEffect[],
  ): Promise<SettingsRuntimeMutationResult>;
  setLocalProviderValues(
    domain: "analysis" | "embedding",
    provider: string,
    model: string,
    baseUrl: string,
    effects?: readonly SettingsRuntimeEffect[],
  ): Promise<SettingsRuntimeMutationResult>;
}

function isSettingsRuntimeGlobalKey(value: string): value is SettingsRuntimeGlobalKey {
  return SETTINGS_RUNTIME_GLOBAL_KEYS.some((key) => key === value);
}

function isSettingsRuntimeEffect(value: unknown): value is SettingsRuntimeEffect {
  if (typeof value !== "object" || value === null || !("type" in value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "set-default-base-url":
    case "set-default-model":
      return "value" in value && typeof value.value === "string";
    case "update-vault-event-listeners":
    case "refresh-model-options":
    case "mark-embeddings-dirty":
    case "invalidate-runtime-embedding-index":
    case "rerender-settings":
      return true;
    default:
      return false;
  }
}

function normalizeGlobalValue<K extends SettingsRuntimeGlobalKey>(
  key: K,
  value: unknown,
): SettingsRuntimeGlobalValue<K> | undefined {
  if (!isSettingsRuntimeGlobalKey(key)) return undefined;

  if (key === "maxSuggestedTags") {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    return normalizePureMaxSuggestedTags(value) as SettingsRuntimeGlobalValue<K>;
  }
  if (key === "maxInboxNotesToAnalyze") {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    return normalizePureInboxMaxNotes(value) as SettingsRuntimeGlobalValue<K>;
  }
  if (key === "hybridSearchTextWeight" || key === "hybridSearchSemanticWeight") {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const fallback = key === "hybridSearchTextWeight" ? 0.7 : 0.3;
    return normalizePureHybridSearchWeight(value, fallback) as SettingsRuntimeGlobalValue<K>;
  }
  if (key === "interfaceLanguage") {
    return value === "pt-PT" || value === "en" ? value as SettingsRuntimeGlobalValue<K> : undefined;
  }
  if (key === "inboxFolderPath") {
    return typeof value === "string" ? value.trim() as SettingsRuntimeGlobalValue<K> : undefined;
  }
  if (key === "embeddingDefaultLanguage") {
    return isEmbeddingDefaultLanguage(value) ? value as SettingsRuntimeGlobalValue<K> : undefined;
  }
  if (key === "autoUpdateIndexOnFileChanges") {
    return isBooleanSettingValue(value) ? value as SettingsRuntimeGlobalValue<K> : undefined;
  }
  if (isDeclarativeGlobalSettingValue(key, value)) {
    return value as SettingsRuntimeGlobalValue<K>;
  }
  return undefined;
}

function normalizeLocalValue<K extends PureLocalSettingKey>(
  key: K,
  value: unknown,
): SettingsRuntimeLocalValue<K> | undefined {
  if (key === "maintainBinaryEmbeddingCopy") {
    return isBooleanSettingValue(value) ? value as SettingsRuntimeLocalValue<K> : undefined;
  }
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (key === "analysisProvider" || key === "embeddingsProvider") {
    return isPureLocalProviderId(normalized) ? normalized as SettingsRuntimeLocalValue<K> : undefined;
  }
  if (key === "embeddingStorageReadPreference") {
    return isPureLocalEmbeddingStoragePreference(normalized) ? normalized as SettingsRuntimeLocalValue<K> : undefined;
  }
  if (key === "analysisTimeout" || key === "embeddingsTimeout") {
    return normalizePureLocalTimeout(normalized) as SettingsRuntimeLocalValue<K>;
  }
  if (key === "embeddingsBatchSize") {
    return normalizePureLocalEmbeddingBatchSize(normalized) as SettingsRuntimeLocalValue<K>;
  }
  return normalized as SettingsRuntimeLocalValue<K>;
}

function isStoredGlobalValue<K extends SettingsRuntimeGlobalKey>(
  key: K,
  value: unknown,
): value is SettingsRuntimeGlobalValue<K> {
  if (key === "maxSuggestedTags" || key === "maxInboxNotesToAnalyze" || key === "hybridSearchTextWeight" || key === "hybridSearchSemanticWeight") {
    return typeof value === "number";
  }
  return normalizeGlobalValue(key, value) !== undefined;
}

function isStoredLocalValue<K extends PureLocalSettingKey>(
  key: K,
  value: unknown,
): value is SettingsRuntimeLocalValue<K> {
  if (key === "analysisTimeout" || key === "embeddingsTimeout" || key === "embeddingsBatchSize") {
    return typeof value === "string";
  }
  return normalizeLocalValue(key, value) !== undefined;
}

function effectIdentity(effect: SettingsRuntimeEffect): string {
  return effect.type === "set-default-base-url" || effect.type === "set-default-model"
    ? `${effect.type}\u0000${effect.value}`
    : effect.type;
}

function mergeEffects(
  declared: readonly SettingsRuntimeEffect[],
  requested: readonly SettingsRuntimeEffect[] | undefined,
): SettingsRuntimeEffect[] | undefined {
  const candidates = [...declared, ...(requested ?? [])];
  if (!candidates.every(isSettingsRuntimeEffect)) return undefined;

  const seen = new Set<string>();
  return candidates.filter((effect) => {
    const identity = effectIdentity(effect);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function globalEffectsFor(key: SettingsRuntimeGlobalKey): readonly SettingsRuntimeEffect[] {
  return key === "autoUpdateIndexOnFileChanges"
    ? [{ type: "update-vault-event-listeners" }]
    : [];
}

function cloneWithGlobalValue<K extends SettingsRuntimeGlobalKey>(
  snapshot: SettingsRuntimeSnapshot,
  key: K,
  value: SettingsRuntimeGlobalValue<K>,
): SettingsRuntimeSnapshot {
  return {
    ...snapshot,
    settings: { ...snapshot.settings, [key]: value },
  };
}

function cloneWithLocalValue<K extends PureLocalSettingKey>(
  snapshot: SettingsRuntimeSnapshot,
  deviceId: string,
  key: K,
  value: SettingsRuntimeLocalValue<K>,
): SettingsRuntimeSnapshot {
  const devices = { ...(snapshot.settings.deviceSettingsById ?? {}) };
  const existingDevice = devices[deviceId];
  const device = { ...(existingDevice ?? {}) };
  if (typeof value === "string" && value.length === 0) {
    delete device[key];
    if (!existingDevice && Object.keys(device).length === 0) return snapshot;
  } else {
    device[key] = value;
  }
  devices[deviceId] = device;
  return {
    ...snapshot,
    settings: { ...snapshot.settings, deviceSettingsById: devices },
  };
}

export function createSettingsRuntimeAdapters(
  host: SettingsRuntimeHost,
  options: SettingsRuntimeAdapterOptions = {},
): SettingsRuntimeAdapters {
  let writeQueue: Promise<void> = Promise.resolve();

  const withSerializedWrite = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const previous = writeQueue;
    let release: () => void = () => undefined;
    writeQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const persistAndRunEffects = async (
    previous: SettingsRuntimeSnapshot,
    next: SettingsRuntimeSnapshot,
    effects: readonly SettingsRuntimeEffect[],
  ): Promise<SettingsRuntimeMutationResult> => {
    host.replaceSnapshot(next);
    try {
      await host.saveSnapshot();
    } catch {
      host.replaceSnapshot(previous);
      return { ok: false, error: "save-failed" };
    }

    try {
      for (const effect of effects) await host.runEffect(effect);
    } catch {
      return { ok: false, error: "effect-failed" };
    }
    return { ok: true };
  };

  return {
    getGlobalValue(key) {
      const snapshot = host.getSnapshot();
      const value = snapshot.settings[key];
      if (isStoredGlobalValue(key, value)) return value;
      return options.globalDefaults?.[key];
    },
    async setGlobalValue(key, value, requestedEffects) {
      const normalized = normalizeGlobalValue(key, value);
      const effects = mergeEffects(globalEffectsFor(key), requestedEffects);
      if (normalized === undefined || effects === undefined) return { ok: false, error: "invalid-value" };

      return withSerializedWrite(async () => {
        const previous = host.getSnapshot();
        const next = cloneWithGlobalValue(previous, key, normalized);
        return persistAndRunEffects(previous, next, effects);
      });
    },
    getLocalValue(key) {
      const deviceId = host.getCurrentDeviceId().trim();
      if (!deviceId) return undefined;
      const value = host.getSnapshot().settings.deviceSettingsById?.[deviceId]?.[key];
      if ((key === "analysisProvider" || key === "embeddingsProvider") && typeof value === "string") {
        return resolvePureLocalProviderId(value) as SettingsRuntimeLocalValue<typeof key> | undefined;
      }
      return isStoredLocalValue(key, value) ? value : undefined;
    },
    async setLocalValue(key, value, requestedEffects) {
      const normalized = normalizeLocalValue(key, value);
      const effects = mergeEffects([], requestedEffects);
      const deviceId = host.getCurrentDeviceId().trim();
      if (normalized === undefined || effects === undefined || !deviceId) return { ok: false, error: "invalid-value" };

      return withSerializedWrite(async () => {
        const previous = host.getSnapshot();
        const next = cloneWithLocalValue(previous, deviceId, key, normalized);
        if (next === previous) return { ok: true };
        return persistAndRunEffects(previous, next, effects);
      });
    },
    async setLocalProviderValues(domain, provider, model, baseUrl, requestedEffects) {
      const providerKey = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
      const modelKey = domain === "analysis" ? "analysisModel" : "embeddingsModel";
      const baseUrlKey = domain === "analysis" ? "analysisBaseUrl" : "embeddingsBaseUrl";
      const normalizedProvider = normalizeLocalValue(providerKey, provider);
      const normalizedModel = normalizeLocalValue(modelKey, model);
      const normalizedBaseUrl = normalizeLocalValue(baseUrlKey, baseUrl);
      const effects = mergeEffects([], requestedEffects);
      const deviceId = host.getCurrentDeviceId().trim();
      if (
        normalizedProvider === undefined
        || normalizedModel === undefined
        || normalizedBaseUrl === undefined
        || effects === undefined
        || !deviceId
      ) {
        return { ok: false, error: "invalid-value" };
      }

      return withSerializedWrite(async () => {
        const previous = host.getSnapshot();
        const withProvider = cloneWithLocalValue(previous, deviceId, providerKey, normalizedProvider);
        const withModel = cloneWithLocalValue(withProvider, deviceId, modelKey, normalizedModel);
        const next = cloneWithLocalValue(withModel, deviceId, baseUrlKey, normalizedBaseUrl);
        return persistAndRunEffects(previous, next, effects);
      });
    },
  };
}
