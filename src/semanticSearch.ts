import { IndexEntry } from "./indexStore";

/**
 * Calcula a similaridade cosseno entre dois vetores numéricos.
 * @param a - Primeiro vetor.
 * @param b - Segundo vetor.
 * @returns Valor entre 0 e 1 representando a similaridade.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Interface que representa um resultado de pesquisa semântica.
 */
export interface SemanticSearchResult {
  entry: IndexEntry;
  score: number;
}

/**
 * Pesquisa no índice usando similaridade cosseno com o embedding da query.
 * Apenas entradas com embedding válido e da mesma dimensão são consideradas.
 * @param entries - Lista de entradas do índice.
 * @param queryEmbedding - Embedding da frase de pesquisa.
 * @param limit - Número máximo de resultados (padrão: 10).
 * @returns Lista de resultados ordenados por similaridade descendente.
 */
export function searchSemanticIndex(
  entries: IndexEntry[],
  queryEmbedding: number[],
  limit: number = 10
): SemanticSearchResult[] {
  const queryDimension = queryEmbedding.length;

  const scored: SemanticSearchResult[] = [];

  for (const entry of entries) {
    // Ignorar entradas sem embedding ou com dimensão diferente
    if (!entry.embedding || entry.embedding.length !== queryDimension) continue;

    const score = cosineSimilarity(queryEmbedding, entry.embedding);

    // Ignorar similaridade zero ou negativa (caso limite improvável mas seguro)
    if (score <= 0) continue;

    scored.push({ entry, score });
  }

  // Ordenar por similaridade descendente
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}