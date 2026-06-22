import { Chunk } from "../index/chunker";
import { EmbeddingRecord } from "../index/embeddingGenerator";

export interface SemanticSearchResult {
  path: string;
  basename: string;
  snippet: string;
  score: number;
  similarity: number;
  chunkId: string;
}

interface SemanticSearchOptions {
  maxResults?: number;
  maxResultsPerNote?: number;
  minSimilarity?: number;
}

const DEFAULT_OPTIONS: SemanticSearchOptions = {
  maxResults: 20,
  maxResultsPerNote: 3,
  minSimilarity: 0.25,
};

/**
 * Calcula similaridade cosseno entre dois vetores.
 * Devolve valor entre -1 e 1.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimensões incompatíveis: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Constrói um mapa path -> basename a partir dos chunks.
 */
function buildPathToName(chunks: Chunk[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of chunks) {
    if (!map.has(chunk.path)) {
      // Extrair basename do path
      const parts = chunk.path.replace(/\\/g, "/").split("/");
      const filename = parts[parts.length - 1] ?? chunk.path;
      // Remover extensão .md
      const basename = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
      map.set(chunk.path, basename);
    }
  }
  return map;
}

/**
 * Constrói um mapa chunkId -> Chunk para acesso rápido.
 */
function buildChunkMap(chunks: Chunk[]): Map<string, Chunk> {
  const map = new Map<string, Chunk>();
  for (const chunk of chunks) {
    map.set(chunk.chunkId, chunk);
  }
  return map;
}

export interface SemanticSearchResults {
  rawResults: SemanticSearchResult[];
  finalResults: SemanticSearchResult[];
  threshold: number;
  totalEmbeddingsEvaluated: number;
  validEmbeddingsCount: number;
}

/**
 * Pesquisa semântica: compara o embedding da query com todos os embeddings guardados.
 * Devolve resultados ordenados por semelhança decrescente.
 */
export function searchSemanticIndex(
  queryEmbedding: number[],
  embeddings: EmbeddingRecord[],
  chunks: Chunk[],
  options?: SemanticSearchOptions
): SemanticSearchResult[] {
  const opts: Required<SemanticSearchOptions> = {
    maxResults: DEFAULT_OPTIONS.maxResults!,
    maxResultsPerNote: DEFAULT_OPTIONS.maxResultsPerNote!,
    minSimilarity: DEFAULT_OPTIONS.minSimilarity!,
    ...options,
  } as Required<SemanticSearchOptions>;

  const chunkMap = buildChunkMap(chunks);
  const pathToName = buildPathToName(chunks);
  const results: SemanticSearchResult[] = [];
  const seenPaths = new Map<string, number>();

  for (const record of embeddings) {
    try {
      const similarity = cosineSimilarity(queryEmbedding, record.embedding);

      if (similarity < opts.minSimilarity) {
        continue;
      }

      const chunk = chunkMap.get(record.chunkId);
      const snippet = chunk ? chunk.text : "(chunk não encontrado)";
      const basename = pathToName.get(record.path) ?? record.path;

      results.push({
        path: record.path,
        basename,
        snippet: snippet.length > 280 ? snippet.substring(0, 280) + "..." : snippet,
        score: similarity,
        similarity,
        chunkId: record.chunkId,
      });
    } catch (error) {
      console.warn(`Erro ao processar embedding ${record.chunkId}:`, error);
    }
  }

  // Ordenar por semelhança decrescente
  results.sort((a, b) => b.similarity - a.similarity);

  // Aplicar limite por nota
  const filteredResults: SemanticSearchResult[] = [];
  for (const result of results) {
    const count = seenPaths.get(result.path) ?? 0;
    if (count >= opts.maxResultsPerNote) {
      continue;
    }
    seenPaths.set(result.path, count + 1);
    filteredResults.push(result);
  }

  return filteredResults.slice(0, opts.maxResults);
}

/**
 * Pesquisa semântica com diagnóstico: retorna resultados brutos e finais para análise.
 */
export function searchSemanticIndexWithDiagnostics(
  queryEmbedding: number[],
  embeddings: EmbeddingRecord[],
  chunks: Chunk[],
  options?: SemanticSearchOptions
): SemanticSearchResults {
  const opts: Required<SemanticSearchOptions> = {
    maxResults: DEFAULT_OPTIONS.maxResults!,
    maxResultsPerNote: DEFAULT_OPTIONS.maxResultsPerNote!,
    minSimilarity: DEFAULT_OPTIONS.minSimilarity!,
    ...options,
  } as Required<SemanticSearchOptions>;

  const chunkMap = buildChunkMap(chunks);
  const pathToName = buildPathToName(chunks);

  // Calcular todos os scores sem filtragem inicial
  const allResults: SemanticSearchResult[] = [];
  for (const record of embeddings) {
    try {
      const similarity = cosineSimilarity(queryEmbedding, record.embedding);
      const chunk = chunkMap.get(record.chunkId);
      const snippet = chunk ? chunk.text : "(chunk não encontrado)";
      const basename = pathToName.get(record.path) ?? record.path;

      allResults.push({
        path: record.path,
        basename,
        snippet: snippet.length > 280 ? snippet.substring(0, 280) + "..." : snippet,
        score: similarity,
        similarity,
        chunkId: record.chunkId,
      });
    } catch (error) {
      console.warn(`Erro ao processar embedding ${record.chunkId}:`, error);
    }
  }

  // Ordenar todos os resultados por semelhança decrescente
  allResults.sort((a, b) => b.similarity - a.similarity);

  // Aplicar threshold e limite por nota para resultados finais
  const seenPaths = new Map<string, number>();
  const filteredResults: SemanticSearchResult[] = [];

  for (const result of allResults) {
    if (result.similarity < opts.minSimilarity) {
      continue;
    }

    const count = seenPaths.get(result.path) ?? 0;
    if (count >= opts.maxResultsPerNote) {
      continue;
    }

    seenPaths.set(result.path, count + 1);
    filteredResults.push(result);
  }

  // Limitar resultados finais ao máximo configurado
  const finalResults = filteredResults.slice(0, opts.maxResults);

  // Contar embeddings válidos (com dimensão correta)
  const validEmbeddingsCount = embeddings.filter(e =>
    e.embedding && e.embedding.length === queryEmbedding.length
  ).length;

  return {
    rawResults: allResults.slice(0, 10), // Top 10 resultados brutos
    finalResults: finalResults,
    threshold: opts.minSimilarity,
    totalEmbeddingsEvaluated: embeddings.length,
    validEmbeddingsCount: validEmbeddingsCount
  };
}
