import { describe, expect, it } from "vitest";
import {
  buildTagInventory,
  buildContextualTagCandidates,
  hasEntityLikeShape,
  mergeTagRecommendations,
  normalizeTagComparisonKey,
  preserveTagIdentities,
  prepareTagProposals,
} from "../../src/search/tagRecommendation";

describe("tag recommendation", () => {
  it("builds the existing vault inventory from Obsidian tag counts", () => {
    const inventory = buildTagInventory({ "#Projeto Alpha": 2, projeto_alpha: 3 });

    expect(inventory.get("projeto_alpha")).toEqual({
      comparisonKey: "projeto_alpha",
      identity: "Projeto_Alpha",
      count: 5,
    });
    expect(inventory.has("inexistente")).toBe(false);
  });

  it("returns an empty inventory when the vault has no tags", () => {
    expect(buildTagInventory({})).toEqual(new Map());
  });

  it("keeps comparison normalization separate from tag identity", () => {
    expect(normalizeTagComparisonKey("  Açúcar & Café! ")).toBe("acucar__cafe");
    expect(preserveTagIdentities(["Açúcar", "acucar", "", "tema geral"])).toEqual(["Açúcar", "tema_geral"]);
  });

  it("prepares new and existing proposals without changing order", () => {
    const inventory = buildTagInventory({ existente: 7 });
    const proposals = prepareTagProposals(["Nova", "existente", "nova", "terceira"], inventory, 8);

    expect(proposals).toEqual([
      { tag: "nova", existsInVault: false },
      { tag: "existente", existsInVault: true, usageCount: 7 },
      { tag: "terceira", existsInVault: false },
    ]);
  });

  it("keeps the current maximum and marks tags already present in the target note", () => {
    const inventory = buildTagInventory({ existente: 2 });
    const proposals = prepareTagProposals(
      ["existente", "nova", "outra"],
      inventory,
      2,
      new Set(["existente"]),
    );

    expect(proposals).toEqual([
      { tag: "existente", existsInVault: true, usageCount: 2, existsInNote: true },
      { tag: "nova", existsInVault: false, existsInNote: false },
    ]);
  });

  it("returns no proposals when the LLM provides no usable tags", () => {
    expect(prepareTagProposals(["", "###"], buildTagInventory({}), 8)).toEqual([]);
  });

  it("falls back to the current LLM order when there are no related notes", () => {
    expect(mergeTagRecommendations(["LLM nova", "outra"], [], 8)).toEqual(["llm_nova", "outra"]);
  });

  it("ignores related notes that have no usable tags", () => {
    expect(buildContextualTagCandidates([
      { tags: [], score: 90 },
      { tags: ["###"], score: 80 },
    ], buildTagInventory({}))).toEqual([]);
  });

  it("aggregates one contextual tag across multiple related notes", () => {
    expect(buildContextualTagCandidates([
      { tags: ["Projeto"], score: 70 },
      { tags: ["projeto", "outra"], score: 50 },
    ], buildTagInventory({ projeto: 4 }))).toEqual([
      { tag: "projeto", relatedNoteCount: 2, relatedScore: 120, globalUsageCount: 4 },
      { tag: "outra", relatedNoteCount: 1, relatedScore: 50 },
    ]);
  });

  it("ranks contextual tags by related-note frequency before lower-frequency tags", () => {
    const candidates = buildContextualTagCandidates([
      { tags: ["frequente", "rara"], score: 20 },
      { tags: ["frequente"], score: 10 },
    ], buildTagInventory({ rara: 99 }));

    expect(candidates.map(candidate => candidate.tag)).toEqual(["frequente", "rara"]);
  });

  it("deduplicates contextual and LLM candidates while retaining LLM-only tags", () => {
    const contextual = buildContextualTagCandidates([
      { tags: ["contexto", "partilhada"], score: 40 },
    ], buildTagInventory({}));

    expect(mergeTagRecommendations(["Partilhada", "llm nova"], contextual, 8)).toEqual([
      "contexto", "partilhada", "llm_nova",
    ]);
  });

  it("preserves contextual ranking and respects the configured maximum", () => {
    const contextual = buildContextualTagCandidates([
      { tags: ["primeira", "segunda"], score: 20 },
      { tags: ["primeira", "terceira"], score: 10 },
    ], buildTagInventory({}));

    expect(mergeTagRecommendations(["llm"], contextual, 2)).toEqual(["primeira", "segunda"]);
  });

  it("demotes an isolated entity-shaped LLM tag when contextual concepts compete", () => {
    const contextual = buildContextualTagCandidates([
      { tags: ["conceito"], score: 40 },
    ], buildTagInventory({ conceito: 3 }));

    expect(mergeTagRecommendations(["Exemplo", "categoria"], contextual, 2, buildTagInventory({ conceito: 3 })))
      .toEqual(["conceito", "categoria"]);
  });

  it("keeps a one-related-note entity candidate eligible without a hard block", () => {
    const contextual = buildContextualTagCandidates([
      { tags: ["nome_exemplo"], score: 40 },
    ], buildTagInventory({ nome_exemplo: 1 }));

    expect(mergeTagRecommendations([], contextual, 2, buildTagInventory({ nome_exemplo: 1 })))
      .toEqual(["nome_exemplo"]);
  });

  it("does not penalize a strongly reused entity-shaped tag", () => {
    const inventory = buildTagInventory({ Exemplo: 4, conceito: 2 });
    const contextual = buildContextualTagCandidates([{ tags: ["conceito"], score: 40 }], inventory);

    expect(mergeTagRecommendations(["Exemplo"], contextual, 2, inventory))
      .toEqual(["conceito", "exemplo"]);
  });

  it("does not treat lower-case concepts or acronyms as entity-shaped", () => {
    expect(hasEntityLikeShape("conceito")).toBe(false);
    expect(hasEntityLikeShape("TIC")).toBe(false);
    expect(hasEntityLikeShape("Projeto Alpha")).toBe(false);

    const contextual = buildContextualTagCandidates([{ tags: ["contexto"], score: 40 }], buildTagInventory({}));
    expect(mergeTagRecommendations(["conceito", "TIC"], contextual, 3)).toEqual(["contexto", "conceito", "tic"]);
  });
});
