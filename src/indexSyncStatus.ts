import { Vault } from "obsidian";
import { IndexData, IndexEntry } from "./indexStore";
import { scanVault, MarkdownNote } from "./vaultScanner";

export interface IndexSyncStatus {
  totalVaultNotes: number;
  totalIndexedNotes: number;
  newNotes: MarkdownNote[];
  changedNotes: IndexEntry[];
  removedNotes: IndexEntry[];
  notesWithoutEmbedding: IndexEntry[];
  outdatedEmbeddings: IndexEntry[];
}

/**
 * Compara o estado atual do vault com o índice guardado e calcula o estado de sincronização.
 * Não altera o índice nem gera embeddings.
 * @param vault - Vault do Obsidian.
 * @param indexData - Índice atual do plugin.
 * @returns Estado de sincronização do índice.
 */
export function getIndexSyncStatus(vault: Vault, indexData?: IndexData): IndexSyncStatus {
  const currentVaultNotes = scanVault(vault);
  const currentVaultMap = new Map<string, MarkdownNote>();
  for (const note of currentVaultNotes) {
    currentVaultMap.set(note.path, note);
  }

  const indexedMap = new Map<string, IndexEntry>();
  if (indexData) {
    for (const entry of indexData.entries) {
      indexedMap.set(entry.path, entry);
    }
  }

  const newNotes: MarkdownNote[] = [];
  const changedNotes: IndexEntry[] = [];
  const removedNotes: IndexEntry[] = [];
  const notesWithoutEmbedding: IndexEntry[] = [];
  const outdatedEmbeddings: IndexEntry[] = [];

  if (!indexData) {
    return {
      totalVaultNotes: currentVaultNotes.length,
      totalIndexedNotes: 0,
      newNotes,
      changedNotes,
      removedNotes,
      notesWithoutEmbedding,
      outdatedEmbeddings,
    };
  }

  // Iterar sobre as notas atuais do vault para encontrar novas e alteradas
  for (const currentNote of currentVaultNotes) {
    const indexedEntry = indexedMap.get(currentNote.path);

    if (!indexedEntry) {
      // Nota nova: existe no vault mas não no índice
      newNotes.push(currentNote);
    } else {
      // Nota existente: verificar se foi alterada
      if (currentNote.mtime !== indexedEntry.mtime) {
        changedNotes.push(indexedEntry);
      }

      // Verificar embeddings
      if (!indexedEntry.embedding || indexedEntry.embedding.length === 0) {
        notesWithoutEmbedding.push(indexedEntry);
      }

      if (
        indexedEntry.embedding &&
        indexedEntry.embedding.length > 0 &&
        currentNote.mtime !== indexedEntry.mtime
      ) {
        outdatedEmbeddings.push(indexedEntry);
      }
    }
  }

  // Iterar sobre o índice para encontrar notas removidas
  for (const indexedEntry of indexData.entries) {
    if (!currentVaultMap.has(indexedEntry.path)) {
      removedNotes.push(indexedEntry);
    }
  }

  return {
    totalVaultNotes: currentVaultNotes.length,
    totalIndexedNotes: indexData?.entries.length || 0,
    newNotes,
    changedNotes,
    removedNotes,
    notesWithoutEmbedding,
    outdatedEmbeddings,
  };
}
