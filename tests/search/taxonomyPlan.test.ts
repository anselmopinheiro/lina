import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";
import {
  runSemanticTaxonomyExperiment,
  type SemanticTaxonomyExperimentResult,
} from "../../src/search/semanticTaxonomyExperiment";
import { buildSemanticTaxonomyDiagnostic } from "../../src/search/semanticTaxonomyDiagnostic";
import { buildTaxonomyPlan, listPlannableYamlProperties } from "../../src/search/taxonomyPlan";

const ALLOWED = "tipo, area, contexto, estado, tags";

interface NoteFixture {
  readonly path: string;
  readonly vector?: readonly number[];
  readonly tags?: readonly string[];
  readonly frontmatter?: Readonly<Record<string, unknown>>;
}

function experiment(notes: readonly NoteFixture[], sourcePath = "n.md"): SemanticTaxonomyExperimentResult {
  const index: RuntimeEmbeddingIndex = {
    dimensions: 2,
    count: notes.length,
    vectors: new Float32Array(notes.flatMap(note => note.vector ?? [1, 0])),
    records: notes.map((note, ordinal) => ({
      vectorOrdinal: ordinal,
      chunkId: `chunk-${ordinal}`,
      path: note.path,
      index: ordinal,
      textHash: `hash-${ordinal}`,
    })),
    provider: "test",
    model: "test",
    sourceIdentity: {} as RuntimeEmbeddingIndex["sourceIdentity"],
  };
  const byPath = new Map(notes.map(note => [note.path, note]));
  return runSemanticTaxonomyExperiment(
    index,
    sourcePath,
    {
      getFileCache: file => {
        const note = byPath.get((file as { path: string }).path);
        return note ? { tags: note.tags?.map(tag => ({ tag })), frontmatter: note.frontmatter } : null;
      },
    },
    { getAbstractFileByPath: path => (byPath.has(path) ? { path } : null) },
    { topK: 10, maxTags: 8, yamlAllowedProperties: ALLOWED },
  );
}

const plan = (notes: readonly NoteFixture[]) => buildTaxonomyPlan(experiment(notes), { yamlAllowedProperties: ALLOWED });
const yamlOf = (result: ReturnType<typeof plan>, property: string) =>
  result.yaml.properties.find(item => item.property === property);

const SOURCE: NoteFixture = { path: "n.md" };

describe("taxonomy plan — tags", () => {
  it("is LOCAL_SUFFICIENT when a tag has enough neighbor support", () => {
    const result = plan([SOURCE,
      { path: "a.md", tags: ["escola"] }, { path: "b.md", tags: ["escola"] }, { path: "c.md", tags: ["outra"] }]);

    expect(result.tags.sufficiency).toBe("LOCAL_SUFFICIENT");
    expect(result.tags.needsAi).toBe(false);
    expect(result.tags.source).toBe("local");
    expect(result.tags.candidates).toEqual([{ tag: "escola", support: 2, neighborTotal: 3 }]);
  });

  it("is LOCAL_INSUFFICIENT when candidates exist but none reaches the support", () => {
    const result = plan([SOURCE,
      { path: "a.md", tags: ["joana"] }, { path: "b.md", tags: ["maria"] }, { path: "c.md", tags: ["rui"] }]);

    expect(result.tags.sufficiency).toBe("LOCAL_INSUFFICIENT");
    expect(result.tags.needsAi).toBe(true);
    expect(result.tags.reason).toBe("no-qualifying-tag");
    expect(result.tags.candidates).toEqual([]);
    expect(result.tags.evidence.qualifyingCount).toBe(0);
  });

  it("preserves hierarchical tag identity", () => {
    const result = plan([SOURCE,
      { path: "a.md", tags: ["Direção/Turma"] }, { path: "b.md", tags: ["direção/turma"] }, { path: "c.md", tags: ["direcaoturma"] }]);

    expect(result.tags.candidates.map(item => item.tag)).toEqual(["Direção/Turma"]);
    expect(result.tags.candidates[0]?.support).toBe(2);
  });
});

describe("taxonomy plan — yaml", () => {
  const strong = (property: string, value: unknown): NoteFixture[] => [
    { path: `${property}-1.md`, frontmatter: { [property]: value } },
    { path: `${property}-2.md`, frontmatter: { [property]: value } },
  ];

  it("resolves every property locally when all are supported", () => {
    const result = plan([SOURCE, ...strong("tipo", "contacto_ee"), ...strong("area", "escolar"),
      ...strong("contexto", "turma"), ...strong("estado", "ativo")]);

    expect(result.yaml.properties.map(item => [item.property, item.source])).toEqual([
      ["tipo", "local"], ["area", "local"], ["contexto", "local"], ["estado", "local"],
    ]);
    expect(result.yaml.needsAi).toBe(false);
  });

  it("resolves some properties locally and leaves the others to AI", () => {
    const result = plan([SOURCE, ...strong("tipo", "contacto_ee"), { path: "x.md", frontmatter: { contexto: "unico" } }]);

    expect(yamlOf(result, "tipo")).toMatchObject({ source: "local", needsAi: false, reason: "local-supported" });
    expect(yamlOf(result, "contexto")).toMatchObject({ source: "ai-needed", needsAi: true, reason: "insufficient-support" });
    expect(yamlOf(result, "area")).toMatchObject({ source: "ai-needed", needsAi: true, reason: "no-candidate" });
    expect(result.yaml.needsAi).toBe(true);
  });

  it("flags competing values with equal support as ambiguous", () => {
    const result = plan([SOURCE,
      { path: "a.md", frontmatter: { estado: "ativo" } }, { path: "b.md", frontmatter: { estado: "ativo" } },
      { path: "c.md", frontmatter: { estado: "fechado" } }, { path: "d.md", frontmatter: { estado: "fechado" } }]);

    expect(yamlOf(result, "estado")).toMatchObject({ source: "ai-needed", needsAi: true, reason: "ambiguous" });
    expect(yamlOf(result, "estado")?.evidence.bestSupport).toBe(2);
  });

  it("does not turn typed non-writable evidence into a proposal", () => {
    const result = plan([SOURCE, ...strong("area", 2024), ...strong("estado", true)]);

    expect(yamlOf(result, "area")).toMatchObject({ source: "none", needsAi: false, reason: "not-writable" });
    expect(yamlOf(result, "area")?.candidate).toBeUndefined();
    expect(yamlOf(result, "estado")).toMatchObject({ source: "none", reason: "not-writable" });
  });

  it("respects the allow-list and excludes tags and duplicates", () => {
    expect(listPlannableYamlProperties("tipo, Tipo, tags, area, ,estado"))
      .toEqual(["tipo", "area", "estado"]);
    const result = plan([SOURCE, ...strong("projeto", "lina")]);
    expect(result.yaml.properties.some(item => item.property === "projeto")).toBe(false);
  });

  it("produces no yaml plan when yaml suggestions are disabled", () => {
    const result = buildTaxonomyPlan(experiment([SOURCE, ...strong("tipo", "x")]), {
      yamlAllowedProperties: ALLOWED,
      yamlEnabled: false,
    });

    expect(result.yaml).toEqual({ enabled: false, properties: [], needsAi: false });
  });
});

describe("taxonomy plan — combinations and cases", () => {
  it("contacto_ee: tags need AI, tipo is local", () => {
    const contacts: NoteFixture[] = ["joana", "maria", "rui", "ana", "luis"].map((name, index) => ({
      path: `contactos/${name}.md`,
      tags: [name],
      frontmatter: index < 4 ? { tipo: "contacto_ee" } : { tipo: "outro" },
    }));
    const result = plan([SOURCE, ...contacts]);

    expect(result.tags.needsAi).toBe(true);
    expect(result.tags.sufficiency).toBe("LOCAL_INSUFFICIENT");
    expect(yamlOf(result, "tipo")).toMatchObject({
      source: "local",
      needsAi: false,
      candidate: { value: "contacto_ee", support: 4, neighborTotal: 5 },
    });
    expect(yamlOf(result, "area")?.needsAi).toBe(true);
    expect(result.needsAi).toBe(true);
  });

  it("sufficient tags with partial yaml still needs AI overall", () => {
    const result = plan([SOURCE,
      { path: "a.md", tags: ["escola"], frontmatter: { tipo: "x" } },
      { path: "b.md", tags: ["escola"], frontmatter: { tipo: "x" } }]);

    expect(result.tags.needsAi).toBe(false);
    expect(result.yaml.needsAi).toBe(true);
    expect(result.needsAi).toBe(true);
  });

  it("needs AI for everything when there is no local taxonomy", () => {
    const result = plan([SOURCE, { path: "a.md" }, { path: "b.md" }]);

    expect(result.tags.needsAi).toBe(true);
    expect(result.yaml.properties.every(item => item.needsAi && item.reason === "no-candidate")).toBe(true);
  });

  it("needs AI everywhere when the neighborhood is unavailable", () => {
    const result = plan([{ path: "a.md", tags: ["x"] }]); // source note is not indexed

    expect(result.neighborhoodStatus).toBe("source-not-indexed");
    expect(result.tags.reason).toBe("neighborhood-unavailable");
    expect(result.yaml.properties.every(item => item.reason === "neighborhood-unavailable")).toBe(true);
  });
});

describe("taxonomy plan — purity and non-regression", () => {
  const notes: NoteFixture[] = [SOURCE,
    { path: "a.md", tags: ["escola"], frontmatter: { tipo: "x" } },
    { path: "b.md", tags: ["escola"], frontmatter: { tipo: "x" } }];

  it("is deterministic and does not mutate its input", () => {
    const input = experiment(notes);
    const before = JSON.stringify(input);

    const first = buildTaxonomyPlan(input, { yamlAllowedProperties: ALLOWED });
    const second = buildTaxonomyPlan(input, { yamlAllowedProperties: ALLOWED });

    expect(first).toEqual(second);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("carries only counts and candidates, never vectors or probabilities", () => {
    const serialized = JSON.stringify(plan(notes));

    expect(serialized).not.toMatch(/vector|probab|percent/i);
  });

  it("is a pure module with no provider, embedding, vault or write dependency", () => {
    const source = readFileSync("src/search/taxonomyPlan.ts", "utf8");
    const imports = source.split("\n").filter(line => line.startsWith("import"));

    expect(imports.join("\n")).not.toMatch(/obsidian|provider|embedding|hybrid|vault|fetch|requestUrl|settings/i);
    expect(source).not.toMatch(/\bfetch\(|requestUrl|\.modify\(|saveData|writeFile|await |async /);
  });

  it("keeps the diagnostic additive and routes the plan through the existing analysis call", () => {
    const diagnostic = buildSemanticTaxonomyDiagnostic(experiment(notes), plan(notes)).lines.join("\n");
    expect(diagnostic).toContain("PLANO");
    expect(diagnostic).toContain("tipo: local");

    const view = readFileSync("src/search/linaSearchView.ts", "utf8");
    expect(view).toContain("const taxonomyRequest = taxonomyRuntime?.request;");
    expect(view).toContain("reconcileTaxonomyRuntime(");
    const start = view.indexOf("private buildCurrentNoteAnalysisPrompt(");
    const end = view.indexOf("private createSelectableItem(");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(view.slice(start, end)).toContain("taxonomyRequest?: TaxonomyAiRequest");
  });
});
