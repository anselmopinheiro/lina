import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  DEFAULT_SETTINGS,
  setDeviceSettingsContext,
  setLocalAnalysisApiKey,
  setLocalEmbeddingsApiKey,
  getLocalAnalysisApiKey,
  getLocalEmbeddingsApiKey,
} from "../../src/settings";
import { SecretStorage } from "../helpers/mockObsidian";
import { LINA_SECRET_KEYS } from "../../src/device/secretStorage";
import { migrateSettings } from "../../src/settings/settingsMigrations";
import { saveDeviceState, type DeviceState } from "../../src/device/deviceState";
import { EXCLUSION_POLICY_FILE_PATH, createInitialExclusionPolicy } from "../../src/index/exclusionPolicy";
import { createArtifactProvenance } from "../../src/device/artifactProvenance";
import { createVectorContract } from "../../src/index/vectorContract";
import { FakeAdapter } from "../helpers/fakeAdapter";

describe("LINA-03-IMPLEMENT-LEGACY-SETTINGS-CLEANUP-001 — Legacy Settings Authority Demotion", () => {
  function createTestEnvironment() {
    const adapter = new FakeAdapter();
    const app = new App();
    (app.vault as unknown as { adapter: FakeAdapter }).adapter = adapter;
    const plugin = new LinaPlugin(app);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: {
        [plugin.getDeviceId()]: {},
      },
    };
    plugin.loadData = vi.fn().mockImplementation(async () => ({
      settings: plugin.settings,
    }));
    return { adapter, app, plugin };
  }

  // 1. Campo legacy não ganha autoridade sobre o Vector Contract
  it("1. Legacy embedding fields in data.json do not gain authority over published Vector Contract", async () => {
    const { adapter, plugin } = createTestEnvironment();
    const companionId = plugin.getDeviceId();

    // Companion device state
    const companionState: DeviceState = {
      schemaVersion: 2,
      deviceId: companionId,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-10T15:00:00.000Z",
      deviceName: "Companion Device",
      role: "companion",
    };
    await saveDeviceState(adapter, companionState);

    // Setup legacy data.json with conflicting embedding configuration
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      embeddingProvider: "ollama",
      embeddingModel: "legacy-ollama-model-A",
      embeddingsProvider: "ollama",
      embeddingsModel: "legacy-ollama-model-A",
      deviceSettingsById: {
        [companionId]: {
          embeddingsProvider: "openrouter",
          embeddingsModel: "legacy-device-model-A",
        },
      },
    };
    await adapter.write("data.json", JSON.stringify(plugin.settings));

    // Authoritative Vector Contract published in .lina/index/manifest.json
    const contract = createVectorContract({
      provider: "openrouter",
      model: "canonical-authoritative-model-B",
      dimensions: 1536,
      prefixMode: "none",
      inputVersion: 1,
    });
    await adapter.write(".lina/index/manifest.json", JSON.stringify({
      schemaVersion: 1,
      vectorContract: contract,
    }));

    await plugin.loadDataFromDisk();

    expect(plugin.getLocalDeviceRole()).toBe("companion");

    // Effective embedding config MUST strictly use the Vector Contract
    const effective = plugin.getEffectiveEmbeddingConfig();
    expect(effective.provider).toBe("openrouter");
    expect(effective.model).toBe("canonical-authoritative-model-b");
    expect(effective.contract).toEqual(contract);

    // Ensure legacy data.json did not override the model
    expect(effective.model).not.toBe("legacy-ollama-model-A");
    expect(effective.model).not.toBe("legacy-device-model-A");
  });

  // 2. Exclusões: data.json exclusions vs .lina/exclusions.json
  it("2. Canonical .lina/exclusions.json takes strict priority over legacy data.json exclusions", async () => {
    const { adapter, plugin } = createTestEnvironment();

    // Stale/conflicting exclusions in data.json
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      indexExcludedFolders: "LegacySecretFolder/\nOldPrivate/",
      indexExcludedPathContains: "legacy-ignore",
      indexExcludedContentContains: "legacy-token",
    };
    await adapter.write("data.json", JSON.stringify(plugin.settings));

    // Authoritative exclusions in .lina/exclusions.json
    const provenance = createArtifactProvenance(
      plugin.getDeviceId(),
      1,
      new Date().toISOString()
    );
    const canonicalPolicy = createInitialExclusionPolicy(
      {
        excludedFolders: ["canonicalsecretfolder/"],
        excludedPathContains: ["canonical-secret"],
        excludedContentContains: ["topsecret"],
      },
      provenance
    );
    await adapter.write(".lina/exclusions.json", JSON.stringify(canonicalPolicy));

    await plugin.loadDataFromDisk();

    expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("loaded");

    // Canonical rules must be active
    const effectiveRules = plugin.getEffectiveExclusionRules();
    expect(effectiveRules.excludedFolders).toEqual(["canonicalsecretfolder/"]);
    expect(effectiveRules.excludedPathContains).toEqual(["canonical-secret"]);

    // Test path filtering: canonical path is excluded, legacy path is NOT excluded
    expect(plugin.isIndexPathExcludedByUserRules("CanonicalSecretFolder/note.md")).toBe(true);
    expect(plugin.isIndexPathExcludedByUserRules("sub/canonical-secret.md")).toBe(true);
    expect(plugin.isIndexPathExcludedByUserRules("LegacySecretFolder/note.md")).toBe(false);
    expect(plugin.isIndexPathExcludedByUserRules("sub/legacy-ignore.md")).toBe(false);
  });

  // 3. Secrets: API key não é escrita novamente em data.json
  it("3. API keys stored via SecretStorage are never written to data.json in plaintext", async () => {
    const storage = new SecretStorage();
    const settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: {
        "test-device": {
          analysisApiKey: "old-stale-analysis",
          embeddingsApiKey: "old-stale-embeddings",
        },
      },
    };

    let saveCount = 0;
    setDeviceSettingsContext(settings, () => { saveCount += 1; }, "test-device", storage);

    // Save credentials
    setLocalAnalysisApiKey("sk-live-analysis-key-test");
    setLocalEmbeddingsApiKey("sk-live-embeddings-key-test");

    // SecretStorage has the keys
    expect(storage.getSecret(LINA_SECRET_KEYS.analysisApiKey)).toBe("sk-live-analysis-key-test");
    expect(storage.getSecret(LINA_SECRET_KEYS.embeddingsApiKey)).toBe("sk-live-embeddings-key-test");

    // data.json settings and deviceSettingsById do NOT contain plaintext
    expect(settings.deviceSettingsById?.["test-device"]?.analysisApiKey).toBeUndefined();
    expect(settings.deviceSettingsById?.["test-device"]?.embeddingsApiKey).toBeUndefined();
    expect(settings.aiApiKey).toBe("");
    expect(settings.embeddingApiKey).toBe("");

    // Serialization of data.json does not leak the keys
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toContain("sk-live-analysis-key-test");
    expect(serialized).not.toContain("sk-live-embeddings-key-test");

    // Getters still return the keys via SecretStorage
    expect(getLocalAnalysisApiKey()).toBe("sk-live-analysis-key-test");
    expect(getLocalEmbeddingsApiKey()).toBe("sk-live-embeddings-key-test");
  });

  // 4. Migração e Compatibilidade com Vault Antigo
  describe("4. Migration and backward compatibility", () => {
    it("safely falls back to data.json exclusions when .lina/exclusions.json is absent", async () => {
      const { adapter, plugin } = createTestEnvironment();

      // Old vault without .lina/exclusions.json
      expect(await adapter.exists(EXCLUSION_POLICY_FILE_PATH)).toBe(false);

      plugin.settings = {
        ...DEFAULT_SETTINGS,
        indexExcludedFolders: "OldVaultPrivate/\n03_Pessoal/",
        indexExcludedPathContains: "secret-key",
      };
      await adapter.write("data.json", JSON.stringify({ settings: plugin.settings }));

      await plugin.loadDataFromDisk();

      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("missing");

      // Effective rules gracefully fall back to legacy data.json
      const effectiveRules = plugin.getEffectiveExclusionRules();
      expect(effectiveRules.excludedFolders).toContain("oldvaultprivate/");
      expect(effectiveRules.excludedFolders).toContain("03_pessoal/");
      expect(effectiveRules.excludedPathContains).toContain("secret-key");

      expect(plugin.isIndexPathExcludedByUserRules("OldVaultPrivate/diary.md")).toBe(true);
      expect(plugin.isIndexPathExcludedByUserRules("notes/secret-key.md")).toBe(true);
      expect(plugin.isIndexPathExcludedByUserRules("public/note.md")).toBe(false);
    });

    it("migrates v0 settings schema to v1 idempotently without deleting legacy keys", () => {
      const legacyRaw: Record<string, unknown> = {
        provider: "ollama",
        ollamaUrl: "http://127.0.0.1:11434",
        chatModel: "llama3:latest",
        embeddingLocalEnabled: true,
        embeddingLocalBaseUrl: "http://127.0.0.1:11434",
        embeddingLocalModel: "all-minilm:latest",
        localDeviceName: "Workstation One",
        localAnalysisProvider: "ollama",
      };

      const result = migrateSettings(legacyRaw, { persistentDeviceId: "device-uuid-123" });
      expect(result.changed).toBe(true);
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(1);

      // Migrated to v1 fields
      expect(legacyRaw.aiProvider).toBe("ollama");
      expect(legacyRaw.aiBaseUrl).toBe("http://127.0.0.1:11434");
      expect(legacyRaw.aiAnalysisModel).toBe("llama3:latest");
      expect(legacyRaw.embeddingsEnabled).toBe(true);
      expect(legacyRaw.embeddingBaseUrl).toBe("http://127.0.0.1:11434");
      expect(legacyRaw.embeddingModel).toBe("all-minilm:latest");

      // Namespaced into deviceSettingsById
      const byId = legacyRaw.deviceSettingsById as Record<string, Record<string, unknown>>;
      expect(byId["device-uuid-123"].deviceName).toBe("Workstation One");
      expect(byId["device-uuid-123"].analysisProvider).toBe("ollama");

      // Second migration is idempotent (no-op)
      const secondResult = migrateSettings(legacyRaw, { persistentDeviceId: "device-uuid-123" });
      expect(secondResult.changed).toBe(false);
      expect(secondResult.fromVersion).toBe(1);
      expect(secondResult.toVersion).toBe(1);
    });
  });
});
