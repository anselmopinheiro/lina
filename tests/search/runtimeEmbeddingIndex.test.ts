import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Chunk } from "../../src/index/chunker";
import { EmbeddingRecord, buildEmbeddingInput } from "../../src/index/embeddingGenerator";
import { hashContent } from "../../src/index/noteHasher";
import { RuntimeEmbeddingIndexCache } from "../../src/search/runtimeEmbeddingIndex";
import { cosineSimilarity, searchRuntimeSemanticIndex, searchSemanticIndex } from "../../src/search/semanticSearch";
import { runHybridSearch } from "../../src/search/hybridSearch";
import { FakeAdapter } from "../helpers/fakeAdapter";

const provider = "ollama";
const model = "nomic-embed-text";
const dimensions = 3;

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

function makeApp(chunks: Chunk[], records: EmbeddingRecord[], delay = 0): { vault: { adapter: FakeAdapter } } {
  const manifest = {
    embeddingsEnabled: true,
    embeddings: { provider, model, dimensions, updatedAt: "2026-07-24T00:00:00.000Z" },
    embeddingInput: { version: 1, prefixMode: "none" },
  };
  const adapter = new FakeAdapter({
    ".lina/index/manifest.json": JSON.stringify(manifest),
    ".lina/index/embeddings.jsonl": `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  }, { operationDelayMs: delay });
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
    app.vault.adapter.setOptions({ simulateReadError: false });
    const loading = cache.getOrLoad(chunks);
    cache.dispose();
    expect(await loading).toBeNull();
    expect(cache.getState()).toBe("disposed");
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
