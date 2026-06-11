import { App, Vault, TFolder, TFile, normalizePath } from "obsidian";
import { ScannedNote } from "./noteScanner";
import { hashContent } from "./noteHasher";

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

      const content = await vault.read(file as any);
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
      // if stat throws an error, it means path doesn't exist, so create it
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
    // if stat throws an error, it means path doesn't exist, so write it
    await adapter.write(normalizedPath, content);
  }
}

export async function saveTextIndex(app: App, indexedNotes: IndexedNote[]): Promise<boolean> {
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
    };

    const manifestPath = normalizePath(`${indexFolderPath}/manifest.json`);
    const notesPath = normalizePath(`${indexFolderPath}/notes.json`);

    await writeJsonFile(app, manifestPath, manifest);
    await writeJsonFile(app, notesPath, indexedNotes);

    return true;
  } catch (error) {
    console.error("Error saving text index:", error);
    return false;
  }
}

export interface TextIndexStatus {
  exists: boolean;
  manifest?: TextIndexManifest;
  totalNotes?: number;
  error?: string;
}

export async function readTextIndexStatus(app: App): Promise<TextIndexStatus> {
  try {
    const manifestPath = normalizePath(".lina/index/manifest.json");
    const adapter = app.vault.adapter;

    // Check if .lina/index/manifest.json exists and is a file
    const manifestStat = await adapter.stat(manifestPath);
    if (!manifestStat || manifestStat.type === "folder") {
      return { exists: false };
    }

    const manifestContent = await adapter.read(manifestPath);
    const manifest = JSON.parse(manifestContent) as TextIndexManifest;

    const notesPath = normalizePath(".lina/index/notes.json");
    let totalNotes = manifest.totalNotes || 0;

    // Check if .lina/index/notes.json exists and is a file
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
    };
  } catch (error) {
    console.error("Error reading text index status:", error);
    return {
      exists: false,
      error: error instanceof Error ? error.message : "Erro ao ler o índice",
    };
  }
}
