import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  createPureBinaryMaintenanceAdapter, createPureBinaryPreferenceAdapter, createPureCredentialAdapter,
  createPureModelAdapter, createPureNumericAdapter, createPureProviderAdapter, normalizePureLocalNumericValue,
} from "../../src/settings/pureLocalSettingAdapters";

const strings = getStrings("pt-PT");
const inputStrings = { provider: strings.settingsProvider, model: strings.settingsModel, manualModel: strings.settingsManualModel, manualModelDescription: strings.settingsManualModelDesc, timeout: strings.settingsTimeout, timeoutDescription: strings.settingsTimeoutDesc, batchSize: strings.settingsBatchSize, batchSizeDescription: strings.settingsBatchSizeDesc, storagePreference: strings.settingsBinaryPreference, storagePreferenceDescription: strings.settingsBinaryPreferenceDesc, preferBinary: strings.settingsBinaryPrefer, maintainBinaryCopy: strings.settingsBinaryMaintain, maintainBinaryCopyDescription: strings.settingsBinaryMaintainDesc, credential: strings.settingsApiKey, credentialDescription: strings.settingsApiKeyDescription, credentialPlaceholder: strings.settingsApiKeyPlaceholder, credentialSavedPlaceholder: strings.settingsApiKeyLocalSaved };

describe("pure local setting adapters", () => {
  it("describes provider options, defaults, visibility, and real effects", () => {
    const analysis = createPureProviderAdapter("analysis", { provider: "mistral", currentModel: "", currentBaseUrl: "", strings: inputStrings });
    const embedding = createPureProviderAdapter("embedding", { provider: "ollama", currentModel: "", currentBaseUrl: "", strings: inputStrings });
    expect(analysis.options.map((option) => option.value)).toEqual(["ollama", "mistral", "openrouter", "openai", "gemini", "anthropic", "custom"]);
    expect(analysis).toMatchObject({ isLocal: false, requiresCredential: true, showModelCatalog: true, allowManualModel: true, defaults: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" }, requiresFutureUpdate: true });
    expect(embedding.declaredEffects.map((effect) => effect.type)).toEqual(["mark-embeddings-dirty", "refresh-model-options", "rerender-settings"]);
  });

  it("preserves catalog and manual controls, including values outside the catalog", () => {
    const model = createPureModelAdapter("embedding", { provider: "mistral", currentModel: "custom-embedding", strings: inputStrings, placeholder: "nomic-embed-text-v2-moe" });
    expect(model.catalog).toEqual([{ value: "mistral-embed", label: "Mistral Embed (mistral-embed)" }]);
    expect(model).toMatchObject({ selectedCatalogValue: undefined, isManualValue: true, showCatalog: true, showManualControl: true, preservesTwoControls: true });
    expect(model.declaredEffects).toEqual([{ type: "mark-embeddings-dirty" }]);
  });

  it("models credentials without receiving or returning their values", () => {
    const credential = createPureCredentialAdapter("openai", inputStrings);
    expect(credential).toMatchObject({ isVisible: true, isRequired: true, isPassword: true, valueExposurePolicy: "do-not-expose", indexingPolicy: "do-not-index", saveStrategy: "device-local", acceptsCredentialValue: false });
    expect(Object.keys(credential)).not.toContain("value");
  });

  it("keeps numeric limits, fallbacks, and normalizers pure", () => {
    expect(createPureNumericAdapter("analysis-timeout", "9", inputStrings)).toMatchObject({ min: 10, max: 300, fallback: "60", saveStrategy: "device-local" });
    expect(createPureNumericAdapter("embedding-batch-size", "0", inputStrings)).toMatchObject({ min: 1, max: 50, fallback: "10" });
    expect(normalizePureLocalNumericValue("embeddings-timeout", "999")).toBe("300");
    expect(normalizePureLocalNumericValue("embedding-batch-size", "invalid")).toBe("10");
  });

  it("declares binary effects without resolving runtime state", () => {
    const preference = createPureBinaryPreferenceAdapter("prefer-binary", inputStrings);
    const maintenance = createPureBinaryMaintenanceAdapter(true, inputStrings);
    expect(preference.options).toEqual([{ value: "jsonl", label: "JSONL" }, { value: "prefer-binary", label: strings.settingsBinaryPrefer }]);
    expect(preference.declaredEffects.map((effect) => effect.type)).toEqual(["invalidate-runtime-embedding-index", "rerender-settings"]);
    expect(maintenance).toMatchObject({ controlType: "toggle", disabled: false, unresolvedRuntimeInputs: ["embedding-operation-state", "canonical-publication-state"] });
  });

  it("returns independent plain data and has no callbacks", () => {
    const first = createPureProviderAdapter("analysis", { provider: "ollama", currentModel: "", currentBaseUrl: "", strings: inputStrings });
    const second = createPureProviderAdapter("analysis", { provider: "ollama", currentModel: "", currentBaseUrl: "", strings: inputStrings });
    first.options[0].label = "changed";
    expect(second.options[0].label).toBe("Ollama");
    expect(Object.values(first).some((value) => typeof value === "function")).toBe(false);
  });
});
