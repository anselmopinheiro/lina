import { Vault, TFolder, TFile } from "obsidian";
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

export async function saveTextIndex(vault: Vault, indexedNotes: IndexedNote[]): Promise<boolean> {
  try {
    const now = new Date().toISOString();

    // Garantir que a pasta .lina/index/ existe
    const linaFolder = vault.getAbstractFileByPath(".lina");
    if (!linaFolder) {
      await vault.createFolder(".lina");
    }

    const indexFolder = vault.getAbstractFileByPath(".lina/index");
    if (!indexFolder) {
      await vault.createFolder(".lina/index");
    }

    // Guardar manifest.json
    const manifest: TextIndexManifest = {
      version: 1,
      indexType: "text",
      embeddingsEnabled: false,
      updatedAt: now,
      totalNotes: indexedNotes.length,
    };

    const manifestPath = ".lina/index/manifest.json";
    const manifestFile = vault.getAbstractFileByPath(manifestPath);
    if (manifestFile && !(manifestFile instanceof TFolder)) {
      await vault.modify(manifestFile as TFile, JSON.stringify(manifest, null, 2));
    } else {
      await vault.create(manifestPath, JSON.stringify(manifest, null, 2));
    }

    // Guardar notes.json
    const notesPath = ".lina/index/notes.json";
    const notesFile = vault.getAbstractFileByPath(notesPath);
    if (notesFile && !(notesFile instanceof TFolder)) {
      await vault.modify(notesFile as TFile, JSON.stringify(indexedNotes, null, 2));
    } else {
      await vault.create(notesPath, JSON.stringify(indexedNotes, null, 2));
    }

    return true;
  } catch (error) {
    console.error("Error saving text index:", error);
    return false;
  }
}