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

type MatchKind = "word" | "prefix" | "substring";

interface TermMatchDetail {
  term: string;
  wordCount: number;
  prefixCount: number;
  substringCount: number;
}

interface TextMatchScore {
  score: number;
  matchedTerms: string[];
  details: TermMatchDetail[];
}

const DEFAULT_OPTIONS: SearchOptions = {
  maxResults: 30,
  maxChunksPerNote: 3,
};

export function normaliseSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
 * Separa texto normalizado em palavras alfanumericas.
 */
function tokenizeSearchWords(text: string): string[] {
  return normaliseSearchText(text).match(/[a-z0-9]+/g) ?? [];
}

function matchTermInWords(term: string, words: string[]): TermMatchDetail {
  const detail: TermMatchDetail = {
    term,
    wordCount: 0,
    prefixCount: 0,
    substringCount: 0,
  };

  for (const word of words) {
    if (word === term) {
      detail.wordCount++;
    } else if (word.startsWith(term)) {
      detail.prefixCount++;
    } else if (word.includes(term)) {
      detail.substringCount++;
    }
  }

  return detail;
}

function matchedTermsFromDetails(details: TermMatchDetail[]): string[] {
  return details
    .filter((detail) => detail.wordCount + detail.prefixCount + detail.substringCount > 0)
    .map((detail) => detail.term);
}

function scoreDetails(details: TermMatchDetail[], weights: Record<MatchKind, number>): number {
  return details.reduce((sum, detail) => {
    const wordScore = Math.min(detail.wordCount, 3) * weights.word;
    const prefixScore = Math.min(detail.prefixCount, 2) * weights.prefix;
    const substringScore = Math.min(detail.substringCount, 2) * weights.substring;
    return sum + wordScore + prefixScore + substringScore;
  }, 0);
}

function scoreTextMatches(
  terms: string[],
  text: string,
  weights: Record<MatchKind, number>
): TextMatchScore {
  const words = tokenizeSearchWords(text);
  const details = terms.map((term) => matchTermInWords(term, words));
  const matchedTerms = matchedTermsFromDetails(details);

  return {
    score: scoreDetails(details, weights),
    matchedTerms,
    details,
  };
}

function getFullWordMatchedTerms(details: TermMatchDetail[]): string[] {
  return details
    .filter((detail) => detail.wordCount > 0)
    .map((detail) => detail.term);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFullWordPhrase(text: string, normalisedQuery: string): boolean {
  const phrase = normalisedQuery
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  const pattern = new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`);
  return pattern.test(normaliseSearchText(text));
}

function hasHeadingMatch(text: string, fullWordTerms: string[]): boolean {
  if (fullWordTerms.length === 0) return false;

  const normalised = normaliseSearchText(text);
  const headingPattern = /(?:^|\s)#{1,6}\s+/g;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(normalised)) !== null) {
    const headingWindow = normalised.slice(match.index, match.index + 160);
    if (fullWordTerms.some((term) => new RegExp(`\\b${term}\\b`).test(headingWindow))) {
      return true;
    }
  }

  return false;
}

function hasYamlOrTagMatch(text: string, fullWordTerms: string[]): boolean {
  if (fullWordTerms.length === 0) return false;

  const normalised = normaliseSearchText(text);
  if (fullWordTerms.some((term) => new RegExp(`(?:^|\\s)#${term}\\b`).test(normalised))) {
    return true;
  }

  const yamlKeyPattern = /(?:^|\s)[a-z0-9_-]*(?:tags?|tipo|projeto|area|contexto|estado)[a-z0-9_-]*:\s*/g;
  let match: RegExpExecArray | null;

  while ((match = yamlKeyPattern.exec(normalised)) !== null) {
    const yamlWindow = normalised.slice(match.index, match.index + 180);
    if (fullWordTerms.some((term) => new RegExp(`\\b${term}\\b`).test(yamlWindow))) {
      return true;
    }
  }

  return false;
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
    return { score: 120, origin: "nome", matchedTerms: [...terms] };
  }

  // Verificar termos no nome
  const nameMatch = scoreTextMatches(terms, lowerBasename, {
    word: 34,
    prefix: 12,
    substring: 4,
  });
  const nameMatched = nameMatch.matchedTerms;
  const nameCoverage = totalTerms > 0 ? nameMatched.length / totalTerms : 0;

  // Verificar termos no caminho
  const pathMatch = scoreTextMatches(terms, lowerPath, {
    word: 16,
    prefix: 7,
    substring: 2,
  });
  const pathMatched = pathMatch.matchedTerms;
  const pathCoverage = totalTerms > 0 ? pathMatched.length / totalTerms : 0;

  // Todos os termos no nome: forte
  if (nameMatched.length === totalTerms) {
    const phraseBonus = hasFullWordPhrase(lowerBasename, normalisedQuery) ? 24 : 0;
    const coverageBonus = Math.round(14 * nameCoverage);
    return { score: nameMatch.score + phraseBonus + coverageBonus, origin: "nome", matchedTerms: nameMatched };
  }

  // Multiplos termos no nome: medio-alto (ajustado pela cobertura)
  if (nameMatched.length >= 2) {
    const score = Math.round(nameMatch.score + 10 * nameCoverage);
    return { score, origin: "nome", matchedTerms: nameMatched };
  }

  // Um termo no nome: moderado (nao ultrapassa matches no conteudo com varios termos)
  if (nameMatched.length === 1) {
    return { score: nameMatch.score, origin: "nome", matchedTerms: nameMatched };
  }

  // Match exato no caminho
  if (hasFullWordPhrase(lowerPath, normalisedQuery)) {
    return { score: pathMatch.score + 12, origin: "caminho", matchedTerms: pathMatched.length > 0 ? pathMatched : [...terms] };
  }

  // Termos no caminho
  if (pathMatched.length > 0) {
    const score = Math.round(pathMatch.score + 6 * pathCoverage);
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

  const terms = tokenizeSearchWords(normalisedQuery);
  if (terms.length === 0) {
    return [];
  }

  const totalTerms = terms.length;
  const results: SearchResult[] = [];

  // Criar mapa de nota para acesso rápido
  const notesByPath = new Map<string, IndexedNote>();
  for (const note of notes) {
    notesByPath.set(note.path.toLowerCase(), note);
  }

  // --- 1. Name/path matches ---
  for (const note of notes) {
    const lowerPath = normaliseSearchText(note.path);
    const lowerBasename = normaliseSearchText(note.basename);

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

    // Encontrar termos que correspondem ao texto do chunk
    const chunkMatch = scoreTextMatches(terms, lowerText, {
      word: 12,
      prefix: 5,
      substring: 1,
    });
    const chunkMatched = chunkMatch.matchedTerms;

    if (chunkMatched.length === 0) continue;

    let chunkScore = chunkMatch.score;

    // Frase exata encontrada (todos os termos como sequencia)
    if (hasFullWordPhrase(lowerText, normalisedQuery)) {
      chunkScore += 14;
    }

    const fullWordTerms = getFullWordMatchedTerms(chunkMatch.details);
    if (hasHeadingMatch(chunk.text, fullWordTerms)) {
      chunkScore += 22;
    }

    if (hasYamlOrTagMatch(chunk.text, fullWordTerms)) {
      chunkScore += 20;
    }

    const coverage = totalTerms > 0 ? chunkMatched.length / totalTerms : 0;
    chunkScore += Math.round(8 * coverage);

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
