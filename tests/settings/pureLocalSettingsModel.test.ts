import { describe, expect, it } from "vitest";
import {
  PURE_LOCAL_EMBEDDING_STORAGE_PREFERENCES,
  PURE_LOCAL_SETTING_KEYS,
  PURE_LOCAL_SETTING_METADATA,
  getPureLocalModelOptions,
  getPureLocalProviderMetadata,
  getPureLocalProviderOptions,
  isLegacyPureLocalProviderId,
  isPureLocalEmbeddingStoragePreference,
  isPureLocalModelManual,
  isPureLocalSettingKey,
  normalizePureLocalEmbeddingBatchSize,
  normalizePureLocalTimeout,
  resolvePureLocalProviderDefaults,
  resolvePureLocalProviderId,
  shouldShowPureLocalApiKey,
  shouldShowPureLocalBaseUrl,
  shouldShowPureLocalManualModel,
  shouldShowPureLocalModelCatalog,
} from "../../src/settings/pureLocalSettingsModel";

describe("pure local settings model", () => {
  it("keeps an explicit non-secret whitelist", () => {
    expect(PURE_LOCAL_SETTING_KEYS).toEqual([
      "deviceName", "analysisProvider", "analysisModel", "analysisBaseUrl", "analysisTimeout",
      "embeddingsProvider", "embeddingsModel", "embeddingsBaseUrl", "embeddingsBatchSize", "embeddingsTimeout",
      "embeddingStorageReadPreference", "maintainBinaryEmbeddingCopy",
    ]);
    expect(PURE_LOCAL_SETTING_METADATA.map((metadata) => metadata.key)).toEqual(PURE_LOCAL_SETTING_KEYS);
    expect(isPureLocalSettingKey("analysisApiKey")).toBe(false);
    expect(isPureLocalSettingKey("embeddingsApiKey")).toBe(false);
    expect(isPureLocalSettingKey("deviceSettingsById")).toBe(false);
    expect(isPureLocalSettingKey("embeddingsEnabled")).toBe(false);
  });

  it("mirrors the provider order and pure metadata used by local settings", () => {
    expect(getPureLocalProviderOptions()).toEqual([
      { value: "ollama", label: "Ollama" }, { value: "mistral", label: "Mistral" },
      { value: "openrouter", label: "OpenRouter" },
    ]);
    expect(getPureLocalProviderMetadata("ollama")).toMatchObject({ isLocal: true, requiresApiKey: false, hasModelCatalog: true });
    expect(getPureLocalProviderMetadata("mistral")).toMatchObject({ isLocal: false, requiresApiKey: true, hasModelCatalog: true });
    expect(getPureLocalProviderMetadata("openrouter")).toMatchObject({ isLocal: false, requiresApiKey: true, hasModelCatalog: false });
    expect(getPureLocalProviderMetadata("unknown")).toBeUndefined();
  });

  it("reuses static catalogs and preserves manual-model handling", () => {
    expect(getPureLocalModelOptions("ollama", "analysis")).toEqual([{ value: "gemma4:e2b", label: "Gemma 4 e2b (gemma4:e2b)" }]);
    expect(getPureLocalModelOptions("mistral", "embedding")).toEqual([{ value: "mistral-embed", label: "Mistral Embed (mistral-embed)" }]);
    expect(getPureLocalModelOptions("openrouter", "analysis")).toEqual([]);
    expect(isPureLocalModelManual("ollama", "embedding", "nomic-embed-text")).toBe(false);
    expect(isPureLocalModelManual("ollama", "embedding", "manual-model")).toBe(true);
  });

  it("reuses provider defaults without applying them", () => {
    expect(resolvePureLocalProviderDefaults("ollama", "analysis")).toEqual({ baseUrl: "http://localhost:11434", model: "gemma4:e2b" });
    expect(resolvePureLocalProviderDefaults("mistral", "embedding")).toEqual({ baseUrl: "https://api.mistral.ai/v1", model: "mistral-embed" });
    expect(resolvePureLocalProviderDefaults("unknown", "analysis")).toEqual({ baseUrl: "", model: "" });
  });

  it("keeps visibility conditions pure and provider-only", () => {
    expect(shouldShowPureLocalBaseUrl("ollama")).toBe(true);
    expect(shouldShowPureLocalApiKey("ollama")).toBe(false);
    expect(shouldShowPureLocalApiKey("mistral")).toBe(true);
    expect(shouldShowPureLocalModelCatalog("mistral")).toBe(true);
    expect(shouldShowPureLocalModelCatalog("openrouter")).toBe(false);
    expect(shouldShowPureLocalManualModel("openrouter")).toBe(true);
    expect(shouldShowPureLocalBaseUrl("unknown")).toBe(false);
  });

  it("preserves current timeout and batch-size normalization limits", () => {
    expect(normalizePureLocalTimeout("9")).toBe("10");
    expect(normalizePureLocalTimeout("60")).toBe("60");
    expect(normalizePureLocalTimeout("999")).toBe("300");
    expect(normalizePureLocalTimeout("invalid")).toBe("60");
    expect(normalizePureLocalTimeout("")).toBe("60");
    expect(normalizePureLocalEmbeddingBatchSize("0")).toBe("1");
    expect(normalizePureLocalEmbeddingBatchSize("10")).toBe("10");
    expect(normalizePureLocalEmbeddingBatchSize("99")).toBe("50");
    expect(normalizePureLocalEmbeddingBatchSize("invalid")).toBe("10");
    expect(normalizePureLocalEmbeddingBatchSize("")).toBe("10");
  });

  it("returns independent data and validates binary preferences", () => {
    const first = getPureLocalProviderOptions();
    const second = getPureLocalProviderOptions();
    first[0].label = "changed";

    expect(second[0].label).toBe("Ollama");
    expect(PURE_LOCAL_EMBEDDING_STORAGE_PREFERENCES).toEqual(["jsonl", "prefer-binary"]);
    expect(isPureLocalEmbeddingStoragePreference("prefer-binary")).toBe(true);
    expect(isPureLocalEmbeddingStoragePreference("binary")).toBe(false);
  });

  it.each(["openai", "gemini", "anthropic", "custom"] as const)("maps legacy %s to the canonical safe provider", (provider) => {
    expect(isLegacyPureLocalProviderId(provider)).toBe(true);
    expect(resolvePureLocalProviderId(provider)).toBe("ollama");
    expect(getPureLocalProviderMetadata(provider)).toBeUndefined();
  });
});
