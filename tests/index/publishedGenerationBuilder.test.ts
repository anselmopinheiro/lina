import { describe, expect, it } from "vitest";
import { buildImmutableGeneration, validateBuiltGeneration } from "../../src/index/publishedGenerationBuilder";
import { computeVectorContractId } from "../../src/index/vectorContract";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "../../src/index/producerLocalStoreTypes";
const contractId = computeVectorContractId({ provider: "p", model: "m", dimensions: 2, prefixMode: "none", inputVersion: 1 });
const space: EmbeddingSpaceRecord = { spaceId: "s", provider: "p", model: "m", dimensions: 2, vectorContractId: contractId, inputVersion: 1, prefixMode: "none", createdAt: "t", updatedAt: "t", sourceProvenance: { sourceTextGenerationId: "text-1", sourceChunksDigest: "sha256:chunks", sourcePublicationId: "pub-1", sourceRecordCount: 1 }, publicationProducerProvenance: { producerDeviceId: "dev-123e4567-e89b-42d3-a456-426614174000", producerEpoch: 1 } };
function record(id: string, path: string, index: number): ProducerEmbeddingRecord { return { chunkId: id, spaceId: "s", notePath: path, chunkIndex: index, textHash: `h-${id}`, vectorContractId: contractId, embeddingInputHash: `input-${id}`, embeddingBlob: new Float32Array([index, index + 1]), createdAt: "t", updatedAt: "t" }; }
describe("M4 immutable generations", () => {
  it("rejects missing or inconsistent G2 source provenance", () => {
    expect(() => buildImmutableGeneration({ ...space, sourceProvenance: undefined }, [record("a", "A.md", 0)], 1)).toThrow("SOURCE_TEXT_GENERATION_MISSING");
    expect(() => buildImmutableGeneration({ ...space, sourceProvenance: { ...space.sourceProvenance!, sourceRecordCount: 9 } }, [record("a", "A.md", 0)], 1)).toThrow("SOURCE_RECORD_COUNT_MISMATCH");
  });
  it("builds deterministic validated Float32 generation", () => { const sourceSpace = { ...space, sourceProvenance: { ...space.sourceProvenance!, sourceRecordCount: 2 } }; const a = buildImmutableGeneration(sourceSpace, [record("b", "B.md", 0), record("a", "A.md", 1)], 1, "2026-10-05T00:00:00.000Z"); const b = buildImmutableGeneration(sourceSpace, [record("a", "A.md", 1), record("b", "B.md", 0)], 1, "2026-10-05T00:00:00.000Z"); expect(validateBuiltGeneration(a)).toBeNull(); expect(a.vectors).toEqual(b.vectors); expect(a.manifest.vectorsSha256).toBe(b.manifest.vectorsSha256); expect(a.records[0]?.chunkId).toBe("a"); });
  it("rejects invalid dimension and detects corrupt vectors", () => { expect(() => buildImmutableGeneration(space, [{ ...record("a", "A.md", 0), embeddingBlob: new Float32Array([1]) }], 1)).toThrow("Dimension mismatch"); const built = buildImmutableGeneration(space, [record("a", "A.md", 0)], 1); built.vectors[0] = 9; expect(validateBuiltGeneration(built)).toBe("checksum-or-size"); });
  it("publishes v5 with an exact, recomputable input contract and producer provenance", () => {
    const built = buildImmutableGeneration(space, [record("a", "A.md", 0)], 1, "2026-10-06T00:00:00.000Z");
    expect(built.manifest).toMatchObject({ formatVersion: 5, metric: "cosine", inputVersion: 1, prefixMode: "none", vectorContractId: contractId, sourceTextGenerationId: "text-1", producerEpoch: 1 });
    expect(validateBuiltGeneration(built)).toBeNull();
    expect(() => buildImmutableGeneration({ ...space, vectorContractId: "vec:wrong" }, [record("a", "A.md", 0)], 1)).toThrow("Vector contract mismatch");
  });
});
