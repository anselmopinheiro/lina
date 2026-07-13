import { afterEach, describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  EmbeddingOperationCompletion,
  EmbeddingOperationManager,
  EmbeddingOperationRunResult,
  EmbeddingOperationState
} from "../../src/index/embeddingOperationManager";

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

function createPluginForUnloadTest(): TestableLinaPlugin {
  const plugin = Object.create(LinaPlugin.prototype) as TestableLinaPlugin;
  plugin.embeddingOperationManager = new EmbeddingOperationManager();
  plugin.embeddingOperationManagerDisposed = false;
  plugin.vaultEventListeners = [];
  plugin.indexDiagnostic = {
    pendingDebounces: new Set<string>(),
  };
  plugin.pendingAutomaticUpdates = new Map();
  plugin.pendingAutomaticUpdatesFlushTimer = null;
  plugin.automaticUpdatePromise = null;
  plugin.automaticUpdatePending = false;
  plugin.textIndexLoadPromise = null;

  return plugin;
}

async function expectAccepted(
  request: ReturnType<EmbeddingOperationManager["request"]>
): Promise<EmbeddingOperationCompletion> {
  expect(request.status).toBe("accepted");
  if (request.status !== "accepted") {
    throw new Error("Expected accepted request.");
  }

  return request.completion;
}

describe("embedding operation manager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts a single persistent embedding operation for one request", async () => {
    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();
    const runner = vi.fn(() => deferred.promise);

    const request = manager.request("command", runner);

    expect(request.status).toBe("accepted");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      operationId: 1,
      origin: "command",
      status: "running",
      finishedAt: null,
    });

    deferred.resolve({ success: true, message: "Embeddings gerados com sucesso." });
    const completion = await expectAccepted(request);

    expect(completion.result).toEqual({
      success: true,
      message: "Embeddings gerados com sucesso.",
    });
    expect(manager.getState()).toMatchObject({
      operationId: 1,
      origin: "command",
      status: "completed",
      message: "Embeddings gerados com sucesso.",
      error: null,
    });
  });

  it("does not start a second generation for two simultaneous command requests", async () => {
    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();
    const runner = vi.fn(() => deferred.promise);

    const firstRequest = manager.request("command", runner);
    const secondRequest = manager.request("command", runner);

    expect(firstRequest.status).toBe("accepted");
    expect(secondRequest).toMatchObject({
      status: "already-running",
      state: {
        operationId: 1,
        origin: "command",
        status: "running",
      },
    });
    expect(runner).toHaveBeenCalledTimes(1);

    deferred.resolve({ success: true, message: "ok" });
    await expectAccepted(firstRequest);
  });

  it("keeps a single generation when a command request is followed by a sidebar request", async () => {
    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();
    const runner = vi.fn(() => deferred.promise);

    const commandRequest = manager.request("command", runner);
    const sidebarRequest = manager.request("sidebar", runner);

    expect(commandRequest.status).toBe("accepted");
    expect(sidebarRequest).toMatchObject({
      status: "already-running",
      state: {
        operationId: 1,
        origin: "command",
        status: "running",
      },
    });
    expect(runner).toHaveBeenCalledTimes(1);

    deferred.resolve({ success: true, message: "ok" });
    await expectAccepted(commandRequest);
  });

  it("keeps a single generation when a sidebar request is followed by a command request", async () => {
    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();
    const runner = vi.fn(() => deferred.promise);

    const sidebarRequest = manager.request("sidebar", runner);
    const commandRequest = manager.request("command", runner);

    expect(sidebarRequest.status).toBe("accepted");
    expect(commandRequest).toMatchObject({
      status: "already-running",
      state: {
        operationId: 1,
        origin: "sidebar",
        status: "running",
      },
    });
    expect(runner).toHaveBeenCalledTimes(1);

    deferred.resolve({ success: true, message: "ok" });
    await expectAccepted(sidebarRequest);
  });

  it("returns an explicit already-running result for the second request", () => {
    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();

    manager.request("command", () => deferred.promise);
    const secondRequest = manager.request("sidebar", () => Promise.resolve({ success: true, message: "unused" }));

    expect(secondRequest).toMatchObject({
      status: "already-running",
      state: {
        operationId: 1,
        status: "running",
      },
    });
  });

  it("releases the manager after a successful operation", async () => {
    const manager = new EmbeddingOperationManager();
    const firstRunner = vi.fn(() => Promise.resolve({ success: true, message: "first" }));
    const secondRunner = vi.fn(() => Promise.resolve({ success: true, message: "second" }));

    const firstRequest = manager.request("command", firstRunner);
    await expectAccepted(firstRequest);

    const secondRequest = manager.request("command", secondRunner);

    expect(secondRequest.status).toBe("accepted");
    expect(firstRunner).toHaveBeenCalledTimes(1);
    expect(secondRunner).toHaveBeenCalledTimes(1);
    await expectAccepted(secondRequest);
  });

  it("releases the manager after a failed operation and allows a new one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();
    const failingRunner = vi.fn(() => deferred.promise);
    const recoveryRunner = vi.fn(() => Promise.resolve({ success: true, message: "recovered" }));

    const failedRequest = manager.request("command", failingRunner);
    deferred.reject(new Error("Provider timeout during embedding generation."));
    const failedCompletion = await expectAccepted(failedRequest);

    expect(failedCompletion.result.success).toBe(false);
    expect(failedCompletion.result.message).toBe("Provider timeout during embedding generation.");
    expect(manager.getState()).toMatchObject({
      operationId: 1,
      status: "failed",
      error: "Provider timeout during embedding generation.",
    });

    const recoveryRequest = manager.request("sidebar", recoveryRunner);

    expect(recoveryRequest.status).toBe("accepted");
    expect(recoveryRunner).toHaveBeenCalledTimes(1);
    await expectAccepted(recoveryRequest);
  });

  it("notifies all subscribers about state transitions", async () => {
    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();
    const listenerA = vi.fn<(state: EmbeddingOperationState) => void>();
    const listenerB = vi.fn<(state: EmbeddingOperationState) => void>();

    manager.subscribe(listenerA);
    manager.subscribe(listenerB);

    const request = manager.request("command", () => deferred.promise);
    deferred.resolve({ success: true, message: "done" });
    await expectAccepted(request);

    expect(listenerA).toHaveBeenCalledTimes(3);
    expect(listenerB).toHaveBeenCalledTimes(3);
    expect(listenerA.mock.calls[0]?.[0]).toMatchObject({ status: "idle" });
    expect(listenerA.mock.calls[1]?.[0]).toMatchObject({ status: "running", origin: "command" });
    expect(listenerA.mock.calls[2]?.[0]).toMatchObject({ status: "completed", message: "done" });
  });

  it("stops notifications after unsubscribe", async () => {
    const manager = new EmbeddingOperationManager();
    const deferred = createDeferred<EmbeddingOperationRunResult>();
    const listener = vi.fn<(state: EmbeddingOperationState) => void>();

    const unsubscribe = manager.subscribe(listener);
    unsubscribe();

    const request = manager.request("command", () => deferred.promise);
    deferred.resolve({ success: true, message: "done" });
    await expectAccepted(request);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ status: "idle" });
  });

  it("blocks new requests after dispose", () => {
    const manager = new EmbeddingOperationManager();

    manager.dispose();
    const request = manager.request("command", () => Promise.resolve({ success: true, message: "unused" }));

    expect(request).toMatchObject({
      status: "disposed",
      state: {
        status: "idle",
      },
    });
  });

  it("blocks new plugin requests after unload", () => {
    const plugin = createPluginForUnloadTest();

    plugin.onunload();
    const request = plugin.requestEmbeddingIndexGeneration("command");

    expect(request).toMatchObject({
      status: "disposed",
    });
  });
});
