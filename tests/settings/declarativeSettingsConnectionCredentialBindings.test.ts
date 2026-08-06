import { describe, expect, it } from "vitest";
import { createConnectionCredentialBindings } from "../../src/settings/declarativeSettingsConnectionCredentialBindings";
import { createDeclarativeSettingsLifecycleController } from "../../src/settings/declarativeSettingsLifecycleController";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createBindings() {
  const scheduled: Array<() => void> = [];
  const lifecycle = createDeclarativeSettingsLifecycleController({
    requestHostUpdate() {}, scheduleUpdate(callback) { scheduled.push(callback); },
  });
  const analysis = deferred<{ outcome: "success" | "failed"; messageKey: "connection-success" | "connection-failed" }>();
  const embeddings = deferred<{ outcome: "success" | "failed"; messageKey: "connection-success" | "connection-failed" }>();
  let available = false;
  const saves: string[] = [];
  const clears: string[] = [];
  const bindings = createConnectionCredentialBindings({
    lifecycle,
    connectionPorts: { testAnalysisConnection: () => analysis.promise, testEmbeddingsConnection: () => embeddings.promise },
    credentialStatus: { getAvailability: () => ({ required: true, available }) },
    credentialMutations: {
      async save(_ref, value) { saves.push(value); available = true; return { ok: true, available: true }; },
      async clear(ref) { clears.push(ref.domain); available = false; return { ok: true, available: false }; },
    },
    getConnectionConfiguration(domain) { return { provider: "mistral", model: domain === "analysis" ? "mistral-small-latest" : "mistral-embed", baseUrl: "https://api.mistral.ai/v1", timeout: "60", credentialAvailable: available }; },
    getCredentialRef(domain) { return { deviceId: "current", domain }; },
    async confirmCredentialClear() { return true; },
  });
  return { bindings, lifecycle, analysis, embeddings, saves, clears, flush() { for (const callback of scheduled.splice(0)) callback(); } };
}

describe("connection and credential lifecycle bindings", () => {
  it("keeps analysis and embeddings connection feedback independent and safe", async () => {
    const test = createBindings();
    const analysisRun = test.bindings.runConnectionTest("analysis");
    const embeddingsRun = test.bindings.runConnectionTest("embeddings");
    test.analysis.resolve({ outcome: "success", messageKey: "connection-success" });
    test.embeddings.resolve({ outcome: "failed", messageKey: "connection-failed" });
    expect(await analysisRun).toBe(true);
    expect(await embeddingsRun).toBe(true);
    expect(test.bindings.getState().analysis.connection).toMatchObject({ status: "success", provider: "mistral", model: "mistral-small-latest" });
    expect(test.bindings.getState().embeddings.connection).toMatchObject({ status: "error", messageKey: "connection-failed" });
  });

  it("ignores an invalidated late connection result and releases pending", async () => {
    const test = createBindings();
    const run = test.bindings.runConnectionTest("analysis");
    test.bindings.invalidateConnection("analysis");
    test.analysis.resolve({ outcome: "success", messageKey: "connection-success" });
    expect(await run).toBe(false);
    expect(test.bindings.getState().analysis.connection.status).toBe("idle");
    expect(test.lifecycle.isPending("analysis")).toBe(false);
  });

  it("saves a draft only through the mutation boundary and omits it from public state", async () => {
    const test = createBindings();
    let draft = "SUPER_SECRET_SENTINEL";
    expect(await test.bindings.saveCredential("analysis", draft, () => { draft = ""; })).toBe(true);
    expect(test.saves).toEqual(["SUPER_SECRET_SENTINEL"]);
    expect(draft).toBe("");
    expect(test.bindings.getState().analysis.credential).toEqual({ status: "success", available: true, operation: "save" });
    expect(JSON.stringify(test.bindings.getState())).not.toContain("SUPER_SECRET_SENTINEL");
  });

  it("rejects blank drafts, clears only the requested credential, and keeps cleanup isolated", async () => {
    const test = createBindings();
    expect(await test.bindings.saveCredential("embeddings", "   ", () => undefined)).toBe(false);
    let analysisDraft = "a";
    let embeddingsDraft = "b";
    test.bindings.registerDraftCleanup("analysis", "draft", () => { analysisDraft = ""; });
    test.bindings.registerDraftCleanup("embeddings", "draft", () => { embeddingsDraft = ""; });
    expect(await test.bindings.clearCredential("embeddings")).toBe(true);
    expect(test.clears).toEqual(["embeddings"]);
    test.lifecycle.removeOwner("credentials-analysis");
    expect(analysisDraft).toBe("");
    expect(embeddingsDraft).toBe("b");
  });

  it("exposes owner/id cleanup ports without creating another lifecycle", () => {
    const test = createBindings();
    let draft = "SUPER_SECRET_SENTINEL";
    expect(test.bindings.registerCleanup("candidate-renderer", "draft", () => { draft = ""; })).toBe(true);
    expect(test.bindings.removeCleanup("candidate-renderer", "draft")).toBe(true);
    expect(test.bindings.removeCleanup("candidate-renderer", "draft")).toBe(false);
    expect(draft).toBe("");
    expect(JSON.stringify(test.bindings.getState())).not.toContain("SUPER_SECRET_SENTINEL");
  });
});
