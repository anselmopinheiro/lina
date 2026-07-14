import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { TFile } from "obsidian";
import { FakeAdapter } from "../helpers/fakeAdapter";

type TestableLinaPlugin = LinaPlugin & Record<string, unknown>;

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function makeFile(path: string, content: string, mtime = 100): TFile {
  const file = new TFile(path, content);
  file.stat = { size: content.length, mtime };
  return file;
}

function createHarness(): {
  plugin: TestableLinaPlugin;
  adapter: FakeAdapter;
  scheduledCallbacks: Array<() => void>;
} {
  const adapter = new FakeAdapter();
  const scheduledCallbacks: Array<() => void> = [];
  const plugin = Object.create(LinaPlugin.prototype) as TestableLinaPlugin;

  plugin.app = {
    vault: {
      adapter,
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: (_path: string) => null,
      read: vi.fn(),
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
  };
  plugin.indexedNotes = [];
  plugin.indexedChunks = [];
  plugin.textIndexLoaded = false;
  plugin.vaultEventListeners = [];
  plugin.textIndexLoadPromise = null;
  plugin.textIndexRebuildProgress = { status: "idle", total: 0, processed: 0, skipped: 0, errors: 0 };
  plugin.textIndexRebuildListeners = new Set();
  plugin.activeAutomaticIndexUpdates = 0;
  plugin.automaticUpdatesReady = true;
  plugin.automaticUpdateInProgress = false;
  plugin.automaticUpdatePromise = null;
  plugin.automaticUpdatePending = false;
  plugin.startupReconciliationNeeded = false;
  plugin.startupReconciliationInProgress = false;
  plugin.startupIgnoredEventCount = 0;
  plugin.pendingAutomaticUpdates = new Map();
  plugin.pendingAutomaticUpdatesFlushTimer = null;
  plugin.embeddingOperationManagerDisposed = false;
  plugin.indexWriteCoordinatorDisposed = false;
  plugin.indexDiagnostic = {
    autoUpdateEnabled: false,
    debugEnabled: false,
    pendingDebounces: new Set<string>(),
    recentEvents: [],
  };

  vi.stubGlobal("window", {
    setTimeout: vi.fn((callback: () => void) => {
      scheduledCallbacks.push(callback);
      return scheduledCallbacks.length;
    }),
    clearTimeout: vi.fn(),
  });

  return { plugin, adapter, scheduledCallbacks };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("text index and embedding generation coordination", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts embedding generation when the text index is free", async () => {
    const { plugin } = createHarness();
    const deferred = createDeferred<{ success: boolean; message: string }>();
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => deferred.promise);

    const request = plugin.requestEmbeddingIndexGeneration("command");

    expect(request.status).toBe("accepted");
    await flushMicrotasks();
    expect(plugin["runGenerateLocalEmbeddings"]).toHaveBeenCalledTimes(1);

    deferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      const completion = await request.completion;
      expect(completion.result).toEqual({ success: true, message: "ok" });
    }
  });

  it("rejects embedding generation during a text index rebuild", () => {
    const { plugin } = createHarness();
    plugin.textIndexRebuildProgress = { status: "running", total: 1, processed: 0, skipped: 0, errors: 0 };
    plugin["runGenerateLocalEmbeddings"] = vi.fn();

    const request = plugin.requestEmbeddingIndexGeneration("command");

    expect(request).toMatchObject({ status: "text-index-busy" });
    expect(plugin["runGenerateLocalEmbeddings"]).not.toHaveBeenCalled();
  });

  it("rejects rebuild while embeddings are being generated", async () => {
    const { plugin } = createHarness();
    const deferred = createDeferred<{ success: boolean; message: string }>();
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => deferred.promise);

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");

    const rebuildResult = await plugin.rebuildTextIndex();
    expect(rebuildResult).toEqual({
      success: false,
      message: "Os embeddings estão a ser gerados. A reconstrução do índice textual não pode começar ainda.",
    });

    deferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      await request.completion;
    }
  });

  it("waits for an automatic batch already in progress before starting embedding generation", async () => {
    const { plugin } = createHarness();
    const batchDeferred = createDeferred<void>();
    const generationDeferred = createDeferred<{ success: boolean; message: string }>();

    plugin.automaticUpdatePromise = batchDeferred.promise;
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => generationDeferred.promise);

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");
    expect(plugin["runGenerateLocalEmbeddings"]).not.toHaveBeenCalled();

    batchDeferred.resolve();
    plugin.automaticUpdatePromise = null;
    await flushMicrotasks();

    expect(plugin["runGenerateLocalEmbeddings"]).toHaveBeenCalledTimes(1);

    generationDeferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      await request.completion;
    }
  });

  it("drains pending automatic updates before starting embedding generation", async () => {
    const { plugin } = createHarness();
    const batchDeferred = createDeferred<void>();
    const generationDeferred = createDeferred<{ success: boolean; message: string }>();
    const file = makeFile("Live.md", "content");
    plugin.pendingAutomaticUpdates.set("Live.md", {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:00.000Z",
    });
    plugin["processAutomaticIndexUpdateBatch"] = vi.fn(async () => {
      await batchDeferred.promise;
    });
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => generationDeferred.promise);

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");
    expect(plugin["processAutomaticIndexUpdateBatch"]).toHaveBeenCalledTimes(1);
    expect(plugin["runGenerateLocalEmbeddings"]).not.toHaveBeenCalled();

    batchDeferred.resolve();
    await flushMicrotasks();

    expect(plugin["runGenerateLocalEmbeddings"]).toHaveBeenCalledTimes(1);

    generationDeferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      await request.completion;
    }
  });

  it("keeps an event received during generation in the pending queue", async () => {
    const { plugin } = createHarness();
    const generationDeferred = createDeferred<{ success: boolean; message: string }>();
    const file = makeFile("Live.md", "content");
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => generationDeferred.promise);

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");

    (plugin.queueAutomaticIndexUpdate as (update: unknown, reason: string) => void).call(plugin, {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:00.000Z",
    }, "ready");

    await (plugin.flushPendingAutomaticUpdates as () => Promise<void>).call(plugin);

    expect(plugin.pendingAutomaticUpdates.size).toBe(1);
    expect(plugin.pendingAutomaticUpdates.get("Live.md")).toMatchObject({
      changeType: "create",
      path: "Live.md",
    });

    generationDeferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      await request.completion;
    }
  });

  it("preserves coalescing for multiple events received during generation", async () => {
    const { plugin } = createHarness();
    const generationDeferred = createDeferred<{ success: boolean; message: string }>();
    const file = makeFile("Live.md", "content");
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => generationDeferred.promise);

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");

    (plugin.queueAutomaticIndexUpdate as (update: unknown, reason: string) => void).call(plugin, {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:00.000Z",
    }, "ready");
    (plugin.queueAutomaticIndexUpdate as (update: unknown, reason: string) => void).call(plugin, {
      changeType: "modify",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:01.000Z",
    }, "ready");

    expect(plugin.pendingAutomaticUpdates.size).toBe(1);
    expect(plugin.pendingAutomaticUpdates.get("Live.md")).toMatchObject({
      changeType: "create",
      path: "Live.md",
    });

    generationDeferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      await request.completion;
    }
  });

  it("processes the pending queue automatically after a successful generation", async () => {
    const { plugin, scheduledCallbacks } = createHarness();
    const generationDeferred = createDeferred<{ success: boolean; message: string }>();
    const file = makeFile("Live.md", "content");
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => generationDeferred.promise);
    plugin["processAutomaticIndexUpdateBatch"] = vi.fn(async () => {});

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");

    (plugin.queueAutomaticIndexUpdate as (update: unknown, reason: string) => void).call(plugin, {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:00.000Z",
    }, "ready");

    generationDeferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      await request.completion;
    }

    expect(scheduledCallbacks).toHaveLength(1);
    scheduledCallbacks[0]();
    await flushMicrotasks();

    expect(plugin["processAutomaticIndexUpdateBatch"]).toHaveBeenCalledTimes(1);
    expect(plugin.pendingAutomaticUpdates.size).toBe(0);
  });

  it("processes the pending queue automatically after a failed generation", async () => {
    const { plugin, scheduledCallbacks } = createHarness();
    const generationDeferred = createDeferred<{ success: boolean; message: string }>();
    const file = makeFile("Live.md", "content");
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => generationDeferred.promise);
    plugin["processAutomaticIndexUpdateBatch"] = vi.fn(async () => {});

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");

    (plugin.queueAutomaticIndexUpdate as (update: unknown, reason: string) => void).call(plugin, {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:00.000Z",
    }, "ready");

    generationDeferred.reject(new Error("Provider timeout"));
    if (request.status === "accepted") {
      await request.completion;
    }

    expect(scheduledCallbacks).toHaveLength(1);
    scheduledCallbacks[0]();
    await flushMicrotasks();

    expect(plugin["processAutomaticIndexUpdateBatch"]).toHaveBeenCalledTimes(1);
    expect(plugin.pendingAutomaticUpdates.size).toBe(0);
  });

  it("keeps coordination while cancelling, then releases it and resumes the pending queue", async () => {
    const { plugin, scheduledCallbacks } = createHarness();
    const generationDeferred = createDeferred<{ success: boolean; message: string; cancelled?: boolean }>();
    const file = makeFile("Live.md", "content");
    let signal: AbortSignal | undefined;
    plugin["runGenerateLocalEmbeddings"] = vi.fn((_onProgress, _onPhase, abortSignal: AbortSignal) => {
      signal = abortSignal;
      return generationDeferred.promise;
    });
    plugin["processAutomaticIndexUpdateBatch"] = vi.fn(async () => {});

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");
    await flushMicrotasks();

    (plugin.queueAutomaticIndexUpdate as (update: unknown, reason: string) => void).call(plugin, {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:00.000Z",
    }, "ready");

    expect(plugin.cancelActiveEmbeddingOperation()).toBe("cancel-requested");
    expect(signal?.aborted).toBe(true);
    expect(plugin.getEmbeddingOperationState()).toMatchObject({ status: "cancelling" });
    expect(plugin["getIndexWriteCoordinator"]().getState()).toMatchObject({
      activeOperation: "embedding-generation",
    });

    const rebuildDuringCancel = await plugin.rebuildTextIndex();
    expect(rebuildDuringCancel.success).toBe(false);

    generationDeferred.resolve({ success: false, message: "cancelled", cancelled: true });
    if (request.status === "accepted") {
      await request.completion;
    }

    expect(plugin.getEmbeddingOperationState()).toMatchObject({ status: "cancelled" });
    expect(plugin["getIndexWriteCoordinator"]().getState()).toMatchObject({
      activeOperation: null,
    });

    expect(scheduledCallbacks.length).toBeGreaterThan(0);
    scheduledCallbacks[scheduledCallbacks.length - 1]?.();
    await flushMicrotasks();

    expect(plugin["processAutomaticIndexUpdateBatch"]).toHaveBeenCalledTimes(1);
    expect(plugin.pendingAutomaticUpdates.size).toBe(0);

    const secondGenerationDeferred = createDeferred<{ success: boolean; message: string }>();
    (plugin["runGenerateLocalEmbeddings"] as ReturnType<typeof vi.fn>).mockImplementationOnce(() => secondGenerationDeferred.promise);
    const secondRequest = plugin.requestEmbeddingIndexGeneration("sidebar");
    expect(secondRequest.status).toBe("accepted");
    secondGenerationDeferred.resolve({ success: true, message: "ok" });
    if (secondRequest.status === "accepted") {
      await secondRequest.completion;
    }
  });

  it("does not clear or lose events when a batch is blocked by active embedding generation", async () => {
    const { plugin } = createHarness();
    const generationDeferred = createDeferred<{ success: boolean; message: string }>();
    const file = makeFile("Live.md", "content");
    plugin["runGenerateLocalEmbeddings"] = vi.fn(() => generationDeferred.promise);
    plugin["processAutomaticIndexUpdateBatch"] = vi.fn();

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");

    plugin.pendingAutomaticUpdates.set("Live.md", {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-13T00:00:00.000Z",
    });

    await (plugin.processNextAutomaticUpdateBatch as () => Promise<void>).call(plugin);

    expect(plugin.pendingAutomaticUpdates.size).toBe(1);
    expect(plugin["processAutomaticIndexUpdateBatch"]).not.toHaveBeenCalled();

    generationDeferred.resolve({ success: true, message: "ok" });
    if (request.status === "accepted") {
      await request.completion;
    }
  });

  it("releases coordination after an exception and allows a new generation", async () => {
    const { plugin } = createHarness();
    const firstDeferred = createDeferred<{ success: boolean; message: string }>();
    const secondDeferred = createDeferred<{ success: boolean; message: string }>();

    const runGenerate = vi.fn()
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise);
    plugin["runGenerateLocalEmbeddings"] = runGenerate;

    const firstRequest = plugin.requestEmbeddingIndexGeneration("command");
    expect(firstRequest.status).toBe("accepted");

    firstDeferred.reject(new Error("Provider timeout"));
    if (firstRequest.status === "accepted") {
      await firstRequest.completion;
    }

    const secondRequest = plugin.requestEmbeddingIndexGeneration("command");
    expect(secondRequest.status).toBe("accepted");
    await flushMicrotasks();
    expect(runGenerate).toHaveBeenCalledTimes(2);

    secondDeferred.resolve({ success: true, message: "ok" });
    if (secondRequest.status === "accepted") {
      await secondRequest.completion;
    }
  });

  it("blocks new coordinated operations after unload", async () => {
    const { plugin } = createHarness();

    plugin.onunload();

    const generationRequest = plugin.requestEmbeddingIndexGeneration("command");
    expect(generationRequest).toMatchObject({ status: "disposed" });

    const rebuildResult = await plugin.rebuildTextIndex();
    expect(rebuildResult.success).toBe(false);
  });
});
