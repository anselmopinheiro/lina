import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { generateMistralEmbeddings } from "../../src/ai/mistralProvider";
import { generateOllamaEmbeddings } from "../../src/ai/ollamaProvider";
import {
  generateEmbeddingsForChunks,
  normalizeEmbeddingBatchSize,
} from "../../src/index/embeddingGenerator";
import { Chunk } from "../../src/index/chunker";
import { hashContent } from "../../src/index/noteHasher";
import { FakeAdapter } from "../helpers/fakeAdapter";

function makeChunk(name: string): Chunk {
  const path = `${name}.md`;
  const text = `content ${name}`;
  return {
    chunkId: `${path}::0`,
    path,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function makeApp(adapter: FakeAdapter): { vault: { adapter: FakeAdapter } } {
  if (!adapter.hasFile(".lina/index/manifest.json")) {
    adapter.setFile(".lina/index/manifest.json", JSON.stringify({
      version: 1,
      indexType: "text",
      embeddingsEnabled: false,
      updatedAt: "2026-07-16T00:00:00.000Z",
      totalNotes: 0,
      totalChunks: 0,
    }));
  }
  return { vault: { adapter } };
}

function response(status: number, json: unknown): unknown {
  return { status, json };
}

function requestBody(call: unknown[]): Record<string, unknown> {
  const options = call[0] as { body?: string };
  return JSON.parse(options.body ?? "{}") as Record<string, unknown>;
}

function requestUrl(call: unknown[]): string {
  return (call[0] as { url: string }).url;
}

function vectorForInput(input: string): number[] {
  const match = input.match(/content ([A-Z])/);
  const value = match ? match[1].charCodeAt(0) - 64 : 1;
  return [value, value + 0.25, value + 0.5];
}

function mistralResponseForCall(call: unknown[]): unknown {
  const body = requestBody(call);
  const inputs = body.input as string[];
  return response(200, {
    data: inputs.map((input, index) => ({ index, embedding: vectorForInput(input) })),
  });
}

function ollamaResponseForCall(call: unknown[]): unknown {
  const body = requestBody(call);
  const rawInput = body.input;
  const inputs = Array.isArray(rawInput) ? rawInput as string[] : [rawInput as string];
  return response(200, { embeddings: inputs.map(vectorForInput) });
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForCalls(mock: ReturnType<typeof vi.spyOn>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && mock.mock.calls.length < count; attempt++) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledTimes(count);
}

describe("persistent embedding batching", () => {
  let requestUrlMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      navigator: {
        userAgent: "vitest",
        language: "pt-PT",
        hardwareConcurrency: 4,
        maxTouchPoints: 0,
      },
    });
    requestUrlMock = vi.spyOn(obsidian, "requestUrl");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [1, 1],
    [0, 1],
    [-4, 1],
    [3.9, 3],
    [50, 50],
    [51, 50],
    [Number.POSITIVE_INFINITY, 10],
    [Number.NaN, 10],
  ])("normalizes batch size %s to %s", (value, expected) => {
    expect(normalizeEmbeddingBatchSize(value)).toBe(expected);
  });

  it("uses Mistral response indices to restore input order", async () => {
    requestUrlMock.mockResolvedValue(response(200, {
      data: [
        { index: 1, embedding: [4, 5, 6] },
        { index: 0, embedding: [1, 2, 3] },
      ],
    }));

    const result = await generateMistralEmbeddings(
      "https://api.mistral.ai/v1",
      "secret",
      "mistral-embed",
      ["first", "second"]
    );

    expect(result).toMatchObject({ success: true, embeddings: [[1, 2, 3], [4, 5, 6]], requestCount: 1 });
    expect(requestBody(requestUrlMock.mock.calls[0]).input).toEqual(["first", "second"]);
  });

  it.each([
    [{ data: [{ index: 0, embedding: [1, 2, 3] }] }, "invalid-response"],
    [{ data: [{ index: 0, embedding: [1, 2, 3] }, { index: 0, embedding: [4, 5, 6] }] }, "invalid-response"],
    [{ data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }] }, "invalid-response"],
    [{ data: [{ index: 0, embedding: [1, 2, 3] }, { index: 1, embedding: [4, 5] }] }, "dimension-mismatch"],
  ])("rejects an unsafe Mistral batch response", async (json, category) => {
    requestUrlMock.mockResolvedValue(response(200, json));
    const result = await generateMistralEmbeddings(
      "https://api.mistral.ai/v1",
      "secret",
      "mistral-embed",
      ["first", "second"]
    );
    expect(result).toMatchObject({ success: false, errorCategory: category, errorScope: "operation" });
  });

  it("sends multiple inputs to Ollama /api/embed in one request", async () => {
    requestUrlMock.mockResolvedValue(response(200, { embeddings: [[1, 2, 3], [4, 5, 6]] }));
    const result = await generateOllamaEmbeddings(
      "http://localhost:11434",
      "nomic-embed-text",
      ["first", "second"],
      "native-batch"
    );

    expect(result).toMatchObject({ success: true, embeddings: [[1, 2, 3], [4, 5, 6]], requestCount: 1 });
    expect(requestUrl(requestUrlMock.mock.calls[0])).toContain("/api/embed");
    expect(requestBody(requestUrlMock.mock.calls[0]).input).toEqual(["first", "second"]);
  });

  it.each([
    [{ embeddings: [[1, 2, 3]] }, "invalid-response"],
    [{ embeddings: [[1, 2, 3], [4, 5]] }, "dimension-mismatch"],
    [{ embeddings: [[1, 2, 3], [4, Number.NaN, 6]] }, "invalid-vector"],
  ])("rejects an unsafe Ollama batch response", async (json, category) => {
    requestUrlMock.mockResolvedValue(response(200, json));
    const result = await generateOllamaEmbeddings(
      "http://localhost:11434",
      "nomic-embed-text",
      ["first", "second"],
      "native-batch"
    );
    expect(result).toMatchObject({ success: false, errorCategory: category, errorScope: "operation" });
  });

  it("builds deterministic contiguous Mistral batches including a partial last batch", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => mistralResponseForCall(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C", "D", "E"].map(makeChunk), {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      batchSize: 2,
      incremental: false,
    });

    expect(result).toMatchObject({ success: true, generated: 5, requestCount: 4 });
    const generationInputs = requestUrlMock.mock.calls.slice(1).map((call) => requestBody(call).input as string[]);
    expect(generationInputs.map((inputs) => inputs.length)).toEqual([2, 2, 1]);
    expect(generationInputs.flat().map((input) => input.match(/content ([A-Z])/)?.[1])).toEqual(["A", "B", "C", "D", "E"]);

    const records = adapter.getFile(".lina/index/embeddings.jsonl")?.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { path: string; embedding: number[] });
    expect(records?.map((record) => [record.path, record.embedding[0]])).toEqual([
      ["A.md", 1], ["B.md", 2], ["C.md", 3], ["D.md", 4], ["E.md", 5],
    ]);
    expect(Object.keys(records?.[0] ?? {}).sort()).toEqual([
      "chunkId",
      "createdAt",
      "dimensions",
      "embedding",
      "embeddingInputHash",
      "index",
      "model",
      "path",
      "provider",
      "textHash",
    ]);
  });

  it.each([
    [1, 3, 4],
    [10, 3, 2],
  ])("uses batch size %s for %s chunks", async (batchSize, total, expectedRequests) => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => mistralResponseForCall(args));
    const chunks = ["A", "B", "C"].slice(0, total).map(makeChunk);

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      batchSize,
      incremental: false,
    });

    expect(result).toMatchObject({ success: true, generated: total, requestCount: expectedRequests });
  });

  it("reads the configured batch size only once per operation", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => mistralResponseForCall(args));
    let reads = 0;
    const options = {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      incremental: false,
    };
    Object.defineProperty(options, "batchSize", {
      get: () => {
        reads++;
        return 2;
      },
    });

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C"].map(makeChunk), options);

    expect(result.success).toBe(true);
    expect(reads).toBe(1);
  });

  it("does not start the next batch before the current request completes", async () => {
    const adapter = new FakeAdapter();
    const activeBatch = createDeferred<unknown>();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => {
      if (requestUrlMock.mock.calls.length === 1) return mistralResponseForCall(args);
      if (requestUrlMock.mock.calls.length === 2) return await activeBatch.promise;
      return mistralResponseForCall(args);
    });

    const generation = generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C", "D"].map(makeChunk), {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      batchSize: 2,
      incremental: false,
    });

    await waitForCalls(requestUrlMock, 2);
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
    activeBatch.resolve(mistralResponseForCall(requestUrlMock.mock.calls[1]));
    await waitForCalls(requestUrlMock, 3);
    await generation;
  });

  it("reports monotonic progress per chunk after a native batch", async () => {
    const adapter = new FakeAdapter();
    const processed: number[] = [];
    requestUrlMock.mockImplementation(async (...args: unknown[]) => ollamaResponseForCall(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C"].map(makeChunk), {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      batchSize: 3,
      incremental: false,
      onProgress: (progress) => processed.push(progress.processedChunks),
    });

    expect(result.success).toBe(true);
    expect(processed).toEqual([0, 0, 1, 2, 3]);
    expect(processed.every((value, index) => index === 0 || value >= processed[index - 1])).toBe(true);
  });

  it("isolates one input-specific failure by deterministic left/right subdivision", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => {
      const body = requestBody(args);
      const inputs = body.input as string[];
      if (requestUrlMock.mock.calls.length > 1 && inputs.some((input) => input.includes("content D"))) {
        return response(413, { message: "payload too large" });
      }
      return mistralResponseForCall(args);
    });

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C", "D"].map(makeChunk), {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      batchSize: 4,
      incremental: false,
    });

    expect(result).toMatchObject({ success: true, outcome: "completed-with-partial-failures", generated: 3, failed: 1, requestCount: 6 });
    expect(requestUrlMock.mock.calls.slice(1).map((call) => (requestBody(call).input as string[]).length)).toEqual([4, 2, 2, 1, 1]);
  });

  it.each([401, 403, 404, 429, 500])("fails fast on global batch status %s without subdivision", async (status) => {
    const adapter = new FakeAdapter();
    requestUrlMock
      .mockImplementationOnce(async (...args: unknown[]) => mistralResponseForCall(args))
      .mockResolvedValue(response(status, { message: status === 404 ? "model not found" : "global failure" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C", "D"].map(makeChunk), {
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-embed",
      provider: "mistral",
      apiKey: "secret",
      timeoutMs: 60000,
      batchSize: 4,
      incremental: false,
    });

    expect(result).toMatchObject({ success: false, outcome: "generation-failed", requestCount: 2 });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("forces Ollama legacy generation to effective batch size one without retesting /api/embed", async () => {
    const adapter = new FakeAdapter();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => {
      const url = requestUrl(args);
      if (url.endsWith("/api/embed")) return response(404, { error: "endpoint not found" });
      const body = requestBody(args);
      return response(200, { embedding: vectorForInput(body.prompt as string) });
    });

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C"].map(makeChunk), {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      batchSize: 3,
      incremental: false,
    });

    expect(result).toMatchObject({ success: true, generated: 3, requestCount: 5 });
    expect(requestUrlMock.mock.calls.filter((call) => requestUrl(call).endsWith("/api/embed"))).toHaveLength(1);
    expect(requestUrlMock.mock.calls.slice(1).every((call) => requestUrl(call).endsWith("/api/embeddings"))).toBe(true);
    expect(requestUrlMock.mock.calls.slice(1).every((call) => typeof requestBody(call).prompt === "string")).toBe(true);
  });

  it("counts both Ollama validation requests when the legacy fallback times out", async () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
      clearTimeout: vi.fn(),
    });
    requestUrlMock
      .mockResolvedValueOnce(response(404, { error: "endpoint not found" }))
      .mockReturnValueOnce(new Promise(() => {}));

    const generation = generateOllamaEmbeddings(
      "http://localhost:11434",
      "nomic-embed-text",
      ["content A"],
      "auto",
      60000
    );

    await waitForCalls(requestUrlMock, 2);
    callbacks[1]();
    const result = await generation;

    expect(result).toMatchObject({ success: false, errorCategory: "timeout", requestCount: 2, fallbackUsed: true });
  });

  it("cancels during an active batch and never starts the next batch", async () => {
    const adapter = new FakeAdapter();
    const abortController = new AbortController();
    const activeBatch = createDeferred<unknown>();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => {
      if (requestUrlMock.mock.calls.length === 1) return ollamaResponseForCall(args);
      return await activeBatch.promise;
    });

    const generation = generateEmbeddingsForChunks(makeApp(adapter) as never, ["A", "B", "C", "D"].map(makeChunk), {
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      provider: "ollama",
      timeoutMs: 60000,
      batchSize: 2,
      incremental: false,
      abortSignal: abortController.signal,
    });

    await waitForCalls(requestUrlMock, 2);
    abortController.abort();
    activeBatch.resolve(ollamaResponseForCall(requestUrlMock.mock.calls[1]));
    const result = await generation;

    expect(result).toMatchObject({ success: false, outcome: "cancelled", generated: 2 });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
    expect(adapter.hasFile(".lina/index/embeddings.jsonl")).toBe(false);
    expect(adapter.hasFile(".lina/index/embeddings.checkpoint.jsonl")).toBe(true);
  });
});
