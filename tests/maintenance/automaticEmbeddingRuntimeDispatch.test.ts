import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";

type TestableLinaPlugin = LinaPlugin & Record<string, unknown>;

interface ScheduledTimer {
  readonly callback: () => void;
  readonly delay: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function createPluginHarness(): {
  plugin: TestableLinaPlugin;
  timers: ScheduledTimer[];
} {
  const adapter = new FakeAdapter({
    ".lina/index/chunks.jsonl": JSON.stringify({
      chunkId: "Runtime.md::0",
      path: "Runtime.md",
      chunkIndex: 0,
      text: "A distinctive runtime sentence that requires an embedding update.",
      textHash: "runtime-text-hash",
      createdAt: "2026-08-17T18:30:00.000Z",
    }),
  });
  const timers: ScheduledTimer[] = [];
  const plugin = Object.create(LinaPlugin.prototype) as TestableLinaPlugin;
  plugin.app = {
    vault: {
      adapter,
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      read: vi.fn(),
      on: vi.fn(),
      offref: vi.fn(),
    },
  };
  plugin.manifest = { id: "lina" };
  plugin.settings = {
    interfaceLanguage: "pt-PT",
    autoUpdateIndexOnFileChanges: true,
    debugIndexUpdates: false,
    indexExcludedFolders: "",
    indexExcludedPathContains: "",
    indexExcludedContentContains: "",
    embeddingProvider: "ollama",
    embeddingBaseUrl: "http://localhost:11434",
    embeddingModel: "nomic-embed-text-v2-moe",
    embeddingRequestTimeoutSeconds: 60,
    generateOnlyMissingEmbeddings: true,
    embeddingUpdateMode: "automatic-local-only",
  };
  plugin.indexedNotes = [];
  plugin.indexedChunks = [];
  plugin.textIndexLoaded = false;
  plugin.textIndexRebuildProgress = { status: "idle", total: 0, processed: 0, skipped: 0, errors: 0 };
  plugin.pendingAutomaticUpdates = new Map();
  plugin.pendingAutomaticUpdatesFlushTimer = null;
  plugin.automaticUpdatesReady = true;
  plugin.automaticUpdateInProgress = false;
  plugin.automaticUpdatePending = false;
  plugin.automaticUpdatePromise = null;
  plugin.indexWriteCoordinatorDisposed = false;

  vi.stubGlobal("window", {
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout: () => undefined,
  });

  return { plugin, timers };
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("automatic embedding runtime dispatch", () => {
  afterEach(() => {
    Platform.isMobile = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("derives automatic work from a fresh update plan while the passive status remains uncalculated", async () => {
    const { plugin } = createPluginHarness();

    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({ status: "unknown" });
    const hasAutomaticEmbeddingWork = plugin["hasAutomaticEmbeddingWork"] as () => Promise<boolean>;

    await expect(hasAutomaticEmbeddingWork.call(plugin)).resolves.toBe(true);
    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({ status: "unknown" });
  });

  it("refreshes configuration-derived status without scheduling automatic generation", async () => {
    const { plugin, timers } = createPluginHarness();
    const engine = plugin.getMaintenanceEngine();
    const requestGeneration = vi.spyOn(engine, "requestEmbeddingGeneration");
    const providerGeneration = vi.fn();
    plugin["runGenerateLocalEmbeddings"] = providerGeneration;
    engine.start();

    await plugin.refreshEmbeddingConfigurationState();

    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({
      status: "ready",
      reason: "settings-changed",
      workAvailable: true,
    });
    expect(timers.some(({ delay }) => delay === 30_000)).toBe(false);
    expect(requestGeneration).not.toHaveBeenCalled();
    expect(providerGeneration).not.toHaveBeenCalled();
  });

  it("blocks automatic Ollama generation and keeps work dirty when policy is manual", async () => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingUpdateMode = "manual";
    const runGeneration = vi.fn(async () => ({ success: true, message: "generated" }));
    plugin["runGenerateLocalEmbeddings"] = runGeneration;
    const engine = plugin.getMaintenanceEngine();
    const requestGeneration = vi.spyOn(engine, "requestEmbeddingGeneration");
    engine.start();

    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    const eligibilityTimer = timers.find(({ delay }) => delay === 30_000);
    if (!eligibilityTimer) throw new Error("Expected the scheduler quiet-period timer.");
    eligibilityTimer.callback();
    await flushAsync();

    expect(requestGeneration).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "dirty" });
  });

  it.each([
    ["mistral", "mistral-embed"],
    ["openrouter", "openai/text-embedding-3-small"],
  ])("blocks automatic generation for %s external provider even when policy is automatic-local-only", async (provider, model) => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingProvider = provider;
    plugin.settings.embeddingModel = model;
    plugin.settings.embeddingUpdateMode = "automatic-local-only";
    const providerGeneration = vi.fn();
    plugin["runGenerateLocalEmbeddings"] = providerGeneration;
    const engine = plugin.getMaintenanceEngine();
    const requestGeneration = vi.spyOn(engine, "requestEmbeddingGeneration");
    engine.start();

    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    const eligibilityTimer = timers.find(({ delay }) => delay === 30_000);
    if (!eligibilityTimer) throw new Error("Expected the scheduler quiet-period timer.");
    eligibilityTimer.callback();
    await flushAsync();

    expect(requestGeneration).not.toHaveBeenCalled();
    expect(providerGeneration).not.toHaveBeenCalled();
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "dirty" });
  });

  it("blocks automatic generation on a Companion device", async () => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingUpdateMode = "automatic-local-only";
    plugin.localDeviceState = { role: "companion", deviceName: "mobile" };
    Platform.isMobile = true;
    const providerGeneration = vi.fn();
    plugin["runGenerateLocalEmbeddings"] = providerGeneration;
    const engine = plugin.getMaintenanceEngine();
    const requestGeneration = vi.spyOn(engine, "requestEmbeddingGeneration");
    engine.start();

    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    const eligibilityTimer = timers.find(({ delay }) => delay === 30_000);
    // On companion, scheduler is not started or cannot schedule embeddings
    if (eligibilityTimer) {
      eligibilityTimer.callback();
      await flushAsync();
    }

    expect(requestGeneration).not.toHaveBeenCalled();
    expect(providerGeneration).not.toHaveBeenCalled();
  });

  it.each([
    ["mistral", "mistral-embed"],
    ["openrouter", "openai/text-embedding-3-small"],
  ])("refreshes %s manual-provider status locally after a text-index dirty signal", async (provider, model) => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingProvider = provider;
    plugin.settings.embeddingModel = model;
    const providerGeneration = vi.fn();
    plugin["runGenerateLocalEmbeddings"] = providerGeneration;
    const observedStates: string[] = [];
    const unsubscribe = plugin.onEmbeddingWorkStatusChange((state) => observedStates.push(state.status));

    await plugin.refreshEmbeddingWorkStatus();
    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    plugin.markEmbeddingWorkStatusDirty("text-index-published");

    const statusRefreshTimers = timers.filter(({ delay }) => delay === 250);
    expect(statusRefreshTimers).toHaveLength(2);
    statusRefreshTimers.at(-1)?.callback();
    await plugin.refreshEmbeddingWorkStatus();

    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({
      status: "ready",
      revision: 2,
      calculatedRevision: 2,
      workAvailable: true,
    });
    expect(observedStates).toContain("dirty");
    expect(observedStates).toContain("calculating");
    expect(observedStates.at(-1)).toBe("ready");
    expect(providerGeneration).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("routes a production dirty signal to one Ollama request and starts post-publication status refresh", async () => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingUpdateMode = "automatic-local-only";
    const runGeneration = vi.fn(async () => ({ success: true, message: "generated" }));
    plugin["runGenerateLocalEmbeddings"] = runGeneration;
    const hasAutomaticEmbeddingWork = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    plugin["hasAutomaticEmbeddingWork"] = hasAutomaticEmbeddingWork;
    const engine = plugin.getMaintenanceEngine();
    const requestGeneration = vi.spyOn(engine, "requestEmbeddingGeneration");
    engine.start();

    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    const eligibilityTimer = timers.find(({ delay }) => delay === 30_000);
    if (!eligibilityTimer) throw new Error("Expected the scheduler quiet-period timer.");
    eligibilityTimer.callback();
    await flushAsync();

    expect(hasAutomaticEmbeddingWork).toHaveBeenCalledTimes(2);
    expect(requestGeneration).toHaveBeenCalledTimes(1);
    expect(requestGeneration).toHaveBeenCalledWith("automatic");
    expect(runGeneration).toHaveBeenCalledTimes(1);
    expect(["calculating", "ready"]).toContain(plugin.getEmbeddingWorkStatus().status);
  });

  it("refreshes derived status once after an automatic canonical publication", async () => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingUpdateMode = "automatic-local-only";
    const refreshAfterPublication = vi.fn();
    plugin["refreshEmbeddingWorkStatusAfterCanonicalPublication"] = refreshAfterPublication;
    plugin["runGenerateLocalEmbeddings"] = vi.fn(async () => ({
      success: true,
      publicationId: "automatic-publication",
      message: "generated",
    }));
    plugin["hasAutomaticEmbeddingWork"] = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const engine = plugin.getMaintenanceEngine();
    engine.start();

    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    const eligibilityTimer = timers.find(({ delay }) => delay === 30_000);
    if (!eligibilityTimer) throw new Error("Expected the scheduler quiet-period timer.");
    eligibilityTimer.callback();
    await flushAsync();

    expect(refreshAfterPublication).toHaveBeenCalledTimes(1);
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "clean", ready: false });
  });

  it("uses the same post-publication refresh hook for manual generation", async () => {
    const { plugin } = createPluginHarness();
    const refreshAfterPublication = vi.fn();
    plugin["refreshEmbeddingWorkStatusAfterCanonicalPublication"] = refreshAfterPublication;
    plugin["runGenerateLocalEmbeddings"] = vi.fn(async () => ({
      success: true,
      publicationId: "manual-publication",
      message: "generated",
    }));

    const request = plugin.requestEmbeddingIndexGeneration("command");
    if (request.status !== "accepted") throw new Error("Expected manual generation to start.");
    await request.completion;
    await flushAsync();

    expect(refreshAfterPublication).toHaveBeenCalledTimes(1);
  });

  it("does not refresh derived status after a failed automatic generation", async () => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingUpdateMode = "automatic-local-only";
    const refreshAfterPublication = vi.fn();
    plugin["refreshEmbeddingWorkStatusAfterCanonicalPublication"] = refreshAfterPublication;
    plugin["runGenerateLocalEmbeddings"] = vi.fn(async () => ({ success: false, message: "failed" }));
    plugin["hasAutomaticEmbeddingWork"] = vi.fn().mockResolvedValueOnce(true);
    const engine = plugin.getMaintenanceEngine();
    engine.start();

    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    const eligibilityTimer = timers.find(({ delay }) => delay === 30_000);
    if (!eligibilityTimer) throw new Error("Expected the scheduler quiet-period timer.");
    eligibilityTimer.callback();
    await flushAsync();

    expect(refreshAfterPublication).not.toHaveBeenCalled();
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "dirty", ready: true });
  });

  it("does not abort an automatic worker when another dirty signal arrives", async () => {
    const { plugin, timers } = createPluginHarness();
    plugin.settings.embeddingUpdateMode = "automatic-local-only";
    const runningGeneration = deferred<{ success: boolean; message: string }>();
    let activeSignal: AbortSignal | undefined;
    plugin["runGenerateLocalEmbeddings"] = vi.fn((
      _onProgress: unknown,
      _onPhase: unknown,
      signal: AbortSignal,
    ) => {
      activeSignal = signal;
      return runningGeneration.promise;
    });
    plugin["hasAutomaticEmbeddingWork"] = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const engine = plugin.getMaintenanceEngine();
    engine.start();

    plugin.markEmbeddingWorkStatusDirty("text-index-published");
    const eligibilityTimer = timers.find(({ delay }) => delay === 30_000);
    if (!eligibilityTimer) throw new Error("Expected the scheduler quiet-period timer.");
    eligibilityTimer.callback();
    await flushAsync();

    expect(activeSignal).toBeDefined();
    expect(activeSignal?.aborted).toBe(false);

    plugin.markEmbeddingWorkStatusDirty("text-index-published");

    expect(activeSignal?.aborted).toBe(false);
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "dirty" });

    runningGeneration.resolve({ success: true, message: "generated" });
    await flushAsync();

    expect(activeSignal?.aborted).toBe(false);
    expect(engine.getEmbeddingOperationState()).toMatchObject({ status: "completed", origin: "automatic" });
  });

  it("retains the sanitized provider failure detail when the category is unknown", () => {
    const { plugin } = createPluginHarness();
    const buildFailureMessage = plugin["buildEmbeddingGenerationFailureMessage"] as (
      config: { provider: string; model: string },
      result: { outcome?: string; errorCategory?: string; errorMessage?: string },
    ) => string;

    const message = buildFailureMessage.call(plugin, {
      provider: "ollama",
      model: "nomic-embed-text-v2-moe",
    }, {
      outcome: "generation-failed",
      errorCategory: "unknown",
      errorMessage: "  Canonical publication failed\n  because the index is locked.  ",
    });

    expect(message).toContain("Categoria: unknown.");
    expect(message).toContain("Detalhe: Canonical publication failed because the index is locked.");
  });
});
