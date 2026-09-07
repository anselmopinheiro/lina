import { App } from "obsidian";
import { describe, expect, it, vi, beforeEach } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  LinaSettingTab,
  migrateSettings,
  type LinaSettings,
} from "../../src/settings";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { createVectorContract } from "../../src/index/vectorContract";
import { saveDeviceState, type DeviceState } from "../../src/device/deviceState";
import { createArtifactProvenance } from "../../src/device/artifactProvenance";
import { createInitialExclusionPolicy } from "../../src/index/exclusionPolicy";
import { setSecretValue, LINA_SECRET_KEYS } from "../../src/device/secretStorage";

describe("LINA-03-HARDEN-UPGRADES-001 — Settings Schema, Migrations & State Precedence", () => {
  let app: App;
  let adapter: FakeAdapter;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new App();
    app.vault.adapter = adapter;
  });

  function createPlugin(initialStoredData?: unknown): LinaPlugin {
    const plugin = new LinaPlugin(app, {
      id: "lina",
      name: "Lina",
      author: "Anselmo Pinheiro",
      version: "0.3.0",
      minAppVersion: "1.13.0",
      description: "Test plugin instance",
    });
    (plugin.app as unknown as { vault: { adapter: unknown } }).vault = { adapter };
    plugin.loadData = vi.fn().mockResolvedValue(initialStoredData);
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    return plugin;
  }

  async function writeCanonicalOwnershipRecord(activeProducerId: string | null, epoch = 1): Promise<void> {
    await adapter.mkdir(".lina");
    await adapter.write(
      ".lina/ownership.json",
      JSON.stringify({
        schemaVersion: 1,
        activeProducerId,
        epoch,
        acquiredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        reason: "initial",
      })
    );
  }

  // 1. Fresh install
  it("1. fresh install initializes default settings with settingsSchemaVersion: 1 and does not write to disk", async () => {
    const plugin = createPlugin(null);
    const saveSpy = vi.spyOn(plugin, "saveData");

    await plugin.loadDataFromDisk();

    expect(plugin.settings.settingsSchemaVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
    expect(plugin.settings.aiProvider).toBe("ollama");
    expect(plugin.settings.embeddingsEnabled).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  // 2. data.json sem settingsSchemaVersion
  it("2. data.json without settingsSchemaVersion upgrades to schema version 1 and persists migrated state", async () => {
    const legacyData = {
      settings: {
        aiProvider: "ollama",
        aiBaseUrl: "http://localhost:11434",
      },
    };
    const plugin = createPlugin(legacyData);
    const saveSpy = vi.spyOn(plugin, "saveData");

    await plugin.loadDataFromDisk();

    expect(plugin.settings.settingsSchemaVersion).toBe(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedData = saveSpy.mock.calls[0][0] as { settings: LinaSettings };
    expect(savedData.settings.settingsSchemaVersion).toBe(1);
  });

  // 3. upgrade 0.2.4-like shape
  it("3. upgrade 0.2.4-like shape migrates legacy analysis and embedding fields to canonical locations", async () => {
    const legacy024Shape = {
      settings: {
        provider: "ollama",
        ollamaUrl: "http://192.168.1.100:11434",
        chatModel: "gemma4:12b",
        embeddingLocalEnabled: true,
        embeddingLocalBaseUrl: "http://192.168.1.100:11434",
        embeddingLocalModel: "nomic-embed-text",
        embeddingLocalTimeoutMs: 45000,
        autoGenerateEmbeddingsOnStartup: true,
        autoGenerateEmbeddingsOnlyWhenNeeded: false,
      },
    };
    const plugin = createPlugin(legacy024Shape);

    await plugin.loadDataFromDisk();

    expect(plugin.settings.settingsSchemaVersion).toBe(1);
    expect(plugin.settings.aiProvider).toBe("ollama");
    expect(plugin.settings.aiBaseUrl).toBe("http://192.168.1.100:11434");
    expect(plugin.settings.aiAnalysisModel).toBe("gemma4:12b");
    expect(plugin.settings.embeddingsEnabled).toBe(true);
    expect(plugin.settings.embeddingBaseUrl).toBe("http://192.168.1.100:11434");
    expect(plugin.settings.embeddingModel).toBe("nomic-embed-text");
    expect(plugin.settings.embeddingRequestTimeoutSeconds).toBe(45);
    expect(plugin.settings.generateEmbeddingsOnStartup).toBe(true);
    expect(plugin.settings.generateOnlyMissingEmbeddings).toBe(false);
  });

  // 4. upgrade de schema N -> atual
  it("4. upgrade from schema 0 to current schema runs sequential migration pipeline", () => {
    const raw: Record<string, unknown> = {
      provider: "mistral",
      ollamaUrl: "http://custom-host:11434",
    };

    const result = migrateSettings(raw);

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(result.changed).toBe(true);
    expect(result.unsupportedFutureVersion).toBe(false);
    expect(result.migratedSteps).toEqual(["v0-to-v1"]);
    expect(raw.settingsSchemaVersion).toBe(1);
    expect(raw.aiProvider).toBe("mistral");
    expect(raw.aiBaseUrl).toBe("http://custom-host:11434");
  });

  // 5. migration executada duas vezes (idempotence)
  it("5. running migration twice is strictly idempotent with changed === false on second run", () => {
    const raw: Record<string, unknown> = {
      provider: "ollama",
      embeddingLocalEnabled: true,
    };

    const firstRun = migrateSettings(raw);
    expect(firstRun.changed).toBe(true);
    expect(firstRun.toVersion).toBe(1);
    expect(raw.settingsSchemaVersion).toBe(1);

    const snapshotAfterFirst = JSON.parse(JSON.stringify(raw));

    const secondRun = migrateSettings(raw);
    expect(secondRun.changed).toBe(false);
    expect(secondRun.fromVersion).toBe(1);
    expect(secondRun.toVersion).toBe(1);
    expect(secondRun.migratedSteps).toEqual([]);
    expect(raw).toEqual(snapshotAfterFirst);
  });

  // 6. startup sem abrir Settings
  it("6. startup migrates data completely without requiring LinaSettingTab to be opened", async () => {
    const rawData = {
      settings: {
        provider: "openrouter",
        openrouterUrl: "https://openrouter.ai/api/v1",
        chatModel: "anthropic/claude-3-haiku",
      },
    };
    const plugin = createPlugin(rawData);

    // Run startup only (no LinaSettingTab instantiated)
    await plugin.loadDataFromDisk();

    expect(plugin.settings.aiProvider).toBe("openrouter");
    expect(plugin.settings.aiBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(plugin.settings.aiAnalysisModel).toBe("anthropic/claude-3-haiku");
    expect(plugin.settings.settingsSchemaVersion).toBe(1);
  });

  // 7. legacy analysis fields migrados
  it("7. legacy analysis fields (provider, ollamaUrl, openrouterUrl, chatModel) migrate to canonical fields", () => {
    const raw: Record<string, unknown> = {
      provider: "mistral",
      ollamaUrl: "http://mistral-local:11434",
      chatModel: "mistral-small-latest",
    };

    const result = migrateSettings(raw);

    expect(result.changed).toBe(true);
    expect(raw.aiProvider).toBe("mistral");
    expect(raw.aiBaseUrl).toBe("http://mistral-local:11434");
    expect(raw.aiAnalysisModel).toBe("mistral-small-latest");
  });

  // 8. legacy embedding fields não sobrepõem VectorContract no Companion
  it("8. legacy embedding settings in data.json do not override canonical VectorContract on Companion", async () => {
    const contract = createVectorContract({
      provider: "ollama",
      model: "bge-m3",
      dimensions: 1024,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });

    await adapter.mkdir(".lina/index");
    await adapter.write(
      ".lina/index/manifest.json",
      JSON.stringify({
        schemaVersion: 1,
        vectorContract: contract,
      })
    );

    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
        embeddingModel: "legacy-unwanted-model",
        embeddingLocalModel: "another-legacy-model",
      },
    });

    await plugin.loadDataFromDisk();
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("companion");

    const effectiveConfig = plugin.getEffectiveEmbeddingConfig();
    expect(effectiveConfig.provider).toBe("ollama");
    expect(effectiveConfig.model).toBe("bge-m3");
    expect(effectiveConfig.contract).toEqual(contract);
    expect(effectiveConfig.isAvailable).toBe(true);
    expect(effectiveConfig.model).not.toBe("legacy-unwanted-model");
  });

  // 9. legacy exclusions só atuam como migration source quando canonical policy missing
  it("9. legacy exclusions only act as migration source when canonical policy is missing and device can publish", async () => {
    const plugin = createPlugin({
      settings: {
        indexExcludedFolders: "LegacySecretFolder/",
        indexExcludedPathContains: "legacy-token",
        indexExcludedContentContains: "",
      },
    });

    const deviceId = plugin.getDeviceId();
    const state: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, state);
    await writeCanonicalOwnershipRecord(deviceId, 1);

    await plugin.loadDataFromDisk();

    expect(plugin.canonicalPolicyStatus).toBe("loaded");
    expect(plugin.effectiveExclusionRules.excludedFolders).toContain("legacysecretfolder/");
    expect(await adapter.exists(".lina/exclusions.json")).toBe(true);
  });

  // 10. canonical exclusions vencem legacy contraditório
  it("10. canonical exclusions in .lina/exclusions.json take precedence over contradictory legacy data.json", async () => {
    const provenance = createArtifactProvenance(
      "11111111-1111-4111-8111-111111111111",
      1,
      new Date().toISOString()
    );
    const canonicalPolicy = createInitialExclusionPolicy(
      {
        excludedFolders: ["canonicalfolder/"],
        excludedPathContains: ["canonical-secret"],
        excludedContentContains: [],
      },
      provenance
    );
    await adapter.mkdir(".lina");
    await adapter.write(".lina/exclusions.json", JSON.stringify(canonicalPolicy));

    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
        indexExcludedFolders: "ContradictoryLegacyFolder/",
        indexExcludedPathContains: "contradictory-legacy-token",
      },
    });

    await plugin.loadDataFromDisk();

    expect(plugin.canonicalPolicyStatus).toBe("loaded");
    expect(plugin.effectiveExclusionRules.excludedFolders).toEqual(["canonicalfolder/"]);
    expect(plugin.effectiveExclusionRules.excludedPathContains).toEqual(["canonical-secret"]);
    expect(plugin.effectiveExclusionRules.excludedFolders).not.toContain("contradictorylegacyfolder/");
  });

  // 11. SecretStorage migration continua segura
  it("11. plaintext API keys in settings are migrated into SecretStorage and purged from settings", async () => {
    const plugin = createPlugin({
      settings: {
        analysisApiKey: "plaintext-analysis-key-12345",
        embeddingsApiKey: "plaintext-embeddings-key-67890",
      },
    });

    await plugin.loadDataFromDisk();

    expect(plugin.settings.analysisApiKey).toBeUndefined();
    expect(plugin.settings.embeddingsApiKey).toBeUndefined();
    expect(plugin.settings.settingsSchemaVersion).toBe(1);
  });

  // 12. device UUID/fingerprint migration preservada
  it("12. device settings under legacy fingerprint ID migrate to persistent device UUID", () => {
    const persistentDeviceId = "device-uuid-9999";
    const legacyFingerprintId = "device-legacy-hash";

    const raw: Record<string, unknown> = {
      deviceSettingsById: {
        [legacyFingerprintId]: {
          deviceName: "Legacy Machine Name",
          analysisModel: "custom-legacy-model",
        },
      },
    };

    const result = migrateSettings(raw, {
      persistentDeviceId,
      legacyFingerprintDeviceId: legacyFingerprintId,
    });

    expect(result.changed).toBe(true);
    const byId = raw.deviceSettingsById as Record<string, Record<string, unknown>>;
    expect(byId[persistentDeviceId]).toBeDefined();
    expect(byId[persistentDeviceId].deviceName).toBe("Legacy Machine Name");
    expect(byId[persistentDeviceId].analysisModel).toBe("custom-legacy-model");
  });

  // 13. ownership canónico vence state local
  it("13. canonical ownership record in .lina/ownership.json overrides local state claiming producer", async () => {
    const plugin = createPlugin();
    const localDeviceId = plugin.getDeviceId();

    const state: DeviceState = {
      schemaVersion: 2,
      deviceId: localDeviceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, state);
    const otherDeviceId = "11111111-1111-4111-8111-111111111111";
    await writeCanonicalOwnershipRecord(otherDeviceId, 1);

    await plugin.loadDataFromDisk();

    const decision = plugin.getOwnershipGate().getLastDecision();
    expect(decision?.authorized).toBe(false);
    expect(decision?.activeProducerId).toBe(otherDeviceId);
  });

  // 14. invalid canonical file mantém fail-safe existente
  it("14. invalid canonical exclusion file triggers fail-safe and refuses silent overwrite", async () => {
    await adapter.mkdir(".lina");
    await adapter.write(".lina/exclusions.json", "{ malformed JSON content !!");

    const plugin = createPlugin({
      settings: {
        indexExcludedFolders: "FallbackFolder/",
      },
    });

    await plugin.loadDataFromDisk();

    expect(plugin.canonicalPolicyStatus).toBe("invalid");
    expect(plugin.effectiveExclusionRules.excludedFolders).toEqual([]);
    const diskContent = await adapter.read(".lina/exclusions.json");
    expect(diskContent).toBe("{ malformed JSON content !!");
  });

  // 15. future unknown settings schema não é sobrescrito
  it("15. future unknown settingsSchemaVersion is preserved and never destructively overwritten", async () => {
    const futureData = {
      settings: {
        settingsSchemaVersion: 99,
        aiProvider: "ollama",
        futureFieldIntroducedInV99: "future-value",
      },
    };

    const plugin = createPlugin(futureData);
    const saveSpy = vi.spyOn(plugin, "saveData");

    await plugin.loadDataFromDisk();

    expect(plugin.settings.settingsSchemaVersion).toBe(99);
    expect(plugin.settings.futureFieldIntroducedInV99).toBe("future-value");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  // 16. no-op startup não regrava estado desnecessariamente
  it("16. clean startup with already migrated settings does not perform redundant disk writes", async () => {
    const cleanData = {
      settings: {
        ...DEFAULT_SETTINGS,
        settingsSchemaVersion: 1,
      },
    };

    const plugin = createPlugin(cleanData);
    const saveSpy = vi.spyOn(plugin, "saveData");

    await plugin.loadDataFromDisk();

    expect(saveSpy).not.toHaveBeenCalled();
  });

  // 17. endpoint local Companion preservado
  it("17. Companion preserves local endpoint and does not overwrite it with Producer settings", async () => {
    const contract = createVectorContract({
      provider: "ollama",
      model: "bge-m3",
      dimensions: 1024,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });

    await adapter.mkdir(".lina/index");
    await adapter.write(".lina/index/manifest.json", JSON.stringify({ schemaVersion: 1, vectorContract: contract }));

    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
        embeddingBaseUrl: "http://192.168.1.200:11434",
      },
    });

    await plugin.loadDataFromDisk();
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("companion");

    const effectiveConfig = plugin.getEffectiveEmbeddingConfig();
    expect(effectiveConfig.provider).toBe("ollama");
    expect(effectiveConfig.model).toBe("bge-m3");
    expect(effectiveConfig.baseUrl).toBe("http://192.168.1.200:11434");
    expect(effectiveConfig.contract).toEqual(contract);
    expect(effectiveConfig.isAvailable).toBe(true);
  });

  // 18. credentials locais preservadas
  it("18. Companion preserves local credentials for authorized local network access", async () => {
    const contract = createVectorContract({
      provider: "ollama",
      model: "bge-m3",
      dimensions: 1024,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });

    await adapter.mkdir(".lina/index");
    await adapter.write(".lina/index/manifest.json", JSON.stringify({ schemaVersion: 1, vectorContract: contract }));

    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
    });

    await setSecretValue(app.secretStorage, LINA_SECRET_KEYS.embeddingsApiKey, "local-companion-token-abc");

    await plugin.loadDataFromDisk();
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("companion");

    const effectiveConfig = plugin.getEffectiveEmbeddingConfig();
    expect(effectiveConfig.apiKey).toBe("local-companion-token-abc");
  });

  // 19. Active Producer settings preservadas
  it("19. Active Producer preserves role and settings across startup", async () => {
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
        aiAnalysisModel: "gemma4:e2b",
      },
    });

    const deviceId = plugin.getDeviceId();
    const state: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, state);
    await writeCanonicalOwnershipRecord(deviceId, 1);

    await plugin.loadDataFromDisk();

    expect(plugin.getLocalDeviceRole()).toBe("producer");
    expect(plugin.settings.aiAnalysisModel).toBe("gemma4:e2b");
    const gateDecision = plugin.getOwnershipGate().getLastDecision();
    expect(gateDecision?.authorized).toBe(true);
  });

  // 20. Standby state preservado
  it("20. Standby producer preserves local state and is prohibited from publishing", async () => {
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
    });

    const deviceId = plugin.getDeviceId();
    const state: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, state);
    const otherDeviceId = "22222222-2222-4222-8222-222222222222";
    await writeCanonicalOwnershipRecord(otherDeviceId, 1);

    await plugin.loadDataFromDisk();

    expect(plugin.getLocalDeviceRole()).toBe("producer");
    const gateDecision = plugin.getOwnershipGate().getLastDecision();
    expect(gateDecision?.authorized).toBe(false);
  });

  // 21. Companion role preservado
  it("21. Companion role is preserved in device state and resolution across migrations", async () => {
    const plugin = createPlugin({
      settings: {
        provider: "ollama", // unmigrated
      },
    });

    const deviceId = plugin.getDeviceId();
    const state: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "companion",
    };
    await saveDeviceState(adapter, state);

    await plugin.loadDataFromDisk();

    expect(plugin.getLocalDeviceRole()).toBe("companion");
    expect(plugin.settings.settingsSchemaVersion).toBe(1);
    expect(plugin.settings.aiProvider).toBe("ollama");
  });

  // 22. restart pós-migration mantém estado idêntico
  it("22. restart after migration preserves identical state and requires no further persistence writes", async () => {
    let persistedData: unknown = {
      settings: {
        provider: "mistral",
        embeddingLocalEnabled: true,
      },
    };

    // First session: migration runs and persists
    const pluginSession1 = createPlugin(persistedData);
    pluginSession1.saveData = vi.fn().mockImplementation(async (data: unknown) => {
      persistedData = JSON.parse(JSON.stringify(data));
    });

    await pluginSession1.loadDataFromDisk();
    expect(pluginSession1.settings.settingsSchemaVersion).toBe(1);
    expect(pluginSession1.settings.aiProvider).toBe("mistral");
    expect(pluginSession1.settings.embeddingsEnabled).toBe(true);

    // Second session: starts with already persisted data
    const pluginSession2 = createPlugin(persistedData);
    const saveSpy2 = vi.spyOn(pluginSession2, "saveData");

    await pluginSession2.loadDataFromDisk();

    expect(pluginSession2.settings.settingsSchemaVersion).toBe(1);
    expect(pluginSession2.settings.aiProvider).toBe("mistral");
    expect(pluginSession2.settings.embeddingsEnabled).toBe(true);
    expect(saveSpy2).not.toHaveBeenCalled();
  });

  // 23. build/settings UI continuam funcionais depois da migration
  it("23. LinaSettingTab instantiates and operates without re-triggering migration or save", async () => {
    const plugin = createPlugin({
      settings: {
        ...DEFAULT_SETTINGS,
        settingsSchemaVersion: 1,
      },
    });

    await plugin.loadDataFromDisk();

    const saveSpy = vi.spyOn(plugin, "saveSettings");
    const tab = new LinaSettingTab(app, plugin);

    expect(tab).toBeDefined();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
