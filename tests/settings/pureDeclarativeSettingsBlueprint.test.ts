import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { assessDeclarativeSettingsParity, createPureDeclarativeSettingsBlueprint } from "../../src/settings/pureDeclarativeSettingsBlueprint";

describe("pure declarative settings blueprint", () => {
  it("preserves the complete section order and unique node ids across 5 principal groups", () => {
    const blueprint = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    expect(blueprint.map((section) => section.id)).toEqual([
      "introduction",
      "device-producer",
      "ai-analysis",
      "semantic-embeddings",
      "privacy-exclusions",
      "diagnostics-advanced",
    ]);
    expect(blueprint[0].heading).toBe("");
    expect(blueprint.find((section) => section.id === "device-producer")?.heading).toBe(getStrings("pt-PT").settingsGroupDeviceProducer);
    expect(blueprint.find((section) => section.id === "ai-analysis")?.heading).toBe(getStrings("pt-PT").settingsGroupAnalysis);
    expect(blueprint.find((section) => section.id === "semantic-embeddings")?.heading).toBe(getStrings("pt-PT").settingsGroupEmbeddings);
    expect(blueprint.find((section) => section.id === "privacy-exclusions")?.heading).toBe(getStrings("pt-PT").settingsGroupExclusions);
    expect(blueprint.find((section) => section.id === "diagnostics-advanced")?.heading).toBe(getStrings("pt-PT").settingsGroupDiagnostics);

    const ids = blueprint.flatMap((section) => section.children.map((node) => node.id));
    expect(ids).toHaveLength(49);
    expect(new Set(ids).size).toBe(49);

    expect(blueprint.find((section) => section.id === "device-producer")?.children.map((node) => node.id)).toEqual([
      "device-description",
      "device-name",
      "interface-language",
      "multilingual-note",
      "support-description",
      "support-link",
      "support-email",
    ]);

    expect(blueprint.find((section) => section.id === "ai-analysis")?.children.map((node) => node.id)).toEqual([
      "analysis-provider",
      "analysis-model",
      "analysis-base-url",
      "analysis-credential",
      "test-analysis-connection",
      "analysis-test-feedback",
      "analysis-timeout",
      "inbox-folder",
      "inbox-max-notes",
      "yaml-enabled",
      "yaml-properties",
      "yaml-include-tags",
      "max-suggested-tags",
    ]);

    expect(blueprint.find((section) => section.id === "semantic-embeddings")?.children.map((node) => node.id)).toEqual([
      "embeddings-enabled",
      "embeddings-provider",
      "embeddings-model",
      "embeddings-base-url",
      "embeddings-credential",
      "embedding-update-mode",
      "test-embeddings-connection",
      "embeddings-test-feedback",
      "embeddings-batch-size",
      "embeddings-timeout",
      "embedding-language",
      "hybrid-text-weight",
      "hybrid-semantic-weight",
    ]);

    expect(blueprint.find((section) => section.id === "privacy-exclusions")?.children.map((node) => node.id)).toEqual([
      "excluded-folders",
      "exclusions-note",
      "excluded-path-terms",
      "excluded-content-terms",
    ]);

    expect(blueprint.find((section) => section.id === "diagnostics-advanced")?.children.map((node) => node.id)).toEqual([
      "auto-update-index-on-file-changes",
      "update-index-on-startup",
      "check-sync-on-startup",
      "debug-index-updates",
      "binary-warning",
      "binary-preference",
      "binary-maintenance",
      "binary-status",
      "check-binary-copy",
      "create-or-update-binary-copy",
      "remove-binary-copy",
    ]);
  });

  it("marks only real detached renderer implementations as ready", () => {
    const nodes = createPureDeclarativeSettingsBlueprint(getStrings("en")).flatMap((section) => section.children);
    expect(nodes.some((node) => node.source === "pureGlobalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureLocalSettingDefinitions")).toBe(true);
    expect(nodes.filter((node) => node.id === "analysis-credential" || node.id === "embeddings-credential").every((node) => node.source === "declarativeSettingRenderers")).toBe(true);
    expect(nodes.some((node) => node.source === "pureSettingsAsyncActions")).toBe(true);
    expect(nodes.filter((node) => node.readiness === "READY_RENDER_IMPLEMENTATION").map((node) => node.id)).toEqual([
      "interface-language",
      "analysis-provider",
      "analysis-model",
      "analysis-credential",
      "analysis-test-feedback",
      "analysis-timeout",
      "inbox-folder",
      "inbox-max-notes",
      "max-suggested-tags",
      "embeddings-provider",
      "embeddings-model",
      "embeddings-credential",
      "embeddings-test-feedback",
      "embeddings-batch-size",
      "embeddings-timeout",
      "hybrid-text-weight",
      "hybrid-semantic-weight",
      "exclusions-note",
      "auto-update-index-on-file-changes",
      "binary-preference",
      "binary-maintenance",
      "binary-status",
    ]);
    expect(nodes.filter((node) => node.kind === "action").map((node) => node.id)).toEqual(["support-link", "support-email"]);
    expect(nodes.filter((node) => node.readiness === "UNRESOLVED").map((node) => node.id)).toEqual([]);
  });

  it("reports complete parity rather than concealing gaps", () => {
    const parity = assessDeclarativeSettingsParity(createPureDeclarativeSettingsBlueprint(getStrings()));
    expect(parity).toMatchObject({ complete: true, totalCount: 49, readyCount: 49, unresolvedCount: 0, outOfScopeCount: 0 });
    expect(parity.unresolvedIds).toEqual([]);
  });

  it("keeps dependency metadata plain and independent", () => {
    const first = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    const second = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));
    const firstAnalysis = first.find((section) => section.id === "ai-analysis");
    const secondAnalysis = second.find((section) => section.id === "ai-analysis");
    if (!firstAnalysis || !secondAnalysis) throw new Error("Missing ai-analysis group.");
    firstAnalysis.children[0].dependencies[0] = "changed";
    expect(secondAnalysis.children[0].dependencies[0]).toBe("local-port");
    expect(first.flatMap((section) => section.children).every((node) => Object.values(node).every((value) => typeof value !== "function"))).toBe(true);
  });
});
