import { App, normalizePath } from "obsidian";
import { Chunk } from "../index/chunker";
import { EmbeddingRecord, generateSingleEmbedding } from "../index/embeddingGenerator";
import { IndexedNote } from "../index/indexStore";
import { SearchResult, searchTextIndex } from "./textSearch";
import { SemanticSearchResult, searchSemanticIndex } from "./semanticSearch";

export interface HybridSearchConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  textWeight: number;
  semanticWeight: number;
}

export interface HybridSearchResult {
  path: string;
  basename: string;
  snippet: string;
  chunkId?: string;
  source: "textual" | "semantica" | "hibrida";
  textOrigin?: SearchResult["origin"];
  textScore?: number;
  semanticSimilarity?: number;
  finalScore: number;
}

export interface HybridSearchRunResult {
  results: HybridSearchResult[];
  warnings: string[];
  semanticUsed: boolean;
}

interface LoadEmbeddingsResult {
  embeddings: EmbeddingRecord[] | null;
  exists: boolean;
}

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_RESULTS_PER_NOTE = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function normaliseTextScores(results: SearchResult[]): Map<string, number> {
  const maxScore = Math.max(...results.map((result) => result.score), 0);
  const normalised = new Map<string, number>();

  for (const result of results) {
    const key = getResultKey(result.path, result.chunkId, result.origin);
    const score = maxScore > 0 ? (result.score / maxScore) * 100 : 0;
    normalised.set(key, roundScore(score));
  }

  return normalised;
}

function normaliseSemanticScore(similarity: number): number {
  return roundScore(similarity * 100);
}

function getResultKey(path: string, chunkId?: string, origin?: string): string {
  return `${normalizePath(path)}::${chunkId ?? origin ?? "note"}`;
}

async function loadEmbeddings(app: App): Promise<LoadEmbeddingsResult> {
  try {
    const adapter = app.vault.adapter;
    const path = normalizePath(".lina/index/embeddings.jsonl");
    const stat = await adapter.stat(path);
    if (!stat || stat.type !== "file") {
      return { embeddings: null, exists: false };
    }

    const content = await adapter.read(path);
    const lines = content.trim().split("\n").filter((line) => line.length > 0);
    const embeddings: EmbeddingRecord[] = [];

    for (const line of lines) {
      try {
        embeddings.push(JSON.parse(line) as EmbeddingRecord);
      } catch {
        // Ignorar linhas inválidas.
      }
    }

    return { embeddings, exists: true };
  } catch {
    return { embeddings: null, exists: false };
  }
}

function chooseSnippet(textResult?: SearchResult, semanticResult?: SemanticSearchResult): string {
  return textResult?.snippet ?? semanticResult?.snippet ?? "";
}

function chooseSource(textResult?: SearchResult, semanticResult?: SemanticSearchResult): HybridSearchResult["source"] {
  if (textResult && semanticResult) return "hibrida";
  if (textResult) return "textual";
  return "semantica";
}

function combineResults(
  textResults: SearchResult[],
  semanticResults: SemanticSearchResult[],
  textWeight: number,
  semanticWeight: number
): HybridSearchResult[] {
  const combined = new Map<string, { textResult?: SearchResult; semanticResult?: SemanticSearchResult }>();
  const normalisedTextScores = normaliseTextScores(textResults);

  for (const textResult of textResults) {
    const key = getResultKey(textResult.path, textResult.chunkId, textResult.origin);
    combined.set(key, { ...combined.get(key), textResult });
  }

  for (const semanticResult of semanticResults) {
    const key = getResultKey(semanticResult.path, semanticResult.chunkId, "conteudo");
    combined.set(key, { ...combined.get(key), semanticResult });
  }

  const mergedResults: HybridSearchResult[] = [];

  for (const entry of combined.values()) {
    const textResult = entry.textResult;
    const semanticResult = entry.semanticResult;
    const textScore = textResult
      ? normalisedTextScores.get(getResultKey(textResult.path, textResult.chunkId, textResult.origin)) ?? 0
      : undefined;
    const semanticScore = semanticResult ? normaliseSemanticScore(semanticResult.similarity) : undefined;
    const finalScore = roundScore((textScore ?? 0) * textWeight + (semanticScore ?? 0) * semanticWeight);
    const path = textResult?.path ?? semanticResult?.path ?? "";
    const basename = textResult?.basename ?? semanticResult?.basename ?? path;

    mergedResults.push({
      path,
      basename,
      snippet: chooseSnippet(textResult, semanticResult),
      chunkId: textResult?.chunkId ?? semanticResult?.chunkId,
      source: chooseSource(textResult, semanticResult),
      textOrigin: textResult?.origin,
      textScore,
      semanticSimilarity: semanticScore,
      finalScore,
    });
  }

  mergedResults.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if ((b.textScore ?? 0) !== (a.textScore ?? 0)) return (b.textScore ?? 0) - (a.textScore ?? 0);
    if ((b.semanticSimilarity ?? 0) !== (a.semanticSimilarity ?? 0)) return (b.semanticSimilarity ?? 0) - (a.semanticSimilarity ?? 0);
    return a.path.localeCompare(b.path);
  });

  const perNoteCount = new Map<string, number>();
  const limited: HybridSearchResult[] = [];

  for (const result of mergedResults) {
    const current = perNoteCount.get(result.path) ?? 0;
    if (current >= DEFAULT_MAX_RESULTS_PER_NOTE) {
      continue;
    }

    perNoteCount.set(result.path, current + 1);
    limited.push(result);

    if (limited.length >= DEFAULT_MAX_RESULTS) {
      break;
    }
  }

  return limited;
}

export async function runHybridSearch(
  app: App,
  notes: IndexedNote[],
  chunks: Chunk[],
  query: string,
  config: HybridSearchConfig
): Promise<HybridSearchRunResult> {
  const warnings: string[] = [];

  const textResults = searchTextIndex(notes, chunks, query, {
    maxResults: 40,
    maxChunksPerNote: DEFAULT_MAX_RESULTS_PER_NOTE,
  });

  const loaded = await loadEmbeddings(app);
  if (!loaded.exists || !loaded.embeddings || loaded.embeddings.length === 0) {
    warnings.push("Embeddings locais indisponíveis. A pesquisa foi feita apenas no índice textual.");
    return {
      results: combineResults(textResults, [], config.textWeight, config.semanticWeight),
      warnings,
      semanticUsed: false,
    };
  }

  const queryEmbedding = await generateSingleEmbedding(config.baseUrl, config.model, query, config.timeoutMs);
  if (!queryEmbedding) {
    warnings.push("Não foi possível usar a pesquisa semântica. Foram apresentados resultados textuais.");
    return {
      results: combineResults(textResults, [], config.textWeight, config.semanticWeight),
      warnings,
      semanticUsed: false,
    };
  }

  const expectedDim = loaded.embeddings[0]?.dimensions ?? 0;
  if (expectedDim > 0 && queryEmbedding.length !== expectedDim) {
    warnings.push("Embeddings locais indisponíveis. A pesquisa foi feita apenas no índice textual.");
    return {
      results: combineResults(textResults, [], config.textWeight, config.semanticWeight),
      warnings,
      semanticUsed: false,
    };
  }

  const semanticResults = searchSemanticIndex(queryEmbedding, loaded.embeddings, chunks, {
    maxResults: 30,
    maxResultsPerNote: DEFAULT_MAX_RESULTS_PER_NOTE,
  });

  return {
    results: combineResults(textResults, semanticResults, config.textWeight, config.semanticWeight),
    warnings,
    semanticUsed: true,
  };
}