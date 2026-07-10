import { App, Vault, TFile, normalizePath } from "obsidian";
import { ScannedNote } from "./noteScanner";
import { hashContent } from "./noteHasher";
import { Chunk } from "./chunker";

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
  embeddingsEnabled: false;
  updatedAt: string;
  totalNotes: number;
  totalChunks?: number;
  excludedNotes?: number;
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

async function writeJsonFile<T>(app: App, filePath: string, data: T): Promise<void> {
  const adapter = app.vault.adapter;
  const normalizedPath = normalizePath(filePath);
  const content = JSON.stringify(data, null, 2);

  try {
    const stat = await adapter.stat(normalizedPath);

    if (stat?.type === "folder") {
      throw new Error(`Existe uma pasta com o nome '${normalizedPath}' onde um ficheiro é esperado.`);
    }

    await adapter.write(normalizedPath, content);
  } catch (error) {
    await adapter.write(normalizedPath, content);
  }
}

const MANIFEST_INDEX_PATH = ".lina/index/manifest.json";
const NOTES_INDEX_PATH = ".lina/index/notes.json";
const CHUNKS_INDEX_PATH = ".lina/index/chunks.jsonl";
const CHUNKS_FILE = "chunks.jsonl";
const MAX_CHUNKS_FILE_BYTES = 50 * 1024 * 1024;
const MAX_INDEXED_CHUNKS_TO_LOAD = 100_000;
const warnedNotesIndexReadIssues = new Set<string>();
const warnedChunksIndexReadIssues = new Set<string>();
const warnedAutomaticUpdateReadinessIssues = new Set<string>();

type NotesIndexReadResult =
  | { status: "available"; notes: IndexedNote[] }
  | { status: "missing" }
  | { status: "unavailable"; reason: string };

type ChunksIndexReadResult =
  | { status: "available"; chunks: Chunk[] }
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

    return { status: "available", notes: parsed as IndexedNote[] };
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

    return { status: "available", chunks };
  } catch (error) {
    warnChunksIndexReadIssue("read-error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "unavailable", reason: "read-error" };
  }
}

async function writeJsonlFile<T>(app: App, filePath: string, data: T[]): Promise<void> {
  const adapter = app.vault.adapter;
  const normalizedPath = normalizePath(filePath);
  const content = data.map((item) => JSON.stringify(item)).join("\n");

  try {
    const stat = await adapter.stat(normalizedPath);

    if (stat?.type === "folder") {
      throw new Error(`Existe uma pasta com o nome '${normalizedPath}' onde um ficheiro JSONL é esperado.`);
    }
    await adapter.write(normalizedPath, content);
  } catch (error) {
    await adapter.write(normalizedPath, content);
  }
}

export async function saveTextIndex(
  app: App,
  indexedNotes: IndexedNote[],
  chunks: Chunk[],
  chunkingOptions: TextIndexManifest["chunking"],
  excludedNotes?: number,
  exclusionsInfo?: TextIndexManifest["exclusions"]
): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const linaFolderPath = ".lina";
    const indexFolderPath = ".lina/index";

    await ensureFolder(app, linaFolderPath);
    await ensureFolder(app, indexFolderPath);

    const manifest: TextIndexManifest = {
      version: 1,
      indexType: "text",
      embeddingsEnabled: false,
      updatedAt: now,
      totalNotes: indexedNotes.length,
      totalChunks: chunks.length,
      excludedNotes: excludedNotes ?? 0,
      chunking: chunkingOptions,
      exclusions: exclusionsInfo,
    };

    const manifestPath = normalizePath(`${indexFolderPath}/manifest.json`);
    const notesPath = normalizePath(`${indexFolderPath}/notes.json`);
    const chunksPath = normalizePath(`${indexFolderPath}/${CHUNKS_FILE}`);

    await writeJsonFile(app, manifestPath, manifest);
    await writeJsonFile(app, notesPath, indexedNotes);
    await writeJsonlFile(app, chunksPath, chunks);

    return true;
  } catch (error) {
    console.error("Error saving text index:", error);
    return false;
  }
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

    if (!manifest || manifest.indexType !== "text") {
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
  manifest?: TextIndexManifest;
  totalNotes?: number;
  totalChunks?: number;
  excludedNotes?: number;
  error?: string;
}

export async function readTextIndexStatus(app: App): Promise<TextIndexStatus> {
  try {
    const manifestPath = normalizePath(MANIFEST_INDEX_PATH);
    const adapter = app.vault.adapter;

    const manifestStat = await adapter.stat(manifestPath);
    if (!manifestStat || manifestStat.type === "folder") {
      return { exists: false };
    }

    const manifestContent = await adapter.read(manifestPath);
    const manifest = JSON.parse(manifestContent) as TextIndexManifest;

    let totalNotes = manifest.totalNotes || 0;
    let totalChunks = manifest.totalChunks || 0;
    let excludedNotes = manifest.excludedNotes || 0;

    const notesResult = await readNotesIndexFile(app);
    if (notesResult.status === "available") {
      totalNotes = notesResult.notes.length;
    }

    return {
      exists: true,
      manifest,
      totalNotes,
      totalChunks,
      excludedNotes,
    };
  } catch (error) {
    console.error("Error reading text index status:", error);
    return {
      exists: false,
      error: error instanceof Error ? error.message : "Erro ao ler o índice",
    };
  }
}
