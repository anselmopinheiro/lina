import { IndexEntry } from "./indexStore";

export interface SearchResult {
  entry: IndexEntry;
  matchField: "basename" | "path" | "excerpt";
}

/**
 * Pesquisa entradas do índice por query (case-insensitive).
 *
 * Ordenação:
 *   1. correspondências em basename
 *   2. correspondências em path
 *   3. correspondências em excerpt
 *
 * Devolve no máximo 20 resultados.
 */
export function searchIndex(
  entries: IndexEntry[],
  query: string
): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const basenameMatches: SearchResult[] = [];
  const pathMatches: SearchResult[] = [];
  const excerptMatches: SearchResult[] = [];

  for (const entry of entries) {
    if (entry.basename.toLowerCase().includes(q)) {
      basenameMatches.push({ entry, matchField: "basename" });
    } else if (entry.path.toLowerCase().includes(q)) {
      pathMatches.push({ entry, matchField: "path" });
    } else if (entry.excerpt.toLowerCase().includes(q)) {
      excerptMatches.push({ entry, matchField: "excerpt" });
    }
  }

  const all = [
    ...basenameMatches,
    ...pathMatches,
    ...excerptMatches,
  ];

  return all.slice(0, 20);
}