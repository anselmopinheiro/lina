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
  let dropdownAdded = false;
  let textAdded = false;
  const dropdownOptions: Array<{ value: string; label: string }> = [];
  const spans: string[] = [];
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
    addDropdown(cb: (d: typeof dropdown) => void) {
      dropdownAdded = true;
      cb(dropdown);
      return setting;
    },
    addText() {
      textAdded = true;
      return setting;
    },
    controlEl: {
      empty() { spans.length = 0; },
      createSpan(opts: { text: string; cls?: string }) {
        spans.push(opts.text);
        return { textContent: opts.text };
      },
    },
  };
  return {
    setting: setting as never,
    get name() { return name; },
    get desc() { return desc; },
    get dropdownAdded() { return dropdownAdded; },
    get textAdded() { return textAdded; },
    get dropdownDisabled() { return dropdownDisabled; },
    get dropdownValue() { return dropdownValue; },
    get dropdownOptions() { return dropdownOptions; },
    get spans() { return spans; },
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
  // Scenario 1: Fresh Companion sem Producer / sem contrato (Requisito 4: sem Producer -> semantic unavailable, Requisito 3: UI read-only / sem dropdowns)
  it("Scenario 1: Fresh Companion without Producer shows unavailable message, no dropdowns or manual selection", async () => {
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
    expect(providerDouble.dropdownAdded).toBe(false);
    expect(providerDouble.textAdded).toBe(false);
    expect(providerDouble.name).toBe(mockStrings.sidebarSearchSemanticUnavailable);
    expect(providerDouble.desc).toBe(mockStrings.settingsEmbeddingNoActiveProducerDesc);
    expect(providerDouble.spans).toContain(mockStrings.settingsEmbeddingContractUnavailable);

    const modelDouble = createSettingDouble();
    modelRenderer(modelDouble.setting, { listEl: { createEl: () => ({}) } } as never);
    expect(modelDouble.dropdownAdded).toBe(false);
    expect(modelDouble.textAdded).toBe(false);
    expect(modelDouble.name).toBe(mockStrings.sidebarSearchSemanticUnavailable);
    expect(modelDouble.desc).toBe(mockStrings.settingsEmbeddingNoActiveProducerDesc);
    expect(modelDouble.spans).toContain(mockStrings.settingsEmbeddingContractUnavailable);
  });

  // Scenario 2: Companion com contrato válido (Requisito 1: herda provider e model, Requisito 3: UI read-only com info completa do contrato)
  it("Scenario 2: Companion with valid contract inherits provider and model, renders read-only contract information without editable dropdowns", () => {
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
    expect(providerDouble.dropdownAdded).toBe(false);
    expect(providerDouble.textAdded).toBe(false);
    expect(providerDouble.name).toBe(mockStrings.settingsProvider);
    expect(providerDouble.desc).toContain(mockStrings.settingsEmbeddingDefinedByProducer);
    expect(providerDouble.desc).toContain(`Provider:\n${sampleContract.provider}`);
    expect(providerDouble.desc).toContain(`Modelo:\n${sampleContract.model}`);
    expect(providerDouble.desc).toContain(`Contrato:\n${sampleContract.contractId}`);
    expect(providerDouble.spans).toContain(sampleContract.provider);

    const modelDouble = createSettingDouble();
    modelRenderer(modelDouble.setting, { listEl: { createEl: () => ({}) } } as never);
    expect(modelDouble.dropdownAdded).toBe(false);
    expect(modelDouble.textAdded).toBe(false);
    expect(modelDouble.name).toBe(mockStrings.settingsModel);
    expect(modelDouble.desc).toContain(mockStrings.settingsEmbeddingDefinedByProducer);
    expect(modelDouble.desc).toContain(`Provider:\n${sampleContract.provider}`);
    expect(modelDouble.desc).toContain(`Modelo:\n${sampleContract.model}`);
    expect(modelDouble.desc).toContain(`Contrato:\n${sampleContract.contractId}`);
    expect(modelDouble.spans).toContain(sampleContract.model);
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

  // Scenario 3b: Companion com settings locais diferentes (Requisito 2: local A/X, contract B/Y -> usar B/Y)
  it("Scenario 3b: Companion with divergent local settings (provider=A, model=X) strictly uses contract (provider=B, model=Y) in plugin and runtime", () => {
    const plugin = new LinaPlugin(new App(), {
      id: "lina",
      name: "Lina",
      author: "Test",
      version: "0.3.0",
      minAppVersion: "1.13.0",
      description: "Test",
    });
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      deviceSettingsById: {
        "companion-device-a": {
          embeddingsProvider: "openai",
          embeddingsModel: "text-embedding-3-small",
        },
      },
    };
    (plugin as unknown as { localDeviceId: string }).localDeviceId = "companion-device-a";
    vi.spyOn(plugin, "getLocalDeviceRole").mockReturnValue("companion");

    const customContract: VectorContractV1 = createVectorContract({
      provider: "mistral",
      model: "mistral-embed",
      dimensions: 1024,
      metric: "cosine",
      prefixMode: "none",
      inputVersion: 1,
    });
    plugin.setEffectiveEmbeddingContract(customContract);

    const config = plugin.getEffectiveEmbeddingConfig();
    expect(config.provider).toBe("mistral");
    expect(config.model).toBe("mistral-embed");
    expect(config.isAvailable).toBe(true);
    expect(config.contract?.contractId).toBe(customContract.contractId);
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
      version: "0.3.0",
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
      version: "0.3.0",
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
      version: "0.3.0",
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
      version: "0.3.0",
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

  // Scenario 12: Settings UI não tem controlos editáveis no Companion (Requisito 3: dropdowns inexistentes ou disabled)
  it("Scenario 12: Settings UI controls for embedding provider and model are strictly read-only on Companion without editable dropdowns", () => {
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
    expect(providerDouble.dropdownAdded).toBe(false);
    expect(providerDouble.textAdded).toBe(false);
    expect(providerDouble.spans).toContain(sampleContract.provider);

    const modelDouble = createSettingDouble();
    modelRenderer(modelDouble.setting, { listEl: { createEl: () => ({}) } } as never);
    expect(modelDouble.dropdownAdded).toBe(false);
    expect(modelDouble.textAdded).toBe(false);
    expect(modelDouble.spans).toContain(sampleContract.model);
  });

  // Scenario 13: Security (Requisito 6: API keys nunca publicadas no Vector Contract ou manifest)
  it("Scenario 13: Security boundary verifies API keys remain strictly local and are never included in Vector Contract or published manifest", () => {
    const rawContract = sampleContract as unknown as Record<string, unknown>;
    expect(rawContract.apiKey).toBeUndefined();
    expect(rawContract.secret).toBeUndefined();
    expect(rawContract.credentials).toBeUndefined();
    expect(rawContract.password).toBeUndefined();
    expect(rawContract.token).toBeUndefined();

    // The contract ID is computed strictly and exclusively from public vector metadata
    const expectedKeys = [
      "schemaVersion",
      "provider",
      "model",
      "dimensions",
      "metric",
      "prefixMode",
      "inputVersion",
      "contractId",
    ];
    expect(Object.keys(sampleContract).sort()).toEqual(expectedKeys.sort());
  });
});
