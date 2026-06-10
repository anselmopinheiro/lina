import { Vault, TFile } from "obsidian";

export interface MarkdownNote {
  path: string;
  basename: string;
  extension: string;
  mtime: number;
}

/**
 * Percorre o vault e devolve uma lista de notas Markdown,
 * ignorando ficheiros dentro da pasta .obsidian.
 */
export function scanVault(vault: Vault): MarkdownNote[] {
  const files = vault.getMarkdownFiles();

  return files
    .filter((file: TFile) => !file.path.startsWith(".obsidian/"))
    .map((file: TFile) => ({
      path: file.path,
      basename: file.name.replace(/\.md$/, ""),
      extension: file.extension,
      mtime: file.stat.mtime,
    }));
}