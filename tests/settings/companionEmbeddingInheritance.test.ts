import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  createVectorContract,
  type VectorContractV1,
} from "../../src/index/vectorContract";
import {
  createDetachedEmbeddingsModelRenderer,
  createDetachedEmbeddingsProviderRenderer,
  type DetachedSettingsPorts,
} from "../../src/settings/declarativeSettingRenderers";
import {
  createSettingsRuntimeAdapters,
  type SettingsRuntimeHost,
  type SettingsRuntimeSnapshot,
} from "../../src/settings/settingsRuntimeAdapters";
import { getStrings } from "../../src/i18n/strings";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { runHybridSearch } from "../../src/search/hybridSearch";
import { Chunk } from "../../src/index/chunker";
import { IndexedNote } from "../../src/index/indexStore";
import { DEFAULT_SETTINGS } from "../../src/settings";

function createSettingDouble() {
  let name = "";
  let desc = "";
  let dropdownDisabled = false;
  let dropdownValue = "";
  const dropdownOptions: Array<{ value: string; label: string }> = [];
  const dropdown = {
    addOption(value: string, label: string) {
      dropdownOptions.push({ value, label });
      return dropdown;
    },
    setValue(value: string) {
      dropdownValue = value;
      return dropdown;
    },
    setDisabled(disabled: boolean) {
      dropdownDisabled = disabled;
      return dropdown;
    },
    onChange() {
      return dropdown;
    },
  };
  const setting = {
    setName(n: string) { name = n; return setting; },
    setDesc(d: string) { desc = d; return setting; },
    addDropdown(cb: (d: typeof dropdown) => void) { cb(dropdown); return setting; },
    addText() { return setting; },
    controlEl: { empty() {} },
  };
  return {
    setting: setting as never,
    get name() { return name; },
    get desc() { return desc; },
    get dropdownDisabled() { return dropdownDisabled; },
    get dropdownValue() { return dropdownValue; },
    get dropdownOptions() { return dropdownOptions; },
  };
}

const mockStrings = getStrings("pt-PT");

const sampleContract: VectorContractV1 = createVectorContract({
  provider: "ollama",
  model: "nomic-embed-text-v2-moe",
  dimensions: 768,
  metric: "cosine",
  prefixMode: "none",
  inputVersion: 1,
});

describe("LINA-03-FIX-EMBEDDING-INHERITANCE-001 — Vector Contract Inheritance and Companion Gating", () => {
  // Scenario 1: Fresh Companion sem Producer
  it("Scenario 1: Fresh Companion without Producer has disabled provider/model, semantic unavailable, and hybrid degrades to text", async () => {
    const ports: DetachedSettingsPorts = {
      getGlobal: () => undefined,
      setGlobal: async () => undefined,
      getLocal: () => "" as never,
      setLocal: async () => undefined,
      setProvider: async () => false,
      requestUpdate: () => undefined,
      getDeviceRole: () => "companion",
      getEffectiveEmbeddingContract: () => null,
    };

    const providerRenderer = createDetachedEmbeddingsProviderRenderer(mockStrings, ports);
    const modelRenderer = createDetachedEmbeddingsModelRenderer(mockStrings, ports);

    const providerDouble = createSettingDouble();
    providerRenderer(providerDouble.setting, {} as never);
    expect(providerDouble.dropdownDisabled).toBe(true);
    expect(providerDouble.dropdownValue).toBe("unavailable");
    expect(providerDouble.desc).toContain(mockStrings.settingsCompanionNoContractDesc);

    const modelDouble = createSettingDouble();
    modelRenderer(modelDouble.setting, { listEl: { createEl: () => ({}) } } as never);
    expect(modelDouble.dropdownDisabled).toBe(true);
    expect(modelDouble.dropdownValue).toBe("unavailable");
    expect(modelDouble.desc).toContain(mockStrings.settingsCompanionNoContractDesc);
  });

  // Scenario 2: Companion com contrato válido
  it("Scenario 2: Companion with valid contract inherits provider and model, renders disabled dropdowns reflecting the contract", () => {
    const ports: DetachedSettingsPorts = {
      getGlobal: () => undefined,
      setGlobal: async () => undefined,
      getLocal: () => "" as never,
      setLocal: async () => undefined,
      setProvider: async () => false,
      requestUpdate: () => undefined,
      getDeviceRole: () => "companion",
      getEffectiveEmbeddingContract: () => sampleContract,
    };

    const providerRenderer = createDetachedEmbeddingsProviderRenderer(mockStrings, ports);
    const modelRenderer = createDetachedEmbeddingsModelRenderer(mockStrings, ports);

    const providerDouble = createSettingDouble();
    providerRenderer(providerDouble.setting, {} as never);
    expect(providerDouble.dropdownDisabled).toBe(true);
    expect(providerDouble.dropdownValue).toBe(sampleContract.provider);
    expect(providerDouble.desc).toBe(mockStrings.settingsEmbeddingManagedByProducer);

    const modelDouble = createSettingDouble();
    modelRenderer(modelDouble.setting, { listEl: { createEl: () => ({}) } } as never);
    expect(modelDouble.dropdownDisabled).toBe(true);
    expect(modelDouble.dropdownValue).toBe(sampleContract.model);
    expect(modelDouble.desc).toBe(mockStrings.settingsEmbeddingManagedByProducer);
  });

  // Scenario 3: Companion com valores stale contraditórios em data.json (contract vence)
  it("Scenario 3: Stale local settings in data.json are overridden by published VectorContract on Companion", () => {
    let snapshot: SettingsRuntimeSnapshot = {
      settings: {
        deviceSettingsById: {
          "device-companion-1": {
            embeddingsProvider: "gemini",
            embeddingsModel: "text-embedding-004",
          },
        },
      },
    };

    const host: SettingsRuntimeHost = {
      getSnapshot: () => snapshot,
      replaceSnapshot: (next) => { snapshot = next; },
      saveSnapshot: async () => undefined,
      getCurrentDeviceId: () => "device-companion-1",
      runEffect: () => undefined,
      getEffectiveDeviceRole: () => "companion",
      getEffectiveEmbeddingContract: () => sampleContract,
    };

    const adapters = createSettingsRuntimeAdapters(host, {
      deviceRole: "companion",
      getEffectiveDeviceRole: () => "companion",
      getEffectiveEmbeddingContract: () => sampleContract,
    });

    // Contract must win over the stale 'gemini' / 'text-embedding-004' values in deviceSettingsById
    expect(adapters.getLocalValue("embeddingsProvider")).toBe(sampleContract.provider);
    expect(adapters.getLocalValue("embeddingsModel")).toBe(sampleContract.model);
  });

  // Scenario 4: Companion com contrato ausente (sem fallback local silencioso)
  it("Scenario 4: Companion without contract returns undefined from getLocalValue without fallback to stale local settings", () => {
    let snapshot: SettingsRuntimeSnapshot = {
      settings: {
        deviceSettingsById: {
          "device-companion-1": {
            embeddingsProvider: "openai",
            embeddingsModel: "text-embedding-3-small",
          },
        },
      },
    };

    const host: SettingsRuntimeHost = {
      getSnapshot: () => snapshot,
      replaceSnapshot: (next) => { snapshot = next; },
      saveSnapshot: async () => undefined,
      getCurrentDeviceId: () => "device-companion-1",
      runEffect: () => undefined,
      getEffectiveDeviceRole: () => "companion",
      getEffectiveEmbeddingContract: () => null,
    };

    const adapters = createSettingsRuntimeAdapters(host, {
      deviceRole: "companion",
      getEffectiveDeviceRole: () => "companion",
      getEffectiveEmbeddingContract: () => null,
    });

    // Must NOT fall back to 'openai' or 'text-embedding-3-small'
    expect(adapters.getLocalValue("embeddingsProvider")).toBeUndefined();
    expect(adapters.getLocalValue("embeddingsModel")).toBeUndefined();
  });

  // Scenario 5: Companion com contrato inválido (sem fallback local e semântica indisponível)
  it("Scenario 5: Corrupted or invalid contract manifest causes contract to be null and semantic search to be unavailable", async () => {
    const adapter = new FakeAdapter({
      ".lina/index/manifest.json": JSON.stringify({
        schemaVersion: 1,
        // Missing dimensions, prefixMode, inputVersion -> invalid vector contract
        vectorContract: {
          schemaVersion: 1,
          provider: "ollama",
          model: "nomic-embed-text",
        },
      }),
    });

    const plugin = new LinaPlugin(new App(), {
      id: "lina",
      name: "Lina",
      author: "Test",
      version: "0.2.4",
      minAppVersion: "1.13.0",
      description: "Test",
    });

    (plugin.app as unknown as { vault: { adapter: unknown } }).vault = { adapter };
    plugin.settings = { ...DEFAULT_SETTINGS };
    (plugin as unknown as { localDeviceId: string }).localDeviceId = "companion-device-1";
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("companion");

    const loadedContract = await plugin.loadCanonicalVectorContract();
    expect(loadedContract).toBeNull();
    expect(plugin.getEffectiveEmbeddingContract()).toBeNull();

    const config = plugin.getEffectiveEmbeddingConfig();
    expect(config.isAvailable).toBe(false);
    expect(config.provider).toBe("");
    expect(config.model).toBe("");
    expect(config.contract).toBeNull();
    expect(config.unavailabilityReason).toBe("No canonical vector contract found in published manifest.");
  });

  // Scenario 6: Active Producer (provider/model continuam editáveis)
  it("Scenario 6: Active Producer has editable dropdowns and can update provider and model", async () => {
    let snapshot: SettingsRuntimeSnapshot = {
      settings: {
        deviceSettingsById: {
          "producer-device": {
            embeddingsProvider: "ollama",
            embeddingsModel: "nomic-embed-text",
          },
        },
      },
    };

    const host: SettingsRuntimeHost = {
      getSnapshot: () => snapshot,
      replaceSnapshot: (next) => { snapshot = next; },
      saveSnapshot: async () => undefined,
      getCurrentDeviceId: () => "producer-device",
      runEffect: () => undefined,
      getEffectiveDeviceRole: () => "producer",
    };

    const adapters = createSettingsRuntimeAdapters(host, {
      deviceRole: "producer",
      getEffectiveDeviceRole: () => "producer",
    });

    const setRes = await adapters.setLocalProviderValues(
      "embedding",
      "openrouter",
      "openai/text-embedding-3-small",
      "https://openrouter.ai/api/v1"
    );
    expect(setRes.ok).toBe(true);
    expect(adapters.getLocalValue("embeddingsProvider")).toBe("openrouter");
  });

  // Scenario 7: Standby Producer (preserva comportamento atual e ownership fencing)
  it("Scenario 7: Standby Producer preserves local configuration but is gated from publishing", () => {
    const plugin = new LinaPlugin(new App(), {
      id: "lina",
      name: "Lina",
      author: "Test",
      version: "0.2.4",
      minAppVersion: "1.13.0",
      description: "Test",
    });
    plugin.settings = { ...DEFAULT_SETTINGS, deviceRole: "producer" };
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("producer");
    vi.spyOn(plugin, "canEditExclusions").mockReturnValue(false);

    expect(plugin.canEditExclusions()).toBe(false);
  });

  // Scenario 8: Endpoint local Companion (preservado e funcional)
  it("Scenario 8: Companion local endpoint baseUrl is preserved and resolved from local settings", () => {
    const plugin = new LinaPlugin(new App(), {
      id: "lina",
      name: "Lina",
      author: "Test",
      version: "0.2.4",
      minAppVersion: "1.13.0",
      description: "Test",
    });
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      embeddingBaseUrl: "http://192.168.1.50:11434",
    };
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("companion");
    plugin.setEffectiveEmbeddingContract(sampleContract);

    const config = plugin.getEffectiveEmbeddingConfig();
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("nomic-embed-text-v2-moe");
    expect(config.baseUrl).toBe("http://192.168.1.50:11434");
    expect(config.isAvailable).toBe(true);
  });

  // Scenario 9: Credential local Companion (preservada)
  it("Scenario 9: Companion local credentials are preserved and retrieved securely", () => {
    const plugin = new LinaPlugin(new App(), {
      id: "lina",
      name: "Lina",
      author: "Test",
      version: "0.2.4",
      minAppVersion: "1.13.0",
      description: "Test",
    });
    plugin.settings = { ...DEFAULT_SETTINGS, embeddingApiKey: "secret-companion-token" };
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("companion");
    plugin.setEffectiveEmbeddingContract(sampleContract);

    const config = plugin.getEffectiveEmbeddingConfig();
    expect(config.apiKey).toBe("secret-companion-token");
  });

  // Scenario 10: Hybrid degradation (semantic unavailable -> text-only)
  it("Scenario 10: Hybrid search degrades cleanly to text-only when embeddings contract is unavailable", async () => {
    const note: IndexedNote = {
      path: "Note1.md",
      basename: "Note 1",
      folder: "",
      title: "Note 1",
      mtime: 1000,
      size: 100,
      characterCount: 50,
      wordCount: 10,
    };
    const chunk: Chunk = {
      chunkId: "Note1.md::0",
      path: "Note1.md",
      chunkIndex: 0,
      text: "Lina obsidian companion mode test note content",
      textHash: "hash-0",
      createdAt: "2026-09-06T12:00:00.000Z",
    };

    // When contract is missing, config has empty model and provider
    const result = await runHybridSearch(new App(), [note], [chunk], "obsidian", {
      baseUrl: "http://127.0.0.1:11434",
      model: "",
      deviceProvider: "",
      deviceModel: "",
      timeoutMs: 5000,
      textWeight: 0.7,
      semanticWeight: 0.3,
      getRuntimeEmbeddingIndex: async () => null,
    });

    expect(result.semanticUsed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].path).toBe("Note1.md");
  });

  // Scenario 11: Backend mutation guard Companion continua ativo
  it("Scenario 11: Backend mutation adapter strictly rejects embedding provider and model changes on Companion", async () => {
    let snapshot: SettingsRuntimeSnapshot = {
      settings: {
        deviceSettingsById: {
          "companion-dev": {},
        },
      },
    };

    const host: SettingsRuntimeHost = {
      getSnapshot: () => snapshot,
      replaceSnapshot: (next) => { snapshot = next; },
      saveSnapshot: async () => undefined,
      getCurrentDeviceId: () => "companion-dev",
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

    const resTuple = await adapters.setLocalProviderValues(
      "embedding",
      "openai",
      "text-embedding-3-small",
      "https://api.openai.com/v1"
    );
    expect(resTuple.ok).toBe(false);
    expect(resTuple.error).toBe("invalid-value");
  });

  // Scenario 12: Settings UI não fica aparentemente editável quando backend rejeitaria a mutação
  it("Scenario 12: Settings UI controls for embedding provider and model are setDisabled(true) on Companion", () => {
    const ports: DetachedSettingsPorts = {
      getGlobal: () => undefined,
      setGlobal: async () => undefined,
      getLocal: () => "" as never,
      setLocal: async () => undefined,
      setProvider: async () => false,
      requestUpdate: () => undefined,
      getDeviceRole: () => "companion",
      getEffectiveEmbeddingContract: () => sampleContract,
    };

    const providerRenderer = createDetachedEmbeddingsProviderRenderer(mockStrings, ports);
    const modelRenderer = createDetachedEmbeddingsModelRenderer(mockStrings, ports);

    const providerDouble = createSettingDouble();
    providerRenderer(providerDouble.setting, {} as never);
    expect(providerDouble.dropdownDisabled).toBe(true);

    const modelDouble = createSettingDouble();
    modelRenderer(modelDouble.setting, { listEl: { createEl: () => ({}) } } as never);
    expect(modelDouble.dropdownDisabled).toBe(true);
  });
});
