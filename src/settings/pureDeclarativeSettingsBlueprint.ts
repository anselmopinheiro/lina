import type { UiStrings } from "../i18n/strings";

export type BlueprintReadiness = "READY_CONTROL" | "READY_RENDER_ADAPTER" | "READY_RENDER_IMPLEMENTATION" | "READY_SECRET_DESCRIPTOR" | "READY_ACTION_DESCRIPTOR" | "READY_INFORMATIONAL_DESCRIPTOR" | "UNRESOLVED" | "OUT_OF_SCOPE";
export type BlueprintNode = BlueprintGroup | BlueprintItem;
export interface BlueprintGroup { kind: "group"; id: string; heading: string; children: BlueprintItem[]; }
export interface BlueprintItem { kind: "global-control" | "local-control" | "future-render" | "credential" | "async-action" | "action" | "information" | "runtime" | "unresolved"; id: string; readiness: BlueprintReadiness; source: string; dependencies: readonly string[]; }

const item = (id: string, kind: BlueprintItem["kind"], readiness: BlueprintReadiness, source: string, dependencies: readonly string[] = []): BlueprintItem => ({ kind, id, readiness, source, dependencies: [...dependencies] });
const group = (id: string, heading: string, children: BlueprintItem[]): BlueprintGroup => ({ kind: "group", id, heading, children });

type BlueprintStrings = Pick<
  UiStrings,
  | "settingsGroupGeneral"
  | "settingsGroupSearch"
  | "settingsGroupAnalysis"
  | "settingsGroupProducer"
  | "settingsGroupCompanion"
  | "settingsGroupSynchronization"
  | "settingsGroupDiagnostics"
  | "settingsGroupAdvanced"
  | "settingsSupportSection"
>;

export function createPureDeclarativeSettingsBlueprint(strings: BlueprintStrings): BlueprintGroup[] {
  return [
    // General
    group("general", strings.settingsGroupGeneral, [
      item("support-introduction", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-support-copy"),
      item("interface-language", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port", "request-update"]),
      item("multilingual-note", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"),
      item("device-name", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
    ]),

    // Search. Provider/model render as contract information on Companion.
    group("search", strings.settingsGroupSearch, [
      item("embeddings-enabled", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("embeddings-provider", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects", "request-update"]),
      item("embeddings-model", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects"]),
      item("embeddings-base-url", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
      item("embeddings-credential", "credential", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["visible", "secret-binding", "save"]),
      item("test-embeddings-connection", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "disabled"]),
      item("embeddings-test-feedback", "runtime", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["action-binding", "runtime", "feedback", "request-update"]),
      item("embeddings-timeout", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("embedding-language", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("hybrid-text-weight", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
      item("hybrid-semantic-weight", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
    ]),

    // AI
    group("ai-analysis", strings.settingsGroupAnalysis, [
      item("analysis-provider", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects", "request-update"]),
      item("analysis-model", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("analysis-base-url", "local-control", "READY_CONTROL", "pureLocalSettingDefinitions"),
      item("analysis-credential", "credential", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["visible", "secret-binding", "save"]),
      item("analysis-timeout", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("test-analysis-connection", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime"]),
      item("analysis-test-feedback", "runtime", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["action-binding", "runtime", "feedback", "request-update"]),
      item("inbox-folder", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
      item("inbox-max-notes", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
      item("yaml-enabled", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("yaml-properties", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("yaml-include-tags", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("max-suggested-tags", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port"]),
    ]),

    // Producer-only work and publication controls.
    group("producer", strings.settingsGroupProducer, [
      item("embedding-update-mode", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("embeddings-batch-size", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port"]),
      item("excluded-folders", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("excluded-path-terms", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("excluded-content-terms", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("auto-update-index-on-file-changes", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["global-port", "update-vault-event-listeners"]),
      item("update-index-on-startup", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
      item("binary-maintenance", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "request-update"]),
      item("create-or-update-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "disabled", "refresh"]),
      item("remove-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "confirmation", "runtime", "refresh"]),
    ]),

    // Conditional Companion page. Contract details remain in Search so the same definition is never duplicated.
    group("companion", strings.settingsGroupCompanion, [
      item("exclusions-note", "information", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers"),
    ]),

    group("synchronization", strings.settingsGroupSynchronization, [
      item("check-sync-on-startup", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
    ]),

    group("diagnostics", strings.settingsGroupDiagnostics, [
      item("device-description", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-device-copy"),
      item("binary-warning", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"),
      item("binary-status", "runtime", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["action-binding", "runtime", "confirmation", "feedback", "aria-live", "request-update"]),
      item("check-binary-copy", "async-action", "READY_ACTION_DESCRIPTOR", "pureSettingsAsyncActions", ["action-binding", "runtime", "refresh"]),
      item("binary-preference", "future-render", "READY_RENDER_IMPLEMENTATION", "declarativeSettingRenderers", ["local-port", "effects", "request-update"]),
    ]),

    // Rare technical settings without a functional home.
    group("advanced", strings.settingsGroupAdvanced, [
      item("debug-index-updates", "global-control", "READY_CONTROL", "pureGlobalSettingDefinitions"),
    ]),

    // Support (3 items)
    group("support-footer", strings.settingsSupportSection, [
      item("support-description", "information", "READY_INFORMATIONAL_DESCRIPTOR", "existing-string"),
      item("support-link", "action", "READY_ACTION_DESCRIPTOR", "declarativeSettingRenderers", ["user-triggered", "external-url"]),
      item("support-email", "action", "READY_ACTION_DESCRIPTOR", "declarativeSettingRenderers", ["user-triggered", "external-url"]),
    ]),
  ];
}

export function assessDeclarativeSettingsParity(blueprint: readonly BlueprintGroup[]) {
  const items: BlueprintItem[] = blueprint.flatMap((node) => node.children);
  const unresolvedIds = items.filter((node) => node.readiness === "UNRESOLVED").map((node) => node.id);
  const outOfScopeCount = items.filter((node) => node.readiness === "OUT_OF_SCOPE").length;
  return { complete: unresolvedIds.length === 0, totalCount: items.length, readyCount: items.length - unresolvedIds.length - outOfScopeCount, unresolvedCount: unresolvedIds.length, unresolvedIds, outOfScopeCount };
}
