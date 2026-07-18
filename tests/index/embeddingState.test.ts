import { describe, expect, it } from "vitest";
import { EmbeddingRecord } from "../../src/index/embeddingPersistence";
import {
  calculateEmbeddingState,
  filterEmbeddingRecordsForSearch,
  NextGenerationEmbeddingIdentity,
  PublishedEmbeddingIdentity,
} from "../../src/index/embeddingState";
import { Chunk } from "../../src/index/chunker";
import { buildEmbeddingInput, EMBEDDING_INPUT_VERSION, getPrefixModeForModel } from "../../src/index/embeddingGenerator";
import { hashContent } from "../../src/index/noteHasher";
import { searchSemanticIndex } from "../../src/search/semanticSearch";

const PROVIDER = "ollama";
const MODEL_A = "nomic-embed-text";
const MODEL_B = "nomic-embed-text-v2";
const DIMENSIONS = 3;

function makeChunk(id: string, text: string = `conteúdo ${id}`): Chunk {
  return {
    chunkId: `${id}.md::0`,
    path: `${id}.md`,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}

function publishedIdentity(model: string = MODEL_A): PublishedEmbeddingIdentity {
  return {
    provider: PROVIDER,
    model,
    dimensions: DIMENSIONS,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode: getPrefixModeForModel(model),
  };
}

function nextIdentity(model: string = MODEL_A, provider: string = PROVIDER): NextGenerationEmbeddingIdentity {
  return {
    provider,
    model,
    dimensions: DIMENSIONS,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode: getPrefixModeForModel(model),
  };
}

function makeRecord(chunk: Chunk, overrides: Partial<EmbeddingRecord> = {}): EmbeddingRecord {
  const model = overrides.model ?? MODEL_A;
  return {
    chunkId: chunk.chunkId,
    path: chunk.path,
    index: chunk.chunkIndex,
    textHash: chunk.textHash,
    model,
    provider: PROVIDER,
    dimensions: DIMENSIONS,
    embedding: [1, 0, 0],
    createdAt: "2026-07-18T00:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, getPrefixModeForModel(model))),
    ...overrides,
  };
}

function calculate(chunks: Chunk[], records: unknown[], options: Partial<{
  published: PublishedEmbeddingIdentity;
  next: NextGenerationEmbeddingIdentity;
  checkpoint: number;
  active: boolean;
}> = {}) {
  return calculateEmbeddingState({
    chunks,
    canonicalRecords: records,
    publishedIdentity: options.published ?? publishedIdentity(),
    nextGenerationIdentity: options.next ?? nextIdentity(),
    recoverableCheckpointCount: options.checkpoint,
    operationActive: options.active,
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });
}

describe("embedding derived state", () => {
  it("classifies missing, valid, stale and obsolete without overlap", () => {
    const valid = makeChunk("valid");
    const stale = makeChunk("stale");
    const missing = makeChunk("missing");
    const obsolete = makeChunk("obsolete");
    const state = calculate(
      [valid, stale, missing],
      [makeRecord(valid), makeRecord(stale, { textHash: "changed" }), makeRecord(obsolete)]
    );

    expect(state.chunks.get(valid.chunkId)?.canonicalState).toBe("valid");
    expect(state.chunks.get(stale.chunkId)?.canonicalState).toBe("stale");
    expect(state.chunks.get(missing.chunkId)?.canonicalState).toBe("missing");
    expect(state.obsoleteChunkIds).toEqual(new Set([obsolete.chunkId]));
    expect(state.summary).toMatchObject({ validCount: 1, staleCount: 1, missingCount: 1, obsoleteCount: 1 });
  });

  it("reports deterministic reasons for input, vector and dimension corruption", () => {
    const a = makeChunk("input");
    const b = makeChunk("vector");
    const c = makeChunk("dimension");
    const state = calculate([a, b, c], [
      makeRecord(a, { embeddingInputHash: "old" }),
      makeRecord(b, { embedding: [] }),
      makeRecord(c, { dimensions: 4 }),
    ]);

    expect(state.chunks.get(a.chunkId)?.staleReasons).toContain("input-hash-mismatch");
    expect(state.chunks.get(b.chunkId)?.staleReasons).toContain("invalid-vector");
    expect(state.chunks.get(c.chunkId)?.staleReasons).toContain("dimension-mismatch");
  });

  it("treats absent input hashes, invalid records and duplicates conservatively", () => {
    const a = makeChunk("legacy");
    const b = makeChunk("duplicate");
    const state = calculate([a, b], [
      makeRecord(a, { embeddingInputHash: undefined }),
      makeRecord(b),
      makeRecord(b),
      { invalid: true },
    ]);

    expect(state.chunks.get(a.chunkId)?.staleReasons).toContain("missing-input-hash");
    expect(state.chunks.get(b.chunkId)?.staleReasons).toContain("invalid-record");
    expect(state.summary.duplicateRecordCount).toBe(1);
    expect(state.summary.invalidRecordCount).toBe(1);
    expect(state.validForSearchChunkIds.size).toBe(0);
  });

  it("keeps published A valid for search while requiring regeneration for configured B", () => {
    const chunk = makeChunk("model-change");
    const state = calculate([chunk], [makeRecord(chunk)], {
      published: publishedIdentity(MODEL_A),
      next: nextIdentity(MODEL_B),
    });

    const result = state.chunks.get(chunk.chunkId);
    expect(result?.validForSearch).toBe(true);
    expect(result?.reusableForNextGeneration).toBe(false);
    expect(state.summary.validCount).toBe(1);
  });

  it("does not accept equal dimensions from a different provider or model", () => {
    const chunk = makeChunk("space");
    const record = makeRecord(chunk);
    const differentModel = calculate([chunk], [record], { next: nextIdentity(MODEL_B) });
    const differentProvider = calculate([chunk], [record], { next: nextIdentity(MODEL_A, "mistral") });

    expect(differentModel.summary.reusableForNextGenerationCount).toBe(0);
    expect(differentProvider.summary.reusableForNextGenerationCount).toBe(0);
  });

  it("does not let batch size, API key or base URL affect reuse identity", () => {
    const chunk = makeChunk("transport");
    const state = calculate([chunk], [makeRecord(chunk)]);
    expect(state.summary.reusableForNextGenerationCount).toBe(1);
  });

  it("reports recoverable checkpoints and operation activity globally only", () => {
    const chunk = makeChunk("checkpoint");
    const state = calculate([chunk], [makeRecord(chunk)], { checkpoint: 1, active: true });
    expect(state.summary.recoverableCheckpointCount).toBe(1);
    expect(state.summary.operationActive).toBe(true);
    expect(state.chunks.get(chunk.chunkId)?.canonicalState).toBe("valid");
  });

  it("preserves validity for an identical rebuild and limits changes to affected chunks", () => {
    const unchanged = makeChunk("unchanged");
    const changed = makeChunk("changed", "new text");
    const previousChanged = makeChunk("changed", "old text");
    const state = calculate([unchanged, changed], [makeRecord(unchanged), makeRecord(previousChanged)]);
    expect(state.chunks.get(unchanged.chunkId)?.canonicalState).toBe("valid");
    expect(state.chunks.get(changed.chunkId)?.canonicalState).toBe("stale");
  });

  it("filters stale, invalid and obsolete records before semantic similarity", () => {
    const valid = makeChunk("semantic-valid");
    const stale = makeChunk("semantic-stale");
    const obsolete = makeChunk("semantic-obsolete");
    const validRecord = makeRecord(valid);
    const state = calculate([valid, stale], [validRecord, makeRecord(stale, { textHash: "old" }), makeRecord(obsolete)]);
    const records = filterEmbeddingRecordsForSearch(
      [validRecord, makeRecord(stale, { textHash: "old" }), makeRecord(obsolete)],
      state.validForSearchChunkIds
    );

    expect(records).toEqual([validRecord]);
    expect(searchSemanticIndex([1, 0, 0], records, [valid, stale])).toHaveLength(1);
  });

  it("handles a large fixture with maps without storing vectors in states", () => {
    const chunks = Array.from({ length: 2000 }, (_, index) => makeChunk(`large-${index}`));
    const records = chunks.map((chunk) => makeRecord(chunk));
    const state = calculate(chunks, records);
    expect(state.summary.validCount).toBe(2000);
    expect(state.chunks.get(chunks[0].chunkId)).not.toHaveProperty("embedding");
  });
});
