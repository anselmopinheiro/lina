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
  // Embedding experimental (Fase 2D)
  embedding?: number[];
  embeddingModel?: string;
  embeddingDimension?: number;
  embeddedAt?: number;
}

export interface IndexData {
  version: number;
  entries: IndexEntry[];
}

export interface IncrementalUpdateResult {
  indexData: IndexData;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
}

/**
 * Cria ou recria o índice a partir do vault,
 * lendo o conteúdo de cada nota para extrair excerto e contagens.
 * Preserva embeddings do índice anterior para notas não alteradas.
 * @param vault - Vault do Obsidian.
 * @param previousIndex - Índice anterior (opcional), usado para reaproveitar embeddings.
 */
export async function buildIndex(vault: Vault, previousIndex?: IndexData): Promise<IndexData> {
  const files = getVaultMarkdownFiles(vault);
  const now = Date.now();

  // Criar um mapa path->entry do índice anterior para pesquisa rápida
  const previousMap = new Map<string, IndexEntry>();
  if (previousIndex) {
    for (const entry of previousIndex.entries) {
      previousMap.set(entry.path, entry);
    }
  }

  const entries: IndexEntry[] = [];

  for (const file of files) {
    const content = await vault.read(file);
    const analysis = analyzeContent(content);

    const newEntry: IndexEntry = {
      path: file.path,
      basename: file.name.replace(/\.md$/, ""),
      extension: file.extension,
      mtime: file.stat.mtime,
      indexedAt: now,
      ...analysis,
      contentUpdatedAt: now,
    };

    // Tentar preservar embedding do índice anterior
    const previousEntry = previousMap.get(file.path);
    if (previousEntry) {
      preserveEmbeddingIfUnchanged(newEntry, previousEntry);
    }

    entries.push(newEntry);
  }

  return {
    version: 2,
    entries,
  };
}

/**
 * Atualiza o índice de forma incremental, lendo apenas notas novas ou alteradas.
 * Se não existir índice anterior, cria um índice novo sem embeddings.
 * @param vault - Vault do Obsidian.
 * @param previousIndex - Índice anterior (opcional).
 */
export async function updateIndexIncrementally(
  vault: Vault,
  previousIndex?: IndexData
): Promise<IncrementalUpdateResult> {
  if (!previousIndex || previousIndex.entries.length === 0) {
    const indexData = await buildIndex(vault);
    return {
      indexData,
      addedCount: indexData.entries.length,
      updatedCount: 0,
      removedCount: 0,
    };
  }

  const files = getVaultMarkdownFiles(vault);
  const now = Date.now();
  const previousMap = new Map<string, IndexEntry>();
  const currentFileMap = new Map<string, (typeof files)[number]>();

  for (const entry of previousIndex.entries) {
    previousMap.set(entry.path, entry);
  }

  for (const file of files) {
    currentFileMap.set(file.path, file);
  }

  const entries: IndexEntry[] = [];
  let addedCount = 0;
  let updatedCount = 0;

  for (const file of files) {
    const previousEntry = previousMap.get(file.path);

    if (!previousEntry) {
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
      addedCount++;
      continue;
    }

    if (previousEntry.mtime !== file.stat.mtime) {
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
      updatedCount++;
      continue;
    }

    entries.push(previousEntry);
  }

  let removedCount = 0;
  for (const previousEntry of previousIndex.entries) {
    if (!currentFileMap.has(previousEntry.path)) {
      removedCount++;
    }
  }

  return {
    indexData: {
      version: previousIndex.version,
      entries,
    },
    addedCount,
    updatedCount,
    removedCount,
  };
}

/**
 * Preserva campos de embedding de uma entrada anterior se a nota não tiver sido alterada.
 * @param newEntry - Nova entrada do índice (modificada inline se o embedding for preservado).
 * @param previousEntry - Entrada do índice anterior.
 */
function preserveEmbeddingIfUnchanged(newEntry: IndexEntry, previousEntry: IndexEntry): void {
  // Só preservar se mtime for igual (nota não alterada)
  if (newEntry.mtime !== previousEntry.mtime) return;

  // Só preservar se existir embedding válido no índice anterior
  if (!previousEntry.embedding || previousEntry.embedding.length === 0) return;
  if (!previousEntry.embeddingModel) return;
  if (!previousEntry.embeddingDimension || previousEntry.embeddingDimension <= 0) return;
  if (!previousEntry.embeddedAt) return;

  // Preservar todos os campos de embedding
  newEntry.embedding = previousEntry.embedding;
  newEntry.embeddingModel = previousEntry.embeddingModel;
  newEntry.embeddingDimension = previousEntry.embeddingDimension;
  newEntry.embeddedAt = previousEntry.embeddedAt;
}

/**
 * Retorna estatísticas básicas sobre os embeddings no índice.
 * @returns { total: número total de entradas, withEmbedding: número de entradas com embedding válido }
 */
export function getEmbeddingStats(indexData: IndexData): { total: number; withEmbedding: number } {
  const total = indexData.entries.length;
  const withEmbedding = indexData.entries.filter((e) => e.embedding && e.embedding.length > 0).length;
  return { total, withEmbedding };
}

/**
 * Encontra entradas do índice que ainda não têm embedding para o modelo atual.
 * @param indexData - Dados do índice.
 * @param embeddingModel - Nome do modelo de embeddings atual.
 * @param limit - Número máximo de entradas a retornar.
 * @returns Array de entradas que precisam de embedding.
 */
export function findEntriesMissingEmbeddings(
  indexData: IndexData,
  embeddingModel: string,
  limit: number = 10
): IndexEntry[] {
  return indexData.entries
    .filter((entry) => {
      // Não tem embedding ou tem embedding de um modelo diferente
      return !entry.embedding || entry.embedding.length === 0 || entry.embeddingModel !== embeddingModel;
    })
    .slice(0, limit);
}

/**
 * Atualiza uma entrada do índice com dados de embedding.
 * @param indexData - Dados do índice (modificado inline).
 * @param path - Caminho da entrada a atualizar.
 * @param embedding - Vetor de embedding.
 * @param model - Modelo usado para gerar o embedding.
 * @param dimension - Dimensão do embedding.
 */
export function updateEntryEmbedding(
  indexData: IndexData,
  path: string,
  embedding: number[],
  model: string,
  dimension: number
): void {
  const entry = indexData.entries.find((e) => e.path === path);
  if (entry) {
    entry.embedding = embedding;
    entry.embeddingModel = model;
    entry.embeddingDimension = dimension;
    entry.embeddedAt = Date.now();
  }
}
