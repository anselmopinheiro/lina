import { Vault, TFile } from "obsidian";

export interface ScannedNote {
  path: string;
  basename: string;
  extension: string;
  size: number;
  mtime: number;
}

export async function scanVaultForNotes(vault: Vault): Promise<ScannedNote[]> {
  const markdownFiles = vault.getMarkdownFiles();
  const notes: ScannedNote[] = [];

  for (const file of markdownFiles) {
    // Excluir ficheiros dentro de .lina/
    if (file.path.startsWith(".lina/")) {
      continue;
    }

    // Excluir ficheiros dentro de .obsidian/
    if (file.path.startsWith(".obsidian/")) {
      continue;
    }

    notes.push({
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      size: file.stat.size,
      mtime: file.stat.mtime,
    });
  }

  return notes;
}