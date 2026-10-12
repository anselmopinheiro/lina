import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTaxonomyPlan } from "../../src/search/taxonomyPlan";
import { LinaSearchView } from "../../src/search/linaSearchView";
import {
  buildTaxonomyAiRequest,
  reconcileTaxonomyRecommendations,
} from "../../src/search/taxonomyReconciliation";
import type { SemanticTaxonomyExperimentResult } from "../../src/search/semanticTaxonomyExperiment";

const allowed = "tipo, area, contexto, estado, tags";

function plan(input: {
  tags?: SemanticTaxonomyExperimentResult["local"]["tags"];
  yaml?: SemanticTaxonomyExperimentResult["local"]["yaml"];
  status?: SemanticTaxonomyExperimentResult["neighborhoodStatus"];
}) {
  const yaml = input.yaml ?? [];
  return buildTaxonomyPlan({
    neighborhoodStatus: input.status ?? "ok",
    neighbors: [{ path: "a.md", score: 0.9 }, { path: "b.md", score: 0.8 }],
    current: { tags: [], yaml: {} },
    local: { tags: input.tags ?? [], yaml, yamlEvidence: yaml },
  }, { yamlAllowedProperties: allowed });
}

const supported = (property: string, value: string | number | boolean) => ({
  property, value, neighborCount: 2, neighborTotal: 2, similarityTotal: 1.7,
});

function promptView(): Record<string, any> {
  return Object.assign(Object.create(LinaSearchView.prototype), {
    plugin: {
      settings: {
        aiOutputLanguage: "pt-PT",
        yamlSuggestionsEnabled: true,
        yamlAllowedProperties: allowed,
        maxSuggestedTags: 8,
      },
    },
    formatExistingFoldersForPrompt: () => "",
  });
}

describe("taxonomy selective AI request", () => {
  it("does not request locally sufficient tags or YAML", () => {
    const request = buildTaxonomyAiRequest(plan({
      tags: [{ tag: "escola/7c", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 }],
      yaml: [supported("tipo", "contacto_ee"), supported("area", "escolar")],
    }));
    expect(request.requestTags).toBe(false);
    expect(request.requestedYamlProperties).toEqual(["contexto", "estado"]);
    expect(request.omittedYamlProperties).toEqual(["tipo", "area"]);
  });

  it("requests missing tags and only YAML gaps", () => {
    const localPlan = plan({ yaml: [supported("tipo", "contacto_ee")] });
    const request = buildTaxonomyAiRequest(localPlan);
    expect(request.requestTags).toBe(true);
    expect(request.requestedYamlProperties).toEqual(["area", "contexto", "estado"]);
  });

  it("falls back to AI requests when the neighborhood is unavailable", () => {
    const request = buildTaxonomyAiRequest(plan({ status: "source-not-indexed" }));
    expect(request.requestTags).toBe(true);
    expect(request.requestedYamlProperties).toEqual(["tipo", "area", "contexto", "estado"]);
  });

  it("conditions the existing single analysis prompt without adding a second request", () => {
    const request = buildTaxonomyAiRequest(plan({ yaml: [supported("tipo", "contacto_ee")] }));
    const prompt = promptView().buildCurrentNoteAnalysisPrompt("Nota", "Notas/nota.md", "conteúdo", request);
    expect(prompt).toContain("APENAS estas propriedades YAML: area, contexto, estado");
    expect(prompt).toContain("NÃO devolvas estas propriedades já resolvidas localmente: tipo");
    expect(prompt).toContain('"tags": ["tag1", "tag2"]');
    expect(prompt).not.toContain('"yaml": {\n    "propriedade": "valor"\n  }');
  });

  it("omits taxonomy fields from the prompt when local evidence resolves every gap", () => {
    const request = buildTaxonomyAiRequest(plan({
      tags: [{ tag: "escola/7c", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 }],
      yaml: [
        supported("tipo", "contacto_ee"), supported("area", "escolar"),
        supported("contexto", "turma"), supported("estado", "ativo"),
      ],
    }));
    const prompt = promptView().buildCurrentNoteAnalysisPrompt("Nota", "Notas/nota.md", "conteúdo", request);
    expect(request).toMatchObject({ requestTags: false, requestedYamlProperties: [] });
    expect(prompt).toContain("taxonomia YAML foi resolvida localmente");
    expect(prompt).toContain("As tags foram resolvidas localmente");
    expect(prompt).not.toContain('"tags": ["tag1", "tag2"]');
  });

  it("keeps the historical prompt contract when no plan is available", () => {
    const prompt = promptView().buildCurrentNoteAnalysisPrompt("Nota", "Notas/nota.md", "conteúdo");
    expect(prompt).toContain('"yaml": {\n    "propriedade": "valor"\n  }');
    expect(prompt).toContain('"tags": ["tag1", "tag2"]');
  });
});

describe("taxonomy reconciliation", () => {
  it("keeps local contacto_ee while admitting only requested AI fields", () => {
    const localPlan = plan({ yaml: [supported("tipo", "contacto_ee"), supported("area", "escolar")] });
    const result = reconcileTaxonomyRecommendations(localPlan, ["direcao/turma"], {
      tipo: "substituido", area: "nova", contexto: "reuniao", estado: "ativo", proibida: "x",
    }, allowed, 8);
    expect(result.tags).toEqual(["direcao/turma"]);
    expect(result.yaml).toEqual({ tipo: "contacto_ee", area: "escolar", contexto: "reuniao", estado: "ativo" });
    expect(result.yamlSources).toMatchObject({ tipo: "local", area: "local", contexto: "ai", estado: "ai" });
  });

  it("preserves local results when AI is empty and rejects typed non-writable fallbacks", () => {
    const localPlan = plan({ yaml: [supported("tipo", "contacto_ee"), supported("area", 2024), supported("estado", true)] });
    const result = reconcileTaxonomyRecommendations(localPlan, [], {}, allowed, 8);
    expect(result.yaml).toEqual({ tipo: "contacto_ee" });
    expect(result.yamlSources).toMatchObject({ area: "none", estado: "none" });
  });

  it("deduplicates hierarchical tags and remains deterministic", () => {
    const localPlan = buildTaxonomyPlan({
      neighborhoodStatus: "ok", neighbors: [{ path: "a.md", score: 1 }, { path: "b.md", score: 0.9 }], current: { tags: [], yaml: {} },
      local: {
        tags: [{ tag: "Direção/Turma", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 }],
        yaml: [], yamlEvidence: [],
      },
    }, { yamlAllowedProperties: allowed });
    const first = reconcileTaxonomyRecommendations(localPlan, ["direcao/turma", "outra"], {}, allowed, 8);
    const second = reconcileTaxonomyRecommendations(localPlan, ["direcao/turma", "outra"], {}, allowed, 8);
    expect(first).toEqual(second);
    expect(first.tags).toEqual(["Direção/Turma"]);
  });
});

function jsonExample(prompt: string): string {
  const start = prompt.indexOf("Estrutura JSON obrigatória:");
  const end = prompt.indexOf("Dados da nota:");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return prompt.slice(start, end);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("taxonomy prompt keeps a single internalLinks property", () => {
  const fullLocal = plan({
    tags: [{ tag: "escola/7c", neighborCount: 2, neighborTotal: 2, similarityTotal: 1.9 }],
    yaml: [
      supported("tipo", "contacto_ee"), supported("area", "escolar"),
      supported("contexto", "turma"), supported("estado", "ativo"),
    ],
  });
  const partial = plan({ yaml: [supported("tipo", "contacto_ee")] });
  const cases: Array<[string, ReturnType<typeof plan> | undefined]> = [
    ["pedido taxonómico ativo (lacunas totais)", plan({ status: "source-not-indexed" })],
    ["pedido taxonómico parcial", partial],
    ["tudo resolvido localmente", fullLocal],
    ["sem plano/runtime", undefined],
  ];

  for (const [label, localPlan] of cases) {
    const request = localPlan ? buildTaxonomyAiRequest(localPlan) : undefined;

    it(`análise simples — ${label}`, () => {
      const example = jsonExample(promptView().buildCurrentNoteAnalysisPrompt("Nota", "Notas/nota.md", "conteúdo", request));
      expect(occurrences(example, '"internalLinks"')).toBe(1);
      const parsed = JSON.parse(example.slice(example.indexOf("{"), example.lastIndexOf("}") + 1));
      expect(parsed.internalLinks).toEqual([]);
    });

    it(`análise com contexto — ${label}`, () => {
      const example = jsonExample(promptView().buildCurrentNoteAnalysisPromptWithContext("Nota", "Notas/nota.md", "conteúdo", [], request));
      expect(occurrences(example, '"internalLinks"')).toBe(1);
      const parsed = JSON.parse(example.slice(example.indexOf("{"), example.lastIndexOf("}") + 1));
      expect(Array.isArray(parsed.internalLinks)).toBe(true);
    });
  }

  it("sem plano o prompt histórico é preservado byte a byte nas duas variantes", () => {
    const view = promptView();
    expect(view.buildCurrentNoteAnalysisPrompt("Nota", "Notas/nota.md", "conteúdo", undefined))
      .toBe(view.buildCurrentNoteAnalysisPrompt("Nota", "Notas/nota.md", "conteúdo"));
    const historical = view.buildCurrentNoteAnalysisPromptWithContext("Nota", "Notas/nota.md", "conteúdo", []);
    expect(historical).toContain('"yaml": {\n    "propriedade": "valor"\n  },\n  "tags": ["tag1", "tag2"],\n  "internalLinks": [');
    expect(historical).toContain('* evitar tags genéricas como "projeto", "sistema", "nota" ou "geral"');
  });

  it("mantém as regras históricas de tags quando a IA ainda tem de sugerir tags", () => {
    const request = buildTaxonomyAiRequest(partial);
    const prompt = promptView().buildCurrentNoteAnalysisPrompt("Nota", "Notas/nota.md", "conteúdo", request);
    expect(request.requestTags).toBe(true);
    expect(prompt).toContain('* evitar tags genéricas como "projeto", "sistema", "nota" ou "geral"');
    expect(prompt).toContain('* normalizar: "Gestão de Trabalhos" → gestao_trabalhos');
  });
});

describe("batch e inbox preservam o comportamento histórico", () => {
  const source = readFileSync("src/search/linaSearchView.ts", "utf8");
  const slice = (from: string, to: string): string => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + from.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it("não usa plano, runtime nem diagnóstico taxonómico nos fluxos de lote", () => {
    const inbox = slice("private async analyzeInboxNotes()", "private async analyzeFolderNotes(");
    const folder = slice("private async analyzeFolderNotes(", "private setAnalysisNoteName(");
    for (const flow of [inbox, folder]) {
      expect(flow).not.toMatch(/Taxonomy|taxonomy/);
      expect(flow).toContain("this.prepareStructuredAnalysisResult(json);");
    }
  });

  it("o prompt de lote não recebe pedido taxonómico", () => {
    const batchPrompt = slice("private buildInboxNoteAnalysisPrompt(", "private prepareStructuredAnalysisResult(");
    expect(batchPrompt).not.toMatch(/taxonomy/i);
  });

  it("o plano é consumido apenas no âmbito single-note", () => {
    const take = slice("private takePendingTaxonomyPlan(", "private async processAIResponse(");
    expect(take).toContain('this.currentAnalysisScope !== "single-note"');
    expect(take).toContain("this.pendingTaxonomyPlan = null;");
  });
});
