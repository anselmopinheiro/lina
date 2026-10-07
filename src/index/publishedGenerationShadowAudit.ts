import type { RuntimeEmbeddingIndex } from "../search/runtimeEmbeddingIndex";
import { computeVectorContractId } from "./vectorContract";
import { compareLegacyAndPublished, publishedSnapshotFromReadResult, type EquivalenceLevel, type EquivalenceResult, type LegacyEquivalenceSnapshot } from "./publishedGenerationEquivalence";
import type { PublishedGenerationReadResult } from "./publishedGenerationReader";

export interface PublishedShadowReader { read(options?: { lastValidGenerationId?: string }): Promise<PublishedGenerationReadResult>; }
export interface PublishedShadowPointerPort { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; }
export type PublishedShadowDiagnosticStatus = "IDLE" | "RUNNING" | "PASS" | "DIVERGED" | "READER_ERROR";
export interface PublishedShadowDiagnostic {
  readonly formatVersion?: number;
  readonly cutoverEligible?: boolean;
  readonly status: PublishedShadowDiagnosticStatus;
  readonly generationId?: string;
  readonly level: EquivalenceLevel;
  readonly summary?: EquivalenceResult["summary"];
  readonly divergences?: EquivalenceResult["divergences"];
  readonly readerStatus?: PublishedGenerationReadResult["status"];
  readonly providerCalls: 0;
  readonly capturedAt: string;
  readonly durationMs?: number;
  readonly legacyLoadMs?: number;
}
export interface PublishedGenerationShadowAuditOptions {
  readonly reader: PublishedShadowReader;
  readonly pointer: PublishedShadowPointerPort;
  readonly level: () => EquivalenceLevel;
  readonly now?: () => number;
  readonly retryBackoffMs?: number;
  readonly maxDivergences?: number;
}

const CURRENT = ".lina/published/CURRENT";
const RETRY_BACKOFF_MS = 10_000;

function legacySnapshot(index: RuntimeEmbeddingIndex, publishedFormatVersion?: number): LegacyEquivalenceSnapshot {
  const source = index.sourceIdentity;
  const vectorContractId = publishedFormatVersion === 3 ? computeVectorContractId({ provider: source.provider, model: source.model, dimensions: source.dimensions, prefixMode: source.prefixMode, inputVersion: source.inputVersion }) : undefined;
  return {
    identity: { recordCount: index.count, dimensions: index.dimensions, provider: index.provider, model: index.model, dtype: "float32", metric: "cosine", inputVersion: source.inputVersion, prefixMode: source.prefixMode, vectorContractId },
    records: index.records.map((record, ordinal) => ({
      chunkId: record.chunkId, path: record.path, index: record.index, textHash: record.textHash,
      embeddingInputHash: record.embeddingInputHash,
      embedding: index.vectors.subarray(ordinal * index.dimensions, (ordinal + 1) * index.dimensions),
    })),
  };
}

/** In-memory-only M5C shadow audit. It never changes the legacy runtime index. */
export class PublishedGenerationShadowAuditor {
  private running: Promise<PublishedShadowDiagnostic> | null = null;
  private lastAuditKey: string | null = null;
  private retryKey: string | null = null;
  private lastValidGenerationId: string | undefined;
  private retryAfter = 0;
  private diagnostic: PublishedShadowDiagnostic;

  constructor(private readonly options: PublishedGenerationShadowAuditOptions) {
    this.diagnostic = { status: "IDLE", level: options.level(), providerCalls: 0, capturedAt: new Date(0).toISOString() };
  }

  getDiagnostic(): PublishedShadowDiagnostic { return { ...this.diagnostic, divergences: this.diagnostic.divergences ? [...this.diagnostic.divergences] : undefined }; }
  invalidate(): void { this.lastAuditKey = null; this.retryKey = null; this.retryAfter = 0; }

  async schedule(index: RuntimeEmbeddingIndex): Promise<void> {
    if (this.running) return;
    const pointer = await this.readPointer();
    const key = `${legacyKey(index)}|${pointer ?? "none"}`;
    if (key === this.lastAuditKey || (key === this.retryKey && this.now() < this.retryAfter)) return;
    void this.run(index, key);
  }

  async runNow(index: RuntimeEmbeddingIndex): Promise<PublishedShadowDiagnostic> {
    const pointer = await this.readPointer();
    return this.run(index, `${legacyKey(index)}|${pointer ?? "none"}`, true);
  }

  private async run(index: RuntimeEmbeddingIndex, key: string, force = false): Promise<PublishedShadowDiagnostic> {
    if (this.running) return this.running;
    if (!force && key === this.retryKey && this.now() < this.retryAfter) return this.getDiagnostic();
    const level = this.options.level();
    const startedAt = this.now();
    this.diagnostic = { status: "RUNNING", level, providerCalls: 0, capturedAt: new Date().toISOString() };
    this.running = (async () => {
      const result = await this.options.reader.read({ lastValidGenerationId: this.lastValidGenerationId });
      if (result.status !== "OK") {
        this.retryAfter = this.now() + (this.options.retryBackoffMs ?? RETRY_BACKOFF_MS);
        this.retryKey = key;
        this.diagnostic = { status: "READER_ERROR", generationId: result.generationId, level, readerStatus: result.status, providerCalls: 0, capturedAt: new Date().toISOString(), durationMs: Math.max(0, this.now() - startedAt) };
        return this.diagnostic;
      }
      this.lastValidGenerationId = result.generationId;
      const comparison = compareLegacyAndPublished({ level, legacy: legacySnapshot(index, result.formatVersion), published: publishedSnapshotFromReadResult(result), maxReportedDivergences: this.options.maxDivergences });
      this.lastAuditKey = key;
      this.retryKey = null;
      this.retryAfter = 0;
      this.diagnostic = { status: comparison.equivalent ? "PASS" : "DIVERGED", generationId: result.generationId, formatVersion: result.formatVersion, cutoverEligible: result.cutoverEligible === true && comparison.equivalent, level, summary: comparison.summary, divergences: comparison.divergences, providerCalls: 0, capturedAt: new Date().toISOString(), durationMs: Math.max(0, this.now() - startedAt) };
      return this.diagnostic;
    })();
    try { return await this.running; } finally { this.running = null; }
  }

  private async readPointer(): Promise<string | undefined> {
    if (!await this.options.pointer.exists(CURRENT)) return undefined;
    return (await this.options.pointer.read(CURRENT)).trim();
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }
}

function legacyKey(index: RuntimeEmbeddingIndex): string {
  const source = index.sourceIdentity;
  return [index.provider, index.model, index.dimensions, index.count, source.updatedAt, source.publicationId ?? "", source.canonicalMtime, source.canonicalSize].join("|");
}
