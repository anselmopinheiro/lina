import type { SettingDefinition } from "obsidian";
import { chooseProviderDefaultBaseUrl } from "../ai/providerDefaults";
import type { UiStrings } from "../i18n/strings";
import {
  createConnectionCredentialBindings,
  type ConnectionCredentialBindings,
  type ConnectionCredentialBindingsOptions,
} from "./declarativeSettingsConnectionCredentialBindings";
import {
  createDetachedIndexYamlSettingDefinitions,
  createDetachedInformationalSettingDefinitions,
  createDetachedInteractiveSettingDefinitions,
  createDetachedNumericBinarySettingDefinitions,
  createDetachedProviderModelSettingDefinitions,
  createDetachedStaticTextRenderer,
  type DetachedGlobalKey,
  type DetachedGlobalValue,
  type DetachedLocalKey,
  type DetachedLocalValue,
  type DetachedSettingsPorts,
} from "./declarativeSettingRenderers";
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
import { createPureGlobalSettingDefinitions } from "./pureGlobalSettingDefinitions";
import { createPureLocalSettingDefinitions } from "./pureLocalSettingDefinitions";
import type { PureLocalSettingKey } from "./pureLocalSettingsModel";
import {
  createSettingsRuntimeAdapters,
  type SettingsRuntimeAdapterOptions,
  type SettingsRuntimeAdapters,
  type SettingsRuntimeGlobalKey,
  type SettingsRuntimeGlobalValue,
  type SettingsRuntimeHost,
  type SettingsRuntimeLocalValue,
  type SettingsRuntimeMutationResult,
} from "./settingsRuntimeAdapters";

export type DeclarativeSettingsCandidateReadiness =
  | "BOUND_REAL_DEFINITION"
  | "PLACEHOLDER_ONLY"
  | "MISSING_REAL_BINDING"
  | "BLOCKED";

export type DeclarativeSettingsCandidateDefinition = SettingDefinition & {
  id: string;
};

export interface DeclarativeSettingsCandidateItem {
  id: string;
  kind: BlueprintItem["kind"];
  readiness: DeclarativeSettingsCandidateReadiness;
  source: string;
  dependencies: readonly string[];
  definition?: DeclarativeSettingsCandidateDefinition;
}

export interface DeclarativeSettingsCandidateGroup {
  id: string;
  heading: string;
  items: readonly DeclarativeSettingsCandidateItem[];
}

export interface DeclarativeSettingsCandidateCompositionOptions {
  strings: UiStrings;
  configDir: string;
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
  structuralReadiness: ReturnType<typeof assessDeclarativeSettingsParity>;
  boundDefinitionCount: number;
  boundDefinitionIds: readonly string[];
  incompleteIds: readonly string[];
  groups: readonly { id: string; itemCount: number; boundDefinitionCount: number; complete: boolean }[];
  lifecycle: ReturnType<DeclarativeSettingsLifecycleController["getState"]>;
  connectionCredentials: ReturnType<ConnectionCredentialBindings["getState"]>;
  binary: ReturnType<DeclarativeSettingsBinaryBindings["getSnapshot"]>;
}

export interface DeclarativeSettingsCandidateComposition {
  groups: readonly DeclarativeSettingsCandidateGroup[];
  definitions: readonly DeclarativeSettingsCandidateDefinition[];
  runtimeAdapters: SettingsRuntimeAdapters;
  controller: DeclarativeSettingsLifecycleController;
  connectionCredentials: ConnectionCredentialBindings;
  binary: DeclarativeSettingsBinaryBindings;
  getControlValue(id: string): unknown;
  setControlValue(id: string, value: unknown): Promise<SettingsRuntimeMutationResult>;
  getDiagnosticSnapshot(): DeclarativeSettingsCandidateDiagnosticSnapshot;
  dispose(): void;
}

type CandidateControlBinding = {
  getValue(): unknown;
  setValue(value: unknown): Promise<SettingsRuntimeMutationResult>;
};

function addDefinitionId(id: string, definition: SettingDefinition): DeclarativeSettingsCandidateDefinition {
  return {
    ...definition,
    id,
    visible: definition.visible ?? true,
  };
}

function toDefinitionMap(definitions: readonly DeclarativeSettingsCandidateDefinition[]): Map<string, DeclarativeSettingsCandidateDefinition> {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

function staticDefinition(id: string, name: string, description: string): DeclarativeSettingsCandidateDefinition {
  return {
    id,
    name,
    desc: description,
    visible: true,
    render: createDetachedStaticTextRenderer(name, description),
  };
}

function baseUrlFor(
  runtimeAdapters: SettingsRuntimeAdapters,
  key: "analysisBaseUrl" | "embeddingsBaseUrl",
): string {
  const providerKey = key === "analysisBaseUrl" ? "analysisProvider" : "embeddingsProvider";
  const provider = runtimeAdapters.getLocalValue(providerKey) || "ollama";
  return runtimeAdapters.getLocalValue(key) || chooseProviderDefaultBaseUrl("", provider);
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

  const ports: DetachedSettingsPorts = {
    getGlobal<K extends DetachedGlobalKey>(key: K) {
      return runtimeAdapters.getGlobalValue(key) as DetachedGlobalValue<K> | undefined;
    },
    async setGlobal<K extends DetachedGlobalKey>(key: K, value: DetachedGlobalValue<K>, effects = []) {
      const result = await runtimeAdapters.setGlobalValue(
        key as SettingsRuntimeGlobalKey,
        value,
        effects,
      );
      if (result.ok) controller.requestUpdate();
    },
    getLocal<K extends DetachedLocalKey>(key: K) {
      const fallback = key === "maintainBinaryEmbeddingCopy" ? false : "";
      return (runtimeAdapters.getLocalValue(key) ?? fallback) as DetachedLocalValue<K>;
    },
    async setLocal<K extends DetachedLocalKey>(key: K, value: DetachedLocalValue<K>, effects = []) {
      const result = await runtimeAdapters.setLocalValue(
        key,
        value as SettingsRuntimeLocalValue<K>,
        effects,
      );
      if (result.ok) controller.requestUpdate();
    },
    requestUpdate() {
      controller.requestUpdate();
    },
  };

  const localDefinitions = createPureLocalSettingDefinitions({
    strings: options.strings,
    analysisBaseUrlPlaceholder: baseUrlFor(runtimeAdapters, "analysisBaseUrl"),
    embeddingsBaseUrlPlaceholder: baseUrlFor(runtimeAdapters, "embeddingsBaseUrl"),
  });
  const globalDefinitions = createPureGlobalSettingDefinitions(options.strings);
  const staticDefinitions: DeclarativeSettingsCandidateDefinition[] = [
    staticDefinition("support-introduction", options.strings.settingsTitle, options.strings.settingsDescription),
    staticDefinition("binary-warning", options.strings.settingsBinarySection, options.strings.settingsBinaryExperimentalWarning),
    staticDefinition("multilingual-note", options.strings.settingsMultilingual, options.strings.settingsMultilingualDescription),
    staticDefinition("support-description", options.strings.settingsSupportSection, options.strings.settingsSupportDescription),
    ...createDetachedInformationalSettingDefinitions(options.strings, options.configDir)
      .map((definition) => addDefinitionId(
        definition.id === "config-dir-note" ? "exclusions-note" : definition.id,
        definition,
      )),
  ];

  const renderDefinitions = [
    ...createDetachedInteractiveSettingDefinitions(options.strings, ports),
    ...createDetachedIndexYamlSettingDefinitions(options.strings, ports),
    ...createDetachedProviderModelSettingDefinitions(options.strings, ports),
    ...createDetachedNumericBinarySettingDefinitions(options.strings, ports)
      .map((definition) => addDefinitionId(
        definition.id === "maintain-binary-copy" ? "binary-maintenance" : definition.id,
        definition,
      )),
  ];

  const controlBindings = new Map<string, CandidateControlBinding>();
  const controlDefinitions: DeclarativeSettingsCandidateDefinition[] = [];
  const addGlobalControl = (id: string, definition: SettingDefinition): void => {
    if (!("control" in definition) || !definition.control) return;
    const key = definition.control.key as SettingsRuntimeGlobalKey;
    controlDefinitions.push(addDefinitionId(id, {
      ...definition,
      control: {
        ...definition.control,
        disabled: definition.control.disabled ?? false,
      },
    }));
    controlBindings.set(id, {
      getValue: () => runtimeAdapters.getGlobalValue(key),
      setValue: (value) => runtimeAdapters.setGlobalValue(key, value as SettingsRuntimeGlobalValue<typeof key>),
    });
  };
  const addLocalControl = (id: string, definition: SettingDefinition): void => {
    if (!("control" in definition) || !definition.control) return;
    const key = definition.control.key as PureLocalSettingKey;
    controlDefinitions.push(addDefinitionId(id, {
      ...definition,
      control: {
        ...definition.control,
        disabled: definition.control.disabled ?? false,
      },
    }));
    controlBindings.set(id, {
      getValue: () => runtimeAdapters.getLocalValue(key),
      setValue: (value) => runtimeAdapters.setLocalValue(key, value as SettingsRuntimeLocalValue<typeof key>),
    });
  };

  const globalIds = [
    "embeddings-enabled",
    "check-sync-on-startup",
    "update-index-on-startup",
    "debug-index-updates",
    "excluded-folders",
    "excluded-path-terms",
    "excluded-content-terms",
    "yaml-enabled",
    "yaml-properties",
    "yaml-include-tags",
    "embedding-language",
  ] as const;
  globalDefinitions.forEach((definition, index) => addGlobalControl(globalIds[index], definition));

  const localIds = ["device-name", "analysis-base-url", "embeddings-base-url"] as const;
  localDefinitions.forEach((definition, index) => addLocalControl(localIds[index], definition));

  const definitions = [
    ...staticDefinitions,
    ...controlDefinitions,
    ...renderDefinitions,
  ];
  const definitionsById = toDefinitionMap(definitions);
  const groups: DeclarativeSettingsCandidateGroup[] = blueprint.map((group) => ({
    id: group.id,
    heading: group.heading,
    items: group.children.map((item) => {
      const definition = definitionsById.get(item.id);
      const readiness: DeclarativeSettingsCandidateReadiness = definition
        ? "BOUND_REAL_DEFINITION"
        : "MISSING_REAL_BINDING";
      return {
        id: item.id,
        kind: item.kind,
        readiness,
        source: item.source,
        dependencies: [...item.dependencies],
        ...(definition ? { definition } : {}),
      };
    }),
  }));
  const orderedDefinitions = groups.flatMap((group) =>
    group.items.flatMap((item) => item.definition ? [item.definition] : []),
  );
  let disposed = false;

  return {
    groups,
    definitions: orderedDefinitions,
    runtimeAdapters,
    controller,
    connectionCredentials,
    binary,
    getControlValue(id) {
      return controlBindings.get(id)?.getValue();
    },
    setControlValue(id, value) {
      const binding = controlBindings.get(id);
      return binding
        ? binding.setValue(value)
        : Promise.resolve({ ok: false, error: "invalid-value" });
    },
    getDiagnosticSnapshot() {
      const items = groups.flatMap((group) => group.items);
      const boundDefinitionIds = items
        .filter((item) => item.readiness === "BOUND_REAL_DEFINITION")
        .map((item) => item.id);
      return {
        groupCount: groups.length,
        itemCount: items.length,
        ids: items.map((item) => item.id),
        structuralReadiness: assessDeclarativeSettingsParity(blueprint),
        boundDefinitionCount: boundDefinitionIds.length,
        boundDefinitionIds,
        incompleteIds: items.filter((item) => item.readiness !== "BOUND_REAL_DEFINITION").map((item) => item.id),
        groups: groups.map((group) => {
          const boundDefinitionCount = group.items.filter((item) => item.readiness === "BOUND_REAL_DEFINITION").length;
          return {
            id: group.id,
            itemCount: group.items.length,
            boundDefinitionCount,
            complete: boundDefinitionCount === group.items.length,
          };
        }),
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
