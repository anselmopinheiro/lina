import { App, Vault, TFile, normalizePath } from "obsidian";
import { ScannedNote } from "./noteScanner";
import { hashContent } from "./noteHasher";
import { Chunk } from "./chunker";
import { ArtifactProvenance, isValidArtifactProvenance } from "../device/artifactProvenance";
import { IndexWriteFence, OwnershipFenceRejectedError, assertIndexWriteFence, withFencedAdapter } from "./writeFence";
import {
  ExclusionPolicyV1,
  ExclusionPolicyCompatibility,
  ManifestPolicyIdentity,
  evaluateExclusionPolicyCompatibility,
  isValidPolicyHash,
  sha256Hex,
} from "./exclusionPolicy";

export interface IndexedNote {
  path: string;
  basename: string;
  extension: string;
  size: number;
  mtime: number;
  contentHash: string;
  indexedAt: string;
}

export interface TextIndexManifest {
  version: number;
  indexType: "text";
  embeddingsEnabled: boolean;
  updatedAt: string;
  totalNotes: number;
  totalChunks?: number;
  excludedNotes?: number;
  generationId?: string;
  notesDigest?: string;
  chunksDigest?: string;
  chunking?: {
    enabled: boolean;
    chunkSize: number;
    overlap: number;
  };
  exclusions?: {
    enabled: boolean;
    alwaysExcludedFolders: string[];
    excludedFoldersCount: number;
    excludedPathContainsCount: number;
    excludedContentContainsCount?: number;
  };
  exclusionPolicyRevision?: number;
  exclusionPolicyHash?: string;
  provenance?: ArtifactProvenance;
}

export interface TextIndexPolicyStamping {
  readonly revision?: number;
  readonly hash?: string;
  readonly policyRevision?: number;
  readonly policyHash?: string;
  readonly exclusionPolicyRevision?: number;
  readonly exclusionPolicyHash?: string;
}

export type TextIndexGenerationIntegrity =
  | "verified"
  | "legacy"
  | "digest-mismatch"
  | "count-mismatch"
  | "incomplete"
  | "missing";

export function createTextGenerationId(): string {
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function computeTextArtifactDigest(content: string): string {
  return `sha256:${sha256Hex(content)}`;
}

export function isValidTextGenerationId(value: unknown): value is string {
  return typeof value === "string" && /^gen-[a-z0-9]+-[a-z0-9]+$/i.test(value);
}

export function isValidTextArtifactDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/i.test(value);
}

export function isValidManifestPolicyRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function isValidManifestPolicyHash(value: unknown): value is string {
  return isValidPolicyHash(value);
}

export async function createTextIndex(vault: Vault, scannedNotes: ScannedNote[]): Promise<IndexedNote[]> {
  const indexedNotes: IndexedNote[] = [];
  const now = new Date().toISOString();

  for (const note of scannedNotes) {
    try {
      const file = vault.getAbstractFileByPath(note.path);
      if (!(file instanceof TFile)) {
        continue;
      }

      const content = await vault.read(file);
      const contentHash = hashContent(content);

      indexedNotes.push({
        path: note.path,
        basename: note.basename,
        extension: note.extension,
        size: note.size,
        mtime: note.mtime,
        contentHash,
        indexedAt: now,
      });
    } catch (error) {
      console.error(`Error indexing note ${note.path}:`, error);
    }
  }

  return indexedNotes;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const adapter = app.vault.adapter;
  const normalizedPath = normalizePath(folderPath);
  const parts = normalizedPath.split("/");
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    try {
      const stat = await adapter.stat(currentPath);

      if (!stat) {
        await adapter.mkdir(currentPath);
        continue;
      }

      if (stat.type !== "folder") {
        throw new Error(`Existe um ficheiro com o nome '${currentPath}' onde uma pasta é esperada.`);
      }
    } catch {
      await adapter.mkdir(currentPath);
    }
  }
}

const MANIFEST_INDEX_PATH = ".lina/index/manifest.json";
const NOTES_INDEX_PATH = ".lina/index/notes.json";
const CHUNKS_INDEX_PATH = ".lina/index/chunks.jsonl";
const MAX_CHUNKS_FILE_BYTES = 50 * 1024 * 1024;
const MAX_INDEXED_CHUNKS_TO_LOAD = 100_000;
const warnedNotesIndexReadIssues = new Set<string>();
const warnedChunksIndexReadIssues = new Set<string>();
const warnedAutomaticUpdateReadinessIssues = new Set<string>();

type NotesIndexReadResult =
  | { status: "available"; notes: IndexedNote[]; rawContent: string }
  | { status: "missing" }
  | { status: "unavailable"; reason: string };

type ChunksIndexReadResult =
  | { status: "available"; chunks: Chunk[]; rawContent: string }
  | { status: "missing" }
  | { status: "unavailable"; reason: string };

export type TextIndexAutomaticUpdateReadiness =
  | {
      ready: true;
      manifest: TextIndexManifest;
      notes: IndexedNote[];
      chunks: Chunk[];
    }
  | {
      ready: false;
      reason: string;
    };

function warnNotesIndexReadIssue(reason: string, details?: Record<string, unknown>): void {
  const warningKey = `${NOTES_INDEX_PATH}:${reason}`;
  if (warnedNotesIndexReadIssues.has(warningKey)) {
    return;
  }

  warnedNotesIndexReadIssues.add(warningKey);
  console.warn("Lina: notes index file could not be loaded safely.", {
    path: NOTES_INDEX_PATH,
    reason,
    ...details,
  });
}

function warnChunksIndexReadIssue(reason: string, details?: Record<string, unknown>): void {
  const warningKey = `${CHUNKS_INDEX_PATH}:${reason}`;
  if (warnedChunksIndexReadIssues.has(warningKey)) {
    return;
  }

  warnedChunksIndexReadIssues.add(warningKey);
  console.warn("Lina: chunks index file could not be loaded safely.", {
    path: CHUNKS_INDEX_PATH,
    reason,
    ...details,
  });
}

function warnAutomaticUpdateReadinessIssue(reason: string, details?: Record<string, unknown>): void {
  if (warnedAutomaticUpdateReadinessIssues.has(reason)) {
    return;
  }

  warnedAutomaticUpdateReadinessIssues.add(reason);
  console.warn("Lina: automatic text index update skipped because the text index is not ready.", {
    reason,
    ...details,
  });
}

async function readNotesIndexFile(app: App): Promise<NotesIndexReadResult> {
  const adapter = app.vault.adapter;
  const notesPath = normalizePath(NOTES_INDEX_PATH);

  try {
    const stat = await adapter.stat(notesPath);
    if (!stat || stat.type === "folder") {
      return { status: "missing" };
    }

    if (stat.size === 0) {
      warnNotesIndexReadIssue("empty-file");
      return { status: "unavailable", reason: "empty-file" };
    }

    const content = await adapter.read(notesPath);
    if (content.trim().length === 0) {
      warnNotesIndexReadIssue("empty-content");
      return { status: "unavailable", reason: "empty-content" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      warnNotesIndexReadIssue("invalid-json", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: "unavailable", reason: "invalid-json" };
    }

    if (!Array.isArray(parsed)) {
      warnNotesIndexReadIssue("invalid-shape");
      return { status: "unavailable", reason: "invalid-shape" };
    }

    return { status: "available", notes: parsed as IndexedNote[], rawContent: content };
  } catch (error) {
    warnNotesIndexReadIssue("read-error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "unavailable", reason: "read-error" };
  }
}

async function readChunksIndexFile(app: App, strict: boolean): Promise<ChunksIndexReadResult> {
  const chunksPath = normalizePath(CHUNKS_INDEX_PATH);

  try {
    const adapter = app.vault.adapter;
    const stat = await adapter.stat(chunksPath);
    if (!stat || stat.type === "folder") {
      return { status: "missing" };
    }

    if (stat.size > MAX_CHUNKS_FILE_BYTES) {
      warnChunksIndexReadIssue("file-too-large", {
        size: stat.size,
        limit: MAX_CHUNKS_FILE_BYTES,
      });
      return { status: "unavailable", reason: "file-too-large" };
    }

    const content = await adapter.read(chunksPath);
    const chunks: Chunk[] = [];
    let invalidLines = 0;
    let lineStart = 0;
    let stoppedAtLimit = false;

    for (let index = 0; index <= content.length; index++) {
      const isLineEnd = index === content.length || content.charCodeAt(index) === 10;
      if (!isLineEnd) {
        continue;
      }

      let line = content.slice(lineStart, index);
      lineStart = index + 1;

      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) {
        continue;
      }

      try {
        chunks.push(JSON.parse(trimmedLine) as Chunk);
      } catch {
        invalidLines++;
      }

      if (chunks.length >= MAX_INDEXED_CHUNKS_TO_LOAD) {
        stoppedAtLimit = content.slice(index + 1).trim().length > 0;
        break;
      }
    }

    if (invalidLines > 0) {
      warnChunksIndexReadIssue("invalid-json-lines", { invalidLines });
      if (strict) {
        return { status: "unavailable", reason: "invalid-json-lines" };
      }
    }

    if (stoppedAtLimit) {
      warnChunksIndexReadIssue("chunk-limit-reached", {
        limit: MAX_INDEXED_CHUNKS_TO_LOAD,
      });
      if (strict) {
        return { status: "unavailable", reason: "chunk-limit-reached" };
      }
    }

    return { status: "available", chunks, rawContent: content };
  } catch (error) {
    warnChunksIndexReadIssue("read-error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "unavailable", reason: "read-error" };
  }
}

/**
 * Deterministic staging/backup names of the text index publication protocol
 * (LINA-15H-D). They are the only names `recoverTextIndexPublication` recognises and
 * they never collide with the embeddings publication names.
 */
export const TEXT_INDEX_PUBLICATION_FILES = {
  notes: NOTES_INDEX_PATH,
  chunks: CHUNKS_INDEX_PATH,
  manifest: MANIFEST_INDEX_PATH,
  notesTemporary: ".lina/producer/staging/text-notes.publish.tmp",
  chunksTemporary: ".lina/producer/staging/text-chunks.publish.tmp",
  manifestTemporary: ".lina/producer/staging/text-manifest.publish.tmp",
  notesBackup: ".lina/producer/backups/text-notes.publish.backup",
  chunksBackup: ".lina/producer/backups/text-chunks.publish.backup",
  manifestBackup: ".lina/producer/backups/text-manifest.publish.backup",
} as const;

/** Deterministic backup of the embeddings publication (owned by embeddingPersistence). */
const EMBEDDINGS_PUBLICATION_MANIFEST_BACKUP = ".lina/producer/backups/manifest.publish.backup";

type EmbeddingManifestSection = Record<string, unknown>;

type EmbeddingSectionReadResult =
  | { readonly status: "absent" }
  | { readonly status: "available"; readonly section: EmbeddingManifestSection }
  | { readonly status: "unreadable" };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function adapterFileExists(adapter: App["vault"]["adapter"], path: string): Promise<boolean> {
  return (await adapter.stat(path))?.type === "file";
}

async function adapterRemoveIfExists(adapter: App["vault"]["adapter"], path: string): Promise<void> {
  if (await adapter.exists(path)) await adapter.remove(path);
}

function extractEmbeddingSection(value: unknown): EmbeddingManifestSection {
  if (isPlainRecord(value) && value.embeddingsEnabled === true && isPlainRecord(value.embeddings)) {
    return {
      embeddingsEnabled: true,
      embeddings: value.embeddings,
      ...(isPlainRecord(value.embeddingInput) ? { embeddingInput: value.embeddingInput } : {}),
    };
  }
  return {};
}

async function readEmbeddingSectionFrom(adapter: App["vault"]["adapter"], path: string): Promise<EmbeddingSectionReadResult> {
  try {
    if (!await adapterFileExists(adapter, path)) return { status: "absent" };
    return { status: "available", section: extractEmbeddingSection(JSON.parse(await adapter.read(path)) as unknown) };
  } catch {
    // An existing shared manifest which cannot be read is not equivalent to a
    // manifest without embeddings. The caller must fail closed rather than
    // publish a replacement which would erase an unknown embedding identity.
    return { status: "unreadable" };
  }
}

/**
 * Checks that a (notes, chunks, manifest) triple is one complete text publication:
 * everything parses, counts and digests declared by the manifest match.
 */
function isCompleteTextTriple(notesRaw: string | undefined, chunksRaw: string | undefined, manifestRaw: string | undefined): boolean {
  if (notesRaw === undefined || chunksRaw === undefined || manifestRaw === undefined) return false;
  try {
    const manifest: unknown = JSON.parse(manifestRaw);
    if (!isTextIndexManifest(manifest)) return false;
    const notes: unknown = JSON.parse(notesRaw);
    if (!Array.isArray(notes) || !notes.every(isIndexedNote)) return false;
    const lines = chunksRaw.split("\n").filter((line) => line.trim().length > 0);
    if (!lines.every((line) => isTextChunk(JSON.parse(line) as unknown))) return false;
    if (typeof manifest.totalNotes === "number" && manifest.totalNotes !== notes.length) return false;
    if (typeof manifest.totalChunks === "number" && manifest.totalChunks !== lines.length) return false;
    if (manifest.notesDigest !== undefined && manifest.notesDigest !== computeTextArtifactDigest(notesRaw)) return false;
    if (manifest.chunksDigest !== undefined && manifest.chunksDigest !== computeTextArtifactDigest(chunksRaw)) return false;
    return true;
  } catch {
    return false;
  }
}

async function readOptionalText(adapter: App["vault"]["adapter"], path: string): Promise<string | undefined> {
  try {
    return await adapterFileExists(adapter, path) ? await adapter.read(path) : undefined;
  } catch {
    return undefined;
  }
}

export interface TextIndexRecoveryResult {
  readonly warnings: string[];
  readonly changed: boolean;
}

/**
 * Recovers an interrupted `saveTextIndex` publication using only the deterministic
 * protocol names. The caller must hold the writer lease and pass an app whose adapter
 * is fenced (`withFencedAdapter`); this function never claims ownership.
 *
 * Evidence rules (a newer publication is never replaced by an older one):
 * - a complete current triple means any backup is residue and is only removed;
 * - a backup is restored only when the manifest is not already the committed one
 *   (no manifest backup next to an existing manifest) and the triple made of the
 *   backups plus the untouched current files is itself a complete publication;
 * - staging temporaries are never promoted, only removed.
 */
export async function recoverTextIndexPublication(app: App): Promise<TextIndexRecoveryResult> {
  const files = TEXT_INDEX_PUBLICATION_FILES;
  const adapter = app.vault.adapter;
  const warnings: string[] = [];
  let changed = false;
  const remove = async (path: string): Promise<void> => {
    if (await adapter.exists(path)) {
      await adapter.remove(path);
      changed = true;
    }
  };

  for (const path of [files.notesTemporary, files.chunksTemporary, files.manifestTemporary]) await remove(path);

  const backups = {
    notes: await adapterFileExists(adapter, files.notesBackup),
    chunks: await adapterFileExists(adapter, files.chunksBackup),
    manifest: await adapterFileExists(adapter, files.manifestBackup),
  };
  if (!backups.notes && !backups.chunks && !backups.manifest) return { warnings, changed };

  const backupPaths = [files.notesBackup, files.chunksBackup, files.manifestBackup];
  const [notesNow, chunksNow, manifestNow] = [
    await readOptionalText(adapter, files.notes),
    await readOptionalText(adapter, files.chunks),
    await readOptionalText(adapter, files.manifest),
  ];
  if (isCompleteTextTriple(notesNow, chunksNow, manifestNow)) {
    // The publication committed (or a newer one exists): backups are stale residue.
    for (const path of backupPaths) await remove(path);
    return { warnings, changed };
  }

  if (backups.manifest && manifestNow !== undefined) {
    warnings.push("text-backup-superseded");
    return { warnings, changed };
  }

  const pick = async (current: string | undefined, backupPath: string, hasBackup: boolean) =>
    hasBackup ? readOptionalText(adapter, backupPath) : current;
  const candidate = {
    notes: await pick(notesNow, files.notesBackup, backups.notes),
    chunks: await pick(chunksNow, files.chunksBackup, backups.chunks),
    manifest: await pick(manifestNow, files.manifestBackup, backups.manifest),
  };
  if (!isCompleteTextTriple(candidate.notes, candidate.chunks, candidate.manifest)) {
    warnings.push("text-backup-invalid");
    return { warnings, changed };
  }

  const restores: Array<{ canonical: string; temporary: string; backup: string; content: string | undefined; has: boolean }> = [
    { canonical: files.notes, temporary: files.notesTemporary, backup: files.notesBackup, content: candidate.notes, has: backups.notes },
    { canonical: files.chunks, temporary: files.chunksTemporary, backup: files.chunksBackup, content: candidate.chunks, has: backups.chunks },
    { canonical: files.manifest, temporary: files.manifestTemporary, backup: files.manifestBackup, content: candidate.manifest, has: backups.manifest },
  ];
  for (const item of restores) {
    if (!item.has || item.content === undefined) continue;
    // Restore through staging so a revoked fence between two files leaves complete backups.
    await adapter.write(item.temporary, item.content);
    changed = true;
    await remove(item.canonical);
    await adapter.rename(item.temporary, item.canonical);
  }
  const restored = [
    await readOptionalText(adapter, files.notes),
    await readOptionalText(adapter, files.chunks),
    await readOptionalText(adapter, files.manifest),
  ] as const;
  if (!isCompleteTextTriple(...restored)) {
    warnings.push("text-backup-restore-invalid");
    return { warnings, changed };
  }
  for (const path of backupPaths) await remove(path);
  return { warnings, changed };
}

/**
 * Publishes notes.json, chunks.jsonl and the shared manifest.json.
 *
 * The caller must hold the writer lease (rebuild, automatic batch or canonical
 * maintenance) and pass the fence acquired for the current authority; every durable
 * mutation re-validates it, and nothing is written when it is rejected.
 *
 * Protocol (deterministic names, see TEXT_INDEX_PUBLICATION_FILES): recover any
 * interrupted publication → read the embeddings section of the shared manifest →
 * stage the three files → re-check that section is unchanged → per file
 * backup + rename (manifest last, the logical commit point) → validate the
 * published manifest → remove the backups. After a fence rejection nothing is rolled
 * back: the backups stay in place for the recovery.
 */
export async function saveTextIndex(
  app: App,
  indexedNotes: IndexedNote[],
  chunks: Chunk[],
  chunkingOptions: TextIndexManifest["chunking"],
  excludedNotes?: number,
  exclusionsInfo?: TextIndexManifest["exclusions"],
  provenance?: ArtifactProvenance,
  policyIdentity?: TextIndexPolicyStamping | ExclusionPolicyV1,
  fence?: IndexWriteFence
): Promise<boolean> {
  try {
    let stampedRevision: number | undefined;
    let stampedHash: string | undefined;

    if (policyIdentity) {
      let rawRevision: unknown = undefined;
      let rawHash: unknown = undefined;

      if ("policyRevision" in policyIdentity) {
        rawRevision = policyIdentity.policyRevision;
      } else if ("exclusionPolicyRevision" in policyIdentity) {
        rawRevision = policyIdentity.exclusionPolicyRevision;
      } else if ("revision" in policyIdentity) {
        rawRevision = policyIdentity.revision;
      }

      if ("policyHash" in policyIdentity) {
        rawHash = policyIdentity.policyHash;
      } else if ("exclusionPolicyHash" in policyIdentity) {
        rawHash = policyIdentity.exclusionPolicyHash;
      } else if ("hash" in policyIdentity) {
        rawHash = policyIdentity.hash;
      }

      if (rawRevision === undefined || rawHash === undefined) {
        console.error("Lina: saveTextIndex rejected incomplete policy identity (both revision and hash are required).");
        return false;
      }

      if (!isValidManifestPolicyRevision(rawRevision)) {
        const repr = typeof rawRevision === "number" || typeof rawRevision === "string"
          ? String(rawRevision)
          : JSON.stringify(rawRevision);
        console.error(`Lina: saveTextIndex rejected invalid policy revision: ${repr}`);
        return false;
      }

      if (!isValidManifestPolicyHash(rawHash)) {
        const repr = typeof rawHash === "number" || typeof rawHash === "string"
          ? String(rawHash)
          : JSON.stringify(rawHash);
        console.error(`Lina: saveTextIndex rejected invalid policy hash: ${repr}`);
        return false;
      }

      stampedRevision = rawRevision;
      stampedHash = rawHash;
    }

    await assertIndexWriteFence(fence);

    const now = new Date().toISOString();
    const linaFolderPath = ".lina";
    const indexFolderPath = ".lina/index";
    const producerCheckpointsFolderPath = ".lina/producer/checkpoints";
    const producerStagingFolderPath = ".lina/producer/staging";
    const producerBackupsFolderPath = ".lina/producer/backups";

    const fencedApp = withFencedAdapter(app, fence);
    await ensureFolder(fencedApp, linaFolderPath);
    await ensureFolder(fencedApp, indexFolderPath);
    await ensureFolder(fencedApp, producerCheckpointsFolderPath);
    await ensureFolder(fencedApp, producerStagingFolderPath);
    await ensureFolder(fencedApp, producerBackupsFolderPath);

    const adapter = fencedApp.vault.adapter;
    const paths = TEXT_INDEX_PUBLICATION_FILES;

    // Resolve an interrupted previous publication before reading the shared manifest.
    await recoverTextIndexPublication(fencedApp);

    // The embeddings identity is read inside the lease, from the committed manifest or,
    // when it is absent, from the deterministic backup of the interrupted publication.
    const committedManifest = await readEmbeddingSectionFrom(adapter, paths.manifest);
    if (committedManifest.status === "unreadable") {
      throw new Error("Shared manifest is unreadable; refusing to replace its embeddings identity.");
    }
    const committedSection = committedManifest.status === "available" ? committedManifest.section : undefined;
    const textBackupManifest = await readEmbeddingSectionFrom(adapter, paths.manifestBackup);
    if (textBackupManifest.status === "unreadable") {
      throw new Error("Text manifest backup is unreadable; refusing to replace its embeddings identity.");
    }
    const embeddingsBackupManifest = await readEmbeddingSectionFrom(adapter, EMBEDDINGS_PUBLICATION_MANIFEST_BACKUP);
    if (embeddingsBackupManifest.status === "unreadable") {
      throw new Error("Embeddings manifest backup is unreadable; refusing to replace its embeddings identity.");
    }
    const preservedEmbeddingManifest: EmbeddingManifestSection =
      committedSection
      ?? (textBackupManifest.status === "available" ? textBackupManifest.section : undefined)
      // An interrupted embeddings publication (manifest absent between its two renames)
      // leaves the identity here; the embeddings recovery completes it afterwards.
      ?? (embeddingsBackupManifest.status === "available" ? embeddingsBackupManifest.section : undefined)
      ?? {};
    // Whatever the recovery could not resolve has already contributed its identity above.
    for (const path of [paths.notesBackup, paths.chunksBackup, paths.manifestBackup]) await adapterRemoveIfExists(adapter, path);
    const preservedSignature = JSON.stringify(preservedEmbeddingManifest);

    const notesContent = JSON.stringify(indexedNotes, null, 2);
    const chunksContent = chunks.map((item) => JSON.stringify(item)).join("\n");
    const generationId = createTextGenerationId();
    const notesDigest = computeTextArtifactDigest(notesContent);
    const chunksDigest = computeTextArtifactDigest(chunksContent);

    const manifest: Record<string, unknown> = {
      ...preservedEmbeddingManifest,
      version: 1,
      indexType: "text",
      generationId,
      notesDigest,
      chunksDigest,
      embeddingsEnabled: preservedEmbeddingManifest.embeddingsEnabled === true,
      updatedAt: now,
      totalNotes: indexedNotes.length,
      totalChunks: chunks.length,
      excludedNotes: excludedNotes ?? 0,
      chunking: chunkingOptions,
      exclusions: exclusionsInfo,
      ...(provenance && isValidArtifactProvenance(provenance) ? { provenance } : {}),
      ...(stampedRevision !== undefined && stampedHash !== undefined
        ? { exclusionPolicyRevision: stampedRevision, exclusionPolicyHash: stampedHash }
        : {}),
    };

    const items = [
      { path: paths.notes, temporaryPath: paths.notesTemporary, backupPath: paths.notesBackup, content: notesContent, backedUp: false, published: false },
      { path: paths.chunks, temporaryPath: paths.chunksTemporary, backupPath: paths.chunksBackup, content: chunksContent, backedUp: false, published: false },
      // The manifest is published last: it is the logical commit point of the publication.
      { path: paths.manifest, temporaryPath: paths.manifestTemporary, backupPath: paths.manifestBackup, content: JSON.stringify(manifest, null, 2), backedUp: false, published: false },
    ];

    try {
      for (const item of items) await adapter.write(item.temporaryPath, item.content);
      const staged: unknown = JSON.parse(await adapter.read(paths.manifestTemporary));
      if (!isPlainRecord(staged) || staged.generationId !== generationId) {
        throw new Error("Text index manifest candidate validation failed.");
      }
      // Never last-write-wins over a shared manifest that changed after it was read.
      const currentManifest = await readEmbeddingSectionFrom(adapter, paths.manifest);
      if (currentManifest.status === "unreadable") {
        throw new Error("Shared manifest became unreadable during the text index publication.");
      }
      const current = currentManifest.status === "available" ? currentManifest.section : undefined;
      // Read from the committed manifest: it must be unchanged. Read from a backup (manifest
      // absent): the manifest must still be absent, otherwise someone published meanwhile.
      const unchanged = committedSection !== undefined
        ? JSON.stringify(current ?? {}) === preservedSignature
        : current === undefined;
      if (!unchanged) {
        throw new Error("Shared manifest embeddings section changed during the text index publication.");
      }

      for (const item of items) {
        await assertIndexWriteFence(fence);
        if (await adapterFileExists(adapter, item.path)) {
          await adapter.rename(item.path, item.backupPath);
          item.backedUp = true;
        }
        await assertIndexWriteFence(fence);
        await adapter.rename(item.temporaryPath, item.path);
        item.published = true;
      }

      const publishedManifest: unknown = JSON.parse(await adapter.read(paths.manifest));
      if (
        !isPlainRecord(publishedManifest)
        || publishedManifest.generationId !== generationId
        || JSON.stringify(extractEmbeddingSection(publishedManifest)) !== preservedSignature
      ) {
        throw new Error("Published text index manifest validation failed.");
      }
    } catch (error) {
      if (error instanceof OwnershipFenceRejectedError) throw error;
      // Roll back only what this publication moved; a failed backup move never deletes the original.
      for (const item of [...items].reverse()) {
        try {
          if (item.backedUp) {
            await adapterRemoveIfExists(adapter, item.path);
            if (await adapter.exists(item.backupPath)) await adapter.rename(item.backupPath, item.path);
          } else if (item.published) {
            await adapterRemoveIfExists(adapter, item.path);
          }
        } catch (rollbackError) {
          console.warn(`Lina: text index rollback incomplete for ${item.path}; the backup remains for recovery.`, rollbackError);
        }
      }
      for (const item of items) {
        try { await adapterRemoveIfExists(adapter, item.temporaryPath); } catch { /* recovery removes known temporaries */ }
      }
      throw error;
    }

    // Cleanup only after the commit and validation; a rejected fence leaves residue
    // that the next recovery recognises and removes.
    for (const item of items) {
      try {
        await adapterRemoveIfExists(adapter, item.backupPath);
      } catch (cleanupError) {
        console.warn(`Lina: não foi possível remover backup temporário do índice ${item.backupPath}:`, cleanupError);
      }
    }

    return true;
  } catch (error) {
    console.error("Error saving text index:", error);
    return false;
  }
}

export async function persistAndActivateTextIndexCandidate(
  persist: () => Promise<boolean>,
  activate: () => void
): Promise<boolean> {
  const persisted = await persist();
  if (!persisted) {
    return false;
  }

  activate();
  return true;
}

export async function readIndexedNotes(app: App): Promise<IndexedNote[] | null> {
  const result = await readNotesIndexFile(app);
  return result.status === "available" ? result.notes : null;
}

export async function readIndexedChunks(app: App): Promise<Chunk[] | null> {
  const result = await readChunksIndexFile(app, false);
  if (result.status === "missing") {
    return null;
  }
  return result.status === "available" ? result.chunks : [];
}

export async function readTextIndexForAutomaticUpdate(app: App): Promise<TextIndexAutomaticUpdateReadiness> {
  const adapter = app.vault.adapter;
  const manifestPath = normalizePath(MANIFEST_INDEX_PATH);

  try {
    const manifestStat = await adapter.stat(manifestPath);
    if (!manifestStat || manifestStat.type === "folder") {
      warnAutomaticUpdateReadinessIssue("manifest-missing");
      return { ready: false, reason: "manifest-missing" };
    }

    const manifestContent = await adapter.read(manifestPath);
    if (manifestContent.trim().length === 0) {
      warnAutomaticUpdateReadinessIssue("manifest-empty");
      return { ready: false, reason: "manifest-empty" };
    }

    let manifest: TextIndexManifest;
    try {
      manifest = JSON.parse(manifestContent) as TextIndexManifest;
    } catch (error) {
      warnAutomaticUpdateReadinessIssue("manifest-invalid-json", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { ready: false, reason: "manifest-invalid-json" };
    }

    if (!isTextIndexManifest(manifest)) {
      warnAutomaticUpdateReadinessIssue("manifest-invalid-shape");
      return { ready: false, reason: "manifest-invalid-shape" };
    }

    const notesResult = await readNotesIndexFile(app);
    if (notesResult.status !== "available") {
      const reason = `notes-${notesResult.status === "missing" ? "missing" : notesResult.reason}`;
      warnAutomaticUpdateReadinessIssue(reason);
      return { ready: false, reason };
    }

    const chunksResult = await readChunksIndexFile(app, true);
    if (chunksResult.status !== "available") {
      const reason = `chunks-${chunksResult.status === "missing" ? "missing" : chunksResult.reason}`;
      warnAutomaticUpdateReadinessIssue(reason);
      return { ready: false, reason };
    }

    if (!notesResult.notes.every(isIndexedNote)) {
      warnAutomaticUpdateReadinessIssue("notes-invalid-shape");
      return { ready: false, reason: "notes-invalid-shape" };
    }

    if (!chunksResult.chunks.every(isTextChunk)) {
      warnAutomaticUpdateReadinessIssue("chunks-invalid-shape");
      return { ready: false, reason: "chunks-invalid-shape" };
    }

    if (
      (typeof manifest.totalNotes === "number" && manifest.totalNotes !== notesResult.notes.length)
      || (typeof manifest.totalChunks === "number" && manifest.totalChunks !== chunksResult.chunks.length)
    ) {
      warnAutomaticUpdateReadinessIssue("manifest-count-mismatch");
      return { ready: false, reason: "manifest-count-mismatch" };
    }

    if (manifest.notesDigest !== undefined) {
      const actualNotesDigest = computeTextArtifactDigest(notesResult.rawContent);
      if (actualNotesDigest !== manifest.notesDigest) {
        warnAutomaticUpdateReadinessIssue("notes-digest-mismatch");
        return { ready: false, reason: "notes-digest-mismatch" };
      }
    }

    if (manifest.chunksDigest !== undefined) {
      const actualChunksDigest = computeTextArtifactDigest(chunksResult.rawContent);
      if (actualChunksDigest !== manifest.chunksDigest) {
        warnAutomaticUpdateReadinessIssue("chunks-digest-mismatch");
        return { ready: false, reason: "chunks-digest-mismatch" };
      }
    }

    return {
      ready: true,
      manifest,
      notes: notesResult.notes,
      chunks: chunksResult.chunks,
    };
  } catch (error) {
    warnAutomaticUpdateReadinessIssue("read-error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ready: false, reason: "read-error" };
  }
}

export interface TextIndexStatus {
  exists: boolean;
  usability: TextIndexUsability;
  isUsable: boolean;
  origin?: TextIndexOrigin;
  manifest?: TextIndexManifest;
  provenance?: ArtifactProvenance;
  policyCompatibility?: ExclusionPolicyCompatibility;
  generationIntegrity?: TextIndexGenerationIntegrity;
  generationId?: string;
  totalNotes?: number;
  totalChunks?: number;
  excludedNotes?: number;
  error?: string;
}

export type TextIndexUsability = "missing" | "ready" | "stale" | "invalid";
export type TextIndexOrigin = "unknown";

export interface TextIndexExpectedNote {
  path: string;
  size: number;
  mtime: number;
}

export interface ReadTextIndexStatusOptions {
  /** The caller owns the eligible vault scope, including configured exclusions. */
  expectedNotes?: TextIndexExpectedNote[];
  activePolicy?:
    | ExclusionPolicyV1
    | { readonly policyHash?: string; readonly policyRevision?: number; readonly [key: string]: unknown }
    | string
    | null;
}

function unavailableTextIndexStatus(
  usability: "missing" | "invalid",
  error?: string,
  manifest?: TextIndexManifest,
  policyCompatibility?: ExclusionPolicyCompatibility,
  generationIntegrity?: TextIndexGenerationIntegrity
): TextIndexStatus {
  return {
    exists: false,
    isUsable: false,
    usability,
    ...(manifest ? { manifest } : {}),
    ...(policyCompatibility ? { policyCompatibility } : {}),
    ...(generationIntegrity ? { generationIntegrity } : {}),
    ...(error ? { error } : {}),
  };
}

function isIndexedNote(value: unknown): value is IndexedNote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const note = value as Record<string, unknown>;
  return typeof note.path === "string"
    && typeof note.basename === "string"
    && typeof note.extension === "string"
    && typeof note.size === "number"
    && typeof note.mtime === "number"
    && typeof note.contentHash === "string"
    && typeof note.indexedAt === "string";
}

function isTextChunk(value: unknown): value is Chunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const chunk = value as Record<string, unknown>;
  return typeof chunk.chunkId === "string"
    && typeof chunk.path === "string"
    && typeof chunk.chunkIndex === "number"
    && typeof chunk.text === "string"
    && typeof chunk.textHash === "string"
    && typeof chunk.createdAt === "string";
}

function isTextIndexManifest(value: unknown): value is TextIndexManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.indexType !== "text" || typeof manifest.version !== "number") {
    return false;
  }
  if (
    manifest.exclusionPolicyRevision !== undefined &&
    !isValidManifestPolicyRevision(manifest.exclusionPolicyRevision)
  ) {
    return false;
  }
  if (
    manifest.exclusionPolicyHash !== undefined &&
    !isValidManifestPolicyHash(manifest.exclusionPolicyHash)
  ) {
    return false;
  }
  if (manifest.generationId !== undefined && !isValidTextGenerationId(manifest.generationId)) {
    return false;
  }
  if (manifest.notesDigest !== undefined && !isValidTextArtifactDigest(manifest.notesDigest)) {
    return false;
  }
  if (manifest.chunksDigest !== undefined && !isValidTextArtifactDigest(manifest.chunksDigest)) {
    return false;
  }
  return true;
}

function isTextIndexStale(indexedNotes: IndexedNote[], expectedNotes: TextIndexExpectedNote[]): boolean {
  if (indexedNotes.length !== expectedNotes.length) return true;
  const indexedByPath = new Map(indexedNotes.map((note) => [note.path, note]));
  return expectedNotes.some((note) => {
    const indexed = indexedByPath.get(note.path);
    return !indexed || indexed.size !== note.size || indexed.mtime !== note.mtime;
  });
}

/**
 * Reads the persisted publication as the canonical index state. Valid index
 * artefacts are usable regardless of which device produced them; if the
 * publication contains provenance, it is surfaced.
 */
export async function readTextIndexStatus(
  app: App,
  options: ReadTextIndexStatusOptions = {},
): Promise<TextIndexStatus> {
  try {
    const manifestPath = normalizePath(MANIFEST_INDEX_PATH);
    const adapter = app.vault.adapter;

    const manifestStat = await adapter.stat(manifestPath);
    if (!manifestStat || manifestStat.type === "folder") {
      const policyCompatibility = evaluateExclusionPolicyCompatibility(options.activePolicy, undefined);
      return unavailableTextIndexStatus("missing", undefined, undefined, policyCompatibility, "missing");
    }

    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(await adapter.read(manifestPath));
    } catch {
      return unavailableTextIndexStatus("invalid", "manifest.json inválido", undefined, undefined, "incomplete");
    }

    if (!isTextIndexManifest(rawManifest)) {
      const candidate: ManifestPolicyIdentity | undefined =
        rawManifest !== null && typeof rawManifest === "object" && !Array.isArray(rawManifest)
          ? {
              exclusionPolicyRevision:
                "exclusionPolicyRevision" in rawManifest && typeof rawManifest.exclusionPolicyRevision === "number"
                  ? rawManifest.exclusionPolicyRevision
                  : undefined,
              exclusionPolicyHash:
                "exclusionPolicyHash" in rawManifest && typeof rawManifest.exclusionPolicyHash === "string"
                  ? rawManifest.exclusionPolicyHash
                  : undefined,
            }
          : undefined;
      const policyCompatibility = evaluateExclusionPolicyCompatibility(
        options.activePolicy,
        candidate
      );
      return unavailableTextIndexStatus("invalid", "manifest.json incompatível", undefined, policyCompatibility, "incomplete");
    }

    const manifest = rawManifest;

    const policyCompatibility = evaluateExclusionPolicyCompatibility(
      options.activePolicy,
      manifest
    );

    const notesResult = await readNotesIndexFile(app);
    if (notesResult.status !== "available") {
      const reason = notesResult.status === "missing" ? "ausente" : notesResult.reason;
      return unavailableTextIndexStatus("invalid", `notes.json ${reason}`, manifest, policyCompatibility, "incomplete");
    }

    if (!notesResult.notes.every(isIndexedNote)) {
      return unavailableTextIndexStatus("invalid", "notes.json incompatível", manifest, policyCompatibility, "incomplete");
    }

    const chunksResult = await readChunksIndexFile(app, true);
    if (chunksResult.status !== "available") {
      const reason = chunksResult.status === "missing" ? "ausente" : chunksResult.reason;
      return unavailableTextIndexStatus("invalid", `chunks.jsonl ${reason}`, manifest, policyCompatibility, "incomplete");
    }

    if (!chunksResult.chunks.every(isTextChunk)) {
      return unavailableTextIndexStatus("invalid", "chunks.jsonl incompatível", manifest, policyCompatibility, "incomplete");
    }

    if (
      (typeof manifest.totalNotes === "number" && manifest.totalNotes !== notesResult.notes.length)
      || (typeof manifest.totalChunks === "number" && manifest.totalChunks !== chunksResult.chunks.length)
    ) {
      return unavailableTextIndexStatus("invalid", "contagens do manifesto não correspondem aos artefactos", manifest, policyCompatibility, "count-mismatch");
    }

    let generationIntegrity: TextIndexGenerationIntegrity = "legacy";
    if (manifest.notesDigest !== undefined || manifest.chunksDigest !== undefined || manifest.generationId !== undefined) {
      if (manifest.notesDigest !== undefined) {
        const actualNotesDigest = computeTextArtifactDigest(notesResult.rawContent);
        if (actualNotesDigest !== manifest.notesDigest) {
          return unavailableTextIndexStatus("invalid", "digest do notes.json não corresponde ao manifesto", manifest, policyCompatibility, "digest-mismatch");
        }
      }
      if (manifest.chunksDigest !== undefined) {
        const actualChunksDigest = computeTextArtifactDigest(chunksResult.rawContent);
        if (actualChunksDigest !== manifest.chunksDigest) {
          return unavailableTextIndexStatus("invalid", "digest do chunks.jsonl não corresponde ao manifesto", manifest, policyCompatibility, "digest-mismatch");
        }
      }
      generationIntegrity = "verified";
    }

    const usability = options.expectedNotes && isTextIndexStale(notesResult.notes, options.expectedNotes)
      ? "stale"
      : "ready";

    return {
      exists: true,
      isUsable: true,
      usability,
      origin: "unknown",
      manifest,
      ...(manifest.provenance && isValidArtifactProvenance(manifest.provenance)
        ? { provenance: manifest.provenance }
        : {}),
      policyCompatibility,
      generationIntegrity,
      ...(manifest.generationId ? { generationId: manifest.generationId } : {}),
      totalNotes: notesResult.notes.length,
      totalChunks: chunksResult.chunks.length,
      excludedNotes: manifest.excludedNotes ?? 0,
    };
  } catch (error) {
    console.error("Error reading text index status:", error);
    return unavailableTextIndexStatus(
      "invalid",
      error instanceof Error ? error.message : "Erro ao ler o índice",
    );
  }
}
