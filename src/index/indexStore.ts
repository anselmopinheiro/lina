import { App, Vault, TFolder, TFile, normalizePath } from "obsidian";
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
  };
}

export async function createTextIndex(vault: Vault, scannedNotes: ScannedNote[]): Promise<IndexedNote[]> {
  const indexedNotes: IndexedNote[] = [];
  const now = new Date().toISOString();

  for (const note of scannedNotes) {
    try {
      const file = vault.getAbstractFileByPath(note.path);
      if (!file || file instanceof TFolder) {
        continue;
      }

      const content = await vault.read(file as TFile);
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
    } catch (error) {
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

const CHUNKS_FILE = "chunks.jsonl";

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
  try {
    const adapter = app.vault.adapter;
    const notesPath = normalizePath(".lina/index/notes.json");
    const stat = await adapter.stat(notesPath);
    if (!stat || stat.type === "folder") {
      return null;
    }
    const content = await adapter.read(notesPath);
    return JSON.parse(content) as IndexedNote[];
  } catch (error) {
    console.error("Error reading notes.json:", error);
    return null;
  }
}

export async function readIndexedChunks(app: App): Promise<Chunk[] | null> {
  try {
    const adapter = app.vault.adapter;
    const chunksPath = normalizePath(".lina/index/chunks.jsonl");
    const stat = await adapter.stat(chunksPath);
    if (!stat || stat.type === "folder") {
      return null;
    }
    const content = await adapter.read(chunksPath);
    const lines = content.trim().split("\n").filter((line) => line.length > 0);
    return lines.map((line) => JSON.parse(line) as Chunk);
  } catch (error) {
    console.error("Error reading chunks.jsonl:", error);
    return null;
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

    const notesPath = normalizePath(".lina/index/notes.json");
    let totalNotes = manifest.totalNotes || 0;
    let totalChunks = manifest.totalChunks || 0;
    let excludedNotes = manifest.excludedNotes || 0;

    const notesStat = await adapter.stat(notesPath);
    if (notesStat && notesStat.type === "file") {
      try {
        const notesContent = await adapter.read(notesPath);
        const notes = JSON.parse(notesContent) as IndexedNote[];
        totalNotes = notes.length;
      } catch (error) {
        console.warn("Error reading notes.json:", error);
      }
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
