import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsCandidateComposition } from "../../src/settings/declarativeSettingsCandidateComposition";
import {
  captureImperativeSettings,
  installImperativeSettingsInstrumentation,
  restoreImperativeSettingsInstrumentation,
} from "./imperativeSettingsParityCapture";

function createCandidateFixture() {
  let snapshot = {
    settings: {
      deviceSettingsById: {
        device: {
          analysisProvider: "mistral",
          embeddingsProvider: "mistral",
        },
      },
    },
  };

  return createDeclarativeSettingsCandidateComposition({
    strings: getStrings("pt-PT"),
    configDir: ".obsidian",
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
        async testAnalysisConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; },
        async testEmbeddingsConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; },
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
}

beforeEach(() => installImperativeSettingsInstrumentation());
afterEach(() => restoreImperativeSettingsInstrumentation());

describe("settings DOM and visual parity", () => {
  it("observes the real imperative remove button as destructive", () => {
    const strings = getStrings("pt-PT");
    const imperative = captureImperativeSettings().manifest;
    const binaryRemove = imperative.items.find((item) => item.controls.some(
      (control) => control.kind === "button" && control.label === strings.settingsBinaryRemove,
    ));

    expect(binaryRemove?.controls).toContainEqual({
      kind: "button",
      label: strings.settingsBinaryRemove,
      disabled: false,
      destructive: true,
      hasOnClick: true,
    });
  });

  it("records the candidate binary remove action without a destructive DOM affordance", () => {
    const candidate = createCandidateFixture();
    try {
      const diagnostic = candidate.getDiagnosticSnapshot();
      expect(diagnostic).toMatchObject({
        groupCount: 12,
        itemCount: 47,
        boundDefinitionCount: 47,
        incompleteIds: [],
      });
      const remove = candidate.definitions.find((definition) => definition.id === "remove-binary-copy");
      expect(remove).toMatchObject({ action: expect.any(Function) });
      expect("render" in (remove ?? {})).toBe(false);
      expect(Reflect.has(remove ?? {}, "destructive")).toBe(false);
    } finally {
      candidate.dispose();
    }
  });

  it("executes the candidate binary status renderer with its live-region contract", () => {
    const candidate = createCandidateFixture();
    const createdElements: Array<{ tag: string; options: unknown }> = [];
    const setting = {
      setName() {
        return setting;
      },
      descEl: {
        createEl(tag: string, options: unknown) {
          createdElements.push({ tag, options });
          return {};
        },
      },
    };

    try {
      const status = candidate.definitions.find((definition) => definition.id === "binary-status");
      expect(status?.render).toEqual(expect.any(Function));

      status?.render?.(setting as never, {} as never);

      expect(createdElements).toContainEqual({
        tag: "p",
        options: expect.objectContaining({ attr: { "aria-live": "polite" } }),
      });
    } finally {
      candidate.dispose();
    }
  });
});
