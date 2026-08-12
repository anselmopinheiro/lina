import { describe, expect, it } from "vitest";
import {
  createSettingsRuntimeAdapters,
  type SettingsRuntimeEffect,
  type SettingsRuntimeHost,
  type SettingsRuntimeSnapshot,
} from "../../src/settings/settingsRuntimeAdapters";

function createSnapshot(overrides: Partial<SettingsRuntimeSnapshot> = {}): SettingsRuntimeSnapshot {
  return {
    settings: {
      embeddingsEnabled: false,
      maxSuggestedTags: 8,
      unknownGlobal: { preserved: true },
      deviceSettingsById: {
        current: {
          deviceName: "Current device",
          analysisProvider: "ollama",
          analysisModel: "gemma4:e2b",
          analysisTimeout: "60",
          embeddingsProvider: "ollama",
          embeddingsModel: "nomic-embed-text-v2-moe",
          embeddingsBatchSize: "10",
          embeddingsTimeout: "60",
          analysisApiKey: "analysis-secret",
          embeddingsApiKey: "embedding-secret",
          activeAiProfileId: "local-profile",
          aiProfileApiKeys: { "local-profile": "profile-secret" },
          unknownDevice: "preserve-current",
        },
        other: {
          deviceName: "Other device",
          analysisProvider: "mistral",
          analysisApiKey: "other-secret",
          unknownDevice: "preserve-other",
        },
      },
      localAnalysisProvider: "legacy-provider",
    },
    index: { version: 7, preserved: true },
    unknownEnvelope: { preserved: true },
    ...overrides,
  };
}

function createHost(initial = createSnapshot()) {
  let snapshot = initial;
  let deviceId = "current";
  let saveFailure = false;
  let effectFailure = false;
  const saves: SettingsRuntimeSnapshot[] = [];
  const replacements: SettingsRuntimeSnapshot[] = [];
  const effects: SettingsRuntimeEffect[] = [];
  const host: SettingsRuntimeHost = {
    getSnapshot: () => snapshot,
    replaceSnapshot(next) {
      snapshot = next;
      replacements.push(next);
    },
    async saveSnapshot() {
      saves.push(snapshot);
      if (saveFailure) {
        saveFailure = false;
        throw new Error("persistence failed");
      }
    },
    getCurrentDeviceId: () => deviceId,
    async runEffect(effect) {
      effects.push(effect);
      if (effectFailure) {
        effectFailure = false;
        throw new Error("effect failed");
      }
    },
  };

  return {
    host,
    saves,
    replacements,
    effects,
    snapshot: () => snapshot,
    setDeviceId(value: string) { deviceId = value; },
    failNextSave() { saveFailure = true; },
    failNextEffect() { effectFailure = true; },
  };
}

const defaults = {
  embeddingsEnabled: false,
  autoUpdateIndexOnFileChanges: true,
  maxSuggestedTags: 8,
  maxInboxNotesToAnalyze: 10,
  hybridSearchTextWeight: 0.7,
  hybridSearchSemanticWeight: 0.3,
  interfaceLanguage: "pt-PT" as const,
};

describe("settings runtime adapters", () => {
  it("reads injected defaults and persists all detached global settings without touching the index", async () => {
    const initial = createSnapshot();
    delete initial.settings.autoUpdateIndexOnFileChanges;
    delete initial.settings.maxSuggestedTags;
    const runtime = createHost(initial);
    const adapters = createSettingsRuntimeAdapters(runtime.host, { globalDefaults: defaults });

    expect(adapters.getGlobalValue("autoUpdateIndexOnFileChanges")).toBe(true);
    expect(adapters.getGlobalValue("maxSuggestedTags")).toBe(8);
    expect(await adapters.setGlobalValue("maxInboxNotesToAnalyze", 24)).toEqual({ ok: true });
    expect(await adapters.setGlobalValue("hybridSearchTextWeight", -1)).toEqual({ ok: true });
    expect(await adapters.setGlobalValue("inboxFolderPath", "  00_Inbox  ")).toEqual({ ok: true });
    expect(runtime.snapshot().settings.maxInboxNotesToAnalyze).toBe(20);
    expect(runtime.snapshot().settings.hybridSearchTextWeight).toBe(0);
    expect(runtime.snapshot().settings.inboxFolderPath).toBe("00_Inbox");
    expect(runtime.snapshot().index).toEqual({ version: 7, preserved: true });
    expect(runtime.snapshot().unknownEnvelope).toEqual({ preserved: true });
    expect(runtime.snapshot().settings.unknownGlobal).toEqual({ preserved: true });
    expect(runtime.saves).toHaveLength(3);
    expect(runtime.effects).toEqual([]);
  });

  it("normalizes max suggested tags and executes only its real automatic-index effect after saving", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host, { globalDefaults: defaults });

    expect(await adapters.setGlobalValue("maxSuggestedTags", 99)).toEqual({ ok: true });
    expect(await adapters.setGlobalValue("autoUpdateIndexOnFileChanges", false)).toEqual({ ok: true });
    expect(runtime.snapshot().settings.maxSuggestedTags).toBe(20);
    expect(runtime.saves).toHaveLength(2);
    expect(runtime.effects).toEqual([{ type: "update-vault-event-listeners" }]);
  });

  it("rejects invalid global inputs before replacing, saving, or executing effects", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host, { globalDefaults: defaults });
    const before = runtime.snapshot();

    expect(await adapters.setGlobalValue("embeddingsEnabled", "yes" as never)).toEqual({ ok: false, error: "invalid-value" });
    expect(runtime.snapshot()).toBe(before);
    expect(runtime.replacements).toEqual([]);
    expect(runtime.saves).toEqual([]);
    expect(runtime.effects).toEqual([]);
  });

  it("updates only the current device while retaining credentials, profiles, legacy aliases, and other devices", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host);

    expect(await adapters.setLocalValue("analysisProvider", " mistral ", [
      { type: "set-default-base-url", value: "https://api.mistral.ai/v1" },
      { type: "set-default-model", value: "mistral-small-latest" },
      { type: "refresh-model-options" },
    ])).toEqual({ ok: true });
    expect(await adapters.setLocalValue("analysisModel", "mistral-large-latest")).toEqual({ ok: true });
    expect(await adapters.setLocalValue("analysisTimeout", "9")).toEqual({ ok: true });
    expect(await adapters.setLocalValue("embeddingsBatchSize", "99")).toEqual({ ok: true });

    const current = runtime.snapshot().settings.deviceSettingsById?.current;
    expect(current).toMatchObject({
      analysisProvider: "mistral",
      analysisModel: "mistral-large-latest",
      analysisTimeout: "10",
      embeddingsBatchSize: "50",
      analysisApiKey: "analysis-secret",
      embeddingsApiKey: "embedding-secret",
      activeAiProfileId: "local-profile",
      aiProfileApiKeys: { "local-profile": "profile-secret" },
      unknownDevice: "preserve-current",
    });
    expect(runtime.snapshot().settings.deviceSettingsById?.other).toEqual({
      deviceName: "Other device",
      analysisProvider: "mistral",
      analysisApiKey: "other-secret",
      unknownDevice: "preserve-other",
    });
    expect(runtime.snapshot().settings.localAnalysisProvider).toBe("legacy-provider");
    expect(runtime.effects).toEqual([
      { type: "set-default-base-url", value: "https://api.mistral.ai/v1" },
      { type: "set-default-model", value: "mistral-small-latest" },
      { type: "refresh-model-options" },
    ]);
  });

  it("uses the injected typed effects once and rejects invalid local values without creating a device", async () => {
    const runtime = createHost(createSnapshot({ settings: { deviceSettingsById: {} } }));
    runtime.setDeviceId("new-device");
    const adapters = createSettingsRuntimeAdapters(runtime.host);

    expect(await adapters.setLocalValue("embeddingsProvider", "not-a-provider" as never, [
      { type: "mark-embeddings-dirty" },
    ])).toEqual({ ok: false, error: "invalid-value" });
    expect(runtime.snapshot().settings.deviceSettingsById).toEqual({});
    expect(runtime.saves).toEqual([]);
    expect(runtime.effects).toEqual([]);

    expect(await adapters.setLocalValue("embeddingStorageReadPreference", "prefer-binary", [
      { type: "invalidate-runtime-embedding-index" },
      { type: "rerender-settings" },
    ])).toEqual({ ok: true });
    expect(runtime.snapshot().settings.deviceSettingsById?.["new-device"]?.embeddingStorageReadPreference).toBe("prefer-binary");
    expect(runtime.effects).toEqual([
      { type: "invalidate-runtime-embedding-index" },
      { type: "rerender-settings" },
    ]);
  });

  it("covers every modeled local value category without reading or writing credentials", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host);

    await adapters.setLocalValue("deviceName", "  Desktop  ");
    await adapters.setLocalValue("analysisBaseUrl", " https://analysis.example.invalid ");
    await adapters.setLocalValue("embeddingsProvider", "mistral");
    await adapters.setLocalValue("embeddingsBaseUrl", " https://embeddings.example.invalid ");
    await adapters.setLocalValue("maintainBinaryEmbeddingCopy", true);

    const current = runtime.snapshot().settings.deviceSettingsById?.current;
    expect(current).toMatchObject({
      deviceName: "Desktop",
      analysisBaseUrl: "https://analysis.example.invalid",
      embeddingsProvider: "mistral",
      embeddingsBaseUrl: "https://embeddings.example.invalid",
      maintainBinaryEmbeddingCopy: true,
      analysisApiKey: "analysis-secret",
      embeddingsApiKey: "embedding-secret",
    });
    expect(runtime.effects).toEqual([]);
  });

  it.each(["openai", "gemini", "anthropic", "custom"] as const)("reads legacy %s provider settings through the safe Ollama fallback", (legacyProvider) => {
    const snapshot = createSnapshot();
    const current = snapshot.settings.deviceSettingsById?.current;
    if (!current) throw new Error("Expected current device settings.");
    current.analysisProvider = legacyProvider;
    current.analysisModel = "legacy-analysis-model";
    current.analysisBaseUrl = "https://legacy-analysis.example/v1";
    current.embeddingsProvider = legacyProvider;
    current.embeddingsModel = "legacy-embedding-model";
    current.embeddingsBaseUrl = "https://legacy-embedding.example/v1";
    const runtime = createHost(snapshot);
    const adapters = createSettingsRuntimeAdapters(runtime.host);

    expect(adapters.getLocalValue("analysisProvider")).toBe("ollama");
    expect(adapters.getLocalValue("analysisModel")).toBe("gemma4:e2b");
    expect(adapters.getLocalValue("analysisBaseUrl")).toBe("http://localhost:11434");
    expect(adapters.getLocalValue("embeddingsProvider")).toBe("ollama");
    expect(adapters.getLocalValue("embeddingsModel")).toBe("nomic-embed-text-v2-moe");
    expect(adapters.getLocalValue("embeddingsBaseUrl")).toBe("http://localhost:11434");
    expect(runtime.saves).toEqual([]);
  });

  it("serializes global and local writes against the newest snapshot, including different current devices", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host);

    const first = adapters.setGlobalValue("indexExcludedFolders", "private/");
    const second = adapters.setLocalValue("embeddingsTimeout", "90");
    runtime.setDeviceId("other");
    const third = adapters.setLocalValue("embeddingsModel", "mistral-embed");
    await Promise.all([first, second, third]);

    expect(runtime.snapshot().settings.indexExcludedFolders).toBe("private/");
    expect(runtime.snapshot().settings.deviceSettingsById?.current?.embeddingsTimeout).toBe("90");
    expect(runtime.snapshot().settings.deviceSettingsById?.other?.embeddingsModel).toBe("mistral-embed");
    expect(runtime.saves).toHaveLength(3);
  });

  it("restores the prior in-memory snapshot on save failure and liberates the queue", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host);
    const before = runtime.snapshot();
    runtime.failNextSave();

    expect(await adapters.setGlobalValue("yamlAllowedProperties", "tipo, estado")).toEqual({ ok: false, error: "save-failed" });
    expect(runtime.snapshot()).toBe(before);
    expect(await adapters.setGlobalValue("yamlAllowedProperties", "tipo, estado")).toEqual({ ok: true });
    expect(runtime.snapshot().settings.yamlAllowedProperties).toBe("tipo, estado");
    expect(runtime.saves).toHaveLength(2);
  });

  it("keeps a successful save when an effect fails, does not retry it, and liberates the queue", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host);
    runtime.failNextEffect();

    expect(await adapters.setLocalValue("embeddingsModel", "mistral-embed", [
      { type: "mark-embeddings-dirty" },
    ])).toEqual({ ok: false, error: "effect-failed" });
    expect(runtime.snapshot().settings.deviceSettingsById?.current?.embeddingsModel).toBe("mistral-embed");
    expect(runtime.saves).toHaveLength(1);
    expect(runtime.effects).toEqual([{ type: "mark-embeddings-dirty" }]);

    expect(await adapters.setLocalValue("embeddingsTimeout", "120")).toEqual({ ok: true });
    expect(runtime.snapshot().settings.deviceSettingsById?.current?.embeddingsTimeout).toBe("120");
    expect(runtime.saves).toHaveLength(2);
  });

  it("persists provider, model, and base URL as one rollback-safe local mutation", async () => {
    const runtime = createHost();
    const adapters = createSettingsRuntimeAdapters(runtime.host);
    const before = structuredClone(runtime.snapshot().settings.deviceSettingsById?.current);

    expect(await adapters.setLocalProviderValues(
      "analysis",
      "mistral",
      "mistral-small-latest",
      "https://api.mistral.ai/v1",
      [{ type: "refresh-model-options" }],
    )).toEqual({ ok: true });
    expect(runtime.snapshot().settings.deviceSettingsById?.current).toMatchObject({
      analysisProvider: "mistral",
      analysisModel: "mistral-small-latest",
      analysisBaseUrl: "https://api.mistral.ai/v1",
    });
    expect(runtime.saves).toHaveLength(1);
    expect(runtime.effects).toEqual([{ type: "refresh-model-options" }]);

    runtime.failNextSave();
    expect(await adapters.setLocalProviderValues(
      "analysis",
      "ollama",
      "gemma4:e2b",
      "http://localhost:11434",
      [{ type: "refresh-model-options" }],
    )).toEqual({ ok: false, error: "save-failed" });
    expect(runtime.snapshot().settings.deviceSettingsById?.current).toMatchObject({
      analysisProvider: "mistral",
      analysisModel: "mistral-small-latest",
      analysisBaseUrl: "https://api.mistral.ai/v1",
    });
    expect(runtime.effects).toEqual([{ type: "refresh-model-options" }]);

    runtime.failNextEffect();
    expect(await adapters.setLocalProviderValues(
      "embedding",
      "mistral",
      "mistral-embed",
      "https://api.mistral.ai/v1",
      [{ type: "mark-embeddings-dirty" }],
    )).toEqual({ ok: false, error: "effect-failed" });
    expect(runtime.snapshot().settings.deviceSettingsById?.current).toMatchObject({
      embeddingsProvider: "mistral",
      embeddingsModel: "mistral-embed",
      embeddingsBaseUrl: "https://api.mistral.ai/v1",
    });
    expect(runtime.saves).toHaveLength(3);
    expect(runtime.effects).toEqual([
      { type: "refresh-model-options" },
      { type: "mark-embeddings-dirty" },
    ]);
    expect(await adapters.setLocalValue("embeddingsTimeout", "120")).toEqual({ ok: true });
    expect(runtime.saves).toHaveLength(4);
    expect(before?.analysisApiKey).toBe("analysis-secret");
    expect(runtime.snapshot().settings.deviceSettingsById?.current?.analysisApiKey).toBe("analysis-secret");
  });
});
