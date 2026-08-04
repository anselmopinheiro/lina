import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { PURE_LOCAL_SETTING_KEYS } from "../../src/settings/pureLocalSettingsModel";
import {
  PURE_LOCAL_CONTROL_KEYS,
  PURE_LOCAL_SETTING_CLASSIFICATIONS,
  createPureLocalSettingDefinitions,
} from "../../src/settings/pureLocalSettingDefinitions";

function createInputs(language: "pt-PT" | "en" | undefined) {
  return {
    strings: getStrings(language),
    analysisBaseUrlPlaceholder: "https://analysis.example.invalid/v1",
    embeddingsBaseUrlPlaceholder: "https://embeddings.example.invalid/v1",
  };
}

describe("pure local setting definitions", () => {
  it("creates only the three controls that do not need extra behavior", () => {
    const definitions = createPureLocalSettingDefinitions(createInputs("pt-PT"));

    expect(definitions).toHaveLength(3);
    expect(definitions.map((definition) => definition.control.key)).toEqual(PURE_LOCAL_CONTROL_KEYS);
    expect(new Set(definitions.map((definition) => definition.control.key)).size).toBe(3);
    expect(definitions.map((definition) => definition.control.type)).toEqual(["text", "text", "text"]);
    expect(definitions.every((definition) => Object.keys(definition).includes("control"))).toBe(true);
  });

  it("classifies all authorized local keys and keeps complex controls deferred", () => {
    expect(PURE_LOCAL_SETTING_CLASSIFICATIONS.map((classification) => classification.key)).toEqual(PURE_LOCAL_SETTING_KEYS);
    expect(PURE_LOCAL_SETTING_CLASSIFICATIONS.filter((classification) => classification.disposition === "control-pure").map((classification) => classification.key)).toEqual(PURE_LOCAL_CONTROL_KEYS);
    expect(PURE_LOCAL_SETTING_CLASSIFICATIONS.filter((classification) => classification.disposition === "render-required").map((classification) => classification.key)).toEqual([
      "analysisModel", "embeddingsModel",
    ]);
    expect(PURE_LOCAL_SETTING_CLASSIFICATIONS.filter((classification) => classification.disposition === "future-side-effect").map((classification) => classification.key)).toEqual([
      "analysisProvider", "analysisTimeout", "embeddingsProvider", "embeddingsBatchSize",
      "embeddingsTimeout", "embeddingStorageReadPreference", "maintainBinaryEmbeddingCopy",
    ]);
  });

  it.each(["pt-PT", "en"] as const)("reuses labels, descriptions, and placeholders for %s", (language) => {
    const inputs = createInputs(language);
    const definitions = createPureLocalSettingDefinitions(inputs);

    expect(definitions.map((definition) => [definition.name, definition.desc])).toEqual([
      [inputs.strings.settingsDeviceName, undefined],
      [inputs.strings.settingsBaseUrl, inputs.strings.settingsBaseUrlAutoDesc],
      [inputs.strings.settingsBaseUrl, inputs.strings.settingsBaseUrlAutoDesc],
    ]);
    expect(definitions.map((definition) => definition.control.type === "text" ? definition.control.placeholder : undefined)).toEqual([
      inputs.strings.settingsDeviceNamePlaceholder,
      inputs.analysisBaseUrlPlaceholder,
      inputs.embeddingsBaseUrlPlaceholder,
    ]);
  });

  it("uses the existing Portuguese fallback", () => {
    expect(createPureLocalSettingDefinitions(createInputs(undefined))).toEqual(
      createPureLocalSettingDefinitions(createInputs("pt-PT"))
    );
  });

  it("does not define secrets, provider controls, models, runtime state, or binary actions", () => {
    const definitionKeys = createPureLocalSettingDefinitions(createInputs("pt-PT")).map((definition) => definition.control.key);

    expect(definitionKeys).not.toContain("analysisApiKey");
    expect(definitionKeys).not.toContain("embeddingsApiKey");
    expect(definitionKeys).not.toContain("analysisProvider");
    expect(definitionKeys).not.toContain("embeddingsProvider");
    expect(definitionKeys).not.toContain("analysisModel");
    expect(definitionKeys).not.toContain("embeddingsModel");
    expect(definitionKeys).not.toContain("embeddingStorageReadPreference");
  });

  it("returns independent plain structures on every call", () => {
    const first = createPureLocalSettingDefinitions(createInputs("en"));
    const second = createPureLocalSettingDefinitions(createInputs("en"));

    first[0].control.type === "text" && (first[0].control.placeholder = "changed");
    expect(second[0].control.type === "text" ? second[0].control.placeholder : undefined).toBe("PC Ryzen, old Surface, Phone...");
  });
});
