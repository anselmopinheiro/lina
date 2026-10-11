import { RuntimeEmbeddingIndex } from "./runtimeEmbeddingIndex";
import { cosineSimilarity } from "./semanticSearch";

export interface SemanticNeighbor {
  readonly path: string;
  readonly score: number;
}

export type SemanticNeighborhoodStatus =
  | "ok"
  | "empty-index"
  | "source-not-indexed"
  | "source-no-valid-vector"
  | "invalid-index"
  | "invalid-limit";

export interface SemanticNeighborhoodResult {
  readonly status: SemanticNeighborhoodStatus;
  readonly neighbors: readonly SemanticNeighbor[];
}

interface IndexedNoteVectors {
  readonly path: string;
  readonly ordinals: readonly number[];
}

function normalizedCentroid(
  vectors: Float32Array,
  dimensions: number,
  ordinals: readonly number[],
): Float32Array | null {
  const total = new Float64Array(dimensions);
  let validCount = 0;

  for (const ordinal of ordinals) {
    const offset = ordinal * dimensions;
    let squaredNorm = 0;
    for (let dimension = 0; dimension < dimensions; dimension++) {
      const value = vectors[offset + dimension];
      if (!Number.isFinite(value)) return null;
      squaredNorm += value * value;
    }
    if (squaredNorm === 0) continue;

    const inverseNorm = 1 / Math.sqrt(squaredNorm);
    for (let dimension = 0; dimension < dimensions; dimension++) {
      total[dimension] += vectors[offset + dimension] * inverseNorm;
    }
    validCount++;
  }

  if (validCount === 0) return null;

  let squaredMeanNorm = 0;
  for (let dimension = 0; dimension < dimensions; dimension++) {
    total[dimension] /= validCount;
    squaredMeanNorm += total[dimension] * total[dimension];
  }
  if (squaredMeanNorm === 0) return null;

  const inverseMeanNorm = 1 / Math.sqrt(squaredMeanNorm);
  const centroid = new Float32Array(dimensions);
  for (let dimension = 0; dimension < dimensions; dimension++) {
    centroid[dimension] = total[dimension] * inverseMeanNorm;
  }
  return centroid;
}

function groupIndexedNoteVectors(index: RuntimeEmbeddingIndex): IndexedNoteVectors[] | null {
  if (!Number.isInteger(index.dimensions) || index.dimensions <= 0
    || !Number.isInteger(index.count) || index.count < 0
    || index.records.length !== index.count || index.vectors.length !== index.count * index.dimensions) {
    return null;
  }

  const byPath = new Map<string, number[]>();
  const chunkIds = new Set<string>();
  const ordinals = new Set<number>();
  for (let position = 0; position < index.records.length; position++) {
    const record = index.records[position];
    const ordinal = record.vectorOrdinal ?? position;
    if (!record.path || !record.chunkId || !Number.isInteger(ordinal)
      || ordinal < 0 || ordinal >= index.count || chunkIds.has(record.chunkId) || ordinals.has(ordinal)) {
      return null;
    }
    chunkIds.add(record.chunkId);
    ordinals.add(ordinal);
    const noteOrdinals = byPath.get(record.path) ?? [];
    noteOrdinals.push(ordinal);
    byPath.set(record.path, noteOrdinals);
  }

  return Array.from(byPath, ([path, ordinals]) => ({ path, ordinals }));
}

/**
 * Finds note-level semantic neighbors from vectors already resident in the
 * runtime index. Each note is represented by the normalized mean of its
 * normalized chunk vectors; no embedding, I/O, or persistent index is used.
 * Any taxonomic influence already present in indexed chunks is deliberately
 * retained as-is; this module does not change chunking or frontmatter policy.
 */
export function findSemanticNeighborhood(
  index: RuntimeEmbeddingIndex,
  sourcePath: string,
  maximum: number,
): SemanticNeighborhoodResult {
  if (!Number.isInteger(maximum) || maximum < 0) return { status: "invalid-limit", neighbors: [] };
  const notes = groupIndexedNoteVectors(index);
  if (!notes) return { status: "invalid-index", neighbors: [] };
  if (notes.length === 0) return { status: "empty-index", neighbors: [] };

  const source = notes.find(note => note.path === sourcePath);
  if (!source) return { status: "source-not-indexed", neighbors: [] };
  const sourceVector = normalizedCentroid(index.vectors, index.dimensions, source.ordinals);
  if (!sourceVector) return { status: "source-no-valid-vector", neighbors: [] };

  const neighbors: SemanticNeighbor[] = [];
  for (const note of notes) {
    if (note.path === sourcePath) continue;
    const noteVector = normalizedCentroid(index.vectors, index.dimensions, note.ordinals);
    if (!noteVector) continue;
    neighbors.push({ path: note.path, score: cosineSimilarity(sourceVector, noteVector) });
  }

  neighbors.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return { status: "ok", neighbors: neighbors.slice(0, maximum) };
}
