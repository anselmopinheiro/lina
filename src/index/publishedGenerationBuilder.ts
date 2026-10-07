/** M4 immutable, derived generation builder.  It never reads or writes SQLite. */
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "./producerLocalStoreTypes";
import { computeVectorContractId, createVectorContract, VECTOR_CONTRACT_METRIC, type VectorContractV1 } from "./vectorContract";

export const PUBLISHED_GENERATION_FORMAT_VERSION = 5;
export const PUBLISHED_GENERATION_SUPPORTED_INPUT_VERSIONS = [1] as const;
export const PUBLISHED_GENERATION_PREFIX_MODES = ["none", "nomic-search-query-document"] as const;
export type PublishedGenerationPrefixMode = (typeof PUBLISHED_GENERATION_PREFIX_MODES)[number];

export interface PublishedGenerationManifest {
  readonly formatVersion: number; readonly generationId: string; readonly createdAt: string;
  readonly vectorContractId: string; readonly provider: string; readonly model: string;
  readonly dimensions: number; readonly dtype: "float32"; readonly metric: "cosine";
  readonly inputVersion: number; readonly prefixMode: PublishedGenerationPrefixMode;
  readonly vectorContract: VectorContractV1; readonly recordCount: number;
  readonly sourceTextGenerationId: string; readonly sourceChunksDigest: string;
  readonly sourcePublicationId: string; readonly sourceRecordCount: number;
  readonly producerDeviceId: string; readonly producerEpoch: number;
  readonly vectorsFile: "vectors.bin"; readonly recordsFile: "records.json";
  readonly vectorsByteLength: number; readonly vectorsSha256: string; readonly recordsSha256: string;
}
export interface PublishedProducerProvenance { readonly producerDeviceId: string; readonly producerEpoch: number; }
export interface PublishedGenerationRecord {
  readonly index: number; readonly offsetBytes: number; readonly chunkId: string;
  readonly notePath: string; readonly chunkIndex: number; readonly textHash: string; readonly vectorContractId: string; readonly embeddingInputHash?: string;
}
export interface BuiltGeneration { readonly manifest: PublishedGenerationManifest; readonly records: readonly PublishedGenerationRecord[]; readonly vectors: Uint8Array; readonly recordsJson: string; }

interface HashLike { update(value: Uint8Array | string): HashLike; digest(encoding: "hex"): string; }
interface NodeCryptoLike { createHash(algorithm: "sha256"): HashLike; }
function sha256(value: Uint8Array | string): string {
  // eslint-disable-next-line no-undef -- The M4 Producer-only builder runs behind a desktop feature flag.
  const req = typeof require === "function" ? require : null;
  if (!req) throw new Error("SHA-256 requires the desktop Node runtime.");
  const crypto = req("node:crypto") as NodeCryptoLike;
  return crypto.createHash("sha256").update(value).digest("hex");
}
function vectorOf(record: ProducerEmbeddingRecord): Float32Array {
  return record.embeddingBlob instanceof Float32Array ? record.embeddingBlob : new Float32Array(record.embeddingBlob);
}
function isSupportedInputVersion(value: number): value is (typeof PUBLISHED_GENERATION_SUPPORTED_INPUT_VERSIONS)[number] {
  return PUBLISHED_GENERATION_SUPPORTED_INPUT_VERSIONS.includes(value as 1);
}
function isPrefixMode(value: string): value is PublishedGenerationPrefixMode {
  return (PUBLISHED_GENERATION_PREFIX_MODES as readonly string[]).includes(value);
}
export function buildImmutableGeneration(space: EmbeddingSpaceRecord, source: readonly ProducerEmbeddingRecord[], generationNumber: number, createdAt = new Date().toISOString(), producer?: PublishedProducerProvenance): BuiltGeneration {
  if (!Number.isSafeInteger(generationNumber) || generationNumber < 1) throw new Error("generationNumber must be a positive integer.");
  if (!isSupportedInputVersion(space.inputVersion)) throw new Error("Unsupported embedding inputVersion for published generation.");
  if (!isPrefixMode(space.prefixMode)) throw new Error("Unsupported embedding prefixMode for published generation.");
  const provenance = space.sourceProvenance;
  if (!provenance?.sourceTextGenerationId?.trim()) throw new Error("SOURCE_TEXT_GENERATION_MISSING");
  if (!provenance.sourceChunksDigest?.trim()) throw new Error("SOURCE_CHUNKS_DIGEST_MISSING");
  if (!provenance.sourcePublicationId?.trim()) throw new Error("SOURCE_PUBLICATION_MISSING");
  if (!Number.isSafeInteger(provenance.sourceRecordCount) || provenance.sourceRecordCount !== source.length) throw new Error("SOURCE_RECORD_COUNT_MISMATCH");
  const producerProvenance = producer ?? space.publicationProducerProvenance;
  if (!producerProvenance?.producerDeviceId?.trim()) throw new Error("PRODUCER_DEVICE_ID_MISSING");
  if (!Number.isSafeInteger(producerProvenance.producerEpoch) || producerProvenance.producerEpoch < 1) throw new Error("PRODUCER_EPOCH_MISSING");
  const vectorContract = createVectorContract({ provider: space.provider, model: space.model, dimensions: space.dimensions, metric: VECTOR_CONTRACT_METRIC, prefixMode: space.prefixMode, inputVersion: space.inputVersion });
  const expectedContractId = vectorContract.contractId;
  if (space.vectorContractId !== expectedContractId || (space.vectorContract && space.vectorContract.contractId !== expectedContractId)) throw new Error("Vector contract mismatch for published generation.");
  const ordered = [...source].sort((a, b) => a.notePath.localeCompare(b.notePath) || a.chunkIndex - b.chunkIndex || a.chunkId.localeCompare(b.chunkId));
  const vectors = new Uint8Array(ordered.reduce((total, record) => total + vectorOf(record).byteLength, 0));
  const records: PublishedGenerationRecord[] = [];
  let offset = 0;
  for (const [index, record] of ordered.entries()) {
    if (typeof record.embeddingInputHash !== "string" || !record.embeddingInputHash.trim()) throw new Error(`Missing embeddingInputHash for ${record.chunkId}.`);
    const vector = vectorOf(record);
    if (vector.length !== space.dimensions) throw new Error(`Dimension mismatch for ${record.chunkId}.`);
    vectors.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength), offset);
    records.push({ index, offsetBytes: offset, chunkId: record.chunkId, notePath: record.notePath, chunkIndex: record.chunkIndex, textHash: record.textHash, vectorContractId: record.vectorContractId, embeddingInputHash: record.embeddingInputHash });
    offset += vector.byteLength;
  }
  const recordsJson = JSON.stringify(records);
  const generationId = `generation-${generationNumber.toString().padStart(6, "0")}`;
  return { vectors, records, recordsJson, manifest: { formatVersion: PUBLISHED_GENERATION_FORMAT_VERSION, generationId, createdAt, vectorContractId: expectedContractId, provider: vectorContract.provider, model: vectorContract.model, dimensions: vectorContract.dimensions, dtype: "float32", metric: VECTOR_CONTRACT_METRIC, inputVersion: vectorContract.inputVersion, prefixMode: vectorContract.prefixMode as PublishedGenerationPrefixMode, vectorContract, recordCount: records.length, sourceTextGenerationId: provenance.sourceTextGenerationId, sourceChunksDigest: provenance.sourceChunksDigest, sourcePublicationId: provenance.sourcePublicationId, sourceRecordCount: provenance.sourceRecordCount, producerDeviceId: producerProvenance.producerDeviceId, producerEpoch: producerProvenance.producerEpoch, vectorsFile: "vectors.bin", recordsFile: "records.json", vectorsByteLength: vectors.byteLength, vectorsSha256: sha256(vectors), recordsSha256: sha256(recordsJson) } };
}

export function validateBuiltGeneration(generation: BuiltGeneration): string | null {
  const { manifest, records, vectors, recordsJson } = generation;
  if (manifest.formatVersion !== PUBLISHED_GENERATION_FORMAT_VERSION || manifest.recordCount !== records.length) return "manifest-count-or-version";
  if (!manifest.sourceTextGenerationId || !manifest.sourceChunksDigest || !manifest.sourcePublicationId || manifest.sourceRecordCount !== records.length) return "source-provenance";
  if (!manifest.producerDeviceId || !Number.isSafeInteger(manifest.producerEpoch) || manifest.producerEpoch < 1) return "producer-provenance";
  if (!isSupportedInputVersion(manifest.inputVersion) || !isPrefixMode(manifest.prefixMode) || manifest.metric !== VECTOR_CONTRACT_METRIC) return "input-contract";
  if (computeVectorContractId(manifest.vectorContract) !== manifest.vectorContractId) return "vector-contract";
  if (records.some((record) => !record.embeddingInputHash?.trim())) return "missing-input-hash";
  if (manifest.vectorsByteLength !== vectors.byteLength || manifest.vectorsSha256 !== sha256(vectors) || manifest.recordsSha256 !== sha256(recordsJson)) return "checksum-or-size";
  const ids = new Set(records.map((record) => record.chunkId));
  if (ids.size !== records.length || records.some((record, index) => record.index !== index || record.offsetBytes !== index * manifest.dimensions * 4)) return "record-layout";
  return vectors.byteLength === records.length * manifest.dimensions * 4 ? null : "vector-layout";
}
