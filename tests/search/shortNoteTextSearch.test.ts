import { describe, expect, it, vi } from "vitest";
import { chunkText } from "../../src/index/chunker";
import { IndexedNote } from "../../src/index/indexStore";
import { runHybridSearch } from "../../src/search/hybridSearch";
import { searchTextIndex } from "../../src/search/textSearch";

const shortNote: IndexedNote = {
  path: "Short.md",
  basename: "Short",
  extension: "md",
  size: 22,
  mtime: 1,
  contentHash: "short-note-hash",
  indexedAt: "2026-08-18T19:00:00.000Z",
};

describe("short-note text and hybrid fallback search", () => {
  const chunks = chunkText(shortNote.path, "mafarrrico\n\num dó li tá");

  it("finds a short note through plain text search with an accented query", () => {
    expect(searchTextIndex([shortNote], chunks, "um dó")).toEqual([
      expect.objectContaining({ path: shortNote.path, origin: "conteudo" }),
    ]);
    expect(searchTextIndex([shortNote], chunks, "um do")).toHaveLength(1);
  });

  it("uses the original query for hybrid text fallback when filtering removes every term", async () => {
    const getRuntimeEmbeddingIndex = vi.fn(async () => null);

    const result = await runHybridSearch({} as never, [shortNote], chunks, "um dó", {
      baseUrl: "",
      model: "mistral-embed",
      timeoutMs: 60_000,
      textWeight: 0.7,
      semanticWeight: 0.3,
      deviceProvider: "mistral",
      deviceModel: "mistral-embed",
      getRuntimeEmbeddingIndex,
    });

    expect(getRuntimeEmbeddingIndex).toHaveBeenCalledWith(chunks);
    expect(result.semanticUsed).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.results).toEqual([
      expect.objectContaining({ path: shortNote.path, source: "textual" }),
    ]);
  });

  it("keeps ordinary hybrid text queries on their filtered path", async () => {
    const result = await runHybridSearch({} as never, [shortNote], chunks, "mafarrrico", {
      baseUrl: "",
      model: "mistral-embed",
      timeoutMs: 60_000,
      textWeight: 0.7,
      semanticWeight: 0.3,
      deviceProvider: "mistral",
      deviceModel: "mistral-embed",
      getRuntimeEmbeddingIndex: async () => null,
    });

    expect(result.results).toEqual([
      expect.objectContaining({ path: shortNote.path, source: "textual" }),
    ]);
  });
});
