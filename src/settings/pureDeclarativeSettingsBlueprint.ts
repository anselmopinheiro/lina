import type { UiStrings } from "../i18n/strings";

export type BlueprintReadiness = "READY_CONTROL" | "READY_RENDER_ADAPTER" | "READY_RENDER_IMPLEMENTATION" | "READY_SECRET_DESCRIPTOR" | "READY_ACTION_DESCRIPTOR" | "READY_INFORMATIONAL_DESCRIPTOR" | "UNRESOLVED" | "OUT_OF_SCOPE";
export type BlueprintNode = BlueprintGroup | BlueprintItem;
export interface BlueprintGroup { kind: "group"; id: string; heading: string; children: BlueprintItem[]; }
export interface BlueprintItem { kind: "global-control" | "local-control" | "future-render" | "credential" | "async-action" | "action" | "information" | "runtime" | "unresolved"; id: string; readiness: BlueprintReadiness; source: string; dependencies: readonly string[]; }

const item = (id: string, kind: BlueprintItem["kind"], readiness: BlueprintReadiness, source: string, dependencies: readonly string[] = []): BlueprintItem => ({ kind, id, readiness, source, dependencies: [...dependencies] });
const group = (id: string, heading: string, children: BlueprintItem[]): BlueprintGroup => ({ kind: "group", id, heading, children });
const sectionHeading = (area: string, section: string): string => `${area} — ${section}`;

type BlueprintStrings = Pick<UiStrings, "settingsBasicSection" | "settingsAdvancedSection" | "settingsMaintenanceRecoverySection" | "settingsSearchDataSection" | "settingsDeviceSection" | "settingsAnalysisSection" | "settingsBinarySection" | "settingsEmbeddingsSection" | "settingsInboxSection" | "settingsIndexSection" | "settingsExclusionsSection" | "settingsHybridSection" | "settingsYamlSection" | "settingsMultilingual" | "settingsSupportSection">;

export function createPureDeclarativeSettingsBlueprint(strings: BlueprintStrings): BlueprintGroup[] {
  const basic = (section: string): string => sectionHeading(strings.settingsBasicSection, section);
  const advanced = (section: string): string => sectionHeading(strings.settingsAdvancedSection, section);
  return [
    group("introduction", "", [item("support-introduction", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-support-copy")]),
    group("basic-device", basic(strings.settingsDeviceSection), [
      item("device-description", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-device-copy"),
      item("device-name", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
    ]),
    group("basic-analysis", basic(strings.settingsAnalysisSection), [
      item("analysis-provider", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects", "request-update"]),
      item("analysis-model", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("analysis-base-url", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
      item("analysis-credential", "credential", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["visible", "secret-binding", "save"]),
      item("analysis-timeout", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("test-analysis-connection", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime"]),
      item("analysis-test-feedback", "runtime", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["action-binding", "runtime", "feedback", "request-update"]),
    ]),
    group("basic-embeddings", basic(strings.settingsEmbeddingsSection), [
      item("embeddings-enabled", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("embeddings-provider", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects", "request-update"]),
      item("embeddings-model", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects"]),
      item("embeddings-base-url", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
      item("embeddings-credential", "credential", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["visible", "secret-binding", "save"]),
      item("embeddings-batch-size", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("embeddings-timeout", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("embedding-language", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("test-embeddings-connection", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "disabled"]),
      item("embeddings-test-feedback", "runtime", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["action-binding", "runtime", "feedback", "request-update"]),
    ]),
    group("basic-inbox", basic(strings.settingsInboxSection), [
      item("inbox-folder", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
      item("inbox-max-notes", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
    ]),
    group("basic-exclusions", basic(strings.settingsExclusionsSection), [
      item("excluded-folders", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("excluded-path-terms", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("excluded-content-terms", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("exclusions-note", "information", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers"),
    ]),
    group("basic-yaml", basic(strings.settingsYamlSection), [
      item("yaml-enabled", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("yaml-properties", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("yaml-include-tags", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("max-suggested-tags", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
    ]),
    group("basic-interface", basic(strings.settingsMultilingual), [
      item("multilingual-note", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"),
      item("interface-language", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port", "request-update"]),
    ]),
    group("basic-support", basic(strings.settingsSupportSection), [
      item("support-description", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"),
      item("support-link", "action", "READY_ACTION_DESCRIPTOR", "declarativeSettingRenderers", ["user-triggered", "external-url"]),
      item("support-email", "action", "READY_ACTION_DESCRIPTOR", "declarativeSettingRenderers", ["user-triggered", "external-url"]),
    ]),
    group("advanced-index", advanced(strings.settingsIndexSection), [
      item("check-sync-on-startup", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("update-index-on-startup", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("auto-update-index-on-file-changes", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port", "update-vault-event-listeners"]),
      item("debug-index-updates", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
    ]),
    group("advanced-hybrid-search", advanced(strings.settingsHybridSection), [
      item("hybrid-text-weight", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
      item("hybrid-semantic-weight", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
    ]),
    group("advanced-binary", advanced(strings.settingsBinarySection), [
      item("binary-warning", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"),
      item("binary-preference", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects", "request-update"]),
      item("binary-maintenance", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "request-update"]),
    ]),
    group("maintenance-binary", sectionHeading(strings.settingsMaintenanceRecoverySection, strings.settingsSearchDataSection), [
      item("binary-status", "runtime", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["action-binding", "runtime", "confirmation", "feedback", "aria-live", "request-update"]),
      item("check-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "refresh"]),
      item("create-or-update-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "disabled", "refresh"]),
      item("remove-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "confirmation", "runtime", "refresh"]),
    ]),
  ];
}

export function assessDeclarativeSettingsParity(blueprint: readonly BlueprintGroup[]) {
  const items: BlueprintItem[] = blueprint.flatMap((node) => node.children);
  const unresolvedIds = items.filter((node) => node.readiness === "UNRESOLVED").map((node) => node.id);
  const outOfScopeCount = items.filter((node) => node.readiness === "OUT_OF_SCOPE").length;
  return { complete: unresolvedIds.length === 0, totalCount: items.length, readyCount: items.length - unresolvedIds.length - outOfScopeCount, unresolvedCount: unresolvedIds.length, unresolvedIds, outOfScopeCount };
}
