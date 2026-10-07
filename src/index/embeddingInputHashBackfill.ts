import { buildEmbeddingInput } from "./embeddingGenerator";
import type { Chunk } from "./chunker";
import { hashContent } from "./noteHasher";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "./producerLocalStoreTypes";
import type { SqliteProducerLocalStore } from "./sqliteProducerLocalStore";

export type EmbeddingInputHashBackfillStatus =
  | "BACKFILLED_VERIFIED"
  | "ALREADY_PRESENT"
  | "NOT_RECOVERABLE"
  | "AMBIGUOUS"
  | "SOURCE_MISSING"
  | "SOURCE_CHANGED";

export interface EmbeddingInputHashBackfillItem {
  readonly chunkId: string;
  readonly status: EmbeddingInputHashBackfillStatus;
  readonly embeddingInputHash?: string;
}

export interface EmbeddingInputHashBackfillPlan {
  readonly items: readonly EmbeddingInputHashBackfillItem[];
  readonly providerCalls: 0;
  readonly counts: Readonly<Record<EmbeddingInputHashBackfillStatus, number>>;
}

export interface EmbeddingInputHashBackfillResult extends EmbeddingInputHashBackfillPlan {
  readonly applied: boolean;
}

function counts(): Record<EmbeddingInputHashBackfillStatus, number> {
  return {
    BACKFILLED_VERIFIED: 0,
    ALREADY_PRESENT: 0,
    NOT_RECOVERABLE: 0,
    AMBIGUOUS: 0,
    SOURCE_MISSING: 0,
    SOURCE_CHANGED: 0,
  };
}

/**
 * Plans a provider-free repair. A hash is emitted only when the current chunk
 * is unique and still exactly identifies the source used by the stored vector.
 */
export function planEmbeddingInputHashBackfill(
  records: readonly ProducerEmbeddingRecord[],
  chunks: readonly Chunk[],
  prefixMode: "none" | "nomic-search-query-document"
): EmbeddingInputHashBackfillPlan {
  const byId = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const entries = byId.get(chunk.chunkId);
    if (entries) entries.push(chunk);
    else byId.set(chunk.chunkId, [chunk]);
  }
  const result = counts();
  const items = records.map((record): EmbeddingInputHashBackfillItem => {
    if (record.embeddingInputHash) {
      result.ALREADY_PRESENT++;
      return { chunkId: record.chunkId, status: "ALREADY_PRESENT" };
    }
    const candidates = byId.get(record.chunkId) ?? [];
    if (candidates.length === 0) {
      result.SOURCE_MISSING++;
      return { chunkId: record.chunkId, status: "SOURCE_MISSING" };
    }
    if (candidates.length !== 1) {
      result.AMBIGUOUS++;
      return { chunkId: record.chunkId, status: "AMBIGUOUS" };
    }
    const chunk = candidates[0];
    if (chunk.path !== record.notePath || chunk.chunkIndex !== record.chunkIndex) {
      result.AMBIGUOUS++;
      return { chunkId: record.chunkId, status: "AMBIGUOUS" };
    }
    if (chunk.textHash !== record.textHash) {
      result.SOURCE_CHANGED++;
      return { chunkId: record.chunkId, status: "SOURCE_CHANGED" };
    }
    const embeddingInputHash = hashContent(buildEmbeddingInput(chunk, prefixMode));
    if (!embeddingInputHash) {
      result.NOT_RECOVERABLE++;
      return { chunkId: record.chunkId, status: "NOT_RECOVERABLE" };
    }
    result.BACKFILLED_VERIFIED++;
    return { chunkId: record.chunkId, status: "BACKFILLED_VERIFIED", embeddingInputHash };
  });
  return { items, providerCalls: 0, counts: result };
}

/**
 * Applies a precomputed plan as one SQLite replacement transaction. A failed
 * write is delegated to the store's rollback boundary; no partial hash update
 * can be observed. It is idempotent because already-populated rows are kept.
 */
export function applyEmbeddingInputHashBackfill(
  store: SqliteProducerLocalStore,
  space: EmbeddingSpaceRecord,
  records: readonly ProducerEmbeddingRecord[],
  plan: EmbeddingInputHashBackfillPlan
): EmbeddingInputHashBackfillResult {
  const hashes = new Map(
    plan.items
      .filter((item) => item.status === "BACKFILLED_VERIFIED" && item.embeddingInputHash)
      .map((item) => [item.chunkId, item.embeddingInputHash!] as const),
  );
  if (hashes.size === 0) return { ...plan, applied: false };
  const updated = records.map((record) => ({
    ...record,
    embeddingInputHash: record.embeddingInputHash ?? hashes.get(record.chunkId),
  }));
  store.replaceAllRecords(space, updated);
  return { ...plan, applied: true };
}
