import { PUBLISHED_GENERATION_FORMAT_VERSION, type PublishedGenerationManifest, type PublishedGenerationRecord } from "./publishedGenerationBuilder";
import { computeVectorContractId, isValidVectorContract, VECTOR_CONTRACT_METRIC } from "./vectorContract";

export interface PublishedGenerationValidationError { readonly code: string; readonly detail: string; }
export interface PublishedGenerationValidationResult { readonly valid: boolean; readonly integrityValid: boolean; readonly cutoverEligible: boolean; readonly legacyFormat: boolean; readonly formatVersion?: number; readonly errors: readonly PublishedGenerationValidationError[]; }
function result(errors: readonly PublishedGenerationValidationError[], formatVersion?: number): PublishedGenerationValidationResult {
  const integrityValid = errors.length === 0;
  return { valid: integrityValid, integrityValid, cutoverEligible: integrityValid && formatVersion === PUBLISHED_GENERATION_FORMAT_VERSION, legacyFormat: formatVersion === 1 || formatVersion === 2 || formatVersion === 3 || formatVersion === 4, formatVersion, errors };
}
interface HashLike { update(value: Uint8Array | string): HashLike; digest(encoding: "hex"): string; }
interface CryptoLike { createHash(algorithm: "sha256"): HashLike; }
const digest = (value: Uint8Array | string): string => {
  // eslint-disable-next-line no-undef -- Validator runs only in the desktop Producer publication path.
  const req = typeof require === "function" ? require : null;
  if (!req) throw new Error("SHA-256 requires desktop Node runtime.");
  return (req("node:crypto") as CryptoLike).createHash("sha256").update(value).digest("hex");
};

/** Validates read artefacts only; it has no publish or CURRENT side effects. */
export function validatePublishedGenerationFiles(files: { manifest?: string; vectors?: Uint8Array; records?: string }): PublishedGenerationValidationResult {
  const errors: PublishedGenerationValidationError[] = [];
  if (!files.manifest) return result([{ code: "MISSING_MANIFEST", detail: "manifest.json is absent." }]);
  let manifest: PublishedGenerationManifest;
  let records: PublishedGenerationRecord[];
  try { manifest = JSON.parse(files.manifest) as PublishedGenerationManifest; } catch { return result([{ code: "INVALID_MANIFEST", detail: "manifest.json is invalid." }]); }
  if (!manifest || typeof manifest !== "object") return result([{ code: "INVALID_MANIFEST", detail: "manifest.json is not an object." }]);
  try { records = JSON.parse(files.records ?? "") as PublishedGenerationRecord[]; } catch { return result([{ code: "INVALID_RECORDS", detail: "records.json is invalid." }], manifest.formatVersion); }
  if (!Array.isArray(records) || records.some((record) => !record || typeof record !== "object")) return result([{ code: "INVALID_RECORDS", detail: "records.json is not a record array." }], manifest.formatVersion);
  if (!files.vectors) errors.push({ code: "MISSING_VECTORS", detail: "vectors.bin is absent." });
  if (!files.records) errors.push({ code: "MISSING_RECORDS", detail: "records.json is absent." });
  if (manifest.formatVersion !== 1 && manifest.formatVersion !== 2 && manifest.formatVersion !== 3 && manifest.formatVersion !== 4 && manifest.formatVersion !== PUBLISHED_GENERATION_FORMAT_VERSION) errors.push({ code: "FORMAT_UNSUPPORTED", detail: "formatVersion is unsupported." });
  if (!/^generation-\d{6,}$/.test(manifest.generationId) || !Number.isSafeInteger(manifest.recordCount) || manifest.recordCount < 0 || !manifest.provider || !manifest.model || manifest.vectorsFile !== "vectors.bin" || manifest.recordsFile !== "records.json") errors.push({ code: "INVALID_MANIFEST_CONTRACT", detail: "manifest contract is invalid." });
  if (!manifest.vectorContractId || manifest.dtype !== "float32" || !Number.isInteger(manifest.dimensions) || manifest.dimensions < 1) errors.push({ code: "INVALID_VECTOR_CONTRACT", detail: "vector contract is invalid." });
  if (manifest.formatVersion === 3 || manifest.formatVersion === 4 || manifest.formatVersion === PUBLISHED_GENERATION_FORMAT_VERSION) {
    const contract = manifest.vectorContract;
    const supportedPrefix = manifest.prefixMode === "none" || manifest.prefixMode === "nomic-search-query-document";
    if (manifest.metric !== VECTOR_CONTRACT_METRIC || !Number.isInteger(manifest.inputVersion) || manifest.inputVersion !== 1 || !supportedPrefix || !isValidVectorContract(contract)) {
      errors.push({ code: "INVALID_INPUT_CONTRACT", detail: "v3 input contract is invalid." });
    } else {
      const expected = computeVectorContractId({ provider: manifest.provider, model: manifest.model, dimensions: manifest.dimensions, metric: manifest.metric, prefixMode: manifest.prefixMode, inputVersion: manifest.inputVersion });
      if (manifest.vectorContractId !== expected || contract.contractId !== expected || contract.provider !== manifest.provider || contract.model !== manifest.model || contract.dimensions !== manifest.dimensions || contract.metric !== manifest.metric || contract.prefixMode !== manifest.prefixMode || contract.inputVersion !== manifest.inputVersion) errors.push({ code: "VECTOR_CONTRACT_MISMATCH", detail: "v3 vector contract does not match manifest fields." });
    }
  }
  if (manifest.formatVersion === 4 || manifest.formatVersion === PUBLISHED_GENERATION_FORMAT_VERSION) {
    if (typeof manifest.sourceTextGenerationId !== "string" || !manifest.sourceTextGenerationId.trim()) errors.push({ code: "SOURCE_TEXT_GENERATION_MISSING", detail: "sourceTextGenerationId is required for v4." });
    if (typeof manifest.sourceChunksDigest !== "string" || !manifest.sourceChunksDigest.trim()) errors.push({ code: "SOURCE_CHUNKS_DIGEST_MISSING", detail: "sourceChunksDigest is required for v4." });
    if (typeof manifest.sourcePublicationId !== "string" || !manifest.sourcePublicationId.trim()) errors.push({ code: "SOURCE_PUBLICATION_MISSING", detail: "sourcePublicationId is required for v4." });
    if (!Number.isSafeInteger(manifest.sourceRecordCount) || manifest.sourceRecordCount !== manifest.recordCount) errors.push({ code: "SOURCE_RECORD_COUNT_MISMATCH", detail: "sourceRecordCount must match recordCount for v4." });
  }
  if (manifest.formatVersion === PUBLISHED_GENERATION_FORMAT_VERSION) {
    if (typeof manifest.producerDeviceId !== "string" || !manifest.producerDeviceId.trim()) errors.push({ code: "PRODUCER_DEVICE_ID_MISSING", detail: "producerDeviceId is required for v5." });
    if (!Number.isSafeInteger(manifest.producerEpoch) || manifest.producerEpoch < 1) errors.push({ code: "PRODUCER_EPOCH_MISSING", detail: "producerEpoch is required for v5." });
  }
  if (manifest.recordCount !== records.length) errors.push({ code: "RECORD_COUNT_MISMATCH", detail: "recordCount differs." });
  if (files.vectors && (manifest.vectorsByteLength !== files.vectors.byteLength || manifest.vectorsSha256 !== digest(files.vectors))) errors.push({ code: "VECTORS_INTEGRITY", detail: "vectors size or SHA-256 differs." });
  if (files.records && manifest.recordsSha256 !== digest(files.records)) errors.push({ code: "RECORDS_INTEGRITY", detail: "records SHA-256 differs." });
  const ids = new Set(records.map((record) => record.chunkId));
  if (ids.size !== records.length) errors.push({ code: "DUPLICATE_IDENTITY", detail: "duplicate chunkId." });
  if (records.some((record) => typeof record.chunkId !== "string" || !record.chunkId || typeof record.notePath !== "string" || !record.notePath || !Number.isSafeInteger(record.chunkIndex) || record.chunkIndex < 0 || typeof record.textHash !== "string" || !record.textHash || record.vectorContractId !== manifest.vectorContractId)) errors.push({ code: "INVALID_RECORD_CONTRACT", detail: "record metadata or vectorContractId is invalid." });
  if ((manifest.formatVersion === 2 || manifest.formatVersion === 3 || manifest.formatVersion === 4 || manifest.formatVersion === PUBLISHED_GENERATION_FORMAT_VERSION) && records.some((record) => typeof record.embeddingInputHash !== "string" || !record.embeddingInputHash.trim())) errors.push({ code: "MISSING_INPUT_HASH", detail: "embeddingInputHash is absent." });
  if (files.vectors && (files.vectors.byteLength !== records.length * manifest.dimensions * 4 || records.some((record, index) => record.index !== index || record.offsetBytes !== index * manifest.dimensions * 4))) errors.push({ code: "INVALID_OFFSETS", detail: "record offsets do not match vectors.bin." });
  if (files.vectors && files.vectors.byteLength % 4 === 0) {
    const copy = new Uint8Array(files.vectors);
    if (new Float32Array(copy.buffer).some((value) => !Number.isFinite(value))) errors.push({ code: "INVALID_VECTORS", detail: "non-finite vector value." });
  }
  return result(errors, manifest.formatVersion);
}
