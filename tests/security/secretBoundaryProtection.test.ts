import { describe, expect, it } from "vitest";
import { SecretStorage } from "../helpers/mockObsidian";
import {
  DEFAULT_SETTINGS,
  getLocalAnalysisApiKey,
  getLocalEmbeddingsApiKey,
  setDeviceSettingsContext,
  setLocalAnalysisApiKey,
  setLocalEmbeddingsApiKey,
  type LinaSettings,
} from "../../src/settings";
import {
  LINA_SECRET_KEYS,
  migrateLegacyCredentials,
  type LegacyCredentialSource,
} from "../../src/device/secretStorage";
import { evaluateCompanionCapability } from "../../src/companion/companionCapability";
import { evaluateOwnershipGate } from "../../src/device/ownershipGate";
import { evaluateEmbeddingUpdatePolicy } from "../../src/maintenance/embeddingPolicyEngine";
import { getEmbeddingProviderCapability } from "../../src/ai/providerCapabilities";
import { FakeAdapter } from "../helpers/fakeAdapter";

describe("Secret Boundary & Credential Protection", () => {
  describe("Legacy Setter Protection", () => {
    it("stores credentials exclusively in SecretStorage and prevents plaintext in data.json when SecretStorage is active", () => {
      const storage = new SecretStorage();
      const settings: LinaSettings = {
        ...DEFAULT_SETTINGS,
        deviceSettingsById: {
          "device-producer": {
            analysisProvider: "mistral",
            embeddingsProvider: "mistral",
            // Simulating preexisting stale plaintext
            analysisApiKey: "old-plaintext-analysis",
            embeddingsApiKey: "old-plaintext-embeddings",
          },
        },
      };

      let saveCount = 0;
      setDeviceSettingsContext(settings, () => { saveCount += 1; }, "device-producer", storage);

      // 1. Set analysis API key
      setLocalAnalysisApiKey("sk-secret-analysis-12345");

      // Verify SecretStorage contains the credential
      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("sk-secret-analysis-12345");
      // Verify data.json deviceSettingsById does NOT contain plaintext
      expect(settings.deviceSettingsById?.["device-producer"]?.analysisApiKey).toBeUndefined();
      expect(settings.aiApiKey).toBe("");
      expect(getLocalAnalysisApiKey()).toBe("sk-secret-analysis-12345");

      // 2. Set embeddings API key
      setLocalEmbeddingsApiKey("sk-secret-embeddings-67890");

      // Verify SecretStorage contains the credential
      expect(storage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey)).toBe("sk-secret-embeddings-67890");
      // Verify data.json deviceSettingsById does NOT contain plaintext
      expect(settings.deviceSettingsById?.["device-producer"]?.embeddingsApiKey).toBeUndefined();
      expect(settings.embeddingApiKey).toBe("");
      expect(getLocalEmbeddingsApiKey()).toBe("sk-secret-embeddings-67890");

      // Verify that save settings was triggered to purge the preexisting plaintext
      expect(saveCount).toBeGreaterThan(0);
    });

    it("clears credentials from SecretStorage and keeps data.json clean", () => {
      const storage = new SecretStorage();
      storage.setSecret(LINA_SECRET_KEYS.analysisApiKey, "initial-key");
      storage.setSecret(LINA_SECRET_KEYS.embeddingsApiKey, "initial-emb-key");

      const settings: LinaSettings = {
        ...DEFAULT_SETTINGS,
        deviceSettingsById: {
          "device-producer": {},
        },
      };

      setDeviceSettingsContext(settings, () => {}, "device-producer", storage);

      // Clear credentials
      setLocalAnalysisApiKey("");
      setLocalEmbeddingsApiKey("");

      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey) ?? "").toBe("");
      expect(storage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey) ?? "").toBe("");
      expect(settings.deviceSettingsById?.["device-producer"]?.analysisApiKey).toBeUndefined();
      expect(settings.deviceSettingsById?.["device-producer"]?.embeddingsApiKey).toBeUndefined();
      expect(getLocalAnalysisApiKey()).toBe("");
      expect(getLocalEmbeddingsApiKey()).toBe("");
    });

    it("falls back to local device settings only when SecretStorage is unavailable", () => {
      const settings: LinaSettings = {
        ...DEFAULT_SETTINGS,
        deviceSettingsById: {
          "device-headless": {},
        },
      };

      // Set context WITHOUT SecretStorage (fallback mode)
      setDeviceSettingsContext(settings, () => {}, "device-headless", undefined);

      setLocalAnalysisApiKey("fallback-analysis-key");
      setLocalEmbeddingsApiKey("fallback-embeddings-key");

      // In fallback mode without SecretStorage, local device settings retain value
      expect(settings.deviceSettingsById?.["device-headless"]?.analysisApiKey).toBe("fallback-analysis-key");
      expect(settings.deviceSettingsById?.["device-headless"]?.embeddingsApiKey).toBe("fallback-embeddings-key");
      expect(getLocalAnalysisApiKey()).toBe("fallback-analysis-key");
      expect(getLocalEmbeddingsApiKey()).toBe("fallback-embeddings-key");
    });
  });

  describe("Migration Protection", () => {
    it("guarantees that legacy configuration with plaintext credentials is fully sanitized", async () => {
      const storage = new SecretStorage();
      const legacyConfig: LegacyCredentialSource = {
        analysisApiKey: "sk-legacy-root-analysis",
        embeddingsApiKey: "sk-legacy-root-embeddings",
        aiApiKey: "sk-legacy-ai",
        embeddingApiKey: "sk-legacy-emb",
        deviceSettingsById: {
          "old-pc": {
            analysisApiKey: "sk-legacy-dev-analysis",
            embeddingsApiKey: "sk-legacy-dev-embeddings",
            aiProfileApiKeys: { mistral: "profile-secret" },
          },
        },
      };

      const result = await migrateLegacyCredentials(storage, legacyConfig, "old-pc");

      expect(result.migratedCount).toBe(2);
      expect(result.cleanedSettings).toBe(true);

      // Secrets safely persisted in OS SecretStorage
      expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("sk-legacy-dev-analysis");
      expect(storage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey)).toBe("sk-legacy-dev-embeddings");

      // All plaintext wiped from data.json source
      expect(legacyConfig.analysisApiKey).toBeUndefined();
      expect(legacyConfig.embeddingsApiKey).toBeUndefined();
      expect(legacyConfig.aiApiKey).toBe("");
      expect(legacyConfig.embeddingApiKey).toBe("");
      expect(legacyConfig.deviceSettingsById?.["old-pc"]?.analysisApiKey).toBeUndefined();
      expect(legacyConfig.deviceSettingsById?.["old-pc"]?.embeddingsApiKey).toBeUndefined();
      expect(legacyConfig.deviceSettingsById?.["old-pc"]?.aiProfileApiKeys).toBeUndefined();
    });
  });

  describe("Companion Isolation & Zero-Sync Secret Guarantee", () => {
    it("guarantees Producer secrets never leak to Companion through vault synchronization", async () => {
      const sharedVaultAdapter = new FakeAdapter();

      // 1. Producer setup
      const producerStorage = new SecretStorage();
      await producerStorage.setSecret(LINA_SECRET_KEYS.analysisApiKey, "producer-mistral-api-key");
      await producerStorage.setSecret(LINA_SECRET_KEYS.embeddingsApiKey, "producer-mistral-embed-key");

      const producerDeviceId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
      const producerSettings: LinaSettings = {
        ...DEFAULT_SETTINGS,
        aiProvider: "mistral",
        embeddingProvider: "mistral",
        deviceSettingsById: {
          [producerDeviceId]: {
            deviceName: "Desktop Producer",
            analysisProvider: "mistral",
            embeddingsProvider: "mistral",
          },
        },
      };

      // Producer saves settings to shared vault
      await sharedVaultAdapter.write(
        ".obsidian/plugins/lina/data.json",
        JSON.stringify(producerSettings, null, 2)
      );

      // Producer publishes ownership and index manifests to shared vault
      await sharedVaultAdapter.write(
        ".lina/ownership.json",
        JSON.stringify({
          schemaVersion: 1,
          activeProducerId: producerDeviceId,
          epoch: 1,
          acquiredAt: new Date().toISOString(),
          reason: "initial-claim",
        }, null, 2)
      );

      await sharedVaultAdapter.write(
        ".lina/index/manifest.json",
        JSON.stringify({
          version: 1,
          indexType: "hybrid",
          totalNotes: 42,
          totalChunks: 120,
          embeddingsEnabled: true,
          embeddings: {
            provider: "mistral",
            model: "mistral-embed",
            dimensions: 1024,
            publicationId: "pub-001",
          },
        }, null, 2)
      );

      // Verify that NOTHING in the shared vault contains the Producer's API keys
      const dataJsonContent = await sharedVaultAdapter.read(".obsidian/plugins/lina/data.json");
      const ownershipContent = await sharedVaultAdapter.read(".lina/ownership.json");
      const manifestContent = await sharedVaultAdapter.read(".lina/index/manifest.json");

      expect(dataJsonContent).not.toContain("producer-mistral-api-key");
      expect(dataJsonContent).not.toContain("producer-mistral-embed-key");
      expect(ownershipContent).not.toContain("producer-mistral-api-key");
      expect(manifestContent).not.toContain("producer-mistral-api-key");

      // 2. Companion setup on a separate device
      const companionStorage = new SecretStorage(); // Empty local OS storage on Companion
      const companionDeviceId = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

      // Companion reads shared data.json
      const syncedSettings = JSON.parse(await sharedVaultAdapter.read(".obsidian/plugins/lina/data.json")) as LinaSettings;
      setDeviceSettingsContext(syncedSettings, () => {}, companionDeviceId, companionStorage);

      // Verify Companion receives ZERO secrets
      expect(companionStorage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBeNull();
      expect(companionStorage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey)).toBeNull();
      expect(getLocalAnalysisApiKey()).toBe("");
      expect(getLocalEmbeddingsApiKey()).toBe("");

      // 3. Verify Companion capability boundaries
      const companionCapability = evaluateCompanionCapability({
        role: "companion",
        isMobile: true,
      });

      expect(companionCapability.isCompanion).toBe(true);
      expect(companionCapability.canGenerateEmbeddings).toBe(false);
      expect(companionCapability.canMaintainSharedIndex).toBe(false);
      expect(companionCapability.canMaintainBinaryCopy).toBe(false);

      // 4. Verify Ownership Gate rejects Companion
      const ownershipDecision = await evaluateOwnershipGate(
        sharedVaultAdapter,
        companionDeviceId,
        "companion",
      );
      expect(ownershipDecision.authorized).toBe(false);
      expect(ownershipDecision.status).toBe("not-producer-role");

      // 5. Verify Embedding Policy rejects Companion from generating
      const providerCapability = getEmbeddingProviderCapability("mistral");
      const policyDecision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true, toGenerateCount: 10 },
        providerCapability,
        policy: "manual",
        deviceRole: "companion",
      });

      expect(policyDecision.allowed).toBe(false);
      expect(policyDecision.requiresConfirmation).toBe(false);
      expect(policyDecision.reason).toBe("companion-device-not-allowed");
    });
  });
});
