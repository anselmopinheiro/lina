import { describe, expect, it } from "vitest";
import { chunkText } from "../../src/index/chunker";
import type { IndexedNote } from "../../src/index/indexStore";
import { normalizeSearchQuery } from "../../src/search/queryNormalization";
import { runHybridSearch } from "../../src/search/hybridSearch";
import { searchTextIndex } from "../../src/search/textSearch";

const note: IndexedNote = {
  path: "Comida.md", basename: "Comida", extension: "md", size: 0,
  mtime: 0, contentHash: "query-normalization", indexedAt: "now",
};
const chunks = chunkText(note.path, "Comida pessoas e café.");

describe("normalizeSearchQuery", () => {
  it.each(["comida pessoas", "Comida pessoas", "ComidA   pessoas", "  ComidA\t pessoas\n"])(
    "normaliza %j para a chave canónica", (input) => {
      expect(normalizeSearchQuery(input)).toBe("comida pessoas");
    }
  );

  it("usa NFC, preserva acentos e aceita Unicode canonicamente equivalente", () => {
    expect(normalizeSearchQuery(" Café ")).toBe("café");
    expect(normalizeSearchQuery("CAFE\u0301")).toBe("café");
  });

  it("mantém a query vazia após normalização", () => {
    expect(normalizeSearchQuery(" \t\n ")).toBe("");
  });

  it("faz a pesquisa textual e a fallback híbrida equivalentes", async () => {
    const inputs = ["comida pessoas", "Comida pessoas", "ComidA   pessoas"];
    const textResults = inputs.map((query) => searchTextIndex([note], chunks, query));
    expect(textResults[1]).toEqual(textResults[0]);
    expect(textResults[2]).toEqual(textResults[0]);

    const hybridResults = await Promise.all(inputs.map((query) => runHybridSearch({} as never, [note], chunks, query, {
      baseUrl: "", model: "mistral-embed", timeoutMs: 1, textWeight: 0.7, semanticWeight: 0.3,
      deviceProvider: "mistral", deviceModel: "mistral-embed", getRuntimeEmbeddingIndex: async () => null,
    })));
    expect(hybridResults.map((result) => result.results)).toEqual([
      hybridResults[0]!.results,
      hybridResults[0]!.results,
      hybridResults[0]!.results,
    ]);
  });
});
