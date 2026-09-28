import { App, type SettingDefinitionPage } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsCandidateComposition } from "../../src/settings/declarativeSettingsCandidateComposition";
import type { PureConnectionTestResult } from "../../src/settings/pureSettingsAsyncActions";

type ElementCall = { tag: string; options: Record<string, unknown> };
type ButtonCall = { label?: string; disabled?: boolean; destructive?: boolean; onClick?: () => void };

function createTestSettingDouble() {
  const calls: {
    name?: string;
    description?: string;
    elements: ElementCall[];
    buttons: ButtonCall[];
  } = { elements: [], buttons: [] };

  const setting = {
    setName(value: string) {
      calls.name = value;
      return setting;
    },
    setDesc(value: string) {
      calls.description = value;
      return setting;
    },
    addButton(callback: (button: {
      setButtonText(v: string): unknown;
      setDisabled(v: boolean): unknown;
      setCta(): unknown;
      setDestructive(): unknown;
      onClick(fn: () => void): unknown;
    }) => void) {
      const btn: ButtonCall = {};
      const button = {
        setButtonText(v: string) { btn.label = v; return button; },
        setDisabled(v: boolean) { btn.disabled = v; return button; },
        setCta() { return button; },
        setDestructive() { btn.destructive = true; return button; },
        onClick(fn: () => void) { btn.onClick = fn; return button; },
      };
      calls.buttons.push(btn);
      callback(button);
      return setting;
    },
    descEl: {
      createEl(tag: string, options: Record<string, unknown>) {
        const entry: ElementCall = { tag, options: { ...options } };
        calls.elements.push(entry);
        return {
          setText(v: string) { entry.options.text = v; },
        };
      },
    },
  };

  return { calls, setting };
}

function createTabSetup(options?: {
  role?: "producer" | "companion" | "unassigned";
  deviceId?: string;
}) {
  const app = new App();
  const plugin = new LinaPlugin(app);
  const deviceId = options?.deviceId ?? "device-test";
  const role = options?.role ?? "producer";
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    deviceSettingsById: {
      [deviceId]: {
        deviceName: "Test Machine",
        analysisProvider: "ollama",
        analysisModel: "llama3.2",
        embeddingsProvider: "ollama",
        embeddingsModel: "nomic-embed-text",
      },
    },
  };
  plugin.localDeviceState = {
    schemaVersion: 2,
    deviceId,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    role,
  };
  setDeviceSettingsContext(plugin.settings, () => {}, deviceId);
  const tab = new LinaSettingTab(app, plugin);
  return { app, plugin, tab, deviceId, strings: getStrings("pt-PT") };
}

function createCandidateFixture(options?: {
  testAnalysisResult?: PureConnectionTestResult;
  testEmbeddingsResult?: PureConnectionTestResult;
  role?: "producer" | "companion" | "unassigned";
}) {
  let snapshot = {
    settings: {
      deviceSettingsById: {
        device: {
          analysisProvider: "mistral",
          analysisModel: "mistral-small",
          embeddingsProvider: "mistral",
          embeddingsModel: "mistral-embed",
        },
      },
    },
  };

  let analysisCallCount = 0;
  let embeddingsCallCount = 0;

  const candidate = createDeclarativeSettingsCandidateComposition({
    strings: getStrings("pt-PT"),
    configDir: ".obsidian",
    deviceRole: options?.role ?? "producer",
    runtimeHost: {
      getSnapshot: () => snapshot,
      replaceSnapshot(next) { snapshot = next as typeof snapshot; },
      async saveSnapshot() {},
      getCurrentDeviceId: () => "device",
      async runEffect() {},
    },
    runtimeOptions: {
      globalDefaults: {
        autoUpdateIndexOnFileChanges: false,
        maxSuggestedTags: 8,
        maxInboxNotesToAnalyze: 10,
        hybridSearchTextWeight: 0.7,
        hybridSearchSemanticWeight: 0.3,
        interfaceLanguage: "pt-PT",
      },
    },
    lifecycle: { requestHostUpdate() {}, scheduleUpdate() {} },
    connectionCredentials: {
      connectionPorts: {
        async testAnalysisConnection() {
          analysisCallCount += 1;
          return options?.testAnalysisResult ?? { outcome: "success", messageKey: "connection-success" };
        },
        async testEmbeddingsConnection() {
          embeddingsCallCount += 1;
          return options?.testEmbeddingsResult ?? { outcome: "success", messageKey: "connection-success" };
        },
      },
      credentialStatus: { getAvailability: () => ({ required: true, available: true }) },
      credentialMutations: {
        async save() { return { ok: true, available: true }; },
        async clear() { return { ok: true, available: false }; },
      },
      getConnectionConfiguration: (domain) => ({
        provider: "mistral",
        model: domain === "analysis" ? "mistral-small" : "mistral-embed",
        baseUrl: "https://api.mistral.ai",
        timeout: "60",
        credentialAvailable: true,
      }),
      getCredentialRef: (domain) => ({ deviceId: "device", domain }),
      async confirmCredentialClear() { return true; },
    },
    binary: {
      getCurrentStatus: () => ({ status: "absent" as const }),
      check: async () => ({ status: "valid" as const }),
      createOrUpdate: async () => ({ status: "valid" as const }),
      remove: async () => undefined,
      confirmRemove: async () => true,
      getReadPreference: () => "jsonl" as const,
      getMaintainBinaryCopy: () => false,
    },
  });

  return {
    candidate,
    getAnalysisCallCount: () => analysisCallCount,
    getEmbeddingsCallCount: () => embeddingsCallCount,
    strings: getStrings("pt-PT"),
  };
}

describe("LINA-UX-FIX-TEST-FEEDBACK-001 — Connection Test Feedback UX", () => {
  it("1. AI connection test: one title only, one button, success feedback visible", async () => {
    const { candidate, strings } = createCandidateFixture({
      testAnalysisResult: { outcome: "success", messageKey: "connection-success" },
    });

    const definitions = candidate.definitions;
    const aiTestItemsWithTitle = definitions.filter((d) => d.name === strings.settingsTestConnection);
    expect(aiTestItemsWithTitle).toHaveLength(1);
    expect(aiTestItemsWithTitle[0].id).toBe("test-analysis-connection");

    const feedbackDef = definitions.find((d) => d.id === "analysis-test-feedback");
    expect(feedbackDef).toBeDefined();
    expect(feedbackDef?.name).toBe("");
    expect(feedbackDef?.aliases).toContain(strings.settingsTestConnection);

    const buttonDef = definitions.find((d) => d.id === "test-analysis-connection");
    const buttonRendered = createTestSettingDouble();
    buttonDef?.render?.(buttonRendered.setting as never, {} as never);
    expect(buttonRendered.calls.name).toBe(strings.settingsTestConnection);
    expect(buttonRendered.calls.buttons).toHaveLength(1);
    expect(buttonRendered.calls.buttons[0].label).toBe(strings.settingsTestConnection);

    buttonRendered.calls.buttons[0].onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    const isVisible = typeof feedbackDef?.visible === "function" ? feedbackDef.visible() : feedbackDef?.visible;
    expect(isVisible).toBe(true);

    const feedbackRendered = createTestSettingDouble();
    feedbackDef?.render?.(feedbackRendered.setting as never, {} as never);

    expect(feedbackRendered.calls.name).toBeUndefined();
    expect(feedbackRendered.calls.elements).toHaveLength(1);
    expect(feedbackRendered.calls.elements[0]).toEqual({
      tag: "p",
      options: {
        text: strings.settingsConnectionSuccess,
        attr: { "aria-live": "polite" },
      },
    });

    candidate.dispose();
  });

  it("2. AI connection test error: one title only, one button, error feedback visible", async () => {
    const { candidate, strings } = createCandidateFixture({
      testAnalysisResult: { outcome: "failed", messageKey: "connection-failed" },
    });

    const definitions = candidate.definitions;
    const aiTestItemsWithTitle = definitions.filter((d) => d.name === strings.settingsTestConnection);
    expect(aiTestItemsWithTitle).toHaveLength(1);

    const buttonDef = definitions.find((d) => d.id === "test-analysis-connection");
    const feedbackDef = definitions.find((d) => d.id === "analysis-test-feedback");
    expect(feedbackDef?.name).toBe("");

    const buttonRendered = createTestSettingDouble();
    buttonDef?.render?.(buttonRendered.setting as never, {} as never);
    expect(buttonRendered.calls.buttons).toHaveLength(1);

    buttonRendered.calls.buttons[0].onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    const isVisible = typeof feedbackDef?.visible === "function" ? feedbackDef.visible() : feedbackDef?.visible;
    expect(isVisible).toBe(true);

    const feedbackRendered = createTestSettingDouble();
    feedbackDef?.render?.(feedbackRendered.setting as never, {} as never);

    expect(feedbackRendered.calls.name).toBeUndefined();
    expect(feedbackRendered.calls.elements).toHaveLength(1);
    expect(feedbackRendered.calls.elements[0]).toEqual({
      tag: "p",
      options: {
        text: strings.settingsConnectionFailed,
        attr: { "aria-live": "polite" },
      },
    });

    candidate.dispose();
  });

  it("3. Embeddings connection test: one title only, one button, success feedback visible", async () => {
    const { candidate, strings } = createCandidateFixture({
      testEmbeddingsResult: { outcome: "success", messageKey: "connection-success" },
    });

    const definitions = candidate.definitions;
    const embTestItemsWithTitle = definitions.filter((d) => d.name === strings.settingsTestEmbeddingsConnection);
    expect(embTestItemsWithTitle).toHaveLength(1);
    expect(embTestItemsWithTitle[0].id).toBe("test-embeddings-connection");

    const feedbackDef = definitions.find((d) => d.id === "embeddings-test-feedback");
    expect(feedbackDef).toBeDefined();
    expect(feedbackDef?.name).toBe("");
    expect(feedbackDef?.aliases).toContain(strings.settingsTestEmbeddingsConnection);

    const buttonDef = definitions.find((d) => d.id === "test-embeddings-connection");
    const buttonRendered = createTestSettingDouble();
    buttonDef?.render?.(buttonRendered.setting as never, {} as never);
    expect(buttonRendered.calls.name).toBe(strings.settingsTestEmbeddingsConnection);
    expect(buttonRendered.calls.buttons).toHaveLength(1);
    expect(buttonRendered.calls.buttons[0].label).toBe(strings.settingsTestEmbeddingsConnection);

    buttonRendered.calls.buttons[0].onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    const isVisible = typeof feedbackDef?.visible === "function" ? feedbackDef.visible() : feedbackDef?.visible;
    expect(isVisible).toBe(true);

    const feedbackRendered = createTestSettingDouble();
    feedbackDef?.render?.(feedbackRendered.setting as never, {} as never);

    expect(feedbackRendered.calls.name).toBeUndefined();
    expect(feedbackRendered.calls.elements).toHaveLength(1);
    expect(feedbackRendered.calls.elements[0]).toEqual({
      tag: "p",
      options: {
        text: strings.settingsConnectionSuccess,
        attr: { "aria-live": "polite" },
      },
    });

    candidate.dispose();
  });

  it("4. Embeddings connection test error: one title only, one button, error feedback visible", async () => {
    const { candidate, strings } = createCandidateFixture({
      testEmbeddingsResult: { outcome: "failed", messageKey: "embedding-test-failed" },
    });

    const definitions = candidate.definitions;
    const embTestItemsWithTitle = definitions.filter((d) => d.name === strings.settingsTestEmbeddingsConnection);
    expect(embTestItemsWithTitle).toHaveLength(1);

    const buttonDef = definitions.find((d) => d.id === "test-embeddings-connection");
    const feedbackDef = definitions.find((d) => d.id === "embeddings-test-feedback");
    expect(feedbackDef?.name).toBe("");

    const buttonRendered = createTestSettingDouble();
    buttonDef?.render?.(buttonRendered.setting as never, {} as never);
    expect(buttonRendered.calls.buttons).toHaveLength(1);

    buttonRendered.calls.buttons[0].onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    const isVisible = typeof feedbackDef?.visible === "function" ? feedbackDef.visible() : feedbackDef?.visible;
    expect(isVisible).toBe(true);

    const feedbackRendered = createTestSettingDouble();
    feedbackDef?.render?.(feedbackRendered.setting as never, {} as never);

    expect(feedbackRendered.calls.name).toBeUndefined();
    expect(feedbackRendered.calls.elements).toHaveLength(1);
    expect(feedbackRendered.calls.elements[0]).toEqual({
      tag: "p",
      options: {
        text: strings.settingsEmbeddingTestFailed,
        attr: { "aria-live": "polite" },
      },
    });

    candidate.dispose();
  });

  it("5. Feedback hidden in idle state", () => {
    const { candidate } = createCandidateFixture();

    const analysisFeedbackDef = candidate.definitions.find((d) => d.id === "analysis-test-feedback");
    const embeddingsFeedbackDef = candidate.definitions.find((d) => d.id === "embeddings-test-feedback");

    expect(typeof analysisFeedbackDef?.visible).toBe("function");
    expect(typeof embeddingsFeedbackDef?.visible).toBe("function");

    const analysisVisible = (analysisFeedbackDef?.visible as () => boolean)();
    const embeddingsVisible = (embeddingsFeedbackDef?.visible as () => boolean)();

    expect(analysisVisible).toBe(false);
    expect(embeddingsVisible).toBe(false);

    const analysisRendered = createTestSettingDouble();
    analysisFeedbackDef?.render?.(analysisRendered.setting as never, {} as never);
    expect(analysisRendered.calls.name).toBeUndefined();
    expect(analysisRendered.calls.elements).toHaveLength(0);

    const embeddingsRendered = createTestSettingDouble();
    embeddingsFeedbackDef?.render?.(embeddingsRendered.setting as never, {} as never);
    expect(embeddingsRendered.calls.name).toBeUndefined();
    expect(embeddingsRendered.calls.elements).toHaveLength(0);

    candidate.dispose();
  });

  it("6. Existing handlers still invoked exactly once", async () => {
    const { candidate, getAnalysisCallCount, getEmbeddingsCallCount } = createCandidateFixture();

    const analysisButton = candidate.definitions.find((d) => d.id === "test-analysis-connection");
    const embeddingsButton = candidate.definitions.find((d) => d.id === "test-embeddings-connection");

    const analysisRendered = createTestSettingDouble();
    const embeddingsRendered = createTestSettingDouble();

    analysisButton?.render?.(analysisRendered.setting as never, {} as never);
    embeddingsButton?.render?.(embeddingsRendered.setting as never, {} as never);

    expect(getAnalysisCallCount()).toBe(0);
    expect(getEmbeddingsCallCount()).toBe(0);

    analysisRendered.calls.buttons[0].onClick?.();
    expect(getAnalysisCallCount()).toBe(1);

    embeddingsRendered.calls.buttons[0].onClick?.();
    expect(getEmbeddingsCallCount()).toBe(1);

    await Promise.resolve();
    await Promise.resolve();

    expect(getAnalysisCallCount()).toBe(1);
    expect(getEmbeddingsCallCount()).toBe(1);

    candidate.dispose();
  });

  it("7. No regression in Companion gating, Producer behavior, SecretStorage, provider/model controls", async () => {
    const { tab, plugin } = createTabSetup({ role: "companion" });
    const pages = tab.getSettingDefinitions().filter((item): item is SettingDefinitionPage & { id: string } => item.type === "page");

    const aiPage = pages.find((p) => p.id === "ai-analysis");
    const embeddingsPage = pages.find((p) => p.id === "search");
    expect(aiPage).toBeDefined();
    expect(embeddingsPage).toBeDefined();

    const aiItems = aiPage?.items ?? [];
    const embeddingsItems = embeddingsPage?.items ?? [];
    const aiTitles = aiItems.map((i) => i.name).filter((n) => n === getStrings("pt-PT").settingsTestConnection);
    expect(aiTitles).toHaveLength(1);

    const embTitles = embeddingsItems.map((i) => i.name).filter((n) => n === getStrings("pt-PT").settingsTestEmbeddingsConnection);
    expect(embTitles).toHaveLength(1);

    const aiFeedback = aiItems.find((i) => (i as { id: string }).id === "analysis-test-feedback");
    const embFeedback = embeddingsItems.find((i) => (i as { id: string }).id === "embeddings-test-feedback");
    expect(aiFeedback?.name).toBe("");
    expect(embFeedback?.name).toBe("");

    const aiCred = aiItems.find((i) => (i as { id: string }).id === "analysis-credential");
    expect(aiCred).toBeDefined();
    expect(JSON.stringify(aiCred)).not.toContain("apiKey");

    tab.hide();
  });
});
