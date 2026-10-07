/**
 * Producer Store Equivalence Auditor (Phase M2)
 *
 * Compares the legacy authoritative embedding store (embeddings.jsonl) against the
 * private SQLite shadow store (lina-producer.db) without modifying either store.
 *
 * Invariants:
 * 1. Non-Mutating: Never alters, repairs, or deletes records in either store.
 * 2. Strict Comparison: Compares identities, metadata, vector contracts, and float values.
 * 3. Categorized Divergences: Classifies every divergence into distinct, actionable categories.
 * 4. Zero Consumer Dependency: Pure TypeScript implementation, used exclusively by Active Producer diagnostics.
 */

import type { EmbeddingRecord } from "./embeddingPersistence";
import type { SqliteProducerLocalStore } from "./sqliteProducerLocalStore";
import type { ProducerEmbeddingRecord } from "./producerLocalStoreTypes";

export type DivergenceKind =
  | "LEGACY_ONLY"
  | "SQLITE_ONLY"
  | "METADATA_MISMATCH"
  | "VECTOR_MISMATCH"
  | "DIMENSION_MISMATCH"
  | "CONTRACT_MISMATCH"
  | "HASH_MISMATCH"
  | "INPUT_HASH_MISMATCH"
  | "DUPLICATE_IDENTITY"
  | "READ_ERROR";

export interface StoreDivergence {
  readonly chunkId: string;
  readonly type: DivergenceKind;
  readonly kind?: DivergenceKind;
  readonly notePath?: string;
  readonly details?: string;
}

export interface StoreEquivalenceReport {
  readonly legacyCount: number;
  readonly sqliteCount: number;
  readonly matchedCount: number;
  readonly divergenceCount: number;
  readonly divergences: readonly StoreDivergence[];
  readonly isEquivalent: boolean;
  readonly timestamp: string;
}

export function compareVectorsFloat32(
  v1: Float32Array | readonly number[],
  v2: Float32Array | readonly number[],
  tolerance = 1e-5
): boolean {
  if (v1.length !== v2.length) return false;
  for (let i = 0; i < v1.length; i++) {
    const diff = Math.abs(v1[i] - v2[i]);
    if (diff > tolerance && Math.abs(Math.fround(v1[i]) - Math.fround(v2[i])) > tolerance) {
      return false;
    }
  }
  return true;
}

export function auditStoreEquivalence(
  legacyRecords: readonly EmbeddingRecord[],
  sqliteStore: SqliteProducerLocalStore
): StoreEquivalenceReport {
  const divergences: StoreDivergence[] = [];
  const legacyMap = new Map<string, EmbeddingRecord>();
  const seenLegacyChunkIds = new Set<string>();

  // 1. Index legacy records and detect duplicate chunk IDs in legacy store
  for (const record of legacyRecords) {
    if (seenLegacyChunkIds.has(record.chunkId)) {
      divergences.push({
        chunkId: record.chunkId,
        type: "DUPLICATE_IDENTITY",
        notePath: record.path,
        details: `Duplicate chunkId '${record.chunkId}' detected in legacy embeddings.jsonl`,
      });
    } else {
      seenLegacyChunkIds.add(record.chunkId);
      legacyMap.set(record.chunkId, record);
    }
  }

  let matchedCount = 0;
  let sqliteCount = 0;

  try {
    sqliteCount = sqliteStore.isOpen ? sqliteStore.countRecords() : 0;
  } catch (err) {
    divergences.push({
      chunkId: "STORE_LEVEL",
      type: "READ_ERROR",
      details: `Failed to query SQLite record count: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 2. Audit all legacy records against SQLite shadow store
  if (sqliteStore.isOpen) {
    for (const legacyRec of legacyRecords) {
      try {
        const sqliteRec = sqliteStore.getEmbeddingRecord(legacyRec.chunkId);
        if (!sqliteRec) {
          divergences.push({
            chunkId: legacyRec.chunkId,
            type: "LEGACY_ONLY",
            notePath: legacyRec.path,
            details: `Chunk '${legacyRec.chunkId}' present in legacy embeddings.jsonl but missing in SQLite store`,
          });
          continue;
        }

        // Compare metadata
        if (sqliteRec.notePath !== legacyRec.path || sqliteRec.chunkIndex !== legacyRec.index) {
          divergences.push({
            chunkId: legacyRec.chunkId,
            type: "METADATA_MISMATCH",
            notePath: legacyRec.path,
            details: `Path or index mismatch: legacy (${legacyRec.path}:${legacyRec.index}) vs sqlite (${sqliteRec.notePath}:${sqliteRec.chunkIndex})`,
          });
          continue;
        }

        // Compare text hash
        if (sqliteRec.textHash !== legacyRec.textHash) {
          divergences.push({
            chunkId: legacyRec.chunkId,
            type: "HASH_MISMATCH",
            notePath: legacyRec.path,
            details: `Text hash mismatch: legacy (${legacyRec.textHash}) vs sqlite (${sqliteRec.textHash})`,
          });
          continue;
        }

        if (sqliteRec.embeddingInputHash !== legacyRec.embeddingInputHash) {
          divergences.push({
            chunkId: legacyRec.chunkId,
            type: "INPUT_HASH_MISMATCH",
            notePath: legacyRec.path,
            details: `Embedding input hash mismatch: legacy (${legacyRec.embeddingInputHash ?? "missing"}) vs sqlite (${sqliteRec.embeddingInputHash ?? "missing"})`,
          });
          continue;
        }

        // Compare dimensions
        const blobAsFloat32 = sqliteRec.embeddingBlob instanceof Float32Array
          ? sqliteRec.embeddingBlob
          : new Float32Array(sqliteRec.embeddingBlob);

        if (blobAsFloat32.length !== legacyRec.dimensions) {
          divergences.push({
            chunkId: legacyRec.chunkId,
            type: "DIMENSION_MISMATCH",
            notePath: legacyRec.path,
            details: `Vector dimension mismatch: legacy (${legacyRec.dimensions}) vs sqlite (${blobAsFloat32.length})`,
          });
          continue;
        }

        // Compare vector values
        const vectorsMatch = compareVectorsFloat32(legacyRec.embedding, blobAsFloat32);
        if (!vectorsMatch) {
          divergences.push({
            chunkId: legacyRec.chunkId,
            type: "VECTOR_MISMATCH",
            notePath: legacyRec.path,
            details: `Vector float content mismatch for chunk '${legacyRec.chunkId}'`,
          });
          continue;
        }

        matchedCount++;
      } catch (err) {
        divergences.push({
          chunkId: legacyRec.chunkId,
          type: "READ_ERROR",
          notePath: legacyRec.path,
          details: `Error reading SQLite record for '${legacyRec.chunkId}': ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  } else {
    for (const legacyRec of legacyRecords) {
      divergences.push({
        chunkId: legacyRec.chunkId,
        type: "LEGACY_ONLY",
        notePath: legacyRec.path,
        details: "SQLite store is not open; all legacy records marked as LEGACY_ONLY",
      });
    }
  }

  // 3. Detect SQLITE_ONLY records if SQLite count exceeds matched count
  if (sqliteStore.isOpen && sqliteCount > matchedCount) {
    const sqliteOnlyCount = sqliteCount - matchedCount;
    if (sqliteOnlyCount > 0 && divergences.filter((d) => d.type === "LEGACY_ONLY").length === 0 && divergences.length === 0) {
      divergences.push({
        chunkId: "SQLITE_EXTRA_RECORDS",
        type: "SQLITE_ONLY",
        details: `SQLite store contains ${sqliteOnlyCount} extra record(s) not present in legacy store`,
      });
    }
  }

  const divergenceCount = divergences.length;
  const isEquivalent = divergenceCount === 0 && legacyRecords.length === sqliteCount;

  return {
    legacyCount: legacyRecords.length,
    sqliteCount,
    matchedCount,
    divergenceCount,
    divergences,
    isEquivalent,
    timestamp: new Date().toISOString(),
  };
}

export type ComparableEmbeddingRecord = {
  chunkId: string;
  notePath: string;
  textHash: string;
  embeddingInputHash?: string;
  vectorContractId: string;
  dimensions: number;
  dtype: string;
  embedding: Float32Array;
};

export function auditProducerStoreEquivalence(
  legacy: readonly ComparableEmbeddingRecord[],
  sqlite: readonly ComparableEmbeddingRecord[]
): { isEquivalent: boolean; matchedCount: number; divergences: StoreDivergence[] } {
  const divergences: StoreDivergence[] = [];
  const seenLegacyIds = new Set<string>();

  for (const rec of legacy) {
    if (seenLegacyIds.has(rec.chunkId)) {
      divergences.push({
        chunkId: rec.chunkId,
        type: "DUPLICATE_IDENTITY",
        kind: "DUPLICATE_IDENTITY",
        notePath: rec.notePath,
      });
    } else {
      seenLegacyIds.add(rec.chunkId);
    }
  }

  const sqliteMap = new Map<string, ComparableEmbeddingRecord>();
  for (const rec of sqlite) {
    sqliteMap.set(rec.chunkId, rec);
  }

  let matchedCount = 0;

  for (const leg of legacy) {
    const sq = sqliteMap.get(leg.chunkId);
    if (!sq) {
      divergences.push({
        chunkId: leg.chunkId,
        type: "LEGACY_ONLY",
        kind: "LEGACY_ONLY",
        notePath: leg.notePath,
      });
      continue;
    }

    if (leg.notePath !== sq.notePath) {
      divergences.push({
        chunkId: leg.chunkId,
        type: "METADATA_MISMATCH",
        kind: "METADATA_MISMATCH",
        notePath: leg.notePath,
      });
      continue;
    }

    if (leg.textHash !== sq.textHash) {
      divergences.push({
        chunkId: leg.chunkId,
        type: "HASH_MISMATCH",
        kind: "HASH_MISMATCH",
        notePath: leg.notePath,
      });
      continue;
    }

    if (leg.embeddingInputHash !== sq.embeddingInputHash) {
      divergences.push({
        chunkId: leg.chunkId,
        type: "INPUT_HASH_MISMATCH",
        kind: "INPUT_HASH_MISMATCH",
        notePath: leg.notePath,
      });
      continue;
    }

    if (leg.dimensions !== sq.dimensions) {
      divergences.push({
        chunkId: leg.chunkId,
        type: "DIMENSION_MISMATCH",
        kind: "DIMENSION_MISMATCH",
        notePath: leg.notePath,
      });
      continue;
    }

    if (leg.vectorContractId !== sq.vectorContractId || leg.dtype !== sq.dtype) {
      divergences.push({
        chunkId: leg.chunkId,
        type: "CONTRACT_MISMATCH",
        kind: "CONTRACT_MISMATCH",
        notePath: leg.notePath,
      });
      continue;
    }

    if (!compareVectorsFloat32(leg.embedding, sq.embedding)) {
      divergences.push({
        chunkId: leg.chunkId,
        type: "VECTOR_MISMATCH",
        kind: "VECTOR_MISMATCH",
        notePath: leg.notePath,
      });
      continue;
    }

    matchedCount++;
  }

  const legacyIds = new Set(legacy.map((r) => r.chunkId));
  for (const sq of sqlite) {
    if (!legacyIds.has(sq.chunkId)) {
      divergences.push({
        chunkId: sq.chunkId,
        type: "SQLITE_ONLY",
        kind: "SQLITE_ONLY",
        notePath: sq.notePath,
      });
    }
  }

  const isEquivalent = divergences.length === 0 && legacy.length === sqlite.length;
  return { isEquivalent, matchedCount, divergences };
}

export interface BootstrapStore {
  isOpen: boolean;
  open(): void;
  getEmbeddingRecord?(id: string): ProducerEmbeddingRecord | null;
  records?: Map<string, ProducerEmbeddingRecord>;
  upsertEmbeddingBatch(space: import("./producerLocalStoreTypes").EmbeddingSpaceRecord, records: readonly ProducerEmbeddingRecord[]): void;
}

export interface BootstrapLegacyOptions {
  enabled?: boolean;
  deviceRole?: string;
  batchSize?: number;
}

export function bootstrapLegacyEmbeddingsToShadow(
  store: BootstrapStore,
  space: import("./producerLocalStoreTypes").EmbeddingSpaceRecord,
  records: readonly ProducerEmbeddingRecord[],
  options: BootstrapLegacyOptions = {}
): { attempted: boolean; processed: number; batches: number; conflicts: string[] } {
  if (options.enabled === false) {
    return { attempted: false, processed: 0, batches: 0, conflicts: [] };
  }
  if (options.deviceRole && options.deviceRole !== "producer") {
    return { attempted: false, processed: 0, batches: 0, conflicts: [] };
  }

  if (!store.isOpen) {
    store.open();
  }

  const conflicts: string[] = [];
  const toUpsert: ProducerEmbeddingRecord[] = [];

  for (const rec of records) {
    const existing = store.getEmbeddingRecord ? store.getEmbeddingRecord(rec.chunkId) : store.records?.get(rec.chunkId) ?? null;
    if (existing) {
      if (existing.textHash !== rec.textHash || existing.vectorContractId !== rec.vectorContractId || existing.embeddingInputHash !== rec.embeddingInputHash) {
        conflicts.push(rec.chunkId);
      }
    } else {
      toUpsert.push(rec);
    }
  }

  const batchSize = options.batchSize ?? 250;
  let batches = 0;
  let processed = 0;

  for (let i = 0; i < toUpsert.length; i += batchSize) {
    const chunk = toUpsert.slice(i, i + batchSize);
    store.upsertEmbeddingBatch(space, chunk);
    batches++;
    processed += chunk.length;
  }

  return { attempted: true, processed, batches, conflicts };
}
