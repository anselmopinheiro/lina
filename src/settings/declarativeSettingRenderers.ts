import type { Setting, SettingDefinition, SettingGroup } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import { chooseProviderDefaultBaseUrl, chooseProviderDefaultModel } from "../ai/providerDefaults";
import { createPureBinaryMaintenanceAdapter, createPureBinaryPreferenceAdapter, createPureModelAdapter, createPureNumericAdapter, createPureProviderAdapter, normalizePureLocalNumericValue, type LocalSettingEffect } from "./pureLocalSettingAdapters";
import {
  createPureAutoUpdateIndexAdapter,
  createPureMaxSuggestedTagsAdapter,
  normalizePureHybridSearchWeight,
  normalizePureInboxMaxNotes,
  normalizePureMaxSuggestedTags,
  type PureGlobalSettingEffect,
} from "./pureGlobalSettingAdapters";
import type { PureLocalSettingKey, PureLocalProviderDomain } from "./pureLocalSettingsModel";

export type DetachedGlobalKey = "inboxFolderPath" | "maxInboxNotesToAnalyze" | "hybridSearchTextWeight" | "hybridSearchSemanticWeight" | "interfaceLanguage" | "autoUpdateIndexOnFileChanges" | "maxSuggestedTags";
export type DetachedGlobalValue<K extends DetachedGlobalKey> =
  K extends "inboxFolderPath" ? string :
  K extends "interfaceLanguage" ? "pt-PT" | "en" :
  K extends "autoUpdateIndexOnFileChanges" ? boolean :
  number;
export type DetachedGlobalReadValue<K extends DetachedGlobalKey> = DetachedGlobalValue<K> | undefined;
export type DetachedLocalKey = PureLocalSettingKey;
export type DetachedLocalValue<K extends DetachedLocalKey> = K extends "maintainBinaryEmbeddingCopy" ? boolean : string;
export interface DetachedSettingsPorts {
  getGlobal<K extends DetachedGlobalKey>(key: K): DetachedGlobalReadValue<K>;
  setGlobal<K extends DetachedGlobalKey>(
    key: K,
    value: DetachedGlobalValue<K>,
    effects?: readonly PureGlobalSettingEffect[],
  ): Promise<void>;
  getLocal<K extends DetachedLocalKey>(key: K): DetachedLocalValue<K>;
  setLocal<K extends DetachedLocalKey>(
    key: K,
    value: DetachedLocalValue<K>,
    effects?: readonly LocalSettingEffect[],
  ): Promise<void>;
  setProvider(
    domain: PureLocalProviderDomain,
    provider: string,
    model: string,
    baseUrl: string,
    effects?: readonly LocalSettingEffect[],
  ): Promise<boolean>;
  requestUpdate(): void;
}

export const clampDetachedWeight = normalizePureHybridSearchWeight;
export function createDetachedTextRenderer(key: DetachedGlobalKey, name: string, description: string, placeholder: string, ports: DetachedSettingsPorts, normalize: (value: string) => string = (value) => value) {
  return (setting: Setting, _group: SettingGroup): void => { setting.setName(name).setDesc(description).addText((text) => text.setPlaceholder(placeholder).setValue(String(ports.getGlobal(key))).onChange(async (value) => { const next = normalize(value); await ports.setGlobal(key, next); text.setValue(next); })); };
}
export function createDetachedLanguageRenderer(labels: { name: string; pt: string; en: string }, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => { setting.setName(labels.name).addDropdown((dropdown) => dropdown.addOption("pt-PT", labels.pt).addOption("en", labels.en).setValue(ports.getGlobal("interfaceLanguage") === "en" ? "en" : "pt-PT").onChange(async (value) => { await ports.setGlobal("interfaceLanguage", value === "en" ? "en" : "pt-PT"); ports.requestUpdate(); })); };
}

const SUPPORT_URL = "https://www.buymeacoffee.com/apinheiro";
const SUPPORT_LINK_TEXT = "Buy Me a Coffee";
const INBOX_FOLDER_PLACEHOLDER = ["00", "Inbox"].join("_");

export interface DeclarativeSettingsButtonAction {
  run(): void;
  isDisabled(): boolean;
}

/** Renders an executable declarative action as a native Obsidian button. */
export function createDeclarativeSettingsButtonRenderer(
  name: string,
  action: DeclarativeSettingsButtonAction,
  options: { destructive?: boolean } = {},
) {
  return (setting: Setting, group: SettingGroup): void => {
    setting.setName(name).addButton((button) => {
      button.setButtonText(name);
      if (options.destructive) button.setDestructive();
      button
        .setDisabled(action.isDisabled())
        .onClick(() => action.run());
    });
  };
}

export type DetachedInformationalSettingDefinition = SettingDefinition & {
  id: "config-dir-note" | "support-link";
};

export type DetachedInteractiveSettingDefinition = SettingDefinition & {
  id: "inbox-folder" | "inbox-max-notes" | "hybrid-text-weight" | "hybrid-semantic-weight" | "interface-language";
};

export type DetachedIndexYamlSettingDefinition = SettingDefinition & {
  id: "auto-update-index-on-file-changes" | "max-suggested-tags";
};

export type DetachedProviderModelSettingDefinition = SettingDefinition & {
  id: "analysis-provider" | "analysis-model" | "embeddings-provider" | "embeddings-model";
};

export type DetachedNumericBinarySettingDefinition = SettingDefinition & {
  id: "analysis-timeout" | "embeddings-timeout" | "embeddings-batch-size" | "binary-preference" | "maintain-binary-copy";
};


export function createDetachedConfigNoteRenderer(strings: UiStrings, configDir: string) {
  const description = strings.settingsExclusionsNote.replace("{configDir}", configDir);
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setDesc(description);
  };
}

export function createDetachedSupportLinkRenderer(strings: UiStrings) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting.descEl.createEl("a", {
      href: SUPPORT_URL,
      text: SUPPORT_LINK_TEXT,
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
  };
}

/** A detached static row that does not create DOM until Obsidian renders it. */
export function createDetachedStaticTextRenderer(name: string, description: string) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setName(name).setDesc(description);
  };
}

export function createDetachedDescriptionRenderer(description: string) {
  return (setting: Setting, _group: SettingGroup): void => {
    setting.setDesc(description);
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

export const clampDetachedInboxMaxNotes = normalizePureInboxMaxNotes;

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

export function createDetachedAutoUpdateIndexRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  const adapter = createPureAutoUpdateIndexAdapter();
  return (setting: Setting, _group: SettingGroup): void => {
    setting
      .setName(strings.settingsAutoUpdateIndex)
      .setDesc(strings.settingsAutoUpdateIndexDesc)
      .addToggle((toggle) => toggle
        .setValue(ports.getGlobal(adapter.key) ?? adapter.defaultValue)
        .onChange(async (value) => {
          await ports.setGlobal(adapter.key, value, adapter.declaredEffects);
        }));
  };
}

export function createDetachedMaxSuggestedTagsRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => {
    const adapter = createPureMaxSuggestedTagsAdapter(ports.getGlobal("maxSuggestedTags"));
    setting
      .setName(strings.settingsMaxTags)
      .setDesc(strings.settingsMaxTagsDesc)
      .addDropdown((dropdown) => {
        for (const option of adapter.options) {
          dropdown.addOption(String(option), String(option));
        }
        dropdown.setValue(String(adapter.value));
        dropdown.onChange(async (value) => {
          await ports.setGlobal(adapter.key, normalizePureMaxSuggestedTags(value));
        });
      });
  };
}

/** Experimental index/YAML definitions, intentionally detached from active settings. */
export function createDetachedIndexYamlSettingDefinitions(
  strings: UiStrings,
  ports: DetachedSettingsPorts,
): DetachedIndexYamlSettingDefinition[] {
  return [
    {
      id: "auto-update-index-on-file-changes",
      name: strings.settingsAutoUpdateIndex,
      render: createDetachedAutoUpdateIndexRenderer(strings, ports),
    },
    {
      id: "max-suggested-tags",
      name: strings.settingsMaxTags,
      render: createDetachedMaxSuggestedTagsRenderer(strings, ports),
    },
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

function detachedProviderEffects(domain: PureLocalProviderDomain): LocalSettingEffect[] {
  const effects: LocalSettingEffect[] = [];

  if (domain === "embedding") effects.push({ type: "mark-embeddings-dirty" });
  effects.push({ type: "refresh-model-options" });

  return effects;
}

function createDetachedProviderRenderer(
  domain: PureLocalProviderDomain,
  strings: UiStrings,
  ports: DetachedSettingsPorts,
) {
  const providerKey = domain === "analysis" ? "analysisProvider" : "embeddingsProvider";
  const modelKey = domain === "analysis" ? "analysisModel" : "embeddingsModel";
  const baseUrlKey = domain === "analysis" ? "analysisBaseUrl" : "embeddingsBaseUrl";
  return (setting: Setting, _group: SettingGroup): void => {
    const provider = detachedProviderValue(ports, providerKey);
    const currentModel = detachedModelValue(ports, modelKey, provider, domain);
    const currentBaseUrl = detachedBaseUrlValue(ports, baseUrlKey, provider);
    const adapter = createPureProviderAdapter(domain, {
      provider,
      currentModel,
      currentBaseUrl,
      strings: { provider: strings.settingsProvider },
    });
    setting.setName(adapter.name).addDropdown((dropdown) => {
      for (const option of adapter.options) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(adapter.value).onChange(async (value) => {
        const nextBaseUrl = chooseProviderDefaultBaseUrl(currentBaseUrl, value);
        const nextModel = chooseProviderDefaultModel(currentModel, value, domain === "analysis" ? "analysis" : "embedding");
        const persisted = await ports.setProvider(
          domain,
          value,
          nextModel,
          nextBaseUrl,
          detachedProviderEffects(domain),
        );
        if (persisted) ports.requestUpdate();
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
  let manualProvider: string | undefined;
  return (setting: Setting, group: SettingGroup): void => {
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
    setting
      .setName(adapter.name)
      .setDesc(strings.settingsModelCatalogDesc);

    if (adapter.controlType === "dropdown") {
      setting.addDropdown((dropdown) => {
        for (const option of adapter.catalog) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.addOption(DETACHED_CUSTOM_MODEL_VALUE, strings.settingsCustomModelOption);
        dropdown.setValue(adapter.selectedCatalogValue ?? DETACHED_CUSTOM_MODEL_VALUE);
        dropdown.onChange(async (value) => {
          if (value === DETACHED_CUSTOM_MODEL_VALUE) {
            manualProvider = provider;
            ports.requestUpdate();
            return;
          }
          manualProvider = undefined;
          await ports.setLocal(modelKey, value, adapter.declaredEffects);
        });
      });

      if (adapter.showManualControl || manualProvider === provider) {
        setting.addText((text) => text
          .setPlaceholder(adapter.manualControl.placeholder)
          .setValue(adapter.value)
          .onChange(async (value) => {
            await ports.setLocal(modelKey, value, adapter.declaredEffects);
          }));
      }
    } else {
      setting.addText((text) => text
        .setValue(adapter.value)
        .onChange(async (value) => {
          await ports.setLocal(modelKey, value, adapter.declaredEffects);
        }));
    }

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
  return (setting: Setting, _group: SettingGroup): void => {
    const adapter = createPureNumericAdapter(kind, ports.getLocal(key) || (kind === "embedding-batch-size" ? "10" : "60"), {
      timeout: strings.settingsTimeout,
      timeoutDescription: strings.settingsTimeoutDesc,
      batchSize: strings.settingsBatchSize,
      batchSizeDescription: strings.settingsBatchSizeDesc,
    });
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
  return (setting: Setting, _group: SettingGroup): void => {
    const value = ports.getLocal("embeddingStorageReadPreference") === "prefer-binary" ? "prefer-binary" : "jsonl";
    const adapter = createPureBinaryPreferenceAdapter(value, {
      storagePreference: strings.settingsBinaryPreference,
      storagePreferenceDescription: strings.settingsBinaryPreferenceDesc,
      preferBinary: strings.settingsBinaryPrefer,
    });
    setting.setName(adapter.name).setDesc(adapter.desc).addDropdown((dropdown) => {
      for (const option of adapter.options) dropdown.addOption(option.value, option.label);
      dropdown.setValue(adapter.value).onChange(async (nextValue) => {
        const next = nextValue === "prefer-binary" ? "prefer-binary" : "jsonl";
        await ports.setLocal(
          "embeddingStorageReadPreference",
          next,
          adapter.declaredEffects.filter((effect) => effect.type !== "rerender-settings"),
        );
        ports.requestUpdate();
      });
    });
  };
}

export function createDetachedMaintainBinaryCopyRenderer(strings: UiStrings, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => {
    const adapter = createPureBinaryMaintenanceAdapter(ports.getLocal("maintainBinaryEmbeddingCopy"), {
      maintainBinaryCopy: strings.settingsBinaryMaintain,
      maintainBinaryCopyDescription: strings.settingsBinaryMaintainDesc,
    });
    setting.setName(adapter.name).setDesc(adapter.desc).addToggle((toggle) => toggle
      .setValue(adapter.value)
      .onChange(async (value) => {
        await ports.setLocal(
          "maintainBinaryEmbeddingCopy",
          value,
          adapter.declaredEffects.filter((effect) => effect.type !== "rerender-settings"),
        );
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
