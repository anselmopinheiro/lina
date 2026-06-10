import { Vault, TFile } from "obsidian";

export interface MarkdownNote {
  path: string;
  basename: string;
  extension: string;
  mtime: number;
}

/**
 * Devolve os ficheiros Markdown do vault, excluindo a pasta .obsidian/.
 */
export function getVaultMarkdownFiles(vault: Vault): TFile[] {
  return vault
    .getMarkdownFiles()
    .filter((file: TFile) => !file.path.startsWith(".obsidian/"));
}

/**
 * Percorre o vault e devolve uma lista de notas Markdown com metadados,
 * ignorando ficheiros dentro da pasta .obsidian.
 */
export function scanVault(vault: Vault): MarkdownNote[] {
  const files = getVaultMarkdownFiles(vault);

  return files.map((file: TFile) => ({
    path: file.path,
    basename: file.name.replace(/\.md$/, ""),
    extension: file.extension,
    mtime: file.stat.mtime,
  }));
}
