import { describe, expect, it } from "vitest";
import { RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";
import { findSemanticNeighborhood } from "../../src/search/semanticNeighborhood";

function makeIndex(
  dimensions: number,
  entries: ReadonlyArray<{ chunkId: string; path: string; vector: readonly number[] }>,
): RuntimeEmbeddingIndex {
  return {
    dimensions,
    count: entries.length,
    vectors: new Float32Array(entries.flatMap(entry => entry.vector)),
    records: entries.map((entry, ordinal) => ({
      vectorOrdinal: ordinal,
      chunkId: entry.chunkId,
      path: entry.path,
      index: ordinal,
      textHash: `hash-${ordinal}`,
    })),
    provider: "test",
    model: "test",
    sourceIdentity: {} as RuntimeEmbeddingIndex["sourceIdentity"],
  };
}

describe("semantic neighborhood", () => {
  it("represents a single-chunk note and excludes the source note", () => {
    const index = makeIndex(2, [
      { chunkId: "a1", path: "A.md", vector: [1, 0] },
      { chunkId: "b1", path: "B.md", vector: [0.9, 0.1] },
    ]);

    expect(findSemanticNeighborhood(index, "A.md", 3)).toEqual({
      status: "ok",
      neighbors: [{ path: "B.md", score: expect.closeTo(0.9938837347, 8) }],
    });
  });

  it("uses the normalized mean across multiple chunks", () => {
    const index = makeIndex(2, [
      { chunkId: "a1", path: "A.md", vector: [2, 0] },
      { chunkId: "a2", path: "A.md", vector: [0, 3] },
      { chunkId: "b1", path: "B.md", vector: [1, 1] },
      { chunkId: "c1", path: "C.md", vector: [1, 0] },
    ]);

    const result = findSemanticNeighborhood(index, "A.md", 2);
    expect(result.status).toBe("ok");
    expect(result.neighbors.map(neighbor => neighbor.path)).toEqual(["B.md", "C.md"]);
    expect(result.neighbors[0]?.score).toBeCloseTo(1, 6);
  });

  it("ranks by similarity, respects Top-K, and uses path as a stable tie-break", () => {
    const index = makeIndex(2, [
      { chunkId: "a", path: "Source.md", vector: [1, 0] },
      { chunkId: "b", path: "Z.md", vector: [0, 1] },
      { chunkId: "c", path: "A.md", vector: [0, 1] },
      { chunkId: "d", path: "Near.md", vector: [0.8, 0.2] },
    ]);

    expect(findSemanticNeighborhood(index, "Source.md", 2).neighbors.map(neighbor => neighbor.path))
      .toEqual(["Near.md", "A.md"]);
  });

  it("reports missing sources, empty indexes, invalid mappings, and a large Top-K explicitly", () => {
    const empty = makeIndex(2, []);
    expect(findSemanticNeighborhood(empty, "A.md", 2)).toEqual({ status: "empty-index", neighbors: [] });

    const index = makeIndex(2, [
      { chunkId: "a", path: "A.md", vector: [1, 0] },
      { chunkId: "b", path: "B.md", vector: [0, 1] },
    ]);
    expect(findSemanticNeighborhood(index, "Missing.md", 2)).toEqual({ status: "source-not-indexed", neighbors: [] });
    expect(findSemanticNeighborhood(index, "A.md", 99).neighbors).toHaveLength(1);

    const invalid = {
      ...index,
      records: [index.records[0]!, { ...index.records[1]!, chunkId: "a" }],
    };
    expect(findSemanticNeighborhood(invalid, "A.md", 2)).toEqual({ status: "invalid-index", neighbors: [] });
  });

  it("gives strongly overlapping neighborhoods to semantically close notes", () => {
    const index = makeIndex(3, [
      { chunkId: "a", path: "A.md", vector: [1, 0, 0] },
      { chunkId: "b", path: "B.md", vector: [0.99, 0.01, 0] },
      { chunkId: "c", path: "C.md", vector: [0.98, 0.02, 0] },
      { chunkId: "d", path: "D.md", vector: [0, 1, 0] },
    ]);

    expect(findSemanticNeighborhood(index, "A.md", 2).neighbors.map(neighbor => neighbor.path)).toEqual(["B.md", "C.md"]);
    expect(findSemanticNeighborhood(index, "B.md", 2).neighbors.map(neighbor => neighbor.path)).toEqual(["A.md", "C.md"]);
  });

  it("does not depend on any provider, embedding generation, or UI object", () => {
    const index = makeIndex(2, [
      { chunkId: "a", path: "A.md", vector: [0, 0] },
    ]);

    expect(findSemanticNeighborhood(index, "A.md", 1)).toEqual({ status: "source-no-valid-vector", neighbors: [] });
  });
});
