import { describe, expect, it } from "vitest";
import { PublishedRuntimeEmbeddingIndexCache } from "../../src/search/publishedRuntimeEmbeddingIndexCache";

const published = (generationId: string, contract = "vec:one") => ({
  generationId, vectorContractId: contract, dimensions: 2, count: 1,
  vectors: new Float32Array([1, 2]), records: [{ chunkId: "chunk", path: "note.md", index: 0, textHash: "text", embeddingInputHash: "input" }],
  provider: "ollama", model: "model", inputVersion: 1 as const, prefixMode: "none" as const,
  sourceTextGenerationId: "text", sourceChunksDigest: "digest", sourcePublicationId: "publication", sourceRecordCount: 1,
  producerDeviceId: "producer", producerEpoch: 1,
});

describe("M6 published runtime cache", () => {
  it("keeps a published-v5 identity distinct from legacy and includes generation provenance", () => {
    const cache = new PublishedRuntimeEmbeddingIndexCache();
    const index = cache.getOrCreate(published("generation-000001"));
    expect(index.sourceIdentity).toMatchObject({ storageFormat: "published-v5", generationId: "generation-000001", vectorContractId: "vec:one", sourceTextGenerationId: "text", sourceChunksDigest: "digest", sourcePublicationId: "publication", producerDeviceId: "producer", producerEpoch: 1 });
  });

  it("never returns a cached index after CURRENT identifies another generation", () => {
    const cache = new PublishedRuntimeEmbeddingIndexCache();
    const first = cache.getOrCreate(published("generation-000001"));
    const second = cache.getOrCreate(published("generation-000002"));
    expect(second).not.toBe(first);
    expect(second.sourceIdentity.generationId).toBe("generation-000002");
  });
});
