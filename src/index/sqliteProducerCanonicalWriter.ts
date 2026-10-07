/**
 * Sqlite Producer Canonical Writer (Phase M3)
 *
 * Implements canonical persistence authority for the Active Producer using the
 * private SQLite store (lina-producer.db), with the legacy store (embeddings.jsonl + manifest.json)
 * acting as a reversible, rebuildable projection layer.
 *
 * Authority Rules (M3):
 * 1. Pre-cutover equivalence check: auditStoreEquivalence must be equivalent (0 divergences).
 * 2. Write Order: SQLite Canonical Transaction -> (PASS) -> Legacy Projection.
 * 3. Failure Isolation: SQLite failure -> block publication. SQLite commit PASS + Legacy failure -> SQLite remains canonical, legacy marked degraded.
 * 4. Zero AI Reprojection: Legacy files can be rebuilt from SQLite with 0 AI provider calls.
 * 5. Scoped to Active Producer only.
 */

import { App } from "obsidian";
import type { EmbeddingRecord, EmbeddingPublicationInfo } from "./embeddingPersistence";
import { extractCanonicalEmbeddingSourceProvenance, readCanonicalEmbeddingRecords, publishCanonicalEmbeddings } from "./embeddingPersistence";
import { SqliteProducerLocalStore } from "./sqliteProducerLocalStore";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "./producerLocalStoreTypes";
import { auditStoreEquivalence, type StoreEquivalenceReport } from "./producerStoreEquivalenceAuditor";
import { createVectorContract } from "./vectorContract";
import { DefaultProducerLocalStorePathResolver } from "./producerLocalStorePathResolver";
import { publishSqliteCanonicalGeneration, type ImmutablePublicationResult } from "./publishedGenerationPublicationService";
import type { PublishedGenerationFileAdapter } from "./publishedGenerationWriter";

export interface CanonicalWriteOptions {
  readonly enabled?: boolean;
  readonly deviceRole?: string;
  readonly store?: SqliteProducerLocalStore;
  readonly preCutoverAuditRequired?: boolean;
  readonly shadowWriteOptions?: { databasePath?: string };
  readonly immutablePublicationEnabled?: boolean;
  readonly immutablePublicationAdapter?: PublishedGenerationFileAdapter;
  /** Revalidate ownership immediately before every durable mutation. */
  readonly assertFence?: () => Promise<boolean>;
}

export interface CanonicalEligibilityResult {
  readonly eligible: boolean;
  readonly mode: "SQLITE_CANONICAL_MODE" | "LEGACY_MODE";
  readonly reason?: string;
  readonly auditReport?: StoreEquivalenceReport;
}

export interface CanonicalWriteResult {
  readonly success: boolean;
  readonly mode: "SQLITE_CANONICAL_MODE" | "LEGACY_MODE";
  readonly sqliteWritePassed: boolean;
  readonly legacyProjectionPassed: boolean;
  readonly recordsCount: number;
  readonly error?: string;
  readonly warning?: string;
  readonly auditReport?: StoreEquivalenceReport;
  readonly immutablePublication?: ImmutablePublicationResult;
}

export interface ReprojectionResult {
  readonly success: boolean;
  readonly recordsCount: number;
  readonly providerCallsCount: number;
  readonly error?: string;
}

async function hasCurrentFence(options: Pick<CanonicalWriteOptions, "assertFence">): Promise<boolean> {
  if (!options.assertFence) return true;
  try { return await options.assertFence(); } catch { return false; }
}

/**
 * Validates pre-conditions for switching to canonical SQLite mode.
 */
export async function evaluateCanonicalWriteEligibility(
  app: App,
  store: SqliteProducerLocalStore,
  options: CanonicalWriteOptions = {}
): Promise<CanonicalEligibilityResult> {
  if (options.enabled === false) {
    return { eligible: false, mode: "LEGACY_MODE", reason: "canonical-mode-disabled-by-flag" };
  }

  if (options.deviceRole && options.deviceRole !== "producer") {
    return { eligible: false, mode: "LEGACY_MODE", reason: "device-role-not-active-producer" };
  }

  if (!store.isOpen) {
    try {
      store.open();
    } catch (err) {
      return {
        eligible: false,
        mode: "LEGACY_MODE",
        reason: `sqlite-store-open-failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (options.preCutoverAuditRequired !== false) {
    const legacyState = await readCanonicalEmbeddingRecords(app);
    const audit = auditStoreEquivalence(legacyState.records, store);
    if (!audit.isEquivalent || audit.divergenceCount > 0) {
      return {
        eligible: false,
        mode: "LEGACY_MODE",
        reason: `pre-cutover-equivalence-failed: ${audit.divergenceCount} divergence(s) detected`,
        auditReport: audit,
      };
    }
    return { eligible: true, mode: "SQLITE_CANONICAL_MODE", auditReport: audit };
  }

  return { eligible: true, mode: "SQLITE_CANONICAL_MODE" };
}

function buildSpaceRecord(info: EmbeddingPublicationInfo): EmbeddingSpaceRecord {
  const vectorContract = createVectorContract({
    provider: info.provider,
    model: info.model,
    dimensions: info.dimensions,
    metric: "cosine",
    prefixMode: info.prefixMode,
    inputVersion: info.inputVersion,
  });

  const now = new Date().toISOString();
  return {
    spaceId: `${info.provider}:${info.model}:${info.dimensions}`,
    provider: info.provider,
    model: info.model,
    dimensions: info.dimensions,
    vectorContractId: vectorContract.contractId,
    inputVersion: info.inputVersion,
    prefixMode: info.prefixMode,
    createdAt: now,
    updatedAt: now,
    vectorContract,
  };
}

function mapEmbeddingRecordToProducerRecord(rec: EmbeddingRecord, spaceId: string, contractId: string): ProducerEmbeddingRecord {
  const float32 = rec.embedding instanceof Float32Array
    ? rec.embedding
    : new Float32Array(rec.embedding);

  return {
    chunkId: rec.chunkId,
    spaceId,
    notePath: rec.path,
    chunkIndex: rec.index,
    textHash: rec.textHash,
    vectorContractId: contractId,
    embeddingInputHash: rec.embeddingInputHash,
    embeddingBlob: float32,
    createdAt: rec.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Performs a canonical embedding write for the Active Producer.
 * Order: SQLite canonical write transaction -> (if PASS) -> Legacy projection write.
 */
export async function performProducerSqliteCanonicalWrite(
  app: App,
  records: EmbeddingRecord[],
  info: EmbeddingPublicationInfo,
  options: CanonicalWriteOptions = {}
): Promise<CanonicalWriteResult> {
  const customDbPath = options.shadowWriteOptions?.databasePath;
  const pathResolver = new DefaultProducerLocalStorePathResolver(app.vault.adapter);
  const storePath = customDbPath ?? pathResolver.resolveStorePath().databasePath;
  const store = options.store ?? new SqliteProducerLocalStore({
    databasePath: storePath,
  });

  // Step 1: Pre-condition check
  const eligibility = await evaluateCanonicalWriteEligibility(app, store, options);
  if (!eligibility.eligible) {
    return {
      success: false,
      mode: "LEGACY_MODE",
      sqliteWritePassed: false,
      legacyProjectionPassed: false,
      recordsCount: records.length,
      error: eligibility.reason,
      auditReport: eligibility.auditReport,
    };
  }
  if (!await hasCurrentFence(options)) {
    return { success: false, mode: "LEGACY_MODE", sqliteWritePassed: false, legacyProjectionPassed: false, recordsCount: records.length, error: "ownership-fence-rejected", auditReport: eligibility.auditReport };
  }

  // Step 2: Canonical SQLite Transaction
  const space = buildSpaceRecord(info);
  const producerRecords = records.map((rec) => mapEmbeddingRecordToProducerRecord(rec, space.spaceId, space.vectorContractId));

  try {
    store.replaceAllRecords(space, producerRecords);
  } catch (err) {
    const errorMsg = `SQLite canonical commit failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      success: false,
      mode: "SQLITE_CANONICAL_MODE",
      sqliteWritePassed: false,
      legacyProjectionPassed: false,
      recordsCount: records.length,
      error: errorMsg,
      auditReport: eligibility.auditReport,
    };
  }
  if (!await hasCurrentFence(options)) {
    return { success: false, mode: "SQLITE_CANONICAL_MODE", sqliteWritePassed: true, legacyProjectionPassed: false, recordsCount: records.length, error: "ownership-fence-rejected", auditReport: eligibility.auditReport };
  }

  // Step 3: Legacy Projection (Compatibility Publication)
  let legacyProjectionPassed = false;
  let projectionWarning: string | undefined;
  let immutablePublication: ImmutablePublicationResult | undefined;

  try {
    const projResult = await publishCanonicalEmbeddings(app, records, info);
    if (projResult.success) {
      legacyProjectionPassed = true;
    } else {
      projectionWarning = `Legacy projection failed: ${projResult.error ?? "unknown"}. SQLite canonical store remains intact.`;
    }
  } catch (err) {
    projectionWarning = `Legacy projection error: ${err instanceof Error ? err.message : String(err)}. SQLite canonical store remains intact.`;
  }

  // M4 is a second, retryable projection. It runs only after canonical SQLite
  // commit and the legacy compatibility projection; it never changes authority.
  if (legacyProjectionPassed && options.immutablePublicationEnabled && options.immutablePublicationAdapter) {
    if (!await hasCurrentFence(options)) {
      return { success: false, mode: "SQLITE_CANONICAL_MODE", sqliteWritePassed: true, legacyProjectionPassed, recordsCount: records.length, error: "ownership-fence-rejected", auditReport: eligibility.auditReport };
    }
    const canonicalState = await readCanonicalEmbeddingRecords(app);
    const sourceProvenance = canonicalState.valid ? extractCanonicalEmbeddingSourceProvenance(canonicalState.manifest) : null;
    immutablePublication = await publishSqliteCanonicalGeneration(store, {
      enabled: true,
      canonicalEnabled: true,
      deviceRole: options.deviceRole,
      adapter: options.immutablePublicationAdapter,
      sourceProvenance: sourceProvenance ?? undefined,
    });
    if (!immutablePublication.result?.success) {
      projectionWarning = `${projectionWarning ? `${projectionWarning} ` : ""}Immutable generation publication failed: ${immutablePublication.error ?? immutablePublication.result?.error ?? "unknown"}.`;
    }
  }

  return {
    success: true,
    mode: "SQLITE_CANONICAL_MODE",
    sqliteWritePassed: true,
    legacyProjectionPassed,
    recordsCount: records.length,
    warning: projectionWarning,
    auditReport: eligibility.auditReport,
    immutablePublication,
  };
}

/**
 * Reprojects legacy embeddings.jsonl and manifest.json directly from the SQLite store.
 * Reconstructs legacy persistence without calling AI providers (0 provider calls).
 */
export async function reprojectLegacyFromSqlite(
  app: App,
  store: SqliteProducerLocalStore,
  info: EmbeddingPublicationInfo,
  options: Pick<CanonicalWriteOptions, "assertFence"> = {}
): Promise<ReprojectionResult> {
  const providerCallsCount = 0;
  if (!store.isOpen) {
    store.open();
  }

  const producerRecords = store.getAllRecords();
  const legacyRecords: EmbeddingRecord[] = producerRecords.map((pr) => {
    let blobAsFloat32: number[];
    if (pr.embeddingBlob instanceof Float32Array) {
      blobAsFloat32 = Array.from(pr.embeddingBlob);
    } else if (ArrayBuffer.isView(pr.embeddingBlob)) {
      const f32 = new Float32Array(pr.embeddingBlob.buffer, pr.embeddingBlob.byteOffset, pr.embeddingBlob.byteLength / 4);
      blobAsFloat32 = Array.from(f32);
    } else {
      const f32 = new Float32Array(pr.embeddingBlob);
      blobAsFloat32 = Array.from(f32);
    }

    return {
      chunkId: pr.chunkId,
      path: pr.notePath,
      index: pr.chunkIndex,
      textHash: pr.textHash,
      embeddingInputHash: pr.embeddingInputHash,
      model: info.model,
      provider: info.provider,
      dimensions: info.dimensions,
      embedding: blobAsFloat32,
      createdAt: pr.createdAt,
    };
  });

  try {
    if (!await hasCurrentFence(options)) return { success: false, recordsCount: legacyRecords.length, providerCallsCount, error: "ownership-fence-rejected" };
    const pubResult = await publishCanonicalEmbeddings(app, legacyRecords, info);
    if (!pubResult.success) {
      return {
        success: false,
        recordsCount: legacyRecords.length,
        providerCallsCount,
        error: pubResult.error ?? "Publication failed during reprojection",
      };
    }
    return {
      success: true,
      recordsCount: legacyRecords.length,
      providerCallsCount,
    };
  } catch (err) {
    return {
      success: false,
      recordsCount: legacyRecords.length,
      providerCallsCount,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Deletes embedding records for a given note from SQLite canonical store and updates legacy projection.
 */
export async function deleteProducerNoteEmbeddings(
  app: App,
  store: SqliteProducerLocalStore,
  notePath: string,
  info: EmbeddingPublicationInfo
): Promise<{ deletedCount: number; reprojection: ReprojectionResult }> {
  if (!store.isOpen) {
    store.open();
  }
  const deletedCount = store.deleteRecordsForNote(notePath);
  const reprojection = await reprojectLegacyFromSqlite(app, store, info);
  return { deletedCount, reprojection };
}
