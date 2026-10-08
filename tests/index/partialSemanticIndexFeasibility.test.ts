import { describe, expect, it } from "vitest";
import type { Chunk } from "../../src/index/chunker";
import type { EmbeddingRecord } from "../../src/index/embeddingPersistence";
import type { EmbeddingSpaceIdentity } from "../../src/index/embeddingUpdatePlan";
import { buildEmbeddingInput } from "../../src/index/embeddingGenerator";
import { hashContent } from "../../src/index/noteHasher";
import {
  BinaryEmbeddingDataAdapter,
  BinaryEmbeddingDigest,
  BinaryEmbeddingPublisher,
  readBinaryEmbeddingStorage,
  BINARY_EMBEDDING_FILES,
} from "../../src/index/embeddingBinaryStorage";
import { classifyBinaryRecords, compactBinaryRuntimeIndex, type RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";
import { searchRuntimeSemanticIndex } from "../../src/search/semanticSearch";

/**
 * Production coverage for the strict per-record binary classifier.
 */

class MemoryAdapter implements BinaryEmbeddingDataAdapter {
  readonly text = new Map<string, string>();
  readonly binary = new Map<string, ArrayBuffer>();
  async exists(path: string) { return this.text.has(path) || this.binary.has(path); }
  async stat(path: string) {
    const t = this.text.get(path); const b = this.binary.get(path);
    return t !== undefined ? { type: "file", size: new TextEncoder().encode(t).byteLength, mtime: 1 } : b ? { type: "file", size: b.byteLength, mtime: 1 } : null;
  }
  async read(path: string) { const v = this.text.get(path); if (v === undefined) throw new Error("missing"); return v; }
  async write(path: string, value: string) { this.text.set(path, value); }
  async readBinary(path: string) { const v = this.binary.get(path); if (!v) throw new Error("missing"); return v.slice(0); }
  async writeBinary(path: string, value: ArrayBuffer) { this.binary.set(path, value.slice(0)); }
  async rename(from: string, to: string) {
    const t = this.text.get(from); const b = this.binary.get(from);
    this.text.delete(from); this.binary.delete(from);
    if (t !== undefined) this.text.set(to, t); else if (b) this.binary.set(to, b); else throw new Error("missing");
  }
  async remove(path: string) { this.text.delete(path); this.binary.delete(path); }
}

const digest: BinaryEmbeddingDigest = {
  async digest(value) {
    let hash = 2166136261;
    for (const byte of new Uint8Array(value)) hash = Math.imul(hash ^ byte, 16777619);
    return `sha256:${(hash >>> 0).toString(16).padStart(64, "0")}`;
  },
};

const DIM = 3;
const identity: EmbeddingSpaceIdentity = { provider: "mistral", model: "mistral-embed", dimensions: DIM, inputVersion: 1, prefixMode: "none" };

function chunk(path: string, index: number, text: string): Chunk {
  return { chunkId: `${path}::${index}`, path, chunkIndex: index, text, startOffset: 0, endOffset: text.length, charCount: text.length, textHash: hashContent(text) };
}

function recordFor(c: Chunk, vector: number[]): EmbeddingRecord {
  return {
    chunkId: c.chunkId, path: c.path, index: c.chunkIndex, textHash: c.textHash,
    embeddingInputHash: hashContent(buildEmbeddingInput(c, "none")),
    provider: identity.provider, model: identity.model, dimensions: DIM, embedding: vector, createdAt: "2026-10-08T00:00:00.000Z",
  };
}

const baseChunks = (): Chunk[] => [chunk("a.md", 0, "alpha text"), chunk("c.md", 0, "gamma text"), chunk("e.md", 0, "epsilon text")];
const vectorOf = (c: Chunk): number[] => (c.path === "a.md" ? [1, 0, 0] : c.path === "c.md" ? [0, 1, 0] : c.path === "e.md" ? [0, 0, 1] : [1, 1, 1]);

async function publish(chunks: Chunk[], publicationId = "pub-1"): Promise<MemoryAdapter> {
  const adapter = new MemoryAdapter();
  const records = chunks.map((c) => recordFor(c, vectorOf(c)));
  await new BinaryEmbeddingPublisher(adapter, digest).publish(records, {
    format: "binary-v1", identity, recordCount: records.length, dimensions: DIM, generationId: "gen-1", sourcePublicationId: publicationId,
  });
  return adapter;
}

type Availability = {
  status: "complete" | "partial" | "unavailable";
  reason?: string;
  totalChunks: number; valid: number; stale: number; missing: number; orphan: number;
  validOrdinals: number[];
};

function classifyBinaryIndex(
  index: RuntimeEmbeddingIndex,
  currentChunks: readonly Chunk[],
  expected: { identity: EmbeddingSpaceIdentity; publicationId: string },
): Availability {
  if (index.dimensions !== expected.identity.dimensions) return { status: "unavailable", reason: "dimensions-mismatch", totalChunks: currentChunks.length, valid: 0, stale: 0, missing: 0, orphan: 0, validOrdinals: [] };
  if (index.provider !== expected.identity.provider || index.model !== expected.identity.model) return { status: "unavailable", reason: "identity-mismatch", totalChunks: currentChunks.length, valid: 0, stale: 0, missing: 0, orphan: 0, validOrdinals: [] };
  if (index.sourceIdentity.publicationId !== expected.publicationId) return { status: "unavailable", reason: "publication-mismatch", totalChunks: currentChunks.length, valid: 0, stale: 0, missing: 0, orphan: 0, validOrdinals: [] };
  const classified = classifyBinaryRecords(index, currentChunks);
  return { ...classified.availability, validOrdinals: [...classified.validOrdinals] };
  /*
  const blank = { totalChunks: currentChunks.length, valid: 0, stale: 0, missing: 0, orphan: 0, validOrdinals: [] as number[] };
  const block = (reason: string): Availability => ({ status: "unavailable", reason, ...blank });
  if (index.dimensions !== expected.identity.dimensions) return block("dimensions-mismatch");
  if (index.provider !== expected.identity.provider || index.model !== expected.identity.model) return block("identity-mismatch");
  if (index.sourceIdentity.publicationId !== expected.publicationId) return block("publication-mismatch");
  const byId = new Map<string, Chunk>();
  for (const c of currentChunks) {
    if (byId.has(c.chunkId)) return block("ambiguous-current-chunks");
    byId.set(c.chunkId, c);
  }
  const seen = new Set<string>();
  let valid = 0; let stale = 0; let orphan = 0;
  const validOrdinals: number[] = [];
  index.records.forEach((record, ordinal) => {
    if (seen.has(record.chunkId)) { stale += 1; return; } // duplicate ids are never searchable
    seen.add(record.chunkId);
    const current = byId.get(record.chunkId);
    if (!current) { orphan += 1; return; }
    const ok = record.path === current.path && record.index === current.chunkIndex && record.textHash === current.textHash
      && Boolean(record.embeddingInputHash)
      && record.embeddingInputHash === hashContent(buildEmbeddingInput(current, index.sourceIdentity.prefixMode));
    if (ok) { valid += 1; validOrdinals.push(ordinal); } else stale += 1;
  });
  const missing = currentChunks.filter((c) => !seen.has(c.chunkId)).length;
  const status = valid === 0 ? "unavailable" : stale === 0 && missing === 0 && orphan === 0 ? "complete" : "partial";
  return { status, reason: valid === 0 ? "no-valid-records" : undefined, totalChunks: currentChunks.length, valid, stale, missing, orphan, validOrdinals };
  */
}

const expected = { identity, publicationId: "pub-1" };

describe("PARTIAL-SEMANTIC-INDEX-AUDIT-001 feasibility", () => {
  it("identity is provided by chunkId + hashes in per-vector metadata; ordinal only addresses the vector", async () => {
    const adapter = await publish(baseChunks());
    const index = await readBinaryEmbeddingStorage(adapter, digest);
    const meta = adapter.text.get(BINARY_EMBEDDING_FILES.metadata)!.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(Object.keys(meta[0]).sort()).toEqual(["chunkId", "embeddingInputHash", "index", "path", "textHash", "vectorOrdinal"]);
    expect(index.records.map((r) => r.chunkId)).toEqual(baseChunks().map((c) => c.chunkId));
    expect(classifyBinaryIndex(index, baseChunks(), expected).status).toBe("complete");
  });

  it("1. one changed chunk → N-1 valid, exactly that one stale", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    const current = baseChunks(); current[1] = chunk("c.md", 0, "gamma text EDITED");
    const result = classifyBinaryIndex(index, current, expected);
    expect(result).toMatchObject({ status: "partial", valid: 2, stale: 1, missing: 0, orphan: 0, validOrdinals: [0, 2] });
  });

  it("4. an input-hash-only mismatch (chunk index shift) stales only that record", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    const current = baseChunks(); current[0] = { ...current[0], chunkIndex: 5 };
    const result = classifyBinaryIndex(index, current, expected);
    expect(result.stale).toBe(1);
    expect(result.valid).toBe(2);
  });

  it("2. one removed chunk → orphan identified, current searchable coverage remains complete", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    const current = baseChunks().filter((c) => c.path !== "c.md");
    const result = classifyBinaryIndex(index, current, expected);
    expect(result).toMatchObject({ status: "complete", valid: 2, orphan: 1, stale: 0, missing: 0, validOrdinals: [0, 2] });
  });

  it("3. an inserted chunk sorted between existing ones → missing; existing mappings unchanged", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    const current = [baseChunks()[0], chunk("b.md", 0, "beta new"), baseChunks()[1], baseChunks()[2]];
    const result = classifyBinaryIndex(index, current, expected);
    expect(result).toMatchObject({ status: "partial", valid: 3, missing: 1, stale: 0, orphan: 0 });
    // Compacted runtime index over the valid ordinals searches the right chunks.
    const compact: RuntimeEmbeddingIndex = compactBinaryRuntimeIndex(index, { availability: { status: "partial", totalChunks: current.length, valid: result.valid, stale: result.stale, missing: result.missing, orphan: result.orphan, duplicate: 0 }, validOrdinals: result.validOrdinals })!;
    const hits = searchRuntimeSemanticIndex([0, 1, 0], compact, current, { minSimilarity: 0.5 });
    expect(hits.map((h) => h.chunkId)).toEqual(["c.md::0"]);
  });

  it("D. rename / chunking change → new missing record + old orphan, never an in-place update", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    const current = baseChunks().map((c) => (c.path === "c.md" ? chunk("c-renamed.md", 0, "gamma text") : c));
    const result = classifyBinaryIndex(index, current, expected);
    expect(result).toMatchObject({ valid: 2, missing: 1, orphan: 1, stale: 0 });
  });

  it("5. dimensions mismatch → UNAVAILABLE (global)", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    expect(classifyBinaryIndex(index, baseChunks(), { ...expected, identity: { ...identity, dimensions: 4 } }).status).toBe("unavailable");
    expect(classifyBinaryIndex(index, baseChunks(), { ...expected, identity: { ...identity, model: "other" } }).status).toBe("unavailable");
  });

  it("6. corrupted metadata/vectors are rejected by the existing reader (digest) → UNAVAILABLE", async () => {
    const adapter = await publish(baseChunks());
    const metaPath = BINARY_EMBEDDING_FILES.metadata;
    adapter.text.set(metaPath, adapter.text.get(metaPath)!.replace("c.md::0", "x.md::0"));
    await expect(readBinaryEmbeddingStorage(adapter, digest)).rejects.toMatchObject({ code: "binary-digest-mismatch" });
  });

  it("7. publication mismatch → UNAVAILABLE (global)", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks(), "pub-OLD"), digest);
    expect(classifyBinaryIndex(index, baseChunks(), expected)).toMatchObject({ status: "unavailable", reason: "publication-mismatch" });
  });

  it("8. ambiguous mapping (duplicate current chunkId) → UNAVAILABLE", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    const current = [...baseChunks(), chunk("a.md", 0, "alpha duplicate")];
    expect(classifyBinaryIndex(index, current, expected)).toMatchObject({ status: "unavailable", reason: "ambiguous-current-chunks" });
  });

  it("zero valid records is UNAVAILABLE, never PARTIAL", async () => {
    const index = await readBinaryEmbeddingStorage(await publish(baseChunks()), digest);
    const current = baseChunks().map((c) => chunk(c.path, 0, `${c.text} EDITED`));
    expect(classifyBinaryIndex(index, current, expected).status).toBe("unavailable");
  });
});
