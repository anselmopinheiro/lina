/**
 * SQLite Producer Bootstrap (Phase M2)
 *
 * Populates the private SQLite shadow store from existing legacy records
 * without recalculating AI embeddings or contacting embedding providers.
 *
 * Invariants:
 * 1. ZERO AI Recalculation: Reads only existing legacy records; NEVER calls embedding generators or AI APIs.
 * 2. Active Producer Only: Executed strictly on Active Producer instances (deviceRole = producer).
 * 3. Feature Flag Guarded: Controlled by `producerSqliteBootstrapEnabled`.
 * 4. Transaction Batching: Processes upserts in explicit, atomic database transactions.
 * 5. Idempotent: Repeated runs perform clean upserts without duplicating or corrupting data.
 */

import type { EmbeddingRecord, EmbeddingPublicationInfo } from "./embeddingPersistence";
import type { SqliteProducerLocalStore } from "./sqliteProducerLocalStore";
import {
  buildProducerRecordsFromPublication,
  buildSpaceRecordFromPublication,
} from "./sqliteProducerShadowWriter";

export interface SqliteBootstrapOptions {
  readonly enabled?: boolean;
  readonly deviceRole?: "producer" | "companion";
  readonly store: SqliteProducerLocalStore;
  readonly batchSize?: number;
  readonly onProgress?: (processed: number, total: number) => void;
}

export interface SqliteBootstrapResult {
  readonly attempted: boolean;
  readonly success: boolean;
  readonly totalLegacyRecords: number;
  readonly processedRecords: number;
  readonly batchesExecuted: number;
  readonly durationMs: number;
  readonly errorSummary?: string;
}

export async function bootstrapSqliteFromLegacyStore(
  legacyRecords: readonly EmbeddingRecord[],
  publicationInfo: EmbeddingPublicationInfo,
  options: SqliteBootstrapOptions
): Promise<SqliteBootstrapResult> {
  const startTime = Date.now();
  const isEnabled = options.enabled ?? false;
  const isProducer = (options.deviceRole ?? "producer") === "producer";

  if (!isEnabled || !isProducer) {
    return {
      attempted: false,
      success: true,
      totalLegacyRecords: legacyRecords.length,
      processedRecords: 0,
      batchesExecuted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const store = options.store;
  const batchSize = Math.max(1, options.batchSize ?? 250);

  try {
    if (!store.isOpen) {
      store.open();
    }

    const spaceRecord = buildSpaceRecordFromPublication(publicationInfo, legacyRecords);
    const producerRecords = buildProducerRecordsFromPublication(spaceRecord.spaceId, legacyRecords);

    let processedCount = 0;
    let batchesCount = 0;

    for (let i = 0; i < producerRecords.length; i += batchSize) {
      const batch = producerRecords.slice(i, i + batchSize);
      store.upsertEmbeddingBatch(spaceRecord, batch);
      processedCount += batch.length;
      batchesCount++;

      options.onProgress?.(processedCount, producerRecords.length);
    }

    return {
      attempted: true,
      success: true,
      totalLegacyRecords: legacyRecords.length,
      processedRecords: processedCount,
      batchesExecuted: batchesCount,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorSummary = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      success: false,
      totalLegacyRecords: legacyRecords.length,
      processedRecords: 0,
      batchesExecuted: 0,
      durationMs: Date.now() - startTime,
      errorSummary,
    };
  }
}
