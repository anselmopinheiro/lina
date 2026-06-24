import { App, normalizePath } from "obsidian";
import { Chunk } from "../index/chunker";
import { EmbeddingRecord, generateSingleEmbedding, readEmbeddingStatus, getPrefixModeForModel, applyEmbeddingPrefix } from "../index/embeddingGenerator";
import {
  getLocalEmbeddingsProvider,
  getLocalEmbeddingsModel,
} from "../settings";
import { IndexedNote } from "../index/indexStore";
import { SearchResult, searchTextIndex } from "./textSearch";
import { SemanticSearchResult, searchSemanticIndex, VISIBLE_SEMANTIC_THRESHOLD } from "./semanticSearch";

export interface HybridSearchConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  textWeight: number;
  semanticWeight: number;
  deviceProvider?: string;
  deviceModel?: string;
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
  termCoverage?: number;
  termsFound?: string[];
  totalTerms?: number;
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

export interface SemanticCompatibility {
  available: boolean;
  reason?: string;
  indexProvider?: string;
  indexModel?: string;
  indexDimensions?: number;
  deviceProvider?: string;
  deviceModel?: string;
}

export async function getSemanticSearchAvailability(
  app: App,
  deviceProvider: string,
  deviceModel: string
): Promise<SemanticCompatibility> {
  try {
    const status = await readEmbeddingStatus(app);
    if (!status || !status.exists || status.totalEmbeddings === 0) {
      return {
        available: false,
        reason: "Embeddings não existem ou estão vazios.",
      };
    }

    const indexProvider = status.provider;
    const indexModel = status.model;
    const indexDimensions = status.dimensions;

    if (!indexProvider || !indexModel || indexDimensions === 0) {
      return {
        available: false,
        reason: "Metadados dos embeddings do índice estão incompletos.",
        indexProvider,
        indexModel,
        indexDimensions,
        deviceProvider,
        deviceModel,
      };
    }

    if (indexProvider !== deviceProvider || indexModel !== deviceModel) {
      return {
        available: false,
        reason: "Provider ou modelo do dispositivo não é compatível com o índice.",
        indexProvider,
        indexModel,
        indexDimensions,
        deviceProvider,
        deviceModel,
      };
    }

    return {
      available: true,
      indexProvider,
      indexModel,
      indexDimensions,
      deviceProvider,
      deviceModel,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      reason: `Erro ao verificar compatibilidade: ${msg}`,
      deviceProvider,
      deviceModel,
    };
  }
}

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_RESULTS_PER_NOTE = 3;
const HYBRID_TEXT_WEIGHT = 0.45;
const HYBRID_SEMANTIC_WEIGHT = 0.55;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

/**
 * Conjunto de termos curtos e fracos que nunca devem contribuir
 * para a componente textual da pesquisa híbrida, para evitar ruído
 * como matches parciais dentro de outras palavras (ex: "ir" dentro de "diretor").
 * Inclui todos os termos com 2 caracteres ou menos, mais algumas
 * preposições/verbos comuns de 3 caracteres que geram falso positivo.
 */
const HYBRID_STOP_TERMS = new Set([
  // 1-2 caracteres: nunca relevantes para a componente textual da híbrida
  "a","e","o","em","de","do","da","ao","os","as","um","na","no","ne",
  "se","te","me","lhe","ou","ir","ei","ai","oi","eu","tu","ele","ela",
  "nos","vos","lhe","lhes","su","tu","si","ja","já","so","só","ma","me",
  "te","se","lhe","lhes","que","com","por","pra","pro","num","numa",
  "pela","pelo","pelas","pelos","aos","nas","nos","num","numa","nums",
  "mas","mais","dos","das","numas","dum","duma","duns","dumas",
  // 3 caracteres que geram ruído frequente
  "ser","ter","dar","vir","ver","vai","foi","sao","são","esta","este",
  "pode","tem","têm","for","era","sua","seu","seus","suas",
  "mas","num","numa","que","por","pra","pro",
  "ate","até","sob","sem","aos","nas","nos","dum","duma",
  "cada","todo","toda","mais","menos","bem","mal","sim","nao","não",
  "como","para","sobre","entre","ainda","apenas","depois","antes",
  "desde","durante","mediante","conforme","consoante",
]);

/**
 * Prepara a query para uso na componente textual da pesquisa híbrida:
 * - Remove termos com menos de 3 caracteres
 * - Remove termos da lista HYBRID_STOP_TERMS
 * - Remove termos que são apenas stopwords portuguesas
 * Isto evita que a pesquisa textual dentro da híbrida gere ruído
 * com matches parciais (ex: "ir" dentro de "diretor").
 */
function prepareHybridTextQuery(query: string): string {
  const terms = query.toLowerCase().trim().split(/\s+/);
  const filtered = terms.filter(t => {
    if (t.length < 3) return false;
    if (HYBRID_STOP_TERMS.has(t)) return false;
    return true;
  });
  return filtered.join(' ');
}

/**
 * Normaliza a pontuacao textual de forma a evitar que matches fracos
 * (ex: 1 termo em 3 no nome) sejam inflacionados para perto de 100.
 *
 * Estrategia:
 * - A normalizacao maxima usa como referencia o score mais alto, mas
 *   aplica um fator de atenuacao para que scores baixos nao subam muito.
 * - Se o score bruto for inferior a 20, a normalizacao e limitada.
 * - A cobertura de termos (termCoverage) tambem influencia: notas com
 *   pouca cobertura recebem penalidade adicional.
 */
function normaliseTextScores(results: SearchResult[]): Map<string, number> {
  const maxScore = Math.max(...results.map((result) => result.score), 0);
  const normalised = new Map<string, number>();

  for (const result of results) {
    const key = getResultKey(result.path, result.chunkId, result.origin);
    let score: number;

    if (maxScore > 0) {
      // Proporcao base: o score bruto em relacao ao maximo
      const rawRatio = result.score / maxScore;

      // Normalizacao conservadora: apenas scores altos recebem valores altos
      if (result.score < 15 || maxScore <= 15) {
        score = 0;
      } else if (maxScore < 30) {
        score = rawRatio * 60;
      } else {
        score = rawRatio * 100;
      }

      // Penalizar fortemente resultados que apenas correspondem a stopwords
      const matchedTerms = result.termsFound ?? [];
      const nonStopTerms = matchedTerms.filter(t => !HYBRID_STOP_TERMS.has(t));
      if (nonStopTerms.length === 0 && matchedTerms.length > 0) {
        score = 0;
      }

      score = Math.min(score, 100);
    } else {
      score = 0;
    }

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
  // Usar nota (path) como chave unica para garantir que resultados
  // apenas semânticos ou apenas textuais sao preservados na fusao.
  const byNote = new Map<string, { textResult?: SearchResult; semanticResult?: SemanticSearchResult }>();
  const normalisedTextScores = normaliseTextScores(textResults);

  for (const textResult of textResults) {
    const key = normalizePath(textResult.path);
    const existing = byNote.get(key);
    if (!existing) {
      byNote.set(key, { textResult });
    } else {
      const currentScore = existing.textResult?.score ?? 0;
      if ((textResult.score ?? 0) > currentScore) {
        existing.textResult = textResult;
      }
    }
  }

  for (const semanticResult of semanticResults) {
    const key = normalizePath(semanticResult.path);
    const existing = byNote.get(key);
    if (!existing) {
      byNote.set(key, { semanticResult });
    } else {
      const currentSim = existing.semanticResult?.similarity ?? 0;
      if ((semanticResult.similarity ?? 0) > currentSim) {
        existing.semanticResult = semanticResult;
      }
    }
  }

  const mergedResults: HybridSearchResult[] = [];

  for (const entry of byNote.values()) {
    const textResult = entry.textResult;
    const semanticResult = entry.semanticResult;
  const textScore = textResult
      ? normalisedTextScores.get(getResultKey(textResult.path, textResult.chunkId, textResult.origin)) ?? 0
      : undefined;
    const semanticScore = semanticResult ? normaliseSemanticScore(semanticResult.similarity) : undefined;
    const hasText = (textScore ?? 0) > 0;
    const hasSem = (semanticScore ?? 0) > 0;

    // Formula ajustada para nao penalizar resultados apenas semanticos:
    // - texto + semantica: fusao ponderada (text*0.45 + sem*0.55)
    // - texto apenas: textNorm * 0.45 (ligeira reducao)
    // - semantica apenas: semNorm (sem reducao artificial)
    let finalScore: number;
    if (hasText && hasSem) {
      // Ambos: fusao ponderada
      const textNorm = (textScore ?? 0) / 100;
      const semNorm = (semanticScore ?? 0) / 100;
      finalScore = roundScore((textNorm * HYBRID_TEXT_WEIGHT + semNorm * HYBRID_SEMANTIC_WEIGHT) * 100);
    } else if (hasText) {
      // Apenas textual: reduzido pelo peso textual
      finalScore = roundScore((textScore! / 100) * HYBRID_TEXT_WEIGHT * 100);
    } else if (hasSem) {
      // Apenas semantico: mantem o valor sem reducao artificial
      finalScore = semanticScore!;
    } else {
      finalScore = 0;
    }
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
      termCoverage: textResult?.termCoverage,
      termsFound: textResult?.termsFound,
      totalTerms: textResult?.totalTerms,
    });
  }

  mergedResults.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if ((b.textScore ?? 0) !== (a.textScore ?? 0)) return (b.textScore ?? 0) - (a.textScore ?? 0);
    if ((b.semanticSimilarity ?? 0) !== (a.semanticSimilarity ?? 0)) return (b.semanticSimilarity ?? 0) - (a.semanticSimilarity ?? 0);
    return a.path.localeCompare(b.path);
  });

  const limited: HybridSearchResult[] = [];
  const perNoteCount = new Map<string, number>();

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

  // Preparar a query para a componente textual: remover termos curtos,
  // stopwords e termos que apenas geram ruido (ex: "ir" dentro de "diretor").
  const hybridTextQuery = prepareHybridTextQuery(query);
  const textResults = hybridTextQuery
    ? searchTextIndex(notes, chunks, hybridTextQuery, {
        maxResults: 40,
        maxChunksPerNote: DEFAULT_MAX_RESULTS_PER_NOTE,
      })
    : [];

  // Verificar compatibilidade semântica antes de tentar gerar embedding da query
  const deviceProvider = (getLocalEmbeddingsProvider() || config.deviceProvider || "ollama").toLowerCase();
  const deviceModel = getLocalEmbeddingsModel() || config.deviceModel || config.model;
  const textWeight = HYBRID_TEXT_WEIGHT;
  const semanticWeight = HYBRID_SEMANTIC_WEIGHT;
  const compatibility = await getSemanticSearchAvailability(app, deviceProvider, deviceModel);
  if (!compatibility.available) {
    warnings.push(
      `A componente semântica da pesquisa híbrida não está disponível. ` +
      `Foram usados apenas resultados textuais. ` +
      `Motivo: ${compatibility.reason || "incompatibilidade de embeddings."}`
    );
    return {
      results: combineResults(textResults, [], textWeight, semanticWeight),
      warnings,
      semanticUsed: false,
    };
  }

  const loaded = await loadEmbeddings(app);
  if (!loaded.exists || !loaded.embeddings || loaded.embeddings.length === 0) {
    warnings.push("A componente semântica da pesquisa híbrida não está disponível. Foram usados apenas resultados textuais.");
    return {
      results: combineResults(textResults, [], textWeight, semanticWeight),
      warnings,
      semanticUsed: false,
    };
  }

  const prefixMode = getPrefixModeForModel(config.model);
  const prefixedQuery = applyEmbeddingPrefix(query, prefixMode, true);
  const queryEmbedding = await generateSingleEmbedding(config.baseUrl, config.model, prefixedQuery, config.timeoutMs);
  if (!queryEmbedding) {
    warnings.push("A componente semântica da pesquisa híbrida não está disponível. Foram usados apenas resultados textuais.");
    return {
      results: combineResults(textResults, [], textWeight, semanticWeight),
      warnings,
      semanticUsed: false,
    };
  }

  const expectedDim = loaded.embeddings[0]?.dimensions ?? 0;
  if (expectedDim > 0 && queryEmbedding.length !== expectedDim) {
    warnings.push("A componente semântica da pesquisa híbrida não está disponível. Foram usados apenas resultados textuais.");
    return {
      results: combineResults(textResults, [], textWeight, semanticWeight),
      warnings,
      semanticUsed: false,
    };
  }

  const semanticResults = searchSemanticIndex(queryEmbedding, loaded.embeddings, chunks, {
    maxResults: 30,
    maxResultsPerNote: DEFAULT_MAX_RESULTS_PER_NOTE,
    minSimilarity: VISIBLE_SEMANTIC_THRESHOLD,
  });

  return {
    results: combineResults(textResults, semanticResults, textWeight, semanticWeight),
    warnings,
    semanticUsed: true,
  };
}
