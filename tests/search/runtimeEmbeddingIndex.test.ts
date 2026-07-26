import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Chunk } from "../../src/index/chunker";
import { EmbeddingRecord, buildEmbeddingInput } from "../../src/index/embeddingGenerator";
import { hashContent } from "../../src/index/noteHasher";
import { EMBEDDING_JSONL_RESOURCE_LIMITS, RuntimeEmbeddingIndexCache, estimateEmbeddingJsonlPeakBytes } from "../../src/search/runtimeEmbeddingIndex";
import { BINARY_EMBEDDING_FILES, BinaryEmbeddingDataAdapter, BinaryEmbeddingPublisher, BinaryEmbeddingStorageError, DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS, MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS, createWebCryptoEmbeddingDigest } from "../../src/index/embeddingBinaryStorage";
import { cosineSimilarity, searchRuntimeSemanticIndex, searchSemanticIndex } from "../../src/search/semanticSearch";
import { runHybridSearch } from "../../src/search/hybridSearch";
import { FakeAdapter } from "../helpers/fakeAdapter";

const provider = "ollama";
const model = "nomic-embed-text";
const dimensions = 3;

class BinaryRuntimeAdapter extends FakeAdapter implements BinaryEmbeddingDataAdapter {
  private readonly binary = new Map<string, ArrayBuffer>();
  async exists(path: string): Promise<boolean> { return this.binary.has(path) || super.exists(path); }
  async stat(path: string): Promise<{ type: string; size: number; mtime: number } | null> {
    const value = this.binary.get(path); return value ? { type: "file", size: value.byteLength, mtime: 1 } : super.stat(path);
  }
  async readBinary(path: string): Promise<ArrayBuffer> { const value = this.binary.get(path); if (!value) throw new Error("missing binary"); return value.slice(0); }
  async writeBinary(path: string, value: ArrayBuffer): Promise<void> { this.binary.set(path, value.slice(0)); }
  async rename(from: string, to: string): Promise<void> { const value = this.binary.get(from); if (value) { this.binary.delete(from); this.binary.set(to, value); return; } await super.rename(from, to); }
  async remove(path: string): Promise<void> { this.binary.delete(path); await super.remove(path); }
}

function makeChunk(id: number): Chunk {
  const text = `synthetic content ${id}`;
  return {
    chunkId: `synthetic-${id}.md::0`,
    path: `synthetic-${id}.md`,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-07-24T00:00:00.000Z",
  };
}

function makeRecord(chunk: Chunk, vector: number[]): EmbeddingRecord {
  return {
    chunkId: chunk.chunkId,
    path: chunk.path,
    index: chunk.chunkIndex,
    textHash: chunk.textHash,
    provider,
    model,
    dimensions,
    embedding: vector,
    createdAt: "2026-07-24T00:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, "none")),
  };
}

function makeApp(chunks: Chunk[], records: EmbeddingRecord[], delay = 0, publicationId?: string): { vault: { adapter: FakeAdapter } } {
  const manifest = {
    embeddingsEnabled: true,
    embeddings: { provider, model, dimensions, updatedAt: "2026-07-24T00:00:00.000Z", ...(publicationId ? { publicationId } : {}) },
    embeddingInput: { version: 1, prefixMode: "none" },
  };
  const adapter = new FakeAdapter({
    ".lina/index/manifest.json": JSON.stringify(manifest),
    ".lina/index/embeddings.jsonl": `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  }, { operationDelayMs: delay });
  return { vault: { adapter } };
}

async function makeBinaryApp(chunks: Chunk[], jsonlRecords: EmbeddingRecord[], jsonlPublicationId: string, binaryRecords: EmbeddingRecord[], binaryPublicationId: string): Promise<{ vault: { adapter: BinaryRuntimeAdapter } }> {
  const manifest = { embeddingsEnabled: true, embeddings: { provider, model, dimensions, updatedAt: "2026-07-24T00:00:00.000Z", publicationId: jsonlPublicationId }, embeddingInput: { version: 1, prefixMode: "none" } };
  const adapter = new BinaryRuntimeAdapter({ ".lina/index/manifest.json": JSON.stringify(manifest), ".lina/index/embeddings.jsonl": `${jsonlRecords.map((record) => JSON.stringify(record)).join("\n")}\n` });
  await new BinaryEmbeddingPublisher(adapter, createWebCryptoEmbeddingDigest()).publish(binaryRecords, { format: "binary-v1", identity: { provider, model, dimensions, inputVersion: 1, prefixMode: "none" }, recordCount: binaryRecords.length, dimensions, generationId: `binary-${binaryPublicationId}`, sourcePublicationId: binaryPublicationId });
  return { vault: { adapter } };
}

function canonicalReadCount(adapter: FakeAdapter): number {
  return adapter.readPaths.filter((path) => path.endsWith("embeddings.jsonl")).length;
}

describe("RuntimeEmbeddingIndexCache", () => {
  it("a abertura e actualização da sidebar não pedem o índice runtime", () => {
    const source = readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");
    const onOpenStart = source.indexOf("async onOpen(): Promise<void>");
    const onCloseStart = source.indexOf("async onClose(): Promise<void>", onOpenStart);
    const refreshStart = source.indexOf("private async refreshState", onCloseStart);
    const hybridStart = source.indexOf("private async runHybridModeGrouped", refreshStart);
    const passiveSidebarCode = source.slice(onOpenStart, hybridStart);
    expect(passiveSidebarCode).not.toContain("getRuntimeEmbeddingIndex");
    expect(passiveSidebarCode).not.toContain("getOrLoad");
  });

  it("permanece lazy até uma pesquisa pedir getOrLoad", () => {
    const chunks = [makeChunk(1)];
    const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])]);
    const cache = new RuntimeEmbeddingIndexCache(app as never);
    expect(cache.getState()).toBe("empty");
    expect(app.vault.adapter.readCount).toBe(0);
    expect(canonicalReadCount(app.vault.adapter)).toBe(0);
    expect(cache.getDiagnosticState()).toEqual({ configuredPreference: "jsonl", effectiveSource: "not-loaded", fallbackReason: "none" });
  });

  it("regista JSONL como fonte efetiva sem expor dados dos registos", async () => {
    const chunks = [makeChunk(1)]; const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])], 0, "publication-a");
    const cache = new RuntimeEmbeddingIndexCache(app as never);
    await cache.getOrLoad(chunks);
    expect(cache.getDiagnosticState()).toMatchObject({ configuredPreference: "jsonl", effectiveSource: "jsonl", fallbackReason: "binary-disabled", canonicalPublicationId: "publication-a", recordCount: 1, dimensions: 3 });
    expect(JSON.stringify(cache.getDiagnosticState())).not.toContain("synthetic content");
    expect(JSON.stringify(cache.getDiagnosticState())).not.toContain("embedding");
  });

  it("constrói um bloco Float32 contíguo e não conserva vetores nos metadados", async () => {
    const chunks = [makeChunk(1), makeChunk(2)];
    const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 2, 3]), makeRecord(chunks[1]!, [4, 5, 6])]);
    const index = await new RuntimeEmbeddingIndexCache(app as never).getOrLoad(chunks);

    expect(index?.vectors).toBeInstanceOf(Float32Array);
    expect(Array.from(index?.vectors ?? [])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(index?.records).toHaveLength(2);
    expect(index?.records[0]).not.toHaveProperty("embedding");
    expect(index?.records.every((record) => !Object.prototype.hasOwnProperty.call(record, "embedding"))).toBe(true);
  });

  it("partilha a primeira carga e reutiliza o cache", async () => {
    const chunks = [makeChunk(1)];
    const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])], 2);
    const cache = new RuntimeEmbeddingIndexCache(app as never);
    const [first, second] = await Promise.all([cache.getOrLoad(chunks), cache.getOrLoad(chunks)]);
    expect(first).toBe(second);
    expect(canonicalReadCount(app.vault.adapter)).toBe(1);

    await cache.getOrLoad(chunks);
    expect(canonicalReadCount(app.vault.adapter)).toBe(1);
  });

  it("descarta a revisão carregada depois de invalidação e recarrega", async () => {
    const chunks = [makeChunk(1)];
    const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])], 2);
    const cache = new RuntimeEmbeddingIndexCache(app as never);
    const loading = cache.getOrLoad(chunks);
    cache.invalidate("manual");
    expect(await loading).toBeNull();
    expect(await cache.getOrLoad(chunks)).not.toBeNull();
    expect(canonicalReadCount(app.vault.adapter)).toBe(1);
  });

  it("deteta identidade externa alterada e recarrega sem polling", async () => {
    const chunks = [makeChunk(1)];
    const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])]);
    const cache = new RuntimeEmbeddingIndexCache(app as never);
    expect(await cache.getOrLoad(chunks)).not.toBeNull();
    const manifest = JSON.parse(app.vault.adapter.getFile(".lina/index/manifest.json")!);
    manifest.embeddings.updatedAt = "2026-07-25T00:00:00.000Z";
    app.vault.adapter.setFile(".lina/index/manifest.json", JSON.stringify(manifest));
    app.vault.adapter.setFile(".lina/index/embeddings.jsonl", `${JSON.stringify(makeRecord(chunks[0]!, [0, 1, 0]))}\n`);
    const reloaded = await cache.getOrLoad(chunks);
    expect(Array.from(reloaded?.vectors ?? [])).toEqual([0, 1, 0]);
    expect(canonicalReadCount(app.vault.adapter)).toBe(2);
  });

  it("aceita binário apenas quando sourcePublicationId corresponde ao manifesto JSONL", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = await makeBinaryApp(chunks, records, "publication-a", records, "publication-a");
    const index = await new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary").getOrLoad(chunks);
    expect(index?.sourceIdentity.storageFormat).toBe("binary-v1");
    expect(index?.sourceIdentity.publicationId).toBe("publication-a");
    expect(new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary").getDiagnosticState().effectiveSource).toBe("not-loaded");
  });

  it("regista binário efetivo e fallback estruturado para trio ausente", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = await makeBinaryApp(chunks, records, "publication-a", records, "publication-a");
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary");
    await cache.getOrLoad(chunks);
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "binary", fallbackReason: "none", recordCount: 1, dimensions: 3 });
    cache.invalidate("manual");
    await app.vault.adapter.remove(BINARY_EMBEDDING_FILES.vectors);
    await cache.getOrLoad(chunks);
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "jsonl", fallbackReason: "binary-missing" });
  });

  it("regista manifesto legado e reinicia o diagnóstico quando a preferência muda", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = makeApp(chunks, records); let preference: "jsonl" | "prefer-binary" = "prefer-binary";
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, () => preference);
    await cache.getOrLoad(chunks);
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "jsonl", fallbackReason: "legacy-manifest" });
    preference = "jsonl";
    cache.invalidate("manual");
    expect(cache.getDiagnosticState()).toEqual({ configuredPreference: "jsonl", effectiveSource: "not-loaded", fallbackReason: "none" });
    expect(canonicalReadCount(app.vault.adapter)).toBe(1);
  });

  it("distingue digest indisponível e recupera por JSONL", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = await makeBinaryApp(chunks, records, "publication-a", records, "publication-a");
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary", () => ({ digest: async () => { throw new BinaryEmbeddingStorageError("binary-digest-unavailable", "unavailable"); } }));
    expect(await cache.getOrLoad(chunks)).not.toBeNull();
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "jsonl", fallbackReason: "digest-unavailable", lastErrorCode: "binary-digest-unavailable" });
  });

  it("diagnostica limite de recursos, duração transitória e cache hit", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = await makeBinaryApp(chunks, records, "publication-a", records, "publication-a");
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary", createWebCryptoEmbeddingDigest, { limits: { ...DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS, maxRecordCount: 0 } });
    expect(await cache.getOrLoad(chunks)).not.toBeNull();
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "jsonl", fallbackReason: "binary-resource-limit", cacheHit: false });
    expect(cache.getDiagnosticState().loadDurationMs).toBeGreaterThanOrEqual(0);
    const jsonlCache = new RuntimeEmbeddingIndexCache(app as never);
    await jsonlCache.getOrLoad(chunks);
    await jsonlCache.getOrLoad(chunks);
    expect(jsonlCache.getDiagnosticState().cacheHit).toBe(true);
  });

  it("estimates JSONL peaks safely and rejects oversized JSONL before reading it", async () => {
    const limits = { maxJsonlBytes: 1_000, maxEstimatedPeakBytes: 10_000, workingMemoryReserveBytes: 100 };
    expect(estimateEmbeddingJsonlPeakBytes(100, 2, 3, limits)).toBe(100 + 200 + 400 + 24 + 768 + 100);
    expect(() => estimateEmbeddingJsonlPeakBytes(-1, 2, 3, limits)).toThrow("jsonl-size-overflow");
    expect(() => estimateEmbeddingJsonlPeakBytes(1, Number.MAX_SAFE_INTEGER, 3, limits)).toThrow("jsonl-size-overflow");
    const chunks = [makeChunk(1)]; const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])]);
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, undefined, undefined, {}, { profile: "mobile", jsonlLimits: { ...EMBEDDING_JSONL_RESOURCE_LIMITS.mobile, maxJsonlBytes: 1 } });
    expect(await cache.getOrLoad(chunks)).toBeNull();
    expect(canonicalReadCount(app.vault.adapter)).toBe(0);
    expect(cache.getDiagnosticState()).toMatchObject({ fallbackReason: "jsonl-resource-limit", lastErrorCode: "jsonl-estimated-peak-limit-exceeded" });
  });

  it("recalculates an unexpectedly large JSONL after reading without caching a partial index", async () => {
    const chunks = [makeChunk(1)]; const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])]);
    const originalStat = app.vault.adapter.stat.bind(app.vault.adapter);
    app.vault.adapter.stat = async (path) => path.endsWith("embeddings.jsonl") ? { type: "file", size: 1, mtime: 1 } : originalStat(path);
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, undefined, undefined, {}, { jsonlLimits: { maxJsonlBytes: 10, maxEstimatedPeakBytes: 1_000_000, workingMemoryReserveBytes: 0 } });
    expect(await cache.getOrLoad(chunks)).toBeNull();
    expect(canonicalReadCount(app.vault.adapter)).toBe(1);
    expect(cache.getState()).toBe("empty");
    expect(cache.getDiagnosticState().fallbackReason).toBe("jsonl-resource-limit");
  });

  it("falls back only when JSONL is safe and reports no safe source when both peaks exceed limits", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = await makeBinaryApp(chunks, records, "publication-a", records, "publication-a");
    const binaryLimits = { ...DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS, maxEstimatedPeakBytes: 1 };
    const fallback = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary", undefined, { limits: binaryLimits }, { profile: "mobile", jsonlLimits: EMBEDDING_JSONL_RESOURCE_LIMITS.mobile });
    expect(await fallback.getOrLoad(chunks)).not.toBeNull();
    expect(fallback.getDiagnosticState().fallbackReason).toBe("binary-resource-limit");
    const unsafe = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary", undefined, { limits: binaryLimits }, { profile: "mobile", jsonlLimits: { maxJsonlBytes: 1, maxEstimatedPeakBytes: 1, workingMemoryReserveBytes: 0 } });
    expect(await unsafe.getOrLoad(chunks)).toBeNull();
    expect(unsafe.getDiagnosticState()).toMatchObject({ fallbackReason: "no-safe-source", lastErrorCode: "no-safe-embedding-source" });
  });

  it("uses injected platform profiles without persisting them and keeps a small index eligible", async () => {
    expect(MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS.maxEstimatedPeakBytes).toBeLessThan(DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS.maxEstimatedPeakBytes);
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = await makeBinaryApp(chunks, records, "publication-a", records, "publication-a");
    const mobile = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary", undefined, {}, { profile: "mobile" });
    expect((await mobile.getOrLoad(chunks))?.sourceIdentity.storageFormat).toBe("binary-v1");
    expect(readFileSync(resolve(process.cwd(), "src/settings.ts"), "utf8")).not.toContain("maxEstimatedPeakBytes");
  });

  it("distingue JSONL ausente de manifesto canónico inválido", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])];
    const app = makeApp(chunks, records, 0, "publication-a");
    await app.vault.adapter.remove(".lina/index/embeddings.jsonl");
    const missing = new RuntimeEmbeddingIndexCache(app as never);
    expect(await missing.getOrLoad(chunks)).toBeNull();
    expect(missing.getDiagnosticState()).toMatchObject({ fallbackReason: "jsonl-read-failed", lastErrorCode: "jsonl-missing" });
    app.vault.adapter.setFile(".lina/index/manifest.json", "invalid");
    const invalid = new RuntimeEmbeddingIndexCache(app as never);
    expect(await invalid.getOrLoad(chunks)).toBeNull();
    expect(invalid.getDiagnosticState()).toMatchObject({ fallbackReason: "canonical-manifest-invalid" });
  });

  it("rejeita binário A perante JSONL B e mantém fallback JSONL disponível", async () => {
    const chunks = [makeChunk(1)]; const binaryA = [makeRecord(chunks[0]!, [1, 0, 0])]; const jsonlB = [makeRecord(chunks[0]!, [0, 1, 0])];
    const app = await makeBinaryApp(chunks, jsonlB, "publication-b", binaryA, "publication-a");
    const events: string[] = []; const index = await new RuntimeEmbeddingIndexCache(app as never, (event) => events.push(event), () => "prefer-binary").getOrLoad(chunks);
    expect(Array.from(index?.vectors ?? [])).toEqual([0, 1, 0]);
    expect(index?.sourceIdentity.storageFormat).not.toBe("binary-v1");
    expect(events).toContain("binary-fallback");
    expect(new RuntimeEmbeddingIndexCache(app as never, undefined, () => "jsonl").getDiagnosticState().effectiveSource).toBe("not-loaded");
  });

  it("invalida cache binário A quando uma publicação externa JSONL B altera apenas publicationId", async () => {
    const chunks = [makeChunk(1)]; const recordsA = [makeRecord(chunks[0]!, [1, 0, 0])]; const recordsB = [makeRecord(chunks[0]!, [0, 1, 0])];
    const app = await makeBinaryApp(chunks, recordsA, "publication-a", recordsA, "publication-a"); const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary");
    expect((await cache.getOrLoad(chunks))?.sourceIdentity.storageFormat).toBe("binary-v1");
    const manifest = JSON.parse(app.vault.adapter.getFile(".lina/index/manifest.json")!); manifest.embeddings.publicationId = "publication-b";
    app.vault.adapter.setFile(".lina/index/manifest.json", JSON.stringify(manifest)); app.vault.adapter.setFile(".lina/index/embeddings.jsonl", `${JSON.stringify(recordsB[0])}\n`);
    const reloaded = await cache.getOrLoad(chunks);
    expect(Array.from(reloaded?.vectors ?? [])).toEqual([0, 1, 0]);
    expect(reloaded?.sourceIdentity.storageFormat).not.toBe("binary-v1");
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "jsonl", fallbackReason: "binary-outdated", canonicalPublicationId: "publication-b", binarySourcePublicationId: "publication-a" });
  });

  it("torna binário B elegível na pesquisa seguinte quando chega depois do fallback JSONL", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [0, 1, 0])];
    const app = await makeBinaryApp(chunks, records, "publication-b", records, "publication-a");
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary");
    expect((await cache.getOrLoad(chunks))?.sourceIdentity.storageFormat).not.toBe("binary-v1");
    await new BinaryEmbeddingPublisher(app.vault.adapter, createWebCryptoEmbeddingDigest()).publish(records, { format: "binary-v1", identity: { provider, model, dimensions, inputVersion: 1, prefixMode: "none" }, recordCount: records.length, dimensions, generationId: "binary-publication-b", sourcePublicationId: "publication-b" });
    expect((await cache.getOrLoad(chunks))?.sourceIdentity.storageFormat).toBe("binary-v1");
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "binary", fallbackReason: "none", canonicalPublicationId: "publication-b" });
  });

  it("rejeita binário quando o manifesto JSONL está ausente ou inválido, sem alterar JSONL", async () => {
    const chunks = [makeChunk(1)]; const records = [makeRecord(chunks[0]!, [1, 0, 0])]; const app = await makeBinaryApp(chunks, records, "publication-a", records, "publication-a");
    const cache = new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary"); await cache.getOrLoad(chunks);
    app.vault.adapter.setFile(".lina/index/manifest.json", "invalid");
    expect(await cache.getOrLoad(chunks)).toBeNull();
    expect(cache.getState()).toBe("empty");
    expect(app.vault.adapter.getFile(".lina/index/embeddings.jsonl")).toContain("chunkId");
  });

  it("ignora temporários B incompletos e não atribui o binário canónico A ao JSONL B", async () => {
    const chunks = [makeChunk(1)]; const binaryA = [makeRecord(chunks[0]!, [1, 0, 0])]; const jsonlB = [makeRecord(chunks[0]!, [0, 1, 0])]; const app = await makeBinaryApp(chunks, jsonlB, "publication-b", binaryA, "publication-a");
    app.vault.adapter.setFile(BINARY_EMBEDDING_FILES.manifestTemporary, "partial-b");
    const index = await new RuntimeEmbeddingIndexCache(app as never, undefined, () => "prefer-binary").getOrLoad(chunks);
    expect(Array.from(index?.vectors ?? [])).toEqual([0, 1, 0]);
    expect(index?.sourceIdentity.publicationId).toBe("publication-b");
  });

  it("invalida depois de publicação textual ou canónica sem escrever formatos", async () => {
    const chunks = [makeChunk(1)];
    const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])]);
    const originalManifest = app.vault.adapter.getFile(".lina/index/manifest.json");
    const originalJsonl = app.vault.adapter.getFile(".lina/index/embeddings.jsonl");
    const cache = new RuntimeEmbeddingIndexCache(app as never);
    await cache.getOrLoad(chunks);
    cache.invalidate("text-index-published");
    await cache.getOrLoad(chunks);
    cache.invalidate("canonical-published");
    await cache.getOrLoad(chunks);
    expect(canonicalReadCount(app.vault.adapter)).toBe(3);
    expect(app.vault.adapter.writeCount).toBe(0);
    expect(app.vault.adapter.getFile(".lina/index/manifest.json")).toBe(originalManifest);
    expect(app.vault.adapter.getFile(".lina/index/embeddings.jsonl")).toBe(originalJsonl);
  });

  it("falha sem cache parcial, permite retry e ignora callback tardio após dispose", async () => {
    const chunks = [makeChunk(1)];
    const app = makeApp(chunks, [makeRecord(chunks[0]!, [1, 0, 0])], 2);
    app.vault.adapter.setOptions({ simulateReadError: true });
    const cache = new RuntimeEmbeddingIndexCache(app as never);
    expect(await cache.getOrLoad(chunks)).toBeNull();
    expect(cache.getState()).toBe("empty");
    expect(cache.getDiagnosticState().effectiveSource).toBe("not-loaded");
    app.vault.adapter.setOptions({ simulateReadError: false });
    const loading = cache.getOrLoad(chunks);
    cache.dispose();
    expect(await loading).toBeNull();
    expect(cache.getState()).toBe("disposed");
    expect(cache.getDiagnosticState()).toMatchObject({ effectiveSource: "not-loaded", fallbackReason: "none" });
  });

  it("exclui stale, obsolete, inválidos e duplicados através do calculador central", async () => {
    const chunks = [makeChunk(1), makeChunk(2)];
    const stale = makeRecord(chunks[1]!, [0, 1, 0], { textHash: "stale" });
    const obsolete = makeRecord({ ...makeChunk(3), chunkId: "removed.md::0" }, [0, 0, 1]);
    const invalid = makeRecord(chunks[1]!, [0, Number.NaN, 0]);
    const duplicate = makeRecord(chunks[0]!, [1, 0, 0]);
    const valid = makeRecord(chunks[0]!, [1, 0, 0]);
    const index = await new RuntimeEmbeddingIndexCache(makeApp(chunks, [valid, duplicate, stale, invalid, obsolete]) as never).getOrLoad(chunks);
    expect(index).toBeNull();
  });

  it("mantém cosine e ranking equivalentes dentro da precisão Float32", async () => {
    const chunks = [makeChunk(1), makeChunk(2), makeChunk(3)];
    const records = [
      makeRecord(chunks[0]!, [1, 0, 0]),
      makeRecord(chunks[1]!, [0.99, 0.01, 0]),
      makeRecord(chunks[2]!, [0, 1, 0]),
    ];
    const runtime = await new RuntimeEmbeddingIndexCache(makeApp(chunks, records) as never).getOrLoad(chunks);
    expect(runtime).not.toBeNull();
    const query = [1, 0, 0];
    const legacy = searchSemanticIndex(query, records, chunks, { minSimilarity: -1 });
    const resident = searchRuntimeSemanticIndex(Float32Array.from(query), runtime!, chunks, { minSimilarity: -1 });
    expect(resident.map((result) => result.chunkId)).toEqual(legacy.map((result) => result.chunkId));
    expect(cosineSimilarity(query, [0.99, 0.01, 0])).toBeCloseTo(resident[1]!.similarity, 6);
  });

  it("mantém a pesquisa híbrida textual completa quando o runtime não está disponível", async () => {
    const chunks = [makeChunk(1), makeChunk(2)];
    const result = await runHybridSearch(
      makeApp(chunks, []) as never,
      [
        { path: chunks[0]!.path, basename: "synthetic-1", extension: "md", size: 0, mtime: 0, contentHash: "a", indexedAt: "now" },
        { path: chunks[1]!.path, basename: "synthetic-2", extension: "md", size: 0, mtime: 0, contentHash: "b", indexedAt: "now" },
      ],
      chunks,
      "synthetic",
      {
        baseUrl: "",
        model,
        timeoutMs: 1,
        textWeight: 0.7,
        semanticWeight: 0.3,
        deviceProvider: provider,
        deviceModel: model,
        getRuntimeEmbeddingIndex: async () => null,
      }
    );
    expect(result.semanticUsed).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((entry) => entry.source === "textual")).toBe(true);
  });
});
