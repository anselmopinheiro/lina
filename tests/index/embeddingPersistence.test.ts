import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { Chunk } from "../../src/index/chunker";
import {
  EMBEDDING_INPUT_VERSION,
  EmbeddingRecord,
  buildEmbeddingInput,
  generateEmbeddingsForChunks,
  getEmbeddingInputFormatVersion,
  getPrefixModeForModel,
  readExistingEmbeddings,
} from "../../src/index/embeddingGenerator";
import {
  EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
  EMBEDDING_PERSISTENCE_FILES,
  EmbeddingCheckpointMetadata,
  loadEmbeddingCheckpoint,
  publishCanonicalEmbeddings,
  recoverEmbeddingPersistenceArtifacts,
  validateCanonicalEmbeddingIndex,
  writeEmbeddingCheckpoint,
} from "../../src/index/embeddingPersistence";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import { hashContent } from "../../src/index/noteHasher";
import { FakeAdapter } from "../helpers/fakeAdapter";

const MODEL = "mistral-embed";
const PROVIDER = "mistral";
const DIMENSIONS = 3;
const INPUT_FORMAT_VERSION = `${EMBEDDING_INPUT_VERSION}:none`;
const files = EMBEDDING_PERSISTENCE_FILES;

function makeApp(adapter: FakeAdapter): { vault: { adapter: FakeAdapter } } {
  return { vault: { adapter } };
}

function makeChunk(name: string, text: string = `content ${name}`): Chunk {
  const path = `${name}.md`;
  return {
    chunkId: `${path}::0`,
    path,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function makeRecord(
  chunk: Chunk,
  overrides: Partial<EmbeddingRecord> = {}
): EmbeddingRecord {
  const model = overrides.model ?? MODEL;
  const prefixMode = getPrefixModeForModel(model);
  return {
    chunkId: chunk.chunkId,
    path: chunk.path,
    index: chunk.chunkIndex,
    textHash: chunk.textHash,
    model,
    provider: PROVIDER,
    dimensions: DIMENSIONS,
    embedding: [1, 2, 3],
    createdAt: "2026-07-16T00:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, prefixMode)),
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<EmbeddingCheckpointMetadata> = {}): EmbeddingCheckpointMetadata {
  return {
    schemaVersion: EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
    operationId: "operation-1",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    provider: PROVIDER,
    model: MODEL,
    dimension: DIMENSIONS,
    inputFormatVersion: INPUT_FORMAT_VERSION,
    completedRecords: 0,
    ...overrides,
  };
}

function recordsContent(records: EmbeddingRecord[], trailingNewline: boolean = true): string {
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  return trailingNewline && content.length > 0 ? `${content}\n` : content;
}

function makeTextManifest(): Record<string, unknown> {
  return {
    version: 1,
    indexType: "text",
    embeddingsEnabled: false,
    updatedAt: "2026-07-16T00:00:00.000Z",
    totalNotes: 1,
    totalChunks: 1,
  };
}

function makeEmbeddingManifest(records: EmbeddingRecord[]): Record<string, unknown> {
  const first = records[0];
  return {
    ...makeTextManifest(),
    embeddingsEnabled: true,
    embeddings: {
      enabled: true,
      provider: first?.provider ?? PROVIDER,
      model: first?.model ?? MODEL,
      totalEmbeddings: records.length,
      dimensions: first?.dimensions ?? DIMENSIONS,
      updatedAt: "2026-07-16T00:00:00.000Z",
      sourceTotalChunks: records.length,
    },
    embeddingInput: {
      version: EMBEDDING_INPUT_VERSION,
      prefixMode: "none",
    },
  };
}

function seedTextManifest(adapter: FakeAdapter): void {
  adapter.setFile(files.canonicalManifest, JSON.stringify(makeTextManifest()));
}

function seedCheckpoint(
  adapter: FakeAdapter,
  records: EmbeddingRecord[],
  metadataOverrides: Partial<EmbeddingCheckpointMetadata> = {},
  trailingNewline: boolean = true
): void {
  adapter.setFile(files.checkpoint, recordsContent(records, trailingNewline));
  adapter.setFile(files.checkpointMetadata, JSON.stringify(makeMetadata({
    completedRecords: records.length,
    ...metadataOverrides,
  })));
}

function seedCanonical(adapter: FakeAdapter, records: EmbeddingRecord[], trailingNewline: boolean = true): void {
  adapter.setFile(files.canonicalEmbeddings, recordsContent(records, trailingNewline));
  adapter.setFile(files.canonicalManifest, JSON.stringify(makeEmbeddingManifest(records)));
}

function checkpointIdentity(overrides: Partial<{
  provider: string;
  model: string;
  dimension: number;
  inputFormatVersion: string;
}> = {}) {
  return {
    provider: PROVIDER,
    model: MODEL,
    dimension: DIMENSIONS,
    inputFormatVersion: INPUT_FORMAT_VERSION,
    ...overrides,
  };
}

function publicationInfo() {
  return {
    provider: PROVIDER,
    model: MODEL,
    dimensions: DIMENSIONS,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode: "none",
  };
}

function requestResponse(status: number, json: unknown): unknown {
  return { status, json };
}

function requestBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[0] as { body?: string }).body ?? "{}") as Record<string, unknown>;
}

function successfulMistralResponse(call: unknown[]): unknown {
  const input = requestBody(call).input;
  const inputs = Array.isArray(input) ? input : [input];
  return requestResponse(200, {
    data: inputs.map((_item, index) => ({ index, embedding: [1, 2, 3] })),
  });
}

function generationOptions(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: "https://api.mistral.ai/v1",
    model: MODEL,
    provider: PROVIDER,
    apiKey: "test-key",
    timeoutMs: 60000,
    batchSize: 1,
    incremental: true,
    operationId: "operation-test",
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
  for (let index = 0; index < 150 && mock.mock.calls.length < count; index++) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledTimes(count);
}

describe("embedding checkpoint persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("writes a validated checkpoint after the first completed batch", async () => {
    const adapter = new FakeAdapter();
    const record = makeRecord(makeChunk("A"));
    await writeEmbeddingCheckpoint(makeApp(adapter) as never, makeMetadata(), [record]);

    expect(adapter.hasFile(files.checkpoint)).toBe(true);
    expect(adapter.hasFile(files.checkpointMetadata)).toBe(true);
    expect((await loadEmbeddingCheckpoint(makeApp(adapter) as never, checkpointIdentity())).status).toBe("available");
  });

  it("rewrites the complete checkpoint after multiple batches", async () => {
    const adapter = new FakeAdapter();
    const first = makeRecord(makeChunk("A"));
    const second = makeRecord(makeChunk("B"));
    const app = makeApp(adapter) as never;
    const metadata = await writeEmbeddingCheckpoint(app, makeMetadata(), [first]);
    await writeEmbeddingCheckpoint(app, metadata, [first, second]);

    const loaded = await loadEmbeddingCheckpoint(app, checkpointIdentity());
    expect(loaded).toMatchObject({ status: "available", records: [{ chunkId: first.chunkId }, { chunkId: second.chunkId }] });
  });

  it("publishes the sidecar only after the checkpoint JSONL", async () => {
    const adapter = new FakeAdapter();
    await writeEmbeddingCheckpoint(makeApp(adapter) as never, makeMetadata(), [makeRecord(makeChunk("A"))]);

    expect(adapter.renamedTo.indexOf(files.checkpoint)).toBeLessThan(adapter.renamedTo.indexOf(files.checkpointMetadata));
  });

  it("reads and validates the temporary JSONL before replacing the checkpoint", async () => {
    const adapter = new FakeAdapter();
    let temporaryWasRead = false;
    adapter.setOptions({
      beforeOperation: (operation, path) => {
        if (operation === "read" && path === files.checkpointTemporary) {
          temporaryWasRead = true;
        }
        if (operation === "rename" && path === files.checkpointTemporary) {
          expect(temporaryWasRead).toBe(true);
        }
      },
    });
    await writeEmbeddingCheckpoint(makeApp(adapter) as never, makeMetadata(), [makeRecord(makeChunk("A"))]);

    expect(temporaryWasRead).toBe(true);
  });

  it("keeps the previous checkpoint when the temporary write fails", async () => {
    const oldRecord = makeRecord(makeChunk("A"));
    const adapter = new FakeAdapter();
    seedCheckpoint(adapter, [oldRecord]);
    adapter.setOptions({ shouldFail: (operation, path) => operation === "write" && path === files.checkpointTemporary });

    await expect(writeEmbeddingCheckpoint(
      makeApp(adapter) as never,
      makeMetadata(),
      [oldRecord, makeRecord(makeChunk("B"))]
    )).rejects.toThrow();
    expect(adapter.getFile(files.checkpoint)).toBe(recordsContent([oldRecord]));
  });

  it("keeps the previous checkpoint when temporary validation fails", async () => {
    const oldRecord = makeRecord(makeChunk("A"));
    const adapter = new FakeAdapter();
    seedCheckpoint(adapter, [oldRecord]);
    let corrupted = false;
    adapter.setOptions({
      beforeOperation: (operation, path) => {
        if (!corrupted && operation === "read" && path === files.checkpointTemporary) {
          corrupted = true;
          adapter.setFile(path, "{\"truncated\":");
        }
      },
    });

    await expect(writeEmbeddingCheckpoint(
      makeApp(adapter) as never,
      makeMetadata(),
      [oldRecord, makeRecord(makeChunk("B"))]
    )).rejects.toThrow();
    expect(adapter.getFile(files.checkpoint)).toBe(recordsContent([oldRecord]));
  });

  it("rejects a checkpoint with a truncated final line", async () => {
    const adapter = new FakeAdapter();
    seedCheckpoint(adapter, [makeRecord(makeChunk("A"))], {}, false);

    const loaded = await loadEmbeddingCheckpoint(makeApp(adapter) as never, checkpointIdentity());
    expect(loaded).toMatchObject({ status: "ignored", reason: "truncated-last-line" });
  });

  it("does not expose checkpoint records through the canonical reader used by search", async () => {
    const adapter = new FakeAdapter();
    seedCheckpoint(adapter, [makeRecord(makeChunk("A"))]);

    const records = await readExistingEmbeddings(makeApp(adapter) as never);
    expect(records.size).toBe(0);
    expect(adapter.readPaths).not.toContain(files.checkpoint);
  });

  it("updates completedRecords to the validated JSONL count", async () => {
    const adapter = new FakeAdapter();
    const records = [makeRecord(makeChunk("A")), makeRecord(makeChunk("B"))];
    await writeEmbeddingCheckpoint(makeApp(adapter) as never, makeMetadata({ completedRecords: 99 }), records);

    const metadata = JSON.parse(adapter.getFile(files.checkpointMetadata) ?? "{}") as EmbeddingCheckpointMetadata;
    expect(metadata.completedRecords).toBe(2);
  });

  it("does not store note text, API keys or vectors in the sidecar", async () => {
    const adapter = new FakeAdapter();
    await writeEmbeddingCheckpoint(makeApp(adapter) as never, makeMetadata(), [makeRecord(makeChunk("A", "private note"))]);

    const sidecar = adapter.getFile(files.checkpointMetadata) ?? "";
    expect(sidecar).not.toContain("private note");
    expect(sidecar).not.toContain("test-key");
    expect(sidecar).not.toContain("[1,2,3]");
  });
});

describe("embedding checkpoint compatibility and resume", () => {
  let requestUrlMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
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
    ["provider", { provider: "ollama" }],
    ["model", { model: "other-model" }],
    ["dimension", { dimension: 4 }],
    ["input version", { inputFormatVersion: "2:none" }],
  ])("does not reuse a checkpoint with a different %s", async (_label, identityOverride) => {
    const adapter = new FakeAdapter();
    seedCheckpoint(adapter, [makeRecord(makeChunk("A"))]);

    const loaded = await loadEmbeddingCheckpoint(makeApp(adapter) as never, checkpointIdentity(identityOverride));
    expect(loaded).toMatchObject({ status: "ignored", reason: "incompatible-checkpoint" });
  });

  it("reuses a checkpoint record only by matching chunkId and textHash", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(chunks[0])]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions());
    expect(result).toMatchObject({ success: true, kept: 1, generated: 1, requestCount: 2 });
  });

  it("does not reuse the same chunkId when textHash changed", async () => {
    const adapter = new FakeAdapter();
    const oldChunk = makeChunk("A", "old text");
    const currentChunk = makeChunk("A", "new text");
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(oldChunk)]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [currentChunk], generationOptions());
    expect(result).toMatchObject({ success: true, kept: 0, generated: 1, requestCount: 2 });
  });

  it("does not reuse a record when embeddingInputHash changed", async () => {
    const adapter = new FakeAdapter();
    const chunk = makeChunk("A");
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(chunk, { embeddingInputHash: "old-input" })]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [chunk], generationOptions());
    expect(result).toMatchObject({ success: true, kept: 0, generated: 1 });
  });

  it("does not reuse a canonical record whose input hash no longer matches the current input format", async () => {
    const adapter = new FakeAdapter();
    const chunk = makeChunk("A");
    seedCanonical(adapter, [makeRecord(chunk, { embeddingInputHash: "stale-canonical-input" })]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [chunk], generationOptions());

    expect(result).toMatchObject({ success: true, kept: 0, generated: 1, requestCount: 2 });
  });

  it("reuses only compatible records from a partially compatible checkpoint", async () => {
    const adapter = new FakeAdapter();
    const currentA = makeChunk("A");
    const oldB = makeChunk("B", "old");
    const currentB = makeChunk("B", "new");
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(currentA), makeRecord(oldB)]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [currentA, currentB], generationOptions());
    expect(result).toMatchObject({ success: true, kept: 1, generated: 1 });
  });

  it("treats a checkpoint without sidecar as an orphan", async () => {
    const adapter = new FakeAdapter();
    adapter.setFile(files.checkpoint, recordsContent([makeRecord(makeChunk("A"))]));
    const result = await loadEmbeddingCheckpoint(makeApp(adapter) as never, checkpointIdentity());
    expect(result).toMatchObject({ status: "ignored", reason: "orphaned-checkpoint" });
  });

  it("treats a sidecar without checkpoint as an orphan", async () => {
    const adapter = new FakeAdapter();
    adapter.setFile(files.checkpointMetadata, JSON.stringify(makeMetadata()));
    const result = await loadEmbeddingCheckpoint(makeApp(adapter) as never, checkpointIdentity());
    expect(result).toMatchObject({ status: "ignored", reason: "orphaned-checkpoint" });
  });

  it("ignores an invalid sidecar without blocking future generation", async () => {
    const adapter = new FakeAdapter();
    const chunk = makeChunk("A");
    seedTextManifest(adapter);
    adapter.setFile(files.checkpoint, recordsContent([makeRecord(chunk)]));
    adapter.setFile(files.checkpointMetadata, "not-json");
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [chunk], generationOptions());
    expect(result).toMatchObject({ success: true, generated: 1 });
  });

  it("does not call the provider for chunks reused from the checkpoint", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    seedTextManifest(adapter);
    seedCheckpoint(adapter, chunks.map((chunk) => makeRecord(chunk)));
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions());
    expect(result).toMatchObject({ success: true, kept: 2, generated: 0, requestCount: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("includes checkpoint records in reused progress without counting them as generated", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    const updates: Array<{ reusedChunks: number; generatedChunks: number }> = [];
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(chunks[0])]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions({
      onProgress: (progress: { reusedChunks: number; generatedChunks: number }) => updates.push(progress),
    }));
    expect(updates).toContainEqual(expect.objectContaining({ reusedChunks: 1, generatedChunks: 0 }));
  });

  it("removes checkpoint and sidecar only after final publication succeeds", async () => {
    const adapter = new FakeAdapter();
    const chunk = makeChunk("A");
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(chunk)]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [chunk], generationOptions());
    expect(result.success).toBe(true);
    expect(adapter.hasFile(files.checkpoint)).toBe(false);
    expect(adapter.hasFile(files.checkpointMetadata)).toBe(false);
  });

  it("keeps checkpoint after final publication fails", async () => {
    const adapter = new FakeAdapter();
    const chunk = makeChunk("A");
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(chunk)]);
    adapter.setOptions({
      shouldFail: (operation, path) => operation === "write" && path === files.manifestPublishTemporary,
    });
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [chunk], generationOptions());
    expect(result).toMatchObject({ success: false, outcome: "generation-failed" });
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
  });

  it("invalidates only the checkpoint chunk whose note text changed", async () => {
    const adapter = new FakeAdapter();
    const currentA = makeChunk("A");
    const oldB = makeChunk("B", "before");
    const currentB = makeChunk("B", "after");
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [makeRecord(currentA), makeRecord(oldB)]);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, [currentA, currentB], generationOptions());
    expect(result).toMatchObject({ success: true, kept: 1, generated: 1, requestCount: 2 });
  });

  it("preserves a completed active batch when cancellation arrives before the request resolves", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    const controller = new AbortController();
    const active = createDeferred<unknown>();
    seedTextManifest(adapter);
    requestUrlMock
      .mockImplementationOnce(async (...args: unknown[]) => successfulMistralResponse(args))
      .mockReturnValueOnce(active.promise);

    const generation = generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions({
      abortSignal: controller.signal,
    }));
    await waitForCalls(requestUrlMock, 2);
    controller.abort();
    active.resolve(successfulMistralResponse(requestUrlMock.mock.calls[1]));
    const result = await generation;

    expect(result).toMatchObject({ outcome: "cancelled", generated: 1 });
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the last checkpoint after a later global provider failure", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    seedTextManifest(adapter);
    requestUrlMock
      .mockImplementationOnce(async (...args: unknown[]) => successfulMistralResponse(args))
      .mockImplementationOnce(async (...args: unknown[]) => successfulMistralResponse(args))
      .mockResolvedValueOnce(requestResponse(500, { message: "down" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions());
    expect(result).toMatchObject({ outcome: "generation-failed", generated: 1 });
    const checkpoint = await loadEmbeddingCheckpoint(makeApp(adapter) as never, checkpointIdentity());
    expect(checkpoint).toMatchObject({ status: "available", records: [{ chunkId: chunks[0].chunkId }] });
  });

  it("checkpoints valid work produced by a terminal batch subdivision", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    const controller = new AbortController();
    seedTextManifest(adapter);
    requestUrlMock.mockImplementation(async (...args: unknown[]) => {
      const inputs = requestBody(args).input as string[];
      if (requestUrlMock.mock.calls.length === 1) return successfulMistralResponse(args);
      if (inputs.length === 2) return requestResponse(413, { message: "too large" });
      return successfulMistralResponse(args);
    });

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions({
      batchSize: 2,
      abortSignal: controller.signal,
      onProgress: (progress: { generatedChunks: number }) => {
        if (progress.generatedChunks === 1) controller.abort();
      },
    }));

    expect(result).toMatchObject({ outcome: "cancelled", generated: 1 });
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
  });

  it("finishes a critical checkpoint after cancellation and starts no next batch", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    const controller = new AbortController();
    const checkpointGate = createDeferred<void>();
    seedTextManifest(adapter);
    adapter.setOptions({
      beforeOperation: async (operation, path) => {
        if (operation === "write" && path === files.checkpointTemporary) {
          await checkpointGate.promise;
        }
      },
    });
    requestUrlMock.mockImplementation(async (...args: unknown[]) => successfulMistralResponse(args));

    const generation = generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions({
      abortSignal: controller.signal,
    }));
    await waitForCalls(requestUrlMock, 2);
    controller.abort();
    checkpointGate.resolve();
    const result = await generation;

    expect(result).toMatchObject({ outcome: "cancelled", generated: 1 });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
  });

  it("does not replace the previous canonical index on a global generation failure", async () => {
    const adapter = new FakeAdapter();
    const oldRecord = makeRecord(makeChunk("Old"));
    const chunks = [makeChunk("A"), makeChunk("B")];
    seedCanonical(adapter, [oldRecord]);
    requestUrlMock
      .mockImplementationOnce(async (...args: unknown[]) => successfulMistralResponse(args))
      .mockImplementationOnce(async (...args: unknown[]) => successfulMistralResponse(args))
      .mockResolvedValueOnce(requestResponse(500, { message: "down" }));

    const result = await generateEmbeddingsForChunks(makeApp(adapter) as never, chunks, generationOptions());
    expect(result.outcome).toBe("generation-failed");
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([oldRecord]));
  });

  it("stops subdivision before the next provider request when checkpoint writing fails", async () => {
    const adapter = new FakeAdapter();
    const chunks = [makeChunk("A"), makeChunk("B")];
    let checkpointWriteFailed = false;
    seedTextManifest(adapter);
    adapter.setOptions({
      shouldFail: (operation, path) => {
        if (!checkpointWriteFailed && operation === "write" && path === files.checkpointTemporary) {
          checkpointWriteFailed = true;
          return true;
        }
        return false;
      },
    });
    requestUrlMock.mockImplementation(async (...args: unknown[]) => {
      const inputs = requestBody(args).input as string[];
      if (requestUrlMock.mock.calls.length === 2 && inputs.length === 2) {
        return requestResponse(413, { message: "too large" });
      }
      return successfulMistralResponse(args);
    });

    const result = await generateEmbeddingsForChunks(
      makeApp(adapter) as never,
      chunks,
      generationOptions({ batchSize: 2 })
    );

    expect(result).toMatchObject({ outcome: "generation-failed", generated: 0 });
    expect(requestUrlMock).toHaveBeenCalledTimes(3);
    expect(adapter.hasFile(files.canonicalEmbeddings)).toBe(false);
  });
});

describe("canonical embedding publication and rollback", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes and validates the complete publication candidate", async () => {
    const adapter = new FakeAdapter();
    const records = [makeRecord(makeChunk("A")), makeRecord(makeChunk("B"))];
    seedTextManifest(adapter);
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, records, publicationInfo());

    expect(result.success).toBe(true);
    expect(await validateCanonicalEmbeddingIndex(makeApp(adapter) as never)).toBe(true);
  });

  it("creates the embeddings backup before replacing the canonical file", async () => {
    const adapter = new FakeAdapter();
    seedCanonical(adapter, [makeRecord(makeChunk("Old"))]);
    await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(adapter.renamedFrom.indexOf(files.canonicalEmbeddings)).toBeLessThan(
      adapter.renamedFrom.indexOf(files.embeddingsPublishTemporary)
    );
  });

  it("publishes the manifest after the embeddings candidate", async () => {
    const adapter = new FakeAdapter();
    seedCanonical(adapter, [makeRecord(makeChunk("Old"))]);
    await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(adapter.renamedTo.indexOf(files.canonicalEmbeddings)).toBeLessThan(
      adapter.renamedTo.indexOf(files.canonicalManifest)
    );
  });

  it("removes publication backups after complete success", async () => {
    const adapter = new FakeAdapter();
    seedCanonical(adapter, [makeRecord(makeChunk("Old"))]);
    await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(adapter.hasFile(files.embeddingsPublishBackup)).toBe(false);
    expect(adapter.hasFile(files.manifestPublishBackup)).toBe(false);
  });

  it("removes a valid checkpoint after complete success", async () => {
    const adapter = new FakeAdapter();
    const record = makeRecord(makeChunk("A"));
    seedTextManifest(adapter);
    seedCheckpoint(adapter, [record]);
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [record], publicationInfo());

    expect(result.success).toBe(true);
    expect(adapter.hasFile(files.checkpoint)).toBe(false);
    expect(adapter.hasFile(files.checkpointMetadata)).toBe(false);
  });

  it("keeps the previous canonical state when candidate creation fails", async () => {
    const adapter = new FakeAdapter();
    const oldRecord = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [oldRecord]);
    adapter.setOptions({ shouldFail: (operation, path) => operation === "write" && path === files.embeddingsPublishTemporary });
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(result.success).toBe(false);
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([oldRecord]));
  });

  it("keeps the previous canonical state when candidate validation fails", async () => {
    const adapter = new FakeAdapter();
    const oldRecord = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [oldRecord]);
    let corrupted = false;
    adapter.setOptions({
      beforeOperation: (operation, path) => {
        if (!corrupted && operation === "read" && path === files.embeddingsPublishTemporary) {
          corrupted = true;
          adapter.setFile(path, "{\"truncated\":");
        }
      },
    });
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(result.success).toBe(false);
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([oldRecord]));
  });

  it("rolls back when replacing the embeddings candidate fails", async () => {
    const adapter = new FakeAdapter();
    const oldRecord = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [oldRecord]);
    let failed = false;
    adapter.setOptions({
      shouldFail: (operation, path, target) => {
        if (!failed && operation === "rename" && path === files.embeddingsPublishTemporary && target === files.canonicalEmbeddings) {
          failed = true;
          return true;
        }
        return false;
      },
    });
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(result).toMatchObject({ success: false, rollbackSucceeded: true });
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([oldRecord]));
  });

  it("rolls back embeddings when publishing the manifest fails", async () => {
    const adapter = new FakeAdapter();
    const oldRecord = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [oldRecord]);
    let failed = false;
    adapter.setOptions({
      shouldFail: (operation, path, target) => {
        if (!failed && operation === "rename" && path === files.manifestPublishTemporary && target === files.canonicalManifest) {
          failed = true;
          return true;
        }
        return false;
      },
    });
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(result).toMatchObject({ success: false, rollbackSucceeded: true });
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([oldRecord]));
    expect(await validateCanonicalEmbeddingIndex(makeApp(adapter) as never)).toBe(true);
  });

  it("rolls back when validation of the published manifest fails", async () => {
    const adapter = new FakeAdapter();
    const oldRecord = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [oldRecord]);
    let corrupted = false;
    adapter.setOptions({
      beforeOperation: (operation, path) => {
        if (
          !corrupted
          && operation === "read"
          && path === files.canonicalManifest
          && adapter.hasFile(files.manifestPublishBackup)
        ) {
          corrupted = true;
          adapter.setFile(path, "not-json");
        }
      },
    });
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(result).toMatchObject({ success: false, rollbackSucceeded: true });
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([oldRecord]));
  });

  it("reports cleanup failure as a warning without invalidating successful publication", async () => {
    const adapter = new FakeAdapter();
    seedCanonical(adapter, [makeRecord(makeChunk("Old"))]);
    adapter.setOptions({
      shouldFail: (operation, path) => operation === "remove" && path === files.embeddingsPublishBackup,
    });
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());

    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(await validateCanonicalEmbeddingIndex(makeApp(adapter) as never)).toBe(true);
  });

  it("supports first publication when no previous embeddings file exists", async () => {
    const adapter = new FakeAdapter();
    seedTextManifest(adapter);
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("A"))], publicationInfo());

    expect(result.success).toBe(true);
    expect(adapter.renamedFrom).not.toContain(files.canonicalEmbeddings);
  });

  it("does not create an embeddings backup on first publication", async () => {
    const adapter = new FakeAdapter();
    seedTextManifest(adapter);
    await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("A"))], publicationInfo());

    expect(adapter.renamedTo).not.toContain(files.embeddingsPublishBackup);
  });

  it("keeps a pre-existing canonical JSONL without trailing newline readable", async () => {
    const adapter = new FakeAdapter();
    const oldRecord = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [oldRecord], false);
    expect(await validateCanonicalEmbeddingIndex(makeApp(adapter) as never)).toBe(true);
  });
});

describe("known embedding artifact recovery and coordination", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes only known incomplete temporary files", async () => {
    const adapter = new FakeAdapter();
    adapter.setFile(files.checkpointTemporary, "partial");
    adapter.setFile(files.embeddingsPublishTemporary, "partial");
    adapter.setFile(".lina/index/unknown.tmp", "keep");
    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);

    expect(adapter.hasFile(files.checkpointTemporary)).toBe(false);
    expect(adapter.hasFile(files.embeddingsPublishTemporary)).toBe(false);
    expect(adapter.hasFile(".lina/index/unknown.tmp")).toBe(true);
  });

  it("removes an old backup when the canonical pair is valid", async () => {
    const adapter = new FakeAdapter();
    const current = makeRecord(makeChunk("Current"));
    const old = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [current]);
    adapter.setFile(files.embeddingsPublishBackup, recordsContent([old]));
    adapter.setFile(files.manifestPublishBackup, JSON.stringify(makeEmbeddingManifest([old])));
    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);

    expect(adapter.hasFile(files.embeddingsPublishBackup)).toBe(false);
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([current]));
  });

  it("restores a valid backup when the canonical pair is invalid", async () => {
    const adapter = new FakeAdapter();
    const old = makeRecord(makeChunk("Old"));
    adapter.setFile(files.canonicalEmbeddings, "truncated");
    adapter.setFile(files.canonicalManifest, "not-json");
    adapter.setFile(files.embeddingsPublishBackup, recordsContent([old]));
    adapter.setFile(files.manifestPublishBackup, JSON.stringify(makeEmbeddingManifest([old])));
    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);

    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(recordsContent([old]));
    expect(await validateCanonicalEmbeddingIndex(makeApp(adapter) as never)).toBe(true);
  });

  it("restores the text manifest after an interrupted first embedding publication", async () => {
    const adapter = new FakeAdapter();
    adapter.setFile(files.canonicalEmbeddings, recordsContent([makeRecord(makeChunk("New"))]));
    adapter.setFile(files.manifestPublishBackup, JSON.stringify(makeTextManifest()));
    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);

    expect(adapter.hasFile(files.canonicalEmbeddings)).toBe(false);
    expect(JSON.parse(adapter.getFile(files.canonicalManifest) ?? "{}") as Record<string, unknown>).toMatchObject({
      indexType: "text",
      embeddingsEnabled: false,
    });
  });

  it("completes an interrupted first publication from the validated manifest candidate", async () => {
    const adapter = new FakeAdapter();
    const record = makeRecord(makeChunk("New"));
    adapter.setFile(files.canonicalEmbeddings, recordsContent([record]));
    adapter.setFile(files.canonicalManifest, JSON.stringify(makeTextManifest()));
    adapter.setFile(files.manifestPublishTemporary, JSON.stringify(makeEmbeddingManifest([record])));

    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);

    expect(await validateCanonicalEmbeddingIndex(makeApp(adapter) as never)).toBe(true);
    expect(adapter.hasFile(files.manifestPublishTemporary)).toBe(false);
    expect(adapter.hasFile(files.manifestPublishBackup)).toBe(false);
  });

  it("does not remove unknown files during recovery", async () => {
    const adapter = new FakeAdapter();
    adapter.setFile(".lina/index/custom.data", "user-data");
    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);
    expect(adapter.getFile(".lina/index/custom.data")).toBe("user-data");
  });

  it("is idempotent when recovery is repeated", async () => {
    const adapter = new FakeAdapter();
    adapter.setFile(files.manifestPublishTemporary, "partial");
    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);
    const firstFiles = adapter.listFiles();
    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);
    expect(adapter.listFiles()).toEqual(firstFiles);
  });

  it("restores the last complete checkpoint pair from known backups", async () => {
    const adapter = new FakeAdapter();
    const record = makeRecord(makeChunk("A"));
    adapter.setFile(files.checkpoint, "truncated");
    adapter.setFile(files.checkpointBackup, recordsContent([record]));
    adapter.setFile(files.checkpointMetadataBackup, JSON.stringify(makeMetadata({ completedRecords: 1 })));

    await recoverEmbeddingPersistenceArtifacts(makeApp(adapter) as never);
    const loaded = await loadEmbeddingCheckpoint(makeApp(adapter) as never, checkpointIdentity());
    expect(loaded).toMatchObject({ status: "available", records: [{ chunkId: record.chunkId }] });
  });

  it("keeps the write coordinator acquired while checkpointing", async () => {
    const adapter = new FakeAdapter();
    const coordinator = new IndexWriteCoordinator();
    coordinator.requestEmbeddingGenerationPreparation();
    const activation = coordinator.startEmbeddingGeneration();
    expect(activation.status).toBe("accepted");
    adapter.setOptions({
      beforeOperation: (operation, path) => {
        if (operation === "write" && path === files.checkpointTemporary) {
          expect(coordinator.getState().activeOperation).toBe("embedding-generation");
        }
      },
    });
    await writeEmbeddingCheckpoint(makeApp(adapter) as never, makeMetadata(), [makeRecord(makeChunk("A"))]);
    if (activation.status === "accepted") coordinator.finish(activation.token);
    expect(coordinator.getState().activeOperation).toBeNull();
  });

  it("keeps the write coordinator acquired throughout rollback", async () => {
    const adapter = new FakeAdapter();
    const coordinator = new IndexWriteCoordinator();
    coordinator.requestEmbeddingGenerationPreparation();
    const activation = coordinator.startEmbeddingGeneration();
    const old = makeRecord(makeChunk("Old"));
    seedCanonical(adapter, [old]);
    let failed = false;
    adapter.setOptions({
      shouldFail: (operation, path, target) => {
        if (!failed && operation === "rename" && path === files.manifestPublishTemporary && target === files.canonicalManifest) {
          failed = true;
          return true;
        }
        return false;
      },
      beforeOperation: (operation, path, target) => {
        if (operation === "rename" && path === files.embeddingsPublishBackup && target === files.canonicalEmbeddings) {
          expect(coordinator.getState().activeOperation).toBe("embedding-generation");
        }
      },
    });
    const result = await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("New"))], publicationInfo());
    expect(result.success).toBe(false);
    if (activation.status === "accepted") coordinator.finish(activation.token);
  });

  it("keeps canonical record field names unchanged", async () => {
    const adapter = new FakeAdapter();
    seedTextManifest(adapter);
    await publishCanonicalEmbeddings(makeApp(adapter) as never, [makeRecord(makeChunk("A"))], publicationInfo());
    const line = (adapter.getFile(files.canonicalEmbeddings) ?? "").trim();
    expect(Object.keys(JSON.parse(line) as Record<string, unknown>).sort()).toEqual([
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

  it("uses deterministic internal file names without operation or note content", () => {
    expect(Object.values(EMBEDDING_PERSISTENCE_FILES).every((path) => path.startsWith(".lina/index/"))).toBe(true);
    expect(Object.values(EMBEDDING_PERSISTENCE_FILES).some((path) => path.includes("operation-1"))).toBe(false);
    expect(Object.values(EMBEDDING_PERSISTENCE_FILES).some((path) => path.includes("A.md"))).toBe(false);
  });

  it("derives checkpoint input identity from input version and prefix mode", () => {
    expect(getEmbeddingInputFormatVersion("mistral-embed")).toBe("1:none");
    expect(getEmbeddingInputFormatVersion("nomic-embed-text")).toBe("1:nomic-search-query-document");
  });
});
