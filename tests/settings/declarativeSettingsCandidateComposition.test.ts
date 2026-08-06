import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsCandidateComposition } from "../../src/settings/declarativeSettingsCandidateComposition";

function createCandidate(provider = "ollama") {
  let snapshot = {
    settings: {
      deviceSettingsById: {
        device: {
          analysisApiKey: "SUPER_SECRET_SENTINEL",
          embeddingsApiKey: "SUPER_SECRET_SENTINEL",
          aiProfileApiKeys: { profile: "SUPER_SECRET_SENTINEL" },
        },
        other: { deviceName: "Other device", analysisApiKey: "SUPER_SECRET_SENTINEL" },
      },
    },
    index: { preserved: true },
  };
  const saves: unknown[] = [];
  const credentialSaves: string[] = [];
  const effects: Array<{ type: string; value?: string }> = [];
  const candidate = createDeclarativeSettingsCandidateComposition({
    strings: getStrings("pt-PT"),
    configDir: ".obsidian-escola",
    runtimeHost: {
      getSnapshot: () => snapshot,
      replaceSnapshot(next) { snapshot = next as typeof snapshot; },
      async saveSnapshot() { saves.push(snapshot); },
      getCurrentDeviceId: () => "device",
      async runEffect(effect) { effects.push(effect); },
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
      connectionPorts: { async testAnalysisConnection() { return { outcome: "success", messageKey: "connection-success" }; }, async testEmbeddingsConnection() { return { outcome: "success", messageKey: "connection-success" }; } },
      credentialStatus: { getAvailability() { return { required: provider !== "ollama", available: false }; } },
      credentialMutations: { async save(_ref, value) { credentialSaves.push(value); return { ok: true, available: true }; }, async clear() { return { ok: true, available: false }; } },
      getConnectionConfiguration: () => ({ provider, model: "model", baseUrl: "http://localhost:11434", timeout: "60", credentialAvailable: false }),
      getCredentialRef: (domain) => ({ deviceId: "device", domain }), confirmCredentialClear: async () => true,
    },
    binary: { getCurrentStatus: () => ({ status: "absent" }), check: async () => ({ status: "valid" }), createOrUpdate: async () => ({ status: "valid" }), remove: async () => undefined, confirmRemove: async () => true, getReadPreference: () => "jsonl", getMaintainBinaryCopy: () => false },
  });
  return { candidate, getSnapshot: () => snapshot, saves, credentialSaves, effects };
}

function createRendererDouble() {
  let onToggle: ((value: boolean) => Promise<void>) | undefined;
  let onDropdown: ((value: string) => Promise<void>) | undefined;
  const toggle = {
    setValue() { return toggle; },
    onChange(callback: (value: boolean) => Promise<void>) { onToggle = callback; return toggle; },
  };
  const dropdown = {
    addOption() { return dropdown; },
    setValue() { return dropdown; },
    onChange(callback: (value: string) => Promise<void>) { onDropdown = callback; return dropdown; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addToggle(callback: (component: typeof toggle) => void) { callback(toggle); return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
  };
  return {
    setting,
    group: { addSetting() {}, listEl: { createEl() {} } },
    changeToggle: async (value: boolean) => { await onToggle?.(value); },
    changeDropdown: async (value: string) => { await onDropdown?.(value); },
  };
}

function createCredentialRendererDouble() {
  const calls: { value?: string; type?: string; onChange?: (value: string) => void; onSave?: () => void } = {};
  const text = {
    inputEl: { type: "text" } as HTMLInputElement,
    setPlaceholder() { return text; },
    setValue(value: string) { calls.value = value; return text; },
    onChange(callback: (value: string) => void) { calls.onChange = callback; return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addText(callback: (component: typeof text) => void) { callback(text); calls.type = text.inputEl.type; return setting; },
    addButton(callback: (button: { setButtonText(value: string): unknown; setDisabled(value: boolean): unknown; setCta(): unknown; setDestructive(): unknown; onClick(value: () => void): unknown }) => void) {
      const button = {
        setButtonText() { return button; }, setDisabled() { return button; }, setCta() { return button; }, setDestructive() { return button; },
        onClick(value: () => void) { calls.onSave ??= value; return button; },
      };
      callback(button);
      return setting;
    },
    descEl: { createEl() { return { setText() {} }; } },
  };
  return { calls, setting, change(value: string) { calls.value = value; calls.onChange?.(value); } };
}

describe("declarative settings candidate composition", () => {
  it("keeps the complete 12-group, 46-item blueprint while reporting 42 real definitions", () => {
    const { candidate } = createCandidate();
    const diagnostic = candidate.getDiagnosticSnapshot();

    expect(diagnostic.groupCount).toBe(12);
    expect(diagnostic.itemCount).toBe(46);
    expect(new Set(diagnostic.ids).size).toBe(46);
    expect(diagnostic.structuralReadiness).toMatchObject({ complete: true, totalCount: 46, readyCount: 46, unresolvedCount: 0 });
    expect(diagnostic.boundDefinitionCount).toBe(42);
    expect(diagnostic.incompleteIds).toEqual([
      "binary-status", "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy",
    ]);
    expect(candidate.groups.map((group) => group.id)).toEqual(["introduction", "device", "analysis", "binary", "embeddings", "inbox", "index", "exclusions", "hybrid-search", "yaml", "multilingual", "support"]);
    expect(candidate.definitions.map((definition) => definition.id)).toEqual(diagnostic.boundDefinitionIds);
  });

  it("links the six connection and credential definitions through the composition binding factory", async () => {
    const { candidate } = createCandidate();
    const definitions = new Map(candidate.definitions.map((definition) => [definition.id, definition]));
    const ids = [
      "analysis-credential", "test-analysis-connection", "analysis-test-feedback",
      "embeddings-credential", "test-embeddings-connection", "embeddings-test-feedback",
    ];

    expect(ids.every((id) => definitions.has(id))).toBe(true);
    expect(definitions.get("analysis-credential")).toMatchObject({ name: getStrings("pt-PT").settingsApiKey, visible: expect.any(Function) });
    expect(definitions.get("embeddings-credential")).toMatchObject({ name: getStrings("pt-PT").settingsApiKey, visible: expect.any(Function) });
    expect(definitions.get("analysis-credential") && "render" in definitions.get("analysis-credential")!).toBe(true);
    expect(definitions.get("embeddings-credential") && "render" in definitions.get("embeddings-credential")!).toBe(true);
    expect(definitions.get("analysis-test-feedback") && "render" in definitions.get("analysis-test-feedback")!).toBe(true);
    expect(definitions.get("embeddings-test-feedback") && "render" in definitions.get("embeddings-test-feedback")!).toBe(true);

    const analysisAction = definitions.get("test-analysis-connection");
    const embeddingsAction = definitions.get("test-embeddings-connection");
    if (!analysisAction || !("action" in analysisAction) || !embeddingsAction || !("action" in embeddingsAction)) {
      throw new Error("Expected candidate connection actions.");
    }
    analysisAction.action({} as HTMLElement, 0);
    embeddingsAction.action({} as HTMLElement, 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(candidate.getDiagnosticSnapshot().connectionCredentials.analysis.connection.status).toBe("success");
    expect(candidate.getDiagnosticSnapshot().connectionCredentials.embeddings.connection.status).toBe("success");
    const analysisProvider = definitions.get("analysis-provider");
    if (!analysisProvider || !("render" in analysisProvider)) throw new Error("Expected analysis provider renderer.");
    const providerRenderer = createRendererDouble();
    analysisProvider.render(providerRenderer.setting as never, providerRenderer.group as never);
    await providerRenderer.changeDropdown("mistral");
    expect(candidate.getDiagnosticSnapshot().connectionCredentials.analysis.connection.status).toBe("idle");
    expect(candidate.getDiagnosticSnapshot().connectionCredentials.embeddings.connection.status).toBe("success");
    expect(candidate.getDiagnosticSnapshot().connectionCredentialRenderers).toMatchObject({
      rendererCount: 4,
      actionCount: 2,
      readiness: "READY",
    });
    candidate.dispose();
    expect(candidate.connectionCredentialRenderers.getDiagnosticSnapshot().disposed).toBe(true);
  });

  it("keeps a remote credential draft in the rendered candidate only and removes its owner cleanup on dispose", async () => {
    const { candidate, credentialSaves } = createCandidate("mistral");
    const definition = candidate.definitions.find((item) => item.id === "analysis-credential");
    if (!definition || !("render" in definition)) throw new Error("Expected candidate credential renderer.");
    expect(typeof definition.visible === "function" && definition.visible()).toBe(true);

    const rendered = createCredentialRendererDouble();
    definition.render(rendered.setting as never, {} as never);
    expect(rendered.calls).toMatchObject({ value: "", type: "password" });
    rendered.change("SUPER_SECRET_SENTINEL");
    rendered.calls.onSave?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(credentialSaves).toEqual(["SUPER_SECRET_SENTINEL"]);
    expect(rendered.calls.value).toBe("");
    expect(candidate.getDiagnosticSnapshot().connectionCredentialRenderers).toMatchObject({
      owners: ["candidate-connection-credentials-credential-analysis"],
      registeredCleanupCount: 1,
    });
    expect(JSON.stringify(candidate.getDiagnosticSnapshot())).not.toContain("SUPER_SECRET_SENTINEL");
    candidate.dispose();
    expect(candidate.connectionCredentialRenderers.getDiagnosticSnapshot().registeredCleanupCount).toBe(0);
  });

  it("binds static content, native controls, and detached renderers in canonical positions", () => {
    const { candidate } = createCandidate();
    const definitions = new Map(candidate.definitions.map((definition) => [definition.id, definition]));

    expect(definitions.get("support-introduction")).toMatchObject({ name: getStrings("pt-PT").settingsTitle, desc: getStrings("pt-PT").settingsDescription });
    expect(definitions.get("exclusions-note")?.render).toBeTypeOf("function");
    expect(definitions.get("support-link")?.render).toBeTypeOf("function");
    expect(definitions.get("device-name")).toMatchObject({ control: { type: "text", key: "deviceName", disabled: false } });
    expect(definitions.get("embeddings-enabled")).toMatchObject({ control: { type: "toggle", key: "embeddingsEnabled", disabled: false } });
    expect(definitions.get("auto-update-index-on-file-changes")?.render).toBeTypeOf("function");
    expect(definitions.get("analysis-provider")?.render).toBeTypeOf("function");
    expect(definitions.get("binary-preference")?.render).toBeTypeOf("function");
    expect(candidate.groups.flatMap((group) => group.items).filter((item) => item.readiness === "MISSING_REAL_BINDING").map((item) => item.id))
      .toEqual(candidate.getDiagnosticSnapshot().incompleteIds);
  });

  it("writes native candidate controls only through runtime adapters, preserving effects and device data", async () => {
    const { candidate, getSnapshot, saves, effects } = createCandidate();

    expect(candidate.getControlValue("embeddings-enabled")).toBeUndefined();
    expect(await candidate.setControlValue("embeddings-enabled", true)).toEqual({ ok: true });
    expect(await candidate.setControlValue("max-suggested-tags", 99)).toEqual({ ok: false, error: "invalid-value" });
    expect(await candidate.setControlValue("device-name", "  Desktop  ")).toEqual({ ok: true });

    expect(getSnapshot().settings.embeddingsEnabled).toBe(true);
    expect(getSnapshot().settings.deviceSettingsById.device).toMatchObject({
      deviceName: "Desktop",
      analysisApiKey: "SUPER_SECRET_SENTINEL",
      embeddingsApiKey: "SUPER_SECRET_SENTINEL",
    });
    expect(getSnapshot().settings.deviceSettingsById.other).toMatchObject({ deviceName: "Other device" });
    expect(getSnapshot().index).toEqual({ preserved: true });
    expect(saves).toHaveLength(2);
    expect(effects).toEqual([]);
  });

  it("routes detached renderer writes through the candidate adapters in save-then-effect order", async () => {
    const { candidate, getSnapshot, saves, effects } = createCandidate();
    const definitions = new Map(candidate.definitions.map((definition) => [definition.id, definition]));

    const auto = createRendererDouble();
    const autoDefinition = definitions.get("auto-update-index-on-file-changes");
    if (!autoDefinition || !("render" in autoDefinition)) throw new Error("Expected auto-update renderer.");
    autoDefinition.render(auto.setting as never, auto.group as never);
    await auto.changeToggle(true);

    const maxTags = createRendererDouble();
    const maxTagsDefinition = definitions.get("max-suggested-tags");
    if (!maxTagsDefinition || !("render" in maxTagsDefinition)) throw new Error("Expected max-tag renderer.");
    maxTagsDefinition.render(maxTags.setting as never, maxTags.group as never);
    await maxTags.changeDropdown("20");

    const binary = createRendererDouble();
    const binaryDefinition = definitions.get("binary-preference");
    if (!binaryDefinition || !("render" in binaryDefinition)) throw new Error("Expected binary-preference renderer.");
    binaryDefinition.render(binary.setting as never, binary.group as never);
    await binary.changeDropdown("prefer-binary");

    expect(getSnapshot().settings).toMatchObject({
      autoUpdateIndexOnFileChanges: true,
      maxSuggestedTags: 20,
      deviceSettingsById: { device: { embeddingStorageReadPreference: "prefer-binary" } },
    });
    expect(saves).toHaveLength(3);
    expect(effects).toEqual([
      { type: "update-vault-event-listeners" },
      { type: "invalidate-runtime-embedding-index" },
    ]);
  });

  it("keeps lifecycle and bindings instance-local and disposes independently", async () => {
    const first = createCandidate().candidate;
    const second = createCandidate().candidate;
    await first.connectionCredentials.runConnectionTest("analysis");
    expect(first.getDiagnosticSnapshot().connectionCredentials.analysis.connection.status).toBe("success");
    expect(second.getDiagnosticSnapshot().connectionCredentials.analysis.connection.status).toBe("idle");
    first.dispose();
    first.dispose();
    expect(first.controller.isDisposed()).toBe(true);
    expect(second.controller.isDisposed()).toBe(false);
  });

  it("keeps definitions and diagnostic snapshots free of host snapshots and secrets", () => {
    const { candidate } = createCandidate();
    const serializedDefinitions = JSON.stringify(candidate.definitions);
    const diagnostic = candidate.getDiagnosticSnapshot();

    expect(serializedDefinitions).not.toContain("SUPER_SECRET_SENTINEL");
    expect(JSON.stringify(diagnostic)).not.toContain("deviceSettingsById");
    expect(JSON.stringify(diagnostic)).not.toContain("SUPER_SECRET_SENTINEL");
  });
});
