import { App, normalizePath } from "obsidian";
import { isValidEmbeddingVector } from "../ai/embeddingTypes";

export const EMBEDDING_PERSISTENCE_FILES = Object.freeze({
  canonicalEmbeddings: normalizePath(".lina/index/embeddings.jsonl"),
  canonicalManifest: normalizePath(".lina/index/manifest.json"),
  checkpoint: normalizePath(".lina/index/embeddings.checkpoint.jsonl"),
  checkpointMetadata: normalizePath(".lina/index/embeddings.checkpoint.meta.json"),
  checkpointTemporary: normalizePath(".lina/index/embeddings.checkpoint.tmp"),
  checkpointMetadataTemporary: normalizePath(".lina/index/embeddings.checkpoint.meta.tmp"),
  checkpointBackup: normalizePath(".lina/index/embeddings.checkpoint.backup"),
  checkpointMetadataBackup: normalizePath(".lina/index/embeddings.checkpoint.meta.backup"),
  embeddingsPublishTemporary: normalizePath(".lina/index/embeddings.publish.tmp"),
  embeddingsPublishBackup: normalizePath(".lina/index/embeddings.publish.backup"),
  manifestPublishTemporary: normalizePath(".lina/index/manifest.publish.tmp"),
  manifestPublishBackup: normalizePath(".lina/index/manifest.publish.backup"),
});

export const EMBEDDING_CHECKPOINT_SCHEMA_VERSION = 1;

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
    && (value.sourceRevision === undefined || typeof value.sourceRevision === "string");
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

  const parsed = parseEmbeddingRecords(embeddingsContent, count as number, dimensions as number, false);
  if (!parsed.valid) {
    return { valid: false, reason: parsed.reason };
  }
  if (parsed.records.some((record) => record.provider !== provider || record.model !== model)) {
    return { valid: false, reason: "canonical-record-identity-mismatch" };
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
    const embeddingsContent = await app.vault.adapter.read(embeddingsPath);
    const manifest = await readJson(app, manifestPath);
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
      warnings.push(`${path}: ${errorMessage(error)}`);
    }
  }
}

async function restoreCheckpointBackups(app: App): Promise<boolean> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const backup = await validateCheckpointPair(app, files.checkpointBackup, files.checkpointMetadataBackup);
  if (!backup.valid) return false;

  await removeIfExists(app, files.checkpoint);
  await removeIfExists(app, files.checkpointMetadata);
  await app.vault.adapter.rename(files.checkpointBackup, files.checkpoint);
  await app.vault.adapter.rename(files.checkpointMetadataBackup, files.checkpointMetadata);
  return true;
}

async function restoreCanonicalBackups(app: App): Promise<boolean> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const bothBackupsValid = await validateCanonicalFiles(app, files.embeddingsPublishBackup, files.manifestPublishBackup);
  if (bothBackupsValid.valid) {
    await removeIfExists(app, files.canonicalEmbeddings);
    await removeIfExists(app, files.canonicalManifest);
    await app.vault.adapter.rename(files.embeddingsPublishBackup, files.canonicalEmbeddings);
    await app.vault.adapter.rename(files.manifestPublishBackup, files.canonicalManifest);
    return true;
  }

  if (await fileExists(app, files.embeddingsPublishBackup)) {
    const backupWithCurrentManifest = await validateCanonicalFiles(
      app,
      files.embeddingsPublishBackup,
      files.canonicalManifest
    );
    if (backupWithCurrentManifest.valid) {
      await removeIfExists(app, files.canonicalEmbeddings);
      await app.vault.adapter.rename(files.embeddingsPublishBackup, files.canonicalEmbeddings);
      return true;
    }
  }

  if (
    !(await fileExists(app, files.embeddingsPublishBackup))
    && await fileExists(app, files.manifestPublishBackup)
  ) {
    try {
      const manifestBackup = await readJson(app, files.manifestPublishBackup);
      if (isRecord(manifestBackup) && manifestBackup.indexType === "text") {
        await removeIfExists(app, files.canonicalEmbeddings);
        await removeIfExists(app, files.canonicalManifest);
        await app.vault.adapter.rename(files.manifestPublishBackup, files.canonicalManifest);
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

async function completeInterruptedFirstPublication(app: App): Promise<boolean> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  if (
    !(await fileExists(app, files.canonicalEmbeddings))
    || !(await fileExists(app, files.canonicalManifest))
    || !(await fileExists(app, files.manifestPublishTemporary))
  ) {
    return false;
  }

  const currentCanonical = await validateCanonicalFiles(app);
  if (currentCanonical.valid) return false;

  const candidate = await validateCanonicalFiles(
    app,
    files.canonicalEmbeddings,
    files.manifestPublishTemporary
  );
  if (!candidate.valid) return false;

  await removeIfExists(app, files.manifestPublishBackup);
  await app.vault.adapter.rename(files.canonicalManifest, files.manifestPublishBackup);
  await app.vault.adapter.rename(files.manifestPublishTemporary, files.canonicalManifest);
  const published = await validateCanonicalFiles(app);
  if (!published.valid) {
    await removeIfExists(app, files.canonicalManifest);
    await app.vault.adapter.rename(files.manifestPublishBackup, files.canonicalManifest);
    await removeIfExists(app, files.canonicalEmbeddings);
    return false;
  }

  await removeIfExists(app, files.manifestPublishBackup);
  return true;
}

export async function recoverEmbeddingPersistenceArtifacts(
  app: App,
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback
): Promise<{ warnings: string[] }> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const warnings: string[] = [];
  onDiagnostic?.({ stage: "recovery", result: "started" });

  const publicationBackupExistsAtStart = await fileExists(app, files.embeddingsPublishBackup)
    || await fileExists(app, files.manifestPublishBackup);
  if (!publicationBackupExistsAtStart) {
    try {
      await completeInterruptedFirstPublication(app);
    } catch (error) {
      warnings.push(`first-publication-completion: ${errorMessage(error)}`);
    }
  }

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
    } else {
      try {
        const restored = await restoreCanonicalBackups(app);
        if (!restored) warnings.push("canonical-backup-invalid");
      } catch (error) {
        warnings.push(`canonical-backup-restore: ${errorMessage(error)}`);
      }
    }
  }

  onDiagnostic?.({
    stage: "recovery",
    result: warnings.length === 0 ? "succeeded" : "failed",
    cleanupWarnings: warnings.length,
  });
  return { warnings };
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

export async function writeEmbeddingCheckpoint(
  app: App,
  metadata: EmbeddingCheckpointMetadata,
  records: EmbeddingRecord[],
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback
): Promise<EmbeddingCheckpointMetadata> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const adapter = app.vault.adapter;
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
      await adapter.rename(files.checkpoint, files.checkpointBackup);
      checkpointBackedUp = true;
    }
    if (await fileExists(app, files.checkpointMetadata)) {
      await adapter.rename(files.checkpointMetadata, files.checkpointMetadataBackup);
      metadataBackedUp = true;
    }

    await adapter.rename(files.checkpointTemporary, files.checkpoint);
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

    await adapter.rename(files.checkpointMetadataTemporary, files.checkpointMetadata);
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
        await adapter.rename(files.checkpointBackup, files.checkpoint);
      }
      if (metadataBackedUp && await fileExists(app, files.checkpointMetadataBackup)) {
        await adapter.rename(files.checkpointMetadataBackup, files.checkpointMetadata);
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
      sourceTotalChunks: records.length,
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
  };
}

export async function publishCanonicalEmbeddings(
  app: App,
  records: EmbeddingRecord[],
  info: EmbeddingPublicationInfo,
  onDiagnostic?: EmbeddingPersistenceDiagnosticCallback
): Promise<EmbeddingPublicationResult> {
  const files = EMBEDDING_PERSISTENCE_FILES;
  const adapter = app.vault.adapter;
  const warnings: string[] = [];
  const sortedRecords = [...records].sort((a, b) => a.chunkId.localeCompare(b.chunkId));
  let embeddingsBackedUp = false;
  let manifestBackedUp = false;
  let embeddingsPublished = false;
  let manifestPublished = false;

  onDiagnostic?.({ stage: "publication", result: "started", records: sortedRecords.length });
  try {
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
      await adapter.rename(files.canonicalEmbeddings, files.embeddingsPublishBackup);
      embeddingsBackedUp = true;
    }
    await adapter.rename(files.embeddingsPublishTemporary, files.canonicalEmbeddings);
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

    await adapter.rename(files.canonicalManifest, files.manifestPublishBackup);
    manifestBackedUp = true;
    await adapter.rename(files.manifestPublishTemporary, files.canonicalManifest);
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
    return { success: true, warnings };
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
        await adapter.rename(files.embeddingsPublishBackup, files.canonicalEmbeddings);
      }
      if (manifestBackedUp && await fileExists(app, files.manifestPublishBackup)) {
        await adapter.rename(files.manifestPublishBackup, files.canonicalManifest);
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
