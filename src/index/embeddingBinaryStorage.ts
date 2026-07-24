import type { EmbeddingSpaceIdentity } from "./embeddingUpdatePlan";
import type { EmbeddingRecord } from "./embeddingPersistence";
import type { RuntimeEmbeddingIndex, RuntimeEmbeddingMetadata } from "../search/runtimeEmbeddingIndex";

export type EmbeddingStorageFormat = "jsonl-v1" | "binary-v1";

export interface EmbeddingStorageDescriptor {
  format: EmbeddingStorageFormat;
  identity: EmbeddingSpaceIdentity;
  recordCount: number;
  dimensions: number;
  generationId: string;
}

export interface BinaryEmbeddingManifestV1 {
  format: "lina-embeddings-binary";
  version: 1;
  generationId: string;
  byteOrder: "little-endian";
  numericType: "float32";
  provider: string;
  model: string;
  dimensions: number;
  recordCount: number;
  metadataFile: "embeddings.meta.jsonl";
  vectorsFile: "embeddings.vectors.f32";
  metadataByteLength: number;
  vectorsByteLength: number;
  metadataDigest: string;
  vectorsDigest: string;
  inputFormatVersion?: string;
  prefixMode?: string;
  createdAt: string;
}

export interface BinaryEmbeddingDataAdapter {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ type: string; size: number; mtime: number } | null>;
  read(path: string): Promise<string>;
  write(path: string, value: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, value: ArrayBuffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface BinaryEmbeddingDigest {
  digest(value: ArrayBuffer): Promise<string>;
}

/** Injected by a future activation point; it can be backed by IndexWriteCoordinator. */
export interface BinaryEmbeddingWriteLease { release(): void; }
export interface BinaryEmbeddingWriteExclusion { acquire(owner: "binary-candidate"): Promise<BinaryEmbeddingWriteLease | null>; }
export type BinaryPublicationStage =
  | "temporary-vectors" | "temporary-metadata" | "temporary-manifest" | "temporary-validated"
  | "backups-created" | "canonical-vectors" | "canonical-metadata" | "canonical-manifest"
  | "before-final-validation" | "final-validated" | "cleanup";
export interface BinaryEmbeddingPublisherOptions {
  writeExclusion?: BinaryEmbeddingWriteExclusion;
  onStage?: (stage: BinaryPublicationStage) => void | Promise<void>;
}

export interface BinaryEmbeddingMetaRecord extends RuntimeEmbeddingMetadata {
  vectorOrdinal: number;
}

export type BinaryEmbeddingStorageErrorCode =
  | "binary-manifest-missing" | "binary-manifest-invalid" | "binary-unsupported-version"
  | "binary-generation-mismatch" | "binary-metadata-missing" | "binary-vectors-missing"
  | "binary-size-mismatch" | "binary-digest-mismatch" | "binary-metadata-invalid"
  | "binary-vector-invalid" | "binary-publication-failed" | "binary-validation-failed"
  | "binary-rollback-failed" | "binary-recovery-failed" | "binary-digest-unavailable";

export class BinaryEmbeddingStorageError extends Error {
  constructor(public readonly code: BinaryEmbeddingStorageErrorCode, message: string) {
    super(message);
    this.name = "BinaryEmbeddingStorageError";
  }
}

export const BINARY_EMBEDDING_FILES = Object.freeze({
  manifest: ".lina/index/embeddings.binary.manifest.json",
  metadata: ".lina/index/embeddings.meta.jsonl",
  vectors: ".lina/index/embeddings.vectors.f32",
  manifestTemporary: ".lina/index/embeddings.binary.manifest.publish.tmp",
  metadataTemporary: ".lina/index/embeddings.meta.publish.tmp",
  vectorsTemporary: ".lina/index/embeddings.vectors.publish.tmp",
  manifestBackup: ".lina/index/embeddings.binary.manifest.publish.backup",
  metadataBackup: ".lina/index/embeddings.meta.publish.backup",
  vectorsBackup: ".lina/index/embeddings.vectors.publish.backup",
});

const SHA256_PREFIX = "sha256:";

export class InMemoryBinaryEmbeddingWriteExclusion implements BinaryEmbeddingWriteExclusion {
  private held = false;
  async acquire(_owner: "binary-candidate"): Promise<BinaryEmbeddingWriteLease | null> {
    if (this.held) return null;
    this.held = true;
    let released = false;
    return { release: () => { if (!released) { released = true; this.held = false; } } };
  }
}

const defaultWriteExclusion = new InMemoryBinaryEmbeddingWriteExclusion();

function failure(code: BinaryEmbeddingStorageErrorCode, message: string): never {
  throw new BinaryEmbeddingStorageError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function expectedBytes(count: number, dimensions: number): number {
  const values = count * dimensions;
  const bytes = values * 4;
  if (!Number.isSafeInteger(values) || !Number.isSafeInteger(bytes)) failure("binary-size-mismatch", "Binary vector size overflows.");
  return bytes;
}

function assertIdentity(identity: EmbeddingSpaceIdentity): Required<EmbeddingSpaceIdentity> {
  if (!identity.provider || !identity.model || !isPositiveInteger(identity.dimensions) || !isPositiveInteger(identity.inputVersion) || !identity.prefixMode) {
    failure("binary-manifest-invalid", "Binary identity is incomplete.");
  }
  return { provider: identity.provider, model: identity.model, dimensions: identity.dimensions, inputVersion: identity.inputVersion, prefixMode: identity.prefixMode };
}

export function createWebCryptoEmbeddingDigest(): BinaryEmbeddingDigest {
  return {
    async digest(value: ArrayBuffer): Promise<string> {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) failure("binary-digest-unavailable", "Web Crypto SHA-256 is unavailable.");
      const hash = await subtle.digest("SHA-256", value);
      return SHA256_PREFIX + Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  };
}

function encode(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function buildCandidate(records: readonly EmbeddingRecord[], identity: EmbeddingSpaceIdentity): { metadata: string; vectors: ArrayBuffer } {
  const complete = assertIdentity(identity);
  const vectors = new ArrayBuffer(expectedBytes(records.length, complete.dimensions));
  const view = new DataView(vectors);
  const seen = new Set<string>();
  const metadata: BinaryEmbeddingMetaRecord[] = [];
  records.forEach((record, ordinal) => {
    if (!record.chunkId || !record.path || !record.textHash || !isNonNegativeInteger(record.index) || seen.has(record.chunkId)) {
      failure("binary-metadata-invalid", `Invalid or duplicate metadata at ${ordinal}.`);
    }
    if (record.provider !== complete.provider || record.model !== complete.model || record.dimensions !== complete.dimensions || record.embedding.length !== complete.dimensions) {
      failure("binary-generation-mismatch", `Record ${ordinal} does not match binary identity.`);
    }
    seen.add(record.chunkId);
    for (let dimension = 0; dimension < complete.dimensions; dimension += 1) {
      const value = record.embedding[dimension];
      if (!Number.isFinite(value)) failure("binary-vector-invalid", `Vector ${ordinal} contains a non-finite value.`);
      view.setFloat32((ordinal * complete.dimensions + dimension) * 4, value, true);
    }
    metadata.push({ chunkId: record.chunkId, path: record.path, index: record.index, textHash: record.textHash, embeddingInputHash: record.embeddingInputHash, vectorOrdinal: ordinal });
  });
  return { metadata: metadata.map((record) => JSON.stringify(record)).join("\n") + (metadata.length ? "\n" : ""), vectors };
}

function parseManifest(value: unknown): BinaryEmbeddingManifestV1 {
  if (!isObject(value)) failure("binary-manifest-invalid", "Binary manifest is not an object.");
  if (value.format !== "lina-embeddings-binary" || value.version !== 1) {
    failure(value.version === undefined ? "binary-manifest-invalid" : "binary-unsupported-version", "Unsupported binary manifest.");
  }
  const valid = typeof value.generationId === "string" && value.generationId.length > 0
    && value.byteOrder === "little-endian" && value.numericType === "float32"
    && typeof value.provider === "string" && typeof value.model === "string"
    && isPositiveInteger(value.dimensions) && isNonNegativeInteger(value.recordCount)
    && value.metadataFile === "embeddings.meta.jsonl" && value.vectorsFile === "embeddings.vectors.f32"
    && isNonNegativeInteger(value.metadataByteLength) && isNonNegativeInteger(value.vectorsByteLength)
    && typeof value.metadataDigest === "string" && value.metadataDigest.startsWith(SHA256_PREFIX)
    && typeof value.vectorsDigest === "string" && value.vectorsDigest.startsWith(SHA256_PREFIX)
    && typeof value.inputFormatVersion === "string" && (value.prefixMode === "none" || value.prefixMode === "nomic-search-query-document") && typeof value.createdAt === "string";
  if (!valid) failure("binary-manifest-invalid", "Binary manifest has invalid fields.");
  if (Number(value.inputFormatVersion) <= 0 || !Number.isInteger(Number(value.inputFormatVersion))) failure("binary-manifest-invalid", "Invalid binary input format version.");
  return value as unknown as BinaryEmbeddingManifestV1;
}

function parseMetadata(content: string, count: number): BinaryEmbeddingMetaRecord[] {
  const lines = content === "" ? [] : content.split("\n").filter((line, index, all) => !(index === all.length - 1 && line === ""));
  if (lines.length !== count) failure("binary-metadata-invalid", "Binary metadata count differs from manifest.");
  const seenIds = new Set<string>(); const ordinals = new Set<number>(); const records: BinaryEmbeddingMetaRecord[] = [];
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { failure("binary-metadata-invalid", "Binary metadata contains invalid JSON."); }
    if (!isObject(value) || "embedding" in value || typeof value.chunkId !== "string" || typeof value.path !== "string" ||
      !isNonNegativeInteger(value.index) || typeof value.textHash !== "string" || !isNonNegativeInteger(value.vectorOrdinal) ||
      (value.embeddingInputHash !== undefined && typeof value.embeddingInputHash !== "string")) failure("binary-metadata-invalid", "Binary metadata has an invalid record.");
    if (seenIds.has(value.chunkId) || ordinals.has(value.vectorOrdinal) || value.vectorOrdinal >= count) failure("binary-metadata-invalid", "Binary metadata has duplicate or out-of-range ordinals.");
    seenIds.add(value.chunkId); ordinals.add(value.vectorOrdinal);
    records.push({ chunkId: value.chunkId, path: value.path, index: value.index, textHash: value.textHash, embeddingInputHash: value.embeddingInputHash as string | undefined, vectorOrdinal: value.vectorOrdinal });
  }
  for (let ordinal = 0; ordinal < count; ordinal += 1) if (!ordinals.has(ordinal)) failure("binary-metadata-invalid", "Binary metadata has a missing ordinal.");
  return records.sort((a, b) => a.vectorOrdinal - b.vectorOrdinal);
}

async function removeIfExists(adapter: BinaryEmbeddingDataAdapter, path: string): Promise<void> {
  if (await adapter.exists(path)) await adapter.remove(path);
}

interface BinarySetPaths { manifest: string; metadata: string; vectors: string; }

async function validateSet(adapter: BinaryEmbeddingDataAdapter, digest: BinaryEmbeddingDigest, paths: BinarySetPaths = BINARY_EMBEDDING_FILES): Promise<{ manifest: BinaryEmbeddingManifestV1; metadata: string; vectors: ArrayBuffer }> {
  if (!await adapter.exists(paths.manifest)) failure("binary-manifest-missing", "Binary manifest is missing.");
  if (!await adapter.exists(paths.metadata)) failure("binary-metadata-missing", "Binary metadata is missing.");
  if (!await adapter.exists(paths.vectors)) failure("binary-vectors-missing", "Binary vectors are missing.");
  let manifest: BinaryEmbeddingManifestV1;
  try { manifest = parseManifest(JSON.parse(await adapter.read(paths.manifest)) as unknown); } catch (error) {
    if (error instanceof BinaryEmbeddingStorageError) throw error;
    failure("binary-manifest-invalid", "Binary manifest is not valid JSON.");
  }
  const [metadata, vectors, metadataStat, vectorsStat] = await Promise.all([adapter.read(paths.metadata), adapter.readBinary(paths.vectors), adapter.stat(paths.metadata), adapter.stat(paths.vectors)]);
  if (!metadataStat || !vectorsStat || metadataStat.size !== manifest.metadataByteLength || vectorsStat.size !== manifest.vectorsByteLength ||
    encode(metadata).byteLength !== manifest.metadataByteLength || vectors.byteLength !== manifest.vectorsByteLength || vectors.byteLength !== expectedBytes(manifest.recordCount, manifest.dimensions)) {
    failure("binary-size-mismatch", "Binary member sizes do not match the manifest.");
  }
  if (await digest.digest(encode(metadata)) !== manifest.metadataDigest || await digest.digest(vectors) !== manifest.vectorsDigest) failure("binary-digest-mismatch", "Binary member digest does not match.");
  parseMetadata(metadata, manifest.recordCount);
  const data = new DataView(vectors);
  for (let offset = 0; offset < vectors.byteLength; offset += 4) if (!Number.isFinite(data.getFloat32(offset, true))) failure("binary-vector-invalid", "Binary vectors contain a non-finite value.");
  return { manifest, metadata, vectors };
}

const temporaryPaths = { manifest: BINARY_EMBEDDING_FILES.manifestTemporary, metadata: BINARY_EMBEDDING_FILES.metadataTemporary, vectors: BINARY_EMBEDDING_FILES.vectorsTemporary };
const backupPaths = { manifest: BINARY_EMBEDDING_FILES.manifestBackup, metadata: BINARY_EMBEDDING_FILES.metadataBackup, vectors: BINARY_EMBEDDING_FILES.vectorsBackup };
const canonicalPaths = { manifest: BINARY_EMBEDDING_FILES.manifest, metadata: BINARY_EMBEDDING_FILES.metadata, vectors: BINARY_EMBEDDING_FILES.vectors };

export async function readBinaryEmbeddingStorage(adapter: BinaryEmbeddingDataAdapter, digest: BinaryEmbeddingDigest): Promise<RuntimeEmbeddingIndex> {
  const candidate = await validateSet(adapter, digest, canonicalPaths);
  const records = parseMetadata(candidate.metadata, candidate.manifest.recordCount);
  const vectors = new Float32Array(candidate.manifest.recordCount * candidate.manifest.dimensions);
  const data = new DataView(candidate.vectors);
  for (let index = 0; index < vectors.length; index += 1) vectors[index] = data.getFloat32(index * 4, true);
  const manifestStat = await adapter.stat(canonicalPaths.manifest);
  return {
    dimensions: candidate.manifest.dimensions, count: candidate.manifest.recordCount, vectors,
    records: records.map(({ vectorOrdinal: _ordinal, ...record }) => record), provider: candidate.manifest.provider, model: candidate.manifest.model,
    sourceIdentity: { provider: candidate.manifest.provider, model: candidate.manifest.model, dimensions: candidate.manifest.dimensions,
      inputVersion: Number(candidate.manifest.inputFormatVersion), prefixMode: candidate.manifest.prefixMode as "none" | "nomic-search-query-document",
      updatedAt: candidate.manifest.createdAt, canonicalMtime: manifestStat?.mtime ?? 0, canonicalSize: manifestStat?.size ?? 0 },
  };
}

export interface ResolvedEmbeddingStorage { format: EmbeddingStorageFormat | null; reason: "default-jsonl" | "binary-opt-in" | "binary-fallback-jsonl" | "missing" | "binary-rejected"; index?: RuntimeEmbeddingIndex; }
export interface ResolveEmbeddingStorageOptions { preferredFormat?: EmbeddingStorageFormat; allowBinaryCandidate: boolean; allowJsonlFallback: boolean; readJsonl: () => Promise<RuntimeEmbeddingIndex | null>; readBinary: () => Promise<RuntimeEmbeddingIndex>; onFallback?: (reason: string) => void; }

export async function resolveEmbeddingStorage(options: ResolveEmbeddingStorageOptions): Promise<ResolvedEmbeddingStorage> {
  if (options.preferredFormat !== "binary-v1" || !options.allowBinaryCandidate) {
    const index = await options.readJsonl(); return index ? { format: "jsonl-v1", reason: "default-jsonl", index } : { format: null, reason: "missing" };
  }
  try { return { format: "binary-v1", reason: "binary-opt-in", index: await options.readBinary() }; }
  catch {
    if (!options.allowJsonlFallback) return { format: null, reason: "binary-rejected" };
    const index = await options.readJsonl();
    if (!index) return { format: null, reason: "binary-rejected" };
    options.onFallback?.("binary-invalid-jsonl-fallback"); return { format: "jsonl-v1", reason: "binary-fallback-jsonl", index };
  }
}

export class BinaryEmbeddingPublisher {
  private publishing = false;
  private readonly writeExclusion: BinaryEmbeddingWriteExclusion;
  constructor(private readonly adapter: BinaryEmbeddingDataAdapter, private readonly digest: BinaryEmbeddingDigest, private readonly options: BinaryEmbeddingPublisherOptions = {}) {
    this.writeExclusion = options.writeExclusion ?? defaultWriteExclusion;
  }

  async publish(records: readonly EmbeddingRecord[], descriptor: EmbeddingStorageDescriptor): Promise<void> {
    if (this.publishing) failure("binary-publication-failed", "A binary publication is already running.");
    const lease = await this.writeExclusion.acquire("binary-candidate");
    if (!lease) failure("binary-publication-failed", "Binary publication could not acquire the index write exclusion.");
    this.publishing = true;
    let backedUp = false; let published = false;
    try {
      if (descriptor.format !== "binary-v1" || descriptor.recordCount !== records.length || descriptor.dimensions !== descriptor.identity.dimensions || !descriptor.generationId) failure("binary-validation-failed", "Invalid binary descriptor.");
      const candidate = buildCandidate(records, descriptor.identity);
      const metadataDigest = await this.digest.digest(encode(candidate.metadata)); const vectorsDigest = await this.digest.digest(candidate.vectors);
      const manifest: BinaryEmbeddingManifestV1 = { format: "lina-embeddings-binary", version: 1, generationId: descriptor.generationId, byteOrder: "little-endian", numericType: "float32", provider: descriptor.identity.provider, model: descriptor.identity.model, dimensions: descriptor.dimensions, recordCount: records.length, metadataFile: "embeddings.meta.jsonl", vectorsFile: "embeddings.vectors.f32", metadataByteLength: encode(candidate.metadata).byteLength, vectorsByteLength: candidate.vectors.byteLength, metadataDigest, vectorsDigest, inputFormatVersion: String(descriptor.identity.inputVersion), prefixMode: descriptor.identity.prefixMode, createdAt: new Date().toISOString() };
      await this.adapter.writeBinary(temporaryPaths.vectors, candidate.vectors);
      await this.options.onStage?.("temporary-vectors");
      await this.adapter.write(temporaryPaths.metadata, candidate.metadata);
      await this.options.onStage?.("temporary-metadata");
      await this.adapter.write(temporaryPaths.manifest, JSON.stringify(manifest));
      await this.options.onStage?.("temporary-manifest");
      await validateSet(this.adapter, this.digest, temporaryPaths);
      await this.options.onStage?.("temporary-validated");
      for (const path of Object.values(backupPaths)) await removeIfExists(this.adapter, path);
      const canonicalExists = await this.adapter.exists(canonicalPaths.manifest) || await this.adapter.exists(canonicalPaths.metadata) || await this.adapter.exists(canonicalPaths.vectors);
      if (canonicalExists) { await validateSet(this.adapter, this.digest, canonicalPaths); await this.adapter.rename(canonicalPaths.vectors, backupPaths.vectors); await this.adapter.rename(canonicalPaths.metadata, backupPaths.metadata); await this.adapter.rename(canonicalPaths.manifest, backupPaths.manifest); backedUp = true; }
      await this.options.onStage?.("backups-created");
      await this.adapter.rename(temporaryPaths.vectors, canonicalPaths.vectors);
      await this.options.onStage?.("canonical-vectors");
      await this.adapter.rename(temporaryPaths.metadata, canonicalPaths.metadata);
      await this.options.onStage?.("canonical-metadata");
      await this.adapter.rename(temporaryPaths.manifest, canonicalPaths.manifest); published = true;
      await this.options.onStage?.("canonical-manifest");
      await this.options.onStage?.("before-final-validation");
      await validateSet(this.adapter, this.digest, canonicalPaths);
      await this.options.onStage?.("final-validated");
      for (const path of Object.values(temporaryPaths)) await removeIfExists(this.adapter, path);
      for (const path of Object.values(backupPaths)) await removeIfExists(this.adapter, path);
      await this.options.onStage?.("cleanup");
    } catch (error) {
      try {
        if (published || backedUp) for (const path of Object.values(canonicalPaths)) await removeIfExists(this.adapter, path);
        if (backedUp) { await this.adapter.rename(backupPaths.vectors, canonicalPaths.vectors); await this.adapter.rename(backupPaths.metadata, canonicalPaths.metadata); await this.adapter.rename(backupPaths.manifest, canonicalPaths.manifest); }
        for (const path of Object.values(temporaryPaths)) await removeIfExists(this.adapter, path);
      } catch { failure("binary-rollback-failed", "Binary publication rollback failed."); }
      if (error instanceof BinaryEmbeddingStorageError) throw error;
      failure("binary-publication-failed", error instanceof Error ? error.message : String(error));
    } finally { this.publishing = false; lease.release(); }
  }
}

export async function recoverBinaryEmbeddingPublication(adapter: BinaryEmbeddingDataAdapter, digest: BinaryEmbeddingDigest, allowTemporaryPromotion = false): Promise<"canonical" | "backup" | "temporary" | "none"> {
  try { await validateSet(adapter, digest, canonicalPaths); for (const path of [...Object.values(temporaryPaths), ...Object.values(backupPaths)]) await removeIfExists(adapter, path); return "canonical"; } catch { /* inspect alternatives */ }
  try {
    await validateSet(adapter, digest, backupPaths);
    for (const path of Object.values(canonicalPaths)) await removeIfExists(adapter, path);
    await adapter.rename(backupPaths.vectors, canonicalPaths.vectors); await adapter.rename(backupPaths.metadata, canonicalPaths.metadata); await adapter.rename(backupPaths.manifest, canonicalPaths.manifest);
    for (const path of Object.values(temporaryPaths)) await removeIfExists(adapter, path); return "backup";
  } catch { /* no valid backup */ }
  try {
    if (allowTemporaryPromotion) { await validateSet(adapter, digest, temporaryPaths); for (const path of Object.values(canonicalPaths)) await removeIfExists(adapter, path); await adapter.rename(temporaryPaths.vectors, canonicalPaths.vectors); await adapter.rename(temporaryPaths.metadata, canonicalPaths.metadata); await adapter.rename(temporaryPaths.manifest, canonicalPaths.manifest); return "temporary"; }
  } catch { /* incomplete temporary remains invalid */ }
  for (const path of [...Object.values(temporaryPaths), ...Object.values(backupPaths)]) await removeIfExists(adapter, path);
  return "none";
}
