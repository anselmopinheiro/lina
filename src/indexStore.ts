import { Vault } from "obsidian";
import { scanVault } from "./vaultScanner";

export interface IndexEntry {
  path: string;
  basename: string;
  extension: string;
  mtime: number;
  indexedAt: number;
}

export interface IndexData {
  version: number;
  entries: IndexEntry[];
}

/**
 * Cria ou recria o índice a partir do vault,
 * anotando cada entrada com o timestamp atual.
 */
export function buildIndex(vault: Vault): IndexData {
  const notes = scanVault(vault);
  const now = Date.now();

  const entries: IndexEntry[] = notes.map((note) => ({
    ...note,
    indexedAt: now,
  }));

  return {
    version: 1,
    entries,
  };
}