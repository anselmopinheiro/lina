import { describe, expect, it, vi } from "vitest";
import { buildEmbeddingInput } from "../../src/index/embeddingGenerator";
import { applyEmbeddingInputHashBackfill, planEmbeddingInputHashBackfill } from "../../src/index/embeddingInputHashBackfill";
import { hashContent } from "../../src/index/noteHasher";
import type { Chunk } from "../../src/index/chunker";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "../../src/index/producerLocalStoreTypes";
import type { SqliteProducerLocalStore } from "../../src/index/sqliteProducerLocalStore";

const chunk = (overrides: Partial<Chunk> = {}): Chunk => ({ chunkId: "a::0", path: "a.md", chunkIndex: 0, text: "verified chunk text", textHash: hashContent("verified chunk text"), createdAt: "t", ...overrides });
const record = (overrides: Partial<ProducerEmbeddingRecord> = {}): ProducerEmbeddingRecord => ({ chunkId: "a::0", spaceId: "s", notePath: "a.md", chunkIndex: 0, textHash: chunk().textHash, vectorContractId: "vc-real", embeddingBlob: new Float32Array([1, 2]), createdAt: "t", updatedAt: "t", ...overrides });
const space: EmbeddingSpaceRecord = { spaceId: "s", provider: "ollama", model: "nomic", dimensions: 2, vectorContractId: "vc-real", inputVersion: 1, prefixMode: "none", createdAt: "t", updatedAt: "t" };

describe("G6 deterministic embeddingInputHash backfill", () => {
  it("backfills only a verified unchanged chunk with zero provider calls", () => {
    const plan = planEmbeddingInputHashBackfill([record()], [chunk()], "none");
    expect(plan).toMatchObject({ providerCalls: 0, counts: { BACKFILLED_VERIFIED: 1 } });
    expect(plan.items[0]).toMatchObject({ status: "BACKFILLED_VERIFIED", embeddingInputHash: hashContent(buildEmbeddingInput(chunk(), "none")) });
  });

  it("keeps existing hashes and never invents one for changed, missing, or ambiguous source", () => {
    const present = planEmbeddingInputHashBackfill([record({ embeddingInputHash: "already-real" })], [chunk()], "none");
    expect(present.items[0]?.status).toBe("ALREADY_PRESENT");
    expect(planEmbeddingInputHashBackfill([record()], [chunk({ textHash: "changed" })], "none").items[0]?.status).toBe("SOURCE_CHANGED");
    expect(planEmbeddingInputHashBackfill([record()], [], "none").items[0]?.status).toBe("SOURCE_MISSING");
    expect(planEmbeddingInputHashBackfill([record()], [chunk(), chunk()], "none").items[0]?.status).toBe("AMBIGUOUS");
  });

  it("applies all verified values through one replace transaction and is idempotent", () => {
    const replaceAllRecords = vi.fn();
    const store = { replaceAllRecords } as unknown as SqliteProducerLocalStore;
    const original = record();
    const plan = planEmbeddingInputHashBackfill([original], [chunk()], "none");
    expect(applyEmbeddingInputHashBackfill(store, space, [original], plan)).toMatchObject({ applied: true, providerCalls: 0 });
    expect(replaceAllRecords).toHaveBeenCalledTimes(1);
    const updated = replaceAllRecords.mock.calls[0]?.[1] as ProducerEmbeddingRecord[];
    expect(updated[0]?.embeddingInputHash).toBe(hashContent(buildEmbeddingInput(chunk(), "none")));
    const secondPlan = planEmbeddingInputHashBackfill(updated, [chunk()], "none");
    expect(applyEmbeddingInputHashBackfill(store, space, updated, secondPlan)).toMatchObject({ applied: false, counts: { ALREADY_PRESENT: 1 } });
    expect(replaceAllRecords).toHaveBeenCalledTimes(1);
  });

  it("does not conceal a transactional rollback failure", () => {
    const store = { replaceAllRecords: vi.fn(() => { throw new Error("rollback"); }) } as unknown as SqliteProducerLocalStore;
    const plan = planEmbeddingInputHashBackfill([record()], [chunk()], "none");
    expect(() => applyEmbeddingInputHashBackfill(store, space, [record()], plan)).toThrow("rollback");
  });
});
