import type { Setting, SettingDefinition, SettingGroup } from "obsidian";
import type { UiStrings } from "../i18n/strings";

export type DetachedGlobalKey = "inboxFolderPath" | "hybridSearchTextWeight" | "hybridSearchSemanticWeight" | "interfaceLanguage";
export type DetachedLocalKey = "analysisProvider" | "analysisModel" | "analysisTimeout" | "embeddingsProvider" | "embeddingsModel" | "embeddingsBatchSize" | "embeddingsTimeout" | "embeddingStorageReadPreference" | "maintainBinaryEmbeddingCopy";
export interface DetachedSettingsPorts {
  getGlobal(key: DetachedGlobalKey): string | number;
  setGlobal(key: DetachedGlobalKey, value: string | number): Promise<void>;
  getLocal(key: DetachedLocalKey): string | boolean;
  setLocal(key: DetachedLocalKey, value: string | boolean): Promise<void>;
  applyEffect(effect: string): Promise<void>;
  requestRefresh(): void;
}
export const clampDetachedWeight = (value: string, fallback: number): number => Math.min(1, Math.max(0, Number.isNaN(Number.parseFloat(value)) ? fallback : Number.parseFloat(value)));
export function createDetachedTextRenderer(key: DetachedGlobalKey, name: string, description: string, placeholder: string, ports: DetachedSettingsPorts, normalize: (value: string) => string = (value) => value) {
  return (setting: Setting, _group: SettingGroup): void => { setting.setName(name).setDesc(description).addText((text) => text.setPlaceholder(placeholder).setValue(String(ports.getGlobal(key))).onChange(async (value) => { const next = normalize(value); await ports.setGlobal(key, next); text.setValue(next); })); };
}
export function createDetachedLanguageRenderer(labels: { name: string; pt: string; en: string }, ports: DetachedSettingsPorts) {
  return (setting: Setting, _group: SettingGroup): void => { setting.setName(labels.name).addDropdown((dropdown) => dropdown.addOption("pt-PT", labels.pt).addOption("en", labels.en).setValue(String(ports.getGlobal("interfaceLanguage"))).onChange(async (value) => { await ports.setGlobal("interfaceLanguage", value); ports.requestRefresh(); })); };
}

const SUPPORT_URL = "https://www.buymeacoffee.com/apinheiro";
const SUPPORT_LINK_TEXT = "Buy Me a Coffee";

export type DetachedInformationalSettingDefinition = SettingDefinition & {
  id: "config-dir-note" | "support-link";
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
