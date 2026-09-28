import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { assessDeclarativeSettingsParity, createPureDeclarativeSettingsBlueprint } from "../../src/settings/pureDeclarativeSettingsBlueprint";

describe("pure declarative settings blueprint", () => {
  it("organizes all existing definitions into the approved intent-based page order", () => {
    const blueprint = createPureDeclarativeSettingsBlueprint(getStrings("pt-PT"));

    expect(blueprint.map((section) => section.id)).toEqual([
      "general", "search", "ai-analysis", "producer", "companion",
      "synchronization", "diagnostics", "advanced", "support-footer",
    ]);
    expect(blueprint.map((section) => section.heading)).toEqual([
      getStrings("pt-PT").settingsGroupGeneral,
      getStrings("pt-PT").settingsGroupSearch,
      getStrings("pt-PT").settingsGroupAnalysis,
      getStrings("pt-PT").settingsGroupProducer,
      getStrings("pt-PT").settingsGroupCompanion,
      getStrings("pt-PT").settingsGroupSynchronization,
      getStrings("pt-PT").settingsGroupDiagnostics,
      getStrings("pt-PT").settingsGroupAdvanced,
      getStrings("pt-PT").settingsSupportSection,
    ]);

    const ids = blueprint.flatMap((section) => section.children.map((node) => node.id));
    expect(ids).toHaveLength(49);
    expect(new Set(ids).size).toBe(49);
  });

  it("keeps Producer work separate from Companion information and technical settings", () => {
    const sections = createPureDeclarativeSettingsBlueprint(getStrings("en"));
    const ids = (id: string) => sections.find((section) => section.id === id)?.children.map((node) => node.id);

    expect(ids("producer")).toEqual([
      "embedding-update-mode", "embeddings-batch-size", "excluded-folders", "excluded-path-terms",
      "excluded-content-terms", "auto-update-index-on-file-changes", "update-index-on-startup",
      "binary-maintenance", "create-or-update-binary-copy", "remove-binary-copy",
    ]);
    expect(ids("companion")).toEqual(["exclusions-note"]);
    expect(ids("synchronization")).toEqual(["check-sync-on-startup"]);
    expect(ids("search")).toContain("embeddings-base-url");
    expect(ids("search")).toContain("embeddings-credential");
    expect(ids("ai-analysis")).toEqual([
      "analysis-provider", "analysis-model", "analysis-base-url", "analysis-credential", "analysis-timeout",
      "test-analysis-connection", "analysis-test-feedback", "inbox-folder", "inbox-max-notes", "yaml-enabled",
      "yaml-properties", "yaml-include-tags", "max-suggested-tags",
    ]);
    expect(ids("diagnostics")).toEqual(["device-description", "binary-warning", "binary-status", "check-binary-copy", "binary-preference"]);
    expect(ids("advanced")).toEqual(["debug-index-updates"]);
  });

  it("marks every existing definition as ready without adding storage or runtime dependencies", () => {
    const blueprint = createPureDeclarativeSettingsBlueprint(getStrings());
    const nodes = blueprint.flatMap((section) => section.children);
    const parity = assessDeclarativeSettingsParity(blueprint);

    expect(parity).toMatchObject({ complete: true, totalCount: 49, readyCount: 49, unresolvedCount: 0, outOfScopeCount: 0 });
    expect(nodes.some((node) => node.source === "pureGlobalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureLocalSettingDefinitions")).toBe(true);
    expect(nodes.some((node) => node.source === "pureSettingsAsyncActions")).toBe(true);
  });
});
