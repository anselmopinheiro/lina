import { IndexedNote } from "../index/indexStore";
import { Chunk } from "../index/chunker";

export interface SearchResult {
  path: string;
  basename: string;
  snippet: string;
  score: number;
  origin: "nome" | "caminho" | "conteudo";
}

interface SearchOptions {
  maxResults?: number;
  maxChunksPerNote?: number;
}

const DEFAULT_OPTIONS: SearchOptions = {
  maxResults: 30,
  maxChunksPerNote: 3,
};

export function normaliseSearchText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function createSnippet(text: string, query: string, maxContext: number = 120): string {
  const lowerText = normaliseSearchText(text);
  const lowerQuery = normaliseSearchText(query);
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) {
    return text.substring(0, maxContext) + (text.length > maxContext ? "..." : "");
  }

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + lowerQuery.length + 40);
  let snippet = text.substring(start, end);

  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";

  return snippet;
}

/**
 * Highlight query terms in a text string for HTML display.
 */
export function highlightText(text: string, query: string): string {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(regex, '<mark style="background-color: var(--text-highlight-bg); color: inherit;">$1</mark>');
}

const ORIGIN_PRIORITY: Record<string, number> = { nome: 0, caminho: 1, conteudo: 2 };

export function searchTextIndex(
  notes: IndexedNote[],
  chunks: Chunk[],
  query: string,
  options?: SearchOptions
): SearchResult[] {
  const opts: Required<SearchOptions> = { ...DEFAULT_OPTIONS, ...options } as Required<SearchOptions>;
  const normalisedQuery = normaliseSearchText(query);

  if (normalisedQuery.length === 0) {
    return [];
  }

  const terms = normalisedQuery.split(/\s+/);
  const results: SearchResult[] = [];

  // Criar mapa de nota para acesso rápido
  const notesByPath = new Map<string, IndexedNote>();
  for (const note of notes) {
    notesByPath.set(note.path.toLowerCase(), note);
  }

  // --- 1. Name/path matches ---
  for (const note of notes) {
    const lowerPath = note.path.toLowerCase();
    const lowerBasename = note.basename.toLowerCase();
    let score = 0;
    let origin: SearchResult["origin"] = "nome";
    let snippet: string;

    // Match exato no basename (prioridade máxima)
    if (lowerBasename === normalisedQuery) {
      score = 100;
      origin = "nome";
      snippet = note.basename;
    }
    // Todos os termos correspondem ao basename
    else if (terms.every((t) => lowerBasename.includes(t))) {
      score = 50;
      origin = "nome";
      snippet = note.basename;
    }
    // Alguns termos correspondem ao basename
    else if (terms.some((t) => lowerBasename.includes(t))) {
      score = 20;
      origin = "nome";
      snippet = note.basename;
    }
    // Match exato no caminho
    else if (lowerPath.includes(normalisedQuery)) {
      score = 30;
      origin = "caminho";
      snippet = note.path;
    }
    // Alguns termos correspondem ao caminho
    else if (terms.some((t) => lowerPath.includes(t))) {
      score = 10;
      origin = "caminho";
      snippet = note.path;
    } else {
      // Sem match de nome/caminho — veremos nos chunks
      continue;
    }

    results.push({
      path: note.path,
      basename: note.basename,
      snippet,
      score,
      origin,
    });
  }

  // --- 2. Content matches from chunks ---
  const chunkMatchesByPath = new Map<string, { chunk: Chunk; score: number }[]>();

  for (const chunk of chunks) {
    const lowerPath = chunk.path.toLowerCase();
    const lowerText = normaliseSearchText(chunk.text);
    let chunkScore = 0;

    if (lowerText.includes(normalisedQuery)) {
      chunkScore += 25;
      if (terms.every((t) => lowerText.includes(t))) {
        chunkScore += 10;
      }
    } else if (terms.some((t) => lowerText.includes(t))) {
      chunkScore += 10;
    }

    if (chunkScore === 0) continue;

    if (!chunkMatchesByPath.has(lowerPath)) {
      chunkMatchesByPath.set(lowerPath, []);
    }
    chunkMatchesByPath.get(lowerPath)!.push({ chunk, score: chunkScore });
  }

  // Ordenar e limitar chunks por nota
  for (const [lowerPath, matches] of chunkMatchesByPath) {
    matches.sort((a, b) => b.score - a.score);
    const note = notesByPath.get(lowerPath);
    if (!note) continue;

    const maxChunks = opts.maxChunksPerNote;
    const toAdd = matches.slice(0, maxChunks);

    for (const match of toAdd) {
      results.push({
        path: note.path,
        basename: note.basename,
        snippet: createSnippet(match.chunk.text, normalisedQuery),
        score: match.score,
        origin: "conteudo",
      });
    }
  }

  // --- 3. Sort results: score descendente, origem (nome > caminho > conteudo), path ---
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const prioA = ORIGIN_PRIORITY[a.origin] ?? 0;
    const prioB = ORIGIN_PRIORITY[b.origin] ?? 0;
    if (prioA !== prioB) return prioA - prioB;
    return a.path.localeCompare(b.path);
  });

  return results.slice(0, opts.maxResults);
}