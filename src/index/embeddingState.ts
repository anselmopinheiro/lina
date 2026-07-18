import { isValidEmbeddingVector } from "../ai/embeddingTypes";
import { Chunk } from "./chunker";
import { EmbeddingRecord } from "./embeddingPersistence";

export type CanonicalEmbeddingState = "missing" | "valid" | "stale" | "obsolete";
export type EmbeddingInputPrefixMode = "none" | "nomic-search-query-document";

export type EmbeddingStaleReason =
  | "text-hash-mismatch"
  | "input-hash-mismatch"
  | "missing-input-hash"
  | "invalid-vector"
  | "dimension-mismatch"
  | "published-provider-mismatch"
  | "published-model-mismatch"
  | "published-input-format-mismatch"
  | "invalid-record";

export interface PublishedEmbeddingIdentity {
  provider?: string;
  model?: string;
  dimensions?: number;
  inputVersion?: number;
  prefixMode?: EmbeddingInputPrefixMode;
}

export interface NextGenerationEmbeddingIdentity {
  provider: string;
  model: string;
  inputVersion: number;
  prefixMode: EmbeddingInputPrefixMode;
  dimensions?: number;
}

export interface EmbeddingChunkState {
  chunkId: string;
  canonicalState: Exclude<CanonicalEmbeddingState, "obsolete">;
  validForSearch: boolean;
  reusableForNextGeneration: boolean;
  staleReasons: EmbeddingStaleReason[];
}

export interface EmbeddingStateSummary {
  totalChunks: number;
  totalCanonicalRecords: number;
  validCount: number;
  missingCount: number;
  staleCount: number;
  obsoleteCount: number;
  validForSearchCount: number;
  reusableForNextGenerationCount: number;
  recoverableCheckpointCount: number;
  operationActive: boolean;
  duplicateRecordCount: number;
  invalidRecordCount: number;
}

export interface EmbeddingStateCalculation {
  chunks: ReadonlyMap<string, EmbeddingChunkState>;
  obsoleteChunkIds: ReadonlySet<string>;
  validForSearchChunkIds: ReadonlySet<string>;
  reusableForNextGenerationChunkIds: ReadonlySet<string>;
  summary: EmbeddingStateSummary;
}

export interface CalculateEmbeddingStateInput {
  chunks: readonly Chunk[];
  canonicalRecords: readonly unknown[];
  publishedIdentity: PublishedEmbeddingIdentity;
  nextGenerationIdentity?: NextGenerationEmbeddingIdentity;
  recoverableCheckpointCount?: number;
  operationActive?: boolean;
  buildInput: (chunk: Chunk, prefixMode: EmbeddingInputPrefixMode) => string;
  hashInput: (input: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getChunkId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.chunkId === "string" && value.chunkId.length > 0
    ? value.chunkId
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCandidateRecord(value: unknown): value is EmbeddingRecord {
  return isRecord(value) && typeof value.chunkId === "string";
}

function hasCompletePublishedIdentity(identity: PublishedEmbeddingIdentity): identity is Required<PublishedEmbeddingIdentity> {
  return isNonEmptyString(identity.provider)
    && isNonEmptyString(identity.model)
    && Number.isInteger(identity.dimensions)
    && (identity.dimensions as number) > 0
    && Number.isInteger(identity.inputVersion)
    && (identity.inputVersion as number) > 0
    && isNonEmptyString(identity.prefixMode);
}

function addReason(reasons: EmbeddingStaleReason[], reason: EmbeddingStaleReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function recordMatchesNextGeneration(
  record: EmbeddingRecord,
  chunk: Chunk,
  identity: NextGenerationEmbeddingIdentity,
  buildInput: CalculateEmbeddingStateInput["buildInput"],
  hashInput: CalculateEmbeddingStateInput["hashInput"]
): boolean {
  if (
    record.textHash !== chunk.textHash
    || record.provider !== identity.provider
    || record.model !== identity.model
    || !isValidEmbeddingVector(record.embedding)
    || record.dimensions !== record.embedding.length
    || (identity.dimensions !== undefined && record.dimensions !== identity.dimensions)
    || !record.embeddingInputHash
  ) {
    return false;
  }

  return record.embeddingInputHash === hashInput(buildInput(chunk, identity.prefixMode));
}

/**
 * Deriva o estado canónico sem escrever em disco nem reter texto ou vetores no
 * resultado. Duplicados são sempre conservadores: nenhum deles é pesquisável
 * ou reutilizável, independentemente da ordem no JSONL.
 */
export function calculateEmbeddingState(input: CalculateEmbeddingStateInput): EmbeddingStateCalculation {
  const recordsByChunkId = new Map<string, unknown[]>();
  let invalidRecordCount = 0;

  for (const record of input.canonicalRecords) {
    const chunkId = getChunkId(record);
    if (!chunkId) {
      invalidRecordCount++;
      continue;
    }
    const entries = recordsByChunkId.get(chunkId);
    if (entries) entries.push(record);
    else recordsByChunkId.set(chunkId, [record]);
  }

  const currentChunkIds = new Set(input.chunks.map((chunk) => chunk.chunkId));
  const obsoleteChunkIds = new Set<string>();
  let duplicateRecordCount = 0;
  for (const [chunkId, records] of recordsByChunkId) {
    if (records.length > 1) duplicateRecordCount += records.length - 1;
    if (!currentChunkIds.has(chunkId)) obsoleteChunkIds.add(chunkId);
  }

  const states = new Map<string, EmbeddingChunkState>();
  const validForSearchChunkIds = new Set<string>();
  const reusableForNextGenerationChunkIds = new Set<string>();
  const publishedIdentityComplete = hasCompletePublishedIdentity(input.publishedIdentity);

  for (const chunk of input.chunks) {
    const records = recordsByChunkId.get(chunk.chunkId) ?? [];
    if (records.length === 0) {
      states.set(chunk.chunkId, {
        chunkId: chunk.chunkId,
        canonicalState: "missing",
        validForSearch: false,
        reusableForNextGeneration: false,
        staleReasons: [],
      });
      continue;
    }

    const reasons: EmbeddingStaleReason[] = [];
    const record = records.length === 1 && isCandidateRecord(records[0]) ? records[0] : undefined;
    if (!record) {
      addReason(reasons, "invalid-record");
    } else {
      if (record.textHash !== chunk.textHash) addReason(reasons, "text-hash-mismatch");
      if (!isValidEmbeddingVector(record.embedding)) addReason(reasons, "invalid-vector");
      if (!Number.isInteger(record.dimensions) || record.dimensions !== record.embedding?.length) {
        addReason(reasons, "dimension-mismatch");
      }
      if (!record.embeddingInputHash) addReason(reasons, "missing-input-hash");

      if (!publishedIdentityComplete) {
        addReason(reasons, "published-provider-mismatch");
        addReason(reasons, "published-model-mismatch");
        addReason(reasons, "dimension-mismatch");
        addReason(reasons, "published-input-format-mismatch");
      } else {
        if (record.provider !== input.publishedIdentity.provider) addReason(reasons, "published-provider-mismatch");
        if (record.model !== input.publishedIdentity.model) addReason(reasons, "published-model-mismatch");
        if (record.dimensions !== input.publishedIdentity.dimensions) addReason(reasons, "dimension-mismatch");
        if (input.publishedIdentity.inputVersion !== 1) addReason(reasons, "published-input-format-mismatch");
        if (record.embeddingInputHash) {
          const expectedInputHash = input.hashInput(input.buildInput(chunk, input.publishedIdentity.prefixMode!));
          if (record.embeddingInputHash !== expectedInputHash) addReason(reasons, "input-hash-mismatch");
        }
      }
    }

    if (records.length > 1) addReason(reasons, "invalid-record");
    const validForSearch = reasons.length === 0;
    const reusableForNextGeneration = !!record
      && records.length === 1
      && !!input.nextGenerationIdentity
      && recordMatchesNextGeneration(record, chunk, input.nextGenerationIdentity, input.buildInput, input.hashInput);
    const canonicalState: EmbeddingChunkState["canonicalState"] = validForSearch ? "valid" : "stale";

    if (validForSearch) validForSearchChunkIds.add(chunk.chunkId);
    if (reusableForNextGeneration) reusableForNextGenerationChunkIds.add(chunk.chunkId);
    states.set(chunk.chunkId, {
      chunkId: chunk.chunkId,
      canonicalState,
      validForSearch,
      reusableForNextGeneration,
      staleReasons: reasons,
    });
  }

  let validCount = 0;
  let missingCount = 0;
  let staleCount = 0;
  for (const state of states.values()) {
    if (state.canonicalState === "valid") validCount++;
    else if (state.canonicalState === "missing") missingCount++;
    else staleCount++;
  }

  return {
    chunks: states,
    obsoleteChunkIds,
    validForSearchChunkIds,
    reusableForNextGenerationChunkIds,
    summary: {
      totalChunks: input.chunks.length,
      totalCanonicalRecords: input.canonicalRecords.length,
      validCount,
      missingCount,
      staleCount,
      obsoleteCount: obsoleteChunkIds.size,
      validForSearchCount: validForSearchChunkIds.size,
      reusableForNextGenerationCount: reusableForNextGenerationChunkIds.size,
      recoverableCheckpointCount: input.recoverableCheckpointCount ?? 0,
      operationActive: input.operationActive ?? false,
      duplicateRecordCount,
      invalidRecordCount,
    },
  };
}

export function filterEmbeddingRecordsForSearch(
  records: readonly EmbeddingRecord[],
  validForSearchChunkIds: ReadonlySet<string>
): EmbeddingRecord[] {
  return records.filter((record) => validForSearchChunkIds.has(record.chunkId));
}
