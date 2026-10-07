import type { PublishedGenerationRuntimeIndex } from "../index/publishedGenerationReader";
import type { RuntimeEmbeddingIndex } from "./runtimeEmbeddingIndex";

/**
 * Read-only M6 cache. The caller always obtains a freshly validated reader
 * result first, so CURRENT changes cannot return an older generation.
 */
export class PublishedRuntimeEmbeddingIndexCache {
  private index: RuntimeEmbeddingIndex | null = null;
  private identity: string | null = null;

  getOrCreate(published: PublishedGenerationRuntimeIndex): RuntimeEmbeddingIndex {
    const identity = [
      published.generationId, published.vectorContractId, published.sourceTextGenerationId,
      published.sourceChunksDigest, published.sourcePublicationId, published.producerDeviceId,
      published.producerEpoch, published.count,
    ].join("|");
    if (this.index && this.identity === identity) return this.index;
    this.identity = identity;
    this.index = {
      dimensions: published.dimensions,
      count: published.count,
      vectors: published.vectors,
      records: [...published.records],
      provider: published.provider,
      model: published.model,
      sourceIdentity: {
        provider: published.provider,
        model: published.model,
        dimensions: published.dimensions,
        inputVersion: published.inputVersion ?? 1,
        prefixMode: published.prefixMode ?? "none",
        updatedAt: published.generationId,
        canonicalMtime: 0,
        canonicalSize: published.vectors.byteLength,
        storageFormat: "published-v5",
        publicationId: published.sourcePublicationId,
        generationId: published.generationId,
        vectorContractId: published.vectorContractId,
        sourceTextGenerationId: published.sourceTextGenerationId,
        sourceChunksDigest: published.sourceChunksDigest,
        sourcePublicationId: published.sourcePublicationId,
        producerDeviceId: published.producerDeviceId,
        producerEpoch: published.producerEpoch,
        currentIdentity: published.generationId,
      },
    };
    return this.index;
  }

  invalidate(): void { this.index = null; this.identity = null; }
}
