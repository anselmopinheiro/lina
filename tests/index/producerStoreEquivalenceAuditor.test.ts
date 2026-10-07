import { describe, expect, it } from "vitest";
import {
  auditProducerStoreEquivalence,
  bootstrapLegacyEmbeddingsToShadow,
  type BootstrapStore,
  type ComparableEmbeddingRecord,
} from "../../src/index/producerStoreEquivalenceAuditor";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "../../src/index/producerLocalStoreTypes";

function comparable(id: string, overrides: Partial<ComparableEmbeddingRecord> = {}): ComparableEmbeddingRecord {
  return { chunkId: id, notePath: `${id}.md`, textHash: `hash-${id}`, vectorContractId: "vc-a", dimensions: 2, dtype: "float32", embedding: new Float32Array([1, 2]), ...overrides };
}
const space: EmbeddingSpaceRecord = { spaceId: "s", provider: "p", model: "m", dimensions: 2, vectorContractId: "vc-a", inputVersion: 1, prefixMode: "none", createdAt: "t", updatedAt: "t" };
function producer(id: string): ProducerEmbeddingRecord { return { chunkId: id, spaceId: "s", notePath: `${id}.md`, chunkIndex: 0, textHash: `hash-${id}`, vectorContractId: "vc-a", embeddingInputHash: `input-${id}`, embeddingBlob: new Float32Array([1, 2]), createdAt: "t", updatedAt: "t" }; }

class FakeStore implements BootstrapStore {
  isOpen = false;
  records = new Map<string, ProducerEmbeddingRecord>();
  batches = 0;
  open(): void { this.isOpen = true; }
  getEmbeddingRecord(id: string): ProducerEmbeddingRecord | null { return this.records.get(id) ?? null; }
  upsertEmbeddingBatch(_space: EmbeddingSpaceRecord, records: readonly ProducerEmbeddingRecord[]): void { this.batches++; for (const record of records) this.records.set(record.chunkId, record); }
}

describe("M2 producer store equivalence", () => {
  it("treats empty and byte-identical stores as equivalent", () => {
    expect(auditProducerStoreEquivalence([], []).isEquivalent).toBe(true);
    expect(auditProducerStoreEquivalence([comparable("a")], [comparable("a")])).toMatchObject({ isEquivalent: true, matchedCount: 1 });
  });
  it.each([
    [[comparable("a")], [], "LEGACY_ONLY"],
    [[], [comparable("a")], "SQLITE_ONLY"],
    [[comparable("a", { notePath: "other.md" })], [comparable("a")], "METADATA_MISMATCH"],
    [[comparable("a", { embedding: new Float32Array([2, 1]) })], [comparable("a")], "VECTOR_MISMATCH"],
    [[comparable("a", { dimensions: 3 })], [comparable("a")], "DIMENSION_MISMATCH"],
    [[comparable("a", { vectorContractId: "vc-b" })], [comparable("a")], "CONTRACT_MISMATCH"],
  ])("classifies %s", (legacy, sqlite, kind) => {
    expect(auditProducerStoreEquivalence(legacy as ComparableEmbeddingRecord[], sqlite as ComparableEmbeddingRecord[]).divergences[0]?.kind).toBe(kind);
  });
  it("reports duplicate identities", () => {
    expect(auditProducerStoreEquivalence([comparable("a"), comparable("a")], []).divergences[0]?.kind).toBe("DUPLICATE_IDENTITY");
  });
  it("bootstraps only missing records in batches without provider access", () => {
    const store = new FakeStore();
    const result = bootstrapLegacyEmbeddingsToShadow(store, space, [producer("a"), producer("b"), producer("c")], { enabled: true, batchSize: 2 });
    expect(result).toMatchObject({ attempted: true, processed: 3, batches: 2, conflicts: [] });
    expect(store.records.size).toBe(3);
    expect(bootstrapLegacyEmbeddingsToShadow(store, space, [producer("a"), producer("b"), producer("c")], { enabled: true }).processed).toBe(0);
  });
  it("does not overwrite conflicts and is Active Producer/flag gated", () => {
    const store = new FakeStore(); store.records.set("a", producer("a")); store.records.set("a", { ...producer("a"), textHash: "different" });
    expect(bootstrapLegacyEmbeddingsToShadow(store, space, [producer("a")], { enabled: true }).conflicts).toEqual(["a"]);
    expect(bootstrapLegacyEmbeddingsToShadow(new FakeStore(), space, [producer("a")], { enabled: false }).attempted).toBe(false);
    expect(bootstrapLegacyEmbeddingsToShadow(new FakeStore(), space, [producer("a")], { enabled: true, deviceRole: "companion" }).attempted).toBe(false);
  });
});
