import { describe, expect, it } from "vitest";
import {
  buildContextualTagCandidates,
  buildTagInventory,
  mergeTagRecommendations,
  normalizeTagComparisonKey,
  preserveTagIdentities,
  prepareTagProposals,
} from "../../src/search/tagRecommendation";
import { LinaSearchView } from "../../src/search/linaSearchView";

describe("tag hierarchy identity contract", () => {
  it("keeps a simple LLM tag compatible with the historical output", () => {
    expect(prepareTagProposals(["LLM nova"], buildTagInventory({})))
      .toEqual([{ tag: "llm_nova", existsInVault: false }]);
  });

  it("preserves hierarchy in identity while comparison keeps it distinct", () => {
    expect(preserveTagIdentities(["direcao/turma"])).toEqual(["direcao/turma"]);
    expect(normalizeTagComparisonKey("direcao/turma")).toBe("direcao/turma");
    expect(normalizeTagComparisonKey("direcao/turma")).not.toBe(normalizeTagComparisonKey("direcaoturma"));
    expect(normalizeTagComparisonKey("a/b")).not.toBe(normalizeTagComparisonKey("ab"));
    expect(normalizeTagComparisonKey("projeto/lina")).not.toBe(normalizeTagComparisonKey("projetolina"));
  });

  it("deduplicates an equivalent hierarchy from contextual sources without flattening it", () => {
    const candidates = buildContextualTagCandidates([
      { tags: ["Projeto/Lina"], score: 30 },
      { tags: ["projeto/lina"], score: 20 },
    ], buildTagInventory({}));

    expect(candidates).toEqual([{
      tag: "Projeto/Lina",
      relatedNoteCount: 2,
      relatedScore: 50,
    }]);
  });

  it("uses the metadata-cache identity in the preview proposal", () => {
    const inventory = buildTagInventory({ "Direção/Turma": 4 });
    expect(prepareTagProposals(["direcao/turma"], inventory)).toEqual([{
      tag: "Direção/Turma",
      existsInVault: true,
      usageCount: 4,
    }]);
  });

  it("preserves contextual identity through ranking and merge", () => {
    const inventory = buildTagInventory({ "projeto/lina": 3 });
    const contextual = buildContextualTagCandidates([
      { tags: ["projeto/lina"], score: 90 },
    ], inventory);

    expect(mergeTagRecommendations(["outra"], contextual, 2, inventory))
      .toEqual(["projeto/lina", "outra"]);
  });

  it("passes the selected hierarchical identity intact to the existing write path", () => {
    const view = Object.create(LinaSearchView.prototype) as {
      applyYamlAndTagsToNote(
        content: string,
        result: { yaml?: Record<string, unknown> },
        selectedYamlKeys: string[],
        selectedTags: string[],
      ): string;
    };

    const content = view.applyYamlAndTagsToNote("# Nota", {}, [], ["Direção/Turma"]);

    expect(content).toContain("  - Direção/Turma");
    expect(content).not.toContain("Direcaoturma");
  });
});
