import { App, normalizePath } from "obsidian";
import { isValidEmbeddingVector } from "../ai/embeddingTypes";
import { buildEmbeddingInput } from "../index/embeddingGenerator";
import { EmbeddingRecord } from "../index/embeddingPersistence";
import { calculateEmbeddingState, PublishedEmbeddingIdentity } from "../index/embeddingState";
import { Chunk } from "../index/chunker";
import { hashContent } from "../index/noteHasher";
import { createWebCryptoEmbeddingDigest, readBinaryEmbeddingStorage } from "../index/embeddingBinaryStorage";

export interface RuntimeEmbeddingMetadata {
  chunkId: string;
  path: string;
  index: number;
  textHash: string;
  embeddingInputHash?: string;
}

export interface RuntimeEmbeddingSourceIdentity extends Required<PublishedEmbeddingIdentity> {
  updatedAt: string;
  canonicalMtime: number;
  canonicalSize: number;
  storageFormat?: "jsonl-v1" | "binary-v1";
  publicationId?: string;
  binaryGenerationId?: string;
}

export interface RuntimeEmbeddingIndex {
  dimensions: number;
  count: number;
  vectors: Float32Array;
  records: RuntimeEmbeddingMetadata[];
  provider: string;
  model: string;
  sourceIdentity: RuntimeEmbeddingSourceIdentity;
}

export type RuntimeEmbeddingIndexInvalidationReason =
  | "canonical-published"
  | "canonical-rollback"
  | "canonical-recovered"
  | "text-index-published"
  | "text-index-rebuilt"
  | "external-source-changed"
  | "manual"
  | "unload";

export type RuntimeEmbeddingIndexCacheState = "empty" | "loading" | "ready" | "disposed";

interface ManifestEmbeddingInfo {
  provider: string;
  model: string;
  dimensions: number;
  inputVersion: number;
  prefixMode: "none" | "nomic-search-query-document";
  updatedAt: string;
  publicationId?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseManifestEmbeddingInfo(value: unknown): ManifestEmbeddingInfo | null {
  if (!isObject(value) || value.embeddingsEnabled !== true || !isObject(value.embeddings)) return null;
  const embeddings = value.embeddings;
  const input = isObject(value.embeddingInput) ? value.embeddingInput : undefined;
  if (
    typeof embeddings.provider !== "string"
    || typeof embeddings.model !== "string"
    || !Number.isInteger(embeddings.dimensions)
    || (embeddings.dimensions as number) <= 0
    || typeof embeddings.updatedAt !== "string"
    || !input
    || input.version !== 1
    || (input.prefixMode !== "none" && input.prefixMode !== "nomic-search-query-document")
  ) {
    return null;
  }
  return {
    provider: embeddings.provider,
    model: embeddings.model,
    dimensions: embeddings.dimensions as number,
    inputVersion: input.version as number,
    prefixMode: input.prefixMode,
    updatedAt: embeddings.updatedAt,
    publicationId: typeof embeddings.publicationId === "string" ? embeddings.publicationId : undefined,
  };
}

function sameSourceIdentity(
  left: RuntimeEmbeddingSourceIdentity | null,
  right: RuntimeEmbeddingSourceIdentity | null
): boolean {
  return !!left && !!right
    && left.provider === right.provider
    && left.model === right.model
    && left.dimensions === right.dimensions
    && left.inputVersion === right.inputVersion
    && left.prefixMode === right.prefixMode
    && left.updatedAt === right.updatedAt
    // publicationId is the canonical commit marker for any derived binary set.
    // It must participate in cache identity even when timestamps/sizes collide.
    && left.publicationId === right.publicationId
    && left.canonicalMtime === right.canonicalMtime
    && left.canonicalSize === right.canonicalSize;
}

export async function readRuntimeEmbeddingSourceIdentity(app: App): Promise<RuntimeEmbeddingSourceIdentity | null> {
  const adapter = app.vault.adapter;
  const manifestPath = normalizePath(".lina/index/manifest.json");
  const embeddingsPath = normalizePath(".lina/index/embeddings.jsonl");
  try {
    const [manifestContent, stat] = await Promise.all([
      adapter.read(manifestPath),
      adapter.stat(embeddingsPath),
    ]);
    if (!stat || stat.type !== "file") return null;
    const info = parseManifestEmbeddingInfo(JSON.parse(manifestContent) as unknown);
    if (!info) return null;
    return {
      ...info,
      canonicalMtime: stat.mtime,
      canonicalSize: stat.size,
    };
  } catch {
    return null;
  }
}

function parseJsonlRecords(content: string): EmbeddingRecord[] | null {
  const records: EmbeddingRecord[] = [];
  let start = 0;
  while (start < content.length) {
    const end = content.indexOf("\n", start);
    const lineEnd = end === -1 ? content.length : end;
    const line = content.slice(start, lineEnd);
    start = end === -1 ? content.length : end + 1;
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as EmbeddingRecord);
    } catch {
      return null;
    }
  }
  return records;
}

function buildRuntimeIndex(
  records: EmbeddingRecord[],
  chunks: readonly Chunk[],
  sourceIdentity: RuntimeEmbeddingSourceIdentity
): RuntimeEmbeddingIndex | null {
  const state = calculateEmbeddingState({
    chunks,
    canonicalRecords: records,
    publishedIdentity: sourceIdentity,
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });
  const count = state.validForSearchChunkIds.size;
  if (count === 0 || !Number.isSafeInteger(count * sourceIdentity.dimensions)) return null;

  const vectors = new Float32Array(count * sourceIdentity.dimensions);
  const metadata: RuntimeEmbeddingMetadata[] = [];
  const seen = new Set<string>();
  let recordIndex = 0;
  for (const record of records) {
    if (!state.validForSearchChunkIds.has(record.chunkId) || seen.has(record.chunkId)) continue;
    if (
      record.provider !== sourceIdentity.provider
      || record.model !== sourceIdentity.model
      || record.dimensions !== sourceIdentity.dimensions
      || !isValidEmbeddingVector(record.embedding)
      || record.embedding.length !== sourceIdentity.dimensions
    ) {
      return null;
    }
    const offset = recordIndex * sourceIdentity.dimensions;
    for (let dimension = 0; dimension < sourceIdentity.dimensions; dimension++) {
      vectors[offset + dimension] = record.embedding[dimension];
    }
    metadata.push({
      chunkId: record.chunkId,
      path: record.path,
      index: record.index,
      textHash: record.textHash,
      embeddingInputHash: record.embeddingInputHash,
    });
    seen.add(record.chunkId);
    recordIndex++;
  }
  if (recordIndex !== count) return null;
  return {
    dimensions: sourceIdentity.dimensions,
    count,
    vectors,
    records: metadata,
    provider: sourceIdentity.provider,
    model: sourceIdentity.model,
    sourceIdentity,
  };
}

export class RuntimeEmbeddingIndexCache {
  private index: RuntimeEmbeddingIndex | null = null;
  private loading: Promise<RuntimeEmbeddingIndex | null> | null = null;
  private revision = 0;
  private disposed = false;
  private loadedPreference: "jsonl" | "prefer-binary" | null = null;

  constructor(
    private readonly app: App,
    private readonly debug?: (event: string, details: Record<string, unknown>) => void,
    private readonly getStoragePreference: () => "jsonl" | "prefer-binary" = () => "jsonl"
  ) {}

  getState(): RuntimeEmbeddingIndexCacheState {
    if (this.disposed) return "disposed";
    if (this.loading) return "loading";
    return this.index ? "ready" : "empty";
  }

  async getOrLoad(chunks: readonly Chunk[]): Promise<RuntimeEmbeddingIndex | null> {
    if (this.disposed) return null;
    const preference = this.getStoragePreference();
    if (this.index && this.loadedPreference !== preference) this.invalidate("manual");
    const requestRevision = this.revision;
    const source = await readRuntimeEmbeddingSourceIdentity(this.app);
    if (this.disposed || this.revision !== requestRevision) return null;
    if (!source) {
      this.invalidate("external-source-changed");
      return null;
    }
    if (this.index && sameSourceIdentity(this.index.sourceIdentity, source)) {
      this.debug?.("hit", { count: this.index.count, dimensions: this.index.dimensions });
      return this.index;
    }
    if (this.index) this.invalidate("external-source-changed");
    if (this.loading) return this.loading;

    const loadRevision = this.revision;
    this.debug?.("load-started", { dimensions: source.dimensions });
    this.loading = this.load(source, chunks, loadRevision);
    try {
      return await this.loading;
    } finally {
      if (this.revision === loadRevision) this.loading = null;
    }
  }

  invalidate(reason: RuntimeEmbeddingIndexInvalidationReason): void {
    if (this.disposed) return;
    this.revision++;
    this.index = null;
    this.loadedPreference = null;
    this.debug?.("invalidated", { reason });
  }

  dispose(): void {
    if (this.disposed) return;
    this.revision++;
    this.index = null;
    this.loadedPreference = null;
    this.loading = null;
    this.disposed = true;
    this.debug?.("disposed", {});
  }

  private async load(
    source: RuntimeEmbeddingSourceIdentity,
    chunks: readonly Chunk[],
    revision: number
  ): Promise<RuntimeEmbeddingIndex | null> {
    try {
      if (this.getStoragePreference() === "prefer-binary" && source.publicationId) {
        try {
          const binary = await readBinaryEmbeddingStorage(this.app.vault.adapter as never, createWebCryptoEmbeddingDigest());
          const sourceAfterBinary = await readRuntimeEmbeddingSourceIdentity(this.app);
          if (!sameSourceIdentity(source, sourceAfterBinary)) {
            this.debug?.("binary-fallback", { reason: "canonical-source-changed-during-binary-read", status: "outdated" });
            return sourceAfterBinary ? this.load(sourceAfterBinary, chunks, revision) : null;
          }
          if (binary.sourceIdentity.publicationId === source.publicationId && binary.dimensions === source.dimensions && binary.provider === source.provider && binary.model === source.model) {
            binary.sourceIdentity = { ...source, storageFormat: "binary-v1", publicationId: source.publicationId, binaryGenerationId: binary.sourceIdentity.binaryGenerationId };
            this.index = binary;
            this.loadedPreference = "prefer-binary";
            this.debug?.("binary-load-completed", { count: binary.count, dimensions: binary.dimensions });
            return binary;
          }
          this.debug?.("binary-fallback", { reason: "source-publication-mismatch", status: "outdated" });
        } catch {
          this.debug?.("binary-fallback", { reason: "candidate-unavailable" });
        }
      }
      const content = await this.app.vault.adapter.read(normalizePath(".lina/index/embeddings.jsonl"));
      const records = parseJsonlRecords(content);
      if (!records) {
        this.debug?.("load-failed", { reason: "invalid-jsonl" });
        return null;
      }
      const index = buildRuntimeIndex(records, chunks, source);
      const sourceAfterLoad = await readRuntimeEmbeddingSourceIdentity(this.app);
      if (this.disposed || this.revision !== revision || !sameSourceIdentity(source, sourceAfterLoad)) {
        this.debug?.("stale-load-discarded", {});
        return null;
      }
      if (!index) {
        this.debug?.("load-failed", { reason: "invalid-runtime-index" });
        return null;
      }
      this.index = index;
      this.loadedPreference = this.getStoragePreference();
      this.debug?.("load-completed", { count: index.count, dimensions: index.dimensions });
      return index;
    } catch {
      this.debug?.("load-failed", { reason: "read-error" });
      return null;
    }
  }
}
