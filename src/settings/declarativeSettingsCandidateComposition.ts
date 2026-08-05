import type { UiStrings } from "../i18n/strings";
import {
  createConnectionCredentialBindings,
  type ConnectionCredentialBindings,
  type ConnectionCredentialBindingsOptions,
} from "./declarativeSettingsConnectionCredentialBindings";
import {
  createDeclarativeSettingsBinaryBindings,
  type DeclarativeSettingsBinaryBindings,
  type DeclarativeSettingsBinaryBindingsOptions,
} from "./declarativeSettingsBinaryBindings";
import {
  createDeclarativeSettingsLifecycleController,
  type DeclarativeSettingsLifecycleController,
  type DeclarativeSettingsLifecycleControllerOptions,
} from "./declarativeSettingsLifecycleController";
import {
  assessDeclarativeSettingsParity,
  createPureDeclarativeSettingsBlueprint,
  type BlueprintItem,
} from "./pureDeclarativeSettingsBlueprint";
import {
  createSettingsRuntimeAdapters,
  type SettingsRuntimeAdapterOptions,
  type SettingsRuntimeAdapters,
  type SettingsRuntimeHost,
} from "./settingsRuntimeAdapters";

export interface DeclarativeSettingsCandidateItem {
  id: string;
  kind: BlueprintItem["kind"];
  readiness: BlueprintItem["readiness"];
  source: string;
  dependencies: readonly string[];
}

export interface DeclarativeSettingsCandidateGroup {
  id: string;
  heading: string;
  items: readonly DeclarativeSettingsCandidateItem[];
}

export interface DeclarativeSettingsCandidateCompositionOptions {
  strings: UiStrings;
  runtimeHost: SettingsRuntimeHost;
  runtimeOptions?: SettingsRuntimeAdapterOptions;
  lifecycle: DeclarativeSettingsLifecycleControllerOptions;
  connectionCredentials: Omit<ConnectionCredentialBindingsOptions, "lifecycle">;
  binary: Omit<DeclarativeSettingsBinaryBindingsOptions, "lifecycle">;
}

export interface DeclarativeSettingsCandidateDiagnosticSnapshot {
  groupCount: number;
  itemCount: number;
  ids: readonly string[];
  readiness: ReturnType<typeof assessDeclarativeSettingsParity>;
  lifecycle: ReturnType<DeclarativeSettingsLifecycleController["getState"]>;
  connectionCredentials: ReturnType<ConnectionCredentialBindings["getState"]>;
  binary: ReturnType<DeclarativeSettingsBinaryBindings["getSnapshot"]>;
}

export interface DeclarativeSettingsCandidateComposition {
  groups: readonly DeclarativeSettingsCandidateGroup[];
  runtimeAdapters: SettingsRuntimeAdapters;
  controller: DeclarativeSettingsLifecycleController;
  connectionCredentials: ConnectionCredentialBindings;
  binary: DeclarativeSettingsBinaryBindings;
  getDiagnosticSnapshot(): DeclarativeSettingsCandidateDiagnosticSnapshot;
  dispose(): void;
}

export function createDeclarativeSettingsCandidateComposition(
  options: DeclarativeSettingsCandidateCompositionOptions,
): DeclarativeSettingsCandidateComposition {
  const blueprint = createPureDeclarativeSettingsBlueprint(options.strings);
  const runtimeAdapters = createSettingsRuntimeAdapters(options.runtimeHost, options.runtimeOptions);
  const controller = createDeclarativeSettingsLifecycleController(options.lifecycle);
  const connectionCredentials = createConnectionCredentialBindings({
    ...options.connectionCredentials,
    lifecycle: controller,
  });
  const binary = createDeclarativeSettingsBinaryBindings({ ...options.binary, lifecycle: controller });
  const groups = blueprint.map((group) => ({
    id: group.id,
    heading: group.heading,
    items: group.children.map((item) => ({
      id: item.id,
      kind: item.kind,
      readiness: item.readiness,
      source: item.source,
      dependencies: [...item.dependencies],
    })),
  }));
  let disposed = false;

  return {
    groups,
    runtimeAdapters,
    controller,
    connectionCredentials,
    binary,
    getDiagnosticSnapshot() {
      const items = groups.flatMap((group) => group.items);
      return {
        groupCount: groups.length,
        itemCount: items.length,
        ids: items.map((item) => item.id),
        readiness: assessDeclarativeSettingsParity(blueprint),
        lifecycle: controller.getState(),
        connectionCredentials: connectionCredentials.getState(),
        binary: binary.getSnapshot(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
    },
  };
}
