import { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { EMBEDDING_INPUT_VERSION, buildEmbeddingInput, getPrefixModeForModel } from "../../src/index/embeddingGenerator";
import { Chunk } from "../../src/index/chunker";
import { EmbeddingRecord } from "../../src/index/embeddingPersistence";
import { hashContent } from "../../src/index/noteHasher";
import { getSemanticSearchAvailability } from "../../src/search/hybridSearch";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext, type LinaSettings } from "../../src/settings";
import { FakeAdapter } from "../helpers/fakeAdapter";

function createChunk(): Chunk {
  const text = "A canonical OpenRouter embedding must remain readable after settings changes.";
  return {
    chunkId: "Identity.md::0",
    path: "Identity.md",
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-08-18T20:00:00.000Z",
  };
}

function createRecord(chunk: Chunk): EmbeddingRecord {
  const model = "openai/text-embedding-3-small";
  return {
    chunkId: chunk.chunkId,
    path: chunk.path,
    index: chunk.chunkIndex,
    textHash: chunk.textHash,
    provider: "openrouter",
    model,
    dimensions: 3,
    embedding: [1, 2, 3],
    createdAt: "2026-08-18T20:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, getPrefixModeForModel(model))),
  };
}

function captureProviderChange(tab: LinaSettingTab) {
  let change: (value: string) => Promise<void> = async () => undefined;
  const dropdown = {
    addOption() { return dropdown; },
    setValue() { return dropdown; },
    onChange(callback: (value: string) => Promise<void>) { change = callback; return dropdown; },
  };
  const setting = {
    setName() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
  };
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === "embeddings-provider") as {
      render?: (target: unknown, group: unknown) => void;
    } | undefined;
  if (!definition?.render) throw new Error("Missing embeddings provider definition.");
  definition.render(setting, {});
  return { change };
}

function createRuntimeTab(jsonlMode: "readable" | "resource-limited" | "read-failure" = "readable") {
  const chunk = createChunk();
  const record = createRecord(chunk);
  const checkpoint = JSON.stringify({ checkpoint: "preserved" });
  const adapter = new FakeAdapter({
    ".lina/index/chunks.jsonl": `${JSON.stringify(chunk)}\n`,
    ".lina/index/embeddings.jsonl": `${JSON.stringify(record)}\n`,
    ".lina/index/embeddings.checkpoint.jsonl": checkpoint,
    ".lina/index/manifest.json": JSON.stringify({
      embeddingsEnabled: true,
      embeddings: {
        enabled: true,
        provider: "openrouter",
        model: "openai/text-embedding-3-small",
        dimensions: 3,
        updatedAt: "2026-08-18T20:00:00.000Z",
      },
      embeddingInput: { version: EMBEDDING_INPUT_VERSION, prefixMode: getPrefixModeForModel(record.model) },
    }),
  });
  const originalStat = adapter.stat.bind(adapter);
  const originalRead = adapter.read.bind(adapter);
  if (jsonlMode === "resource-limited") {
    adapter.stat = async (path) => path.endsWith("embeddings.jsonl")
      ? { type: "file", size: 60 * 1024 * 1024, mtime: 1 }
      : originalStat(path);
  }
  if (jsonlMode === "read-failure") {
    adapter.read = async (path) => {
      if (path.endsWith("embeddings.jsonl")) throw new Error("simulated-jsonl-read-failure");
      return originalRead(path);
    };
  }
  const app = new App();
  (app as unknown as { vault: unknown }).vault = {
    adapter,
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    read: vi.fn(),
    on: vi.fn(),
    offref: vi.fn(),
  };
  const plugin = new LinaPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    embeddingProvider: "openrouter",
    embeddingModel: "openai/text-embedding-3-small",
    deviceSettingsById: {
      current: {
        embeddingsProvider: "openrouter",
        embeddingsModel: "openai/text-embedding-3-small",
        embeddingsBaseUrl: "https://openrouter.ai/api/v1",
      },
    },
  } satisfies LinaSettings;
  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, "current");
  return { adapter, checkpoint, chunk, plugin, tab: new LinaSettingTab(app, plugin) };
}

describe("real settings runtime wiring for embedding identity invalidation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the real provider dropdown, refreshes one shared controller, and restores published compatibility on return", async () => {
    const { adapter, checkpoint, chunk, plugin, tab } = createRuntimeTab();
    vi.stubGlobal("window", {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    const generation = vi.spyOn(plugin, "requestEmbeddingIndexGeneration");
    plugin["runGenerateLocalEmbeddings"] = vi.fn();
    const observedStates: string[] = [];
    const unsubscribe = plugin.onEmbeddingWorkStatusChange((state) => observedStates.push(state.status));

    await captureProviderChange(tab).change("mistral");

    expect(plugin.settings.deviceSettingsById?.current).toMatchObject({
      embeddingsProvider: "mistral",
      embeddingsModel: "mistral-embed",
    });
    expect(plugin.getEffectiveEmbeddingConfig()).toMatchObject({ provider: "mistral", model: "mistral-embed" });
    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({
      status: "ready",
      reason: "settings-changed",
      workAvailable: true,
    });
    expect(plugin.getEmbeddingWorkStatus().summary?.updatePlan).toMatchObject({
      mode: "full-rebuild",
      targetIdentity: { provider: "mistral", model: "mistral-embed" },
    });
    expect(observedStates).toEqual(["unknown", "dirty", "calculating", "ready"]);
    await expect(getSemanticSearchAvailability(plugin.app, "mistral", "mistral-embed", [chunk]))
      .resolves.toMatchObject({ available: false, indexProvider: "openrouter", indexModel: "openai/text-embedding-3-small" });
    expect(generation).not.toHaveBeenCalled();
    expect(adapter.writeCount).toBe(0);
    expect(adapter.renameCount).toBe(0);
    await expect(adapter.read(".lina/index/embeddings.checkpoint.jsonl")).resolves.toBe(checkpoint);

    await captureProviderChange(tab).change("openrouter");

    expect(plugin.getEffectiveEmbeddingConfig()).toMatchObject({ provider: "openrouter", model: "openai/text-embedding-3-small" });
    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({ status: "ready", workAvailable: false });
    await expect(getSemanticSearchAvailability(plugin.app, "openrouter", "openai/text-embedding-3-small", [chunk]))
      .resolves.toMatchObject({ available: true });
    expect(generation).not.toHaveBeenCalled();
    unsubscribe();
    tab.hide();
  });

  it.each(["resource-limited", "read-failure"] as const)(
    "derives an OpenRouter to Mistral full rebuild from the manifest when JSONL is %s",
    async (jsonlMode) => {
      const { adapter, plugin, tab } = createRuntimeTab(jsonlMode);
      vi.stubGlobal("window", { setTimeout: () => 1, clearTimeout: () => undefined });
      vi.spyOn(plugin, "saveSettings").mockResolvedValue();
      const generation = vi.spyOn(plugin, "requestEmbeddingIndexGeneration");
      plugin["runGenerateLocalEmbeddings"] = vi.fn();
      const controllerBefore = plugin["getEmbeddingWorkStatusController"]();

      await captureProviderChange(tab).change("mistral");

      const state = plugin.getEmbeddingWorkStatus();
      expect(plugin["getEmbeddingWorkStatusController"]()).toBe(controllerBefore);
      expect(state).toMatchObject({ status: "ready", reason: "settings-changed", workAvailable: true });
      expect(state.summary).toMatchObject({
        detailsAvailable: false,
        canonicalReadability: "unreadable",
        provider: "openrouter",
        model: "openai/text-embedding-3-small",
        updatePlan: {
          mode: "full-rebuild",
          targetIdentity: { provider: "mistral", model: "mistral-embed" },
        },
      });
      expect(state.summary?.updatePlan?.mode).not.toBe("initial-build");
      await expect(getSemanticSearchAvailability(plugin.app, "mistral", "mistral-embed"))
        .resolves.toMatchObject({
          available: false,
          indexProvider: "openrouter",
          indexModel: "openai/text-embedding-3-small",
          deviceProvider: "mistral",
          deviceModel: "mistral-embed",
        });
      expect(generation).not.toHaveBeenCalled();
      expect(adapter.writeCount).toBe(0);
      expect(adapter.renameCount).toBe(0);
      tab.hide();
    },
  );
});
