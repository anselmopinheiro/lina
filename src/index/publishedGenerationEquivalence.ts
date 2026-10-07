/**
 * M5B pure equivalence comparator: legacy embeddings vs a published M4 generation.
 *
 * It receives already-loaded structures. It performs no I/O, never recomputes hashes,
 * never touches providers or SQLite, and does not invent or normalise `embeddingInputHash` (G6).
 */
import type { PublishedGenerationReadResult } from "./publishedGenerationReader";

export type EquivalenceLevel = "L1" | "L2";

export type EquivalenceDivergenceClass =
  | "LEGACY_ONLY"
  | "PUBLISHED_ONLY"
  | "METADATA_MISMATCH"
  | "VECTOR_MISMATCH"
  | "DIMENSION_MISMATCH"
  | "CONTRACT_MISMATCH"
  | "HASH_MISMATCH"
  | "DUPLICATE_IDENTITY"
  | "READ_ERROR"
  | "SOURCE_PROVENANCE_MISMATCH"
  | "PRODUCER_PROVENANCE_MISMATCH";

export type EquivalenceSide = "legacy" | "published";

/** Identity/publication metadata of one side. Every field is optional; only fields present on both sides are compared. */
export interface EquivalenceIdentity {
  readonly formatVersion?: number;
  readonly recordCount?: number;
  readonly dimensions?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly vectorContractId?: string;
  readonly dtype?: string;
  readonly metric?: string;
  readonly inputVersion?: number;
  readonly prefixMode?: string;
  /** Legacy `publicationId` / published `sourcePublicationId` (absent in M4 manifests today, G2). */
  readonly publicationId?: string;
  /** Immutable source pair, supplied only by G2-capable sides. */
  readonly sourceTextGenerationId?: string;
  readonly sourceChunksDigest?: string;
  readonly sourceRecordCount?: number;
  readonly producerDeviceId?: string;
  readonly producerEpoch?: number;
  /**
   * Named digests already computed by the caller (never recomputed here). A name present on both
   * sides must refer to the same canonical bytes, otherwise the caller must not provide it.
   */
  readonly hashes?: Readonly<Record<string, string>>;
}

export interface EquivalenceRecord {
  readonly chunkId: string;
  readonly path: string;
  readonly index: number;
  readonly textHash: string;
  readonly embeddingInputHash?: string;
}

export interface LegacyEquivalenceRecord extends EquivalenceRecord {
  /** Legacy vector, usually `number[]` (float64). Not needed for L1. */
  readonly embedding?: ArrayLike<number>;
}

export interface LegacyEquivalenceSnapshot {
  readonly identity?: EquivalenceIdentity;
  readonly records?: readonly LegacyEquivalenceRecord[];
  /** The legacy side could not be read; reported as READ_ERROR. */
  readonly readError?: string;
}

export interface PublishedEquivalenceSnapshot {
  readonly identity?: EquivalenceIdentity;
  /** Metadata in physical order: record `i` owns `vectors[i * dimensions ... (i + 1) * dimensions)`. */
  readonly records?: readonly EquivalenceRecord[];
  readonly vectors?: Float32Array;
  readonly readError?: string;
}

export interface CompareLegacyAndPublishedInput {
  readonly level: EquivalenceLevel;
  readonly legacy: LegacyEquivalenceSnapshot;
  readonly published: PublishedEquivalenceSnapshot;
  /** Maximum divergences listed in the report; counts stay exact. Default 200. */
  readonly maxReportedDivergences?: number;
}

export interface EquivalenceDivergence {
  readonly class: EquivalenceDivergenceClass;
  readonly chunkId?: string;
  readonly field?: string;
  readonly legacyValue?: string | number;
  readonly publishedValue?: string | number;
  readonly side?: EquivalenceSide;
  /** DUPLICATE_IDENTITY: number of occurrences of the chunkId on `side`. */
  readonly occurrences?: number;
  readonly impact?: string;
}

export interface EquivalenceResult {
  readonly formatVersion?: number;
  readonly cutoverEligible?: boolean;
  readonly equivalent: boolean;
  readonly level: EquivalenceLevel;
  readonly summary: {
    readonly legacyCount: number | null;
    readonly publishedCount: number | null;
    readonly divergenceCount: number;
    readonly countsByClass: Readonly<Partial<Record<EquivalenceDivergenceClass, number>>>;
    readonly truncated: boolean;
  };
  readonly divergences: readonly EquivalenceDivergence[];
}

const DEFAULT_MAX_REPORTED = 200;
const MAX_SUMMARY_CHARS = 120;

function summarise(value: string | number | undefined): string | number | undefined {
  if (typeof value !== "string") return value;
  return value.length > MAX_SUMMARY_CHARS ? `${value.slice(0, MAX_SUMMARY_CHARS)}…(${value.length} chars)` : value;
}

class DivergenceCollector {
  private readonly items: EquivalenceDivergence[] = [];
  private total = 0;
  private readonly counts: Partial<Record<EquivalenceDivergenceClass, number>> = {};
  constructor(private readonly limit: number) {}

  add(divergence: EquivalenceDivergence): void {
    this.total += 1;
    this.counts[divergence.class] = (this.counts[divergence.class] ?? 0) + 1;
    if (this.items.length < this.limit) {
      this.items.push({
        ...divergence,
        legacyValue: summarise(divergence.legacyValue),
        publishedValue: summarise(divergence.publishedValue),
      });
    }
  }

  get count(): number { return this.total; }

  build(level: EquivalenceLevel, legacyCount: number | null, publishedCount: number | null): EquivalenceResult {
    return {
      equivalent: this.total === 0,
      level,
      summary: { legacyCount, publishedCount, divergenceCount: this.total, countsByClass: { ...this.counts }, truncated: this.total > this.items.length },
      divergences: [...this.items],
    };
  }
}

/** Compares scalar identity fields present on both sides. */
function compareIdentity(collector: DivergenceCollector, legacy: EquivalenceIdentity, published: EquivalenceIdentity, legacyRecordCount: number | null, publishedRecordCount: number | null): void {
  const legacyCount = legacy.recordCount ?? legacyRecordCount ?? undefined;
  const publishedCount = published.recordCount ?? publishedRecordCount ?? undefined;
  if (legacyCount !== undefined && publishedCount !== undefined && legacyCount !== publishedCount) {
    collector.add({ class: "METADATA_MISMATCH", field: "recordCount", legacyValue: legacyCount, publishedValue: publishedCount });
  }
  if (legacy.dimensions !== undefined && published.dimensions !== undefined && legacy.dimensions !== published.dimensions) {
    collector.add({ class: "DIMENSION_MISMATCH", field: "dimensions", legacyValue: legacy.dimensions, publishedValue: published.dimensions });
  }
  for (const field of ["provider", "model", "vectorContractId", "dtype", "metric", "inputVersion", "prefixMode", "formatVersion"] as const) {
    const left = legacy[field];
    const right = published[field];
    if (left !== undefined && right !== undefined && left !== right) {
      collector.add({ class: "CONTRACT_MISMATCH", field, legacyValue: left, publishedValue: right });
    }
  }
  if (legacy.publicationId !== undefined && published.publicationId !== undefined && legacy.publicationId !== published.publicationId) {
    collector.add({ class: "SOURCE_PROVENANCE_MISMATCH", field: "sourcePublicationId", legacyValue: legacy.publicationId, publishedValue: published.publicationId });
  }
  for (const field of ["sourceTextGenerationId", "sourceChunksDigest", "sourceRecordCount"] as const) {
    const left = legacy[field];
    const right = published[field];
    if (left !== undefined && right !== undefined && left !== right) {
      collector.add({ class: "SOURCE_PROVENANCE_MISMATCH", field, legacyValue: left, publishedValue: right });
    }
  }
  for (const field of ["producerDeviceId", "producerEpoch"] as const) {
    const left = legacy[field];
    const right = published[field];
    if (left !== undefined && right !== undefined && left !== right) collector.add({ class: "PRODUCER_PROVENANCE_MISMATCH", field, legacyValue: left, publishedValue: right });
  }
  if (legacy.hashes && published.hashes) {
    for (const name of Object.keys(legacy.hashes).sort()) {
      const left = legacy.hashes[name];
      const right = published.hashes[name];
      if (left !== undefined && right !== undefined && left !== right) {
        collector.add({ class: "HASH_MISMATCH", field: `hashes.${name}`, legacyValue: left, publishedValue: right });
      }
    }
  }
}

/** Groups records by chunkId, reporting every duplicated id without letting a later item overwrite an earlier one. */
function indexById<T extends { readonly chunkId: string }>(records: readonly T[], side: EquivalenceSide, collector: DivergenceCollector): { unique: Map<string, { record: T; position: number }>; duplicated: Set<string> } {
  const unique = new Map<string, { record: T; position: number }>();
  const occurrences = new Map<string, number>();
  records.forEach((record, position) => {
    const seen = (occurrences.get(record.chunkId) ?? 0) + 1;
    occurrences.set(record.chunkId, seen);
    if (seen === 1) unique.set(record.chunkId, { record, position });
  });
  const duplicated = new Set<string>();
  for (const [chunkId, count] of occurrences) {
    if (count < 2) continue;
    duplicated.add(chunkId);
    collector.add({
      class: "DUPLICATE_IDENTITY", chunkId, side, occurrences: count,
      impact: "chunkId excluded from record-level comparison; resolve the duplicate before trusting equivalence",
    });
  }
  return { unique, duplicated };
}

/** Exact float32 comparison: legacy float64 is rounded with Math.fround; no tolerance. NaN equals NaN. */
function sameFloat32(legacyValue: number, publishedValue: number): boolean {
  const rounded = Math.fround(legacyValue);
  return rounded === publishedValue || (Number.isNaN(rounded) && Number.isNaN(publishedValue));
}

function compareRecords(collector: DivergenceCollector, legacy: LegacyEquivalenceSnapshot, published: PublishedEquivalenceSnapshot): void {
  const legacyRecords = legacy.records ?? [];
  const publishedRecords = published.records ?? [];
  const legacyIndex = indexById(legacyRecords, "legacy", collector);
  const publishedIndex = indexById(publishedRecords, "published", collector);
  const publishedDimensions = published.identity?.dimensions;
  const vectors = published.vectors;

  if (vectors && publishedDimensions !== undefined && vectors.length !== publishedRecords.length * publishedDimensions) {
    collector.add({ class: "DIMENSION_MISMATCH", field: "vectors.length", legacyValue: publishedRecords.length * publishedDimensions, publishedValue: vectors.length, side: "published", impact: "published vector buffer does not match recordCount x dimensions" });
  }

  const ids = new Set<string>([...legacyIndex.unique.keys(), ...publishedIndex.unique.keys()]);
  for (const chunkId of [...ids].sort()) {
    if (legacyIndex.duplicated.has(chunkId) || publishedIndex.duplicated.has(chunkId)) continue;
    const left = legacyIndex.unique.get(chunkId);
    const right = publishedIndex.unique.get(chunkId);
    if (left && !right) { collector.add({ class: "LEGACY_ONLY", chunkId }); continue; }
    if (!left && right) { collector.add({ class: "PUBLISHED_ONLY", chunkId }); continue; }
    if (!left || !right) continue;

    const l = left.record;
    const r = right.record;
    if (l.path !== r.path) collector.add({ class: "METADATA_MISMATCH", chunkId, field: "path", legacyValue: l.path, publishedValue: r.path });
    if (l.index !== r.index) collector.add({ class: "METADATA_MISMATCH", chunkId, field: "index", legacyValue: l.index, publishedValue: r.index });
    if (l.textHash !== r.textHash) collector.add({ class: "METADATA_MISMATCH", chunkId, field: "textHash", legacyValue: l.textHash, publishedValue: r.textHash });
    if (published.identity?.formatVersion !== 1 && (((published.identity?.formatVersion === 2 || published.identity?.formatVersion === 3 || published.identity?.formatVersion === 4) && (!l.embeddingInputHash?.trim() || !r.embeddingInputHash?.trim())) || (l.embeddingInputHash !== undefined && r.embeddingInputHash !== undefined && l.embeddingInputHash !== r.embeddingInputHash))) collector.add({ class: "HASH_MISMATCH", chunkId, field: "embeddingInputHash", legacyValue: l.embeddingInputHash, publishedValue: r.embeddingInputHash });

    if (!l.embedding || !vectors || publishedDimensions === undefined) continue;
    if (l.embedding.length !== publishedDimensions) {
      collector.add({ class: "DIMENSION_MISMATCH", chunkId, field: "embedding.length", legacyValue: l.embedding.length, publishedValue: publishedDimensions });
      continue;
    }
    const offset = right.position * publishedDimensions;
    if (offset + publishedDimensions > vectors.length) continue; // already reported as vectors.length mismatch
    let firstDifference = -1;
    let differing = 0;
    for (let component = 0; component < publishedDimensions; component += 1) {
      if (!sameFloat32(l.embedding[component], vectors[offset + component])) {
        if (firstDifference < 0) firstDifference = component;
        differing += 1;
      }
    }
    if (differing > 0) {
      collector.add({
        class: "VECTOR_MISMATCH", chunkId, field: `embedding[${firstDifference}]`,
        legacyValue: Math.fround(l.embedding[firstDifference]), publishedValue: vectors[offset + firstDifference],
        impact: `${differing} of ${publishedDimensions} components differ`,
      });
    }
  }
}

export function compareLegacyAndPublished(input: CompareLegacyAndPublishedInput): EquivalenceResult {
  const collector = new DivergenceCollector(Math.max(0, Math.floor(input.maxReportedDivergences ?? DEFAULT_MAX_REPORTED)));
  const { legacy, published, level } = input;
  const legacyCount = legacy.records?.length ?? legacy.identity?.recordCount ?? null;
  const publishedCount = published.records?.length ?? published.identity?.recordCount ?? null;

  if (legacy.readError !== undefined || published.readError !== undefined) {
    if (legacy.readError !== undefined) collector.add({ class: "READ_ERROR", side: "legacy", field: "read", legacyValue: legacy.readError });
    if (published.readError !== undefined) collector.add({ class: "READ_ERROR", side: "published", field: "read", publishedValue: published.readError });
    return collector.build(level, legacyCount, publishedCount);
  }

  compareIdentity(collector, legacy.identity ?? {}, published.identity ?? {}, legacy.records?.length ?? null, published.records?.length ?? null);
  if (level === "L2") compareRecords(collector, legacy, published);
  return { ...collector.build(level, legacyCount, publishedCount), formatVersion: published.identity?.formatVersion, cutoverEligible: collector.count === 0 && published.identity?.formatVersion === 5 };
}

/**
 * Adapts a Reader result into a published snapshot. A non-OK status becomes a READ_ERROR carrying
 * the typed status; no fallback is attempted.
 */
export function publishedSnapshotFromReadResult(result: PublishedGenerationReadResult): PublishedEquivalenceSnapshot {
  const index = result.index;
  if (result.status !== "OK" || !index) return { readError: `${result.status}${result.detail ? `: ${result.detail}` : ""}` };
  return {
    identity: { formatVersion: result.formatVersion, recordCount: index.count, dimensions: index.dimensions, provider: index.provider, model: index.model, vectorContractId: index.vectorContractId, dtype: index.dtype ?? "float32", metric: index.metric, inputVersion: index.inputVersion, prefixMode: index.prefixMode, publicationId: index.sourcePublicationId, sourceTextGenerationId: index.sourceTextGenerationId, sourceChunksDigest: index.sourceChunksDigest, sourceRecordCount: index.sourceRecordCount, producerDeviceId: index.producerDeviceId, producerEpoch: index.producerEpoch },
    records: index.records.map((record) => ({ chunkId: record.chunkId, path: record.path, index: record.index, textHash: record.textHash, embeddingInputHash: record.embeddingInputHash })),
    vectors: index.vectors,
  };
}
