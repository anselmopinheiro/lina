import { describe, expect, it } from "vitest";
import { Chunk } from "../../src/index/chunker";
import { EMBEDDING_INPUT_VERSION, EmbeddingRecord, buildEmbeddingInput, getPrefixModeForModel } from "../../src/index/embeddingGenerator";
import { hashContent } from "../../src/index/noteHasher";
import { getSemanticSearchAvailability } from "../../src/search/hybridSearch";
import { FakeAdapter } from "../helpers/fakeAdapter";

function makeChunk(name: string, text: string): Chunk {
  return {
    chunkId: `${name}.md::0`,
    path: `${name}.md`,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-08-18T18:00:00.000Z",
  };
}

function makeRecord(chunk: Chunk, provider: string, model: string): EmbeddingRecord {
  const prefixMode = getPrefixModeForModel(model);
  return {
    chunkId: chunk.chunkId,
    path: chunk.path,
    index: chunk.chunkIndex,
    textHash: chunk.textHash,
    provider,
    model,
    dimensions: 3,
    embedding: [1, 2, 3],
    createdAt: "2026-08-18T18:00:00.000Z",
    embeddingInputHash: hashContent(buildEmbeddingInput(chunk, prefixMode)),
  };
}

describe("semantic availability after local text-index changes", () => {
  it.each([
    ["openrouter", "openai/text-embedding-3-small", "mistral", "mistral-embed"],
    ["openrouter", "openai/text-embedding-3-small", "ollama", "nomic-embed-text-v2-moe"],
    ["mistral", "mistral-embed", "openrouter", "openai/text-embedding-3-small"],
    ["ollama", "model-A", "ollama", "model-B"],
  ])("marks published %s/%s incompatible with configured %s/%s without provider calls", async (
    publishedProvider,
    publishedModel,
    configuredProvider,
    configuredModel,
  ) => {
    const chunk = makeChunk("Identity", "A canonical chunk that is unchanged on disk.");
    const record = makeRecord(chunk, publishedProvider, publishedModel);
    const adapter = new FakeAdapter({
      ".lina/index/embeddings.jsonl": `${JSON.stringify(record)}\n`,
      ".lina/index/manifest.json": JSON.stringify({
        embeddingsEnabled: true,
        embeddings: { enabled: true, provider: publishedProvider, model: publishedModel, dimensions: 3, updatedAt: "2026-08-18T18:00:00.000Z" },
        embeddingInput: { version: EMBEDDING_INPUT_VERSION, prefixMode: getPrefixModeForModel(publishedModel) },
      }),
    });

    const incompatible = await getSemanticSearchAvailability(
      { vault: { adapter } } as never,
      configuredProvider,
      configuredModel,
      [chunk],
    );
    const restored = await getSemanticSearchAvailability(
      { vault: { adapter } } as never,
      publishedProvider,
      publishedModel,
      [chunk],
    );

    expect(incompatible).toMatchObject({
      available: false,
      indexProvider: publishedProvider,
      indexModel: publishedModel,
      deviceProvider: configuredProvider,
      deviceModel: configuredModel,
    });
    expect(incompatible.reason).toContain("não é compatível");
    expect(restored).toMatchObject({ available: true, indexProvider: publishedProvider, indexModel: publishedModel });
    expect(adapter.writeCount).toBe(0);
    expect(adapter.renameCount).toBe(0);
  });

  it.each([
    ["mistral", "mistral-embed"],
    ["openrouter", "openai/text-embedding-3-small"],
  ])("keeps unchanged %s chunks semantically searchable without provider calls", async (provider, model) => {
    const unchangedChunk = makeChunk("Unchanged", "A chunk already embedded by the manual provider.");
    const changedChunk = makeChunk("Changed", "A later text-index update that still needs an embedding.");
    const record = makeRecord(unchangedChunk, provider, model);
    const adapter = new FakeAdapter({
      ".lina/index/embeddings.jsonl": `${JSON.stringify(record)}\n`,
      ".lina/index/manifest.json": JSON.stringify({
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider,
          model,
          dimensions: 3,
          updatedAt: "2026-08-18T18:00:00.000Z",
          sourceTotalChunks: 1,
        },
        embeddingInput: {
          version: EMBEDDING_INPUT_VERSION,
          prefixMode: getPrefixModeForModel(model),
        },
      }),
    });

    const availability = await getSemanticSearchAvailability(
      { vault: { adapter } } as never,
      provider,
      model,
      [unchangedChunk, changedChunk],
    );

    expect(availability).toMatchObject({
      available: true,
      indexProvider: provider,
      indexModel: model,
    });
    expect(availability.validForSearchChunkIds).toEqual(new Set([unchangedChunk.chunkId]));
    expect(adapter.writeCount).toBe(0);
    expect(adapter.renameCount).toBe(0);
  });

  it("reports manifest identity mismatch before unreadable JSONL details", async () => {
    const adapter = new FakeAdapter({
      ".lina/index/embeddings.jsonl": "{}\n",
      ".lina/index/manifest.json": JSON.stringify({
        embeddingsEnabled: true,
        embeddings: { provider: "openrouter", model: "openai/text-embedding-3-small", dimensions: 1536, updatedAt: "2026-08-19T00:00:00.000Z" },
        embeddingInput: { version: EMBEDDING_INPUT_VERSION, prefixMode: "none" },
      }),
    });
    const originalStat = adapter.stat.bind(adapter);
    adapter.stat = async (path) => path.endsWith("embeddings.jsonl")
      ? { type: "file", size: 60 * 1024 * 1024, mtime: 1 }
      : originalStat(path);

    const availability = await getSemanticSearchAvailability(
      { vault: { adapter } } as never,
      "mistral",
      "mistral-embed",
    );

    expect(availability).toMatchObject({ available: false, indexProvider: "openrouter", deviceProvider: "mistral" });
    expect(availability.reason).toContain("não é compatível");
    expect(availability.reason).not.toContain("não existem ou estão vazios");
    expect(adapter.readPaths.filter((path) => path.endsWith("embeddings.jsonl"))).toHaveLength(0);
  });

  it("keeps compatible but unreadable canonical embeddings indeterminate", async () => {
    const provider = "openrouter";
    const model = "openai/text-embedding-3-small";
    const adapter = new FakeAdapter({
      ".lina/index/embeddings.jsonl": "{}\n",
      ".lina/index/manifest.json": JSON.stringify({
        embeddingsEnabled: true,
        embeddings: { provider, model, dimensions: 1536, updatedAt: "2026-08-19T00:00:00.000Z" },
        embeddingInput: { version: EMBEDDING_INPUT_VERSION, prefixMode: "none" },
      }),
    });
    const originalStat = adapter.stat.bind(adapter);
    adapter.stat = async (path) => path.endsWith("embeddings.jsonl")
      ? { type: "file", size: 60 * 1024 * 1024, mtime: 1 }
      : originalStat(path);

    const availability = await getSemanticSearchAvailability({ vault: { adapter } } as never, provider, model);

    expect(availability).toMatchObject({ available: false, indexProvider: provider, indexModel: model });
    expect(availability.reason).toContain("verificar os detalhes");
    expect(availability.reason).not.toContain("não existem ou estão vazios");
  });

  it("distinguishes physically missing from present and truly empty canonical storage", async () => {
    const manifest = JSON.stringify({
      embeddingsEnabled: true,
      embeddings: { provider: "mistral", model: "mistral-embed", dimensions: 1024, updatedAt: "2026-08-19T00:00:00.000Z" },
      embeddingInput: { version: EMBEDDING_INPUT_VERSION, prefixMode: "none" },
    });
    const missing = new FakeAdapter({ ".lina/index/manifest.json": manifest });
    const empty = new FakeAdapter({
      ".lina/index/manifest.json": manifest,
      ".lina/index/embeddings.jsonl": "",
    });

    await expect(getSemanticSearchAvailability({ vault: { adapter: missing } } as never, "mistral", "mistral-embed"))
      .resolves.toMatchObject({ available: false, reason: "Embeddings não existem ou estão vazios." });
    await expect(getSemanticSearchAvailability({ vault: { adapter: empty } } as never, "mistral", "mistral-embed"))
      .resolves.toMatchObject({ available: false, reason: "Embeddings não existem ou estão vazios." });
  });
});
