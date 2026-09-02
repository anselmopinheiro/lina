/**
 * Companion Local Delta Search Foundation (Phase 0.4.4)
 *
 * Enables Companion devices to search recent unindexed note creations and
 * modifications on-the-fly without modifying persistent index files.
 *
 * Core Architectural Invariants:
 * - In-Memory Ephemeral Execution: Zero writes to `.lina/index/notes.json` or `.lina/index/chunks.jsonl`.
 * - Zero Side Effects: Zero writes, zero renames, zero deletes, zero worker invocations, and zero ownership mutations.
 * - Single Search Engine: Directly leverages the existing `searchTextIndex` algorithm from `src/search/textSearch.ts`.
 * - Text-Only Delta: Delta notes are searched via fast text matching only; no vector embeddings are generated on Companion.
 * - Result Fusion & Precedence: Local delta search hits override stale index hits for modified notes, and deleted notes are suppressed.
 */

import { normalizePath } from "obsidian";
import { type IndexedNote } from "../index/indexStore";
import { type Chunk, chunkText } from "../index/chunker";
import { hashContent } from "../index/noteHasher";
import { type SearchResult, searchTextIndex } from "../search/textSearch";
import { type ScannedNote } from "../index/noteScanner";

export type LocalDeltaType = "created" | "modified";

export interface LocalDeltaNote {
  readonly path: string;
  readonly basename: string;
  readonly extension: string;
  readonly size: number;
  readonly mtime: number;
  readonly content: string;
  readonly contentHash: string;
  readonly deltaType: LocalDeltaType;
}

export interface LocalDeltaScanResult {
  readonly createdNotes: readonly LocalDeltaNote[];
  readonly modifiedNotes: readonly LocalDeltaNote[];
  readonly deletedPaths: ReadonlySet<string>;
  readonly unchangedCount: number;
  readonly totalDeltaNotes: number;
}

export interface LocalDeltaSearchState {
  readonly ephemeralNotes: readonly IndexedNote[];
  readonly ephemeralChunks: readonly Chunk[];
  readonly deltaTypeByPath: ReadonlyMap<string, LocalDeltaType>;
}

export interface FusedSearchResultItem {
  readonly result: SearchResult;
  readonly source: "index" | "local-delta";
  readonly isTemporary: boolean;
  readonly deltaType?: LocalDeltaType;
}

export interface FusedSearchRunResult {
  readonly query: string;
  readonly results: readonly FusedSearchResultItem[];
  readonly totalResults: number;
  readonly indexResultCount: number;
  readonly deltaResultCount: number;
  readonly warnings: readonly string[];
}

export interface DetectLocalDeltaInput {
  readonly scannedNotes: readonly ScannedNote[];
  readonly indexedNotes: readonly IndexedNote[];
  readonly readContent: (path: string) => Promise<string | null>;
}

export interface BuildLocalDeltaSearchStateOptions {
  readonly chunkSize?: number;
  readonly overlap?: number;
}

export interface SearchOptions {
  readonly maxResults?: number;
  readonly maxChunksPerNote?: number;
}

/**
 * Detects local note differences (creations, modifications, deletions) between the
 * live vault and the published index.
 */
export async function detectLocalDelta(
  input: DetectLocalDeltaInput
): Promise<LocalDeltaScanResult> {
  const indexedMap = new Map<string, IndexedNote>();
  for (const indexed of input.indexedNotes) {
    indexedMap.set(normalizePath(indexed.path), indexed);
  }

  const createdNotes: LocalDeltaNote[] = [];
  const modifiedNotes: LocalDeltaNote[] = [];
  const scannedPaths = new Set<string>();
  let unchangedCount = 0;

  for (const scanned of input.scannedNotes) {
    const normalized = normalizePath(scanned.path);
    scannedPaths.add(normalized);
    const indexed = indexedMap.get(normalized);

    if (!indexed) {
      // Note is newly created locally
      const content = await input.readContent(scanned.path);
      if (content !== null) {
        createdNotes.push({
          path: scanned.path,
          basename: scanned.basename,
          extension: scanned.extension,
          size: scanned.size,
          mtime: scanned.mtime,
          content,
          contentHash: hashContent(content),
          deltaType: "created",
        });
      }
      continue;
    }

    // Check if modified (different size or modified time)
    if (scanned.mtime !== indexed.mtime || scanned.size !== indexed.size) {
      const content = await input.readContent(scanned.path);
      if (content !== null) {
        const contentHash = hashContent(content);
        if (contentHash !== indexed.contentHash) {
          modifiedNotes.push({
            path: scanned.path,
            basename: scanned.basename,
            extension: scanned.extension,
            size: scanned.size,
            mtime: scanned.mtime,
            content,
            contentHash,
            deltaType: "modified",
          });
          continue;
        }
      }
    }

    unchangedCount++;
  }

  // Detect deleted notes (present in index, but absent from scanned vault)
  const deletedPaths = new Set<string>();
  for (const indexed of input.indexedNotes) {
    const normalized = normalizePath(indexed.path);
    if (!scannedPaths.has(normalized)) {
      deletedPaths.add(normalized);
    }
  }

  return {
    createdNotes,
    modifiedNotes,
    deletedPaths,
    unchangedCount,
    totalDeltaNotes: createdNotes.length + modifiedNotes.length,
  };
}

/**
 * Builds temporary in-memory searchable structures (`IndexedNote[]` and `Chunk[]`)
 * from detected delta notes.
 */
export function buildLocalDeltaSearchState(
  deltaScan: LocalDeltaScanResult,
  options?: BuildLocalDeltaSearchStateOptions
): LocalDeltaSearchState {
  const ephemeralNotes: IndexedNote[] = [];
  const ephemeralChunks: Chunk[] = [];
  const deltaTypeByPath = new Map<string, LocalDeltaType>();
  const now = new Date().toISOString();

  const allDeltaNotes = [...deltaScan.createdNotes, ...deltaScan.modifiedNotes];

  for (const delta of allDeltaNotes) {
    const normalized = normalizePath(delta.path);
    deltaTypeByPath.set(normalized, delta.deltaType);

    ephemeralNotes.push({
      path: delta.path,
      basename: delta.basename,
      extension: delta.extension,
      size: delta.size,
      mtime: delta.mtime,
      contentHash: delta.contentHash,
      indexedAt: now,
    });

    const chunks = chunkText(delta.path, delta.content, {
      chunkSize: options?.chunkSize,
      overlap: options?.overlap,
    });
    ephemeralChunks.push(...chunks);
  }

  return {
    ephemeralNotes,
    ephemeralChunks,
    deltaTypeByPath,
  };
}

/**
 * Executes a text search over the ephemeral delta structures.
 */
export function executeLocalDeltaSearch(
  query: string,
  deltaState: LocalDeltaSearchState,
  options?: SearchOptions
): SearchResult[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0 || deltaState.ephemeralNotes.length === 0) {
    return [];
  }

  return searchTextIndex(
    deltaState.ephemeralNotes as IndexedNote[],
    deltaState.ephemeralChunks as Chunk[],
    trimmedQuery,
    options
  );
}

/**
 * Merges and deduplicates results from the published index and the local delta search.
 *
 * Rules:
 * - If a note was modified in local delta, the delta result overrides any index result for that note.
 * - If a note was deleted locally, any index result for that note is suppressed.
 * - Each result is clearly tagged with its origin (`source: "index" | "local-delta"`).
 */
export function fuseSearchResults(
  indexResults: readonly SearchResult[],
  deltaResults: readonly SearchResult[],
  deletedPaths: ReadonlySet<string> = new Set(),
  modifiedPaths: ReadonlySet<string> = new Set(),
  options?: SearchOptions
): FusedSearchResultItem[] {
  const fused: FusedSearchResultItem[] = [];
  const normalizedDeleted = new Set(Array.from(deletedPaths).map(p => normalizePath(p)));
  const normalizedModified = new Set(Array.from(modifiedPaths).map(p => normalizePath(p)));

  // 1. Add all delta results (these represent the freshest state for new & modified notes)
  for (const deltaRes of deltaResults) {
    const normalizedPath = normalizePath(deltaRes.path);
    if (normalizedDeleted.has(normalizedPath)) {
      continue;
    }
    const isModified = normalizedModified.has(normalizedPath);
    fused.push({
      result: deltaRes,
      source: "local-delta",
      isTemporary: true,
      deltaType: isModified ? "modified" : "created",
    });
  }

  // 2. Add published index results (excluding deleted or modified notes)
  for (const indexRes of indexResults) {
    const normalizedPath = normalizePath(indexRes.path);
    if (normalizedDeleted.has(normalizedPath) || normalizedModified.has(normalizedPath)) {
      // Suppress stale index hit
      continue;
    }

    fused.push({
      result: indexRes,
      source: "index",
      isTemporary: false,
    });
  }

  // 3. Sort fused results by score descending, term coverage, origin, and path
  fused.sort((a, b) => {
    if (b.result.score !== a.result.score) {
      return b.result.score - a.result.score;
    }
    const covA = a.result.termCoverage ?? 0;
    const covB = b.result.termCoverage ?? 0;
    if (covB !== covA) {
      return covB - covA;
    }
    return a.result.path.localeCompare(b.result.path);
  });

  const maxResults = options?.maxResults ?? 30;
  return fused.slice(0, maxResults);
}

export interface CompanionSearchWithDeltaInput {
  readonly query: string;
  readonly scannedNotes: readonly ScannedNote[];
  readonly indexedNotes: readonly IndexedNote[];
  readonly indexedChunks: readonly Chunk[];
  readonly readContent: (path: string) => Promise<string | null>;
  readonly options?: SearchOptions;
}

/**
 * End-to-end entry point that performs delta detection, index query, delta query,
 * and result fusion in a single, safe, read-only operation.
 */
export async function executeCompanionSearchWithDelta(
  input: CompanionSearchWithDeltaInput
): Promise<FusedSearchRunResult> {
  const query = input.query.trim();
  const warnings: string[] = [];

  if (query.length === 0) {
    return {
      query,
      results: [],
      totalResults: 0,
      indexResultCount: 0,
      deltaResultCount: 0,
      warnings,
    };
  }

  // 1. Detect local delta
  const deltaScan = await detectLocalDelta({
    scannedNotes: input.scannedNotes,
    indexedNotes: input.indexedNotes,
    readContent: input.readContent,
  });

  // 2. Build ephemeral delta state and search it
  const deltaState = buildLocalDeltaSearchState(deltaScan);
  const deltaResults = executeLocalDeltaSearch(query, deltaState, input.options);

  // 3. Search published index
  const indexResults = searchTextIndex(
    input.indexedNotes as IndexedNote[],
    input.indexedChunks as Chunk[],
    query,
    input.options
  );

  // 4. Extract modified paths
  const modifiedPaths = new Set<string>();
  for (const modNote of deltaScan.modifiedNotes) {
    modifiedPaths.add(normalizePath(modNote.path));
  }

  // 5. Fuse results
  const fusedResults = fuseSearchResults(
    indexResults,
    deltaResults,
    deltaScan.deletedPaths,
    modifiedPaths,
    input.options
  );

  let indexCount = 0;
  let deltaCount = 0;
  for (const item of fusedResults) {
    if (item.source === "local-delta") {
      deltaCount++;
    } else {
      indexCount++;
    }
  }

  return {
    query,
    results: fusedResults,
    totalResults: fusedResults.length,
    indexResultCount: indexCount,
    deltaResultCount: deltaCount,
    warnings,
  };
}
