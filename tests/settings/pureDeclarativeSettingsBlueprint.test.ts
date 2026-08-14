import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { assessDeclarativeSettingsParity, createPureDeclarativeSettingsBlueprint } from "../../src/settings/pureDeclarativeSettingsBlueprint";

describe("pure declarative settings blueprint", () => {
  it("preserves the complete section order and unique node ids", () => {
    const blueprint = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    expect(blueprint.map((section) => section.id)).toEqual(["introduction", "device", "analysis", "binary", "embeddings", "inbox", "index", "exclusions", "hybrid-search", "yaml", "multilingual", "support"]);
    const ids = blueprint.flatMap((section) => section.children.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(blueprint.find((section) => section.id === "index")?.children.map((node) => node.id)).toEqual([
      "check-sync-on-startup",
      "update-index-on-startup",
      "auto-update-index-on-file-changes",
      "debug-index-updates",
    ]);
    expect(blueprint.find((section) => section.id === "yaml")?.children.map((node) => node.id)).toEqual([
      "yaml-enabled",
      "yaml-properties",
      "yaml-include-tags",
      "max-suggested-tags",
    ]);
  });
  it("marks only real detached renderer implementations as ready", () => {
    const nodes = createPureDeclarativeSettingsBlueprint(getStrings("en")).flatMap((section) => section.children);
    expect(nodes.some((node) => node.source === "pureGlobalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureLocalSettingDefinitions")).toBe(true);
    expect(nodes.filter((node) => node.id === "analysis-credential" || node.id === "embeddings-credential").every((node) => node.source === "declarativeSettingRenderers")).toBe(true);
    expect(nodes.some((node) => node.source === "pureSettingsAsyncActions")).toBe(true);
    expect(nodes.filter((node) => node.readiness === "READY_RENDER_IMPLEMENTATION").map((node) => node.id)).toEqual(["analysis-provider", "analysis-model", "analysis-credential", "analysis-timeout", "analysis-test-feedback", "binary-preference", "binary-maintenance", "binary-status", "embeddings-provider", "embeddings-model", "embeddings-credential", "embeddings-batch-size", "embeddings-timeout", "embeddings-test-feedback", "inbox-folder", "inbox-max-notes", "auto-update-index-on-file-changes", "exclusions-note", "hybrid-text-weight", "hybrid-semantic-weight", "max-suggested-tags", "interface-language"]);
    expect(nodes.filter((node) => node.kind === "action").map((node) => node.id)).toEqual(["support-link", "support-email"]);
    expect(nodes.filter((node) => node.readiness === "UNRESOLVED").map((node) => node.id)).toEqual([]);
  });
  it("reports incomplete parity rather than concealing gaps", () => {
    const parity = assessDeclarativeSettingsParity(createPureDeclarativeSettingsBlueprint(getStrings()));
    expect(parity).toMatchObject({ complete: true, totalCount: 48, readyCount: 48, unresolvedCount: 0, outOfScopeCount: 0 });
    expect(parity.unresolvedIds).toEqual([]);
  });
  it("keeps dependency metadata plain and independent", () => {
    const first = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT")); const second = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    first[2].children[0].dependencies[0] = "changed";
    expect(second[2].children[0].dependencies[0]).toBe("local-port");
    expect(first.flatMap((section) => section.children).every((node) => Object.values(node).every((value) => typeof value !== "function"))).toBe(true);
  });
});
