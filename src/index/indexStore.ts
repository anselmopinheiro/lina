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

const NOTES_INDEX_PATH = ".lina/index/notes.json";
const CHUNKS_FILE = "chunks.jsonl";
const MAX_CHUNKS_FILE_BYTES = 50 * 1024 * 1024;
const MAX_INDEXED_CHUNKS_TO_LOAD = 100_000;
const warnedNotesIndexReadIssues = new Set<string>();

type NotesIndexReadResult =
  | { status: "available"; notes: IndexedNote[] }
  | { status: "missing" }
  | { status: "unavailable"; reason: string };

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
  const chunksPath = normalizePath(".lina/index/chunks.jsonl");

  try {
    const adapter = app.vault.adapter;
    const stat = await adapter.stat(chunksPath);
    if (!stat || stat.type === "folder") {
      return null;
    }

    if (stat.size > MAX_CHUNKS_FILE_BYTES) {
      console.warn("Lina: chunks index file is too large to load safely.", {
        path: chunksPath,
        size: stat.size,
        limit: MAX_CHUNKS_FILE_BYTES,
      });
      return [];
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
        stoppedAtLimit = true;
        break;
      }
    }

    if (invalidLines > 0) {
      console.warn("Lina: ignored invalid JSON lines while reading chunks index.", {
        path: chunksPath,
        invalidLines,
      });
    }

    if (stoppedAtLimit) {
      console.warn("Lina: stopped loading chunks index after reaching the safety limit.", {
        path: chunksPath,
        limit: MAX_INDEXED_CHUNKS_TO_LOAD,
      });
    }

    return chunks;
  } catch (error) {
    console.warn("Lina: failed to read chunks index safely.", {
      path: chunksPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
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
    const manifestPath = normalizePath(".lina/index/manifest.json");
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
