import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  DEFAULT_SETTINGS,
} from "../../src/settings";
import { SecretStorage } from "../helpers/mockObsidian";
import { LINA_SECRET_KEYS } from "../../src/device/secretStorage";
import { saveDeviceState, type DeviceState } from "../../src/device/deviceState";
import { createVectorContract } from "../../src/index/vectorContract";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { getSemanticSearchAvailability } from "../../src/search/hybridSearch";
import { calculateEmbeddingUpdatePlan } from "../../src/index/embeddingUpdatePlan";
import {
  createProducerState,
  isProducerStateV1,
  saveProducerState,
  loadProducerState,
} from "../../src/device/producerState";
import { buildEmbeddingInput, hashContent } from "../../src/index/embeddingGenerator";

describe("LINA-03-IMPLEMENT-PRODUCER-SETTINGS-BOUNDARY-001 — Producer Settings Boundary", () => {
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

  // 1. Fonte da configuração Producer
  it("1. Active Producer resolves generation settings from deviceSettingsById and SecretStorage", async () => {
    const { adapter, plugin, app } = createTestEnvironment();
    const producerId = plugin.getDeviceId();

    // Mark as Active Producer
    const producerState: DeviceState = {
      schemaVersion: 2,
      deviceId: producerId,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-10T15:00:00.000Z",
      deviceName: "Workstation Producer",
      role: "producer",
    };
    await saveDeviceState(adapter, producerState);

    // Set Producer local generation preferences in deviceSettingsById
    plugin.settings.deviceSettingsById = {
      [producerId]: {
        embeddingsProvider: "ollama",
        embeddingsModel: "bge-m3:latest",
        embeddingsBaseUrl: "http://127.0.0.1:11434",
        embeddingsBatchSize: "32",
        embeddingsTimeout: "45",
      },
    };

    // Store credentials in SecretStorage
    const secretStorage = app.secretStorage as unknown as SecretStorage;
    secretStorage.setSecret(LINA_SECRET_KEYS.embeddingsApiKey, "sk-producer-secret-key");

    await plugin.loadDataFromDisk();

    expect(plugin.getLocalDeviceRole()).toBe("producer");

    const effectiveConfig = plugin.getEffectiveEmbeddingConfig();
    expect(effectiveConfig.provider).toBe("ollama");
    expect(effectiveConfig.model).toBe("bge-m3:latest");
    expect(effectiveConfig.baseUrl).toBe("http://127.0.0.1:11434");
    expect(effectiveConfig.batchSize).toBe(32);
    expect(effectiveConfig.timeoutMs).toBe(45000);
    expect(effectiveConfig.apiKey).toBe("sk-producer-secret-key");
  });

  // 2. Companion não usa configuração local
  it("2. Companion device ignores local embedding config and strictly consumes Vector Contract", async () => {
    const { adapter, plugin } = createTestEnvironment();
    const companionId = plugin.getDeviceId();

    // Configure device as Companion
    const companionState: DeviceState = {
      schemaVersion: 2,
      deviceId: companionId,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-10T15:00:00.000Z",
      deviceName: "Mobile Companion",
      role: "companion",
    };
    await saveDeviceState(adapter, companionState);

    // Stale/conflicting local settings on Companion device
    plugin.settings.deviceSettingsById = {
      [companionId]: {
        embeddingsProvider: "ollama",
        embeddingsModel: "stale-local-model",
      },
    };

    // Canonical Vector Contract published in .lina/index/manifest.json
    const publishedContract = createVectorContract({
      provider: "openrouter",
      model: "text-embedding-3-small",
      dimensions: 1536,
      prefixMode: "none",
      inputVersion: 1,
    });
    await adapter.write(".lina/index/manifest.json", JSON.stringify({
      schemaVersion: 1,
      vectorContract: publishedContract,
    }));

    await plugin.loadDataFromDisk();

    expect(plugin.getLocalDeviceRole()).toBe("companion");

    // Companion must ignore stale-local-model and use published Vector Contract
    const effectiveConfig = plugin.getEffectiveEmbeddingConfig();
    expect(effectiveConfig.provider).toBe("openrouter");
    expect(effectiveConfig.model).toBe("text-embedding-3-small");
    expect(effectiveConfig.contract).toEqual(publishedContract);
    expect(effectiveConfig.model).not.toBe("stale-local-model");
  });

  // 3. Divergência: Producer config (model=B) vs Vector Contract (model=A)
  it("3. Divergence between Producer local config and published Vector Contract is detected", async () => {
    const { adapter, plugin, app } = createTestEnvironment();
    const producerId = plugin.getDeviceId();

    // Active Producer
    const producerState: DeviceState = {
      schemaVersion: 2,
      deviceId: producerId,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-10T15:00:00.000Z",
      deviceName: "Workstation Producer",
      role: "producer",
    };
    await saveDeviceState(adapter, producerState);

    // Published contract has model A
    const contractA = createVectorContract({
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      prefixMode: "nomic-search-query-document",
      inputVersion: 1,
    });
    await adapter.write(".lina/index/manifest.json", JSON.stringify({
      schemaVersion: 1,
      embeddingsEnabled: true,
      embeddings: {
        enabled: true,
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        totalEmbeddings: 1,
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
      embeddingInput: {
        version: 1,
        prefixMode: "nomic-search-query-document",
      },
      vectorContract: contractA,
    }));

    // Write canonical embeddings.jsonl containing an embedding for model A
    await adapter.write(
      ".lina/index/embeddings.jsonl",
      JSON.stringify({
        chunkId: "chunk-1",
        path: "note.md",
        chunkIndex: 0,
        provider: "ollama",
        model: "nomic-embed-text",
        embedding: [0.1, 0.2],
        dimensions: 768,
        textHash: "hash-1",
        updatedAt: "2026-08-20T12:00:00.000Z",
      }) + "\n"
    );

    // Producer changes its local configuration to model B
    plugin.settings.deviceSettingsById = {
      [producerId]: {
        embeddingsProvider: "ollama",
        embeddingsModel: "mxbai-embed-large",
      },
    };

    await plugin.loadDataFromDisk();

    // 3a. Search engine detects incompatibility
    // When searching with Producer's configured model B against index with model A:
    const searchAvailability = await getSemanticSearchAvailability(app, "ollama", "mxbai-embed-large");
    expect(searchAvailability.available).toBe(false);
    expect(searchAvailability.reasonCode).toBe("incompatible");
    expect(searchAvailability.indexModel).toBe("nomic-embed-text");
    expect(searchAvailability.deviceModel).toBe("mxbai-embed-large");

    // 3b. Update plan detects model-changed and forces full-rebuild (preventing incremental pollution)
    const plan = calculateEmbeddingUpdatePlan({
      chunks: [
        {
          id: "chunk-1",
          path: "note.md",
          chunkIndex: 0,
          text: "content",
          textHash: "hash-1",
          charCount: 7,
          wordCount: 1,
          byteCount: 7,
          isFullNote: true,
        },
      ],
      canonicalRecords: [
        {
          chunkId: "chunk-1",
          path: "note.md",
          chunkIndex: 0,
          provider: "ollama",
          model: "nomic-embed-text",
          embedding: [0.1, 0.2],
          dimensions: 768,
          textHash: "hash-1",
          updatedAt: "2026-08-20T12:00:00.000Z",
        },
      ],
      publishedIdentity: {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      },
      targetIdentity: {
        provider: "ollama",
        model: "mxbai-embed-large",
        dimensions: 1024,
        inputVersion: 1,
        prefixMode: "none",
      },
      buildInput: buildEmbeddingInput,
      hashInput: hashContent,
    });

    expect(plan.mode).toBe("full-rebuild");
    expect(plan.reasons).toContain("model-changed");
    expect(plan.obsoleteToDropCount).toBe(1);
    expect(plan.reusableCanonicalCount).toBe(0);
  });

  // 4. Producer State separado de configuração
  it("4. Producer State in .lina/producer-state.json strictly records telemetry and zero configuration", async () => {
    const { adapter, plugin } = createTestEnvironment();
    const producerId = plugin.getDeviceId();

    const state = createProducerState({
      activeProducerId: producerId,
      producerEpoch: 3,
      textIndex: {
        lastSuccessfulPublicationAt: "2026-08-20T10:00:00.000Z",
        exclusionPolicyRevision: 2,
        exclusionPolicyHash: "sha256:abc",
      },
      embeddings: {
        lastSuccessfulPublicationAt: "2026-08-20T10:30:00.000Z",
        publicationId: "pub-001",
        vectorContractId: "contract-001",
      },
      maintenance: {
        status: "idle",
        lastRunAt: "2026-08-20T10:30:00.000Z",
      },
    });

    const ownership = {
      schemaVersion: 1 as const,
      activeProducerId: producerId,
      epoch: 3,
      updatedAt: "2026-08-20T10:00:00.000Z",
    };
    await saveProducerState(adapter, state, ownership);

    const loaded = await loadProducerState(adapter);
    expect(loaded).not.toBeNull();
    expect(isProducerStateV1(loaded)).toBe(true);

    const rawObject = JSON.parse(await adapter.read(".lina/producer-state.json")) as Record<string, unknown>;

    // Confirm that NO configuration parameters are present in producer-state.json
    expect(rawObject.provider).toBeUndefined();
    expect(rawObject.model).toBeUndefined();
    expect(rawObject.embeddingProvider).toBeUndefined();
    expect(rawObject.embeddingModel).toBeUndefined();
    expect(rawObject.embeddingsProvider).toBeUndefined();
    expect(rawObject.embeddingsModel).toBeUndefined();
    expect(rawObject.baseUrl).toBeUndefined();
    expect(rawObject.apiKey).toBeUndefined();
    expect(rawObject.batchSize).toBeUndefined();
    expect(rawObject.timeout).toBeUndefined();

    // Confirm structure
    expect(rawObject.schemaVersion).toBe(1);
    expect(rawObject.activeProducerId).toBe(producerId);
    expect(rawObject.producerEpoch).toBe(3);
    expect(rawObject.textIndex).toBeDefined();
    expect(rawObject.embeddings).toBeDefined();
    expect(rawObject.maintenance).toBeDefined();
  });

  // 5. Compatibilidade com vault antigo
  it("5. Safely initializes with backward compatibility when .lina/ is missing", async () => {
    const { adapter, plugin } = createTestEnvironment();

    // Old vault without .lina/ directory
    expect(await adapter.exists(".lina/index/manifest.json")).toBe(false);
    expect(await adapter.exists(".lina/producer-state.json")).toBe(false);

    plugin.settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: {
        [plugin.getDeviceId()]: {
          embeddingsProvider: "ollama",
          embeddingsModel: "nomic-embed-text",
        },
      },
    };
    await adapter.write("data.json", JSON.stringify({ settings: plugin.settings }));

    await plugin.loadDataFromDisk();

    // Producer fallback works cleanly
    const effective = plugin.getEffectiveEmbeddingConfig();
    expect(effective.provider).toBe("ollama");
    expect(effective.model).toBe("nomic-embed-text");
    expect(effective.contract).toBeNull();
  });
});
