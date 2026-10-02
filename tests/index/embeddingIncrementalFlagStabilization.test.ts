import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { Chunk } from "../../src/index/chunker";
import {
  EmbeddingRecord,
  buildEmbeddingInput,
  generateEmbeddingsForChunks,
  getPrefixModeForModel,
  readEmbeddingUpdatePreview,
} from "../../src/index/embeddingGenerator";
import { EMBEDDING_PERSISTENCE_FILES } from "../../src/index/embeddingPersistence";
import { buildEmbeddingWorkLifecycleSnapshot } from "../../src/index/embeddingWorkStatusController";
import { evaluateSchedulerDecisionFromSnapshot } from "../../src/maintenance/embeddingScheduler";
import { hashContent } from "../../src/index/noteHasher";
import {
  EMBEDDING_GENERATION_INCREMENTAL,
  isLegacyFullRegenerationPreferenceSet,
} from "../../src/maintenance/embeddingUpdateSettings";
import { FakeAdapter } from "../helpers/fakeAdapter";

/**
 * LINA-15F (CR-02 / F-12): a persistent "regenerate everything" preference must never feed the
 * *assessment* of pending work. These tests document the root cause (`incremental:false` makes the
 * plan ignore the canonical file, so the state never settles) and protect the corrected contract.
 */

const PROVIDER = "ollama";
const MODEL = "nomic-embed-text-v2-moe";
const DIMENSIONS = 3;
const files = EMBEDDING_PERSISTENCE_FILES;

function makeChunk(index: number): Chunk {
  const text = `config runtime consistency chunk ${index}`;
  const path = `Notes/Note-${index}.md`;
  return {
    chunkId: `${path}::0`,
    path,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-10-02T00:00:00.000Z",
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
    createdAt: "2026-10-02T00:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, getPrefixModeForModel(MODEL))),
  };
}

function seedCanonical(adapter: FakeAdapter, records: EmbeddingRecord[]): void {
  adapter.setFile(files.canonicalEmbeddings, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  adapter.setFile(files.canonicalManifest, JSON.stringify({
    version: 1,
    indexType: "text",
    embeddingsEnabled: true,
    updatedAt: "2026-10-02T00:00:00.000Z",
    totalNotes: records.length,
    totalChunks: records.length,
    embeddings: {
      enabled: true,
      provider: PROVIDER,
      model: MODEL,
      totalEmbeddings: records.length,
      dimensions: DIMENSIONS,
      updatedAt: "2026-10-02T00:00:00.000Z",
      sourceTotalChunks: records.length,
    },
    embeddingInput: { version: 1, prefixMode: getPrefixModeForModel(MODEL) },
  }));
}

function makeApp(adapter: FakeAdapter): never {
  return { vault: { adapter } } as never;
}

function assess(updatePlan: Awaited<ReturnType<typeof readEmbeddingUpdatePreview>>) {
  const snapshot = buildEmbeddingWorkLifecycleSnapshot(
    {
      updatePlan,
      exists: updatePlan.mode !== "initial-build",
      canonicalReadability: updatePlan.mode === "initial-build" ? "missing" : "readable",
      provider: PROVIDER,
      model: MODEL,
    },
    1
  );
  return { snapshot, scheduler: evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only") };
}

describe("LINA-15F — incremental generation contract (generateOnlyMissingEmbeddings)", () => {
  const chunks = Array.from({ length: 4 }, (_value, index) => makeChunk(index));

  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("root cause: a fully valid canonical index is 'up to date' only when the assessment is incremental", async () => {
    const adapter = new FakeAdapter();
    seedCanonical(adapter, chunks.map(makeRecord));

    const incremental = await readEmbeddingUpdatePreview(makeApp(adapter), {
      provider: PROVIDER,
      model: MODEL,
      incremental: true,
      currentChunks: chunks,
    });
    expect(incremental.toGenerateCount).toBe(0);
    expect(assess(incremental).snapshot.primary).toBe("READY");
    expect(assess(incremental).scheduler.hasWork).toBe(false);

    const nonIncremental = await readEmbeddingUpdatePreview(makeApp(adapter), {
      provider: PROVIDER,
      model: MODEL,
      incremental: false,
      currentChunks: chunks,
    });
    // The canonical is ignored: every chunk is reported as pending although all vectors are valid.
    expect(nonIncremental.mode).toBe("initial-build");
    expect(nonIncremental.toGenerateCount).toBe(chunks.length);
    const loop = assess(nonIncremental);
    expect(loop.scheduler.hasWork).toBe(true);
    expect(loop.scheduler.canDispatch).toBe(true);
  });

  it("root cause: with incremental:false the work never settles after a completed generation (regeneration loop)", async () => {
    const adapter = new FakeAdapter();
    const requestUrlMock = vi.spyOn(obsidian, "requestUrl");
    requestUrlMock.mockImplementation((async (request: { body?: string }) => {
      const body = JSON.parse(request.body ?? "{}") as { input?: unknown };
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return { status: 200, json: { embeddings: inputs.map(() => [1, 0, 0]) } };
    }) as never);
    adapter.setFile(files.canonicalManifest, JSON.stringify({ version: 1, indexType: "text", embeddingsEnabled: false }));

    const generation = await generateEmbeddingsForChunks(makeApp(adapter), chunks, {
      baseUrl: "http://localhost:11434",
      model: MODEL,
      provider: PROVIDER,
      apiKey: "",
      timeoutMs: 60000,
      batchSize: 2,
      incremental: false,
      operationId: "legacy-flag-false",
    });
    expect(generation.success).toBe(true);

    // Same facts on disk: everything is generated and valid...
    const settled = await readEmbeddingUpdatePreview(makeApp(adapter), {
      provider: PROVIDER,
      model: MODEL,
      incremental: true,
      currentChunks: chunks,
    });
    expect(settled.toGenerateCount).toBe(0);
    expect(assess(settled).scheduler.hasWork).toBe(false);

    // ...but a persistent incremental:false still reports pending work for the very same artifacts.
    const legacyAssessment = await readEmbeddingUpdatePreview(makeApp(adapter), {
      provider: PROVIDER,
      model: MODEL,
      incremental: false,
      currentChunks: chunks,
    });
    expect(legacyAssessment.toGenerateCount).toBe(chunks.length);
    expect(assess(legacyAssessment).scheduler.hasWork).toBe(true);
  });

  it("corrected contract: a persisted legacy false cannot reopen the work after a completed generation", async () => {
    const adapter = new FakeAdapter();
    seedCanonical(adapter, chunks.map(makeRecord));

    // A settings file carrying generateOnlyMissingEmbeddings=false is detected but not honoured.
    expect(isLegacyFullRegenerationPreferenceSet({ generateOnlyMissingEmbeddings: false })).toBe(true);

    // The production assessment (hasAutomaticEmbeddingWork / controller / confirmation) always uses the policy constant.
    const assessment = await readEmbeddingUpdatePreview(makeApp(adapter), {
      provider: PROVIDER,
      model: MODEL,
      incremental: EMBEDDING_GENERATION_INCREMENTAL,
      currentChunks: chunks,
    });
    const { snapshot, scheduler } = assess(assessment);
    expect(assessment.toGenerateCount).toBe(0);
    expect(snapshot.primary).toBe("READY");
    expect(scheduler.hasWork).toBe(false);
    expect(scheduler.canDispatch).toBe(false);
  });

  it("corrected contract: only genuinely missing chunks are pending, and they settle after one run", async () => {
    const adapter = new FakeAdapter();
    seedCanonical(adapter, chunks.slice(0, 3).map(makeRecord));
    const requestUrlMock = vi.spyOn(obsidian, "requestUrl");
    requestUrlMock.mockImplementation((async (request: { body?: string }) => {
      const body = JSON.parse(request.body ?? "{}") as { input?: unknown };
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return { status: 200, json: { embeddings: inputs.map(() => [1, 0, 0]) } };
    }) as never);

    const before = await readEmbeddingUpdatePreview(makeApp(adapter), {
      provider: PROVIDER,
      model: MODEL,
      incremental: EMBEDDING_GENERATION_INCREMENTAL,
      currentChunks: chunks,
    });
    expect(before.mode).toBe("incremental");
    expect(before.toGenerateCount).toBe(1);
    expect(assess(before).scheduler.hasWork).toBe(true);

    const generation = await generateEmbeddingsForChunks(makeApp(adapter), chunks, {
      baseUrl: "http://localhost:11434",
      model: MODEL,
      provider: PROVIDER,
      apiKey: "",
      timeoutMs: 60000,
      batchSize: 2,
      incremental: EMBEDDING_GENERATION_INCREMENTAL,
      operationId: "incremental-settles",
    });
    expect(generation.success).toBe(true);
    expect(generation.generated).toBe(1);
    expect(generation.kept).toBe(3);

    const after = await readEmbeddingUpdatePreview(makeApp(adapter), {
      provider: PROVIDER,
      model: MODEL,
      incremental: EMBEDDING_GENERATION_INCREMENTAL,
      currentChunks: chunks,
    });
    expect(after.toGenerateCount).toBe(0);
    expect(assess(after).scheduler.hasWork).toBe(false);
  });
});
