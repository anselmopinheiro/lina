import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import LinaPlugin from "../../main.ts";
import { generateEmbeddingsForChunks } from "../../src/index/embeddingGenerator";
import { generateOllamaEmbedding } from "../../src/ai/ollamaProvider";
import { Chunk } from "../../src/index/chunker";
import { hashContent } from "../../src/index/noteHasher";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { TFile } from "obsidian";

type TestableLinaPlugin = LinaPlugin & Record<string, unknown>;

function makeChunk(path: string, index: number, text: string): Chunk {
  return {
    chunkId: `${path}::${index}`,
    path,
    chunkIndex: index,
    text,
    textHash: hashContent(text),
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function makeApp(adapter: FakeAdapter): { vault: { adapter: FakeAdapter } } {
  return {
    vault: {
      adapter,
    },
  };
}

function makeRequestResponse(status: number, json: unknown): unknown {
  return { status, json };
}

function createWindowStub(): Array<() => void> {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal("window", {
    setTimeout: vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    }),
    clearTimeout: vi.fn(),
    navigator: {
      userAgent: "vitest",
      language: "pt-PT",
      hardwareConcurrency: 4,
      maxTouchPoints: 0,
    },
  });
  return callbacks;
}

function createPluginHarness(): {
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
    embeddingBaseUrl: "not a url",
    embeddingModel: "nomic-embed-text-v2-moe",
    embeddingRequestTimeoutSeconds: 60,
    generateOnlyMissingEmbeddings: false,
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
    navigator: {
      userAgent: "vitest",
      language: "pt-PT",
      hardwareConcurrency: 4,
      maxTouchPoints: 0,
    },
  });

  return { plugin, adapter, scheduledCallbacks };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("embedding provider validation and fail-fast generation", () => {
  let requestUrlMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createWindowStub();
    requestUrlMock = vi.spyOn(obsidian, "requestUrl");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("validates a real chunk before starting the full generation", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A.md", 0, "valid content for embeddings"), makeChunk("B.md", 0, "more valid content")];
    requestUrlMock.mockResolvedValue(makeRequestResponse(200, { embeddings: [[1, 2, 3]] }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result.success).toBe(true);
    expect(result.generated).toBe(2);
    expect(result.outcome).toBe("completed");
    expect(requestUrlMock).toHaveBeenCalledTimes(3);
    expect(adapter.hasFile(".lina/index/embeddings.jsonl")).toBe(true);
  });

  it("fails locally for an invalid Base URL before any provider request", async () => {
    const adapter = new FakeAdapter();
    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "not a url",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "configuration" });
    expect(requestUrlMock).not.toHaveBeenCalled();
    expect(adapter.hasFile(".lina/index/embeddings.jsonl")).toBe(false);
  });

  it("fails locally for an unsupported provider before any provider request", async () => {
    const adapter = new FakeAdapter();
    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "unsupported",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "unsupported-provider", requestCount: 0 });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("fails locally for an empty model before any provider request", async () => {
    const adapter = new FakeAdapter();
    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "http://localhost:11434",
      model: "",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "configuration", requestCount: 0 });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("fails locally for an invalid timeout before any provider request", async () => {
    const adapter = new FakeAdapter();
    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 0,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "configuration", requestCount: 0 });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("stops after Ollama embed fails with connection error without fallback", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockRejectedValue(new Error("connection refused"));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "content"),
      makeChunk("B.md", 0, "content"),
    ], {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "connection", requestCount: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("fails validation when the Ollama model is not found", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(404, { error: "model not found" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "http://localhost:11434",
      model: "missing-model",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "model-not-found", requestCount: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("fails locally for Mistral without an API key", async () => {
    const adapter = new FakeAdapter();
    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "configuration" });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "authentication"],
    [403, "authorization"],
    [429, "rate-limit"],
  ])("fails immediately for Mistral status %s", async (status, category) => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(status, { message: "error" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: category, requestCount: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("fails validation on timeout without iterating chunks", async () => {
    const adapter = new FakeAdapter();
    const callbacks = createWindowStub();
    requestUrlMock.mockReturnValue(new Promise(() => {}));

    const promise = generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "content"),
      makeChunk("B.md", 0, "content"),
    ], {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });
    await flushMicrotasks();
    callbacks[0]();
    const result = await promise;

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "timeout", requestCount: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("fails validation when the provider response has no vector", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(200, {}));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "invalid-vector", requestCount: 2 });
  });

  it("fails validation for an empty or non-finite vector", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(200, { embeddings: [[1, Number.NaN]] }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "invalid-vector" });
  });

  it("fails validation when the reported dimension is invalid", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(200, { embeddings: [[1, 2]], dimension: 3 }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [makeChunk("A.md", 0, "content")], {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "validation-failed", errorCategory: "dimension-mismatch" });
  });

  it("tries a second validation candidate after an input-specific rejection", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(413, { message: "input too large" }))
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }))
      .mockResolvedValue(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("B.md", 0, "second candidate"),
      makeChunk("A.md", 0, "first candidate"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: true,
      outcome: "completed",
      validationCandidatesTested: 2,
      requestCount: 4,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(4);
  });

  it("tries a third validation candidate after two input-specific rejections", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(413, { message: "input too large" }))
      .mockResolvedValueOnce(makeRequestResponse(413, { message: "input too large" }))
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }))
      .mockResolvedValue(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("C.md", 0, "third candidate"),
      makeChunk("A.md", 0, "first candidate"),
      makeChunk("B.md", 0, "second candidate"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: true,
      outcome: "completed",
      validationCandidatesTested: 3,
      requestCount: 6,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(6);
  });

  it("fails validation after three input-specific candidate rejections without starting generation", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(413, { message: "input too large" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "first candidate"),
      makeChunk("B.md", 0, "second candidate"),
      makeChunk("C.md", 0, "third candidate"),
      makeChunk("D.md", 0, "not tested"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: false,
      outcome: "validation-failed",
      errorCategory: "input-rejected",
      errorScope: "input",
      validationCandidatesTested: 3,
      requestCount: 3,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(3);
    expect(adapter.hasFile(".lina/index/embeddings.jsonl")).toBe(false);
  });

  it("tests only the available validation candidates when fewer than three chunks exist", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(413, { message: "input too large" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "first candidate"),
      makeChunk("B.md", 0, "second candidate"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: false,
      outcome: "validation-failed",
      errorScope: "input",
      validationCandidatesTested: 2,
      requestCount: 2,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("stops validation immediately on a global first-candidate failure", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(500, { message: "server down" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "first candidate"),
      makeChunk("B.md", 0, "second candidate"),
      makeChunk("C.md", 0, "third candidate"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: false,
      outcome: "validation-failed",
      errorCategory: "connection",
      errorScope: "operation",
      validationCandidatesTested: 1,
      requestCount: 1,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("does not assume unknown validation errors are recoverable", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockResolvedValue(makeRequestResponse(418, { message: "teapot" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "first candidate"),
      makeChunk("B.md", 0, "second candidate"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: false,
      outcome: "validation-failed",
      errorCategory: "unknown",
      errorScope: "operation",
      validationCandidatesTested: 1,
      requestCount: 1,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("does not use Ollama fallback for a refused connection", async () => {
    requestUrlMock.mockRejectedValue(new Error("connection refused"));

    const result = await generateOllamaEmbedding("http://localhost:11434", "nomic-embed-text", "content");

    expect(result).toMatchObject({
      success: false,
      errorCategory: "connection",
      requestCount: 1,
      fallbackUsed: false,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("does not use Ollama fallback for an unreachable host", async () => {
    requestUrlMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND host.invalid"));

    const result = await generateOllamaEmbedding("http://host.invalid:11434", "nomic-embed-text", "content");

    expect(result).toMatchObject({
      success: false,
      errorCategory: "connection",
      requestCount: 1,
      fallbackUsed: false,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("uses Ollama fallback when the modern endpoint is incompatible and the legacy endpoint is valid", async () => {
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(404, { error: "endpoint not found" }))
      .mockResolvedValueOnce(makeRequestResponse(200, { embedding: [1, 2, 3] }));

    const result = await generateOllamaEmbedding("http://localhost:11434", "nomic-embed-text", "content");

    expect(result).toMatchObject({
      success: true,
      dimension: 3,
      requestCount: 2,
      fallbackUsed: true,
      fallbackReason: "modern-endpoint-status-404",
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("reports invalid response when both Ollama endpoints are incompatible", async () => {
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(404, { error: "endpoint not found" }))
      .mockResolvedValueOnce(makeRequestResponse(404, { error: "endpoint not found" }));

    const result = await generateOllamaEmbedding("http://localhost:11434", "nomic-embed-text", "content");

    expect(result).toMatchObject({
      success: false,
      errorCategory: "invalid-response",
      errorScope: "operation",
      requestCount: 2,
      fallbackUsed: true,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("does not use Ollama fallback for a proven missing model", async () => {
    requestUrlMock.mockResolvedValue(makeRequestResponse(404, { error: "model not found" }));

    const result = await generateOllamaEmbedding("http://localhost:11434", "missing-model", "content");

    expect(result).toMatchObject({
      success: false,
      errorCategory: "model-not-found",
      requestCount: 1,
      fallbackUsed: false,
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("uses Ollama fallback when the modern endpoint returns a legacy-shaped response", async () => {
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(200, { embedding: [1, 2, 3] }))
      .mockResolvedValueOnce(makeRequestResponse(200, { embedding: [1, 2, 3] }));

    const result = await generateOllamaEmbedding("http://localhost:11434", "nomic-embed-text", "content");

    expect(result).toMatchObject({
      success: true,
      dimension: 3,
      requestCount: 2,
      fallbackUsed: true,
      fallbackReason: "modern-endpoint-invalid-response",
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("uses the first successful validation candidate dimension during generation", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(413, { message: "input too large" }))
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3, 4] }] }))
      .mockResolvedValue(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3, 4] }] }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "first candidate"),
      makeChunk("B.md", 0, "second candidate"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: true,
      dimensions: 4,
      validationCandidatesTested: 2,
    });
  });

  it("treats generation dimension drift as a global failure", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }))
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2] }] }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "content"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({
      success: false,
      outcome: "generation-failed",
      errorCategory: "dimension-mismatch",
      errorScope: "operation",
      requestCount: 2,
    });
  });

  it("stops remaining chunks on a global generation failure after validation succeeds", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }))
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }))
      .mockResolvedValueOnce(makeRequestResponse(500, { message: "server down" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "content"),
      makeChunk("B.md", 0, "content"),
      makeChunk("C.md", 0, "content"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "generation-failed", errorCategory: "connection", generated: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(3);
  });

  it("continues after an input-specific rejection and reports a partial result", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }))
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [1, 2, 3] }] }))
      .mockResolvedValueOnce(makeRequestResponse(413, { message: "input too large" }))
      .mockResolvedValueOnce(makeRequestResponse(200, { data: [{ embedding: [4, 5, 6] }] }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [
      makeChunk("A.md", 0, "content"),
      makeChunk("B.md", 0, "content"),
      makeChunk("C.md", 0, "content"),
    ], {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    });

    expect(result).toMatchObject({ success: true, outcome: "completed-with-partial-failures", generated: 2, failed: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(4);
  });

  it("releases the manager and coordinator after validation failure and resumes pending text events", async () => {
    const { plugin, adapter, scheduledCallbacks } = createPluginHarness();
    plugin.settings = {
      ...plugin.settings,
      embeddingProvider: "mistral",
      embeddingBaseUrl: "https://api.mistral.ai/v1",
      embeddingModel: "mistral-embed",
      embeddingApiKey: "secret",
    };
    const chunks = [
      makeChunk("A.md", 0, "content"),
      makeChunk("B.md", 0, "content"),
      makeChunk("C.md", 0, "content"),
    ];
    adapter.setFile(".lina/index/chunks.jsonl", chunks.map((chunk) => JSON.stringify(chunk)).join("\n"));
    requestUrlMock.mockResolvedValue(makeRequestResponse(413, { message: "input too large" }));
    plugin["processAutomaticIndexUpdateBatch"] = vi.fn(async () => {});

    const request = plugin.requestEmbeddingIndexGeneration("command");
    expect(request.status).toBe("accepted");

    const file = new TFile("Queued.md", "queued content");
    file.stat = { size: 14, mtime: 100 };
    (plugin.queueAutomaticIndexUpdate as (update: unknown, reason: string) => void).call(plugin, {
      changeType: "create",
      file,
      path: file.path,
      receivedAt: "2026-07-14T00:00:00.000Z",
    }, "ready");

    if (request.status === "accepted") {
      const completion = await request.completion;
      expect(completion.result.success).toBe(false);
    }
    expect(requestUrlMock).toHaveBeenCalledTimes(3);

    expect(plugin.getEmbeddingOperationState()).toMatchObject({ status: "failed", phase: null });
    expect(plugin["getIndexWriteCoordinator"]().getState()).toMatchObject({
      activeOperation: null,
      embeddingGenerationRequested: false,
    });

    const secondRequest = plugin.requestEmbeddingIndexGeneration("command");
    expect(secondRequest.status).toBe("accepted");
    if (secondRequest.status === "accepted") {
      await secondRequest.completion;
    }

    expect(scheduledCallbacks.length).toBeGreaterThan(0);
    scheduledCallbacks[0]();
    await flushMicrotasks();
    expect(plugin["processAutomaticIndexUpdateBatch"]).toHaveBeenCalled();
  });

  it("publishes validation state updates to subscribers", async () => {
    const { plugin, adapter } = createPluginHarness();
    const states: unknown[] = [];
    const chunk = makeChunk("Live.md", 0, "content");
    adapter.setFile(".lina/index/chunks.jsonl", `${JSON.stringify(chunk)}\n`);
    plugin.onEmbeddingOperationStateChange((state) => states.push(state));

    const request = plugin.requestEmbeddingIndexGeneration("command");
    if (request.status === "accepted") {
      await request.completion;
    }

    expect(states).toContainEqual(expect.objectContaining({
      status: "running",
      phase: "validating",
    }));
  });
});
