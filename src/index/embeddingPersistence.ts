import { App, normalizePath } from "obsidian";
import { isValidEmbeddingVector } from "../ai/embeddingTypes";
import { ArtifactProvenance, isValidArtifactProvenance } from "../device/artifactProvenance";
import {
  createVectorContract,
  isValidVectorContract,
} from "./vectorContract";
import {
  ExclusionPolicyV1,
  ExclusionPolicyRules,
  resolveDefensiveExclusionRules,
  FilterableChunk,
} from "./exclusionPolicy";
import { shouldExcludePath } from "./indexExclusions";
import { IndexWriteCoordinator } from "./indexWriteCoordinator";
import { evaluateEmbeddingBridgeRead } from "./embeddingResourceGuard";
import { getDeviceCapabilities } from "../capabilities/deviceCapabilities";

export const EMBEDDING_PERSISTENCE_FILES = Object.freeze({
  canonicalEmbeddings: normalizePath(".lina/index/embeddings.jsonl"),
  canonicalManifest: normalizePath(".lina/index/manifest.json"),
  checkpoint: normalizePath(".lina/producer/checkpoints/embeddings.checkpoint.jsonl"),
  checkpointMetadata: normalizePath(".lina/producer/checkpoints/embeddings.checkpoint.meta.json"),
  checkpointTemporary: normalizePath(".lina/producer/staging/embeddings.checkpoint.tmp"),
  checkpointMetadataTemporary: normalizePath(".lina/producer/staging/embeddings.checkpoint.meta.tmp"),
  checkpointBackup: normalizePath(".lina/producer/backups/embeddings.checkpoint.backup"),
  checkpointMetadataBackup: normalizePath(".lina/producer/backups/embeddings.checkpoint.meta.backup"),
  embeddingsPublishTemporary: normalizePath(".lina/producer/staging/embeddings.publish.tmp"),
  embeddingsPublishBackup: normalizePath(".lina/producer/backups/embeddings.publish.backup"),
  manifestPublishTemporary: normalizePath(".lina/producer/staging/manifest.publish.tmp"),
  manifestPublishBackup: normalizePath(".lina/producer/backups/manifest.publish.backup"),
});

const PRODUCER_WORK_DIRECTORIES = [".lina", ".lina/producer", ".lina/producer/checkpoints", ".lina/producer/staging", ".lina/producer/backups"] as const;

export const EMBEDDING_CHECKPOINT_SCHEMA_VERSION = 1;
export const EMBEDDING_PERSISTENCE_RENAME_RETRY_DELAYS_MS = [25, 75, 150] as const;

export interface EmbeddingPersistenceRetryOptions {
  /** Injectable only to make bounded rename retries deterministic in tests. */
  readonly sleep?: (delayMs: number) => Promise<void>;
}

/**
 * Operation-owned authorization proof. It is injected by the host and must
 * revalidate the device/epoch pair against current ownership before a shared
 * artifact is changed. Persistence deliberately owns no second authority
 * model.
 */
export interface EmbeddingWriteFence {
  assertCurrent(): Promise<boolean>;
  /** Authority captured when the fence was acquired; used only to stamp provenance. */
  readonly identity?: { readonly producerDeviceId: string; readonly epoch: number };
}

class OwnershipFenceRejectedError extends Error {}

async function assertWriteFence(fence: EmbeddingWriteFence | undefined): Promise<void> {
  if (fence && !await fence.assertCurrent()) {
    throw new OwnershipFenceRejectedError("Ownership fence rejected the embedding write.");
  }
}

interface EmbeddingPersistenceRenameAdapter {
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface EmbeddingRecord {
  chunkId: string;
  path: string;
  index: number;
  textHash: string;
  model: string;
  provider: string;
  dimensions: number;
  embedding: number[];
  createdAt: string;
  embeddingInputHash?: string;
}

export interface EmbeddingCheckpointMetadata {
  schemaVersion: number;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  dimension: number;
  inputFormatVersion: string;
  completedRecords: number;
  sourceRevision?: string;
  provenance?: ArtifactProvenance;
}

export interface EmbeddingCheckpointIdentity {
  provider: string;
  model: string;
  dimension?: number;
  inputFormatVersion: string;
}

export interface EmbeddingPublicationInfo {
  provider: string;
  model: string;
  dimensions: number;
  inputVersion: number;
  prefixMode: string;
  provenance?: ArtifactProvenance;
  fence?: EmbeddingWriteFence;
}

function createEmbeddingPublicationId(): string {
  return `emb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface EmbeddingPersistenceDiagnostic {
  stage: "checkpoint" | "publication" | "recovery";
  result: "started" | "succeeded" | "failed" | "skipped";
  reason?: string;
  records?: number;
  reusedRecords?: number;
  ignoredRecords?: number;
  backupCreated?: boolean;
  rollbackStarted?: boolean;
  rollbackSucceeded?: boolean;
  cleanupWarnings?: number;
}

export type EmbeddingPersistenceDiagnosticCallback = (details: EmbeddingPersistenceDiagnostic) => void;

export type EmbeddingCheckpointLoadResult =
  | { status: "available"; metadata: EmbeddingCheckpointMetadata; records: EmbeddingRecord[] }
  | { status: "missing" }
  | { status: "ignored"; reason: string };

export interface EmbeddingPublicationResult {
  success: boolean;
  publicationId?: string;
  warnings: string[];
  error?: string;
  rollbackSucceeded?: boolean;
}

interface ParsedRecordsResult {
  valid: boolean;
  records: EmbeddingRecord[];
  reason?: string;
}

interface CanonicalValidationResult {
  valid: boolean;
  reason?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getFilesystemErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== "string") return undefined;
  return error.code.toUpperCase();
}

function isTransientWindowsRenameError(error: unknown): boolean {
  const code = getFilesystemErrorCode(error);
  return code === "EBUSY" || code === "EPERM";
}

function waitForRenameRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

/**
 * Retries only the final filesystem rename for short-lived Windows locks.
 * The temporary artifact is never recreated and callers retain their normal
 * atomic rollback/cleanup path if every bounded attempt fails.
 */
export async function renameEmbeddingPersistenceArtifact(
  adapter: EmbeddingPersistenceRenameAdapter,
  oldPath: string,
  newPath: string,
  options: EmbeddingPersistenceRetryOptions = {},
): Promise<void> {
  const sleep = options.sleep ?? waitForRenameRetry;
  for (let attempt = 0; ; attempt++) {
    try {
      await adapter.rename(oldPath, newPath);
      return;
    } catch (error) {
      const delayMs = EMBEDDING_PERSISTENCE_RENAME_RETRY_DELAYS_MS[attempt];
      if (!isTransientWindowsRenameError(error) || delayMs === undefined) throw error;
      await sleep(delayMs);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEmbeddingRecord(value: unknown): value is EmbeddingRecord {
  if (!isRecord(value)) return false;
  if (
    typeof value.chunkId !== "string"
    || typeof value.path !== "string"
    || !Number.isInteger(value.index)
    || typeof value.textHash !== "string"
    || typeof value.model !== "string"
    || typeof value.provider !== "string"
    || typeof value.dimensions !== "number"
    || !Number.isInteger(value.dimensions)
    || value.dimensions <= 0
    || typeof value.createdAt !== "string"
    || (value.embeddingInputHash !== undefined && typeof value.embeddingInputHash !== "string")
    || !isValidEmbeddingVector(value.embedding)
  ) {
    return false;
  }

  return value.dimensions === value.embedding.length;
}

function isCheckpointMetadata(value: unknown): value is EmbeddingCheckpointMetadata {
  if (!isRecord(value)) return false;
  return value.schemaVersion === EMBEDDING_CHECKPOINT_SCHEMA_VERSION
    && typeof value.operationId === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && typeof value.provider === "string"
    && typeof value.model === "string"
    && Number.isInteger(value.dimension)
    && (value.dimension as number) > 0
    && typeof value.inputFormatVersion === "string"
    && Number.isInteger(value.completedRecords)
    && (value.completedRecords as number) >= 0
    && (value.sourceRevision === undefined || typeof value.sourceRevision === "string")
    && (value.provenance === undefined || isValidArtifactProvenance(value.provenance));
}

function parseEmbeddingRecords(
  content: string,
  expectedCount?: number,
  expectedDimensions?: number,
  requireTrailingNewline: boolean = true
): ParsedRecordsResult {
  if (content.length === 0) {
    return expectedCount === 0
      ? { valid: true, records: [] }
      : { valid: false, records: [], reason: "empty-content" };
  }

  if (requireTrailingNewline && !content.endsWith("\n")) {
    return { valid: false, records: [], reason: "truncated-last-line" };
  }

  const records: EmbeddingRecord[] = [];
  const seenChunkIds = new Set<string>();
  const normalizedContent = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lines = normalizedContent.split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) {
      return { valid: false, records: [], reason: "empty-line" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { valid: false, records: [], reason: "invalid-json-line" };
    }

    if (!isEmbeddingRecord(parsed)) {
      return { valid: false, records: [], reason: "invalid-record" };
    }
    if (expectedDimensions !== undefined && parsed.dimensions !== expectedDimensions) {
      return { valid: false, records: [], reason: "dimension-mismatch" };
    }
    if (seenChunkIds.has(parsed.chunkId)) {
      return { valid: false, records: [], reason: "duplicate-chunk-id" };
    }

    seenChunkIds.add(parsed.chunkId);
    records.push(parsed);
  }

  if (expectedCount !== undefined && records.length !== expectedCount) {
    return { valid: false, records: [], reason: "record-count-mismatch" };
  }

  return { valid: true, records };
}

function serializeEmbeddingRecords(records: EmbeddingRecord[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function fileExists(app: App, path: string): Promise<boolean> {
  const stat = await app.vault.adapter.stat(path);
  return stat?.type === "file";
}

export async function ensureProducerWorkDirectories(app: App): Promise<void> {
  if (typeof (app.vault.adapter as { mkdir?: unknown }).mkdir !== "function") return;

  for (const path of PRODUCER_WORK_DIRECTORIES) {
    const stat = await app.vault.adapter.stat(path);
    if (stat?.type === "folder") continue;
    if (stat) throw new Error(`Expected producer work directory at ${path}.`);
    await app.vault.adapter.mkdir(path);
  }
}

async function removeIfExists(app: App, path: string): Promise<void> {
  if (await app.vault.adapter.exists(path)) {
    await app.vault.adapter.remove(path);
  }
}

async function readJson(app: App, path: string): Promise<unknown> {
  const content = await app.vault.adapter.read(path);
  return JSON.parse(content) as unknown;
}

async function validateCheckpointPair(
  app: App,
  checkpointPath: string,
  metadataPath: string,
  identity?: EmbeddingCheckpointIdentity
): Promise<{ valid: boolean; metadata?: EmbeddingCheckpointMetadata; records?: EmbeddingRecord[]; reason?: string }> {
  if (!(await fileExists(app, checkpointPath)) || !(await fileExists(app, metadataPath))) {
    return { valid: false, reason: "checkpoint-pair-incomplete" };
  }

  let metadataValue: unknown;
  try {
    metadataValue = await readJson(app, metadataPath);
  } catch {
    return { valid: false, reason: "invalid-checkpoint-metadata-json" };
  }
  if (!isCheckpointMetadata(metadataValue)) {
    return { valid: false, reason: "invalid-checkpoint-metadata" };
  }
  const metadata = metadataValue;

  if (identity) {
    const dimensionMismatch = identity.dimension !== undefined
      && identity.dimension > 0
      && metadata.dimension !== identity.dimension;
    if (
      metadata.provider !== identity.provider
      || metadata.model !== identity.model
      || metadata.inputFormatVersion !== identity.inputFormatVersion
      || dimensionMismatch
    ) {
      return { valid: false, reason: "incompatible-checkpoint" };
    }
  }

  let content: string;
  try {
    content = await app.vault.adapter.read(checkpointPath);
  } catch {
    return { valid: false, reason: "checkpoint-read-error" };
  }
  const parsed = parseEmbeddingRecords(content, metadata.completedRecords, metadata.dimension);
  if (!parsed.valid) {
    return { valid: false, reason: parsed.reason };
  }
  if (parsed.records.some((record) => record.provider !== metadata.provider || record.model !== metadata.model)) {
    return { valid: false, reason: "checkpoint-record-identity-mismatch" };
  }

  return { valid: true, metadata, records: parsed.records };
}

function getManifestEmbeddingInfo(manifest: Record<string, unknown>): Record<string, unknown> | null {
  const embeddings = manifest.embeddings;
  return isRecord(embeddings) ? embeddings : null;
}

export type CanonicalPairState = "absent" | "consistent" | "inconsistent" | "unreadable" | "resource-limit-exceeded" | "unverifiable-legacy";

/** Pure inspection of existing publication fields; never decides dispatch or mutates files. */
export function inspectCanonicalPair(content: string | undefined, manifest: unknown): CanonicalPairState {
  const declared = isRecord(manifest) && (manifest.embeddingsEnabled === true || isRecord(manifest.embeddings));
  if (content === undefined) return declared ? "inconsistent" : "absent";
  if (!declared) return content.length === 0 ? "absent" : "inconsistent";
  const validation = validateCanonicalContent(content, manifest);
  if (!validation.valid) return "inconsistent";
  const info = isRecord(manifest) ? getManifestEmbeddingInfo(manifest) : null;
  return typeof info?.publicationId === "string" && info.publicationId.trim().length > 0
    ? "consistent" : "unverifiable-legacy";
}

function validateCanonicalContent(embeddingsContent: string, manifestValue: unknown): CanonicalValidationResult {
  if (!isRecord(manifestValue) || manifestValue.embeddingsEnabled !== true) {
    return { valid: false, reason: "manifest-embeddings-disabled" };
  }
  const embeddingsInfo = getManifestEmbeddingInfo(manifestValue);
  if (!embeddingsInfo) {
    return { valid: false, reason: "manifest-embeddings-missing" };
  }

  const count = embeddingsInfo.totalEmbeddings;
  const dimensions = embeddingsInfo.dimensions;
  const provider = embeddingsInfo.provider;
  const model = embeddingsInfo.model;
  if (!Number.isInteger(count) || (count as number) < 0 || !Number.isInteger(dimensions) || (dimensions as number) <= 0) {
    return { valid: false, reason: "manifest-embeddings-invalid" };
  }
  if (typeof provider !== "string" || typeof model !== "string") {
    return { valid: false, reason: "manifest-identity-invalid" };
  }

  if (embeddingsInfo.publicationId !== undefined &&
    (typeof embeddingsInfo.publicationId !== "string" || embeddingsInfo.publicationId.trim().length === 0)) {
    return { valid: false, reason: "manifest-publication-invalid" };
  }
  const parsed = parseEmbeddingRecords(embeddingsContent, count as number, dimensions as number,
    typeof embeddingsInfo.publicationId === "string");
  if (!parsed.valid) {
    return { valid: false, reason: parsed.reason };
  }
  if (parsed.records.some((record) => record.provider !== provider || record.model !== model)) {
    return { valid: false, reason: "canonical-record-identity-mismatch" };
  }

  const input = isRecord(manifestValue.embeddingInput) ? manifestValue.embeddingInput : undefined;
  if (typeof embeddingsInfo.publicationId === "string" && (!input ||
    !Number.isInteger(input.version) || typeof input.version !== "number" || input.version <= 0 ||
    (input.prefixMode !== "none" && input.prefixMode !== "nomic-search-query-document"))) {
    return { valid: false, reason: "manifest-input-identity-invalid" };
  }
  for (const rawContract of [manifestValue.vectorContract, embeddingsInfo.vectorContract]) {
    if (rawContract === undefined || rawContract === null) continue;
    if (!isValidVectorContract(rawContract)) {
      return { valid: false, reason: "manifest-vector-contract-invalid" };
    }
    if (
      rawContract.provider !== provider.trim().toLowerCase() ||
      rawContract.model !== model.trim().toLowerCase() ||
      rawContract.dimensions !== dimensions ||
      (input !== undefined && (rawContract.inputVersion !== input.version || rawContract.prefixMode !== input.prefixMode))
    ) {
      return { valid: false, reason: "manifest-vector-contract-mismatch" };
    }
  }

  return { valid: true };
}

async function validateCanonicalFiles(
  app: App,
  embeddingsPath: string = EMBEDDING_PERSISTENCE_FILES.canonicalEmbeddings,
  manifestPath: string = EMBEDDING_PERSISTENCE_FILES.canonicalManifest
): Promise<CanonicalValidationResult> {
  if (!(await fileExists(app, embeddingsPath)) || !(await fileExists(app, manifestPath))) {
    return { valid: false, reason: "canonical-pair-incomplete" };
  }

  try {
    const stat = await app.vault.adapter.stat(embeddingsPath);
    if (stat && !evaluateEmbeddingBridgeRead(stat.size, getDeviceCapabilities().resourceProfile).allowed) {
      return { valid: false, reason: "canonical-resource-limit-exceeded" };
    }
    const embeddingsContent = await app.vault.adapter.read(embeddingsPath);
    const manifestContent = await app.vault.adapter.read(manifestPath);
    let manifest: unknown;
    try { manifest = JSON.parse(manifestContent); }
    catch { return { valid: false, reason: "canonical-manifest-invalid" }; }
    return validateCanonicalContent(embeddingsContent, manifest);
  } catch {
    return { valid: false, reason: "canonical-read-error" };
  }
}

async function cleanupPaths(app: App, paths: string[], warnings: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await removeIfExists(app, path);
    } catch (error) {
      if (error instanceof OwnershipFenceRejectedError) throw error;
      warnings.push(`${path}: ${errorMessage(error)}`);
    }
  }
}

async function restoreCheckpointBackups(app: App): Promise<boolean> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const backup = await validateCheckpointPair(app, files.checkpointBackup, files.checkpointMetadataBackup);
  if (!backup.valid) return false;
  await ensureProducerWorkDirectories(app);

  await app.vault.adapter.write(files.checkpointTemporary, await app.vault.adapter.read(files.checkpointBackup));
  await app.vault.adapter.write(files.checkpointMetadataTemporary, await app.vault.adapter.read(files.checkpointMetadataBackup));
  await removeIfExists(app, files.checkpoint);
  await removeIfExists(app, files.checkpointMetadata);
  await renameEmbeddingPersistenceArtifact(app.vault.adapter, files.checkpointTemporary, files.checkpoint);
  await renameEmbeddingPersistenceArtifact(app.vault.adapter, files.checkpointMetadataTemporary, files.checkpointMetadata);
  if (!(await validateCheckpointPair(app, files.checkpoint, files.checkpointMetadata)).valid) return false;
  await removeIfExists(app, files.checkpointBackup);
  await removeIfExists(app, files.checkpointMetadataBackup);
  return true;
}

async function restoreCanonicalBackups(app: App): Promise<boolean> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const bothBackupsValid = await validateCanonicalFiles(app, files.embeddingsPublishBackup, files.manifestPublishBackup);
  if (bothBackupsValid.valid) {
    await ensureProducerWorkDirectories(app);
    // Retain both backups until a coherent restored publication is observed.
    // A revoked fence between the two promotions must remain recoverable.
    await app.vault.adapter.write(files.embeddingsPublishTemporary, await app.vault.adapter.read(files.embeddingsPublishBackup));
    await app.vault.adapter.write(files.manifestPublishTemporary, await app.vault.adapter.read(files.manifestPublishBackup));
    await removeIfExists(app, files.canonicalEmbeddings);
    await removeIfExists(app, files.canonicalManifest);
    await renameEmbeddingPersistenceArtifact(app.vault.adapter, files.embeddingsPublishTemporary, files.canonicalEmbeddings);
    await renameEmbeddingPersistenceArtifact(app.vault.adapter, files.manifestPublishTemporary, files.canonicalManifest);
    if (!(await validateCanonicalFiles(app)).valid) return false;
    await removeIfExists(app, files.embeddingsPublishBackup);
    await removeIfExists(app, files.manifestPublishBackup);
    return true;
  }

  if (await fileExists(app, files.embeddingsPublishBackup)) {
    const backupWithCurrentManifest = await validateCanonicalFiles(
      app,
      files.embeddingsPublishBackup,
      files.canonicalManifest
    );
    if (backupWithCurrentManifest.valid) {
      await ensureProducerWorkDirectories(app);
      await app.vault.adapter.write(files.embeddingsPublishTemporary, await app.vault.adapter.read(files.embeddingsPublishBackup));
      await removeIfExists(app, files.canonicalEmbeddings);
      await renameEmbeddingPersistenceArtifact(app.vault.adapter, files.embeddingsPublishTemporary, files.canonicalEmbeddings);
      if (!(await validateCanonicalFiles(app)).valid) return false;
      await removeIfExists(app, files.embeddingsPublishBackup);
      return true;
    }
  }

  if (
    !(await fileExists(app, files.embeddingsPublishBackup))
    && await fileExists(app, files.manifestPublishBackup)
  ) {
    try {
      const manifestBackup = await readJson(app, files.manifestPublishBackup);
      if (isRecord(manifestBackup) && manifestBackup.indexType === "text" && manifestBackup.embeddingsEnabled !== true) {
        await ensureProducerWorkDirectories(app);
        await app.vault.adapter.write(files.manifestPublishTemporary, JSON.stringify(manifestBackup));
        await removeIfExists(app, files.canonicalEmbeddings);
        await removeIfExists(app, files.canonicalManifest);
        await renameEmbeddingPersistenceArtifact(app.vault.adapter, files.manifestPublishTemporary, files.canonicalManifest);
        await removeIfExists(app, files.manifestPublishBackup);
        return true;
      }
    } catch (error) {
      if (error instanceof OwnershipFenceRejectedError) throw error;
      return false;
    }
  }

  return false;
}

export async function recoverEmbeddingPersistenceArtifacts(
  app: App,
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback,
  fence?: EmbeddingWriteFence
): Promise<{ warnings: string[]; changed?: boolean }> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const warnings: string[] = [];
  onDiagnostic?.({ stage: "recovery", result: "started" });
  try {
    await assertWriteFence(fence);
  } catch (error) {
    onDiagnostic?.({ stage: "recovery", result: "skipped", reason: errorMessage(error) });
    return { warnings: ["ownership-fence-rejected"] };
  }

  // Fence every actual mutable adapter call, including each bounded rename retry.
  // Binding reads to the original adapter preserves DataAdapter implementations.
  const originalAdapter = app.vault.adapter;
  let changed = false;
  const guardedAdapter = new Proxy(originalAdapter, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (["write", "remove", "rename", "mkdir"].includes(String(key))) {
        return async (...args: unknown[]) => {
          await assertWriteFence(fence);
          const result: unknown = await Reflect.apply(value, target, args);
          changed = true;
          return result;
        };
      }
      return value.bind(target) as unknown;
    },
  });
  const guardedVault = new Proxy(app.vault, { get: (target, key) => key === "adapter" ? guardedAdapter : Reflect.get(target, key) as unknown });
  app = new Proxy(app, { get: (target, key) => key === "vault" ? guardedVault : Reflect.get(target, key) as unknown });

  // Orphan temporaries are never commit markers and are never auto-promoted.

  try {
    await cleanupPaths(app, [
      files.checkpointTemporary,
      files.checkpointMetadataTemporary,
      files.embeddingsPublishTemporary,
      files.manifestPublishTemporary,
    ], warnings);

    const checkpointBackupExists = await fileExists(app, files.checkpointBackup)
      || await fileExists(app, files.checkpointMetadataBackup);
    if (checkpointBackupExists) {
      const currentCheckpoint = await validateCheckpointPair(app, files.checkpoint, files.checkpointMetadata);
      if (currentCheckpoint.valid) {
        await cleanupPaths(app, [files.checkpointBackup, files.checkpointMetadataBackup], warnings);
      } else {
        try {
          const restored = await restoreCheckpointBackups(app);
          if (!restored) warnings.push("checkpoint-backup-invalid");
        } catch (error) {
          if (error instanceof OwnershipFenceRejectedError) throw error;
          warnings.push(`checkpoint-backup-restore: ${errorMessage(error)}`);
        }
      }
    }

    const publishBackupExists = await fileExists(app, files.embeddingsPublishBackup)
      || await fileExists(app, files.manifestPublishBackup);
    if (publishBackupExists) {
      const canonical = await validateCanonicalFiles(app);
      if (canonical.valid) {
        await cleanupPaths(app, [files.embeddingsPublishBackup, files.manifestPublishBackup], warnings);
      } else if (canonical.reason === "canonical-resource-limit-exceeded" || canonical.reason === "canonical-read-error") {
        warnings.push(canonical.reason);
      } else {
        try {
          const restored = await restoreCanonicalBackups(app);
          if (!restored) warnings.push("canonical-backup-invalid");
        } catch (error) {
          if (error instanceof OwnershipFenceRejectedError) throw error;
          warnings.push(`canonical-backup-restore: ${errorMessage(error)}`);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof OwnershipFenceRejectedError)) throw error;
    warnings.push("ownership-fence-rejected");
  }

  onDiagnostic?.({
    stage: "recovery",
    result: warnings.length === 0 ? "succeeded" : "failed",
    cleanupWarnings: warnings.length,
  });
  return { warnings, changed };
}

/** Startup is maintenance under the existing writer lease, never a generation or an ownership claim. */
export async function recoverCanonicalEmbeddingsAtStartup(
  app: App,
  coordinator: IndexWriteCoordinator,
  acquireFence: () => Promise<EmbeddingWriteFence | undefined>,
): Promise<{ warnings: string[]; changed?: boolean }> {
  const fence = await acquireFence();
  if (!fence || !await fence.assertCurrent()) return { warnings: ["ownership-fence-rejected"] };
  const lease = coordinator.startBinaryMaintenance();
  if (lease.status !== "accepted") return { warnings: ["index-write-busy"] };
  try { return await recoverEmbeddingPersistenceArtifacts(app, undefined, fence); }
  finally { coordinator.finish(lease.token); }
}

export async function loadEmbeddingCheckpoint(
  app: App,
  identity: EmbeddingCheckpointIdentity,
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback
): Promise<EmbeddingCheckpointLoadResult> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const checkpointExists = await fileExists(app, files.checkpoint);
  const metadataExists = await fileExists(app, files.checkpointMetadata);
  if (!checkpointExists && !metadataExists) {
    onDiagnostic?.({ stage: "checkpoint", result: "skipped", reason: "not-found" });
    return { status: "missing" };
  }

  if (!checkpointExists || !metadataExists) {
    onDiagnostic?.({ stage: "checkpoint", result: "failed", reason: "orphaned-checkpoint" });
    const warnings: string[] = [];
    await cleanupPaths(app, [files.checkpoint, files.checkpointMetadata], warnings);
    return { status: "ignored", reason: "orphaned-checkpoint" };
  }

  const validation = await validateCheckpointPair(app, files.checkpoint, files.checkpointMetadata, identity);
  if (!validation.valid || !validation.metadata || !validation.records) {
    const reason = validation.reason ?? "invalid-checkpoint";
    onDiagnostic?.({ stage: "checkpoint", result: "failed", reason });
    const warnings: string[] = [];
    await cleanupPaths(app, [files.checkpoint, files.checkpointMetadata], warnings);
    return { status: "ignored", reason };
  }

  onDiagnostic?.({
    stage: "checkpoint",
    result: "succeeded",
    reason: "compatible",
    records: validation.records.length,
  });
  return {
    status: "available",
    metadata: validation.metadata,
    records: validation.records,
  };
}

/**
 * Inspeciona um checkpoint sem o alterar. O diagnóstico de estado não pode
 * limpar, publicar ou recuperar artefactos persistentes.
 */
export async function readRecoverableEmbeddingCheckpointRecords(
  app: App,
  identity: EmbeddingCheckpointIdentity
): Promise<EmbeddingRecord[]> {
  const validation = await validateCheckpointPair(
    app,
    EMBEDDING_PERSISTENCE_FILES.checkpoint,
    EMBEDDING_PERSISTENCE_FILES.checkpointMetadata,
    identity
  );
  return validation.valid ? validation.records ?? [] : [];
}

export async function readRecoverableEmbeddingCheckpointCount(
  app: App,
  identity: EmbeddingCheckpointIdentity
): Promise<number> {
  return (await readRecoverableEmbeddingCheckpointRecords(app, identity)).length;
}

export async function writeEmbeddingCheckpoint(
  app: App,
  metadata: EmbeddingCheckpointMetadata,
  records: EmbeddingRecord[],
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback,
  retryOptions?: EmbeddingPersistenceRetryOptions,
  fence?: EmbeddingWriteFence,
): Promise<EmbeddingCheckpointMetadata> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const adapter = app.vault.adapter;
  await ensureProducerWorkDirectories(app);
  const sortedRecords = [...records].sort((a, b) => a.chunkId.localeCompare(b.chunkId));
  const now = new Date().toISOString();
  const nextMetadata: EmbeddingCheckpointMetadata = {
    ...metadata,
    schemaVersion: EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
    updatedAt: now,
    completedRecords: sortedRecords.length,
  };
  const jsonlContent = serializeEmbeddingRecords(sortedRecords);
  const metadataContent = JSON.stringify(nextMetadata, null, 2);
  let checkpointPublished = false;
  let metadataPublished = false;
  let checkpointBackedUp = false;
  let metadataBackedUp = false;

  onDiagnostic?.({ stage: "checkpoint", result: "started", records: sortedRecords.length });
  try {
    await assertWriteFence(fence);
    await adapter.write(files.checkpointTemporary, jsonlContent);
    const temporaryContent = await adapter.read(files.checkpointTemporary);
    const temporaryValidation = parseEmbeddingRecords(
      temporaryContent,
      sortedRecords.length,
      nextMetadata.dimension
    );
    if (!temporaryValidation.valid) {
      throw new Error(`Checkpoint temporary validation failed: ${temporaryValidation.reason ?? "unknown"}`);
    }

    await adapter.write(files.checkpointMetadataTemporary, metadataContent);
    const temporaryMetadata = await readJson(app, files.checkpointMetadataTemporary);
    if (!isCheckpointMetadata(temporaryMetadata)) {
      throw new Error("Checkpoint metadata temporary validation failed.");
    }

    await removeIfExists(app, files.checkpointBackup);
    await removeIfExists(app, files.checkpointMetadataBackup);
    if (await fileExists(app, files.checkpoint)) {
      await renameEmbeddingPersistenceArtifact(adapter, files.checkpoint, files.checkpointBackup, retryOptions);
      checkpointBackedUp = true;
    }
    if (await fileExists(app, files.checkpointMetadata)) {
      await renameEmbeddingPersistenceArtifact(adapter, files.checkpointMetadata, files.checkpointMetadataBackup, retryOptions);
      metadataBackedUp = true;
    }

    await assertWriteFence(fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.checkpointTemporary, files.checkpoint, retryOptions);
    checkpointPublished = true;
    const publishedContent = await adapter.read(files.checkpoint);
    const publishedValidation = parseEmbeddingRecords(
      publishedContent,
      sortedRecords.length,
      nextMetadata.dimension
    );
    if (!publishedValidation.valid) {
      throw new Error(`Checkpoint publication validation failed: ${publishedValidation.reason ?? "unknown"}`);
    }

    await assertWriteFence(fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.checkpointMetadataTemporary, files.checkpointMetadata, retryOptions);
    metadataPublished = true;
    const pairValidation = await validateCheckpointPair(app, files.checkpoint, files.checkpointMetadata, {
      provider: nextMetadata.provider,
      model: nextMetadata.model,
      dimension: nextMetadata.dimension,
      inputFormatVersion: nextMetadata.inputFormatVersion,
    });
    if (!pairValidation.valid) {
      throw new Error(`Checkpoint pair validation failed: ${pairValidation.reason ?? "unknown"}`);
    }

    const warnings: string[] = [];
    await cleanupPaths(app, [files.checkpointBackup, files.checkpointMetadataBackup], warnings);
    onDiagnostic?.({
      stage: "checkpoint",
      result: "succeeded",
      records: sortedRecords.length,
      cleanupWarnings: warnings.length,
    });
    return nextMetadata;
  } catch (error) {
    try {
      if (metadataPublished) await removeIfExists(app, files.checkpointMetadata);
      if (checkpointPublished) await removeIfExists(app, files.checkpoint);
      if (checkpointBackedUp && await fileExists(app, files.checkpointBackup)) {
        await renameEmbeddingPersistenceArtifact(adapter, files.checkpointBackup, files.checkpoint, retryOptions);
      }
      if (metadataBackedUp && await fileExists(app, files.checkpointMetadataBackup)) {
        await renameEmbeddingPersistenceArtifact(adapter, files.checkpointMetadataBackup, files.checkpointMetadata, retryOptions);
      }
    } catch (rollbackError) {
      console.warn("Lina: checkpoint rollback could not be completed safely.", {
        error: errorMessage(rollbackError),
      });
    }
    const warnings: string[] = [];
    await cleanupPaths(app, [files.checkpointTemporary, files.checkpointMetadataTemporary], warnings);
    onDiagnostic?.({ stage: "checkpoint", result: "failed", reason: errorMessage(error) });
    throw error;
  }
}

function buildManifestCandidate(
  currentManifest: Record<string, unknown>,
  records: EmbeddingRecord[],
  info: EmbeddingPublicationInfo
): Record<string, unknown> {
  const now = new Date().toISOString();
  const publicationId = createEmbeddingPublicationId();
  const vectorContract = createVectorContract({
    provider: info.provider,
    model: info.model,
    dimensions: info.dimensions,
    metric: "cosine",
    prefixMode: info.prefixMode,
    inputVersion: info.inputVersion,
  });
  return {
    ...currentManifest,
    embeddingsEnabled: true,
    embeddings: {
      enabled: true,
      provider: info.provider,
      model: info.model,
      totalEmbeddings: records.length,
      dimensions: info.dimensions,
      updatedAt: now,
      publicationId,
      sourceTotalChunks: records.length,
      sourceTextGenerationId: typeof currentManifest.generationId === "string" ? currentManifest.generationId : undefined,
      vectorContract,
      ...(info.provenance && isValidArtifactProvenance(info.provenance)
        ? { provenance: info.provenance }
        : {}),
    },
    embeddingInput: {
      version: info.inputVersion,
      includesTitle: true,
      includesPath: true,
      includesChunkIndex: true,
      includesChunkText: true,
      prefixMode: info.prefixMode,
      usesSearchQueryPrefix: info.prefixMode === "nomic-search-query-document",
      usesSearchDocumentPrefix: info.prefixMode === "nomic-search-query-document",
    },
    vectorContract,
  };
}

export async function publishCanonicalEmbeddings(
  app: App,
  records: EmbeddingRecord[],
  info: EmbeddingPublicationInfo,
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback,
  retryOptions?: EmbeddingPersistenceRetryOptions,
): Promise<EmbeddingPublicationResult> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const adapter = app.vault.adapter;
  await ensureProducerWorkDirectories(app);
  const warnings: string[] = [];
  const sortedRecords = [...records].sort((a, b) => a.chunkId.localeCompare(b.chunkId));
  let embeddingsBackedUp = false;
  let manifestBackedUp = false;
  let embeddingsPublished = false;
  let manifestPublished = false;

  onDiagnostic?.({ stage: "publication", result: "started", records: sortedRecords.length });
  try {
    await assertWriteFence(info.fence);
    if (sortedRecords.length === 0 || info.dimensions <= 0) {
      throw new Error("Canonical embedding candidate is empty or has invalid dimensions.");
    }
    const currentManifestValue = await readJson(app, files.canonicalManifest);
    if (!isRecord(currentManifestValue)) {
      throw new Error("Canonical manifest has an invalid shape.");
    }

    const embeddingsContent = serializeEmbeddingRecords(sortedRecords);
    const candidateRecords = parseEmbeddingRecords(embeddingsContent, sortedRecords.length, info.dimensions);
    if (!candidateRecords.valid) {
      throw new Error(`Canonical candidate validation failed: ${candidateRecords.reason ?? "unknown"}`);
    }
    if (sortedRecords.some((record) => record.provider !== info.provider || record.model !== info.model)) {
      throw new Error("Canonical candidate record identity does not match publication identity.");
    }

    const manifestCandidate = buildManifestCandidate(currentManifestValue, sortedRecords, info);
    const manifestContent = JSON.stringify(manifestCandidate, null, 2);
    const pairValidation = validateCanonicalContent(embeddingsContent, manifestCandidate);
    if (!pairValidation.valid) {
      throw new Error(`Canonical pair candidate validation failed: ${pairValidation.reason ?? "unknown"}`);
    }

    await adapter.write(files.embeddingsPublishTemporary, embeddingsContent);
    const readEmbeddingsCandidate = await adapter.read(files.embeddingsPublishTemporary);
    const readEmbeddingsValidation = parseEmbeddingRecords(
      readEmbeddingsCandidate,
      sortedRecords.length,
      info.dimensions
    );
    if (!readEmbeddingsValidation.valid) {
      throw new Error(`Published embeddings candidate validation failed: ${readEmbeddingsValidation.reason ?? "unknown"}`);
    }

    await adapter.write(files.manifestPublishTemporary, manifestContent);
    const readManifestCandidate = await readJson(app, files.manifestPublishTemporary);
    const readPairValidation = validateCanonicalContent(readEmbeddingsCandidate, readManifestCandidate);
    if (!readPairValidation.valid) {
      throw new Error(`Published manifest candidate validation failed: ${readPairValidation.reason ?? "unknown"}`);
    }

    await removeIfExists(app, files.embeddingsPublishBackup);
    await removeIfExists(app, files.manifestPublishBackup);
    if (await fileExists(app, files.canonicalEmbeddings)) {
    await assertWriteFence(info.fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.canonicalEmbeddings, files.embeddingsPublishBackup, retryOptions);
      embeddingsBackedUp = true;
    }
    await assertWriteFence(info.fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.embeddingsPublishTemporary, files.canonicalEmbeddings, retryOptions);
    embeddingsPublished = true;

    const publishedEmbeddings = await adapter.read(files.canonicalEmbeddings);
    const publishedEmbeddingsValidation = parseEmbeddingRecords(
      publishedEmbeddings,
      sortedRecords.length,
      info.dimensions
    );
    if (!publishedEmbeddingsValidation.valid) {
      throw new Error(`Canonical embeddings validation failed: ${publishedEmbeddingsValidation.reason ?? "unknown"}`);
    }

    await assertWriteFence(info.fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.canonicalManifest, files.manifestPublishBackup, retryOptions);
    manifestBackedUp = true;
    await assertWriteFence(info.fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.manifestPublishTemporary, files.canonicalManifest, retryOptions);
    manifestPublished = true;

    const canonicalValidation = await validateCanonicalFiles(app);
    if (!canonicalValidation.valid) {
      throw new Error(`Canonical publication validation failed: ${canonicalValidation.reason ?? "unknown"}`);
    }

    await cleanupPaths(app, [files.embeddingsPublishBackup, files.manifestPublishBackup], warnings);
    await cleanupPaths(app, [files.checkpoint, files.checkpointMetadata], warnings);
    onDiagnostic?.({
      stage: "publication",
      result: "succeeded",
      records: sortedRecords.length,
      backupCreated: embeddingsBackedUp,
      cleanupWarnings: warnings.length,
    });
    const publicationId = (manifestCandidate.embeddings as Record<string, unknown>).publicationId;
    return { success: true, publicationId: typeof publicationId === "string" ? publicationId : undefined, warnings };
  } catch (error) {
    let rollbackSucceeded = true;
    onDiagnostic?.({
      stage: "publication",
      result: "failed",
      reason: errorMessage(error),
      rollbackStarted: embeddingsBackedUp || embeddingsPublished || manifestBackedUp || manifestPublished,
    });
    try {
      if (manifestPublished) await removeIfExists(app, files.canonicalManifest);
      if (embeddingsPublished) await removeIfExists(app, files.canonicalEmbeddings);
      if (embeddingsBackedUp && await fileExists(app, files.embeddingsPublishBackup)) {
        await renameEmbeddingPersistenceArtifact(adapter, files.embeddingsPublishBackup, files.canonicalEmbeddings, retryOptions);
      }
      if (manifestBackedUp && await fileExists(app, files.manifestPublishBackup)) {
        await renameEmbeddingPersistenceArtifact(adapter, files.manifestPublishBackup, files.canonicalManifest, retryOptions);
      }
    } catch (rollbackError) {
      rollbackSucceeded = false;
      warnings.push(`rollback: ${errorMessage(rollbackError)}`);
    }

    await cleanupPaths(app, [files.embeddingsPublishTemporary, files.manifestPublishTemporary], warnings);
    onDiagnostic?.({
      stage: "publication",
      result: "failed",
      reason: errorMessage(error),
      rollbackSucceeded,
      cleanupWarnings: warnings.length,
    });
    return {
      success: false,
      warnings,
      error: errorMessage(error),
      rollbackSucceeded,
    };
  }
}

export async function removeEmbeddingCheckpoint(
  app: App,
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback
): Promise<string[]> {
  const warnings: string[] = [];
  await cleanupPaths(app, [
    EMBEDDING_PERSISTENCE_FILES.checkpoint,
    EMBEDDING_PERSISTENCE_FILES.checkpointMetadata,
  ], warnings);
  onDiagnostic?.({
    stage: "checkpoint",
    result: warnings.length === 0 ? "succeeded" : "failed",
    reason: "cleanup",
    cleanupWarnings: warnings.length,
  });
  return warnings;
}

export async function validateCanonicalEmbeddingIndex(app: App): Promise<boolean> {
  return (await validateCanonicalFiles(app)).valid;
}

export type PurgeOrphanEmbeddingsStatus = "purged" | "unchanged" | "refused";

export interface PurgeOrphanEmbeddingsResult {
  readonly purgedCount: number;
  readonly remainingCount: number;
  /** `refused` never mutates: the canonical pair is not provably `consistent`. */
  readonly status?: PurgeOrphanEmbeddingsStatus;
  readonly reason?: string;
}

const PURGE_NOOP: PurgeOrphanEmbeddingsResult = { purgedCount: 0, remainingCount: 0, status: "unchanged" };

function purgeRefused(reason: string): PurgeOrphanEmbeddingsResult {
  return { purgedCount: 0, remainingCount: 0, status: "refused", reason };
}

/**
 * Safely removes or invalidates canonical embedding records that have become orphans
 * (e.g. after notes or chunks were excluded or deleted), preserving canonical coherence.
 *
 * The caller must hold the canonical-maintenance lease and a fence acquired without
 * auto-claim (see `purgeOrphanEmbeddingsCoordinated`); this function re-reads the
 * canonical state itself, so the decision is always taken inside that lease.
 *
 * Invariants:
 * - Acts only on a provably `consistent` canonical pair; any other state is refused without writing.
 * - If embeddings file or manifest does not exist or embeddings are not enabled, nothing is written.
 * - Drops records whose chunkId is not in validChunks or whose path matches active exclusion rules.
 * - If remaining records > 0, republishes via publishCanonicalEmbeddings, which generates a fresh publicationId
 *   and automatically marks derived binary copies as outdated.
 * - If all records were purged, the manifest is republished (tmp + backup + rename, never in place) with
 *   embeddings disabled and the JSONL is moved to its deterministic backup, removed only after the commit.
 */
export async function purgeOrphanEmbeddingRecords(
  app: App,
  validChunks: readonly FilterableChunk[],
  activePolicy?:
    | ExclusionPolicyV1
    | ExclusionPolicyRules
    | { readonly status: "invalid" | "missing" | "loaded"; readonly policy?: ExclusionPolicyV1 }
    | null,
  provenance?: ArtifactProvenance,
  fence?: EmbeddingWriteFence
): Promise<PurgeOrphanEmbeddingsResult> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const embeddingsExist = await fileExists(app, files.canonicalEmbeddings);
  const manifestExists = await fileExists(app, files.canonicalManifest);

  if (!embeddingsExist || !manifestExists) {
    return PURGE_NOOP;
  }

  let manifestValue: unknown;
  try {
    manifestValue = await readJson(app, files.canonicalManifest);
  } catch {
    return purgeRefused("canonical-manifest-unreadable");
  }

  if (!isRecord(manifestValue) || manifestValue.embeddingsEnabled !== true || !isRecord(manifestValue.embeddings)) {
    return PURGE_NOOP;
  }

  let rawContent: string;
  try {
    const stat = await app.vault.adapter.stat(files.canonicalEmbeddings);
    if (stat && !evaluateEmbeddingBridgeRead(stat.size, getDeviceCapabilities().resourceProfile).allowed) {
      return purgeRefused("resource-limit-exceeded");
    }
    rawContent = await app.vault.adapter.read(files.canonicalEmbeddings);
  } catch {
    return purgeRefused("canonical-unreadable");
  }

  const pairState = inspectCanonicalPair(rawContent, manifestValue);
  if (pairState !== "consistent") {
    return purgeRefused(`canonical-pair-${pairState}`);
  }

  const dimensions = typeof manifestValue.embeddings.dimensions === "number" ? manifestValue.embeddings.dimensions : undefined;
  const parsed = parseEmbeddingRecords(rawContent, undefined, dimensions, false);

  if (!parsed.valid || parsed.records.length === 0) {
    return purgeRefused("canonical-records-invalid");
  }

  const validChunkIds = new Set(validChunks.map((chunk) => chunk.chunkId));
  const rules = resolveDefensiveExclusionRules(activePolicy);
  const pathConfig = {
    excludedFolders: rules.excludedFolders as string[],
    excludedPathContains: rules.excludedPathContains as string[],
  };

  const remainingRecords = parsed.records.filter((record) => {
    if (!validChunkIds.has(record.chunkId)) {
      return false;
    }
    if (shouldExcludePath(record.path, pathConfig, app.vault.configDir).excluded) {
      return false;
    }
    return true;
  });

  const purgedCount = parsed.records.length - remainingRecords.length;
  if (purgedCount === 0) {
    return { purgedCount: 0, remainingCount: parsed.records.length, status: "unchanged" };
  }

  if (remainingRecords.length > 0) {
    const info: EmbeddingPublicationInfo = {
      provider: typeof manifestValue.embeddings.provider === "string" ? manifestValue.embeddings.provider : "unknown",
      model: typeof manifestValue.embeddings.model === "string" ? manifestValue.embeddings.model : "unknown",
      dimensions: typeof dimensions === "number" ? dimensions : remainingRecords[0].dimensions,
      inputVersion: isRecord(manifestValue.embeddingInput) && typeof manifestValue.embeddingInput.version === "number"
        ? manifestValue.embeddingInput.version
        : 1,
      prefixMode: isRecord(manifestValue.embeddingInput) && typeof manifestValue.embeddingInput.prefixMode === "string"
        ? manifestValue.embeddingInput.prefixMode
        : "none",
      provenance: provenance ?? (isValidArtifactProvenance(manifestValue.embeddings.provenance)
        ? manifestValue.embeddings.provenance
        : undefined),
    };

    const pubResult = await publishCanonicalEmbeddings(app, remainingRecords, { ...info, fence });
    if (!pubResult.success) {
      throw new Error(`Failed to publish reconciled canonical embeddings: ${pubResult.error ?? "unknown"}`);
    }
    return { purgedCount, remainingCount: remainingRecords.length, status: "purged" };
  }

  // All records were purged: disable embeddings in the shared manifest through the
  // same tmp + backup + rename protocol as a publication (never an in-place write).
  const nextManifest: Record<string, unknown> = {
    ...manifestValue,
    embeddingsEnabled: false,
    updatedAt: new Date().toISOString(),
  };
  delete nextManifest.embeddings;
  delete nextManifest.embeddingInput;
  await publishEmbeddingsDisabledManifest(app, nextManifest, fence);
  await cleanupPaths(app, [files.checkpoint, files.checkpointMetadata], []);

  return { purgedCount, remainingCount: 0, status: "purged" };
}

async function publishEmbeddingsDisabledManifest(
  app: App,
  nextManifest: Record<string, unknown>,
  fence?: EmbeddingWriteFence,
): Promise<void> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const adapter = app.vault.adapter;
  let embeddingsBackedUp = false;
  let manifestBackedUp = false;
  let manifestPublished = false;
  try {
    await assertWriteFence(fence);
    await ensureProducerWorkDirectories(app);
    await adapter.write(files.manifestPublishTemporary, JSON.stringify(nextManifest, null, 2));
    const staged = await readJson(app, files.manifestPublishTemporary);
    if (!isRecord(staged) || staged.embeddingsEnabled !== false || staged.embeddings !== undefined) {
      throw new Error("Disabled-embeddings manifest candidate validation failed.");
    }

    await removeIfExists(app, files.embeddingsPublishBackup);
    await removeIfExists(app, files.manifestPublishBackup);
    // The JSONL leaves the canonical location first so every crash window is one the
    // existing recovery already understands (backups restore the previous coherent pair).
    await assertWriteFence(fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.canonicalEmbeddings, files.embeddingsPublishBackup);
    embeddingsBackedUp = true;
    await assertWriteFence(fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.canonicalManifest, files.manifestPublishBackup);
    manifestBackedUp = true;
    await assertWriteFence(fence);
    await renameEmbeddingPersistenceArtifact(adapter, files.manifestPublishTemporary, files.canonicalManifest);
    manifestPublished = true;

    const finalManifest = await readJson(app, files.canonicalManifest);
    if (!isRecord(finalManifest) || finalManifest.embeddingsEnabled !== false || await fileExists(app, files.canonicalEmbeddings)) {
      throw new Error("Disabled-embeddings publication validation failed.");
    }
    await cleanupPaths(app, [files.manifestPublishBackup, files.embeddingsPublishBackup], []);
  } catch (error) {
    try {
      if (manifestPublished) await removeIfExists(app, files.canonicalManifest);
      if (manifestBackedUp && await fileExists(app, files.manifestPublishBackup)) {
        await renameEmbeddingPersistenceArtifact(adapter, files.manifestPublishBackup, files.canonicalManifest);
      }
      if (embeddingsBackedUp && await fileExists(app, files.embeddingsPublishBackup)) {
        await renameEmbeddingPersistenceArtifact(adapter, files.embeddingsPublishBackup, files.canonicalEmbeddings);
      }
    } catch {
      // Backups are preserved on disk for the startup recovery.
    }
    await cleanupPaths(app, [files.manifestPublishTemporary], []);
    throw error;
  }
}

export type CanonicalMaintenanceOutcome<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "refused"; readonly reason: "index-write-busy" | "ownership-fence-rejected" | "disposed" };

/**
 * Runs destructive canonical maintenance under the existing writer exclusion. The lease is
 * acquired first and covers the whole cycle (fence, read, validate, publish); the fence is
 * acquired without auto-claim and is independent of the lease (exclusion vs. authority).
 */
export async function runCanonicalMaintenance<T>(
  coordinator: IndexWriteCoordinator,
  acquireFence: () => Promise<EmbeddingWriteFence | undefined>,
  task: (fence: EmbeddingWriteFence) => Promise<T>,
): Promise<CanonicalMaintenanceOutcome<T>> {
  const lease = coordinator.startCanonicalMaintenance();
  if (lease.status !== "accepted") {
    return { status: "refused", reason: lease.status === "disposed" ? "disposed" : "index-write-busy" };
  }
  try {
    const fence = await acquireFence();
    if (!fence || !await fence.assertCurrent()) return { status: "refused", reason: "ownership-fence-rejected" };
    return { status: "completed", value: await task(fence) };
  } finally {
    coordinator.finish(lease.token);
  }
}

export interface CoordinatedPurgeHooks {
  /** Called only after a purge that actually mutated the canonical publication. */
  readonly onPurged?: () => void;
  readonly getProvenance?: (fence: EmbeddingWriteFence) => ArtifactProvenance | undefined;
}

export async function purgeOrphanEmbeddingsCoordinated(
  app: App,
  coordinator: IndexWriteCoordinator,
  acquireFence: () => Promise<EmbeddingWriteFence | undefined>,
  validChunks: readonly FilterableChunk[],
  activePolicy?: Parameters<typeof purgeOrphanEmbeddingRecords>[2],
  hooks: CoordinatedPurgeHooks = {},
): Promise<PurgeOrphanEmbeddingsResult> {
  const outcome = await runCanonicalMaintenance(coordinator, acquireFence, (fence) =>
    purgeOrphanEmbeddingRecords(app, validChunks, activePolicy, hooks.getProvenance?.(fence), fence));
  if (outcome.status === "refused") return purgeRefused(outcome.reason);
  if (outcome.value.status === "purged") hooks.onPurged?.();
  return outcome.value;
}
