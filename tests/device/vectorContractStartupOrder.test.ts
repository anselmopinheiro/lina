import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { saveDeviceState, type DeviceState } from "../../src/device/deviceState";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { Chunk } from "../../src/index/chunker";
import { hashContent } from "../../src/index/noteHasher";
import { buildEmbeddingInput, getPrefixModeForModel } from "../../src/index/embeddingGenerator";

const TEST_COMPANION_DEVICE_ID = "11111111-2222-4333-8444-555555555555";
const TEST_PRODUCER_DEVICE_ID = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";

describe("P1-B: Vector Contract Startup Order and Companion Semantic State Resolution", () => {
  it("loads the vector contract before resolving runtime state (normal branch)", async () => {
    const adapter = new FakeAdapter({
      ".lina/index/manifest.json": JSON.stringify({
        schemaVersion: 1,
        vectorContract: {
          schemaVersion: 1,
          provider: "ollama",
          model: "nomic-embed-text-v2-moe",
          dimensions: 768,
          metric: "cosine",
          prefixMode: "none",
          inputVersion: 1,
        },
      }),
    });
    const app = new App();
    app.vault.adapter = adapter;

    const plugin = new LinaPlugin(app);

    const loadContractSpy = vi.spyOn(plugin, "loadCanonicalVectorContract");
    const refreshStateSpy = vi.spyOn(plugin, "refreshDeviceRuntimeState");

    await plugin.loadDataFromDisk();

    expect(loadContractSpy).toHaveBeenCalled();
    expect(refreshStateSpy).toHaveBeenCalled();

    const contractCallOrder = loadContractSpy.mock.invocationCallOrder[0];
    const refreshCallOrder = refreshStateSpy.mock.invocationCallOrder[0];

    expect(contractCallOrder).toBeLessThan(refreshCallOrder);
  });

  it("loads the vector contract before resolving runtime state (future-settings-version branch)", async () => {
    const adapter = new FakeAdapter({
      ".lina/index/manifest.json": JSON.stringify({
        schemaVersion: 1,
        vectorContract: {
          schemaVersion: 1,
          provider: "mistral",
          model: "mistral-embed",
          dimensions: 1024,
          metric: "cosine",
          prefixMode: "none",
          inputVersion: 1,
        },
      }),
    });
    const app = new App();
    app.vault.adapter = adapter;

    const plugin = new LinaPlugin(app);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      settings: {
        settingsSchemaVersion: 9999, // triggers unsupportedFutureVersion branch
      },
    });

    const loadContractSpy = vi.spyOn(plugin, "loadCanonicalVectorContract");
    const refreshStateSpy = vi.spyOn(plugin, "refreshDeviceRuntimeState");

    await plugin.loadDataFromDisk();

    expect(loadContractSpy).toHaveBeenCalled();
    expect(refreshStateSpy).toHaveBeenCalled();

    const contractCallOrder = loadContractSpy.mock.invocationCallOrder[0];
    const refreshCallOrder = refreshStateSpy.mock.invocationCallOrder[0];

    expect(contractCallOrder).toBeLessThan(refreshCallOrder);
  });

  it("companion runtime state evaluates semantic availability correctly on startup without requiring manual diagnostics open", async () => {
    const deviceId = TEST_COMPANION_DEVICE_ID;
    const provider = "ollama";
    const model = "nomic-embed-text-v2-moe";
    const chunkText = "Sample content";
    const chunk: Chunk = {
      chunkId: "note.md::0",
      path: "note.md",
      chunkIndex: 0,
      text: chunkText,
      textHash: hashContent(chunkText),
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const prefixMode = getPrefixModeForModel(model);
    const inputHash = hashContent(buildEmbeddingInput(chunk, prefixMode));

    const adapter = new FakeAdapter({
      ".lina/ownership.json": JSON.stringify({
        schemaVersion: 1,
        activeProducerId: TEST_PRODUCER_DEVICE_ID,
        epoch: 1,
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
      ".lina/index/manifest.json": JSON.stringify({
        version: 1,
        indexType: "text",
        totalNotes: 1,
        totalChunks: 1,
        updatedAt: "2026-09-01T00:00:00.000Z",
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider,
          model,
          dimensions: 3,
          totalEmbeddings: 1,
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
        embeddingInput: {
          version: 1,
          prefixMode,
        },
        vectorContract: {
          schemaVersion: 1,
          provider,
          model,
          dimensions: 3,
          metric: "cosine",
          prefixMode,
          inputVersion: 1,
        },
      }),
      ".lina/index/embeddings.jsonl": JSON.stringify({
        chunkId: chunk.chunkId,
        path: chunk.path,
        index: chunk.chunkIndex,
        dimensions: 3,
        provider,
        model,
        embedding: [0.1, 0.2, 0.3],
        textHash: chunk.textHash,
        embeddingInputHash: inputHash,
        createdAt: "2026-09-01T00:00:00.000Z",
      }) + "\n",
      ".lina/index/chunks.jsonl": JSON.stringify(chunk) + "\n",
    });

    const preExistingState: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-15T15:30:00.000Z",
      deviceName: "Mobile Companion",
      role: "companion",
    };
    await saveDeviceState(adapter, preExistingState);

    const app = new App();
    app.vault.adapter = adapter;
    app.loadLocalStorage = (key: string) => {
      if (key === "lina_device_id") return deviceId;
      return undefined;
    };

    const plugin = new LinaPlugin(app);
    await plugin.loadDataFromDisk();

    expect(plugin.getEffectiveDeviceRole()).toBe("companion");
    expect(plugin.getEffectiveEmbeddingContract()).not.toBeNull();
    expect(plugin.getEffectiveEmbeddingContract()?.provider).toBe(provider);
    expect(plugin.getEffectiveEmbeddingContract()?.model).toBe(model);

    const effectiveConfig = plugin.getEffectiveEmbeddingConfig();
    expect(effectiveConfig.isAvailable).toBe(true);
    expect(effectiveConfig.provider).toBe(provider);
    expect(effectiveConfig.model).toBe(model);

    const runtimeState = plugin.getDeviceRuntimeState();
    expect(runtimeState.embeddings.semanticAvailable).toBe(true);
    expect(runtimeState.embeddings.runtimeState).toBe("ready");
    expect(runtimeState.embeddings.effectiveMode).toBe("full");
  });

  it("producer runtime state does not depend on vector contract resolution order", async () => {
    const deviceId = TEST_PRODUCER_DEVICE_ID;
    const provider = "ollama";
    const model = "nomic-embed-text-v2-moe";
    const chunkText = "Sample content";
    const chunk: Chunk = {
      chunkId: "note.md::0",
      path: "note.md",
      chunkIndex: 0,
      text: chunkText,
      textHash: hashContent(chunkText),
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const prefixMode = getPrefixModeForModel(model);
    const inputHash = hashContent(buildEmbeddingInput(chunk, prefixMode));

    const adapter = new FakeAdapter({
      ".lina/ownership.json": JSON.stringify({
        schemaVersion: 1,
        activeProducerId: TEST_PRODUCER_DEVICE_ID,
        epoch: 1,
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
      ".lina/index/manifest.json": JSON.stringify({
        version: 1,
        indexType: "text",
        totalNotes: 1,
        totalChunks: 1,
        updatedAt: "2026-09-01T00:00:00.000Z",
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider,
          model,
          dimensions: 3,
          totalEmbeddings: 1,
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
        embeddingInput: {
          version: 1,
          prefixMode,
        },
        vectorContract: {
          schemaVersion: 1,
          provider,
          model,
          dimensions: 3,
          metric: "cosine",
          prefixMode,
          inputVersion: 1,
        },
      }),
      ".lina/index/embeddings.jsonl": JSON.stringify({
        chunkId: chunk.chunkId,
        path: chunk.path,
        index: chunk.chunkIndex,
        dimensions: 3,
        provider,
        model,
        embedding: [0.1, 0.2, 0.3],
        textHash: chunk.textHash,
        embeddingInputHash: inputHash,
        createdAt: "2026-09-01T00:00:00.000Z",
      }) + "\n",
      ".lina/index/chunks.jsonl": JSON.stringify(chunk) + "\n",
    });

    const preExistingState: DeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-15T15:30:00.000Z",
      deviceName: "Workstation Producer",
      role: "producer",
    };
    await saveDeviceState(adapter, preExistingState);

    const app = new App();
    app.vault.adapter = adapter;
    app.loadLocalStorage = (key: string) => {
      if (key === "lina_device_id") return deviceId;
      return undefined;
    };

    const plugin = new LinaPlugin(app);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      settings: {
        embeddingsEnabled: true,
        deviceSettingsById: {
          [deviceId]: {
            embeddingsProvider: provider,
            embeddingsModel: model,
          },
        },
      },
    });
    await plugin.loadDataFromDisk();

    expect(plugin.getEffectiveDeviceRole()).toBe("producer");

    const runtimeState = plugin.getDeviceRuntimeState();
    expect(runtimeState.embeddings.semanticAvailable).toBe(true);
    expect(runtimeState.embeddings.runtimeState).toBe("ready");
    expect(runtimeState.embeddings.effectiveMode).toBe("full");
  });

  it("startup tolerates missing or invalid manifest cleanly without throwing", async () => {
    const adapter = new FakeAdapter(); // no manifest.json
    const app = new App();
    app.vault.adapter = adapter;

    const plugin = new LinaPlugin(app);
    await expect(plugin.loadDataFromDisk()).resolves.not.toThrow();

    expect(plugin.getEffectiveEmbeddingContract()).toBeNull();
    const runtimeState = plugin.getDeviceRuntimeState();
    expect(runtimeState.embeddings.semanticAvailable).toBe(false);
  });

  it("startup order preserves exclusion policy initialization", async () => {
    const adapter = new FakeAdapter();
    const app = new App();
    app.vault.adapter = adapter;

    const plugin = new LinaPlugin(app);
    const exclusionSpy = vi.spyOn(plugin, "initializeExclusionPolicy");

    await plugin.loadDataFromDisk();

    expect(exclusionSpy).toHaveBeenCalledTimes(1);
  });
});
