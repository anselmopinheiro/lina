import type { UiStrings } from "../i18n/strings";

export type BlueprintReadiness = "READY_CONTROL" | "READY_RENDER_ADAPTER" | "READY_SECRET_DESCRIPTOR" | "READY_ACTION_DESCRIPTOR" | "READY_INFORMATIONAL_DESCRIPTOR" | "UNRESOLVED" | "OUT_OF_SCOPE";
export type BlueprintNode = BlueprintGroup | BlueprintItem;
export interface BlueprintGroup { kind: "group"; id: string; heading: string; children: BlueprintItem[]; }
export interface BlueprintItem { kind: "global-control" | "local-control" | "future-render" | "credential" | "async-action" | "information" | "runtime" | "unresolved"; id: string; readiness: BlueprintReadiness; source: string; dependencies: readonly string[]; }

const item = (id: string, kind: BlueprintItem["kind"], readiness: BlueprintReadiness, source: string, dependencies: readonly string[] = []): BlueprintItem => ({ kind, id, readiness, source, dependencies: [...dependencies] });
const group = (id: string, heading: string, children: BlueprintItem[]): BlueprintGroup => ({ kind: "group", id, heading, children });

type BlueprintStrings = Pick<UiStrings, "settingsDeviceSection" | "settingsAnalysisSection" | "settingsBinarySection" | "settingsEmbeddingsSection" | "settingsInboxSection" | "settingsIndexSection" | "settingsExclusionsSection" | "settingsHybridSection" | "settingsYamlSection" | "settingsMultilingual" | "settingsSupportSection">;

export function createPureDeclarativeSettingsBlueprint(strings: BlueprintStrings): BlueprintGroup[] {
  return [
    group("introduction", "introduction", [item("support-introduction", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-support-copy")]),
    group("device", strings.settingsDeviceSection, [item("device-name", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions")]),
    group("analysis", strings.settingsAnalysisSection, [
      item("analysis-provider", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["visible", "save", "effects", "refresh"]),
      item("analysis-model", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["visible", "save", "effects"]),
      item("analysis-base-url", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
      item("analysis-credential", "credential", "READY_SECRET_DESCRIPTOR", "pureLocalSettingAdapters", ["visible", "secret-binding", "save"]),
      item("analysis-timeout", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["save"]),
      item("test-analysis-connection", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime"]),
      item("analysis-test-feedback", "runtime", "UNRESOLVED", "imperative-feedback", ["runtime", "refresh"]),
    ]),
    group("binary", strings.settingsBinarySection, [
      item("binary-warning", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"),
      item("binary-preference", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["save", "effects", "refresh"]),
      item("binary-maintenance", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["save", "runtime", "refresh"]),
      item("binary-status", "runtime", "UNRESOLVED", "binary-diagnostics", ["runtime", "aria-live", "refresh"]),
      item("check-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "refresh"]),
      item("create-or-update-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "disabled", "refresh"]),
      item("remove-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "confirmation", "runtime", "refresh"]),
    ]),
    group("embeddings", strings.settingsEmbeddingsSection, [
      item("embeddings-enabled", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("embeddings-provider", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["save", "effects", "refresh"]),
      item("embeddings-model", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["save", "effects"]),
      item("embeddings-base-url", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
      item("embeddings-credential", "credential", "READY_SECRET_DESCRIPTOR", "pureLocalSettingAdapters", ["visible", "secret-binding", "save"]),
      item("embeddings-batch-size", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["save"]),
      item("embeddings-timeout", "future-render", "READY_RENDER_ADAPTER", "pureLocalSettingAdapters", ["save"]),
      item("test-embeddings-connection", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "disabled"]),
      item("embeddings-test-feedback", "runtime", "UNRESOLVED", "imperative-feedback", ["runtime", "refresh"]),
    ]),
    group("inbox", strings.settingsInboxSection, [item("inbox-folder", "unresolved", "UNRESOLVED", "imperative-local-setting", ["save"])]),
    group("index", strings.settingsIndexSection, [
      item("check-sync-on-startup", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("update-index-on-startup", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("debug-index-updates", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
    ]),
    group("exclusions", strings.settingsExclusionsSection, [
      item("excluded-folders", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("excluded-path-terms", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("excluded-content-terms", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("exclusions-note", "information", "UNRESOLVED", "config-dir-derived-copy", ["runtime"]),
    ]),
    group("hybrid-search", strings.settingsHybridSection, [item("hybrid-search-settings", "unresolved", "UNRESOLVED", "imperative-settings", ["save"])]),
    group("yaml", strings.settingsYamlSection, [item("yaml-enabled", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("yaml-properties", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("yaml-include-tags", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions")]),
    group("multilingual", strings.settingsMultilingual, [item("multilingual-note", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"), item("embedding-language", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"), item("interface-language", "unresolved", "UNRESOLVED", "imperative-setting", ["save", "refresh"])]),
    group("support", strings.settingsSupportSection, [item("support-description", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"), item("support-link", "information", "UNRESOLVED", "external-link", ["link-renderer"])]),
  ];
}

export function assessDeclarativeSettingsParity(blueprint: readonly BlueprintGroup[]) {
  const items = blueprint.flatMap((node) => node.children);
  const unresolvedIds = items.filter((node) => node.readiness === "UNRESOLVED").map((node) => node.id);
  const outOfScopeCount = items.filter((node) => node.readiness === "OUT_OF_SCOPE").length;
  return { complete: unresolvedIds.length === 0, totalCount: items.length, readyCount: items.length - unresolvedIds.length - outOfScopeCount, unresolvedCount: unresolvedIds.length, unresolvedIds, outOfScopeCount };
}
