import type { BinaryEmbeddingDigest, EmbeddingBinaryResourceLimits } from "./embeddingBinaryStorage";
import type { RuntimeEmbeddingMetadata } from "../search/runtimeEmbeddingIndex";
import { computeVectorContractId, VECTOR_CONTRACT_METRIC, type VectorContractV1 } from "./vectorContract";

export interface PublishedGenerationReaderPorts {
  readonly adapter: Pick<import("obsidian").DataAdapter, "exists" | "read" | "readBinary" | "list">;
  readonly digest: BinaryEmbeddingDigest;
  readonly limits: EmbeddingBinaryResourceLimits;
}

export type PublishedGenerationReadStatus =
  | "OK" | "NO_CURRENT" | "CURRENT_TMP_ONLY" | "CURRENT_MALFORMED"
  | "TARGET_MISSING" | "TARGET_PARTIAL" | "MANIFEST_INVALID" | "FORMAT_UNSUPPORTED"
  | "HASH_MISMATCH" | "RECORDS_INVALID" | "VECTORS_INVALID" | "RESOURCE_LIMIT"
  | "DOWNGRADE_REJECTED" | "CURRENT_CHANGED";

export interface PublishedGenerationRuntimeIndex {
  readonly generationId: string;
  readonly vectorContractId: string;
  readonly dimensions: number;
  readonly count: number;
  readonly vectors: Float32Array;
  readonly records: readonly RuntimeEmbeddingMetadata[];
  readonly provider: string;
  readonly model: string;
  readonly dtype?: "float32";
  readonly metric?: "cosine";
  readonly inputVersion?: number;
  readonly prefixMode?: "none" | "nomic-search-query-document";
  readonly vectorContract?: VectorContractV1;
  readonly sourceTextGenerationId?: string;
  readonly sourceChunksDigest?: string;
  readonly sourcePublicationId?: string;
  readonly sourceRecordCount?: number;
  readonly producerDeviceId?: string;
  readonly producerEpoch?: number;
}

export interface PublishedGenerationReadResult {
  readonly formatVersion?: number;
  readonly cutoverEligible?: boolean;
  readonly legacyFormat?: boolean;
  readonly status: PublishedGenerationReadStatus;
  readonly generationId?: string;
  readonly currentBefore?: string;
  readonly currentAfter?: string;
  readonly index?: PublishedGenerationRuntimeIndex;
  readonly detail?: string;
  readonly providerCalls: 0;
}

export type PublishedSemanticContractStatus = "COMPATIBLE" | "SEMANTIC_CONTRACT_MISMATCH" | "SEMANTIC_CONTRACT_UNAVAILABLE";
export interface PublishedSemanticContractResult { readonly status: PublishedSemanticContractStatus; readonly detail?: string; }
/** Pure future-use guard: an M4 v3 generation may serve semantic queries only in its exact vector space. */
export function evaluatePublishedGenerationSemanticContract(index: PublishedGenerationRuntimeIndex, queryContract: VectorContractV1 | null | undefined): PublishedSemanticContractResult {
  if (!index.vectorContract || !queryContract) return { status: "SEMANTIC_CONTRACT_UNAVAILABLE", detail: "published-or-query-contract-unavailable" };
  return index.vectorContract.contractId === queryContract.contractId ? { status: "COMPATIBLE" } : { status: "SEMANTIC_CONTRACT_MISMATCH", detail: "vector-contract-id" };
}

export type PublishedSourceProvenanceStatus = "COMPATIBLE" | "SOURCE_PROVENANCE_MISMATCH" | "SOURCE_PROVENANCE_UNAVAILABLE";
export interface PublishedSourceProvenanceResult { readonly status: PublishedSourceProvenanceStatus; readonly detail?: string; }
export interface PublishedSourceProvenanceExpectation {
  readonly sourceTextGenerationId: string;
  readonly sourceChunksDigest: string;
  readonly sourcePublicationId: string;
  readonly sourceRecordCount: number;
}
/** Pure guard: v4 source provenance must match exactly; legacy formats never infer it. */
export function evaluatePublishedGenerationSourceProvenance(index: PublishedGenerationRuntimeIndex, expected: PublishedSourceProvenanceExpectation | null | undefined): PublishedSourceProvenanceResult {
  if (!expected || !index.sourceTextGenerationId || !index.sourceChunksDigest || !index.sourcePublicationId || index.sourceRecordCount === undefined) return { status: "SOURCE_PROVENANCE_UNAVAILABLE", detail: "published-or-expected-provenance-unavailable" };
  return index.sourceTextGenerationId === expected.sourceTextGenerationId && index.sourceChunksDigest === expected.sourceChunksDigest && index.sourcePublicationId === expected.sourcePublicationId && index.sourceRecordCount === expected.sourceRecordCount
    ? { status: "COMPATIBLE" }
    : { status: "SOURCE_PROVENANCE_MISMATCH", detail: "source-provenance" };
}

export interface PublishedGenerationReaderOptions {
  readonly lastValidGenerationId?: string;
}

interface Manifest {
  readonly formatVersion: number;
  readonly generationId: string;
  readonly vectorContractId: string;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly dtype: "float32";
  readonly metric?: "cosine";
  readonly inputVersion?: number;
  readonly prefixMode?: "none" | "nomic-search-query-document";
  readonly vectorContract?: VectorContractV1;
  readonly sourceTextGenerationId?: string;
  readonly sourceChunksDigest?: string;
  readonly sourcePublicationId?: string;
  readonly sourceRecordCount?: number;
  readonly producerDeviceId?: string;
  readonly producerEpoch?: number;
  readonly recordCount: number;
  readonly vectorsFile: "vectors.bin";
  readonly recordsFile: "records.json";
  readonly vectorsByteLength: number;
  readonly vectorsSha256: string;
  readonly recordsSha256: string;
}

interface RecordEntry {
  readonly index: number;
  readonly offsetBytes: number;
  readonly chunkId: string;
  readonly notePath: string;
  readonly chunkIndex: number;
  readonly textHash: string;
  readonly vectorContractId: string;
  readonly embeddingInputHash?: string;
}

const ROOT = ".lina/published";
const CURRENT = `${ROOT}/CURRENT`;
const CURRENT_TMP = `${ROOT}/CURRENT.tmp`;
const GENERATIONS = `${ROOT}/generations`;
const GENERATION_ID = /^generation-\d{6,}$/;

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function generationNumber(value: string): number { return Number(value.slice("generation-".length)); }
function digestMatches(expected: string, actual: string): boolean { return expected.replace(/^sha256:/i, "").toLowerCase() === actual.replace(/^sha256:/i, "").toLowerCase(); }
function utf8(value: string): ArrayBuffer { const bytes = new TextEncoder().encode(value); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }

function parseManifest(value: string, target: string): { manifest?: Manifest; status?: PublishedGenerationReadStatus; detail?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return { status: "MANIFEST_INVALID", detail: "manifest-json-invalid" }; }
  if (!isObject(parsed)) return { status: "MANIFEST_INVALID", detail: "manifest-not-object" };
  if (parsed.formatVersion !== 1 && parsed.formatVersion !== 2 && parsed.formatVersion !== 3 && parsed.formatVersion !== 4 && parsed.formatVersion !== 5) return { status: "FORMAT_UNSUPPORTED", detail: "format-version" };
  if (
    parsed.generationId !== target || typeof parsed.vectorContractId !== "string" || !parsed.vectorContractId
    || typeof parsed.provider !== "string" || !parsed.provider || typeof parsed.model !== "string" || !parsed.model
    || !isPositiveInteger(parsed.dimensions) || parsed.dtype !== "float32" || !isNonNegativeInteger(parsed.recordCount)
    || parsed.vectorsFile !== "vectors.bin" || parsed.recordsFile !== "records.json"
    || !isNonNegativeInteger(parsed.vectorsByteLength) || typeof parsed.vectorsSha256 !== "string" || typeof parsed.recordsSha256 !== "string"
  ) return { status: "MANIFEST_INVALID", detail: "manifest-contract" };
  const v3InputValid = (parsed.formatVersion !== 3 && parsed.formatVersion !== 4 && parsed.formatVersion !== 5) || (parsed.metric === VECTOR_CONTRACT_METRIC && parsed.inputVersion === 1 && (parsed.prefixMode === "none" || parsed.prefixMode === "nomic-search-query-document") && isObject(parsed.vectorContract));
  if (!v3InputValid) return { status: "MANIFEST_INVALID", detail: "v3-input-contract" };
  if (parsed.formatVersion === 3 || parsed.formatVersion === 4 || parsed.formatVersion === 5) {
    const expected = computeVectorContractId({ provider: parsed.provider, model: parsed.model, dimensions: parsed.dimensions, metric: parsed.metric as "cosine", prefixMode: parsed.prefixMode as string, inputVersion: parsed.inputVersion as number });
    const contract = parsed.vectorContract as VectorContractV1;
    if (parsed.vectorContractId !== expected || contract.contractId !== expected || contract.provider !== parsed.provider || contract.model !== parsed.model || contract.dimensions !== parsed.dimensions || contract.metric !== parsed.metric || contract.prefixMode !== parsed.prefixMode || contract.inputVersion !== parsed.inputVersion) return { status: "MANIFEST_INVALID", detail: "VECTOR_CONTRACT_MISMATCH" };
  }
  if (parsed.formatVersion === 4 || parsed.formatVersion === 5) {
    if (typeof parsed.sourceTextGenerationId !== "string" || !parsed.sourceTextGenerationId.trim()) return { status: "MANIFEST_INVALID", detail: "SOURCE_TEXT_GENERATION_MISSING" };
    if (typeof parsed.sourceChunksDigest !== "string" || !parsed.sourceChunksDigest.trim()) return { status: "MANIFEST_INVALID", detail: "SOURCE_CHUNKS_DIGEST_MISSING" };
    if (typeof parsed.sourcePublicationId !== "string" || !parsed.sourcePublicationId.trim()) return { status: "MANIFEST_INVALID", detail: "SOURCE_PUBLICATION_MISSING" };
    if (!isNonNegativeInteger(parsed.sourceRecordCount) || parsed.sourceRecordCount !== parsed.recordCount) return { status: "MANIFEST_INVALID", detail: "SOURCE_RECORD_COUNT_MISMATCH" };
  }
  if (parsed.formatVersion === 5) {
    if (typeof parsed.producerDeviceId !== "string" || !parsed.producerDeviceId.trim()) return { status: "MANIFEST_INVALID", detail: "PRODUCER_DEVICE_ID_MISSING" };
    if (!isPositiveInteger(parsed.producerEpoch)) return { status: "MANIFEST_INVALID", detail: "PRODUCER_EPOCH_MISSING" };
  }
  return { manifest: {
    formatVersion: parsed.formatVersion, generationId: parsed.generationId, vectorContractId: parsed.vectorContractId,
    provider: parsed.provider, model: parsed.model, dimensions: parsed.dimensions, dtype: parsed.dtype,
    recordCount: parsed.recordCount, vectorsFile: parsed.vectorsFile, recordsFile: parsed.recordsFile,
    vectorsByteLength: parsed.vectorsByteLength, vectorsSha256: parsed.vectorsSha256, recordsSha256: parsed.recordsSha256,
    metric: parsed.formatVersion >= 3 ? VECTOR_CONTRACT_METRIC : undefined,
    inputVersion: parsed.formatVersion >= 3 ? parsed.inputVersion as number : undefined,
    prefixMode: parsed.formatVersion >= 3 ? parsed.prefixMode as "none" | "nomic-search-query-document" : undefined,
    vectorContract: parsed.formatVersion >= 3 ? parsed.vectorContract as VectorContractV1 : undefined,
    sourceTextGenerationId: parsed.formatVersion >= 4 ? parsed.sourceTextGenerationId as string : undefined,
    sourceChunksDigest: parsed.formatVersion >= 4 ? parsed.sourceChunksDigest as string : undefined,
    sourcePublicationId: parsed.formatVersion >= 4 ? parsed.sourcePublicationId as string : undefined,
    sourceRecordCount: parsed.formatVersion >= 4 ? parsed.sourceRecordCount as number : undefined,
    producerDeviceId: parsed.formatVersion === 5 ? parsed.producerDeviceId as string : undefined,
    producerEpoch: parsed.formatVersion === 5 ? parsed.producerEpoch as number : undefined,
  } };
}

function validateResourceLimits(manifest: Manifest, limits: EmbeddingBinaryResourceLimits): string | null {
  const expectedBytes = manifest.recordCount * manifest.dimensions * 4;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes !== manifest.vectorsByteLength) return "vectors-byte-contract";
  if (manifest.recordCount > limits.maxRecordCount || manifest.dimensions > limits.maxDimensions) return "count-or-dimensions";
  if (manifest.vectorsByteLength > limits.maxVectorBytes || manifest.vectorsByteLength > limits.maxTotalFileBytes) return "vectors-bytes";
  return null;
}

function parseRecords(value: string, manifest: Manifest): { records?: RecordEntry[]; detail?: string } {
  let records: unknown;
  try { records = JSON.parse(value); } catch { return { detail: "records-json-invalid" }; }
  if (!Array.isArray(records) || records.length !== manifest.recordCount) return { detail: "records-count" };
  const entries: unknown[] = records;
  const seen = new Set<string>();
  const validRecords: RecordEntry[] = [];
  for (let offset = 0; offset < entries.length; offset++) {
    const record = entries[offset];
    if (!isObject(record) || !isNonNegativeInteger(record.index) || record.index !== offset || !isNonNegativeInteger(record.offsetBytes)
      || record.offsetBytes !== offset * manifest.dimensions * 4 || typeof record.chunkId !== "string" || !record.chunkId
      || typeof record.notePath !== "string" || !record.notePath || !isNonNegativeInteger(record.chunkIndex)
      || typeof record.textHash !== "string" || !record.textHash || record.vectorContractId !== manifest.vectorContractId
      || (manifest.formatVersion >= 2 && (typeof record.embeddingInputHash !== "string" || !record.embeddingInputHash.trim())) || seen.has(record.chunkId)) {
      return { detail: "records-contract" };
    }
    seen.add(record.chunkId);
    validRecords.push({ index: record.index, offsetBytes: record.offsetBytes, chunkId: record.chunkId, notePath: record.notePath,
      chunkIndex: record.chunkIndex, textHash: record.textHash, vectorContractId: record.vectorContractId, embeddingInputHash: typeof record.embeddingInputHash === "string" ? record.embeddingInputHash : undefined });
  }
  return { records: validRecords };
}

/** Strictly read-only M5A consumer for an immutable M4 generation. */
export class PublishedGenerationReader {
  constructor(private readonly ports: PublishedGenerationReaderPorts) {}

  async read(options: PublishedGenerationReaderOptions = {}): Promise<PublishedGenerationReadResult> {
    const result = await this.readGeneration(options);
    return { ...result, cutoverEligible: result.status === "OK" && result.cutoverEligible === true };
  }

  private async readGeneration(options: PublishedGenerationReaderOptions): Promise<PublishedGenerationReadResult> {
    const adapter = this.ports.adapter;
    const hasCurrent = await adapter.exists(CURRENT);
    if (!hasCurrent) return { status: await adapter.exists(CURRENT_TMP) ? "CURRENT_TMP_ONLY" : "NO_CURRENT", providerCalls: 0 };
    const currentBefore = (await adapter.read(CURRENT)).trim();
    if (!GENERATION_ID.test(currentBefore)) return { status: "CURRENT_MALFORMED", currentBefore, providerCalls: 0 };
    if (options.lastValidGenerationId && generationNumber(currentBefore) < generationNumber(options.lastValidGenerationId)) {
      return { status: "DOWNGRADE_REJECTED", generationId: currentBefore, currentBefore, providerCalls: 0 };
    }
    const target = `${GENERATIONS}/${currentBefore}`;
    if (!await adapter.exists(target)) return { status: "TARGET_MISSING", generationId: currentBefore, currentBefore, providerCalls: 0 };
    const manifestPath = `${target}/manifest.json`; const recordsPath = `${target}/records.json`; const vectorsPath = `${target}/vectors.bin`;
    if (!await adapter.exists(manifestPath) || !await adapter.exists(recordsPath) || !await adapter.exists(vectorsPath)) {
      return { status: "TARGET_PARTIAL", generationId: currentBefore, currentBefore, providerCalls: 0 };
    }
    const parsedManifest = parseManifest(await adapter.read(manifestPath), currentBefore);
    if (!parsedManifest.manifest) return { status: parsedManifest.status ?? "MANIFEST_INVALID", generationId: currentBefore, currentBefore, detail: parsedManifest.detail, providerCalls: 0 };
    const manifest = parsedManifest.manifest;
    const resourceError = validateResourceLimits(manifest, this.ports.limits);
    if (resourceError) return { status: resourceError === "vectors-byte-contract" ? "VECTORS_INVALID" : "RESOURCE_LIMIT", generationId: currentBefore, currentBefore, detail: resourceError, providerCalls: 0 };
    const recordsText = await adapter.read(recordsPath);
    if (new TextEncoder().encode(recordsText).byteLength > this.ports.limits.maxMetadataBytes) return { status: "RESOURCE_LIMIT", generationId: currentBefore, currentBefore, detail: "records-bytes", providerCalls: 0 };
    if (!digestMatches(manifest.recordsSha256, await this.ports.digest.digest(utf8(recordsText)))) return { status: "HASH_MISMATCH", generationId: currentBefore, currentBefore, detail: "records", providerCalls: 0 };
    const parsedRecords = parseRecords(recordsText, manifest);
    if (!parsedRecords.records) return { status: "RECORDS_INVALID", generationId: currentBefore, currentBefore, detail: parsedRecords.detail, providerCalls: 0 };
    const vectorsBuffer = await adapter.readBinary(vectorsPath);
    if (vectorsBuffer.byteLength !== manifest.vectorsByteLength) return { status: "VECTORS_INVALID", generationId: currentBefore, currentBefore, detail: "vectors-byte-length", providerCalls: 0 };
    if (!digestMatches(manifest.vectorsSha256, await this.ports.digest.digest(vectorsBuffer))) return { status: "HASH_MISMATCH", generationId: currentBefore, currentBefore, detail: "vectors", providerCalls: 0 };
    const vectors = new Float32Array(vectorsBuffer);
    let hasNonFiniteVectorValue = false;
    for (const value of vectors) if (!Number.isFinite(value)) { hasNonFiniteVectorValue = true; break; }
    if (vectors.length !== manifest.recordCount * manifest.dimensions || hasNonFiniteVectorValue) {
      return { status: "VECTORS_INVALID", generationId: currentBefore, currentBefore, detail: "vectors-layout", providerCalls: 0 };
    }
    const currentAfter = await adapter.exists(CURRENT) ? (await adapter.read(CURRENT)).trim() : undefined;
    if (currentAfter !== currentBefore) return { status: "CURRENT_CHANGED", generationId: currentBefore, currentBefore, currentAfter, providerCalls: 0 };
    return {
      status: "OK", generationId: currentBefore, currentBefore, currentAfter, providerCalls: 0,
      formatVersion: manifest.formatVersion, cutoverEligible: manifest.formatVersion === 5, legacyFormat: manifest.formatVersion === 1 || manifest.formatVersion === 2 || manifest.formatVersion === 3 || manifest.formatVersion === 4,
      index: {
        generationId: currentBefore, vectorContractId: manifest.vectorContractId, dimensions: manifest.dimensions,
        count: manifest.recordCount, vectors, provider: manifest.provider, model: manifest.model,
        dtype: manifest.dtype, metric: manifest.metric, inputVersion: manifest.inputVersion, prefixMode: manifest.prefixMode, vectorContract: manifest.vectorContract,
        sourceTextGenerationId: manifest.sourceTextGenerationId, sourceChunksDigest: manifest.sourceChunksDigest, sourcePublicationId: manifest.sourcePublicationId, sourceRecordCount: manifest.sourceRecordCount,
        producerDeviceId: manifest.producerDeviceId, producerEpoch: manifest.producerEpoch,
        records: parsedRecords.records.map((record) => ({ chunkId: record.chunkId, path: record.notePath, index: record.chunkIndex, textHash: record.textHash, embeddingInputHash: record.embeddingInputHash })),
      },
    };
  }
}
