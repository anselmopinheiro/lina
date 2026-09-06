import type { LinaSettings, LinaDeviceSettings } from "../settings";
import {
  normalizeSupportedProvider,
  getLegacyFingerprintDeviceId,
  normalizeAiProfiles,
} from "../settings";

export const CURRENT_SETTINGS_SCHEMA_VERSION = 1;

export interface SettingsMigrationContext {
  persistentDeviceId?: string;
  legacyFingerprintDeviceId?: string;
}

export interface SettingsMigrationResult {
  fromVersion: number;
  toVersion: number;
  changed: boolean;
  unsupportedFutureVersion: boolean;
  migratedSteps: string[];
}

/**
 * Executes schema migrations sequentially and idempotently on raw or active settings.
 *
 * Design constraints:
 * 1. Monotonic: fromVersion N -> toVersion N+1.
 * 2. Idempotent: running multiple times produces identical state and changed === false.
 * 3. Future-safe: if raw settings indicate a schema version newer than supported,
 *    refuses silent downgrade or overwrite and flags unsupportedFutureVersion.
 * 4. Safe-by-default: does not destructively delete legacy data unless specifically required.
 */
export function migrateSettings(
  rawSettings: Record<string, unknown> | undefined,
  context?: SettingsMigrationContext
): SettingsMigrationResult {
  if (!rawSettings || typeof rawSettings !== "object") {
    return {
      fromVersion: 0,
      toVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      changed: false,
      unsupportedFutureVersion: false,
      migratedSteps: [],
    };
  }

  const rawVersion = rawSettings.settingsSchemaVersion;
  const fromVersion = typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion >= 0
    ? rawVersion
    : 0;

  if (fromVersion > CURRENT_SETTINGS_SCHEMA_VERSION) {
    console.warn(
      `Lina: settingsSchemaVersion ${fromVersion} is newer than current supported version ${CURRENT_SETTINGS_SCHEMA_VERSION}. Preserving settings without modification.`
    );
    return {
      fromVersion,
      toVersion: fromVersion,
      changed: false,
      unsupportedFutureVersion: true,
      migratedSteps: [],
    };
  }

  if (fromVersion === CURRENT_SETTINGS_SCHEMA_VERSION) {
    return {
      fromVersion,
      toVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      changed: false,
      unsupportedFutureVersion: false,
      migratedSteps: [],
    };
  }

  let currentVersion = fromVersion;
  let changed = false;
  const migratedSteps: string[] = [];

  // Migration step: v0 -> v1
  if (currentVersion === 0) {
    // 1. AI Analysis canonical fields migration
    if (typeof rawSettings.provider === "string" && rawSettings.aiProvider === undefined) {
      rawSettings.aiProvider = normalizeSupportedProvider(rawSettings.provider);
      changed = true;
    }
    if (typeof rawSettings.ollamaUrl === "string" && rawSettings.aiBaseUrl === undefined) {
      rawSettings.aiBaseUrl = rawSettings.ollamaUrl;
      changed = true;
    }
    if (typeof rawSettings.openrouterUrl === "string" && rawSettings.aiBaseUrl === undefined) {
      rawSettings.aiBaseUrl = rawSettings.openrouterUrl;
      changed = true;
    }
    if (typeof rawSettings.chatModel === "string" && rawSettings.aiAnalysisModel === undefined) {
      rawSettings.aiAnalysisModel = rawSettings.chatModel;
      changed = true;
    }
    if (Array.isArray(rawSettings.aiProfiles) && rawSettings.aiProfiles.length > 0) {
      const normalizedProfiles = normalizeAiProfiles(rawSettings as unknown as LinaSettings);
      if (JSON.stringify(rawSettings.aiProfiles) !== JSON.stringify(normalizedProfiles)) {
        rawSettings.aiProfiles = normalizedProfiles;
        changed = true;
      }
    }

    // 2. Embeddings canonical fields migration
    if (typeof rawSettings.embeddingLocalEnabled === "boolean" && rawSettings.embeddingsEnabled === undefined) {
      rawSettings.embeddingsEnabled = rawSettings.embeddingLocalEnabled;
      changed = true;
    }
    if (typeof rawSettings.embeddingLocalBaseUrl === "string" && rawSettings.embeddingBaseUrl === undefined) {
      rawSettings.embeddingBaseUrl = rawSettings.embeddingLocalBaseUrl;
      changed = true;
    }
    if (typeof rawSettings.embeddingLocalModel === "string" && rawSettings.embeddingModel === undefined) {
      rawSettings.embeddingModel = rawSettings.embeddingLocalModel;
      changed = true;
    }
    if (typeof rawSettings.embeddingLocalTimeoutMs === "number" && rawSettings.embeddingRequestTimeoutSeconds === undefined) {
      rawSettings.embeddingRequestTimeoutSeconds = Math.round(rawSettings.embeddingLocalTimeoutMs / 1000);
      changed = true;
    }
    if (typeof rawSettings.autoGenerateEmbeddingsOnStartup === "boolean" && rawSettings.generateEmbeddingsOnStartup === undefined) {
      rawSettings.generateEmbeddingsOnStartup = rawSettings.autoGenerateEmbeddingsOnStartup;
      changed = true;
    }
    if (typeof rawSettings.autoGenerateEmbeddingsOnlyWhenNeeded === "boolean" && rawSettings.generateOnlyMissingEmbeddings === undefined) {
      rawSettings.generateOnlyMissingEmbeddings = rawSettings.autoGenerateEmbeddingsOnlyWhenNeeded;
      changed = true;
    }

    // 3. Device settings normalization
    const persistentDeviceId = context?.persistentDeviceId;
    if (persistentDeviceId) {
      const legacyFingerprintId = context?.legacyFingerprintDeviceId ?? getLegacyFingerprintDeviceId();
      if (rawSettings.deviceSettingsById && typeof rawSettings.deviceSettingsById === "object") {
        const byId = rawSettings.deviceSettingsById as Record<string, LinaDeviceSettings>;
        const legacyDev = byId[legacyFingerprintId];
        if (legacyDev && !byId[persistentDeviceId]) {
          byId[persistentDeviceId] = { ...legacyDev };
          changed = true;
        }
      }

      // Migrate root unnamespaced local device settings if present into deviceSettingsById[persistentDeviceId]
      const rootToDeviceFieldMap: Record<string, keyof LinaDeviceSettings> = {
        localDeviceName: "deviceName",
        localActiveAiProfileId: "activeAiProfileId",
        localAnalysisProvider: "analysisProvider",
        localAnalysisModel: "analysisModel",
        localAnalysisBaseUrl: "analysisBaseUrl",
        localAnalysisApiKey: "analysisApiKey",
        localAnalysisTimeout: "analysisTimeout",
        localEmbeddingsProvider: "embeddingsProvider",
        localEmbeddingsModel: "embeddingsModel",
        localEmbeddingsBaseUrl: "embeddingsBaseUrl",
        localEmbeddingsApiKey: "embeddingsApiKey",
        localEmbeddingsBatchSize: "embeddingsBatchSize",
        localEmbeddingsTimeout: "embeddingsTimeout",
      };

      for (const [rootField, devField] of Object.entries(rootToDeviceFieldMap)) {
        if (rawSettings[rootField] !== undefined) {
          rawSettings.deviceSettingsById ??= {};
          const byId = rawSettings.deviceSettingsById as Record<string, Record<string, unknown>>;
          const target = (byId[persistentDeviceId] ??= {});
          if (target[devField] === undefined) {
            target[devField] = rawSettings[rootField];
            changed = true;
          }
        }
      }
    }

    // 4. Advance schema version
    if (rawSettings.settingsSchemaVersion !== 1) {
      rawSettings.settingsSchemaVersion = 1;
      changed = true;
    }

    migratedSteps.push("v0-to-v1");
    currentVersion = 1;
  }

  return {
    fromVersion,
    toVersion: currentVersion,
    changed,
    unsupportedFutureVersion: false,
    migratedSteps,
  };
}
