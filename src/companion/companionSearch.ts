/**
 * Companion Search Read-Only Query Layer (Phase 0.4.1)
 *
 * Provides a dedicated query execution layer for Companion devices to search
 * synchronized vault artifacts safely and efficiently.
 *
 * Core Architectural Invariants:
 * - Read-Only Query Delegation: Consumes synchronized artifacts without running local index updates.
 * - Non-Blocking Search Usability: Stale, future, or unknown provenance never blocks queries.
 * - Missing Embedding Resilience: Gracefully falls back to textual search when embeddings are unavailable.
 * - Zero Side Effects: Zero writes, zero manifest modifications, zero worker invocations, and zero ownership changes.
 */

import { type IndexedNote } from "../index/indexStore";
import { type Chunk } from "../index/chunker";
import { type EmbeddingRecord } from "../index/embeddingGenerator";
import { type SearchResult, searchTextIndex } from "../search/textSearch";
import {
  type SemanticSearchResult,
  searchSemanticIndex,
  searchRuntimeSemanticIndex,
  VISIBLE_SEMANTIC_THRESHOLD,
} from "../search/semanticSearch";
import { type RuntimeEmbeddingIndex } from "../search/runtimeEmbeddingIndex";
import {
  type CompanionArtifactConsumptionState,
  type ArtifactFreshness,
  type CompanionConsumptionMode,
} from "./companionConsumptionState";
import { type ArtifactProvenanceStatus } from "../device/artifactProvenanceValidation";

export type CompanionSearchMode = "auto" | "text" | "semantic";

export interface CompanionSearchOptions {
  readonly maxResults?: number;
  readonly maxChunksPerNote?: number;
  readonly minSimilarity?: number;
}

export interface CompanionSearchInput {
  /** The text search query string. */
  readonly query: string;

  /** Synchronized text index notes. */
  readonly notes: readonly IndexedNote[];

  /** Synchronized text index chunks. */
  readonly chunks: readonly Chunk[];

  /** Validated artifact consumption state (optional). */
  readonly consumptionState?: CompanionArtifactConsumptionState;

  /** Requested search mode ("auto", "text", or "semantic"). Defaults to "auto". */
  readonly mode?: CompanionSearchMode;

  /** Precomputed vector embedding for the query (required for semantic search). */
  readonly queryEmbedding?: ArrayLike<number>;

  /** Fast runtime binary vector index (optional). */
  readonly runtimeIndex?: RuntimeEmbeddingIndex | null;

  /** JSONL embedding records (optional fallback if runtime index is absent). */
  readonly embeddings?: readonly EmbeddingRecord[] | null;

  /** Additional search options (result limits, similarity threshold). */
  readonly options?: CompanionSearchOptions;
}

export interface CompanionQueryResult<T> {
  readonly query: string;
  readonly canConsume: boolean;
  readonly consumptionMode: CompanionConsumptionMode;
  readonly provenanceValidity: ArtifactProvenanceStatus;
  readonly artifactFreshness: ArtifactFreshness;
  readonly searchModeUsed: "text" | "semantic" | "none";
  readonly results: readonly T[];
  readonly warnings: readonly string[];
  readonly totalResults: number;
}

export type CompanionSearchResult = CompanionQueryResult<SearchResult | SemanticSearchResult>;

/**
 * Executes a read-only text search over synchronized index notes and chunks.
 */
export function executeCompanionTextSearch(
  input: {
    query: string;
    notes: readonly IndexedNote[];
    chunks: readonly Chunk[];
    consumptionState?: CompanionArtifactConsumptionState;
    options?: CompanionSearchOptions;
  }
): CompanionQueryResult<SearchResult> {
  const query = input.query.trim();
  const warnings: string[] = [];

  const canConsume = input.consumptionState ? input.consumptionState.canConsume : input.notes.length > 0;
  const consumptionMode = input.consumptionState ? input.consumptionState.consumptionMode : (input.notes.length > 0 ? "text-only" : "unavailable");
  const provenanceValidity = input.consumptionState ? input.consumptionState.provenanceValidity : "unknown";
  const artifactFreshness = input.consumptionState ? input.consumptionState.artifactFreshness : (input.notes.length > 0 ? "unknown" : "missing");

  if (!canConsume && input.notes.length === 0) {
    warnings.push("O índice de texto não está disponível para consumo.");
    return {
      query,
      canConsume: false,
      consumptionMode: "unavailable",
      provenanceValidity,
      artifactFreshness: "missing",
      searchModeUsed: "none",
      results: [],
      warnings,
      totalResults: 0,
    };
  }

  if (query.length === 0) {
    return {
      query,
      canConsume,
      consumptionMode,
      provenanceValidity,
      artifactFreshness,
      searchModeUsed: "text",
      results: [],
      warnings,
      totalResults: 0,
    };
  }

  const results = searchTextIndex(
    input.notes as IndexedNote[],
    input.chunks as Chunk[],
    query,
    {
      maxResults: input.options?.maxResults,
      maxChunksPerNote: input.options?.maxChunksPerNote,
    }
  );

  return {
    query,
    canConsume,
    consumptionMode,
    provenanceValidity,
    artifactFreshness,
    searchModeUsed: "text",
    results,
    warnings,
    totalResults: results.length,
  };
}

/**
 * Executes a read-only semantic vector search over synchronized embeddings.
 */
export function executeCompanionSemanticSearch(
  input: {
    query: string;
    queryEmbedding?: ArrayLike<number>;
    runtimeIndex?: RuntimeEmbeddingIndex | null;
    embeddings?: readonly EmbeddingRecord[] | null;
    chunks: readonly Chunk[];
    consumptionState?: CompanionArtifactConsumptionState;
    options?: CompanionSearchOptions;
  }
): CompanionQueryResult<SemanticSearchResult> {
  const query = input.query.trim();
  const warnings: string[] = [];

  const canConsume = input.consumptionState ? input.consumptionState.canConsume : true;
  const consumptionMode = input.consumptionState ? input.consumptionState.consumptionMode : "full";
  const provenanceValidity = input.consumptionState ? input.consumptionState.provenanceValidity : "unknown";
  const artifactFreshness = input.consumptionState ? input.consumptionState.artifactFreshness : "unknown";

  if (!input.queryEmbedding || input.queryEmbedding.length === 0) {
    warnings.push("Nenhum embedding de query fornecido para pesquisa semântica.");
    return {
      query,
      canConsume,
      consumptionMode,
      provenanceValidity,
      artifactFreshness,
      searchModeUsed: "none",
      results: [],
      warnings,
      totalResults: 0,
    };
  }

  const minSimilarity = input.options?.minSimilarity ?? VISIBLE_SEMANTIC_THRESHOLD;
  const maxResults = input.options?.maxResults;
  const maxResultsPerNote = input.options?.maxChunksPerNote;

  // 1. Try fast binary runtime index
  if (input.runtimeIndex && input.runtimeIndex.count > 0) {
    if (input.queryEmbedding.length !== input.runtimeIndex.dimensions) {
      warnings.push(
        `Dimensão da query (${input.queryEmbedding.length}) incompatível com índice binário (${input.runtimeIndex.dimensions}).`
      );
      return {
        query,
        canConsume,
        consumptionMode,
        provenanceValidity,
        artifactFreshness,
        searchModeUsed: "none",
        results: [],
        warnings,
        totalResults: 0,
      };
    }

    const results = searchRuntimeSemanticIndex(
      input.queryEmbedding,
      input.runtimeIndex,
      input.chunks as Chunk[],
      {
        maxResults,
        maxResultsPerNote,
        minSimilarity,
      }
    );

    return {
      query,
      canConsume,
      consumptionMode,
      provenanceValidity,
      artifactFreshness,
      searchModeUsed: "semantic",
      results,
      warnings,
      totalResults: results.length,
    };
  }

  // 2. Fallback to JSONL embedding records
  if (input.embeddings && input.embeddings.length > 0) {
    const results = searchSemanticIndex(
      Array.from(input.queryEmbedding),
      input.embeddings as EmbeddingRecord[],
      input.chunks as Chunk[],
      {
        maxResults,
        maxResultsPerNote,
        minSimilarity,
      }
    );

    return {
      query,
      canConsume,
      consumptionMode,
      provenanceValidity,
      artifactFreshness,
      searchModeUsed: "semantic",
      results,
      warnings,
      totalResults: results.length,
    };
  }

  warnings.push("Nenhum vetor de embeddings disponível para pesquisa semântica.");
  return {
    query,
    canConsume,
    consumptionMode,
    provenanceValidity,
    artifactFreshness,
    searchModeUsed: "none",
    results: [],
    warnings,
    totalResults: 0,
  };
}

/**
 * Unified Companion search entry point.
 *
 * Automatically delegates to semantic or textual search based on requested mode
 * and artifact availability, falling back seamlessly to text search if embeddings
 * are absent.
 */
export function executeCompanionSearch(
  input: CompanionSearchInput
): CompanionSearchResult {
  const mode = input.mode ?? "auto";

  // Case 1: Explicit Semantic Search requested
  if (mode === "semantic") {
    return executeCompanionSemanticSearch({
      query: input.query,
      queryEmbedding: input.queryEmbedding,
      runtimeIndex: input.runtimeIndex,
      embeddings: input.embeddings,
      chunks: input.chunks,
      consumptionState: input.consumptionState,
      options: input.options,
    });
  }

  // Case 2: Auto Mode with available query embedding & vector storage
  if (mode === "auto" && input.queryEmbedding && input.queryEmbedding.length > 0) {
    const hasBinary = Boolean(input.runtimeIndex && input.runtimeIndex.count > 0);
    const hasJsonl = Boolean(input.embeddings && input.embeddings.length > 0);
    const embeddingsEnabled = input.consumptionState ? input.consumptionState.embeddingState.available : (hasBinary || hasJsonl);

    if (embeddingsEnabled && (hasBinary || hasJsonl)) {
      const semanticResult = executeCompanionSemanticSearch({
        query: input.query,
        queryEmbedding: input.queryEmbedding,
        runtimeIndex: input.runtimeIndex,
        embeddings: input.embeddings,
        chunks: input.chunks,
        consumptionState: input.consumptionState,
        options: input.options,
      });

      if (semanticResult.searchModeUsed === "semantic") {
        return semanticResult;
      }
    }
  }

  // Case 3: Text Search (Default fallback)
  return executeCompanionTextSearch({
    query: input.query,
    notes: input.notes,
    chunks: input.chunks,
    consumptionState: input.consumptionState,
    options: input.options,
  });
}
