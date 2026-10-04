/**
 * SQLite Producer Shadow Writer (Phase M1)
 *
 * Coordinates non-authoritative shadow writes to private SQLite storage.
 *
 * Invariants:
 * 1. Non-Authoritative: Failure in shadow write NEVER invalidates or fails legacy operations.
 * 2. Active Producer Only: Only executed on Active Producer instances (device role = producer).
 * 3. Feature Flag Guarded: Obey `producerSqliteShadowWriteEnabled` flag.
 * 4. Zero Consumer Dependency: Consumer and Companion devices never execute shadow writes.
 */

import { SqliteProducerLocalStore } from "./sqliteProducerLocalStore";
import type { EmbeddingRecord, EmbeddingPublicationInfo } from "./embeddingPersistence";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "./producerLocalStoreTypes";

export interface ShadowWriteOptions {
  readonly enabled?: boolean;
  readonly deviceRole?: "producer" | "companion";
  readonly store?: SqliteProducerLocalStore;
  readonly onDiagnostic?: (result: { success: boolean; recordsCount: number; errorSummary?: string }) => void;
}

export interface ShadowWriteResult {
  readonly attempted: boolean;
  readonly success: boolean;
  readonly recordsCount: number;
  readonly errorSummary?: string;
}

export function buildSpaceRecordFromPublication(
  info: EmbeddingPublicationInfo,
  records: readonly EmbeddingRecord[]
): EmbeddingSpaceRecord {
  const spaceId = `${info.provider}:${info.model}:${info.dimensions}`;
  const now = new Date().toISOString();
  return {
    spaceId,
    provider: info.provider,
    model: info.model,
    dimensions: info.dimensions,
    vectorContractId: `vc-${info.provider}-${info.model}-${info.dimensions}`,
    inputVersion: info.inputVersion ?? 1,
    prefixMode: info.prefixMode ?? "none",
    createdAt: now,
    updatedAt: now,
  };
}

export function buildProducerRecordsFromPublication(
  spaceId: string,
  records: readonly EmbeddingRecord[]
): ProducerEmbeddingRecord[] {
  const now = new Date().toISOString();
  return records.map((rec) => {
    const float32 = rec.embedding instanceof Float32Array
      ? rec.embedding
      : new Float32Array(rec.embedding);
    return {
      chunkId: rec.chunkId,
      spaceId,
      notePath: rec.path,
      chunkIndex: rec.index,
      textHash: rec.textHash,
      inputHash: rec.embeddingInputHash ?? rec.textHash,
      embeddingBlob: float32,
      createdAt: rec.createdAt || now,
      updatedAt: now,
    };
  });
}

export async function performProducerSqliteShadowWrite(
  records: readonly EmbeddingRecord[],
  info: EmbeddingPublicationInfo,
  options: ShadowWriteOptions
): Promise<ShadowWriteResult> {
  const isEnabled = options.enabled ?? false;
  const isProducer = (options.deviceRole ?? "producer") === "producer";

  if (!isEnabled || !isProducer) {
    return { attempted: false, success: true, recordsCount: 0 };
  }

  const store = options.store;
  if (!store) {
    return { attempted: false, success: true, recordsCount: 0 };
  }

  try {
    if (!store.isOpen) {
      store.open();
    }
    const space = buildSpaceRecordFromPublication(info, records);
    const producerRecords = buildProducerRecordsFromPublication(space.spaceId, records);

    store.upsertEmbeddingBatch(space, producerRecords);

    options.onDiagnostic?.({
      success: true,
      recordsCount: producerRecords.length,
    });

    return {
      attempted: true,
      success: true,
      recordsCount: producerRecords.length,
    };
  } catch (err) {
    const errorSummary = err instanceof Error ? err.message : String(err);

    options.onDiagnostic?.({
      success: false,
      recordsCount: records.length,
      errorSummary,
    });

    // Shadow write failure NEVER throws or fails the caller
    return {
      attempted: true,
      success: false,
      recordsCount: records.length,
      errorSummary,
    };
  }
}
