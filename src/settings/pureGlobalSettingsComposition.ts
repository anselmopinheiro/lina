import type { SettingDefinitionGroup } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import type { DeclarativeGlobalSettingKey } from "./declarativeGlobalSettings";
import { createPureGlobalSettingDefinitions } from "./pureGlobalSettingDefinitions";

export function createPureGlobalSettingsComposition(
  strings: UiStrings
): Array<SettingDefinitionGroup<DeclarativeGlobalSettingKey>> {
  const definitions = createPureGlobalSettingDefinitions(strings);

  return [
    {
      type: "group",
      heading: strings.settingsEmbeddingsSection,
      items: [definitions[0], definitions[11]],
    },
    {
      type: "group",
      heading: strings.settingsIndexSection,
      items: [definitions[1], definitions[2], definitions[3]],
    },
    {
      type: "group",
      heading: strings.settingsExclusionsSection,
      items: [definitions[4], definitions[5], definitions[6]],
    },
    {
      type: "group",
      heading: strings.settingsYamlSection,
      items: [definitions[7], definitions[8], definitions[9]],
    },
    {
      type: "group",
      heading: strings.settingsMultilingual,
      items: [definitions[10]],
    },
  ];
}
