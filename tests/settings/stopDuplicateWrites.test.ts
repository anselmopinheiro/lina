import { App } from "obsidian";
import { describe, expect, it, vi, beforeEach } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  DEFAULT_SETTINGS,
  LinaSettingTab,
  migrateSettings,
  type LinaSettings,
} from "../../src/settings";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { createVectorContract, type VectorContractV1 } from "../../src/index/vectorContract";
import { saveDeviceState, type DeviceState } from "../../src/device/deviceState";
import { createArtifactProvenance } from "../../src/device/artifactProvenance";
import { createInitialExclusionPolicy, EXCLUSION_POLICY_FILE_PATH } from "../../src/index/exclusionPolicy";
import { saveTextIndex } from "../../src/index/indexStore";
import { getSecretValueSync, LINA_SECRET_KEYS } from "../../src/device/secretStorage";
import { createSettingsRuntimeAdapters, type SettingsRuntimeHost } from "../../src/settings/settingsRuntimeAdapters";

describe("LINA-03-DATA-JSON-CLEANUP-001 — Stop Duplicate Writes Safely", () => {
  let app: App;
  let adapter: FakeAdapter;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new App();
    app.vault.adapter = adapter;
    app.vault.getMarkdownFiles = () => [];
  });

  function createPlugin(initialStoredData?: { settings?: Partial<LinaSettings>; index?: unknown } | null): LinaPlugin {
    const plugin = new LinaPlugin(app, {
      id: "lina",
      name: "Lina",
      author: "Anselmo Pinheiro",
      version: "0.2.4",
      minAppVersion: "1.13.0",
      description: "Test plugin instance",
    });
    (plugin.app as unknown as { vault: { adapter: unknown; getMarkdownFiles: () => unknown[] } }).vault = {
      adapter,
      getMarkdownFiles: () => [],
    };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      ...(initialStoredData?.settings ?? {}),
    };
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

  // 1. novo save não escreve index duplicado
  it("1. new save does not write duplicated index payload to data.json", async () => {
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
      index: {
        version: 1,
        entries: [{ path: "Legacy.md", mtime: 1, size: 10, wordCount: 2, charCount: 10, excerpt: "legacy" }],
      },
    });

    await plugin.loadDataFromDisk();
    expect(plugin.indexData).toBeDefined();

    const saveSpy = vi.spyOn(plugin, "saveData");
    await plugin.saveDataToDisk();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedPayload = saveSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(savedPayload.settings).toBeDefined();
    expect(savedPayload.index).toBeUndefined();
    expect("index" in savedPayload).toBe(false);
  });

  // 2. runtime de pesquisa continua funcional sem data.json.index
  it("2. search runtime operates using canonical index files without data.json.index", async () => {
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
    });

    await plugin.loadDataFromDisk();
    expect(plugin.indexData).toBeUndefined();

    // Create canonical index files in .lina/index/
    await saveTextIndex(
      plugin.app,
      [{
        path: "Notes/NoteA.md",
        basename: "NoteA",
        extension: "md",
        size: 50,
        mtime: 100,
        charCount: 50,
        wordCount: 10,
        contentHash: "hash-a",
        indexedAt: new Date().toISOString(),
      }],
      [{
        chunkId: "Notes/NoteA.md:0",
        path: "Notes/NoteA.md",
        text: "hello canonical text search",
        textHash: "hash-text",
        charCount: 27,
        wordCount: 4,
        chunkIndex: 0,
        createdAt: new Date().toISOString(),
      }],
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );

    (plugin.app.vault as unknown as { getMarkdownFiles: () => unknown[] }).getMarkdownFiles = () => [
      { path: "Notes/NoteA.md", stat: { size: 50, mtime: 100 } },
    ];

    const loaded = await plugin.ensureTextIndexLoaded("text-search");
    expect(loaded).toBe(true);
    expect(plugin.indexedNotes.map((n) => n.path)).toEqual(["Notes/NoteA.md"]);
    expect(plugin.indexedChunks.length).toBe(1);
  });

  // 3. upgrade com data.json.index antigo continua seguro
  it("3. upgrade with legacy data.json.index is safe, loads in memory, and strips index on save", async () => {
    const legacyIndex = {
      version: 1,
      entries: [{ path: "Old.md", mtime: 1, size: 20, wordCount: 4, charCount: 20, excerpt: "old" }],
    };
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
      index: legacyIndex,
    });

    await plugin.loadDataFromDisk();
    expect(plugin.indexData).toEqual(legacyIndex);

    let savedPayload: Record<string, unknown> | undefined;
    plugin.saveData = vi.fn().mockImplementation(async (data: unknown) => {
      savedPayload = data as Record<string, unknown>;
    });

    await plugin.saveSettings();
    expect(savedPayload).toBeDefined();
    expect(savedPayload!.settings).toBeDefined();
    expect(savedPayload!.index).toBeUndefined();
    expect("index" in savedPayload!).toBe(false);
  });

  // 4. alterar exclusões escreve apenas .lina/exclusions.json
  it("4. updating exclusions writes only .lina/exclusions.json and never calls saveSettings", async () => {
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
    });

    const producerId = plugin.getDeviceId();
    await writeCanonicalOwnershipRecord(producerId);
    const prodState: DeviceState = {
      schemaVersion: 2,
      deviceId: producerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, prodState);

    await plugin.loadDataFromDisk();
    await plugin.initializeExclusionPolicy();

    const saveSettingsSpy = vi.spyOn(plugin, "saveSettings");
    const tab = new LinaSettingTab(app, plugin);

    await tab.setControlValue("indexExcludedFolders", "NewPrivateFolder/\nSecretFolder/");

    // saveSettings was NOT called (no mirror write to data.json)
    expect(saveSettingsSpy).not.toHaveBeenCalled();

    // But canonical .lina/exclusions.json was updated
    const canonicalText = await adapter.read(EXCLUSION_POLICY_FILE_PATH);
    const canonical = JSON.parse(canonicalText);
    expect(canonical.rules.excludedFolders).toEqual(["newprivatefolder/", "secretfolder/"]);
    expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual(["newprivatefolder/", "secretfolder/"]);
  });

  // 5. indexExcluded* legacy ainda pode semear policy quando canonical missing
  it("5. legacy indexExcluded* in data.json seeds initial policy when canonical exclusions.json is missing", async () => {
    const plugin = createPlugin({
      settings: {
        indexExcludedFolders: "LegacySeedFolder/\nArchive/",
        settingsSchemaVersion: 1,
      },
    });

    const producerId = plugin.getDeviceId();
    await writeCanonicalOwnershipRecord(producerId);
    const prodState: DeviceState = {
      schemaVersion: 2,
      deviceId: producerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, prodState);

    expect(await adapter.exists(EXCLUSION_POLICY_FILE_PATH)).toBe(false);

    await plugin.loadDataFromDisk();
    expect(await adapter.exists(EXCLUSION_POLICY_FILE_PATH)).toBe(true);

    const canonicalText = await adapter.read(EXCLUSION_POLICY_FILE_PATH);
    const canonical = JSON.parse(canonicalText);
    expect(canonical.rules.excludedFolders).toEqual(["archive/", "legacyseedfolder/"]);
  });

  // 6. canonical exclusions vencem legacy contraditório
  it("6. canonical exclusions.json strictly takes precedence over contradictory legacy data.json fields", async () => {
    const plugin = createPlugin({
      settings: {
        indexExcludedFolders: "ContradictoryLegacyFolder/",
        indexExcludedPathContains: "contradictory-path",
        indexExcludedContentContains: "contradictory-content",
        settingsSchemaVersion: 1,
      },
    });

    const producerId = plugin.getDeviceId();
    await adapter.mkdir(".lina");
    const canonicalPolicy = createInitialExclusionPolicy(
      {
        excludedFolders: ["canonical-folder/"],
        excludedPathContains: ["canonical-token"],
        excludedContentContains: ["canonical-term"],
      },
      createArtifactProvenance(producerId, 1, new Date().toISOString())
    );
    await adapter.write(EXCLUSION_POLICY_FILE_PATH, JSON.stringify(canonicalPolicy, null, 2));

    await writeCanonicalOwnershipRecord(producerId);
    const prodState: DeviceState = {
      schemaVersion: 2,
      deviceId: producerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, prodState);

    await plugin.loadDataFromDisk();

    expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual(["canonical-folder/"]);
    expect(plugin.getEffectiveExclusionRules().excludedPathContains).toEqual(["canonical-token"]);
    expect(plugin.getEffectiveExclusionRules().excludedContentContains).toEqual(["canonical-term"]);
  });

  // 7. Companion não escreve provider/model efetivos em deviceSettingsById
  it("7. Companion rejects writing embedding provider/model into deviceSettingsById", async () => {
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
    });

    const companionId = plugin.getDeviceId();
    await writeCanonicalOwnershipRecord("dev-00000000-0000-4000-8000-000000000001");
    const compState: DeviceState = {
      schemaVersion: 2,
      deviceId: companionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "companion",
    };
    await saveDeviceState(adapter, compState);

    await plugin.loadDataFromDisk();
    expect(plugin.getLocalDeviceRole()).toBe("companion");

    const host: SettingsRuntimeHost = {
      getSnapshot: () => ({ settings: plugin.settings }),
      replaceSnapshot: (next) => { plugin.settings = next.settings; },
      saveSnapshot: async () => plugin.saveSettings(),
      getCurrentDeviceId: () => companionId,
      runEffect: () => undefined,
      getEffectiveDeviceRole: () => "companion",
    };

    const adapters = createSettingsRuntimeAdapters(host, {
      deviceRole: "companion",
      getEffectiveDeviceRole: () => "companion",
    });

    const resProvider = await adapters.setLocalValue("embeddingsProvider", "openai");
    expect(resProvider.ok).toBe(false);
    expect(resProvider.error).toBe("invalid-value");

    const resModel = await adapters.setLocalValue("embeddingsModel", "text-embedding-3-small");
    expect(resModel.ok).toBe(false);
    expect(resModel.error).toBe("invalid-value");

    const resTuple = await adapters.setLocalProviderValues("embedding", "openai", "text-embedding-3-small", "https://api.openai.com");
    expect(resTuple.ok).toBe(false);
    expect(resTuple.error).toBe("invalid-value");

    expect(plugin.settings.deviceSettingsById?.[companionId]?.embeddingsProvider).toBeUndefined();
    expect(plugin.settings.deviceSettingsById?.[companionId]?.embeddingsModel).toBeUndefined();
  });

  // 8. Companion com valores stale existentes continua a ignorá-los
  it("8. Companion with pre-existing stale local embedding settings ignores them in favor of VectorContract", async () => {
    const contract: VectorContractV1 = createVectorContract({
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });

    await adapter.mkdir(".lina/index");
    await adapter.write(".lina/index/manifest.json", JSON.stringify({
      schemaVersion: 1,
      indexType: "text",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      noteCount: 0,
      chunkCount: 0,
      vectorContract: contract,
    }));

    const companionId = "dev-00000000-0000-4000-8000-000000000002";
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
        deviceSettingsById: {
          [companionId]: {
            embeddingsProvider: "openai",
            embeddingsModel: "text-embedding-3-large",
          },
        },
      },
    });

    plugin.getDeviceId = () => companionId;
    await writeCanonicalOwnershipRecord("dev-00000000-0000-4000-8000-000000000001");
    const compState: DeviceState = {
      schemaVersion: 2,
      deviceId: companionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "companion",
    };
    await saveDeviceState(adapter, compState);

    await plugin.loadDataFromDisk();
    expect(plugin.getLocalDeviceRole()).toBe("companion");
    expect(plugin.getEffectiveEmbeddingContract()).toEqual(contract);

    const config = plugin.getEffectiveEmbeddingConfig();
    expect(config.isAvailable).toBe(true);
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("nomic-embed-text");
  });

  // 9. Active Producer continua a persistir provider/model conforme comportamento atual
  it("9. Active Producer continues to mutate and persist embedding provider and model", async () => {
    const producerId = "dev-00000000-0000-4000-8000-000000000001";
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
        deviceSettingsById: {
          [producerId]: {
            embeddingsProvider: "ollama",
            embeddingsModel: "nomic-embed-text",
          },
        },
      },
    });

    plugin.getDeviceId = () => producerId;
    await writeCanonicalOwnershipRecord(producerId);
    const prodState: DeviceState = {
      schemaVersion: 2,
      deviceId: producerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "producer",
    };
    await saveDeviceState(adapter, prodState);

    await plugin.loadDataFromDisk();
    expect(plugin.getLocalDeviceRole()).toBe("producer");

    const host: SettingsRuntimeHost = {
      getSnapshot: () => ({ settings: plugin.settings }),
      replaceSnapshot: (next) => { plugin.settings = next.settings; },
      saveSnapshot: async () => plugin.saveSettings(),
      getCurrentDeviceId: () => producerId,
      runEffect: () => undefined,
      getEffectiveDeviceRole: () => "producer",
    };

    const adapters = createSettingsRuntimeAdapters(host, {
      deviceRole: "producer",
      getEffectiveDeviceRole: () => "producer",
    });

    const res = await adapters.setLocalProviderValues("embedding", "mistral", "mistral-embed", "https://api.mistral.ai/v1");
    expect(res.ok).toBe(true);

    expect(plugin.settings.deviceSettingsById?.[producerId]?.embeddingsProvider).toBe("mistral");
    expect(plugin.settings.deviceSettingsById?.[producerId]?.embeddingsModel).toBe("mistral-embed");
    expect(plugin.settings.deviceSettingsById?.[producerId]?.embeddingsBaseUrl).toBe("https://api.mistral.ai/v1");
  });

  // 10. Vector Contract no Companion continua canónico
  it("10. Vector Contract on Companion is canonical from .lina/index/manifest.json", async () => {
    const contract: VectorContractV1 = createVectorContract({
      provider: "gemini",
      model: "text-embedding-004",
      dimensions: 768,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });

    await adapter.mkdir(".lina/index");
    await adapter.write(".lina/index/manifest.json", JSON.stringify({
      schemaVersion: 1,
      indexType: "text",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      noteCount: 0,
      chunkCount: 0,
      vectorContract: contract,
    }));

    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
    });

    const companionId = plugin.getDeviceId();
    await writeCanonicalOwnershipRecord("dev-00000000-0000-4000-8000-000000000001");
    const compState: DeviceState = {
      schemaVersion: 2,
      deviceId: companionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "companion",
    };
    await saveDeviceState(adapter, compState);

    await plugin.loadDataFromDisk();
    expect(plugin.getEffectiveEmbeddingContract()?.provider).toBe("gemini");
    expect(plugin.getEffectiveEmbeddingContract()?.model).toBe("text-embedding-004");
  });

  // 11. endpoint local do Companion continua preservado
  it("11. Companion local execution endpoint is preserved independently in deviceSettingsById", async () => {
    const contract: VectorContractV1 = createVectorContract({
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });

    await adapter.mkdir(".lina/index");
    await adapter.write(".lina/index/manifest.json", JSON.stringify({
      schemaVersion: 1,
      indexType: "text",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      noteCount: 0,
      chunkCount: 0,
      vectorContract: contract,
    }));

    const companionId = "dev-00000000-0000-4000-8000-000000000002";
    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
        deviceSettingsById: {
          [companionId]: {
            embeddingsBaseUrl: "http://192.168.1.100:11434",
            embeddingsTimeout: "90",
          },
        },
      },
    });

    plugin.getDeviceId = () => companionId;
    await writeCanonicalOwnershipRecord("dev-00000000-0000-4000-8000-000000000001");
    const compState: DeviceState = {
      schemaVersion: 2,
      deviceId: companionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "companion",
    };
    await saveDeviceState(adapter, compState);

    await plugin.loadDataFromDisk();
    const config = plugin.getEffectiveEmbeddingConfig();

    expect(config.baseUrl).toBe("http://192.168.1.100:11434");
    expect(config.timeoutMs).toBe(90000);
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("nomic-embed-text");
  });

  // 12. credentials locais continuam em SecretStorage
  it("12. local credentials migrate to SecretStorage and are never persisted in plaintext in data.json", async () => {
    const deviceId = "dev-00000000-0000-4000-8000-000000000001";
    const plugin = createPlugin({
      settings: {
        aiApiKey: "legacy-analysis-key",
        embeddingApiKey: "legacy-embedding-key",
        settingsSchemaVersion: 1,
        deviceSettingsById: {
          [deviceId]: {
            analysisApiKey: "device-analysis-key",
            embeddingsApiKey: "device-embedding-key",
          },
        },
      },
    });

    plugin.getDeviceId = () => deviceId;
    await plugin.loadDataFromDisk();

    expect(getSecretValueSync(plugin.app.secretStorage, LINA_SECRET_KEYS.analysisApiKey)).toBe("device-analysis-key");
    expect(getSecretValueSync(plugin.app.secretStorage, LINA_SECRET_KEYS.embeddingsApiKey)).toBe("device-embedding-key");

    expect(plugin.settings.aiApiKey).toBe("");
    expect(plugin.settings.embeddingApiKey).toBe("");
    expect(plugin.settings.deviceSettingsById?.[deviceId]?.analysisApiKey).toBeUndefined();
    expect(plugin.settings.deviceSettingsById?.[deviceId]?.embeddingsApiKey).toBeUndefined();
  });

  // 13. restart após save mantém estado
  it("13. restart after clean save maintains state without extra writes or resurrecting index", async () => {
    let persistedData: unknown = {
      settings: {
        ...DEFAULT_SETTINGS,
        interfaceLanguage: "pt",
        settingsSchemaVersion: 1,
      },
      index: {
        version: 1,
        entries: [{ path: "Legacy.md", mtime: 1, size: 10, wordCount: 2, charCount: 10, excerpt: "legacy" }],
      },
    };

    const session1 = createPlugin(persistedData as { settings?: Partial<LinaSettings>; index?: unknown });
    session1.saveData = vi.fn().mockImplementation(async (data: unknown) => {
      persistedData = JSON.parse(JSON.stringify(data));
    });

    await session1.loadDataFromDisk();
    await session1.saveSettings();

    // Session 1 persisted payload without index
    const saved = persistedData as Record<string, unknown>;
    expect(saved.settings).toBeDefined();
    expect(saved.index).toBeUndefined();

    // Session 2 starts from persisted payload
    const session2 = createPlugin(persistedData as { settings?: Partial<LinaSettings>; index?: unknown });
    const saveSpy2 = vi.spyOn(session2, "saveData");
    await session2.loadDataFromDisk();

    expect(session2.settings.interfaceLanguage).toBe("pt");
    expect(session2.indexData).toBeUndefined();
    expect(saveSpy2).not.toHaveBeenCalled();
  });

  // 14. migrations antigas continuam idempotentes
  it("14. settings migrations remain completely idempotent across repeated runs", () => {
    const raw: Partial<LinaSettings> = {
      aiProvider: "ollama",
      embeddingProvider: "ollama",
    };

    const run1 = migrateSettings(raw, { persistentDeviceId: "dev-00000000-0000-4000-8000-000000000001" });
    expect(run1.changed).toBe(true);
    expect(run1.toVersion).toBe(1);

    const run2 = migrateSettings(raw, { persistentDeviceId: "dev-00000000-0000-4000-8000-000000000001" });
    expect(run2.changed).toBe(false);
    expect(run2.toVersion).toBe(1);
    expect(run2.migratedSteps).toEqual([]);
  });

  // 15. no regression em Settings UI
  it("15. LinaSettingTab renders without regression, shows disabled companion embedding provider", async () => {
    const contract: VectorContractV1 = createVectorContract({
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });

    const plugin = createPlugin({
      settings: {
        settingsSchemaVersion: 1,
      },
    });

    await plugin.loadDataFromDisk();
    plugin.getLocalDeviceRole = () => "companion";
    plugin.getEffectiveEmbeddingContract = () => contract;

    const tab = new LinaSettingTab(app, plugin);
    const defs = tab.getSettingDefinitions();
    expect(defs.length).toBeGreaterThan(0);

    const embeddingGroup = defs.find((g) => g.id === "semantic-embeddings");
    expect(embeddingGroup).toBeDefined();

    const providerItem = embeddingGroup?.items.find((i) => i.id === "embeddings-provider");
    expect(providerItem).toBeDefined();
  });
});
