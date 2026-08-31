/**
 * Secret Storage Service (Phase C)
 *
 * Integrates with Obsidian's official `app.secretStorage` API to store sensitive credentials
 * (such as API keys) securely in local, unsynchronized platform storage rather than in
 * synchronized settings files (`data.json` or `.lina/devices/`).
 */

export const LINA_SECRET_KEYS = Object.freeze({
  analysisApiKey: "lina-analysis-api-key",
  embeddingsApiKey: "lina-embeddings-api-key",
} as const);

export type LinaSecretKey = (typeof LINA_SECRET_KEYS)[keyof typeof LINA_SECRET_KEYS];

/**
 * Interface matching Obsidian's App.secretStorage surface.
 */
export interface SecretStorageAdapter {
  setSecret(id: string, secret: string): void | Promise<void>;
  getSecret(id: string): string | null | Promise<string | null>;
  listSecrets?(): string[] | Promise<string[]>;
}

/**
 * Safely retrieves a secret string from SecretStorage asynchronously.
 */
export async function getSecretValue(
  storage: SecretStorageAdapter | undefined,
  id: string
): Promise<string | null> {
  if (!storage || typeof storage.getSecret !== "function") {
    return null;
  }

  try {
    const raw = await storage.getSecret(id);
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Safely retrieves a secret string synchronously (when the underlying adapter returns a string directly).
 */
export function getSecretValueSync(
  storage: SecretStorageAdapter | undefined,
  id: string
): string | null {
  if (!storage || typeof storage.getSecret !== "function") {
    return null;
  }

  try {
    const raw = storage.getSecret(id);
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim();
    }
  } catch {
    // Ignore synchronous read exceptions
  }

  return null;
}

/**
 * Sets a secret in SecretStorage.
 */
export async function setSecretValue(
  storage: SecretStorageAdapter | undefined,
  id: string,
  value: string
): Promise<void> {
  if (!storage || typeof storage.setSecret !== "function") {
    return;
  }

  const trimmed = value.trim();
  await storage.setSecret(id, trimmed);
}

/**
 * Deletes/clears a secret from SecretStorage.
 */
export async function deleteSecretValue(
  storage: SecretStorageAdapter | undefined,
  id: string
): Promise<void> {
  if (!storage || typeof storage.setSecret !== "function") {
    return;
  }

  await storage.setSecret(id, "");
}

/**
 * Checks if a non-empty secret exists in SecretStorage for the given ID.
 */
export async function hasSecretValue(
  storage: SecretStorageAdapter | undefined,
  id: string
): Promise<boolean> {
  const value = await getSecretValue(storage, id);
  return value !== null;
}

export interface LegacyCredentialSource {
  aiApiKey?: string;
  embeddingApiKey?: string;
  localAnalysisApiKey?: string;
  localEmbeddingsApiKey?: string;
  deviceSettingsById?: Record<string, {
    analysisApiKey?: string;
    embeddingsApiKey?: string;
    aiProfileApiKeys?: Record<string, string>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface MigrationResult {
  migratedCount: number;
  migratedKeys: string[];
  cleanedSettings: boolean;
}

/**
 * Safely migrates legacy plaintext credentials from settings into SecretStorage.
 *
 * Steps:
 * 1. Identify legacy plaintext keys in `deviceSettingsById` or legacy root fields.
 * 2. If SecretStorage does not already have a value for the key ID, copy it.
 * 3. Verify that SecretStorage persisted the key.
 * 4. Remove the plaintext string from the settings object to prevent synchronization leakage.
 */
export async function migrateLegacyCredentials(
  storage: SecretStorageAdapter | undefined,
  settings: LegacyCredentialSource | undefined,
  deviceId?: string
): Promise<MigrationResult> {
  if (!storage || !settings) {
    return { migratedCount: 0, migratedKeys: [], cleanedSettings: false };
  }

  const migratedKeys: string[] = [];
  let cleanedSettings = false;

  // 1. Check Analysis API Key
  const legacyDeviceAnalysisKey = deviceId && settings.deviceSettingsById?.[deviceId]?.analysisApiKey;
  const legacyAnalysisKey = (
    (typeof legacyDeviceAnalysisKey === "string" && legacyDeviceAnalysisKey.trim())
    || (typeof settings.localAnalysisApiKey === "string" && settings.localAnalysisApiKey.trim())
    || (typeof settings.aiApiKey === "string" && settings.aiApiKey.trim())
    || undefined
  );

  if (legacyAnalysisKey) {
    const existingSecret = await getSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey);
    if (!existingSecret) {
      await setSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey, legacyAnalysisKey);
      const verified = await getSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey);
      if (verified === legacyAnalysisKey) {
        migratedKeys.push(LINA_SECRET_KEYS.analysisApiKey);
      }
    }
  }

  // 2. Check Embeddings API Key
  const legacyDeviceEmbeddingsKey = deviceId && settings.deviceSettingsById?.[deviceId]?.embeddingsApiKey;
  const legacyEmbeddingsKey = (
    (typeof legacyDeviceEmbeddingsKey === "string" && legacyDeviceEmbeddingsKey.trim())
    || (typeof settings.localEmbeddingsApiKey === "string" && settings.localEmbeddingsApiKey.trim())
    || (typeof settings.embeddingApiKey === "string" && settings.embeddingApiKey.trim())
    || undefined
  );

  if (legacyEmbeddingsKey) {
    const existingSecret = await getSecretValue(storage, LINA_SECRET_KEYS.embeddingsApiKey);
    if (!existingSecret) {
      await setSecretValue(storage, LINA_SECRET_KEYS.embeddingsApiKey, legacyEmbeddingsKey);
      const verified = await getSecretValue(storage, LINA_SECRET_KEYS.embeddingsApiKey);
      if (verified === legacyEmbeddingsKey) {
        migratedKeys.push(LINA_SECRET_KEYS.embeddingsApiKey);
      }
    }
  }

  // 3. Purge plaintext values across deviceSettingsById and legacy fields if secret exists
  const hasAnalysisSecret = await hasSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey);
  const hasEmbeddingsSecret = await hasSecretValue(storage, LINA_SECRET_KEYS.embeddingsApiKey);

  if (settings.deviceSettingsById) {
    for (const [id, dev] of Object.entries(settings.deviceSettingsById)) {
      if (dev && typeof dev === "object") {
        if (hasAnalysisSecret && dev.analysisApiKey) {
          delete dev.analysisApiKey;
          cleanedSettings = true;
        }
        if (hasEmbeddingsSecret && dev.embeddingsApiKey) {
          delete dev.embeddingsApiKey;
          cleanedSettings = true;
        }
        if (dev.aiProfileApiKeys && Object.keys(dev.aiProfileApiKeys).length > 0) {
          delete dev.aiProfileApiKeys;
          cleanedSettings = true;
        }
      }
    }
  }

  if (hasAnalysisSecret) {
    if (settings.aiApiKey) {
      settings.aiApiKey = "";
      cleanedSettings = true;
    }
    if (settings.localAnalysisApiKey) {
      delete settings.localAnalysisApiKey;
      cleanedSettings = true;
    }
  }

  if (hasEmbeddingsSecret) {
    if (settings.embeddingApiKey) {
      settings.embeddingApiKey = "";
      cleanedSettings = true;
    }
    if (settings.localEmbeddingsApiKey) {
      delete settings.localEmbeddingsApiKey;
      cleanedSettings = true;
    }
  }

  return {
    migratedCount: migratedKeys.length,
    migratedKeys,
    cleanedSettings,
  };
}
