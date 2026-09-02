import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { assessDeclarativeSettingsParity, createPureDeclarativeSettingsBlueprint } from "../../src/settings/pureDeclarativeSettingsBlueprint";

describe("pure declarative settings blueprint", () => {
  it("preserves the complete section order and unique node ids", () => {
    const blueprint = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    expect(blueprint.map((section) => section.id)).toEqual([
      "introduction",
      "basic-section",
      "basic-device", "basic-analysis", "basic-embeddings", "basic-inbox", "basic-index", "basic-exclusions", "basic-yaml", "basic-interface", "basic-support",
      "advanced-section",
      "advanced-analysis", "advanced-embeddings", "advanced-index", "advanced-hybrid-search", "advanced-yaml", "advanced-exclusions",
      "maintenance-section",
      "diagnostics-index",
      "maintenance-binary",
    ]);
    expect(blueprint[0].heading).toBe("");
    expect(blueprint.find((section) => section.id === "basic-section")).toMatchObject({ heading: getStrings("pt-PT").settingsBasicSection, children: [] });
    expect(blueprint.find((section) => section.id === "advanced-section")).toMatchObject({ heading: getStrings("pt-PT").settingsAdvancedSection, children: [] });
    expect(blueprint.find((section) => section.id === "maintenance-section")).toMatchObject({ heading: getStrings("pt-PT").settingsMaintenanceRecoverySection, children: [] });
    expect(blueprint.find((section) => section.id === "basic-embeddings")?.heading).toBe(getStrings("pt-PT").settingsEmbeddingsSection);
    expect(blueprint.some((section) => section.id === "advanced-analysis" && section.children.length > 0)).toBe(true);
    expect(blueprint.some((section) => section.id === "advanced-embeddings" && section.children.length > 0)).toBe(true);
    expect(blueprint.find((section) => section.id === "maintenance-binary")?.heading).toBe(getStrings("pt-PT").settingsSearchDataSection);
    expect(blueprint.at(-1)?.heading).toBe(getStrings("pt-PT").settingsSearchDataSection);
    const ids = blueprint.flatMap((section) => section.children.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(blueprint.find((section) => section.id === "basic-index")?.children.map((node) => node.id)).toEqual([
      "auto-update-index-on-file-changes",
    ]);
    expect(blueprint.find((section) => section.id === "diagnostics-index")?.heading).toBe(getStrings("pt-PT").settingsIndexDiagnosticsSection);
    expect(blueprint.find((section) => section.id === "diagnostics-index")?.children.map((node) => node.id)).toEqual([
      "check-sync-on-startup",
      "debug-index-updates",
    ]);
    expect(blueprint.find((section) => section.id === "basic-yaml")?.children.map((node) => node.id)).toEqual([
      "yaml-enabled",
      "yaml-include-tags",
    ]);
    expect(blueprint.find((section) => section.id === "advanced-yaml")?.children.map((node) => node.id)).toEqual([
      "yaml-properties",
      "max-suggested-tags",
    ]);
    expect(blueprint.find((section) => section.id === "basic-embeddings")?.children.map((node) => node.id)).toEqual([
      "embeddings-enabled", "embeddings-provider", "embeddings-model", "embeddings-base-url", "embeddings-credential", "embedding-update-mode", "test-embeddings-connection", "embeddings-test-feedback",
    ]);
    expect(blueprint.find((section) => section.id === "basic-analysis")?.children.map((node) => node.id)).toEqual([
      "analysis-provider", "analysis-model", "analysis-base-url", "analysis-credential", "test-analysis-connection", "analysis-test-feedback",
    ]);
    expect(blueprint.find((section) => section.id === "advanced-analysis")?.children.map((node) => node.id)).toEqual([
      "analysis-timeout",
    ]);
    expect(blueprint.find((section) => section.id === "advanced-embeddings")?.children.map((node) => node.id)).toEqual([
      "embeddings-batch-size", "embeddings-timeout", "embedding-language",
    ]);
    expect(blueprint.find((section) => section.id === "maintenance-binary")?.children.map((node) => node.id)).toEqual([
      "binary-warning", "binary-preference", "binary-maintenance", "binary-status", "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy",
    ]);
  });
  it("marks only real detached renderer implementations as ready", () => {
    const nodes = createPureDeclarativeSettingsBlueprint(getStrings("en")).flatMap((section) => section.children);
    expect(nodes.some((node) => node.source === "pureGlobalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureLocalSettingDefinitions")).toBe(true);
    expect(nodes.filter((node) => node.id === "analysis-credential" || node.id === "embeddings-credential").every((node) => node.source === "declarativeSettingRenderers")).toBe(true);
    expect(nodes.some((node) => node.source === "pureSettingsAsyncActions")).toBe(true);
    expect(nodes.filter((node) => node.readiness === "READY_RENDER_IMPLEMENTATION").map((node) => node.id)).toEqual([
      "analysis-provider",
      "analysis-model",
      "analysis-credential",
      "analysis-test-feedback",
      "embeddings-provider",
      "embeddings-model",
      "embeddings-credential",
      "embeddings-test-feedback",
      "inbox-folder",
      "auto-update-index-on-file-changes",
      "exclusions-note",
      "interface-language",
      "analysis-timeout",
      "embeddings-batch-size",
      "embeddings-timeout",
      "inbox-max-notes",
      "hybrid-text-weight",
      "hybrid-semantic-weight",
      "max-suggested-tags",
      "binary-preference",
      "binary-maintenance",
      "binary-status",
    ]);
    expect(nodes.filter((node) => node.kind === "action").map((node) => node.id)).toEqual(["support-link", "support-email"]);
    expect(nodes.filter((node) => node.readiness === "UNRESOLVED").map((node) => node.id)).toEqual([]);
  });
  it("reports incomplete parity rather than concealing gaps", () => {
    const parity = assessDeclarativeSettingsParity(createPureDeclarativeSettingsBlueprint(getStrings()));
    expect(parity).toMatchObject({ complete: true, totalCount: 49, readyCount: 49, unresolvedCount: 0, outOfScopeCount: 0 });
    expect(parity.unresolvedIds).toEqual([]);
  });
  it("keeps dependency metadata plain and independent", () => {
    const first = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT")); const second = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    const firstAnalysis = first.find((section) => section.id === "basic-analysis");
    const secondAnalysis = second.find((section) => section.id === "basic-analysis");
    if (!firstAnalysis || !secondAnalysis) throw new Error("Missing basic analysis group.");
    firstAnalysis.children[0].dependencies[0] = "changed";
    expect(secondAnalysis.children[0].dependencies[0]).toBe("local-port");
    expect(first.flatMap((section) => section.children).every((node) => Object.values(node).every((value) => typeof value !== "function"))).toBe(true);
  });
});
