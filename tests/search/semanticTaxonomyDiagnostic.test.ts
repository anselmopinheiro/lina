import { describe, expect, it } from "vitest";
import { buildSemanticTaxonomyDiagnostic } from "../../src/search/semanticTaxonomyDiagnostic";
import type { SemanticTaxonomyExperimentResult } from "../../src/search/semanticTaxonomyExperiment";

function result(overrides: Partial<SemanticTaxonomyExperimentResult> = {}): SemanticTaxonomyExperimentResult {
  return {
    neighborhoodStatus: "ok",
    neighbors: [{ path: "a.md", score: 0.9 }, { path: "b.md", score: 0.8 }, { path: "c.md", score: 0.7 }],
    current: { tags: ["escola", "turma_a"], yaml: { area: "escolar", estado: ["ativo"] } },
    local: {
      tags: [
        { tag: "escola", neighborCount: 3, neighborTotal: 3, similarityTotal: 2.4, globalUsageCount: 12 },
        { tag: "Joana", neighborCount: 1, neighborTotal: 3, similarityTotal: 0.9 },
      ],
      yaml: [{ property: "Area", value: "Escolar", neighborCount: 2, neighborTotal: 3, similarityTotal: 1.7 }],
      yamlEvidence: [{ property: "Area", value: "Escolar", neighborCount: 2, neighborTotal: 3, similarityTotal: 1.7 }],
    },
    ...overrides,
  };
}

describe("buildSemanticTaxonomyDiagnostic", () => {
  it("shows both engines, factual support and neighbors", () => {
    const diagnostic = buildSemanticTaxonomyDiagnostic(result());
    const text = diagnostic.lines.join("\n");

    expect(text).toContain("MOTOR ATUAL");
    expect(text).toContain("MOTOR LOCAL");
    expect(text).toContain("escola — suporte 3/3");
    expect(text).toContain("Joana — suporte 1/3");
    expect(text).toContain("suporte fraco");
    expect(text).toContain("Area=Escolar — suporte 2/3");
    expect(text).toContain("a.md (0.90)");
    expect(text).not.toContain("%");
  });

  it("computes overlap metrics case-insensitively and normalizes tags", () => {
    const { metrics } = buildSemanticTaxonomyDiagnostic(result());

    expect(metrics.sharedTags).toEqual(["escola"]);
    expect(metrics.sharedYaml).toEqual(["Area=Escolar"]);
    expect(metrics.currentYamlCount).toBe(2);
    expect(metrics.neighborsWithSupport).toBe(1);
  });

  it("reports an unavailable neighborhood without local recommendations", () => {
    const diagnostic = buildSemanticTaxonomyDiagnostic(result({
      neighborhoodStatus: "source-not-indexed",
      neighbors: [],
      local: { tags: [], yaml: [], yamlEvidence: [] },
    }));

    expect(diagnostic.status).toBe("source-not-indexed");
    expect(diagnostic.lines.join("\n")).toContain("Vizinhança indisponível: source-not-indexed");
    expect(diagnostic.metrics.localTagCount).toBe(0);
  });
});
