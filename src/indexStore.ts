import { Vault } from "obsidian";
import { getVaultMarkdownFiles } from "./vaultScanner";
import { analyzeContent } from "./contentExtractor";

export interface IndexEntry {
  path: string;
  basename: string;
  extension: string;
  mtime: number;
  indexedAt: number;
  excerpt: string;
  charCount: number;
  wordCount: number;
  contentUpdatedAt: number;
}

export interface IndexData {
  version: number;
  entries: IndexEntry[];
}

/**
 * Cria ou recria o índice a partir do vault,
 * lendo o conteúdo de cada nota para extrair excerto e contagens.
 */
export async function buildIndex(vault: Vault): Promise<IndexData> {
  const files = getVaultMarkdownFiles(vault);
  const now = Date.now();

  const entries: IndexEntry[] = [];

  for (const file of files) {
    const content = await vault.read(file);
    const analysis = analyzeContent(content);

    entries.push({
      path: file.path,
      basename: file.name.replace(/\.md$/, ""),
      extension: file.extension,
      mtime: file.stat.mtime,
      indexedAt: now,
      ...analysis,
      contentUpdatedAt: now,
    });
  }

  return {
    version: 2,
    entries,
  };
}