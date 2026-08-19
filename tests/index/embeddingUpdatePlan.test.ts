import { describe, expect, it } from "vitest";
import { Chunk } from "../../src/index/chunker";
import { buildEmbeddingInput, EMBEDDING_INPUT_VERSION, getPrefixModeForModel } from "../../src/index/embeddingGenerator";
import { calculateEmbeddingUpdatePlan, type CanonicalEmbeddingReadability } from "../../src/index/embeddingUpdatePlan";
import { EmbeddingRecord } from "../../src/index/embeddingPersistence";
import { NextGenerationEmbeddingIdentity, PublishedEmbeddingIdentity } from "../../src/index/embeddingState";
import { hashContent } from "../../src/index/noteHasher";

const PROVIDER = "mistral";
const OTHER_PROVIDER = "ollama";
const MODEL = "mistral-embed";
const OTHER_MODEL = "other-embed";
const DIMENSIONS = 3;

function makeChunk(name: string, text: string = `content ${name}`): Chunk {
  const path = `${name}.md`;
  return {
    chunkId: `${path}::0`,
    path,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}

function targetIdentity(overrides: Partial<NextGenerationEmbeddingIdentity> = {}): NextGenerationEmbeddingIdentity {
  const model = overrides.model ?? MODEL;
  return {
    provider: PROVIDER,
    model,
    dimensions: DIMENSIONS,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode: getPrefixModeForModel(model),
    ...overrides,
  };
}

function publishedIdentity(overrides: Partial<PublishedEmbeddingIdentity> = {}): PublishedEmbeddingIdentity {
  return {
    provider: PROVIDER,
    model: MODEL,
    dimensions: DIMENSIONS,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode: getPrefixModeForModel(MODEL),
    ...overrides,
  };
}

function makeRecord(chunk: Chunk, overrides: Partial<EmbeddingRecord> = {}): EmbeddingRecord {
  const model = overrides.model ?? MODEL;
  const provider = overrides.provider ?? PROVIDER;
  return {
    chunkId: chunk.chunkId,
    path: chunk.path,
    index: chunk.chunkIndex,
    textHash: chunk.textHash,
    model,
    provider,
    dimensions: overrides.dimensions ?? DIMENSIONS,
    embedding: overrides.embedding ?? [1, 2, 3],
    createdAt: overrides.createdAt ?? "2026-07-18T00:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, getPrefixModeForModel(model))),
    ...overrides,
  };
}

function plan(options: {
  chunks?: Chunk[];
  canonical?: unknown[];
  checkpoint?: EmbeddingRecord[];
  canonicalExists?: boolean;
  canonicalReadability?: CanonicalEmbeddingReadability;
  published?: PublishedEmbeddingIdentity;
  target?: NextGenerationEmbeddingIdentity;
} = {}) {
  return calculateEmbeddingUpdatePlan({
    chunks: options.chunks ?? [],
    canonicalRecords: options.canonical ?? [],
    canonicalExists: options.canonicalExists,
    canonicalReadability: options.canonicalReadability,
    checkpointRecords: options.checkpoint ?? [],
    publishedIdentity: options.published ?? publishedIdentity(),
    targetIdentity: options.target ?? targetIdentity(),
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });
}

describe("embedding update plan mode decision", () => {
  it("uses initial-build when the canonical file is missing", () => {
    const chunk = makeChunk("A");
    const result = plan({ chunks: [chunk], canonicalExists: false });
    expect(result).toMatchObject({ mode: "initial-build", toGenerateCount: 1 });
    expect(result.reasons).toContain("canonical-missing");
  });

  it("uses initial-build when the canonical file is empty", () => {
    const chunk = makeChunk("A");
    const result = plan({ chunks: [chunk], canonicalExists: true });
    expect(result).toMatchObject({ mode: "initial-build", toGenerateCount: 1 });
    expect(result.reasons).toContain("canonical-empty");
  });

  it("gives published identity mismatch precedence over unreadable canonical records", () => {
    const chunk = makeChunk("A");
    const result = plan({
      chunks: [chunk],
      canonicalExists: true,
      canonicalReadability: "unreadable",
      published: publishedIdentity({ provider: "openrouter", model: "openai/text-embedding-3-small" }),
      target: targetIdentity({ provider: "mistral", model: "mistral-embed" }),
    });

    expect(result).toMatchObject({ mode: "full-rebuild", toGenerateCount: 1 });
    expect(result.reasons).toContain("provider-changed");
    expect(result.reasons).not.toContain("canonical-empty");
  });

  it("keeps compatible unreadable canonical records indeterminate", () => {
    const chunk = makeChunk("A");
    const result = plan({
      chunks: [chunk],
      canonicalExists: true,
      canonicalReadability: "unreadable",
    });

    expect(result).toMatchObject({ mode: "indeterminate", toGenerateCount: 0, requiresPublication: false });
    expect(result.reasons).toContain("canonical-unreadable");
    expect(result.reasons).not.toContain("canonical-empty");
  });

  it("uses incremental when the published identity matches the target identity", () => {
    const chunk = makeChunk("A");
    expect(plan({ chunks: [chunk], canonical: [makeRecord(chunk)] }).mode).toBe("incremental");
  });

  it.each([
    ["provider", publishedIdentity({ provider: OTHER_PROVIDER }), "provider-changed"],
    ["model", publishedIdentity({ model: OTHER_MODEL }), "model-changed"],
    ["dimension", publishedIdentity({ dimensions: 4 }), "dimension-changed"],
    ["input version", publishedIdentity({ inputVersion: 2 }), "input-version-changed"],
    ["prefix mode", publishedIdentity({ prefixMode: "nomic-search-query-document" }), "prefix-mode-changed"],
  ] as const)("uses full-rebuild when %s changes", (_label, published, reason) => {
    const chunk = makeChunk("A");
    const result = plan({ chunks: [chunk], canonical: [makeRecord(chunk)], published });
    expect(result.mode).toBe("full-rebuild");
    expect(result.reasons).toContain(reason);
    expect(result.reusableCanonicalCount).toBe(0);
  });

  it("uses full-rebuild when the manifest does not prove the published identity", () => {
    const chunk = makeChunk("A");
    const result = plan({ chunks: [chunk], canonical: [makeRecord(chunk)], published: { provider: PROVIDER, model: MODEL } });
    expect(result.mode).toBe("full-rebuild");
    expect(result.reasons).toContain("published-identity-incomplete");
  });

  it("uses full-rebuild when the canonical records mix vector-space identities", () => {
    const a = makeChunk("A");
    const b = makeChunk("B");
    const result = plan({ chunks: [a, b], canonical: [makeRecord(a), makeRecord(b, { model: OTHER_MODEL })] });
    expect(result.mode).toBe("full-rebuild");
    expect(result.reasons).toContain("canonical-identity-mixed");
  });
});

describe("embedding update plan incremental selection", () => {
  it("keeps all valid records as a no-op without requiring publication", () => {
    const chunk = makeChunk("A");
    const result = plan({ chunks: [chunk], canonical: [makeRecord(chunk)] });
    expect(result).toMatchObject({ mode: "incremental", toGenerateCount: 0, reusableCanonicalCount: 1, requiresPublication: false });
    expect(result.reasons).toContain("no-generation-needed");
  });

  it("generates only a new missing chunk", () => {
    const a = makeChunk("A");
    const b = makeChunk("B");
    const result = plan({ chunks: [a, b], canonical: [makeRecord(a)] });
    expect(result.missingCount).toBe(1);
    expect(result.chunksToGenerate).toEqual([b]);
  });

  it("generates only a stale chunk when the text changes", () => {
    const oldChunk = makeChunk("A", "old");
    const currentChunk = makeChunk("A", "new");
    const result = plan({ chunks: [currentChunk], canonical: [makeRecord(oldChunk)] });
    expect(result.staleToReplaceCount).toBe(1);
    expect(result.chunksToGenerate).toEqual([currentChunk]);
  });

  it("drops obsolete records from the next publication candidate", () => {
    const current = makeChunk("Current");
    const obsolete = makeChunk("Obsolete");
    const result = plan({ chunks: [current], canonical: [makeRecord(current), makeRecord(obsolete)] });
    expect(result.obsoleteChunkIds).toEqual([obsolete.chunkId]);
    expect(result.recordsToPublish).toEqual([makeRecord(current)]);
  });

  it("preserves the exact reusable record reference and createdAt", () => {
    const chunk = makeChunk("A");
    const record = makeRecord(chunk, { createdAt: "2026-07-18T12:00:00.000Z" });
    const result = plan({ chunks: [chunk], canonical: [record] });
    expect(result.reusableCanonicalRecords[0]).toBe(record);
    expect(result.reusableCanonicalRecords[0].createdAt).toBe("2026-07-18T12:00:00.000Z");
  });

  it("does not reuse duplicate canonical records", () => {
    const chunk = makeChunk("A");
    const result = plan({ chunks: [chunk], canonical: [makeRecord(chunk), makeRecord(chunk)] });
    expect(result.reusableCanonicalCount).toBe(0);
    expect(result.toGenerateCount).toBe(1);
    expect(result.reasons).toContain("canonical-has-duplicates");
  });

  it("does not reuse invalid vector records", () => {
    const chunk = makeChunk("A");
    const result = plan({ chunks: [chunk], canonical: [makeRecord(chunk, { embedding: [] })] });
    expect(result.reusableCanonicalCount).toBe(0);
    expect(result.chunksToGenerate).toEqual([chunk]);
  });

  it("keeps generation order deterministic and unique", () => {
    const a = makeChunk("A");
    const b = makeChunk("B");
    const c = makeChunk("C");
    const result = plan({ chunks: [b, a, c], canonical: [makeRecord(c)] });
    expect(result.chunksToGenerate).toEqual([b, a]);
    expect(new Set(result.chunksToGenerate.map((chunk) => chunk.chunkId)).size).toBe(result.chunksToGenerate.length);
  });
});

describe("embedding update plan full rebuild and checkpoint selection", () => {
  it("does not reuse old canonical records in full-rebuild mode", () => {
    const chunk = makeChunk("A");
    const result = plan({
      chunks: [chunk],
      canonical: [makeRecord(chunk)],
      target: targetIdentity({ model: OTHER_MODEL }),
    });
    expect(result.mode).toBe("full-rebuild");
    expect(result.reusableCanonicalCount).toBe(0);
    expect(result.chunksToGenerate).toEqual([chunk]);
  });

  it("selects all current chunks for a full rebuild and excludes obsolete chunks", () => {
    const a = makeChunk("A");
    const b = makeChunk("B");
    const obsolete = makeChunk("Old");
    const result = plan({
      chunks: [a, b],
      canonical: [makeRecord(a), makeRecord(obsolete)],
      target: targetIdentity({ provider: OTHER_PROVIDER }),
    });
    expect(result.chunksToGenerate).toEqual([a, b]);
    expect(result.chunksToGenerate).not.toContain(obsolete);
  });

  it("ignores checkpoint records from another identity", () => {
    const chunk = makeChunk("A");
    const result = plan({
      chunks: [chunk],
      canonical: [makeRecord(chunk)],
      target: targetIdentity({ model: OTHER_MODEL }),
      checkpoint: [makeRecord(chunk)],
    });
    expect(result.recoverableCheckpointCount).toBe(0);
    expect(result.chunksToGenerate).toEqual([chunk]);
  });

  it("reuses compatible checkpoint records during full rebuild", () => {
    const chunk = makeChunk("A");
    const target = targetIdentity({ provider: OTHER_PROVIDER });
    const checkpoint = makeRecord(chunk, { provider: OTHER_PROVIDER });
    const result = plan({
      chunks: [chunk],
      canonical: [makeRecord(chunk)],
      target,
      checkpoint: [checkpoint],
    });
    expect(result.mode).toBe("full-rebuild");
    expect(result.recoverableCheckpointRecords).toEqual([checkpoint]);
    expect(result.toGenerateCount).toBe(0);
  });

  it("still rebuilds when dimensions match but the model changes", () => {
    const chunk = makeChunk("A");
    const result = plan({
      chunks: [chunk],
      canonical: [makeRecord(chunk)],
      target: targetIdentity({ model: OTHER_MODEL, dimensions: DIMENSIONS }),
    });
    expect(result.mode).toBe("full-rebuild");
    expect(result.reasons).toContain("model-changed");
  });
});

describe("embedding update plan no-op and cleanup policies", () => {
  it("lets a checkpoint complement canonical records without duplication", () => {
    const a = makeChunk("A");
    const b = makeChunk("B");
    const checkpoint = makeRecord(b);
    const result = plan({ chunks: [a, b], canonical: [makeRecord(a)], checkpoint: [checkpoint] });
    expect(result.reusableCanonicalCount).toBe(1);
    expect(result.recoverableCheckpointRecords).toEqual([checkpoint]);
    expect(result.toGenerateCount).toBe(0);
  });

  it("prefers a reusable canonical record over a checkpoint for the same chunk", () => {
    const chunk = makeChunk("A");
    const canonical = makeRecord(chunk, { createdAt: "canonical" });
    const checkpoint = makeRecord(chunk, { createdAt: "checkpoint" });
    const result = plan({ chunks: [chunk], canonical: [canonical], checkpoint: [checkpoint] });
    expect(result.reusableCanonicalRecords).toEqual([canonical]);
    expect(result.recoverableCheckpointRecords).toEqual([]);
  });

  it("marks checkpoint-covered plans as publication work without provider generation", () => {
    const chunk = makeChunk("A");
    const checkpoint = makeRecord(chunk);
    const result = plan({ chunks: [chunk], canonicalExists: false, checkpoint: [checkpoint] });
    expect(result.mode).toBe("initial-build");
    expect(result.toGenerateCount).toBe(0);
    expect(result.requiresPublication).toBe(true);
    expect(result.reasons).toContain("checkpoint-covers-all");
  });

  it("publishes a cleaned canonical when all current chunks are valid but obsolete records exist", () => {
    const current = makeChunk("Current");
    const obsolete = makeChunk("Obsolete");
    const result = plan({ chunks: [current], canonical: [makeRecord(current), makeRecord(obsolete)] });
    expect(result.toGenerateCount).toBe(0);
    expect(result.requiresPublication).toBe(true);
    expect(result.recordsToPublish.map((record) => record.chunkId)).toEqual([current.chunkId]);
  });

  it("documents zero chunks as a safe no-generation plan", () => {
    const result = plan({ chunks: [], canonicalExists: false });
    expect(result.totalChunks).toBe(0);
    expect(result.toGenerateCount).toBe(0);
    expect(result.requiresPublication).toBe(false);
  });
});
