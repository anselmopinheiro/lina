import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { assessDeclarativeSettingsParity, createPureDeclarativeSettingsBlueprint } from "../../src/settings/pureDeclarativeSettingsBlueprint";

describe("pure declarative settings blueprint", () => {
  it("preserves the complete section order and unique node ids", () => {
    const blueprint = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    expect(blueprint.map((section) => section.id)).toEqual([
      "introduction",
      "basic-device", "basic-analysis", "basic-embeddings", "basic-inbox", "basic-exclusions", "basic-yaml", "basic-interface", "basic-support",
      "advanced-index", "advanced-hybrid-search", "advanced-binary",
      "maintenance-binary",
    ]);
    expect(blueprint[0].heading).toBe("");
    expect(blueprint.slice(1, 9).every((section) => section.heading.startsWith(`${getStrings("pt-PT").settingsBasicSection} — `))).toBe(true);
    expect(blueprint.slice(9, 12).every((section) => section.heading.startsWith(`${getStrings("pt-PT").settingsAdvancedSection} — `))).toBe(true);
    expect(blueprint.find((section) => section.id === "basic-embeddings")?.heading).toBe(`${getStrings("pt-PT").settingsBasicSection} — ${getStrings("pt-PT").settingsEmbeddingsSection}`);
    expect(blueprint.some((section) => section.id === "advanced-analysis" || section.id === "advanced-embeddings")).toBe(false);
    expect(blueprint.find((section) => section.id === "advanced-binary")?.heading).toBe(`${getStrings("pt-PT").settingsAdvancedSection} — ${getStrings("pt-PT").settingsBinarySection}`);
    expect(blueprint.at(-1)?.heading).toBe(`${getStrings("pt-PT").settingsMaintenanceRecoverySection} — ${getStrings("pt-PT").settingsSearchDataSection}`);
    const ids = blueprint.flatMap((section) => section.children.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(blueprint.find((section) => section.id === "advanced-index")?.children.map((node) => node.id)).toEqual([
      "check-sync-on-startup",
      "update-index-on-startup",
      "auto-update-index-on-file-changes",
      "debug-index-updates",
    ]);
    expect(blueprint.find((section) => section.id === "basic-yaml")?.children.map((node) => node.id)).toEqual([
      "yaml-enabled",
      "yaml-properties",
      "yaml-include-tags",
      "max-suggested-tags",
    ]);
    expect(blueprint.some((section) => section.id === "advanced-yaml")).toBe(false);
    expect(blueprint.find((section) => section.id === "basic-embeddings")?.children.map((node) => node.id)).toEqual([
      "embeddings-enabled", "embeddings-provider", "embeddings-model", "embeddings-base-url", "embeddings-credential", "embeddings-batch-size", "embeddings-timeout", "embedding-language", "test-embeddings-connection", "embeddings-test-feedback",
    ]);
    expect(blueprint.find((section) => section.id === "basic-analysis")?.children.map((node) => node.id)).toEqual([
      "analysis-provider", "analysis-model", "analysis-base-url", "analysis-credential", "analysis-timeout", "test-analysis-connection", "analysis-test-feedback",
    ]);
    expect(blueprint.find((section) => section.id === "maintenance-binary")?.children.map((node) => node.id)).toEqual([
      "binary-status", "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy",
    ]);
  });
  it("marks only real detached renderer implementations as ready", () => {
    const nodes = createPureDeclarativeSettingsBlueprint(getStrings("en")).flatMap((section) => section.children);
    expect(nodes.some((node) => node.source === "pureGlobalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureLocalSettingDefinitions")).toBe(true);
    expect(nodes.filter((node) => node.id === "analysis-credential" || node.id === "embeddings-credential").every((node) => node.source === "declarativeSettingRenderers")).toBe(true);
    expect(nodes.some((node) => node.source === "pureSettingsAsyncActions")).toBe(true);
    expect(nodes.filter((node) => node.readiness === "READY_RENDER_IMPLEMENTATION").map((node) => node.id)).toEqual(["analysis-provider", "analysis-model", "analysis-credential", "analysis-timeout", "analysis-test-feedback", "embeddings-provider", "embeddings-model", "embeddings-credential", "embeddings-batch-size", "embeddings-timeout", "embeddings-test-feedback", "inbox-folder", "inbox-max-notes", "exclusions-note", "max-suggested-tags", "interface-language", "auto-update-index-on-file-changes", "hybrid-text-weight", "hybrid-semantic-weight", "binary-preference", "binary-maintenance", "binary-status"]);
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
