import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsCandidateComposition } from "../../src/settings/declarativeSettingsCandidateComposition";

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

function createCandidateRemoveRendererDouble() {
  type ButtonDouble = {
    setButtonText(value: string): ButtonDouble;
    setDestructive(): ButtonDouble;
    setDisabled(value: boolean): ButtonDouble;
    onClick(callback: () => void): ButtonDouble;
  };
  const calls: {
    name?: string;
    buttons: Array<{ label?: string; destructive?: boolean; disabled?: boolean; onClick?: () => void }>;
  } = { buttons: [] };
  const setting = {
    setName(value: string) { calls.name = value; return setting; },
    addButton(callback: (button: ButtonDouble) => void) {
      const call: { label?: string; destructive?: boolean; disabled?: boolean; onClick?: () => void } = {};
      const button: ButtonDouble = {
        setButtonText(value) { call.label = value; return button; },
        setDestructive() { call.destructive = true; return button; },
        setDisabled(value) { call.disabled = value; return button; },
        onClick(value) { call.onClick = value; return button; },
      };
      callback(button);
      calls.buttons.push(call);
      return setting;
    },
  };
  return { calls, setting };
}

describe("settings DOM and visual parity", () => {
  it("renders every executable active action as one native button", () => {
    const candidate = createCandidateFixture();
    const actions = [
      ["test-analysis-connection", getStrings("pt-PT").settingsTestConnection, false],
      ["test-embeddings-connection", getStrings("pt-PT").settingsTestEmbeddingsConnection, false],
      ["check-binary-copy", getStrings("pt-PT").settingsBinaryCheck, false],
      ["create-or-update-binary-copy", getStrings("pt-PT").settingsBinaryCreate, false],
      ["remove-binary-copy", getStrings("pt-PT").settingsBinaryRemove, true],
    ] as const;

    try {
      for (const [id, label, destructive] of actions) {
        const definition = candidate.definitions.find((entry) => entry.id === id);
        const rendered = createCandidateRemoveRendererDouble();

        definition?.render?.(rendered.setting as never, {} as never);

        expect(rendered.calls).toEqual({
          name: label,
          buttons: [{
            label,
            destructive: destructive || undefined,
            disabled: false,
            onClick: expect.any(Function),
          }],
        });
        expect(definition?.action).toBeUndefined();
      }
    } finally {
      candidate.dispose();
    }
  });

  it("renders the active binary remove button with a destructive affordance", () => {
    const candidate = createCandidateFixture();
    try {
      const diagnostic = candidate.getDiagnosticSnapshot();
      expect(diagnostic).toMatchObject({
        groupCount: 17,
        itemCount: 48,
        boundDefinitionCount: 48,
        incompleteIds: [],
      });
      const remove = candidate.definitions.find((definition) => definition.id === "remove-binary-copy");
      expect(remove?.render).toEqual(expect.any(Function));
      const rendered = createCandidateRemoveRendererDouble();
      remove?.render?.(rendered.setting as never, {} as never);
      expect(rendered.calls).toEqual({
        name: getStrings("pt-PT").settingsBinaryRemove,
        buttons: [{
          label: getStrings("pt-PT").settingsBinaryRemove,
          destructive: true,
          disabled: false,
          onClick: expect.any(Function),
        }],
      });
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
