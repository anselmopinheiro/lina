import { describe, expect, it } from "vitest";
import {
  buildYamlProposals,
  buildContextualYamlCandidates,
  filterAllowedYamlProperties,
  mergeYamlRecommendations,
  parseFrontmatterProperties,
} from "../../src/search/yamlRecommendation";

describe("yaml recommendation", () => {
  it("keeps allowed properties and always excludes tags", () => {
    expect(filterAllowedYamlProperties(
      { tipo: "nota", tags: ["ignored"], estado: "ativo", outra: "fora" },
      "tipo, estado, tags",
    )).toEqual({ tipo: "nota", estado: "ativo" });
  });

  it("preserves property names, values, and order from the current response", () => {
    expect(filterAllowedYamlProperties(
      { Tipo: "Nota", estado: ["ativo", "revisto"] },
      " tipo , ESTADO ",
    )).toEqual({ Tipo: "Nota", estado: ["ativo", "revisto"] });
  });

  it("parses the existing lightweight frontmatter representation", () => {
    expect([...parseFrontmatterProperties("tipo: nota\nestado: ativo\n- lista").entries()]).toEqual([
      ["tipo", "nota"],
      ["estado", "ativo"],
    ]);
  });

  it("marks exact existing values and conflicts for structured analysis", () => {
    const proposals = buildYamlProposals(
      { tipo: "nota", estado: "arquivado", area: "pessoal" },
      new Map([["tipo", "nota"], ["estado", "ativo"]]),
      { keyMatching: "exact", emptyExistingValue: "new" },
    );

    expect(proposals).toEqual([
      { property: "tipo", value: "nota", valueText: "nota", status: "already_exists" },
      { property: "estado", value: "arquivado", valueText: "arquivado", status: "conflict", existingValue: "ativo" },
      { property: "area", value: "pessoal", valueText: "pessoal", status: "new" },
    ]);
  });

  it("preserves slash-command case-insensitive and empty-value behavior", () => {
    expect(buildYamlProposals(
      { Tipo: "nota", estado: "ativo" },
      new Map([["tipo", "nota"], ["estado", ""]]),
      { keyMatching: "case-insensitive", emptyExistingValue: "already_exists" },
    )).toEqual([
      { property: "Tipo", value: "nota", valueText: "nota", status: "already_exists" },
      { property: "estado", value: "ativo", valueText: "ativo", status: "already_exists" },
    ]);
  });

  it("returns no proposals for empty input", () => {
    expect(buildYamlProposals({}, new Map(), { keyMatching: "exact", emptyExistingValue: "new" })).toEqual([]);
  });

  it("falls back to the current LLM properties without related notes", () => {
    expect(mergeYamlRecommendations(
      { tipo: "nota", estado: "ativo" },
      [],
      "tipo, estado",
    )).toEqual({ tipo: "nota", estado: "ativo" });
  });

  it("ignores related notes without eligible YAML properties", () => {
    expect(buildContextualYamlCandidates([
      { yaml: { tags: "ignorada", fora: "valor" }, score: 80 },
    ], "tipo, estado")).toEqual([]);
  });

  it("aggregates the same property and value across related notes", () => {
    expect(buildContextualYamlCandidates([
      { yaml: { tipo: "reuniao" }, score: 60 },
      { yaml: { tipo: "reuniao", estado: "ativo" }, score: 40 },
    ], "tipo, estado")).toEqual([
      { property: "tipo", value: "reuniao", valueText: "reuniao", pairNoteCount: 2, relatedScore: 100, propertyNoteCount: 2 },
      { property: "estado", value: "ativo", valueText: "ativo", pairNoteCount: 1, relatedScore: 40, propertyNoteCount: 1 },
    ]);
  });

  it("orders different contextual values deterministically", () => {
    const candidates = buildContextualYamlCandidates([
      { yaml: { estado: "ativo" }, score: 20 },
      { yaml: { estado: "arquivado", tipo: "nota" }, score: 80 },
    ], "tipo, estado");

    expect(candidates.map(candidate => `${candidate.property}:${candidate.valueText}`)).toEqual([
      "estado:arquivado", "tipo:nota", "estado:ativo",
    ]);
  });

  it("lets contextual values replace LLM candidates without increasing property count", () => {
    const contextual = buildContextualYamlCandidates([
      { yaml: { tipo: "reuniao", area: "trabalho" }, score: 50 },
    ], "tipo, area, estado");

    expect(mergeYamlRecommendations(
      { tipo: "nota", estado: "ativo" },
      contextual,
      "tipo, area, estado",
    )).toEqual({ tipo: "reuniao", area: "trabalho" });
  });

  it("keeps LLM-only properties after contextual candidates and preserves the allow-list", () => {
    const contextual = buildContextualYamlCandidates([
      { yaml: { tipo: "reuniao", proibida: "nao" }, score: 50 },
    ], "tipo, estado");

    expect(mergeYamlRecommendations(
      { tipo: "nota", estado: "ativo", proibida: "nao" },
      contextual,
      "tipo, estado",
    )).toEqual({ tipo: "reuniao", estado: "ativo" });
  });
});
