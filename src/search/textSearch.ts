import { IndexedNote } from "../index/indexStore";
import { Chunk } from "../index/chunker";

export interface SearchResult {
  path: string;
  basename: string;
  snippet: string;
  score: number;
  chunkId?: string;
  origin: "nome" | "caminho" | "conteudo";
  termCoverage?: number;      // proporcao de termos encontrados (0..1)
  termsFound?: string[];      // lista de termos que corresponderam
  totalTerms?: number;        // total de termos na query
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

/**
 * Determina que termos de uma query aparecem num texto normalizado.
 */
function findMatchingTerms(terms: string[], lowerText: string): string[] {
  return terms.filter((t) => lowerText.includes(t));
}

/**
 * Calcula pontuacao para match no nome/caminho com base no numero de termos.
 */
function calculateNameScore(
  terms: string[],
  normalisedQuery: string,
  lowerBasename: string,
  lowerPath: string
): { score: number; origin: SearchResult["origin"]; matchedTerms: string[] } {
  const totalTerms = terms.length;

  // Match exato no basename: todos os termos como frase exata
  if (lowerBasename === normalisedQuery) {
    return { score: 100, origin: "nome", matchedTerms: [...terms] };
  }

  // Verificar termos no nome
  const nameMatched = findMatchingTerms(terms, lowerBasename);
  const nameCoverage = totalTerms > 0 ? nameMatched.length / totalTerms : 0;

  // Verificar termos no caminho
  const pathMatched = findMatchingTerms(terms, lowerPath);
  const pathCoverage = totalTerms > 0 ? pathMatched.length / totalTerms : 0;

  // Todos os termos no nome: forte
  if (nameMatched.length === totalTerms) {
    return { score: 50, origin: "nome", matchedTerms: nameMatched };
  }

  // Multiplos termos no nome: medio-alto (ajustado pela cobertura)
  if (nameMatched.length >= 2) {
    const score = Math.round(15 + 25 * nameCoverage);
    return { score, origin: "nome", matchedTerms: nameMatched };
  }

  // Um termo no nome: moderado (nao ultrapassa matches no conteudo com varios termos)
  if (nameMatched.length === 1) {
    return { score: 8, origin: "nome", matchedTerms: nameMatched };
  }

  // Match exato no caminho
  if (lowerPath.includes(normalisedQuery)) {
    return { score: 30, origin: "caminho", matchedTerms: [...terms] };
  }

  // Termos no caminho
  if (pathMatched.length > 0) {
    const score = Math.round(5 + 15 * pathCoverage);
    return { score, origin: "caminho", matchedTerms: pathMatched };
  }

  return { score: 0, origin: "nome", matchedTerms: [] };
}

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
  const totalTerms = terms.length;
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

    const { score, origin, matchedTerms } = calculateNameScore(
      terms,
      normalisedQuery,
      lowerBasename,
      lowerPath
    );

    if (score === 0) continue;

    const coverage = totalTerms > 0 ? matchedTerms.length / totalTerms : 0;

    results.push({
      path: note.path,
      basename: note.basename,
      snippet: origin === "nome" ? note.basename : note.path,
      score,
      origin,
      termCoverage: coverage,
      termsFound: matchedTerms,
      totalTerms,
    });
  }

  // --- 2. Content matches from chunks ---
  const chunkMatchesByPath = new Map<string, { chunk: Chunk; score: number; matchedTerms: string[] }[]>();

  for (const chunk of chunks) {
    const lowerPath = chunk.path.toLowerCase();
    const lowerText = normaliseSearchText(chunk.text);
    let chunkScore = 0;

    // Encontrar termos que correspondem ao texto do chunk
    const chunkMatched = findMatchingTerms(terms, lowerText);

    if (chunkMatched.length === 0) continue;

    // Frase exata encontrada (todos os termos como sequencia)
    if (lowerText.includes(normalisedQuery)) {
      chunkScore += 25;
    }

    // Bonus por cada termo encontrado (ate 15 pontos adicionais para 3+ termos)
    const termBonus = Math.min(chunkMatched.length * 8, 25);
    chunkScore += termBonus;

    if (!chunkMatchesByPath.has(lowerPath)) {
      chunkMatchesByPath.set(lowerPath, []);
    }
    chunkMatchesByPath.get(lowerPath)!.push({ chunk, score: chunkScore, matchedTerms: chunkMatched });
  }

  // Ordenar e limitar chunks por nota
  for (const [lowerPath, matches] of chunkMatchesByPath) {
    matches.sort((a, b) => b.score - a.score);
    const note = notesByPath.get(lowerPath);
    if (!note) continue;

    const maxChunks = opts.maxChunksPerNote;
    const toAdd = matches.slice(0, maxChunks);

    for (const match of toAdd) {
      const coverage = totalTerms > 0 ? match.matchedTerms.length / totalTerms : 0;

      results.push({
        path: note.path,
        basename: note.basename,
        snippet: createSnippet(match.chunk.text, normalisedQuery),
        score: match.score,
        chunkId: match.chunk.chunkId,
        origin: "conteudo",
        termCoverage: coverage,
        termsFound: match.matchedTerms,
        totalTerms,
      });
    }
  }

  // --- 3. Sort results: score descendente, cobertura de termos, origem (nome > caminho > conteudo), path ---
  results.sort((a, b) => {
    // Se scores diferentes, ordenar por score
    if (b.score !== a.score) return b.score - a.score;

    // Se scores iguais, usar cobertura de termos (mais termos primeiro)
    const covA = a.termCoverage ?? 0;
    const covB = b.termCoverage ?? 0;
    if (covB !== covA) return covB - covA;

    const prioA = ORIGIN_PRIORITY[a.origin] ?? 0;
    const prioB = ORIGIN_PRIORITY[b.origin] ?? 0;
    if (prioA !== prioB) return prioA - prioB;

    return a.path.localeCompare(b.path);
  });

  return results.slice(0, opts.maxResults);
}