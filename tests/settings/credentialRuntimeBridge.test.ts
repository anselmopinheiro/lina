import { describe, expect, it } from "vitest";
import {
  createCredentialRuntimeBridge,
  type CredentialRuntimeConnectionExecutors,
  type CredentialRuntimeSettingsSnapshot,
  type CredentialRuntimeStorageBoundary,
} from "../../src/settings/credentialRuntimeBridge";
import type { CredentialDomain } from "../../src/settings/pureCredentialModel";
import type { PureConnectionTestInput, PureConnectionTestResult } from "../../src/settings/pureSettingsAsyncActions";

const sentinel = "SUPER_SECRET_SENTINEL";

function createSettings(overrides: Partial<CredentialRuntimeSettingsSnapshot> = {}): CredentialRuntimeSettingsSnapshot {
  return {
    preservedSetting: { untouched: true },
    aiApiKey: "legacy-ai",
    embeddingApiKey: "legacy-embedding",
    deviceSettingsById: {
      "device-current": {
        deviceName: "Current",
        analysisApiKey: "analysis-primary",
        embeddingsApiKey: "embeddings-primary",
      },
      "device-other": {
        analysisApiKey: "other-analysis",
        embeddingsApiKey: "other-embeddings",
      },
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createStorage(initial: CredentialRuntimeSettingsSnapshot) {
  let settings = initial;
  const saves: CredentialRuntimeSettingsSnapshot[] = [];
  let failure: Error | undefined;
  const boundary: CredentialRuntimeStorageBoundary = {
    getDeviceId: () => "device-current",
    readSettings: () => settings,
    async saveSettings(next) {
      saves.push(next);
      if (failure) {
        const nextFailure = failure;
        failure = undefined;
        throw nextFailure;
      }
      settings = next;
    },
  };
  return { boundary, saves, getSettings: () => settings, failNext(error: Error) { failure = error; } };
}

function createExecutors() {
  const analysisInputs: Array<Record<string, unknown>> = [];
  const embeddingInputs: Array<Record<string, unknown>> = [];
  let analysisFailure: Error | undefined;
  const executors: CredentialRuntimeConnectionExecutors = {
    async testAnalysis(input) {
      analysisInputs.push({ ...input });
      if (analysisFailure) throw analysisFailure;
      return { outcome: "success", messageKey: "connection-success" };
    },
    async testEmbeddings(input) {
      embeddingInputs.push({ ...input });
      return { outcome: "success", messageKey: "connection-success" };
    },
  };
  return { executors, analysisInputs, embeddingInputs, failAnalysis(error: Error) { analysisFailure = error; } };
}

function ref(domain: CredentialDomain) {
  return { deviceId: "device-current", domain };
}

const analysisInput: PureConnectionTestInput = {
  provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-small-latest", credentialAvailable: true, timeout: "60",
};
const embeddingsInput: PureConnectionTestInput = {
  provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-embed", credentialAvailable: true, timeout: "60",
};

describe("credential runtime bridge", () => {
  it("derives safe availability from current settings and the shared provider policy", () => {
    const storage = createStorage(createSettings());
    const bridge = createCredentialRuntimeBridge(storage.boundary, createExecutors().executors);
    expect(bridge.getAvailability(ref("analysis"), "ollama")).toEqual({ required: false, available: false });
    expect(bridge.getAvailability(ref("analysis"), "mistral")).toEqual({ required: true, available: true });
    expect(bridge.getAvailability(ref("embeddings"), "openrouter")).toEqual({ required: true, available: true });
    expect(Object.keys(bridge.getAvailability(ref("embeddings"), "mistral"))).toEqual(["required", "available"]);
  });

  it("saves only the requested current-device primary key and preserves all other settings", async () => {
    const storage = createStorage(createSettings());
    const bridge = createCredentialRuntimeBridge(storage.boundary, createExecutors().executors);
    const result = await bridge.save(ref("analysis"), `  ${sentinel}  `, "mistral");
    const saved = storage.getSettings();

    expect(result).toEqual({ ok: true, available: true });
    expect(storage.saves).toHaveLength(1);
    expect(saved.deviceSettingsById?.["device-current"]?.analysisApiKey).toBe(sentinel);
    expect(saved.deviceSettingsById?.["device-current"]?.embeddingsApiKey).toBe("embeddings-primary");
    expect(saved.deviceSettingsById?.["device-other"]).toEqual({ analysisApiKey: "other-analysis", embeddingsApiKey: "other-embeddings" });
    expect(saved.aiApiKey).toBe("legacy-ai");
    expect(saved.embeddingApiKey).toBe("legacy-embedding");
    expect(saved.preservedSetting).toEqual({ untouched: true });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("rejects blank input without persisting and normalizes persistence failures", async () => {
    const storage = createStorage(createSettings());
    const bridge = createCredentialRuntimeBridge(storage.boundary, createExecutors().executors);
    expect(await bridge.save(ref("embeddings"), "   ", "mistral")).toEqual({ ok: false, error: "save-failed" });
    expect(storage.saves).toEqual([]);

    storage.failNext(new Error(sentinel));
    const failed = await bridge.save(ref("embeddings"), sentinel, "mistral");
    expect(failed).toEqual({ ok: false, error: "save-failed" });
    expect(JSON.stringify(failed)).not.toContain(sentinel);
    expect(await bridge.save(ref("embeddings"), "retry", "mistral")).toEqual({ ok: true, available: true });
  });

  it("clears only the primary key and reports effective legacy fallback availability", async () => {
    const storage = createStorage(createSettings());
    const bridge = createCredentialRuntimeBridge(storage.boundary, createExecutors().executors);
    const result = await bridge.clear(ref("embeddings"), "mistral");
    const saved = storage.getSettings();

    expect(result).toEqual({ ok: true, available: true });
    expect(storage.saves).toHaveLength(1);
    expect(saved.deviceSettingsById?.["device-current"]?.embeddingsApiKey).toBeUndefined();
    expect(saved.deviceSettingsById?.["device-current"]?.analysisApiKey).toBe("analysis-primary");
    expect(saved.deviceSettingsById?.["device-other"]?.embeddingsApiKey).toBe("other-embeddings");
    expect(saved.embeddingApiKey).toBe("legacy-embedding");
  });

  it("normalizes clear persistence failures without leaving the reference locked", async () => {
    const storage = createStorage(createSettings());
    const bridge = createCredentialRuntimeBridge(storage.boundary, createExecutors().executors);
    storage.failNext(new Error(sentinel));
    const failed = await bridge.clear(ref("analysis"), "mistral");
    expect(failed).toEqual({ ok: false, error: "clear-failed" });
    expect(JSON.stringify(failed)).not.toContain(sentinel);
    expect(await bridge.clear(ref("analysis"), "mistral")).toEqual({ ok: true, available: false });
  });

  it("keeps Mistral-only analysis fallback out of other embedding providers", async () => {
    const settings = createSettings({
      aiApiKey: "legacy-ai",
      embeddingApiKey: "",
      deviceSettingsById: {
        "device-current": { analysisApiKey: "analysis-primary", embeddingsApiKey: "embeddings-primary" },
        "device-other": { embeddingsApiKey: "other-embeddings" },
      },
    });
    const storage = createStorage(settings);
    const bridge = createCredentialRuntimeBridge(storage.boundary, createExecutors().executors);
    expect(await bridge.clear(ref("embeddings"), "mistral")).toEqual({ ok: true, available: true });

    const otherStorage = createStorage(settings);
    const otherBridge = createCredentialRuntimeBridge(otherStorage.boundary, createExecutors().executors);
    expect(await otherBridge.clear(ref("embeddings"), "openrouter")).toEqual({ ok: true, available: false });
  });

  it("runs injected connection executors with the secret only at the runtime boundary", async () => {
    const storage = createStorage(createSettings({
      deviceSettingsById: { "device-current": { analysisApiKey: sentinel, embeddingsApiKey: sentinel } },
      aiApiKey: "",
      embeddingApiKey: "",
    }));
    const executorState = createExecutors();
    const bridge = createCredentialRuntimeBridge(storage.boundary, executorState.executors);
    const analysis = await bridge.testAnalysisConnection(analysisInput);
    const embeddings = await bridge.testEmbeddingsConnection(embeddingsInput);

    expect(analysis).toEqual({ outcome: "success", messageKey: "connection-success" });
    expect(embeddings).toEqual({ outcome: "success", messageKey: "connection-success" });
    expect(executorState.analysisInputs[0].credential).toBe(sentinel);
    expect(executorState.embeddingInputs[0].credential).toBe(sentinel);
    expect(JSON.stringify({ analysis, embeddings, input: analysisInput })).not.toContain(sentinel);
    expect(Object.keys(analysisInput)).toEqual(["provider", "baseUrl", "model", "credentialAvailable", "timeout"]);
  });

  it("uses the documented embedding precedence and omits credentials for Ollama", async () => {
    const storage = createStorage(createSettings({
      aiApiKey: "legacy-ai",
      embeddingApiKey: "legacy-embedding",
      deviceSettingsById: { "device-current": { analysisApiKey: "analysis-primary", embeddingsApiKey: "embeddings-primary" } },
    }));
    const executorState = createExecutors();
    const bridge = createCredentialRuntimeBridge(storage.boundary, executorState.executors);
    await bridge.testEmbeddingsConnection(embeddingsInput);
    expect(executorState.embeddingInputs[0].credential).toBe("embeddings-primary");

    const ollama: PureConnectionTestInput = { ...embeddingsInput, provider: "ollama" };
    await bridge.testEmbeddingsConnection(ollama);
    expect(executorState.embeddingInputs[1].credential).toBeUndefined();
  });

  it("resolves every Mistral embedding fallback in its documented order", async () => {
    const scenarios: Array<{ settings: CredentialRuntimeSettingsSnapshot; expected: string }> = [
      { settings: createSettings({ deviceSettingsById: { "device-current": { embeddingsApiKey: "embeddings-primary", analysisApiKey: "analysis-primary" } } }), expected: "embeddings-primary" },
      { settings: createSettings({ deviceSettingsById: { "device-current": { analysisApiKey: "analysis-primary" } } }), expected: "analysis-primary" },
      { settings: createSettings({ aiApiKey: "legacy-ai", embeddingApiKey: "legacy-embedding", deviceSettingsById: { "device-current": {} } }), expected: "legacy-embedding" },
      { settings: createSettings({ aiApiKey: "legacy-ai", embeddingApiKey: "", deviceSettingsById: { "device-current": {} } }), expected: "legacy-ai" },
    ];

    for (const scenario of scenarios) {
      const executorState = createExecutors();
      const bridge = createCredentialRuntimeBridge(createStorage(scenario.settings).boundary, executorState.executors);
      await bridge.testEmbeddingsConnection(embeddingsInput);
      expect(executorState.embeddingInputs[0].credential).toBe(scenario.expected);
    }
  });

  it("blocks remote calls without an effective credential and normalizes executor errors", async () => {
    const empty = createStorage(createSettings({
      aiApiKey: "", embeddingApiKey: "", deviceSettingsById: { "device-current": {} },
    }));
    const emptyExecutors = createExecutors();
    const bridge = createCredentialRuntimeBridge(empty.boundary, emptyExecutors.executors);
    expect(await bridge.testAnalysisConnection(analysisInput)).toEqual({ outcome: "failed", messageKey: "analysis-api-key-missing" });
    expect(emptyExecutors.analysisInputs).toEqual([]);

    const storage = createStorage(createSettings({ deviceSettingsById: { "device-current": { analysisApiKey: sentinel } } }));
    const executorState = createExecutors();
    executorState.failAnalysis(new Error(sentinel));
    const failingBridge = createCredentialRuntimeBridge(storage.boundary, executorState.executors);
    const failed = await failingBridge.testAnalysisConnection(analysisInput);
    expect(failed).toEqual({ outcome: "failed", messageKey: "connection-failed" });
    expect(JSON.stringify(failed)).not.toContain(sentinel);
  });

  it("blocks same-reference mutations while allowing different domains to queue safely", async () => {
    const settings = createSettings();
    let current = settings;
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const pending: Array<ReturnType<typeof deferred<void>>> = [firstSave, secondSave];
    const saves: CredentialRuntimeSettingsSnapshot[] = [];
    const storage: CredentialRuntimeStorageBoundary = {
      getDeviceId: () => "device-current",
      readSettings: () => current,
      saveSettings(next) {
        saves.push(next);
        current = next;
        const nextSave = pending.shift();
        return nextSave?.promise ?? Promise.resolve();
      },
    };
    const bridge = createCredentialRuntimeBridge(storage, createExecutors().executors);
    const first = bridge.save(ref("analysis"), "new-analysis", "mistral");
    const duplicate = await bridge.save(ref("analysis"), "ignored", "mistral");
    const embedding = bridge.save(ref("embeddings"), "new-embeddings", "mistral");
    expect(duplicate).toEqual({ ok: false, error: "save-failed" });
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    firstSave.resolve();
    await first;
    await Promise.resolve();
    expect(saves).toHaveLength(2);
    secondSave.resolve();
    await embedding;
    expect(current.deviceSettingsById?.["device-current"]?.analysisApiKey).toBe("new-analysis");
    expect(current.deviceSettingsById?.["device-current"]?.embeddingsApiKey).toBe("new-embeddings");
  });
});
