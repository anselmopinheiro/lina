import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareLegacyAndPublished,
  publishedSnapshotFromReadResult,
  type EquivalenceIdentity,
  type EquivalenceRecord,
  type LegacyEquivalenceRecord,
  type LegacyEquivalenceSnapshot,
  type PublishedEquivalenceSnapshot,
} from "../../src/index/publishedGenerationEquivalence";
import { buildImmutableGeneration } from "../../src/index/publishedGenerationBuilder";
import { computeVectorContractId } from "../../src/index/vectorContract";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "../../src/index/producerLocalStoreTypes";

const identity: EquivalenceIdentity = { dimensions: 2, provider: "mistral", model: "mistral-embed", vectorContractId: "vec:abc", dtype: "float32" };

function legacyRecord(id: string, vector: number[], overrides: Partial<LegacyEquivalenceRecord> = {}): LegacyEquivalenceRecord {
  return { chunkId: id, path: `${id}.md`, index: 0, textHash: `h-${id}`, embedding: vector, ...overrides };
}
function publishedMeta(id: string, overrides: Partial<EquivalenceRecord> = {}): EquivalenceRecord {
  return { chunkId: id, path: `${id}.md`, index: 0, textHash: `h-${id}`, ...overrides };
}
function legacySnapshot(records: LegacyEquivalenceRecord[], id: EquivalenceIdentity = identity): LegacyEquivalenceSnapshot { return { identity: id, records }; }
function publishedSnapshot(records: EquivalenceRecord[], vectors: number[], id: EquivalenceIdentity = identity): PublishedEquivalenceSnapshot {
  return { identity: id, records, vectors: new Float32Array(vectors) };
}
const base = () => ({
  legacy: legacySnapshot([legacyRecord("a", [1, 2]), legacyRecord("b", [3, 4])]),
  published: publishedSnapshot([publishedMeta("a"), publishedMeta("b")], [1, 2, 3, 4]),
});
const classes = (result: ReturnType<typeof compareLegacyAndPublished>): string[] => result.divergences.map((d) => d.class);

describe("M5B equivalence comparator — L1", () => {
  it("1. is equivalent when metadata coincides and does not need vectors", () => {
    const result = compareLegacyAndPublished({ level: "L1", legacy: { identity: { ...identity, recordCount: 2 } }, published: { identity: { ...identity, recordCount: 2 } } });
    expect(result.equivalent).toBe(true);
    expect(result.summary.divergenceCount).toBe(0);
  });
  it("2. reports a recordCount mismatch", () => {
    const result = compareLegacyAndPublished({ level: "L1", legacy: { identity: { ...identity, recordCount: 2 } }, published: { identity: { ...identity, recordCount: 3 } } });
    expect(result.divergences).toEqual([{ class: "METADATA_MISMATCH", field: "recordCount", legacyValue: 2, publishedValue: 3 }]);
  });
  it("3. reports a dimension mismatch", () => {
    const result = compareLegacyAndPublished({ level: "L1", legacy: { identity }, published: { identity: { ...identity, dimensions: 4 } } });
    expect(classes(result)).toEqual(["DIMENSION_MISMATCH"]);
  });
  it("4. reports provider, model, contract id and dtype mismatches as CONTRACT_MISMATCH", () => {
    const result = compareLegacyAndPublished({ level: "L1", legacy: { identity }, published: { identity: { ...identity, provider: "ollama", model: "x", vectorContractId: "vec:other", dtype: "float64" } } });
    expect(result.divergences.map((d) => d.field)).toEqual(["provider", "model", "vectorContractId", "dtype"]);
    expect(new Set(classes(result))).toEqual(new Set(["CONTRACT_MISMATCH"]));
  });
  it("does not compare vectors or records at L1", () => {
    const { legacy, published } = base();
    const result = compareLegacyAndPublished({ level: "L1", legacy: legacySnapshot([legacyRecord("a", [9, 9])]), published });
    expect(classes(result)).toEqual(["METADATA_MISMATCH"]); // only the derived recordCount 1 vs 2
    expect(legacy.records).toHaveLength(2);
  });
  it("compares publication ids only when both sides expose one (G2)", () => {
    const ok = compareLegacyAndPublished({ level: "L1", legacy: { identity: { ...identity, publicationId: "emb-1" } }, published: { identity } });
    expect(ok.equivalent).toBe(true);
    const bad = compareLegacyAndPublished({ level: "L1", legacy: { identity: { ...identity, publicationId: "emb-1" } }, published: { identity: { ...identity, publicationId: "emb-2" } } });
    expect(bad.divergences[0]).toMatchObject({ class: "SOURCE_PROVENANCE_MISMATCH", field: "sourcePublicationId" });
  });
  it("reports source provenance independently from semantic identity", () => {
    const result = compareLegacyAndPublished({ level: "L1", legacy: { identity: { ...identity, sourceTextGenerationId: "text-a", sourceChunksDigest: "sha256:a", sourceRecordCount: 2 } }, published: { identity: { ...identity, sourceTextGenerationId: "text-b", sourceChunksDigest: "sha256:b", sourceRecordCount: 3 } } });
    expect(new Set(classes(result))).toEqual(new Set(["SOURCE_PROVENANCE_MISMATCH"]));
  });
});

describe("M5B equivalence comparator — L2", () => {
  it("5. is equivalent regardless of physical order", () => {
    const result = compareLegacyAndPublished({
      level: "L2",
      legacy: legacySnapshot([legacyRecord("b", [3, 4]), legacyRecord("a", [1, 2])]),
      published: publishedSnapshot([publishedMeta("a"), publishedMeta("b")], [1, 2, 3, 4]),
    });
    expect(result.equivalent).toBe(true);
    expect(result.summary).toMatchObject({ legacyCount: 2, publishedCount: 2, divergenceCount: 0 });
  });
  it("6. detects LEGACY_ONLY", () => {
    const { published } = base();
    const result = compareLegacyAndPublished({ level: "L2", legacy: legacySnapshot([legacyRecord("a", [1, 2]), legacyRecord("b", [3, 4]), legacyRecord("c", [5, 6])]), published });
    expect(result.divergences.filter((d) => d.class === "LEGACY_ONLY").map((d) => d.chunkId)).toEqual(["c"]);
  });
  it("7. detects PUBLISHED_ONLY", () => {
    const { legacy } = base();
    const result = compareLegacyAndPublished({ level: "L2", legacy, published: publishedSnapshot([publishedMeta("a"), publishedMeta("b"), publishedMeta("z")], [1, 2, 3, 4, 7, 8]) });
    expect(result.divergences.filter((d) => d.class === "PUBLISHED_ONLY").map((d) => d.chunkId)).toEqual(["z"]);
  });
  it.each([
    ["8. path", { path: "other.md" }, "path"],
    ["9. index", { index: 5 }, "index"],
    ["10. textHash", { textHash: "changed" }, "textHash"],
  ] as const)("%s METADATA_MISMATCH", (_label, override, field) => {
    const result = compareLegacyAndPublished({ level: "L2", legacy: legacySnapshot([legacyRecord("a", [1, 2], override)]), published: publishedSnapshot([publishedMeta("a")], [1, 2], identity) });
    const divergence = result.divergences.find((d) => d.class === "METADATA_MISMATCH" && d.chunkId === "a");
    expect(divergence?.field).toBe(field);
  });
  it("11. detects VECTOR_MISMATCH with a compact report", () => {
    const { published } = base();
    const result = compareLegacyAndPublished({ level: "L2", legacy: legacySnapshot([legacyRecord("a", [1, 2]), legacyRecord("b", [3, 99])]), published });
    expect(result.divergences).toEqual([{ class: "VECTOR_MISMATCH", chunkId: "b", field: "embedding[1]", legacyValue: 99, publishedValue: 4, impact: "1 of 2 components differ" }]);
  });
  it("12. treats float64 legacy values equal to their float32 rounding as equivalent, without tolerance", () => {
    const legacy = legacySnapshot([legacyRecord("a", [0.1, 1 / 3])]);
    const published = publishedSnapshot([publishedMeta("a")], [Math.fround(0.1), Math.fround(1 / 3)]);
    expect(compareLegacyAndPublished({ level: "L2", legacy, published }).equivalent).toBe(true);
    const off = publishedSnapshot([publishedMeta("a")], [Math.fround(0.1), Math.fround(1 / 3) + 1e-7]);
    expect(classes(compareLegacyAndPublished({ level: "L2", legacy, published: off }))).toEqual(["VECTOR_MISMATCH"]);
  });
  it("13. detects DIMENSION_MISMATCH per record and for a wrong published buffer", () => {
    const perRecord = compareLegacyAndPublished({ level: "L2", legacy: legacySnapshot([legacyRecord("a", [1, 2, 3])]), published: publishedSnapshot([publishedMeta("a")], [1, 2]) });
    expect(perRecord.divergences).toEqual([{ class: "DIMENSION_MISMATCH", chunkId: "a", field: "embedding.length", legacyValue: 3, publishedValue: 2 }]);
    const buffer = compareLegacyAndPublished({ level: "L2", legacy: legacySnapshot([legacyRecord("a", [1, 2])]), published: publishedSnapshot([publishedMeta("a")], [1, 2, 3]) });
    expect(buffer.divergences.some((d) => d.class === "DIMENSION_MISMATCH" && d.field === "vectors.length")).toBe(true);
  });
  it("14. detects CONTRACT_MISMATCH at L2", () => {
    const { legacy, published } = base();
    const result = compareLegacyAndPublished({ level: "L2", legacy, published: { ...published, identity: { ...identity, vectorContractId: "vec:other" } } });
    expect(result.divergences).toEqual([{ class: "CONTRACT_MISMATCH", field: "vectorContractId", legacyValue: "vec:abc", publishedValue: "vec:other" }]);
  });
  it("15. detects HASH_MISMATCH only for hashes present on both sides, without recomputing", () => {
    const { legacy, published } = base();
    const result = compareLegacyAndPublished({
      level: "L2",
      legacy: { ...legacy, identity: { ...identity, hashes: { vectorsSha256: "aaa", onlyLegacy: "x" } } },
      published: { ...published, identity: { ...identity, hashes: { vectorsSha256: "bbb", recordsSha256: "y" } } },
    });
    expect(result.divergences).toEqual([{ class: "HASH_MISMATCH", field: "hashes.vectorsSha256", legacyValue: "aaa", publishedValue: "bbb" }]);
  });
  it("16. reports a duplicated legacy chunkId instead of overwriting silently", () => {
    const { published } = base();
    const result = compareLegacyAndPublished({ level: "L2", legacy: legacySnapshot([legacyRecord("a", [1, 2]), legacyRecord("a", [9, 9]), legacyRecord("b", [3, 4])]), published });
    const duplicates = result.divergences.filter((d) => d.class === "DUPLICATE_IDENTITY");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ class: "DUPLICATE_IDENTITY", chunkId: "a", side: "legacy", occurrences: 2 });
    expect(duplicates[0]?.impact).toContain("excluded");
    // The extra physical record is also visible as a cardinality difference; nothing else diverges.
    expect(classes(result).sort()).toEqual(["DUPLICATE_IDENTITY", "METADATA_MISMATCH"]);
    expect(result.divergences.find((d) => d.class === "METADATA_MISMATCH")).toMatchObject({ field: "recordCount", legacyValue: 3, publishedValue: 2 });
  });
  it("17. reports a duplicated published chunkId", () => {
    const { legacy } = base();
    const result = compareLegacyAndPublished({ level: "L2", legacy, published: publishedSnapshot([publishedMeta("a"), publishedMeta("a"), publishedMeta("b")], [1, 2, 1, 2, 3, 4]) });
    expect(result.divergences.find((d) => d.class === "DUPLICATE_IDENTITY")).toMatchObject({ chunkId: "a", side: "published", occurrences: 2 });
    expect(result.summary.countsByClass.DUPLICATE_IDENTITY).toBe(1);
  });
  it("18. accumulates simultaneous divergences with exact counts and bounded reports", () => {
    const legacy = legacySnapshot([legacyRecord("a", [1, 2], { path: "x.md" }), legacyRecord("b", [3, 0]), legacyRecord("only-l", [1, 1])]);
    const published = publishedSnapshot([publishedMeta("a"), publishedMeta("b"), publishedMeta("only-p")], [1, 2, 3, 4, 5, 6], { ...identity, provider: "ollama" });
    const result = compareLegacyAndPublished({ level: "L2", legacy, published });
    expect(result.equivalent).toBe(false);
    expect(result.summary.countsByClass).toEqual({ CONTRACT_MISMATCH: 1, METADATA_MISMATCH: 1, VECTOR_MISMATCH: 1, LEGACY_ONLY: 1, PUBLISHED_ONLY: 1 });
    const bounded = compareLegacyAndPublished({ level: "L2", legacy, published, maxReportedDivergences: 2 });
    expect(bounded.divergences).toHaveLength(2);
    expect(bounded.summary).toMatchObject({ divergenceCount: 5, truncated: true });
  });
  it("19. treats empty datasets as equivalent", () => {
    const result = compareLegacyAndPublished({ level: "L2", legacy: { identity: { dimensions: 2 }, records: [] }, published: { identity: { dimensions: 2 }, records: [], vectors: new Float32Array(0) } });
    expect(result).toMatchObject({ equivalent: true, summary: { legacyCount: 0, publishedCount: 0, divergenceCount: 0 } });
  });
  it("reports READ_ERROR per side and stops comparing", () => {
    const { legacy } = base();
    const result = compareLegacyAndPublished({ level: "L2", legacy, published: { readError: "HASH_MISMATCH: vectors" } });
    expect(result.divergences).toEqual([{ class: "READ_ERROR", side: "published", field: "read", publishedValue: "HASH_MISMATCH: vectors" }]);
    const both = compareLegacyAndPublished({ level: "L1", legacy: { readError: "jsonl-read-failed" }, published: { readError: "NO_CURRENT" } });
    expect(both.divergences.map((d) => d.side)).toEqual(["legacy", "published"]);
  });
  it("does not invent embeddingInputHash: records without it compare as equivalent", () => {
    const { legacy, published } = base();
    expect(JSON.stringify(legacy)).not.toContain("embeddingInputHash");
    expect(JSON.stringify(published.records)).not.toContain("embeddingInputHash");
    expect(compareLegacyAndPublished({ level: "L2", legacy, published }).equivalent).toBe(true);
  });
  it("is deterministic and does not mutate its inputs", () => {
    const input = { level: "L2" as const, ...base() };
    const frozen = JSON.stringify(input.legacy) + Array.from(input.published.vectors ?? []).join(",");
    const first = compareLegacyAndPublished(input);
    const second = compareLegacyAndPublished(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(input.legacy) + Array.from(input.published.vectors ?? []).join(",")).toBe(frozen);
  });
  it("maps Reader results: OK becomes a snapshot, any other status becomes READ_ERROR", () => {
    const ok = publishedSnapshotFromReadResult({
      status: "OK", providerCalls: 0,
      index: { generationId: "generation-000001", vectorContractId: "vec:abc", dimensions: 2, count: 1, vectors: new Float32Array([1, 2]), records: [{ chunkId: "a", path: "a.md", index: 0, textHash: "h-a" }], provider: "mistral", model: "mistral-embed" },
    });
    expect(ok.identity).toMatchObject({ recordCount: 1, dtype: "float32", vectorContractId: "vec:abc" });
    expect(compareLegacyAndPublished({ level: "L2", legacy: legacySnapshot([legacyRecord("a", [1, 2])]), published: ok }).equivalent).toBe(true);
    expect(publishedSnapshotFromReadResult({ status: "TARGET_PARTIAL", detail: "vectors.bin missing", providerCalls: 0 })).toEqual({ readError: "TARGET_PARTIAL: vectors.bin missing" });
  });
});

describe("M5B golden fixture from the M4 builder", () => {
  const contractId = computeVectorContractId({ provider: "p", model: "m", dimensions: 3, prefixMode: "none", inputVersion: 1 });
  const space: EmbeddingSpaceRecord = { spaceId: "s", provider: "p", model: "m", dimensions: 3, vectorContractId: contractId, inputVersion: 1, prefixMode: "none", createdAt: "t", updatedAt: "t", sourceProvenance: { sourceTextGenerationId: "text-1", sourceChunksDigest: "sha256:chunks", sourcePublicationId: "pub-1", sourceRecordCount: 3 }, publicationProducerProvenance: { producerDeviceId: "dev-123e4567-e89b-42d3-a456-426614174000", producerEpoch: 1 } };
  const vectors: Record<string, number[]> = { "b::0": [0.1, 0.2, 0.3], "a::1": [1 / 3, -2.5, 1e-8], "a::0": [4, 5, 6] };
  const source: ProducerEmbeddingRecord[] = [
    { chunkId: "b::0", notePath: "B.md", chunkIndex: 0 },
    { chunkId: "a::1", notePath: "A.md", chunkIndex: 1 },
    { chunkId: "a::0", notePath: "A.md", chunkIndex: 0 },
  ].map((entry) => ({ ...entry, spaceId: "s", textHash: `h-${entry.chunkId}`, vectorContractId: contractId, embeddingInputHash: `input-${entry.chunkId}`, embeddingBlob: new Float32Array(vectors[entry.chunkId] as number[]), createdAt: "t", updatedAt: "t" }));
  const built = buildImmutableGeneration(space, source, 1, "2026-10-05T00:00:00.000Z");
  const published: PublishedEquivalenceSnapshot = {
    identity: { recordCount: built.manifest.recordCount, dimensions: built.manifest.dimensions, provider: built.manifest.provider, model: built.manifest.model, vectorContractId: built.manifest.vectorContractId, dtype: built.manifest.dtype },
    records: built.records.map((record) => ({ chunkId: record.chunkId, path: record.notePath, index: record.chunkIndex, textHash: record.textHash })),
    vectors: new Float32Array(built.vectors.buffer.slice(built.vectors.byteOffset, built.vectors.byteOffset + built.vectors.byteLength)),
  };
  const legacyIdentity: EquivalenceIdentity = { recordCount: 3, dimensions: 3, provider: "p", model: "m", vectorContractId: contractId, dtype: "float32" };
  const legacy = (): LegacyEquivalenceSnapshot => ({
    identity: legacyIdentity,
    records: source.map((record) => ({ chunkId: record.chunkId, path: record.notePath, index: record.chunkIndex, textHash: record.textHash, embedding: vectors[record.chunkId] as number[] })),
  });

  it("legacy insertion order and float64 values are equivalent to the builder output at L1 and L2", () => {
    expect(built.records.map((record) => record.chunkId)).toEqual(["a::0", "a::1", "b::0"]); // builder order differs from legacy order
    expect(compareLegacyAndPublished({ level: "L1", legacy: legacy(), published }).equivalent).toBe(true);
    expect(compareLegacyAndPublished({ level: "L2", legacy: legacy(), published }).equivalent).toBe(true);
  });
  it("a tampered legacy vector is caught against the golden generation", () => {
    const tampered = legacy();
    (tampered.records as LegacyEquivalenceRecord[])[1] = { ...(tampered.records as LegacyEquivalenceRecord[])[1] as LegacyEquivalenceRecord, embedding: [1 / 3, -2.5, 2e-8] };
    const result = compareLegacyAndPublished({ level: "L2", legacy: tampered, published });
    expect(result.divergences).toMatchObject([{ class: "VECTOR_MISMATCH", chunkId: "a::1", field: "embedding[2]" }]);
  });
});

describe("M5B architectural guards", () => {
  const source = readFileSync("src/index/publishedGenerationEquivalence.ts", "utf8");
  const importLines = source.split("\n").filter((line) => /^\s*import\b|\brequire\(|\bimport\(/.test(line));
  it("20. is pure: no node:*, SQLite, DataAdapter, provider, Writer, recovery or UI imports", () => {
    expect(importLines).toEqual(['import type { PublishedGenerationReadResult } from "./publishedGenerationReader";']);
    for (const forbidden of ["node:", "sqlite", "DataAdapter", "obsidian", "PublishedGenerationWriter", "publishedGenerationWriter", "recoverPublishedGenerationPointer", "fetch(", "requestUrl", "crypto", "createHash", "linaSearchView", "Modal"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
  it("has no I/O, timers or global state", () => {
    for (const forbidden of ["readFile", "writeFile", "adapter", "setTimeout", "Date.now", "Math.random", "localStorage", "console."]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
