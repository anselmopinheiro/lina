import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { assessDeclarativeSettingsParity, createPureDeclarativeSettingsBlueprint } from "../../src/settings/pureDeclarativeSettingsBlueprint";

describe("pure declarative settings blueprint", () => {
  it("preserves the complete section order and unique node ids", () => {
    const blueprint = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    expect(blueprint.map((section) => section.id)).toEqual(["introduction", "device", "analysis", "binary", "embeddings", "inbox", "index", "exclusions", "hybrid-search", "yaml", "multilingual", "support"]);
    const ids = blueprint.flatMap((section) => section.children.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("references prepared blocks while retaining every unresolved imperative area", () => {
    const nodes = createPureDeclarativeSettingsBlueprint(getStrings("en")).flatMap((section) => section.children);
    expect(nodes.some((node) => node.source === "pureGlobalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureLocalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureLocalSettingAdapters")).toBe(true);
    expect(nodes.some((node) => node.source === "pureSettingsAsyncActions")).toBe(true);
    expect(nodes.filter((node) => node.readiness === "UNRESOLVED").map((node) => node.id)).toEqual(["analysis-test-feedback", "binary-status", "embeddings-test-feedback", "inbox-folder", "exclusions-note", "hybrid-search-settings", "interface-language", "support-link"]);
  });
  it("reports incomplete parity rather than concealing gaps", () => {
    const parity = assessDeclarativeSettingsParity(createPureDeclarativeSettingsBlueprint(getStrings()));
    expect(parity).toMatchObject({ complete: false, totalCount: 42, readyCount: 34, unresolvedCount: 8, outOfScopeCount: 0 });
    expect(parity.unresolvedIds).toHaveLength(8);
  });
  it("keeps dependency metadata plain and independent", () => {
    const first = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT")); const second = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    first[2].children[0].dependencies[0] = "changed";
    expect(second[2].children[0].dependencies[0]).toBe("visible");
    expect(first.flatMap((section) => section.children).every((node) => Object.values(node).every((value) => typeof value !== "function"))).toBe(true);
  });
});
