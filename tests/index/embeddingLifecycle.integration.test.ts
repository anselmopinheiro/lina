import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { Chunk } from "../../src/index/chunker";
import {
  EmbeddingRecord,
  GenerateEmbeddingsOptions,
  buildEmbeddingInput,
  generateEmbeddingsForChunks,
  getPrefixModeForModel,
  readExistingEmbeddings,
} from "../../src/index/embeddingGenerator";
import { EMBEDDING_PERSISTENCE_FILES } from "../../src/index/embeddingPersistence";
import {
  EmbeddingOperationManager,
  EmbeddingOperationRequestResult,
} from "../../src/index/embeddingOperationManager";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import { hashContent } from "../../src/index/noteHasher";
import { IndexedNote } from "../../src/index/indexStore";
import { runHybridSearch } from "../../src/search/hybridSearch";
import { searchSemanticIndex } from "../../src/search/semanticSearch";
import { searchTextIndex } from "../../src/search/textSearch";
import { FakeAdapter } from "../helpers/fakeAdapter";

const PROVIDER = "mistral";
const MODEL = "mistral-embed";
const DIMENSIONS = 3;
const files = EMBEDDING_PERSISTENCE_FILES;

function makeApp(adapter: FakeAdapter): { vault: { adapter: FakeAdapter } } {
  return { vault: { adapter } };
}

function makeChunk(index: number, text = `alpha lifecycle content ${index}`): Chunk {
  const path = `Notes/Note-${index}.md`;
  return {
    chunkId: `${path}::0`,
    path,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function makeNote(chunk: Chunk): IndexedNote {
  const basename = chunk.path.split("/").pop()?.replace(/\.md$/, "") ?? chunk.path;
  return {
    path: chunk.path,
    basename,
    extension: "md",
    size: chunk.text.length,
    mtime: 1,
    contentHash: chunk.textHash,
    indexedAt: "2026-07-16T00:00:00.000Z",
  };
}

function makeRecord(chunk: Chunk): EmbeddingRecord {
  return {
    chunkId: chunk.chunkId,
    path: chunk.path,
    index: chunk.chunkIndex,
    textHash: chunk.textHash,
    model: MODEL,
    provider: PROVIDER,
    dimensions: DIMENSIONS,
    embedding: [1, 0, 0],
    createdAt: "2026-07-16T00:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, getPrefixModeForModel(MODEL))),
  };
}

function textManifest(): Record<string, unknown> {
  return {
    version: 1,
    indexType: "text",
    embeddingsEnabled: false,
    updatedAt: "2026-07-16T00:00:00.000Z",
    totalNotes: 5,
    totalChunks: 5,
  };
}

function embeddingManifest(records: EmbeddingRecord[]): Record<string, unknown> {
  return {
    ...textManifest(),
    embeddingsEnabled: true,
    embeddings: {
      enabled: true,
      provider: PROVIDER,
      model: MODEL,
      totalEmbeddings: records.length,
      dimensions: DIMENSIONS,
      updatedAt: "2026-07-16T00:00:00.000Z",
      sourceTotalChunks: records.length,
    },
    embeddingInput: {
      version: 1,
      prefixMode: "none",
    },
  };
}

function recordsContent(records: EmbeddingRecord[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function seedTextManifest(adapter: FakeAdapter): void {
  adapter.setFile(files.canonicalManifest, JSON.stringify(textManifest()));
}

function seedCanonical(adapter: FakeAdapter, records: EmbeddingRecord[]): void {
  adapter.setFile(files.canonicalEmbeddings, recordsContent(records));
  adapter.setFile(files.canonicalManifest, JSON.stringify(embeddingManifest(records)));
}

function responseForInputs(call: unknown[]): unknown {
  const body = JSON.parse((call[0] as { body?: string }).body ?? "{}") as { input?: unknown };
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  return {
    status: 200,
    json: {
      data: inputs.map((_input, index) => ({ index, embedding: [1, 0, 0] })),
    },
  };
}

function generationOptions(overrides: Partial<GenerateEmbeddingsOptions> = {}): GenerateEmbeddingsOptions {
  return {
    baseUrl: "https://api.mistral.ai/v1",
    model: MODEL,
    provider: PROVIDER,
    apiKey: "test-key",
    timeoutMs: 60000,
    batchSize: 2,
    incremental: true,
    operationId: "integration-operation",
    ...overrides,
  };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function waitForCalls(mock: ReturnType<typeof vi.spyOn>, count: number): Promise<void> {
  for (let index = 0; index < 200 && mock.mock.calls.length < count; index++) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledTimes(count);
}

function requestLifecycle(
  manager: EmbeddingOperationManager,
  coordinator: IndexWriteCoordinator,
  adapter: FakeAdapter,
  chunks: Chunk[],
  options: Partial<GenerateEmbeddingsOptions> = {}
): EmbeddingOperationRequestResult {
  expect(coordinator.requestEmbeddingGenerationPreparation().status).toBe("accepted");

  return manager.request("command", async (operation) => {
    const activation = coordinator.startEmbeddingGeneration();
    if (activation.status !== "accepted" || !activation.token) {
      coordinator.cancelEmbeddingGenerationPreparation();
      return { success: false, message: "coordination failed" };
    }

    try {
      operation.setPhase("validating", "Validating provider");
      const result = await generateEmbeddingsForChunks(
        makeApp(adapter) as never,
        chunks,
        generationOptions({
          ...options,
          abortSignal: operation.signal,
          onProgress: (progress) => {
            operation.setPhase("generating", "Generating embeddings");
            operation.setProgress(progress);
          },
          onPersisting: () => operation.setPhase("persisting", "Publishing embeddings"),
        })
      );

      if (result.outcome === "cancelled") {
        return { success: false, message: "Cancelled", cancelled: true };
      }
      return { success: result.success, message: result.success ? "Completed" : "Failed" };
    } finally {
      coordinator.finish(activation.token);
    }
  });
}

async function complete(request: EmbeddingOperationRequestResult) {
  expect(request.status).toBe("accepted");
  if (request.status !== "accepted") {
    throw new Error("Expected an accepted embedding operation.");
  }
  return await request.completion;
}

describe("integrated persistent embedding lifecycle", () => {
  let requestUrlMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
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

  it("runs validation, sequential batches, checkpoints, canonical publication and all search modes", async () => {
    const adapter = new FakeAdapter();
    const chunks = Array.from({ length: 5 }, (_value, index) => makeChunk(index));
    const manager = new EmbeddingOperationManager();
    const coordinator = new IndexWriteCoordinator();
    const states: number[] = [];
    seedTextManifest(adapter);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => responseForInputs(args));
    manager.subscribe((state) => states.push(state.processedChunks));

    const completion = await complete(requestLifecycle(manager, coordinator, adapter, chunks));

    expect(completion.state).toMatchObject({ status: "completed", phase: "completed", processedChunks: 5 });
    expect(requestUrlMock).toHaveBeenCalledTimes(4); // one validation + three sequential generation batches
    expect(states.every((value, index) => index === 0 || value >= states[index - 1])).toBe(true);
    expect(adapter.writtenPaths.filter((path) => path === files.checkpointTemporary)).toHaveLength(3);
    expect(adapter.hasFile(files.checkpoint)).toBe(false);
    expect(adapter.hasFile(files.checkpointMetadata)).toBe(false);
    expect(coordinator.getState()).toMatchObject({ activeOperation: null, embeddingGenerationRequested: false });

    const canonical = [...(await readExistingEmbeddings(makeApp(adapter) as never)).values()];
    const manifest = JSON.parse(adapter.getFile(files.canonicalManifest) ?? "{}") as Record<string, unknown>;
    expect(canonical).toHaveLength(5);
    expect(manifest).toMatchObject({
      embeddingsEnabled: true,
      embeddings: { provider: PROVIDER, model: MODEL, totalEmbeddings: 5, dimensions: DIMENSIONS },
    });

    const notes = chunks.map(makeNote);
    expect(searchTextIndex(notes, chunks, "alpha")).not.toHaveLength(0);
    expect(searchSemanticIndex([1, 0, 0], canonical, chunks)).not.toHaveLength(0);

    const hybrid = await runHybridSearch(makeApp(adapter) as never, notes, chunks, "alpha lifecycle", {
      baseUrl: "https://api.mistral.ai/v1",
      model: MODEL,
      timeoutMs: 60000,
      apiKey: "test-key",
      textWeight: 0.7,
      semanticWeight: 0.3,
      deviceProvider: PROVIDER,
      deviceModel: MODEL,
    });
    expect(hybrid.semanticUsed).toBe(true);
    expect(hybrid.results.some((result) => result.source === "hibrida")).toBe(true);
    expect(requestUrlMock).toHaveBeenCalledTimes(5); // includes the query embedding

    const rebuild = coordinator.startTextRebuild();
    expect(rebuild.status).toBe("accepted");
    if (rebuild.status === "accepted") coordinator.finish(rebuild.token);
  });

  it("cancels after confirmed batches, preserves the canonical state and resumes from the checkpoint", async () => {
    const adapter = new FakeAdapter();
    const chunks = Array.from({ length: 5 }, (_value, index) => makeChunk(index));
    const previousCanonical = recordsContent([makeRecord(chunks[0])]);
    const coordinator = new IndexWriteCoordinator();
    const manager = new EmbeddingOperationManager();
    const activeBatch = createDeferred<unknown>();
    seedCanonical(adapter, [makeRecord(chunks[0])]);
    requestUrlMock
      .mockImplementationOnce(async (...args: unknown[]) => responseForInputs(args))
      .mockImplementationOnce(async (...args: unknown[]) => responseForInputs(args))
      .mockReturnValueOnce(activeBatch.promise);

    const first = requestLifecycle(manager, coordinator, adapter, chunks);
    await waitForCalls(requestUrlMock, 3);
    expect(manager.cancelActiveOperation()).toBe("cancel-requested");
    activeBatch.resolve(responseForInputs(requestUrlMock.mock.calls[2]));
    const cancelled = await complete(first);

    expect(cancelled.state.status).toBe("cancelled");
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(previousCanonical);
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
    expect(adapter.hasFile(files.checkpointMetadata)).toBe(true);
    expect(coordinator.getState().activeOperation).toBeNull();

    requestUrlMock.mockClear();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => responseForInputs(args));
    const resumed = await complete(requestLifecycle(manager, coordinator, adapter, chunks));

    expect(resumed.state.status).toBe("completed");
    expect(requestUrlMock).toHaveBeenCalledTimes(1); // validation only; confirmed checkpoint chunks are not regenerated
    expect([...(await readExistingEmbeddings(makeApp(adapter) as never)).values()]).toHaveLength(5);
    expect(adapter.hasFile(files.checkpoint)).toBe(false);
    expect(adapter.hasFile(files.checkpointMetadata)).toBe(false);
  });

  it("keeps a checkpoint after a global provider failure and completes a later retry", async () => {
    const adapter = new FakeAdapter();
    const chunks = Array.from({ length: 5 }, (_value, index) => makeChunk(index));
    const previousCanonical = recordsContent([makeRecord(chunks[0])]);
    const coordinator = new IndexWriteCoordinator();
    const manager = new EmbeddingOperationManager();
    seedCanonical(adapter, [makeRecord(chunks[0])]);
    requestUrlMock
      .mockImplementationOnce(async (...args: unknown[]) => responseForInputs(args))
      .mockImplementationOnce(async (...args: unknown[]) => responseForInputs(args))
      .mockResolvedValueOnce({ status: 503, json: { message: "temporarily unavailable" } });

    const failed = await complete(requestLifecycle(manager, coordinator, adapter, chunks));

    expect(failed.state.status).toBe("failed");
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(previousCanonical);
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
    expect(coordinator.getState().activeOperation).toBeNull();

    requestUrlMock.mockClear();
    requestUrlMock.mockImplementation(async (...args: unknown[]) => responseForInputs(args));
    const resumed = await complete(requestLifecycle(manager, coordinator, adapter, chunks));

    expect(resumed.state.status).toBe("completed");
    expect(requestUrlMock).toHaveBeenCalledTimes(2); // validation + the one missing generation batch
    expect([...(await readExistingEmbeddings(makeApp(adapter) as never)).values()]).toHaveLength(5);
    expect(adapter.hasFile(files.checkpoint)).toBe(false);
  });
});
