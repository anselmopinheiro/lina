import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareTaxonomyRuntime, reconcileTaxonomyRuntime, fallbackTaxonomyRuntime } from "../../src/search/taxonomyRuntime";
import type { SemanticTaxonomyExperimentResult } from "../../src/search/semanticTaxonomyExperiment";

const result = (tags: SemanticTaxonomyExperimentResult["local"]["tags"] = [], yaml: SemanticTaxonomyExperimentResult["local"]["yaml"] = []): SemanticTaxonomyExperimentResult => ({
  neighborhoodStatus: "ok", neighbors: [{ path: "a.md", score: 1 }, { path: "b.md", score: 0.9 }],
  current: { tags: [], yaml: {} }, local: { tags, yaml, yamlEvidence: yaml },
});
const options = { yamlAllowedProperties: "tipo, area, tags" };

describe("taxonomy runtime", () => {
  it("keeps a sufficient local plan self-contained, including hierarchical tags", () => {
    const sufficientOptions = { yamlAllowedProperties: "tipo, tags" };
    const runtime = prepareTaxonomyRuntime(result(
      [{ tag: "direcao/turma", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 }],
      [{ property: "tipo", value: "contacto_ee", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 }],
    ), sufficientOptions);

    expect(runtime.request).toEqual({
      requestTags: false,
      requestedYamlProperties: [],
      omittedYamlProperties: ["tipo"],
    });
    expect(reconcileTaxonomyRuntime(runtime, ["direcao"], { area: "escolar" }, sufficientOptions.yamlAllowedProperties, 8))
      .toMatchObject({ tags: ["direcao/turma"], yaml: { tipo: "contacto_ee" } });
  });

  it("requests only gaps and preserves local values during reconciliation", () => {
    const runtime = prepareTaxonomyRuntime(result([], [{ property: "tipo", value: "contacto_ee", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 }]), options);
    expect(runtime.request).toMatchObject({ requestTags: true, requestedYamlProperties: ["area"], omittedYamlProperties: ["tipo"] });
    expect(reconcileTaxonomyRuntime(runtime, ["direcao/turma"], { tipo: "wrong", area: "escolar" }, options.yamlAllowedProperties, 8))
      .toMatchObject({ tags: ["direcao/turma"], yaml: { tipo: "contacto_ee", area: "escolar" } });
  });

  it("keeps local writable suggestions when AI is unavailable without coercing typed evidence", () => {
    const runtime = prepareTaxonomyRuntime(result([], [
      { property: "tipo", value: "contacto_ee", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 },
      { property: "area", value: 2024, neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 },
    ]), options);
    expect(fallbackTaxonomyRuntime(runtime, options.yamlAllowedProperties, 8)?.yaml).toEqual({ tipo: "contacto_ee" });
  });

  it("does not manufacture a decision when no local plan exists", () => {
    expect(reconcileTaxonomyRuntime(undefined, ["direcao/turma"], { tipo: "contacto_ee" }, options.yamlAllowedProperties, 8))
      .toBeUndefined();
    expect(fallbackTaxonomyRuntime(undefined, options.yamlAllowedProperties, 8)).toBeUndefined();
  });
});

describe("taxonomy runtime cost invariants", () => {
  const view = readFileSync("src/search/linaSearchView.ts", "utf8");
  const between = (from: string, to: string): string => {
    const start = view.indexOf(from);
    const end = view.indexOf(to, start + from.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return view.slice(start, end);
  };

  it("keeps the runtime boundary pure: no provider, network, embedding, vault or persistence", () => {
    for (const file of ["src/search/taxonomyRuntime.ts", "src/search/taxonomyReconciliation.ts", "src/search/taxonomyPlan.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/requestUrl|\bfetch\(|generateSingleEmbedding|generateProviderText|runHybridSearch|saveData|vault\.|from "obsidian"/);
    }
  });

  it("reuses the resident runtime embedding index and metadata cache, and nothing else", () => {
    const compute = between("private async computeTaxonomyRuntime(", "private takePendingTaxonomyPlan(");
    expect(compute).toContain("this.plugin.getRuntimeEmbeddingIndex(");
    expect(compute).toContain("this.app.metadataCache");
    expect(compute).not.toMatch(/generateSingleEmbedding|generateProviderText|generateTextWithActiveAiProfile|runHybridSearch|requestUrl|saveData|\.modify\(|\.create\(/);
  });

  it("keeps a single AI call in the normal analysis flow", () => {
    const flow = between("private async analyzeMarkdownFile(", "private async analyzeInboxNotes(");
    expect(flow.split("generateTextWithActiveAiProfile(").length - 1).toBe(1);
    expect(flow).not.toMatch(/fallbackTaxonomyRuntime\([\s\S]{0,200}generateTextWithActiveAiProfile/);
  });
});
