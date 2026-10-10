import { describe, expect, it } from "vitest";
import {
  buildTagInventory,
  normalizeTag,
  normalizeTags,
  prepareTagProposals,
} from "../../src/search/tagRecommendation";

describe("tag recommendation", () => {
  it("builds the existing vault inventory from Obsidian tag counts", () => {
    const inventory = buildTagInventory({ "#Projeto Alpha": 2, projeto_alpha: 3 });

    expect(inventory.get("projeto_alpha")).toEqual({ normalized: "projeto_alpha", count: 5 });
    expect(inventory.has("inexistente")).toBe(false);
  });

  it("returns an empty inventory when the vault has no tags", () => {
    expect(buildTagInventory({})).toEqual(new Map());
  });

  it("preserves the current normalization behavior", () => {
    expect(normalizeTag("  Açúcar & Café! ")).toBe("acucar__cafe");
    expect(normalizeTags(["Açúcar", "acucar", "", "tema geral"])).toEqual(["acucar", "tema_geral"]);
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
});
