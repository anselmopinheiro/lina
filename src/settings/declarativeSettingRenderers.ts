import type { Setting, SettingDefinition, SettingGroup } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import { chooseProviderDefaultBaseUrl, chooseProviderDefaultModel } from "../ai/providerDefaults";
import { createPureBinaryMaintenanceAdapter, createPureBinaryPreferenceAdapter, createPureModelAdapter, createPureNumericAdapter, createPureProviderAdapter, normalizePureLocalNumericValue, type LocalSettingEffect } from "./pureLocalSettingAdapters";
import type { PureLocalSettingKey, PureLocalProviderDomain } from "./pureLocalSettingsModel";
import {
  createPureConnectionTestRuntime,
  getPureConnectionTestFeedbackText,
  type PureConnectionTestActionId,
  type PureConnectionTestFeedbackStrings,
  type PureConnectionTestInput,
  type PureConnectionTestRuntime,
  type PureConnectionTestRuntimePorts,
} from "./pureSettingsAsyncActions";

export type DetachedGlobalKey = "inboxFolderPath" | "maxInboxNotesToAnalyze" | "hybridSearchTextWeight" | "hybridSearchSemanticWeight" | "interfaceLanguage";
export type DetachedGlobalValue<K extends DetachedGlobalKey> =
  K extends "inboxFolderPath" ? string :
  K extends "interfaceLanguage" ? "pt-PT" | "en" :
  number;
export type DetachedGlobalReadValue<K extends DetachedGlobalKey> = DetachedGlobalValue<K> | undefined;
export type DetachedLocalKey = PureLocalSettingKey;
export type DetachedLocalValue<K extends DetachedLocalKey> = K extends "maintainBinaryEmbeddingCopy" ? boolean : string;
export interface DetachedSettingsPorts {
  getGlobal<K extends DetachedGlobalKey>(key: K): DetachedGlobalReadValue<K>;
  setGlobal<K extends DetachedGlobalKey>(key: K, value: DetachedGlobalValue<K>): Promise<void>;
  getLocal<K extends DetachedLocalKey>(key: K): DetachedLocalValue<K>;
  setLocal<K extends DetachedLocalKey>(key: K, value: DetachedLocalValue<K>): Promise<void>;
  applyEffect(effect: LocalSettingEffect): Promise<void>;
  requestUpdate(): void;
}

export interface DetachedConnectionTestPorts extends PureConnectionTestRuntimePorts {
  getConnectionInput(actionId: PureConnectionTestActionId): PureConnectionTestInput;
}
export const clampDetachedWeight = (value: string, fallback: number): number => Math.min(1, Math.max(0, Number.isNaN(Number.parseFloat(value)) ? fallback : Number.parseFloat(value)));
export function createDetachedTextRenderer(key: DetachedGlobalKey, name: string, description: string, placeholder: string, ports: DetachedSettingsPorts, normalize: (value: string) => string = (value) => value) {
  return (setting: Setting, _group: SettingGroup): void => { setting.setName(name).setDesc(description).addText((text) => text.setPlaceholder(placeholder).setValue(String(ports.getGlobal(key))).onChange(async (value) => { const next = normalize(value); await ports.setGlobal(key, next); text.setValue(next); })); };
}
export function createDetachedLanguageRenderer(labels: { name: string; pt: string; en: string }, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => { setting.setName(labels.name).addDropdown((dropdown) => dropdown.addOption("pt-PT", labels.pt).addOption("en", labels.en).setValue(ports.getGlobal("interfaceLanguage") === "en" ? "en" : "pt-PT").onChange(async (value) => { await ports.setGlobal("interfaceLanguage", value === "en" ? "en" : "pt-PT"); ports.requestUpdate(); })); };
}

const SUPPORT_URL = "https://www.buymeacoffee.com/apinheiro";
const SUPPORT_LINK_TEXT = "Buy Me a Coffee";
const INBOX_FOLDER_PLACEHOLDER = ["00", "Inbox"].join("_");

export type DetachedInformationalSettingDefinition = SettingDefinition & {
  id: "config-dir-note" | "support-link";
};

export type DetachedInteractiveSettingDefinition = SettingDefinition & {
  id: "inbox-folder" | "inbox-max-notes" | "hybrid-text-weight" | "hybrid-semantic-weight" | "interface-language";
};

export type DetachedProviderModelSettingDefinition = SettingDefinition & {
  id: "analysis-provider" | "analysis-model" | "embeddings-provider" | "embeddings-model";
};

export type DetachedNumericBinarySettingDefinition = SettingDefinition & {
  id: "analysis-timeout" | "embeddings-timeout" | "embeddings-batch-size" | "binary-preference" | "maintain-binary-copy";
};

export type DetachedConnectionTestSettingDefinition = SettingDefinition & {
  id: "test-analysis-connection" | "analysis-test-feedback" | "test-embeddings-connection" | "embeddings-test-feedback";
};

export function createDetachedConfigNoteRenderer(strings: UiStrings, configDir: string) {
  const description = strings.settingsExclusionsNote.replace("{configDir}", configDir);
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setDesc(description);
  };
}

export function createDetachedSupportLinkRenderer(strings: UiStrings) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setName(strings.settingsSupportLink);
    setting.descEl.createSpan({ text: `${strings.settingsSupportLink}: ` });
    setting.descEl.createEl("a", {
      href: SUPPORT_URL,
      text: SUPPORT_LINK_TEXT,
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
  };
}

/**
 * Experimental definitions kept detached from the active settings tab until a
 * later parity phase explicitly integrates them.
 */
export function createDetachedInformationalSettingDefinitions(
  strings: UiStrings,
  configDir: string,
): DetachedInformationalSettingDefinition[] {
  return [
    {
      id: "config-dir-note",
      name: strings.settingsExclusionsNote.replace("{configDir}", configDir),
      render: createDetachedConfigNoteRenderer(strings, configDir),
    },
    {
      id: "support-link",
      name: strings.settingsSupportLink,
      render: createDetachedSupportLinkRenderer(strings),
    },
  ];
}

export const clampDetachedInboxMaxNotes = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  return Math.min(20, Math.max(1, Number.isNaN(parsed) ? 10 : parsed));
};

export function createDetachedInboxFolderRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting
      .setName(strings.settingsInboxFolder)
      .setDesc(strings.settingsInboxFolderDesc)
      .addText((text) => text
        .setPlaceholder(INBOX_FOLDER_PLACEHOLDER)
        .setValue(ports.getGlobal("inboxFolderPath") ?? INBOX_FOLDER_PLACEHOLDER)
        .onChange(async (value) => {
          await ports.setGlobal("inboxFolderPath", value.trim());
        }));
  };
}

export function createDetachedInboxMaxNotesRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting
      .setName(strings.settingsInboxMaxNotes)
      .setDesc(strings.settingsInboxMaxNotesDesc)
      .addText((text) => text
        .setPlaceholder("10")
        .setValue(String(ports.getGlobal("maxInboxNotesToAnalyze") ?? 10))
        .onChange(async (value) => {
          const next = clampDetachedInboxMaxNotes(value);
          await ports.setGlobal("maxInboxNotesToAnalyze", next);
          text.setValue(String(next));
        }));
  };
}

function createDetachedHybridWeightRenderer(
  key: "hybridSearchTextWeight" | "hybridSearchSemanticWeight",
  name: string,
  description: string,
  placeholder: string,
  fallback: number,
  ports: DetachedSettingsPorts,
) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting
      .setName(name)
      .setDesc(description)
      .addText((text) => text
        .setPlaceholder(placeholder)
        .setValue(String(ports.getGlobal(key) ?? fallback))
        .onChange(async (value) => {
          const next = clampDetachedWeight(value, fallback);
          await ports.setGlobal(key, next);
          text.setValue(String(next));
        }));
  };
}

export function createDetachedTextWeightRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedHybridWeightRenderer("hybridSearchTextWeight", strings.settingsTextWeight, strings.settingsTextWeightDesc, "0.7", 0.7, ports);
}

export function createDetachedSemanticWeightRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedHybridWeightRenderer("hybridSearchSemanticWeight", strings.settingsSemanticWeight, strings.settingsSemanticWeightDesc, "0.3", 0.3, ports);
}

export function createDetachedInterfaceLanguageRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting
      .setName(strings.settingsInterfaceLanguage)
      .setDesc(strings.settingsInterfaceLanguageDescription)
      .addDropdown((dropdown) => {
        dropdown.addOption("pt-PT", strings.langPtPT);
        dropdown.addOption("en", strings.langEn);
        dropdown.setValue(ports.getGlobal("interfaceLanguage") === "en" ? "en" : "pt-PT");
        dropdown.onChange(async (value) => {
          await ports.setGlobal("interfaceLanguage", value === "en" ? "en" : "pt-PT");
          ports.requestUpdate();
        });
      });
  };
}

/** Experimental render definitions, intentionally not connected to a settings tab. */
export function createDetachedInteractiveSettingDefinitions(
  strings: UiStrings,
  ports: DetachedSettingsPorts,
): DetachedInteractiveSettingDefinition[] {
  return [
    { id: "inbox-folder", name: strings.settingsInboxFolder, render: createDetachedInboxFolderRenderer(strings, ports) },
    { id: "inbox-max-notes", name: strings.settingsInboxMaxNotes, render: createDetachedInboxMaxNotesRenderer(strings, ports) },
    { id: "hybrid-text-weight", name: strings.settingsTextWeight, render: createDetachedTextWeightRenderer(strings, ports) },
    { id: "hybrid-semantic-weight", name: strings.settingsSemanticWeight, render: createDetachedSemanticWeightRenderer(strings, ports) },
    { id: "interface-language", name: strings.settingsInterfaceLanguage, render: createDetachedInterfaceLanguageRenderer(strings, ports) },
  ];
}

const DETACHED_CUSTOM_MODEL_VALUE = "__lina_custom_model__";

function detachedProviderValue(ports: DetachedSettingsPorts, key: "analysisProvider" | "embeddingsProvider"): string {
  return ports.getLocal(key) || "ollama";
}

function detachedModelValue(
  ports: DetachedSettingsPorts,
  key: "analysisModel" | "embeddingsModel",
  provider: string,
  domain: PureLocalProviderDomain,
): string {
  return chooseProviderDefaultModel(ports.getLocal(key), provider, domain === "analysis" ? "analysis" : "embedding");
}

function detachedBaseUrlValue(
  ports: DetachedSettingsPorts,
  key: "analysisBaseUrl" | "embeddingsBaseUrl",
  provider: string,
): string {
  return chooseProviderDefaultBaseUrl(ports.getLocal(key), provider);
}

async function applyDetachedProviderEffects(
  ports: DetachedSettingsPorts,
  domain: PureLocalProviderDomain,
  provider: string,
  currentModel: string,
  currentBaseUrl: string,
): Promise<void> {
  const nextBaseUrl = chooseProviderDefaultBaseUrl(currentBaseUrl, provider);
  const nextModel = chooseProviderDefaultModel(currentModel, provider, domain === "analysis" ? "analysis" : "embedding");
  const effects: LocalSettingEffect[] = [];

  if (domain === "embedding") effects.push({ type: "mark-embeddings-dirty" });
  if (nextBaseUrl !== currentBaseUrl) effects.push({ type: "set-default-base-url", value: nextBaseUrl });
  if (nextModel !== currentModel) effects.push({ type: "set-default-model", value: nextModel });
  effects.push({ type: "refresh-model-options" });

  for (const effect of effects) {
    await ports.applyEffect(effect);
  }
}

function createDetachedProviderRenderer(
  domain: PureLocalProviderDomain,
  strings: UiStrings,
  ports: DetachedSettingsPorts,
) {
  const providerKey = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
  const modelKey = domain === "analysis" ? "analysisModel" : "embeddingsModel";
  const baseUrlKey = domain === "analysis" ? "analysisBaseUrl" : "embeddingsBaseUrl";
  const provider = detachedProviderValue(ports, providerKey);
  const currentModel = detachedModelValue(ports, modelKey, provider, domain);
  const currentBaseUrl = detachedBaseUrlValue(ports, baseUrlKey, provider);
  const adapter = createPureProviderAdapter(domain, {
    provider,
    currentModel,
    currentBaseUrl,
    strings: { provider: strings.settingsProvider },
  });

  return (setting: Setting, _group: SettingGroup): void => {
    setting.setName(adapter.name).addDropdown((dropdown) => {
      for (const option of adapter.options) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(adapter.value).onChange(async (value) => {
        await ports.setLocal(providerKey, value);
        await applyDetachedProviderEffects(ports, domain, value, currentModel, currentBaseUrl);
        ports.requestUpdate();
      });
    });
  };
}

export function createDetachedAnalysisProviderRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedProviderRenderer("analysis", strings, ports);
}

export function createDetachedEmbeddingsProviderRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedProviderRenderer("embedding", strings, ports);
}

function createDetachedModelRenderer(
  domain: PureLocalProviderDomain,
  strings: UiStrings,
  ports: DetachedSettingsPorts,
) {
  const providerKey = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
  const modelKey = domain === "analysis" ? "analysisModel" : "embeddingsModel";
  const provider = detachedProviderValue(ports, providerKey);
  const currentModel = detachedModelValue(ports, modelKey, provider, domain);
  const adapter = createPureModelAdapter(domain, {
    provider,
    currentModel,
    strings: {
      model: strings.settingsModel,
      manualModel: strings.settingsManualModel,
      manualModelDescription: strings.settingsManualModelDesc,
    },
    placeholder: domain === "analysis" ? "gemma4:e2b" : "nomic-embed-text-v2-moe",
  });

  return (setting: Setting, group: SettingGroup): void => {
    let updateManualInput: ((value: string) => void) | undefined;
    setting
      .setName(adapter.name)
      .setDesc(strings.settingsModelCatalogDesc)
      .addDropdown((dropdown) => {
        for (const option of adapter.catalog) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.addOption(DETACHED_CUSTOM_MODEL_VALUE, strings.settingsCustomModelOption);
        dropdown.setValue(adapter.selectedCatalogValue ?? DETACHED_CUSTOM_MODEL_VALUE);
        dropdown.onChange(async (value) => {
          if (value === DETACHED_CUSTOM_MODEL_VALUE) return;
          await ports.setLocal(modelKey, value);
          if (domain === "embedding") await ports.applyEffect({ type: "mark-embeddings-dirty" });
          updateManualInput?.(value);
        });
      });

    group.addSetting((manualSetting) => {
      manualSetting
        .setName(adapter.manualControl.name)
        .setDesc(adapter.manualControl.desc)
        .addText((text) => {
          updateManualInput = (value): void => {
            text.setValue(value);
          };
          return text
            .setPlaceholder(adapter.manualControl.placeholder)
            .setValue(adapter.value)
            .onChange(async (value) => {
              await ports.setLocal(modelKey, value);
              if (domain === "embedding") await ports.applyEffect({ type: "mark-embeddings-dirty" });
            });
        });
    });

    if (domain === "embedding") {
      group.listEl.createEl("p", {
        text: strings.settingsEmbeddingModelChangeWarning,
        attr: { style: "font-size: 0.85em; color: var(--text-muted); margin-top: -4px;" },
      });
    }
  };
}

export function createDetachedAnalysisModelRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedModelRenderer("analysis", strings, ports);
}

export function createDetachedEmbeddingsModelRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedModelRenderer("embedding", strings, ports);
}

/** Experimental provider/model definitions, intentionally detached from active settings. */
export function createDetachedProviderModelSettingDefinitions(
  strings: UiStrings,
  ports: DetachedSettingsPorts,
): DetachedProviderModelSettingDefinition[] {
  return [
    { id: "analysis-provider", name: strings.settingsProvider, render: createDetachedAnalysisProviderRenderer(strings, ports) },
    { id: "analysis-model", name: strings.settingsModel, render: createDetachedAnalysisModelRenderer(strings, ports) },
    { id: "embeddings-provider", name: strings.settingsProvider, render: createDetachedEmbeddingsProviderRenderer(strings, ports) },
    { id: "embeddings-model", name: strings.settingsModel, render: createDetachedEmbeddingsModelRenderer(strings, ports) },
  ];
}

function createDetachedNumericRenderer(
  kind: "analysis-timeout" | "embeddings-timeout" | "embedding-batch-size",
  key: "analysisTimeout" | "embeddingsTimeout" | "embeddingsBatchSize",
  strings: UiStrings,
  ports: DetachedSettingsPorts,
) {
  const adapter = createPureNumericAdapter(kind, ports.getLocal(key) || (kind === "embedding-batch-size" ? "10" : "60"), {
    timeout: strings.settingsTimeout,
    timeoutDescription: strings.settingsTimeoutDesc,
    batchSize: strings.settingsBatchSize,
    batchSizeDescription: strings.settingsBatchSizeDesc,
  });
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setName(adapter.name).setDesc(adapter.desc).addText((text) => text
      .setPlaceholder(adapter.fallback)
      .setValue(adapter.value)
      .onChange(async (value) => {
        const next = normalizePureLocalNumericValue(kind, value);
        await ports.setLocal(key, next);
        text.setValue(next);
      }));
  };
}

export function createDetachedAnalysisTimeoutRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedNumericRenderer("analysis-timeout", "analysisTimeout", strings, ports);
}

export function createDetachedEmbeddingsTimeoutRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedNumericRenderer("embeddings-timeout", "embeddingsTimeout", strings, ports);
}

export function createDetachedEmbeddingsBatchSizeRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return createDetachedNumericRenderer("embedding-batch-size", "embeddingsBatchSize", strings, ports);
}

export function createDetachedBinaryPreferenceRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  const value = ports.getLocal("embeddingStorageReadPreference") === "prefer-binary" ? "prefer-binary" : "jsonl";
  const adapter = createPureBinaryPreferenceAdapter(value, {
    storagePreference: strings.settingsBinaryPreference,
    storagePreferenceDescription: strings.settingsBinaryPreferenceDesc,
    preferBinary: strings.settingsBinaryPrefer,
  });
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setName(adapter.name).setDesc(adapter.desc).addDropdown((dropdown) => {
      for (const option of adapter.options) dropdown.addOption(option.value, option.label);
      dropdown.setValue(adapter.value).onChange(async (nextValue) => {
        const next = nextValue === "prefer-binary" ? "prefer-binary" : "jsonl";
        await ports.setLocal("embeddingStorageReadPreference", next);
        for (const effect of adapter.declaredEffects) {
          if (effect.type !== "rerender-settings") await ports.applyEffect(effect);
        }
        ports.requestUpdate();
      });
    });
  };
}

export function createDetachedMaintainBinaryCopyRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  const adapter = createPureBinaryMaintenanceAdapter(ports.getLocal("maintainBinaryEmbeddingCopy"), {
    maintainBinaryCopy: strings.settingsBinaryMaintain,
    maintainBinaryCopyDescription: strings.settingsBinaryMaintainDesc,
  });
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setName(adapter.name).setDesc(adapter.desc).addToggle((toggle) => toggle
      .setValue(adapter.value)
      .onChange(async (value) => {
        await ports.setLocal("maintainBinaryEmbeddingCopy", value);
        ports.requestUpdate();
      }));
  };
}

/** Experimental timeout/binary definitions, intentionally detached from active settings. */
export function createDetachedNumericBinarySettingDefinitions(
  strings: UiStrings,
  ports: DetachedSettingsPorts,
): DetachedNumericBinarySettingDefinition[] {
  return [
    { id: "analysis-timeout", name: strings.settingsTimeout, render: createDetachedAnalysisTimeoutRenderer(strings, ports) },
    { id: "embeddings-timeout", name: strings.settingsTimeout, render: createDetachedEmbeddingsTimeoutRenderer(strings, ports) },
    { id: "embeddings-batch-size", name: strings.settingsBatchSize, render: createDetachedEmbeddingsBatchSizeRenderer(strings, ports) },
    { id: "binary-preference", name: strings.settingsBinaryPreference, render: createDetachedBinaryPreferenceRenderer(strings, ports) },
    { id: "maintain-binary-copy", name: strings.settingsBinaryMaintain, render: createDetachedMaintainBinaryCopyRenderer(strings, ports) },
  ];
}

function createDetachedConnectionTestFeedbackStrings(strings: UiStrings): PureConnectionTestFeedbackStrings {
  return {
    testingConnection: strings.settingsTestingConnection,
    connectionSuccess: strings.settingsConnectionSuccess,
    connectionFailed: strings.settingsConnectionFailed,
    embeddingTestFailed: strings.settingsEmbeddingTestFailed,
    analysisApiKeyMissing: strings.settingsApiKeyMissing,
    embeddingsApiKeyMissing: strings.settingsEmbeddingTestMistralApiKeyMissing,
  };
}

function createDetachedConnectionFeedbackRenderer(
  actionId: PureConnectionTestActionId,
  strings: UiStrings,
  runtime: PureConnectionTestRuntime,
) {
  const name = actionId === "test-analysis-connection"
    ? strings.settingsTestConnection
    : strings.settingsTestEmbeddingsConnection;
  const feedbackStrings = createDetachedConnectionTestFeedbackStrings(strings);

  return (setting: Setting, _group: SettingGroup): void => {
    setting.setName(name);
    setting.descEl.createEl("p", {
      text: getPureConnectionTestFeedbackText(feedbackStrings, runtime.getState(actionId)),
      attr: { "aria-live": "polite" },
    });
  };
}

export function createDetachedAnalysisConnectionFeedbackRenderer(
  strings: UiStrings,
  runtime: PureConnectionTestRuntime,
) {
  return createDetachedConnectionFeedbackRenderer("test-analysis-connection", strings, runtime);
}

export function createDetachedEmbeddingsConnectionFeedbackRenderer(
  strings: UiStrings,
  runtime: PureConnectionTestRuntime,
) {
  return createDetachedConnectionFeedbackRenderer("test-embeddings-connection", strings, runtime);
}

/** Experimental connection-test definitions, intentionally detached from active settings. */
export function createDetachedConnectionTestSettingDefinitions(
  strings: UiStrings,
  ports: DetachedConnectionTestPorts,
): DetachedConnectionTestSettingDefinition[] {
  const runtime = createPureConnectionTestRuntime(ports);
  const createAction = (actionId: PureConnectionTestActionId, name: string): DetachedConnectionTestSettingDefinition => ({
    id: actionId,
    name,
    action: (): void => {
      void runtime.run(actionId, ports.getConnectionInput(actionId));
    },
    disabled: () => runtime.isDisabled(actionId),
  });

  return [
    createAction("test-analysis-connection", strings.settingsTestConnection),
    {
      id: "analysis-test-feedback",
      name: strings.settingsTestConnection,
      render: createDetachedAnalysisConnectionFeedbackRenderer(strings, runtime),
    },
    createAction("test-embeddings-connection", strings.settingsTestEmbeddingsConnection),
    {
      id: "embeddings-test-feedback",
      name: strings.settingsTestEmbeddingsConnection,
      render: createDetachedEmbeddingsConnectionFeedbackRenderer(strings, runtime),
    },
  ];
}
