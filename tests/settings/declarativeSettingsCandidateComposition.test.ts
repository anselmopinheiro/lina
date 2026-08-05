import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsCandidateComposition } from "../../src/settings/declarativeSettingsCandidateComposition";

function createCandidate() {
  let snapshot = { settings: { deviceSettingsById: {} }, index: { preserved: true } };
  return createDeclarativeSettingsCandidateComposition({
    strings: getStrings("pt-PT"),
    runtimeHost: { getSnapshot: () => snapshot, replaceSnapshot(next) { snapshot = next; }, async saveSnapshot() {}, getCurrentDeviceId: () => "device", async runEffect() {} },
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
}

describe("declarative settings candidate composition", () => {
  it("has the complete 12-group, 46-item blueprint in canonical order", () => {
    const candidate = createCandidate(); const diagnostic = candidate.getDiagnosticSnapshot();
    expect(diagnostic.groupCount).toBe(12); expect(diagnostic.itemCount).toBe(46);
    expect(new Set(diagnostic.ids).size).toBe(46);
    expect(diagnostic.readiness).toMatchObject({ complete: true, totalCount: 46, readyCount: 46, unresolvedCount: 0 });
    expect(candidate.groups.map((group) => group.id)).toEqual(["introduction", "device", "analysis", "binary", "embeddings", "inbox", "index", "exclusions", "hybrid-search", "yaml", "multilingual", "support"]);
  });
  it("keeps lifecycle and bindings instance-local and disposes independently", async () => {
    const first = createCandidate(); const second = createCandidate();
    await first.connectionCredentials.runConnectionTest("analysis");
    expect(first.getDiagnosticSnapshot().connectionCredentials.analysis.connection.status).toBe("success");
    expect(second.getDiagnosticSnapshot().connectionCredentials.analysis.connection.status).toBe("idle");
    first.dispose(); first.dispose();
    expect(first.controller.isDisposed()).toBe(true); expect(second.controller.isDisposed()).toBe(false);
  });
  it("keeps diagnostic snapshots free of host snapshots and secrets", () => {
    const diagnostic = createCandidate().getDiagnosticSnapshot();
    expect(JSON.stringify(diagnostic)).not.toContain("deviceSettingsById");
    expect(JSON.stringify(diagnostic)).not.toContain("SUPER_SECRET_SENTINEL");
  });
});
