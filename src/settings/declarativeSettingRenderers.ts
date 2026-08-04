import type { Setting, SettingDefinition, SettingGroup } from "obsidian";
import type { UiStrings } from "../i18n/strings";

export type DetachedGlobalKey = "inboxFolderPath" | "maxInboxNotesToAnalyze" | "hybridSearchTextWeight" | "hybridSearchSemanticWeight" | "interfaceLanguage";
export type DetachedGlobalValue<K extends DetachedGlobalKey> =
  K extends "inboxFolderPath" ? string :
  K extends "interfaceLanguage" ? "pt-PT" | "en" :
  number;
export type DetachedGlobalReadValue<K extends DetachedGlobalKey> = DetachedGlobalValue<K> | undefined;
export type DetachedLocalKey = "analysisProvider" | "analysisModel" | "analysisTimeout" | "embeddingsProvider" | "embeddingsModel" | "embeddingsBatchSize" | "embeddingsTimeout" | "embeddingStorageReadPreference" | "maintainBinaryEmbeddingCopy";
export interface DetachedSettingsPorts {
  getGlobal<K extends DetachedGlobalKey>(key: K): DetachedGlobalReadValue<K>;
  setGlobal<K extends DetachedGlobalKey>(key: K, value: DetachedGlobalValue<K>): Promise<void>;
  getLocal(key: DetachedLocalKey): string | boolean;
  setLocal(key: DetachedLocalKey, value: string | boolean): Promise<void>;
  applyEffect(effect: string): Promise<void>;
  requestUpdate(): void;
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

export type DetachedInformationalSettingDefinition = SettingDefinition & {
  id: "config-dir-note" | "support-link";
};

export type DetachedInteractiveSettingDefinition = SettingDefinition & {
  id: "inbox-folder" | "inbox-max-notes" | "hybrid-text-weight" | "hybrid-semantic-weight" | "interface-language";
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
        .setPlaceholder("00_Inbox")
        .setValue(ports.getGlobal("inboxFolderPath") ?? "00_Inbox")
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
