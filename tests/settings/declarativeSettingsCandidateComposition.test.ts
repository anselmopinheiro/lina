import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsCandidateComposition } from "../../src/settings/declarativeSettingsCandidateComposition";

function createCandidate() {
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
      credentialStatus: { getAvailability() { return { required: false, available: false }; } },
      credentialMutations: { async save() { return { ok: true, available: true }; }, async clear() { return { ok: true, available: false }; } },
      getConnectionConfiguration: () => ({ provider: "ollama", model: "model", baseUrl: "http://localhost:11434", timeout: "60", credentialAvailable: false }),
      getCredentialRef: (domain) => ({ deviceId: "device", domain }), confirmCredentialClear: async () => true,
    },
    binary: { getCurrentStatus: () => ({ status: "absent" }), check: async () => ({ status: "valid" }), createOrUpdate: async () => ({ status: "valid" }), remove: async () => undefined, confirmRemove: async () => true, getReadPreference: () => "jsonl", getMaintainBinaryCopy: () => false },
  });
  return { candidate, getSnapshot: () => snapshot, saves, effects };
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

describe("declarative settings candidate composition", () => {
  it("keeps the complete 12-group, 46-item blueprint while reporting 36 real definitions", () => {
    const { candidate } = createCandidate();
    const diagnostic = candidate.getDiagnosticSnapshot();

    expect(diagnostic.groupCount).toBe(12);
    expect(diagnostic.itemCount).toBe(46);
    expect(new Set(diagnostic.ids).size).toBe(46);
    expect(diagnostic.structuralReadiness).toMatchObject({ complete: true, totalCount: 46, readyCount: 46, unresolvedCount: 0 });
    expect(diagnostic.boundDefinitionCount).toBe(36);
    expect(diagnostic.incompleteIds).toEqual([
      "analysis-credential", "test-analysis-connection", "analysis-test-feedback",
      "binary-status", "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy",
      "embeddings-credential", "test-embeddings-connection", "embeddings-test-feedback",
    ]);
    expect(candidate.groups.map((group) => group.id)).toEqual(["introduction", "device", "analysis", "binary", "embeddings", "inbox", "index", "exclusions", "hybrid-search", "yaml", "multilingual", "support"]);
    expect(candidate.definitions.map((definition) => definition.id)).toEqual(diagnostic.boundDefinitionIds);
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
