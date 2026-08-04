import type { SettingDefinition } from "obsidian";
import type { UiStrings } from "../i18n/strings";
import type { PureLocalSettingKey } from "./pureLocalSettingsModel";

export const PURE_LOCAL_CONTROL_KEYS = [
  "deviceName",
  "analysisBaseUrl",
  "embeddingsBaseUrl",
] as const;

export type PureLocalControlKey = typeof PURE_LOCAL_CONTROL_KEYS[number];
export type PureLocalSettingDisposition = "control-pure" | "render-required" | "future-side-effect";

export interface PureLocalSettingClassification {
  key: PureLocalSettingKey;
  disposition: PureLocalSettingDisposition;
}

export const PURE_LOCAL_SETTING_CLASSIFICATIONS: readonly PureLocalSettingClassification[] = [
  { key: "deviceName", disposition: "control-pure" },
  { key: "analysisProvider", disposition: "future-side-effect" },
  { key: "analysisModel", disposition: "render-required" },
  { key: "analysisBaseUrl", disposition: "control-pure" },
  { key: "analysisTimeout", disposition: "future-side-effect" },
  { key: "embeddingsProvider", disposition: "future-side-effect" },
  { key: "embeddingsModel", disposition: "render-required" },
  { key: "embeddingsBaseUrl", disposition: "control-pure" },
  { key: "embeddingsBatchSize", disposition: "future-side-effect" },
  { key: "embeddingsTimeout", disposition: "future-side-effect" },
  { key: "embeddingStorageReadPreference", disposition: "future-side-effect" },
  { key: "maintainBinaryEmbeddingCopy", disposition: "future-side-effect" },
];

type PureLocalSettingDefinitionStrings = Pick<
  UiStrings,
  | "settingsDeviceName"
  | "settingsDeviceNamePlaceholder"
  | "settingsBaseUrl"
  | "settingsBaseUrlAutoDesc"
>;

export interface PureLocalSettingDefinitionInputs {
  strings: PureLocalSettingDefinitionStrings;
  analysisBaseUrlPlaceholder: string;
  embeddingsBaseUrlPlaceholder: string;
}

export function createPureLocalSettingDefinitions(
  inputs: PureLocalSettingDefinitionInputs
): Array<SettingDefinition<PureLocalControlKey>> {
  return [
    {
      name: inputs.strings.settingsDeviceName,
      control: {
        type: "text",
        key: "deviceName",
        placeholder: inputs.strings.settingsDeviceNamePlaceholder,
      },
    },
    {
      name: inputs.strings.settingsBaseUrl,
      desc: inputs.strings.settingsBaseUrlAutoDesc,
      control: {
        type: "text",
        key: "analysisBaseUrl",
        placeholder: inputs.analysisBaseUrlPlaceholder,
      },
    },
    {
      name: inputs.strings.settingsBaseUrl,
      desc: inputs.strings.settingsBaseUrlAutoDesc,
      control: {
        type: "text",
        key: "embeddingsBaseUrl",
        placeholder: inputs.embeddingsBaseUrlPlaceholder,
      },
    },
  ];
}
