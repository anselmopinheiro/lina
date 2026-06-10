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
