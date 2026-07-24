import type { EmbeddingSpaceIdentity } from "../index/embeddingUpdatePlan";
import type { EmbeddingRecord } from "../index/embeddingPersistence";

/**
 * Isolated, in-memory prototype for a possible future embedding persistence
 * format. It deliberately has no Vault or production-index dependencies.
 */
export const EXPERIMENTAL_EMBEDDING_BINARY_FORMAT = "lina-embedding-binary";
export const EXPERIMENTAL_EMBEDDING_BINARY_VERSION = 1;

export interface ExperimentalEmbeddingMetaRecord {
  chunkId: string;
  path: string;
  index: number;
  textHash: string;
  embeddingInputHash?: string;
  vectorOrdinal: number;
}

export interface ExperimentalEmbeddingBinaryManifest {
  format: typeof EXPERIMENTAL_EMBEDDING_BINARY_FORMAT;
  version: number;
  byteOrder: "little-endian";
  numericType: "float32";
  provider: string;
  model: string;
  dimensions: number;
  recordCount: number;
  vectorByteLength: number;
  inputFormatVersion?: string;
  prefixMode?: string;
  metadataChecksum?: string;
  vectorsChecksum?: string;
}

export interface ExperimentalEmbeddingBinaryOutput {
  manifest: ExperimentalEmbeddingBinaryManifest;
  metadataJsonl: string;
  vectors: ArrayBuffer;
}

export interface ExperimentalEmbeddingBinaryReadResult {
  identity: Required<EmbeddingSpaceIdentity>;
  dimensions: number;
  count: number;
  vectors: Float32Array;
  records: ExperimentalEmbeddingMetaRecord[];
}

export type ExperimentalEmbeddingBinaryErrorCode =
  | "unsupported-format"
  | "unsupported-version"
  | "unsupported-byte-order"
  | "unsupported-numeric-type"
  | "invalid-manifest"
  | "invalid-metadata"
  | "invalid-vector-length"
  | "invalid-vector-value"
  | "duplicate-chunk-id"
  | "duplicate-vector-ordinal"
  | "missing-vector-ordinal"
  | "checksum-mismatch"
  | "truncated-vectors"
  | "corrupt-metadata"
  | "overflow";

export class ExperimentalEmbeddingBinaryError extends Error {
  constructor(
    public readonly code: ExperimentalEmbeddingBinaryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ExperimentalEmbeddingBinaryError";
  }
}

const SHA256_PREFIX = "sha256:";
const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function fail(code: ExperimentalEmbeddingBinaryErrorCode, message: string): never {
  throw new ExperimentalEmbeddingBinaryError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function expectedVectorByteLength(recordCount: number, dimensions: number): number {
  const values = recordCount * dimensions;
  const bytes = values * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(values) || !Number.isSafeInteger(bytes)) {
    return fail("overflow", "recordCount * dimensions * 4 exceeds the safe integer range.");
  }
  return bytes;
}

function assertIdentity(identity: EmbeddingSpaceIdentity): Required<EmbeddingSpaceIdentity> {
  if (!isNonEmptyString(identity.provider) || !isNonEmptyString(identity.model)) {
    return fail("invalid-manifest", "Embedding identity requires a provider and model.");
  }
  if (!isPositiveInteger(identity.dimensions) || !isPositiveInteger(identity.inputVersion)) {
    return fail("invalid-manifest", "Embedding identity requires positive dimensions and inputVersion.");
  }
  if (!isNonEmptyString(identity.prefixMode)) {
    return fail("invalid-manifest", "Embedding identity requires prefixMode.");
  }
  return {
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions,
    inputVersion: identity.inputVersion,
    prefixMode: identity.prefixMode,
  };
}

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** A compact synchronous SHA-256 for this in-memory prototype (no Node API). */
function sha256(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const upper = Math.floor(bitLength / 0x100000000);
  const lower = bitLength >>> 0;
  padded[paddedLength - 8] = (upper >>> 24) & 0xff;
  padded[paddedLength - 7] = (upper >>> 16) & 0xff;
  padded[paddedLength - 6] = (upper >>> 8) & 0xff;
  padded[paddedLength - 5] = upper & 0xff;
  padded[paddedLength - 4] = (lower >>> 24) & 0xff;
  padded[paddedLength - 3] = (lower >>> 16) & 0xff;
  padded[paddedLength - 2] = (lower >>> 8) & 0xff;
  padded[paddedLength - 1] = lower & 0xff;

  const hash = SHA256_INITIAL.slice();
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = ((padded[wordOffset] << 24) | (padded[wordOffset + 1] << 16) |
        (padded[wordOffset + 2] << 8) | padded[wordOffset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      words[index] = (words[index - 16] + (rightRotate(a, 7) ^ rightRotate(a, 18) ^ (a >>> 3)) +
        words[index - 7] + (rightRotate(b, 17) ^ rightRotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sigma1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

function checksumText(value: string): string {
  return calculateExperimentalEmbeddingChecksum(value);
}

function checksumBuffer(value: ArrayBuffer): string {
  return calculateExperimentalEmbeddingChecksum(value);
}

/** Exposed only for prototype measurements and checksum verification. */
export function calculateExperimentalEmbeddingChecksum(value: string | ArrayBuffer): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return SHA256_PREFIX + sha256(bytes);
}

function validateChecksum(value: unknown, actual: string, name: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !value.startsWith(SHA256_PREFIX)) {
    fail("invalid-manifest", `${name} checksum must use the sha256:<hex> form.`);
  }
  if (value !== actual) fail("checksum-mismatch", `${name} checksum does not match.`);
}

export function writeExperimentalEmbeddingBinary(
  records: EmbeddingRecord[],
  identity: EmbeddingSpaceIdentity
): ExperimentalEmbeddingBinaryOutput {
  const completeIdentity = assertIdentity(identity);
  const dimensions = completeIdentity.dimensions;
  const vectorByteLength = expectedVectorByteLength(records.length, dimensions);
  const vectors = new ArrayBuffer(vectorByteLength);
  const view = new DataView(vectors);
  const seenChunkIds = new Set<string>();
  const metadata: ExperimentalEmbeddingMetaRecord[] = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    if (!isNonEmptyString(record.chunkId) || !isNonEmptyString(record.path) || !isNonEmptyString(record.textHash) ||
      !isNonNegativeInteger(record.index)) fail("invalid-metadata", `Record ${recordIndex} has invalid metadata.`);
    if (seenChunkIds.has(record.chunkId)) fail("duplicate-chunk-id", `Duplicate chunkId: ${record.chunkId}.`);
    seenChunkIds.add(record.chunkId);
    if (record.provider !== completeIdentity.provider || record.model !== completeIdentity.model ||
      record.dimensions !== dimensions || record.embedding.length !== dimensions) {
      fail("invalid-manifest", `Record ${recordIndex} does not match the embedding identity.`);
    }
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      const value = record.embedding[dimension];
      if (!Number.isFinite(value)) fail("invalid-vector-value", `Record ${recordIndex} contains a non-finite vector value.`);
      view.setFloat32((recordIndex * dimensions + dimension) * 4, value, true);
    }
    metadata.push({
      chunkId: record.chunkId,
      path: record.path,
      index: record.index,
      textHash: record.textHash,
      ...(record.embeddingInputHash === undefined ? {} : { embeddingInputHash: record.embeddingInputHash }),
      vectorOrdinal: recordIndex,
    });
  }
  const metadataJsonl = metadata.map((record) => JSON.stringify(record)).join("\n") + (metadata.length === 0 ? "" : "\n");
  return {
    manifest: {
      format: EXPERIMENTAL_EMBEDDING_BINARY_FORMAT,
      version: EXPERIMENTAL_EMBEDDING_BINARY_VERSION,
      byteOrder: "little-endian",
      numericType: "float32",
      provider: completeIdentity.provider,
      model: completeIdentity.model,
      dimensions,
      recordCount: records.length,
      vectorByteLength,
      inputFormatVersion: String(completeIdentity.inputVersion),
      prefixMode: completeIdentity.prefixMode,
      metadataChecksum: checksumText(metadataJsonl),
      vectorsChecksum: checksumBuffer(vectors),
    },
    metadataJsonl,
    vectors,
  };
}

function validateManifest(manifest: ExperimentalEmbeddingBinaryManifest): Required<EmbeddingSpaceIdentity> {
  if (!isObject(manifest)) fail("invalid-manifest", "Manifest must be an object.");
  if (manifest.format !== EXPERIMENTAL_EMBEDDING_BINARY_FORMAT) fail("unsupported-format", "Unsupported binary embedding format.");
  if (manifest.version !== EXPERIMENTAL_EMBEDDING_BINARY_VERSION) fail("unsupported-version", "Unsupported binary embedding version.");
  if (manifest.byteOrder !== "little-endian") fail("unsupported-byte-order", "Only little-endian vectors are supported.");
  if (manifest.numericType !== "float32") fail("unsupported-numeric-type", "Only float32 vectors are supported.");
  if (!isNonEmptyString(manifest.provider) || !isNonEmptyString(manifest.model) || !isPositiveInteger(manifest.dimensions) ||
    !isNonNegativeInteger(manifest.recordCount) || !isNonNegativeInteger(manifest.vectorByteLength) ||
    !isNonEmptyString(manifest.inputFormatVersion) || !isNonEmptyString(manifest.prefixMode)) {
    fail("invalid-manifest", "Manifest has incomplete or invalid identity fields.");
  }
  if (manifest.prefixMode !== "none" && manifest.prefixMode !== "nomic-search-query-document") {
    fail("invalid-manifest", "Manifest prefixMode is not supported.");
  }
  const inputVersion = Number(manifest.inputFormatVersion);
  if (!isPositiveInteger(inputVersion) || String(inputVersion) !== manifest.inputFormatVersion) {
    fail("invalid-manifest", "Manifest inputFormatVersion must be a positive integer string.");
  }
  const expectedLength = expectedVectorByteLength(manifest.recordCount, manifest.dimensions);
  if (manifest.vectorByteLength !== expectedLength) fail("invalid-vector-length", "Manifest vector byte length is inconsistent.");
  return { provider: manifest.provider, model: manifest.model, dimensions: manifest.dimensions, inputVersion, prefixMode: manifest.prefixMode };
}

function parseMetadata(metadataJsonl: string, count: number): ExperimentalEmbeddingMetaRecord[] {
  if (typeof metadataJsonl !== "string") fail("invalid-metadata", "Metadata must be JSONL text.");
  const lines = metadataJsonl === "" ? [] : metadataJsonl.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length !== count) fail("invalid-metadata", "Metadata line count does not match recordCount.");
  const records: ExperimentalEmbeddingMetaRecord[] = [];
  const chunkIds = new Set<string>();
  const ordinals = new Set<number>();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let parsed: unknown;
    try { parsed = JSON.parse(lines[lineIndex]); } catch { fail("corrupt-metadata", `Metadata line ${lineIndex} is not valid JSON.`); }
    if (!isObject(parsed) || "embedding" in parsed || !isNonEmptyString(parsed.chunkId) || !isNonEmptyString(parsed.path) ||
      !isNonNegativeInteger(parsed.index) || !isNonEmptyString(parsed.textHash) || !isNonNegativeInteger(parsed.vectorOrdinal) ||
      (parsed.embeddingInputHash !== undefined && !isNonEmptyString(parsed.embeddingInputHash))) {
      fail("invalid-metadata", `Metadata line ${lineIndex} has an invalid shape.`);
    }
    if (chunkIds.has(parsed.chunkId)) fail("duplicate-chunk-id", `Duplicate chunkId: ${parsed.chunkId}.`);
    if (ordinals.has(parsed.vectorOrdinal)) fail("duplicate-vector-ordinal", `Duplicate vector ordinal: ${parsed.vectorOrdinal}.`);
    if (parsed.vectorOrdinal >= count) fail("invalid-metadata", `Vector ordinal ${parsed.vectorOrdinal} is out of bounds.`);
    chunkIds.add(parsed.chunkId); ordinals.add(parsed.vectorOrdinal);
    records.push({
      chunkId: parsed.chunkId, path: parsed.path, index: parsed.index, textHash: parsed.textHash,
      ...(parsed.embeddingInputHash === undefined ? {} : { embeddingInputHash: parsed.embeddingInputHash }),
      vectorOrdinal: parsed.vectorOrdinal,
    });
  }
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    if (!ordinals.has(ordinal)) fail("missing-vector-ordinal", `Missing vector ordinal: ${ordinal}.`);
  }
  return records.sort((left, right) => left.vectorOrdinal - right.vectorOrdinal);
}

export function readExperimentalEmbeddingBinary(
  manifest: ExperimentalEmbeddingBinaryManifest,
  metadataJsonl: string,
  vectors: ArrayBuffer
): ExperimentalEmbeddingBinaryReadResult {
  const identity = validateManifest(manifest);
  if (!(vectors instanceof ArrayBuffer)) fail("invalid-vector-length", "Vectors must be an ArrayBuffer.");
  if (vectors.byteLength < manifest.vectorByteLength) fail("truncated-vectors", "Vector buffer is truncated.");
  if (vectors.byteLength !== manifest.vectorByteLength) fail("invalid-vector-length", "Vector buffer length does not match manifest.");
  validateChecksum(manifest.metadataChecksum, checksumText(metadataJsonl), "Metadata");
  validateChecksum(manifest.vectorsChecksum, checksumBuffer(vectors), "Vectors");
  const records = parseMetadata(metadataJsonl, manifest.recordCount);
  const values = new Float32Array(manifest.recordCount * manifest.dimensions);
  const view = new DataView(vectors);
  for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
    const value = view.getFloat32(valueIndex * 4, true);
    if (!Number.isFinite(value)) fail("invalid-vector-value", `Vector value ${valueIndex} is not finite.`);
    values[valueIndex] = value;
  }
  return { identity, dimensions: manifest.dimensions, count: manifest.recordCount, vectors: values, records };
}
