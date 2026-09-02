import { describe, expect, it } from "vitest";
import { SecretStorage } from "../helpers/mockObsidian";
import {
  deleteSecretValue,
  getSecretValue,
  getSecretValueSync,
  hasSecretValue,
  LINA_SECRET_KEYS,
  migrateLegacyCredentials,
  setSecretValue,
  type LegacyCredentialSource,
} from "../../src/device/secretStorage";

describe("secretStorage", () => {
  describe("basic operations", () => {
    it("sets, gets, checks presence, and deletes secrets", async () => {
      const storage = new SecretStorage();

      expect(await getSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey)).toBeNull();
      expect(await hasSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey)).toBe(false);

      await setSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey, "sk-test-analysis-12345");

      expect(await getSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey)).toBe("sk-test-analysis-12345");
      expect(getSecretValueSync(storage, LINA_SECRET_KEYS.analysisApiKey)).toBe("sk-test-analysis-12345");
      expect(await hasSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey)).toBe(true);

      await deleteSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey);

      expect(await getSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey)).toBeNull();
      expect(await hasSecretValue(storage, LINA_SECRET_KEYS.analysisApiKey)).toBe(false);
    });

    it("handles undefined storage gracefully without throwing", async () => {
      expect(await getSecretValue(undefined, LINA_SECRET_KEYS.analysisApiKey)).toBeNull();
      expect(getSecretValueSync(undefined, LINA_SECRET_KEYS.analysisApiKey)).toBeNull();
      expect(await hasSecretValue(undefined, LINA_SECRET_KEYS.analysisApiKey)).toBe(false);
      await expect(setSecretValue(undefined, LINA_SECRET_KEYS.analysisApiKey, "secret")).resolves.toBeUndefined();
      await expect(deleteSecretValue(undefined, LINA_SECRET_KEYS.analysisApiKey)).resolves.toBeUndefined();
    });
  });

  describe("migrateLegacyCredentials", () => {
    it("migrates plaintext keys from deviceSettingsById into SecretStorage and purges plaintext", async () => {
      const storage = new SecretStorage();
      const deviceId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";

      const settings: LegacyCredentialSource = {
        analysisProvider: "mistral",
        analysisModel: "mistral-small-latest",
        embeddingsProvider: "openrouter",
        embeddingsModel: "openai/text-embedding-3-small",
        deviceSettingsById: {
          [deviceId]: {
            analysisApiKey: "sk-device-analysis-key",
            embeddingsApiKey: "sk-device-embeddings-key",
            deviceName: "Workstation",
          },
        },
      };

      const result = await migrateLegacyCredentials(storage, settings, deviceId);

      expect(result.migratedCount).toBe(2);
      expect(result.migratedKeys).toContain(LINA_SECRET_KEYS.analysisApiKey);
      expect(result.migratedKeys).toContain(LINA_SECRET_KEYS.embeddingsApiKey);
      expect(result.cleanedSettings).toBe(true);

      // Verify SecretStorage contains migrated keys
      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("sk-device-analysis-key");
      expect(storage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey)).toBe("sk-device-embeddings-key");

      // Verify plaintext keys were purged from settings
      expect(settings.deviceSettingsById?.[deviceId]?.analysisApiKey).toBeUndefined();
      expect(settings.deviceSettingsById?.[deviceId]?.embeddingsApiKey).toBeUndefined();

      // Verify non-credential configuration was preserved
      expect(settings.analysisProvider).toBe("mistral");
      expect(settings.deviceSettingsById?.[deviceId]?.deviceName).toBe("Workstation");
    });

    it("migrates legacy root aiApiKey and embeddingApiKey when device-specific keys are absent", async () => {
      const storage = new SecretStorage();
      const settings: LegacyCredentialSource = {
        aiApiKey: "legacy-global-ai-key",
        embeddingApiKey: "legacy-global-embedding-key",
        deviceSettingsById: {},
      };

      const result = await migrateLegacyCredentials(storage, settings);

      expect(result.migratedCount).toBe(2);
      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("legacy-global-ai-key");
      expect(storage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey)).toBe("legacy-global-embedding-key");

      // Verify plaintext wiped
      expect(settings.aiApiKey).toBe("");
      expect(settings.embeddingApiKey).toBe("");
      expect(result.cleanedSettings).toBe(true);
    });

    it("does not overwrite existing secrets already present in SecretStorage", async () => {
      const storage = new SecretStorage();
      storage.setSecret(LINA_SECRET_KEYS.analysisApiKey, "existing-authoritative-key");

      const deviceId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
      const settings: LegacyCredentialSource = {
        deviceSettingsById: {
          [deviceId]: {
            analysisApiKey: "old-stale-key-in-settings",
          },
        },
      };

      const result = await migrateLegacyCredentials(storage, settings, deviceId);

      expect(result.migratedCount).toBe(0);
      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("existing-authoritative-key");
      // Old stale plaintext key is still cleaned up because secret is present
      expect(settings.deviceSettingsById?.[deviceId]?.analysisApiKey).toBeUndefined();
      expect(result.cleanedSettings).toBe(true);
    });

    it("returns zero migrations when no credentials exist", async () => {
      const storage = new SecretStorage();
      const settings: LegacyCredentialSource = {
        interfaceLanguage: "en",
      };

      const result = await migrateLegacyCredentials(storage, settings);

      expect(result.migratedCount).toBe(0);
      expect(result.migratedKeys).toEqual([]);
      expect(result.cleanedSettings).toBe(false);
    });

    it("migrates root analysisApiKey and embeddingsApiKey and removes them from settings", async () => {
      const storage = new SecretStorage();
      const settings: LegacyCredentialSource = {
        analysisApiKey: "root-analysis-abc",
        embeddingsApiKey: "root-embeddings-xyz",
      };

      const result = await migrateLegacyCredentials(storage, settings);

      expect(result.migratedCount).toBe(2);
      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("root-analysis-abc");
      expect(storage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey)).toBe("root-embeddings-xyz");

      // Verify credentials removed from data.json source
      expect(settings.analysisApiKey).toBeUndefined();
      expect(settings.embeddingsApiKey).toBeUndefined();
      expect(result.cleanedSettings).toBe(true);
    });

    it("migrates plaintext keys from another device in deviceSettingsById when current deviceId has none", async () => {
      const storage = new SecretStorage();
      const currentDeviceId = "current-device-id";
      const oldDeviceId = "old-legacy-fingerprint-id";

      const settings: LegacyCredentialSource = {
        deviceSettingsById: {
          [oldDeviceId]: {
            analysisApiKey: "sk-old-fingerprint-key",
          },
        },
      };

      const result = await migrateLegacyCredentials(storage, settings, currentDeviceId);

      expect(result.migratedCount).toBe(1);
      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("sk-old-fingerprint-key");
      expect(settings.deviceSettingsById?.[oldDeviceId]?.analysisApiKey).toBeUndefined();
      expect(result.cleanedSettings).toBe(true);
    });
  });
});
