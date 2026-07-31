import { App, normalizePath } from "obsidian";
import { isValidEmbeddingVector } from "../ai/embeddingTypes";
import { buildEmbeddingInput } from "../index/embeddingGenerator";
import { EmbeddingRecord } from "../index/embeddingPersistence";
import { calculateEmbeddingState, PublishedEmbeddingIdentity } from "../index/embeddingState";
import { Chunk } from "../index/chunker";
import { hashContent } from "../index/noteHasher";
import { BinaryEmbeddingDigest, BinaryEmbeddingReadOptions, BinaryEmbeddingStorageError, EmbeddingResourceProfile, getEmbeddingBinaryResourceLimits, createWebCryptoEmbeddingDigest, readBinaryEmbeddingStorage } from "../index/embeddingBinaryStorage";
import { evaluateEmbeddingBridgeRead } from "../index/embeddingResourceGuard";

export interface RuntimeEmbeddingMetadata {
  chunkId: string;
  path: string;
  index: number;
  textHash: string;
  embeddingInputHash?: string;
}

export interface RuntimeEmbeddingSourceIdentity extends Required<PublishedEmbeddingIdentity> {
  updatedAt: string;
  canonicalMtime: number;
  canonicalSize: number;
  storageFormat?: "jsonl-v1" | "binary-v1";
  publicationId?: string;
  binaryGenerationId?: string;
}

export interface RuntimeEmbeddingIndex {
  dimensions: number;
  count: number;
  vectors: Float32Array;
  records: RuntimeEmbeddingMetadata[];
  provider: string;
  model: string;
  sourceIdentity: RuntimeEmbeddingSourceIdentity;
}

export type RuntimeEmbeddingIndexInvalidationReason =
  | "canonical-published"
  | "canonical-rollback"
  | "canonical-recovered"
  | "text-index-published"
  | "text-index-rebuilt"
  | "external-source-changed"
  | "manual"
  | "unload";

export type RuntimeEmbeddingIndexCacheState = "empty" | "loading" | "ready" | "disposed";

export type EffectiveEmbeddingReadSource = "not-loaded" | "jsonl" | "binary";
export type EmbeddingReadFallbackReason =
  | "none" | "binary-disabled" | "binary-missing" | "binary-invalid"
  | "binary-outdated" | "legacy-manifest" | "digest-unavailable"
  | "binary-read-failed" | "jsonl-read-failed" | "canonical-manifest-invalid"
  | "resource-limit" | "binary-resource-limit" | "jsonl-resource-limit"
  | "configured-source-resource-limit" | "fallback-source-resource-limit" | "no-safe-source" | "cancelled";
export interface EmbeddingReadDiagnosticState {
  configuredPreference: "jsonl" | "prefer-binary";
  effectiveSource: EffectiveEmbeddingReadSource;
  fallbackReason: EmbeddingReadFallbackReason;
  canonicalPublicationId?: string;
  binarySourcePublicationId?: string;
  recordCount?: number;
  dimensions?: number;
  lastResolvedAt?: number;
  lastErrorCode?: string;
  loadDurationMs?: number;
  cacheHit?: boolean;
}

function monotonicNow(): number { return globalThis.performance?.now?.() ?? Date.now(); }

export interface EmbeddingJsonlResourceLimits {
  maxJsonlBytes: number;
  maxEstimatedPeakBytes: number;
  workingMemoryReserveBytes: number;
}

export const EMBEDDING_JSONL_RESOURCE_LIMITS: Readonly<Record<EmbeddingResourceProfile, Readonly<EmbeddingJsonlResourceLimits>>> = Object.freeze({
  desktop: Object.freeze({ maxJsonlBytes: 96 * 1024 * 1024, maxEstimatedPeakBytes: 192 * 1024 * 1024, workingMemoryReserveBytes: 32 * 1024 * 1024 }),
  mobile: Object.freeze({ maxJsonlBytes: 24 * 1024 * 1024, maxEstimatedPeakBytes: 64 * 1024 * 1024, workingMemoryReserveBytes: 16 * 1024 * 1024 }),
});

export interface RuntimeEmbeddingResourceOptions {
  profile?: EmbeddingResourceProfile;
  jsonlLimits?: EmbeddingJsonlResourceLimits;
}

export interface EmbeddingJsonlPeakEstimate {
  jsonlInputBytes: number;
  jsonlStringBytes: number;
  lineIndexOrSplitOverheadBytes: number;
  parsedMetadataBytes: number;
  parsedVectorTemporaryBytes: number;
  runtimeVectorBytes: number;
  fixedWorkingReserveBytes: number;
  estimatedPeakBytes: number;
}

export function estimateEmbeddingJsonlPeakBytes(fileBytes: number, recordCount: number, dimensions: number, limits: EmbeddingJsonlResourceLimits): EmbeddingJsonlPeakEstimate {
  const values = recordCount * dimensions;
  // DataAdapter.read() exposes only the JS string to this code. No UTF-8 buffer or
  // TextEncoder result coexists here. The parser retains every parsed number[] until
  // calculateEmbeddingState has classified the complete canonical set.
  const jsonlInputBytes = 0;
  const jsonlStringBytes = fileBytes * 2;
  const lineIndexOrSplitOverheadBytes = Math.min(jsonlStringBytes, Math.max(Math.ceil(jsonlStringBytes / Math.max(recordCount, 1)), dimensions * 32 + 4096));
  const parsedMetadataBytes = recordCount * 384;
  const parsedVectorTemporaryBytes = values * 8;
  const runtimeVectorBytes = values * 4;
  const parts = [jsonlInputBytes, jsonlStringBytes, lineIndexOrSplitOverheadBytes, parsedMetadataBytes,
    parsedVectorTemporaryBytes, runtimeVectorBytes, limits.workingMemoryReserveBytes];
  if (![fileBytes, recordCount, dimensions, limits.workingMemoryReserveBytes].every((value) => Number.isSafeInteger(value) && value >= 0)
    || dimensions === 0 || !Number.isSafeInteger(values) || parts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("jsonl-size-overflow");
  }
  let total = 0;
  for (const part of parts) {
    if (total > Number.MAX_SAFE_INTEGER - part) throw new Error("jsonl-size-overflow");
    total += part;
  }
  return { jsonlInputBytes, jsonlStringBytes, lineIndexOrSplitOverheadBytes, parsedMetadataBytes,
    parsedVectorTemporaryBytes, runtimeVectorBytes, fixedWorkingReserveBytes: limits.workingMemoryReserveBytes,
    estimatedPeakBytes: total };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
    if (!Number.isSafeInteger(bytes)) throw new Error("jsonl-size-overflow");
  }
  return bytes;
}

function countJsonlRecords(content: string): number {
  let count = 0;
  let hasNonWhitespace = false;
  for (let index = 0; index < content.length; index++) {
    const char = content.charCodeAt(index);
    if (char === 10) { if (hasNonWhitespace) count++; hasNonWhitespace = false; }
    else if (char !== 13 && char !== 32 && char !== 9) hasNonWhitespace = true;
  }
  return count + (hasNonWhitespace ? 1 : 0);
}

interface ManifestEmbeddingInfo {
  provider: string;
  model: string;
  dimensions: number;
  inputVersion: number;
  prefixMode: "none" | "nomic-search-query-document";
  updatedAt: string;
  publicationId?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseManifestEmbeddingInfo(value: unknown): ManifestEmbeddingInfo | null {
  if (!isObject(value) || value.embeddingsEnabled !== true || !isObject(value.embeddings)) return null;
  const embeddings = value.embeddings;
  const input = isObject(value.embeddingInput) ? value.embeddingInput : undefined;
  if (
    typeof embeddings.provider !== "string"
    || typeof embeddings.model !== "string"
    || !Number.isInteger(embeddings.dimensions)
    || (embeddings.dimensions as number) <= 0
    || typeof embeddings.updatedAt !== "string"
    || !input
    || input.version !== 1
    || (input.prefixMode !== "none" && input.prefixMode !== "nomic-search-query-document")
  ) {
    return null;
  }
  return {
    provider: embeddings.provider,
    model: embeddings.model,
    dimensions: embeddings.dimensions as number,
    inputVersion: input.version as number,
    prefixMode: input.prefixMode,
    updatedAt: embeddings.updatedAt,
    publicationId: typeof embeddings.publicationId === "string" ? embeddings.publicationId : undefined,
  };
}

function sameSourceIdentity(
  left: RuntimeEmbeddingSourceIdentity | null,
  right: RuntimeEmbeddingSourceIdentity | null
): boolean {
  return !!left && !!right
    && left.provider === right.provider
    && left.model === right.model
    && left.dimensions === right.dimensions
    && left.inputVersion === right.inputVersion
    && left.prefixMode === right.prefixMode
    && left.updatedAt === right.updatedAt
    // publicationId is the canonical commit marker for any derived binary set.
    // It must participate in cache identity even when timestamps/sizes collide.
    && left.publicationId === right.publicationId
    && left.canonicalMtime === right.canonicalMtime
    && left.canonicalSize === right.canonicalSize;
}

interface RuntimeEmbeddingSourceReadResult {
  source: RuntimeEmbeddingSourceIdentity | null;
  failureReason?: "canonical-manifest-invalid" | "jsonl-read-failed";
  errorCode?: string;
}

async function readRuntimeEmbeddingSourceIdentityResult(app: App): Promise<RuntimeEmbeddingSourceReadResult> {
  const adapter = app.vault.adapter;
  const manifestPath = normalizePath(".lina/index/manifest.json");
  const embeddingsPath = normalizePath(".lina/index/embeddings.jsonl");
  let info: ManifestEmbeddingInfo | null;
  try {
    info = parseManifestEmbeddingInfo(JSON.parse(await adapter.read(manifestPath)) as unknown);
  } catch {
    return { source: null, failureReason: "canonical-manifest-invalid", errorCode: "canonical-manifest-read-failed" };
  }
  if (!info) return { source: null, failureReason: "canonical-manifest-invalid", errorCode: "canonical-manifest-invalid" };
  try {
    const stat = await adapter.stat(embeddingsPath);
    if (!stat || stat.type !== "file") return { source: null, failureReason: "jsonl-read-failed", errorCode: "jsonl-missing" };
    return { source: {
      ...info,
      canonicalMtime: stat.mtime,
      canonicalSize: stat.size,
    } };
  } catch {
    return { source: null, failureReason: "jsonl-read-failed", errorCode: "jsonl-stat-failed" };
  }
}

export async function readRuntimeEmbeddingSourceIdentity(app: App): Promise<RuntimeEmbeddingSourceIdentity | null> {
  return (await readRuntimeEmbeddingSourceIdentityResult(app)).source;
}

function parseJsonlRecords(content: string): EmbeddingRecord[] | null {
  const records: EmbeddingRecord[] = [];
  let start = 0;
  while (start < content.length) {
    const end = content.indexOf("\n", start);
    const lineEnd = end === -1 ? content.length : end;
    const line = content.slice(start, lineEnd);
    start = end === -1 ? content.length : end + 1;
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as EmbeddingRecord);
    } catch {
      return null;
    }
  }
  return records;
}

function buildRuntimeIndex(
  records: EmbeddingRecord[],
  chunks: readonly Chunk[],
  sourceIdentity: RuntimeEmbeddingSourceIdentity
): RuntimeEmbeddingIndex | null {
  const state = calculateEmbeddingState({
    chunks,
    canonicalRecords: records,
    publishedIdentity: sourceIdentity,
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });
  const count = state.validForSearchChunkIds.size;
  if (count === 0 || !Number.isSafeInteger(count * sourceIdentity.dimensions)) return null;

  const vectors = new Float32Array(count * sourceIdentity.dimensions);
  const metadata: RuntimeEmbeddingMetadata[] = [];
  const seen = new Set<string>();
  let recordIndex = 0;
  for (const record of records) {
    if (!state.validForSearchChunkIds.has(record.chunkId) || seen.has(record.chunkId)) continue;
    if (
      record.provider !== sourceIdentity.provider
      || record.model !== sourceIdentity.model
      || record.dimensions !== sourceIdentity.dimensions
      || !isValidEmbeddingVector(record.embedding)
      || record.embedding.length !== sourceIdentity.dimensions
    ) {
      return null;
    }
    const offset = recordIndex * sourceIdentity.dimensions;
    for (let dimension = 0; dimension < sourceIdentity.dimensions; dimension++) {
      vectors[offset + dimension] = record.embedding[dimension];
    }
    metadata.push({
      chunkId: record.chunkId,
      path: record.path,
      index: record.index,
      textHash: record.textHash,
      embeddingInputHash: record.embeddingInputHash,
    });
    seen.add(record.chunkId);
    recordIndex++;
  }
  if (recordIndex !== count) return null;
  return {
    dimensions: sourceIdentity.dimensions,
    count,
    vectors,
    records: metadata,
    provider: sourceIdentity.provider,
    model: sourceIdentity.model,
    sourceIdentity,
  };
}

export class RuntimeEmbeddingIndexCache {
  private index: RuntimeEmbeddingIndex | null = null;
  private loading: Promise<RuntimeEmbeddingIndex | null> | null = null;
  private revision = 0;
  private disposed = false;
  private loadedPreference: "jsonl" | "prefer-binary" | null = null;
  private actualReadRevision = -1;
  private diagnostic: EmbeddingReadDiagnosticState;

  constructor(
    private readonly app: App,
    private readonly debug?: (event: string, details: Record<string, unknown>) => void,
    private readonly getStoragePreference: () => "jsonl" | "prefer-binary" = () => "jsonl",
    private readonly createDigest: () => BinaryEmbeddingDigest = createWebCryptoEmbeddingDigest,
    private readonly binaryReadOptions: BinaryEmbeddingReadOptions = {},
    private readonly resourceOptions: RuntimeEmbeddingResourceOptions = {},
  ) {
    this.diagnostic = this.emptyDiagnostic();
  }

  getDiagnosticState(): EmbeddingReadDiagnosticState { return { ...this.diagnostic }; }

  private emptyDiagnostic(): EmbeddingReadDiagnosticState {
    return { configuredPreference: this.getStoragePreference(), effectiveSource: "not-loaded", fallbackReason: "none" };
  }

  private setDiagnostic(state: EmbeddingReadDiagnosticState): void {
    this.diagnostic = { ...state };
  }

  getState(): RuntimeEmbeddingIndexCacheState {
    if (this.disposed) return "disposed";
    if (this.loading) return "loading";
    return this.index ? "ready" : "empty";
  }

  async getOrLoad(chunks: readonly Chunk[]): Promise<RuntimeEmbeddingIndex | null> {
    if (this.disposed) return null;
    const preference = this.getStoragePreference();
    if (this.index && this.loadedPreference !== preference) this.invalidate("manual");
    const requestRevision = this.revision;
    const sourceResult = await readRuntimeEmbeddingSourceIdentityResult(this.app);
    const source = sourceResult.source;
    if (this.disposed || this.revision !== requestRevision) return null;
    if (!source) {
      this.invalidate("external-source-changed");
      this.setDiagnostic({ configuredPreference: preference, effectiveSource: "not-loaded", fallbackReason: sourceResult.failureReason ?? "canonical-manifest-invalid", lastResolvedAt: Date.now(), lastErrorCode: sourceResult.errorCode ?? "canonical-source-unavailable" });
      return null;
    }
    const shouldRetryPreferredBinary = this.index
      && preference === "prefer-binary"
      && this.index.sourceIdentity.storageFormat !== "binary-v1";
    if (this.index && !shouldRetryPreferredBinary && sameSourceIdentity(this.index.sourceIdentity, source)) {
      this.diagnostic = { ...this.diagnostic, configuredPreference: preference, cacheHit: true };
      this.debug?.("hit", { count: this.index.count, dimensions: this.index.dimensions });
      return this.index;
    }
    if (this.index) this.invalidate("external-source-changed");
    if (this.loading) return this.loading;

    const loadRevision = this.revision;
    this.actualReadRevision = -1;
    const loadStartedAt = monotonicNow();
    this.debug?.("load-started", { dimensions: source.dimensions });
    this.loading = this.load(source, chunks, loadRevision).then((result) => {
      if (this.revision === loadRevision && !this.disposed && this.actualReadRevision === loadRevision) {
        this.diagnostic = { ...this.diagnostic, loadDurationMs: Math.max(0, monotonicNow() - loadStartedAt), cacheHit: false };
      }
      return result;
    });
    try {
      return await this.loading;
    } finally {
      if (this.revision === loadRevision) this.loading = null;
    }
  }

  invalidate(reason: RuntimeEmbeddingIndexInvalidationReason): void {
    if (this.disposed) return;
    this.revision++;
    this.index = null;
    this.loadedPreference = null;
    this.diagnostic = this.emptyDiagnostic();
    this.debug?.("invalidated", { reason });
  }

  dispose(): void {
    if (this.disposed) return;
    this.revision++;
    this.index = null;
    this.loadedPreference = null;
    this.loading = null;
    this.diagnostic = this.emptyDiagnostic();
    this.disposed = true;
    this.debug?.("disposed", {});
  }

  private async load(
    source: RuntimeEmbeddingSourceIdentity,
    chunks: readonly Chunk[],
    revision: number
  ): Promise<RuntimeEmbeddingIndex | null> {
    const preference = this.getStoragePreference();
    let fallbackReason: EmbeddingReadFallbackReason = preference === "jsonl" ? "binary-disabled" : source.publicationId ? "none" : "legacy-manifest";
    let binarySourcePublicationId: string | undefined;
    let lastErrorCode: string | undefined;
    const profile = this.resourceOptions.profile ?? "desktop";
    const jsonlLimits = this.resourceOptions.jsonlLimits ?? EMBEDDING_JSONL_RESOURCE_LIMITS[profile];
    try {
      if (preference === "prefer-binary" && source.publicationId) {
        try {
          this.actualReadRevision = revision;
          const binary = await readBinaryEmbeddingStorage(this.app.vault.adapter as never, this.createDigest(), {
            ...this.binaryReadOptions,
            limits: this.binaryReadOptions.limits ?? getEmbeddingBinaryResourceLimits(profile),
            isCancelled: () => this.disposed || this.revision !== revision || this.getStoragePreference() !== preference,
          });
          binarySourcePublicationId = binary.sourceIdentity.publicationId;
          const sourceAfterBinary = await readRuntimeEmbeddingSourceIdentity(this.app);
          if (!sameSourceIdentity(source, sourceAfterBinary)) {
            this.debug?.("binary-fallback", { reason: "canonical-source-changed-during-binary-read", status: "outdated" });
            return sourceAfterBinary ? this.load(sourceAfterBinary, chunks, revision) : null;
          }
          if (binary.sourceIdentity.publicationId === source.publicationId && binary.dimensions === source.dimensions && binary.provider === source.provider && binary.model === source.model) {
            binary.sourceIdentity = { ...source, storageFormat: "binary-v1", publicationId: source.publicationId, binaryGenerationId: binary.sourceIdentity.binaryGenerationId };
            this.index = binary;
            this.loadedPreference = "prefer-binary";
            this.setDiagnostic({ configuredPreference: preference, effectiveSource: "binary", fallbackReason: "none", canonicalPublicationId: source.publicationId, binarySourcePublicationId, recordCount: binary.count, dimensions: binary.dimensions, lastResolvedAt: Date.now() });
            this.debug?.("binary-load-completed", { count: binary.count, dimensions: binary.dimensions });
            return binary;
          }
          this.debug?.("binary-fallback", { reason: "source-publication-mismatch", status: "outdated" });
          fallbackReason = "binary-outdated";
        } catch (error) {
          if (error instanceof BinaryEmbeddingStorageError) {
            lastErrorCode = error.code;
            if (error.code === "binary-read-cancelled") {
              this.setDiagnostic({ configuredPreference: this.getStoragePreference(), effectiveSource: "not-loaded", fallbackReason: "cancelled", lastResolvedAt: Date.now(), lastErrorCode: error.code });
              return null;
            }
            fallbackReason = ["binary-resource-limit-exceeded", "binary-dimension-limit-exceeded", "binary-record-limit-exceeded", "binary-size-overflow", "binary-estimated-peak-limit-exceeded"].includes(error.code)
              ? "binary-resource-limit"
              : error.code === "binary-digest-unavailable"
              ? "digest-unavailable"
              : ["binary-manifest-missing", "binary-metadata-missing", "binary-vectors-missing"].includes(error.code)
                ? "binary-missing"
                : "binary-invalid";
          } else {
            fallbackReason = "binary-read-failed";
            lastErrorCode = "binary-read-failed";
          }
          this.debug?.("binary-fallback", { reason: "candidate-unavailable" });
        }
      }
      let predictedJsonlPeak: number;
      try {
        predictedJsonlPeak = estimateEmbeddingJsonlPeakBytes(source.canonicalSize, chunks.length, source.dimensions, jsonlLimits).estimatedPeakBytes;
      } catch {
        predictedJsonlPeak = Number.POSITIVE_INFINITY;
      }
      if (source.canonicalSize > jsonlLimits.maxJsonlBytes || predictedJsonlPeak > jsonlLimits.maxEstimatedPeakBytes) {
        const noSafeSource = fallbackReason === "binary-resource-limit";
        const reason = noSafeSource ? "no-safe-source" : preference === "jsonl" ? "configured-source-resource-limit" : "fallback-source-resource-limit";
        this.setDiagnostic({ configuredPreference: preference, effectiveSource: "not-loaded", fallbackReason: reason,
          canonicalPublicationId: source.publicationId, binarySourcePublicationId, lastResolvedAt: Date.now(), lastErrorCode: noSafeSource ? "no-safe-embedding-source" : "jsonl-estimated-peak-limit-exceeded" });
        return null;
      }
      const bridgeDecision = evaluateEmbeddingBridgeRead(source.canonicalSize, profile);
      if (!bridgeDecision.allowed) {
        const noSafeSource = fallbackReason === "binary-resource-limit";
        const reason = noSafeSource ? "no-safe-source" : preference === "jsonl" ? "configured-source-resource-limit" : "fallback-source-resource-limit";
        this.setDiagnostic({ configuredPreference: preference, effectiveSource: "not-loaded", fallbackReason: reason,
          canonicalPublicationId: source.publicationId, binarySourcePublicationId, lastResolvedAt: Date.now(),
          lastErrorCode: bridgeDecision.code });
        return null;
      }
      this.actualReadRevision = revision;
      const content = await this.app.vault.adapter.read(normalizePath(".lina/index/embeddings.jsonl"));
      const actualJsonlBytes = utf8ByteLength(content);
      const actualRecordCount = countJsonlRecords(content);
      const actualJsonlPeak = estimateEmbeddingJsonlPeakBytes(actualJsonlBytes, actualRecordCount, source.dimensions, jsonlLimits).estimatedPeakBytes;
      if (actualJsonlBytes > jsonlLimits.maxJsonlBytes || actualJsonlPeak > jsonlLimits.maxEstimatedPeakBytes) {
        const noSafeSource = fallbackReason === "binary-resource-limit";
        const reason = noSafeSource ? "no-safe-source" : preference === "jsonl" ? "configured-source-resource-limit" : "fallback-source-resource-limit";
        this.setDiagnostic({ configuredPreference: preference, effectiveSource: "not-loaded", fallbackReason: reason,
          canonicalPublicationId: source.publicationId, binarySourcePublicationId, lastResolvedAt: Date.now(), lastErrorCode: noSafeSource ? "no-safe-embedding-source" : "jsonl-estimated-peak-limit-exceeded" });
        return null;
      }
      const records = parseJsonlRecords(content);
      if (!records) {
        this.setDiagnostic({ configuredPreference: preference, effectiveSource: "not-loaded", fallbackReason: "jsonl-read-failed", canonicalPublicationId: source.publicationId, binarySourcePublicationId, lastResolvedAt: Date.now(), lastErrorCode: "invalid-jsonl" });
        this.debug?.("load-failed", { reason: "invalid-jsonl" });
        return null;
      }
      const index = buildRuntimeIndex(records, chunks, source);
      const sourceAfterLoad = await readRuntimeEmbeddingSourceIdentity(this.app);
      if (this.disposed || this.revision !== revision || !sameSourceIdentity(source, sourceAfterLoad)) {
        this.debug?.("stale-load-discarded", {});
        return null;
      }
      if (!index) {
        this.setDiagnostic({ configuredPreference: preference, effectiveSource: "not-loaded", fallbackReason: "jsonl-read-failed", canonicalPublicationId: source.publicationId, binarySourcePublicationId, lastResolvedAt: Date.now(), lastErrorCode: "invalid-runtime-index" });
        this.debug?.("load-failed", { reason: "invalid-runtime-index" });
        return null;
      }
      this.index = index;
      this.loadedPreference = preference;
      this.setDiagnostic({ configuredPreference: preference, effectiveSource: "jsonl", fallbackReason, canonicalPublicationId: source.publicationId, binarySourcePublicationId, recordCount: index.count, dimensions: index.dimensions, lastResolvedAt: Date.now(), lastErrorCode });
      this.debug?.("load-completed", { count: index.count, dimensions: index.dimensions });
      return index;
    } catch {
      this.setDiagnostic({ configuredPreference: preference, effectiveSource: "not-loaded", fallbackReason: "jsonl-read-failed", canonicalPublicationId: source.publicationId, binarySourcePublicationId, lastResolvedAt: Date.now(), lastErrorCode: "jsonl-read-failed" });
      this.debug?.("load-failed", { reason: "read-error" });
      return null;
    }
  }
}
