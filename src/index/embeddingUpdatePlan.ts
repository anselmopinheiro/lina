import { Chunk } from "./chunker";
import { EmbeddingRecord } from "./embeddingPersistence";
import {
  calculateEmbeddingState,
  EmbeddingInputPrefixMode,
  NextGenerationEmbeddingIdentity,
  PublishedEmbeddingIdentity,
} from "./embeddingState";

export type EmbeddingUpdateMode = "initial-build" | "incremental" | "full-rebuild";

export type EmbeddingUpdatePlanReason =
  | "canonical-missing"
  | "canonical-empty"
  | "published-identity-incomplete"
  | "target-identity-incomplete"
  | "published-identity-compatible"
  | "provider-changed"
  | "model-changed"
  | "dimension-changed"
  | "input-version-changed"
  | "prefix-mode-changed"
  | "canonical-identity-mixed"
  | "canonical-record-identity-mismatch"
  | "canonical-has-duplicates"
  | "canonical-has-invalid-records"
  | "missing-chunks"
  | "stale-chunks"
  | "obsolete-records"
  | "checkpoint-compatible-records"
  | "checkpoint-covers-all"
  | "no-generation-needed"
  | "publication-needed";

export type EmbeddingSpaceIdentity = NextGenerationEmbeddingIdentity;

export interface EmbeddingUpdatePlan {
  mode: EmbeddingUpdateMode;
  targetIdentity: EmbeddingSpaceIdentity;

  totalChunks: number;
  reusableCanonicalCount: number;
  recoverableCheckpointCount: number;
  toGenerateCount: number;
  staleToReplaceCount: number;
  missingCount: number;
  obsoleteToDropCount: number;

  reusableCanonicalRecords: EmbeddingRecord[];
  recoverableCheckpointRecords: EmbeddingRecord[];
  chunksToGenerate: Chunk[];
  obsoleteChunkIds: string[];
  recordsToPublish: EmbeddingRecord[];
  requiresPublication: boolean;

  reasons: EmbeddingUpdatePlanReason[];
}

export interface EmbeddingUpdatePlanPreview {
  mode: EmbeddingUpdateMode;
  targetIdentity: EmbeddingSpaceIdentity;
  totalChunks: number;
  reusableCanonicalCount: number;
  recoverableCheckpointCount: number;
  toGenerateCount: number;
  staleToReplaceCount: number;
  missingCount: number;
  obsoleteToDropCount: number;
  requiresPublication: boolean;
  reasons: EmbeddingUpdatePlanReason[];
}

export interface CalculateEmbeddingUpdatePlanInput {
  chunks: readonly Chunk[];
  canonicalRecords: readonly unknown[];
  canonicalExists?: boolean;
  checkpointRecords?: readonly EmbeddingRecord[];
  publishedIdentity: PublishedEmbeddingIdentity;
  targetIdentity: EmbeddingSpaceIdentity;
  buildInput: (chunk: Chunk, prefixMode: EmbeddingInputPrefixMode) => string;
  hashInput: (input: string) => string;
}

export function summarizeEmbeddingUpdatePlan(plan: EmbeddingUpdatePlan): EmbeddingUpdatePlanPreview {
  return {
    mode: plan.mode,
    targetIdentity: { ...plan.targetIdentity },
    totalChunks: plan.totalChunks,
    reusableCanonicalCount: plan.reusableCanonicalCount,
    recoverableCheckpointCount: plan.recoverableCheckpointCount,
    toGenerateCount: plan.toGenerateCount,
    staleToReplaceCount: plan.staleToReplaceCount,
    missingCount: plan.missingCount,
    obsoleteToDropCount: plan.obsoleteToDropCount,
    requiresPublication: plan.requiresPublication,
    reasons: [...plan.reasons],
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function hasCompletePublishedIdentity(identity: PublishedEmbeddingIdentity): identity is Required<PublishedEmbeddingIdentity> {
  return isNonEmptyString(identity.provider)
    && isNonEmptyString(identity.model)
    && hasPositiveInteger(identity.dimensions)
    && hasPositiveInteger(identity.inputVersion)
    && isNonEmptyString(identity.prefixMode);
}

function hasCompleteTargetIdentity(identity: EmbeddingSpaceIdentity): identity is Required<EmbeddingSpaceIdentity> {
  return isNonEmptyString(identity.provider)
    && isNonEmptyString(identity.model)
    && hasPositiveInteger(identity.dimensions)
    && hasPositiveInteger(identity.inputVersion)
    && isNonEmptyString(identity.prefixMode);
}

function addReason(reasons: EmbeddingUpdatePlanReason[], reason: EmbeddingUpdatePlanReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRecordIdentity(value: unknown): { provider: string; model: string; dimensions: number } | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.provider)
    || !isNonEmptyString(value.model)
    || !hasPositiveInteger(value.dimensions)
  ) {
    return null;
  }

  return {
    provider: value.provider,
    model: value.model,
    dimensions: value.dimensions,
  };
}

function collectRecordsInChunkOrder(
  chunks: readonly Chunk[],
  records: readonly unknown[],
  chunkIds: ReadonlySet<string>,
  excludedChunkIds: ReadonlySet<string> = new Set()
): EmbeddingRecord[] {
  const recordsByChunkId = new Map<string, EmbeddingRecord>();
  for (const record of records) {
    if (!isRecord(record) || typeof record.chunkId !== "string") continue;
    if (!chunkIds.has(record.chunkId) || excludedChunkIds.has(record.chunkId)) continue;
    if (recordsByChunkId.has(record.chunkId)) continue;
    recordsByChunkId.set(record.chunkId, record as unknown as EmbeddingRecord);
  }

  return chunks
    .map((chunk) => recordsByChunkId.get(chunk.chunkId))
    .filter((record): record is EmbeddingRecord => !!record);
}

function identityMismatchReasons(
  publishedIdentity: PublishedEmbeddingIdentity,
  targetIdentity: EmbeddingSpaceIdentity
): EmbeddingUpdatePlanReason[] {
  const reasons: EmbeddingUpdatePlanReason[] = [];
  if (publishedIdentity.provider !== targetIdentity.provider) reasons.push("provider-changed");
  if (publishedIdentity.model !== targetIdentity.model) reasons.push("model-changed");
  if (publishedIdentity.dimensions !== targetIdentity.dimensions) reasons.push("dimension-changed");
  if (publishedIdentity.inputVersion !== targetIdentity.inputVersion) reasons.push("input-version-changed");
  if (publishedIdentity.prefixMode !== targetIdentity.prefixMode) reasons.push("prefix-mode-changed");
  return reasons;
}

function hasMixedCanonicalIdentity(
  records: readonly unknown[],
  publishedIdentity: Required<PublishedEmbeddingIdentity> | null,
  reasons: EmbeddingUpdatePlanReason[]
): boolean {
  const identities = new Set<string>();
  let mismatchWithPublished = false;

  for (const record of records) {
    const identity = getRecordIdentity(record);
    if (!identity) continue;
    identities.add(`${identity.provider}\u0000${identity.model}\u0000${identity.dimensions}`);
    if (
      publishedIdentity
      && (
        identity.provider !== publishedIdentity.provider
        || identity.model !== publishedIdentity.model
        || identity.dimensions !== publishedIdentity.dimensions
      )
    ) {
      mismatchWithPublished = true;
    }
  }

  if (identities.size > 1) addReason(reasons, "canonical-identity-mixed");
  if (mismatchWithPublished) addReason(reasons, "canonical-record-identity-mismatch");
  return identities.size > 1 || mismatchWithPublished;
}

export function calculateEmbeddingUpdatePlan(input: CalculateEmbeddingUpdatePlanInput): EmbeddingUpdatePlan {
  const reasons: EmbeddingUpdatePlanReason[] = [];
  const canonicalExists = input.canonicalExists ?? input.canonicalRecords.length > 0;
  const publishedComplete = hasCompletePublishedIdentity(input.publishedIdentity);
  const targetComplete = hasCompleteTargetIdentity(input.targetIdentity);

  const canonicalState = calculateEmbeddingState({
    chunks: input.chunks,
    canonicalRecords: input.canonicalRecords,
    publishedIdentity: input.publishedIdentity,
    nextGenerationIdentity: input.targetIdentity,
    buildInput: input.buildInput,
    hashInput: input.hashInput,
  });
  const checkpointState = calculateEmbeddingState({
    chunks: input.chunks,
    canonicalRecords: input.checkpointRecords ?? [],
    publishedIdentity: {},
    nextGenerationIdentity: input.targetIdentity,
    buildInput: input.buildInput,
    hashInput: input.hashInput,
  });

  if (canonicalState.summary.duplicateRecordCount > 0) addReason(reasons, "canonical-has-duplicates");
  if (canonicalState.summary.invalidRecordCount > 0) addReason(reasons, "canonical-has-invalid-records");
  if (canonicalState.summary.missingCount > 0) addReason(reasons, "missing-chunks");
  if (canonicalState.summary.staleCount > 0) addReason(reasons, "stale-chunks");
  if (canonicalState.summary.obsoleteCount > 0) addReason(reasons, "obsolete-records");

  let mode: EmbeddingUpdateMode;
  const publishedForRecordCheck: Required<PublishedEmbeddingIdentity> | null = publishedComplete
    ? input.publishedIdentity as Required<PublishedEmbeddingIdentity>
    : null;
  const canonicalMixed = hasMixedCanonicalIdentity(input.canonicalRecords, publishedForRecordCheck, reasons);
  if (!canonicalExists) {
    mode = "initial-build";
    addReason(reasons, "canonical-missing");
  } else if (input.canonicalRecords.length === 0) {
    mode = "initial-build";
    addReason(reasons, "canonical-empty");
  } else if (!publishedComplete) {
    mode = "full-rebuild";
    addReason(reasons, "published-identity-incomplete");
  } else if (!targetComplete) {
    mode = "full-rebuild";
    addReason(reasons, "target-identity-incomplete");
  } else {
    const mismatchReasons = identityMismatchReasons(input.publishedIdentity, input.targetIdentity);
    for (const reason of mismatchReasons) addReason(reasons, reason);
    if (mismatchReasons.length > 0 || canonicalMixed) {
      mode = "full-rebuild";
    } else {
      mode = "incremental";
      addReason(reasons, "published-identity-compatible");
    }
  }

  const reusableCanonicalRecords = mode === "incremental"
    ? collectRecordsInChunkOrder(input.chunks, input.canonicalRecords, canonicalState.reusableForNextGenerationChunkIds)
    : [];
  const reusableCanonicalChunkIds = new Set(reusableCanonicalRecords.map((record) => record.chunkId));
  const recoverableCheckpointChunkIds = new Set(
    [...checkpointState.reusableForNextGenerationChunkIds]
      .filter((chunkId) => !reusableCanonicalChunkIds.has(chunkId))
  );
  const recoverableCheckpointRecords = collectRecordsInChunkOrder(
    input.chunks,
    input.checkpointRecords ?? [],
    recoverableCheckpointChunkIds,
    reusableCanonicalChunkIds
  );
  if (recoverableCheckpointRecords.length > 0) addReason(reasons, "checkpoint-compatible-records");

  const coveredChunkIds = new Set([
    ...reusableCanonicalRecords.map((record) => record.chunkId),
    ...recoverableCheckpointRecords.map((record) => record.chunkId),
  ]);
  const chunksToGenerate = input.chunks.filter((chunk) => !coveredChunkIds.has(chunk.chunkId));
  const recordsToPublish = [...reusableCanonicalRecords, ...recoverableCheckpointRecords];
  const cleanupNeeded = canonicalState.summary.obsoleteCount > 0
    || canonicalState.summary.duplicateRecordCount > 0
    || canonicalState.summary.invalidRecordCount > 0
    || (mode !== "incremental" && input.canonicalRecords.length > 0)
    || recoverableCheckpointRecords.length > 0;
  const requiresPublication = input.chunks.length > 0 && chunksToGenerate.length === 0 && cleanupNeeded;

  if (chunksToGenerate.length === 0) addReason(reasons, "no-generation-needed");
  if (recoverableCheckpointRecords.length > 0 && chunksToGenerate.length === 0) addReason(reasons, "checkpoint-covers-all");
  if (requiresPublication) addReason(reasons, "publication-needed");

  return {
    mode,
    targetIdentity: input.targetIdentity,
    totalChunks: input.chunks.length,
    reusableCanonicalCount: reusableCanonicalRecords.length,
    recoverableCheckpointCount: recoverableCheckpointRecords.length,
    toGenerateCount: chunksToGenerate.length,
    staleToReplaceCount: canonicalState.summary.staleCount,
    missingCount: canonicalState.summary.missingCount,
    obsoleteToDropCount: canonicalState.summary.obsoleteCount,
    reusableCanonicalRecords,
    recoverableCheckpointRecords,
    chunksToGenerate,
    obsoleteChunkIds: [...canonicalState.obsoleteChunkIds].sort(),
    recordsToPublish,
    requiresPublication,
    reasons,
  };
}
