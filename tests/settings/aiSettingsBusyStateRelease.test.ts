import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createConnectionCredentialBindings,
  type ConnectionCredentialBindingsOptions,
  type SafeConnectionConfiguration,
} from "../../src/settings/declarativeSettingsConnectionCredentialBindings";
import { createDeclarativeSettingsLifecycleController } from "../../src/settings/declarativeSettingsLifecycleController";

type Result = { outcome: "success" | "failed"; messageKey: "connection-success" | "connection-failed" };

function setup(overrides: {
  getConfig?: (domain: "analysis" | "embeddings") => SafeConnectionConfiguration;
  testEmbeddings?: () => Promise<Result>;
  testAnalysis?: () => Promise<Result>;
  save?: ConnectionCredentialBindingsOptions["credentialMutations"]["save"];
} = {}) {
  const lifecycle = createDeclarativeSettingsLifecycleController({
    requestHostUpdate() {}, scheduleUpdate() {},
  });
  const config = (domain: "analysis" | "embeddings"): SafeConnectionConfiguration => ({
    provider: "ollama", model: `${domain}-model`, baseUrl: "http://localhost:11434", timeout: "60", credentialAvailable: false,
  });
  const bindings = createConnectionCredentialBindings({
    lifecycle,
    connectionPorts: {
      testAnalysisConnection: overrides.testAnalysis ?? (async () => ({ outcome: "success", messageKey: "connection-success" })),
      testEmbeddingsConnection: overrides.testEmbeddings ?? (async () => ({ outcome: "success", messageKey: "connection-success" })),
    },
    credentialStatus: { getAvailability: () => ({ required: false, available: false }) },
    credentialMutations: {
      save: overrides.save ?? (async () => ({ ok: true, available: true })),
      async clear() { return { ok: true, available: false }; },
    },
    getConnectionConfiguration: overrides.getConfig ?? config,
    getCredentialRef: (domain) => ({ deviceId: "current", domain }),
    confirmCredentialClear: async () => true,
  });
  return { bindings, lifecycle };
}

function throwWhen(state: { broken: boolean }, domain: string): SafeConnectionConfiguration {
  if (state.broken) throw new Error("nope");
  return { provider: "ollama", model: `${domain}-model`, baseUrl: "http://localhost:11434", timeout: "60", credentialAvailable: false };
}

describe("AI settings busy-state release", () => {
  it("re-enables the connection test after success and after a failed result", async () => {
    const ok = setup();
    expect(await ok.bindings.runConnectionTest("embeddings")).toBe(true);
    expect(ok.bindings.getState().embeddings.connection.status).toBe("success");
    expect(ok.lifecycle.isPending("embeddings")).toBe(false);

    const failed = setup({ testEmbeddings: async () => ({ outcome: "failed", messageKey: "connection-failed" }) });
    await failed.bindings.runConnectionTest("embeddings");
    expect(failed.bindings.getState().embeddings.connection.status).toBe("error");
    expect(failed.lifecycle.isPending("embeddings")).toBe(false);
  });

  it("releases pending when the port throws unexpectedly", async () => {
    const test = setup({ testEmbeddings: () => Promise.reject(new Error("boom")) });
    await test.bindings.runConnectionTest("embeddings");
    expect(test.bindings.getState().embeddings.connection.status).toBe("error");
    expect(test.lifecycle.isPending("embeddings")).toBe(false);
    expect(await test.bindings.runConnectionTest("embeddings")).toBe(true); // startable again (settles with an error result)
  });

  it("releases pending when the configuration resolver throws after a failed embeddings operation", async () => {
    let broken = false;
    const test = setup({
      getConfig: (domain) => {
        if (broken) throw new Error("runtime state unavailable");
        return { provider: "ollama", model: `${domain}-model`, baseUrl: "http://localhost:11434", timeout: "60", credentialAvailable: false };
      },
      testEmbeddings: async () => { broken = true; return { outcome: "success", messageKey: "connection-success" }; },
    });
    await expect(test.bindings.runConnectionTest("embeddings")).resolves.toBeDefined();
    expect(test.lifecycle.isPending("embeddings")).toBe(false);
    expect(test.bindings.getState().embeddings.connection.status).not.toBe("pending");
    broken = false;
    expect(await test.bindings.runConnectionTest("embeddings")).toBe(true);
  });

  it("releases pending when the resolver throws before the request starts", async () => {
    const state = { broken: false };
    const test = setup({ getConfig: (domain) => throwWhen(state, domain) });
    state.broken = true;
    await expect(test.bindings.runConnectionTest("analysis")).resolves.toBeDefined();
    expect(test.lifecycle.isPending("analysis")).toBe(false);
    expect(test.bindings.getState().analysis.connection.status).toBe("error");
  });

  it("keeps analysis and embeddings independent when one domain fails", async () => {
    const test = setup({ testEmbeddings: () => Promise.reject(new Error("boom")) });
    await test.bindings.runConnectionTest("embeddings");
    expect(await test.bindings.runConnectionTest("analysis")).toBe(true);
    expect(test.lifecycle.isPending("analysis")).toBe(false);
  });

  it("neutralises the late result on cancellation (invalidate) and leaves the domain startable", async () => {
    let release: (value: Result) => void = () => undefined;
    const test = setup({ testEmbeddings: () => new Promise<Result>((resolve) => { release = resolve; }) });
    const run = test.bindings.runConnectionTest("embeddings");
    test.bindings.invalidateConnection("embeddings");
    release({ outcome: "success", messageKey: "connection-success" });
    expect(await run).toBe(false);
    expect(test.bindings.getState().embeddings.connection.status).toBe("idle");
    expect(test.lifecycle.isPending("embeddings")).toBe(false);
  });

  it("releases credential save/clear pending when the resolver or mutation throws", async () => {
    const test = setup({ save: () => Promise.reject(new Error("fs")) });
    expect(await test.bindings.saveCredential("analysis", "k", () => undefined)).toBe(false);
    expect(test.lifecycle.isPending("credentials-analysis")).toBe(false);
    expect(test.bindings.getState().analysis.credential.status).toBe("error");

    const state = { broken: false };
    const broken = setup({ getConfig: (domain) => throwWhen(state, domain) });
    state.broken = true;
    expect(await broken.bindings.saveCredential("embeddings", "k", () => undefined)).toBe(false);
    expect(broken.lifecycle.isPending("credentials-embeddings")).toBe(false);
    expect(broken.bindings.getState().embeddings.credential.status).toBe("error");
  });

  it("reopening settings (new composition instance) starts enabled and idle", () => {
    const first = setup();
    first.lifecycle.dispose();
    const second = setup();
    expect(second.bindings.getState().embeddings.connection.status).toBe("idle");
    expect(second.lifecycle.isPending("embeddings")).toBe(false);
  });

  it("does not persist transient busy flags nor ship disabling CSS for the connection button", () => {
    const settingsSource = readFileSync("src/settings.ts", "utf8");
    expect(settingsSource).not.toMatch(/\b(isBusy|isGenerating|isTesting|aiBusy|providerBusy)\b/);
    const css = readFileSync("styles.css", "utf8");
    expect(css).not.toMatch(/pointer-events:\s*none/);
  });
});
