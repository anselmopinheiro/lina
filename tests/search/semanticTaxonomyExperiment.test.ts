import { describe, expect, it } from "vitest";
import { RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";
import { runSemanticTaxonomyExperiment, SemanticTaxonomyMetadataCache, SemanticTaxonomyFileResolver } from "../../src/search/semanticTaxonomyExperiment";

function index(entries: ReadonlyArray<{ path: string; vector: readonly number[] }>): RuntimeEmbeddingIndex {
  return {
    dimensions: 2,
    count: entries.length,
    vectors: new Float32Array(entries.flatMap(entry => entry.vector)),
    records: entries.map((entry, ordinal) => ({ vectorOrdinal: ordinal, chunkId: `chunk-${ordinal}`, path: entry.path, index: ordinal, textHash: `hash-${ordinal}` })),
    provider: "test",
    model: "test",
    sourceIdentity: {} as RuntimeEmbeddingIndex["sourceIdentity"],
  };
}

function metadata(notes: Readonly<Record<string, { tags?: readonly string[]; frontmatter?: Readonly<Record<string, unknown>> }>>): {
  cache: SemanticTaxonomyMetadataCache;
  files: SemanticTaxonomyFileResolver;
} {
  const files = new Map(Object.keys(notes).map(path => [path, { path }]));
  return {
    files: { getAbstractFileByPath: path => files.get(path) ?? null },
    cache: {
      getFileCache: file => {
        const note = notes[(file as { path: string }).path];
        return note ? {
          tags: note.tags?.map(tag => ({ tag })),
          frontmatter: note.frontmatter,
        } : null;
      },
      getTags: () => ({ "#direcao/turma": 8, "#episodica": 1 }),
    },
  };
}

const options = { topK: 3, maxTags: 3, yamlAllowedProperties: "area, estado, tags" };

describe("semantic taxonomy experiment", () => {
  it("compares current input with factual local tags and YAML from metadata", () => {
    const runtime = index([
      { path: "Source.md", vector: [1, 0] },
      { path: "Near-1.md", vector: [0.99, 0.01] },
      { path: "Near-2.md", vector: [0.98, 0.02] },
      { path: "Near-3.md", vector: [0.97, 0.03] },
    ]);
    const { cache, files } = metadata({
      "Near-1.md": { tags: ["direcao/turma", "episodica"], frontmatter: { area: "escolar", estado: "ativo", tags: ["ignored"] } },
      "Near-2.md": { tags: ["direcao/turma"], frontmatter: { area: "escolar", estado: "ativo" } },
      "Near-3.md": { tags: ["direcao/turma"], frontmatter: { area: "escolar", estado: "arquivado" } },
    });

    const result = runSemanticTaxonomyExperiment(runtime, "Source.md", cache, files, {
      ...options,
      current: { tags: ["atual"], yaml: { area: "pessoal" } },
    });

    expect(result.current).toEqual({ tags: ["atual"], yaml: { area: "pessoal" } });
    expect(result.local.tags[0]).toMatchObject({ tag: "direcao/turma", neighborCount: 3, neighborTotal: 3 });
    expect(result.local.yaml[0]).toMatchObject({ property: "area", value: "escolar", neighborCount: 3 });
  });

  it("keeps single-neighbor tags as fallbacks without letting them dominate", () => {
    const runtime = index([
      { path: "Source.md", vector: [1, 0] },
      { path: "Near-1.md", vector: [1, 0] },
      { path: "Near-2.md", vector: [0.9, 0.1] },
    ]);
    const { cache, files } = metadata({
      "Near-1.md": { tags: ["episodica", "consolidada"] },
      "Near-2.md": { tags: ["consolidada"] },
    });

    expect(runSemanticTaxonomyExperiment(runtime, "Source.md", cache, files, options).local.tags.map(tag => tag.tag))
      .toEqual(["consolidada", "episodica"]);
  });

  it("omits ambiguous YAML values and changes taxonomy for a distant note", () => {
    const runtime = index([
      { path: "A.md", vector: [1, 0] },
      { path: "B.md", vector: [1, 0] },
      { path: "C.md", vector: [1, 0] },
      { path: "D.md", vector: [0, 1] },
      { path: "E.md", vector: [0.01, 0.99] },
    ]);
    const { cache, files } = metadata({
      "B.md": { tags: ["taxonomia-a"], frontmatter: { area: "a" } },
      "C.md": { tags: ["taxonomia-a"], frontmatter: { area: "b" } },
      "D.md": { tags: ["taxonomia-d"], frontmatter: { area: "d" } },
      "E.md": { tags: ["taxonomia-d"], frontmatter: { area: "d" } },
    });

    const localA = runSemanticTaxonomyExperiment(runtime, "A.md", cache, files, { ...options, topK: 2, minimumYamlSupport: 1 });
    const localD = runSemanticTaxonomyExperiment(runtime, "D.md", cache, files, { ...options, topK: 1, minimumYamlSupport: 1 });
    expect(localA.local.tags[0]?.tag).toBe("taxonomia-a");
    expect(localA.local.yaml).toEqual([]);
    expect(localD.local.tags[0]?.tag).toBe("taxonomia-d");
  });

  it("returns no local taxonomy when the source note is not indexed", () => {
    const runtime = index([{ path: "A.md", vector: [1, 0] }]);
    const { cache, files } = metadata({});
    expect(runSemanticTaxonomyExperiment(runtime, "Missing.md", cache, files, options))
      .toMatchObject({ neighborhoodStatus: "source-not-indexed", local: { tags: [], yaml: [] } });
  });

  it("keeps typed metadata evidence distinct without coercing it to text", () => {
    const runtime = index([
      { path: "Source.md", vector: [1, 0] },
      { path: "Near-1.md", vector: [0.99, 0.01] },
      { path: "Near-2.md", vector: [0.98, 0.02] },
    ]);
    const { cache, files } = metadata({
      "Near-1.md": { frontmatter: { prioridade: 1, publicado: true, invalido: { nested: true } } },
      "Near-2.md": { frontmatter: { prioridade: "1", publicado: "true", invalido: ["ok", 1] } },
    });

    const result = runSemanticTaxonomyExperiment(runtime, "Source.md", cache, files, {
      ...options,
      yamlAllowedProperties: "prioridade, publicado, invalido",
      minimumYamlSupport: 1,
    });

    expect(result.local.yaml).toEqual([
      expect.objectContaining({ property: "prioridade", value: 1 }),
      expect.objectContaining({ property: "publicado", value: true }),
    ]);
  });
});
