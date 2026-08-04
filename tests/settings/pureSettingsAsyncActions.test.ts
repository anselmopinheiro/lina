import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  PURE_SETTINGS_ASYNC_ACTION_IDS,
  createPureBinaryRuntime,
  createPureConnectionTestRuntime,
  createPureSettingsAsyncActionDescriptors,
  getPureConnectionTestFeedbackText,
  getPureBinaryFeedbackText,
  getPureBinaryStatusText,
  isPureBinaryCheckDisabled,
  isPureBinaryCreateDisabled,
  isPureBinaryRemoveDisabled,
  isPureConnectionActionDisabled,
  type PureAsyncActionState,
  type PureConnectionTestInput,
  type PureConnectionTestResult,
  type PureBinaryResult,
  type PureBinaryRuntimeInput,
} from "../../src/settings/pureSettingsAsyncActions";

const strings = getStrings("pt-PT");
const text = { testConnection: strings.settingsTestConnection, testEmbeddingsConnection: strings.settingsTestEmbeddingsConnection, testingConnection: strings.settingsTestingConnection, connectionSuccess: strings.settingsConnectionSuccess, connectionFailed: strings.settingsConnectionFailed, embeddingTestFailed: strings.settingsEmbeddingTestFailed, binaryCheck: strings.settingsBinaryCheck, binaryCreate: strings.settingsBinaryCreate, binaryRemove: strings.settingsBinaryRemove, binaryRemoveConfirm: strings.settingsBinaryRemoveConfirm, binaryWorking: strings.settingsBinaryWorking, binarySuccess: strings.settingsBinarySuccess, binaryError: strings.settingsBinaryError };
const inputs = { analysis: { provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-small-latest", credentialAvailable: true, timeout: "60", actionInProgress: false }, embeddings: { provider: "ollama", baseUrl: "http://localhost:11434", model: "nomic-embed-text", credentialAvailable: false, timeout: "60", actionInProgress: false }, binary: { operationInProgress: false, legacyManifest: false } };
const runtimeText = { ...text, analysisApiKeyMissing: strings.settingsApiKeyMissing, embeddingsApiKeyMissing: strings.settingsEmbeddingTestMistralApiKeyMissing };
const analysisInput: PureConnectionTestInput = { provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-small-latest", credentialAvailable: true, timeout: "60" };
const embeddingsInput: PureConnectionTestInput = { provider: "ollama", baseUrl: "http://localhost:11434", model: "nomic-embed-text", credentialAvailable: false, timeout: "60" };
const binaryInput: PureBinaryRuntimeInput = { legacyManifest: false };
const binaryText = {
  binaryWorking: strings.settingsBinaryWorking,
  binarySuccess: strings.settingsBinarySuccess,
  binaryError: strings.settingsBinaryError,
  binaryRemoveConfirm: strings.settingsBinaryRemoveConfirm,
};
const binaryStatusText = {
  copyState: strings.settingsBinaryCopyState,
  notChecked: strings.settingsBinaryStatusNotChecked,
  disabled: strings.settingsBinaryStatusDisabled,
  absent: strings.settingsBinaryStatusAbsent,
  valid: strings.settingsBinaryStatusValid,
  outdated: strings.settingsBinaryStatusOutdated,
  incomplete: strings.settingsBinaryStatusIncomplete,
  invalid: strings.settingsBinaryStatusInvalid,
  unsupported: strings.settingsBinaryStatusUnsupported,
  legacyManifest: strings.settingsBinaryStatusLegacyManifest,
  error: strings.settingsBinaryError,
  records: strings.settingsBinaryRecords,
  dimensions: strings.settingsBinaryDimensions,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

describe("pure settings async actions", () => {
  it("keeps the exact action set and current order", () => {
    expect(createPureSettingsAsyncActionDescriptors(text, inputs).map((item) => item.id)).toEqual(PURE_SETTINGS_ASYNC_ACTION_IDS);
    expect(new Set(PURE_SETTINGS_ASYNC_ACTION_IDS).size).toBe(5);
  });
  it("uses closed discriminated async states", () => {
    const states: PureAsyncActionState<{ status: string }>[] = [{ status: "idle" }, { status: "awaiting-confirmation" }, { status: "pending" }, { status: "success", result: { status: "valid" } }, { status: "error", error: { code: "binary-operation-failed", messageKey: "binary-error", retryable: true } }];
    expect(states.map((state) => state.status)).toEqual(["idle", "awaiting-confirmation", "pending", "success", "error"]);
  });
  it("models only the disabled conditions present in the imperative flow", () => {
    expect(isPureConnectionActionDisabled({ ...inputs.analysis, actionInProgress: false })).toBe(false);
    expect(isPureConnectionActionDisabled({ ...inputs.analysis, actionInProgress: true })).toBe(true);
    expect(isPureBinaryCheckDisabled({ operationInProgress: true, legacyManifest: false })).toBe(true);
    expect(isPureBinaryCreateDisabled({ operationInProgress: false, legacyManifest: true })).toBe(true);
    expect(isPureBinaryRemoveDisabled({ operationInProgress: false, legacyManifest: true })).toBe(false);
  });
  it("keeps confirmation destructive and exclusive to binary removal", () => {
    const actions = createPureSettingsAsyncActionDescriptors(text, inputs);
    expect(actions.filter((action) => action.confirmation.required).map((action) => action.id)).toEqual(["remove-binary-copy"]);
    expect(actions[4].confirmation).toMatchObject({ destructive: true, message: strings.settingsBinaryRemoveConfirm, confirmLabel: strings.settingsBinaryRemove });
  });
  it("declares feedback, effects, cleanup, and future refresh without functions", () => {
    const actions = createPureSettingsAsyncActionDescriptors(text, inputs);
    expect(actions.slice(0, 2).every((action) => action.feedback.ariaLivePoliteness === "polite")).toBe(true);
    expect(actions.slice(2).every((action) => action.feedback.ariaLivePoliteness === "polite")).toBe(true);
    expect(actions[3].declaredEffects.map((effect) => effect.type)).toContain("invalidate-runtime-embedding-index");
    expect(actions[0].declaredEffects.map((effect) => effect.type)).toEqual(["set-pending", "request-settings-refresh", "run-analysis-connection-test", "set-success", "set-error", "request-settings-refresh", "clear-transient-result"]);
    expect(actions[4].cleanupEffects.map((effect) => effect.type)).toEqual(["clear-transient-result", "request-settings-refresh"]);
    expect(actions.every((action) => Object.values(action).every((value) => typeof value !== "function"))).toBe(true);
  });
  it("does not retain credentials and returns independent structures", () => {
    const first = createPureSettingsAsyncActionDescriptors(text, inputs); const second = createPureSettingsAsyncActionDescriptors(text, inputs);
    first[0].inputs.provider = "changed";
    expect(second[0].inputs.provider).toBe("mistral");
    expect(Object.keys(first[0].inputs)).not.toContain("credential");
    expect(first[0].inputs.credentialAvailable).toBe(true);
  });

  it("runs an analysis connection test through an injected port with pending and success updates", async () => {
    const analysis = deferred<PureConnectionTestResult>();
    const calls: PureConnectionTestInput[] = [];
    const updates: string[] = [];
    const runtime = createPureConnectionTestRuntime({
      testAnalysisConnection: async (input) => { calls.push(input); return analysis.promise; },
      testEmbeddingsConnection: async () => ({ outcome: "success", messageKey: "connection-success" }),
      requestUpdate: () => { updates.push("update"); },
    });

    const run = runtime.run("test-analysis-connection", analysisInput);
    expect(runtime.getState("test-analysis-connection")).toEqual({ status: "pending" });
    expect(runtime.isDisabled("test-analysis-connection")).toBe(true);
    expect(calls).toEqual([analysisInput]);
    expect(Object.keys(calls[0])).toEqual(["provider", "baseUrl", "model", "credentialAvailable", "timeout"]);
    expect(updates).toEqual(["update"]);

    analysis.resolve({ outcome: "success", messageKey: "connection-success" });
    await run;
    expect(runtime.getState("test-analysis-connection")).toEqual({ status: "success", result: { outcome: "success", messageKey: "connection-success" } });
    expect(runtime.isDisabled("test-analysis-connection")).toBe(false);
    expect(updates).toEqual(["update", "update"]);
  });

  it("prevents concurrent runs and normalizes unknown failures without exposing their message", async () => {
    const analysis = deferred<PureConnectionTestResult>();
    let calls = 0;
    const runtime = createPureConnectionTestRuntime({
      testAnalysisConnection: async () => { calls += 1; return analysis.promise; },
      testEmbeddingsConnection: async () => { throw new Error("apiKey=never-expose"); },
      requestUpdate: () => undefined,
    });

    const first = runtime.run("test-analysis-connection", analysisInput);
    await runtime.run("test-analysis-connection", analysisInput);
    expect(calls).toBe(1);
    analysis.resolve({ outcome: "failed", messageKey: "connection-failed" });
    await first;
    expect(runtime.getState("test-analysis-connection")).toEqual({ status: "error", error: { code: "connection-failed", messageKey: "connection-failed", retryable: true } });

    await runtime.run("test-embeddings-connection", embeddingsInput);
    expect(runtime.getState("test-embeddings-connection")).toEqual({ status: "error", error: { code: "connection-failed", messageKey: "connection-failed", retryable: true } });
    expect(getPureConnectionTestFeedbackText(runtimeText, runtime.getState("test-embeddings-connection"))).toBe(strings.settingsConnectionFailed);
  });

  it("keeps analysis and embeddings feedback states isolated and maps only existing safe messages", async () => {
    const runtime = createPureConnectionTestRuntime({
      testAnalysisConnection: async () => ({ outcome: "failed", messageKey: "analysis-api-key-missing" }),
      testEmbeddingsConnection: async () => ({ outcome: "failed", messageKey: "embeddings-api-key-missing" }),
      requestUpdate: () => undefined,
    });

    expect(getPureConnectionTestFeedbackText(runtimeText, runtime.getState("test-analysis-connection"))).toBe("");
    await runtime.run("test-analysis-connection", analysisInput);
    expect(getPureConnectionTestFeedbackText(runtimeText, runtime.getState("test-analysis-connection"))).toBe(strings.settingsApiKeyMissing);
    expect(runtime.getState("test-embeddings-connection")).toEqual({ status: "idle" });
    await runtime.run("test-embeddings-connection", embeddingsInput);
    expect(getPureConnectionTestFeedbackText(runtimeText, runtime.getState("test-embeddings-connection"))).toBe(strings.settingsEmbeddingTestMistralApiKeyMissing);
  });

  it("models safe binary states and feedback without paths, files, or raw errors", () => {
    expect(getPureBinaryStatusText(binaryStatusText, { status: "unchecked" })).toBe(`${strings.settingsBinaryCopyState}: ${strings.settingsBinaryStatusNotChecked}`);
    expect(getPureBinaryStatusText(binaryStatusText, { status: "valid", recordCount: 12, dimensions: 768, byteLengthKiB: 36 })).toBe(`${strings.settingsBinaryCopyState}: ${strings.settingsBinaryStatusValid} · 12 · 768D · 36 KiB`);
    expect(getPureBinaryStatusText(binaryStatusText, { status: "absent" })).toBe(`${strings.settingsBinaryCopyState}: ${strings.settingsBinaryStatusAbsent}`);
    expect(getPureBinaryStatusText(binaryStatusText, { status: "outdated", reasonCode: "legacy-manifest" })).toBe(`${strings.settingsBinaryCopyState}: ${strings.settingsBinaryStatusLegacyManifest}`);
    expect(getPureBinaryStatusText(binaryStatusText, { status: "error" })).toBe(`${strings.settingsBinaryCopyState}: ${strings.settingsBinaryError}`);
    expect(getPureBinaryFeedbackText(binaryText, { status: "awaiting-confirmation", actionId: "remove-binary-copy" })).toBe(strings.settingsBinaryRemoveConfirm);
    expect(getPureBinaryFeedbackText(binaryText, { status: "error", actionId: "check-binary-copy", error: { code: "binary-operation-failed", messageKey: "binary-error", retryable: true } })).toBe(strings.settingsBinaryError);
  });

  it("runs a binary check once with pending, status update, and safe success feedback", async () => {
    const check = deferred<PureBinaryResult>();
    const calls: PureBinaryRuntimeInput[] = [];
    const updates: string[] = [];
    const runtime = createPureBinaryRuntime({
      checkBinaryCopy: (input) => { calls.push(input); return check.promise; },
      createOrUpdateBinaryCopy: async () => ({ status: "valid" }),
      removeBinaryCopy: async () => undefined,
      requestConfirmation: async () => true,
      requestUpdate: () => { updates.push("update"); },
    }, { actionId: "remove-binary-copy", message: strings.settingsBinaryRemoveConfirm, confirmLabel: strings.settingsBinaryRemove, cancelLabel: "cancel", destructive: true });

    const first = runtime.run("check-binary-copy", binaryInput);
    await runtime.run("check-binary-copy", binaryInput);
    expect(calls).toEqual([binaryInput]);
    expect(runtime.getActionState()).toEqual({ status: "pending", actionId: "check-binary-copy" });
    expect(runtime.isDisabled("check-binary-copy", binaryInput)).toBe(true);
    expect(updates).toEqual(["update"]);
    check.resolve({ status: "outdated", recordCount: 3, dimensions: 384, byteLengthKiB: 5 });
    await first;
    expect(runtime.getActionState()).toEqual({ status: "success", actionId: "check-binary-copy" });
    expect(runtime.getStatusState()).toEqual({ status: "outdated", recordCount: 3, dimensions: 384, byteLengthKiB: 5, reasonCode: undefined });
    expect(updates).toEqual(["update", "update"]);
  });

  it("blocks binary creation for a legacy manifest and normalizes a thrown create failure", async () => {
    let createCalls = 0;
    const runtime = createPureBinaryRuntime({
      checkBinaryCopy: async () => ({ status: "valid" }),
      createOrUpdateBinaryCopy: async () => { createCalls += 1; throw new Error("D:/private/embeddings.vectors.f32"); },
      removeBinaryCopy: async () => undefined,
      requestConfirmation: async () => true,
      requestUpdate: () => undefined,
    }, { actionId: "remove-binary-copy", message: strings.settingsBinaryRemoveConfirm, confirmLabel: strings.settingsBinaryRemove, cancelLabel: "cancel", destructive: true });

    expect(runtime.isDisabled("create-or-update-binary-copy", { legacyManifest: true })).toBe(true);
    await runtime.run("create-or-update-binary-copy", { legacyManifest: true });
    expect(createCalls).toBe(0);
    await runtime.run("create-or-update-binary-copy", binaryInput);
    expect(runtime.getActionState()).toEqual({ status: "error", actionId: "create-or-update-binary-copy", error: { code: "binary-operation-failed", messageKey: "binary-error", retryable: true } });
    expect(runtime.getStatusState()).toEqual({ status: "error" });
    expect(getPureBinaryFeedbackText(binaryText, runtime.getActionState())).toBe(strings.settingsBinaryError);
  });

  it("runs create/update through pending to success and blocks duplicate removal while confirming", async () => {
    const create = deferred<PureBinaryResult>();
    const confirmation = deferred<boolean>();
    const removal = deferred<void>();
    let createCalls = 0;
    let confirmationCalls = 0;
    let removalCalls = 0;
    const runtime = createPureBinaryRuntime({
      checkBinaryCopy: async () => ({ status: "valid" }),
      createOrUpdateBinaryCopy: () => { createCalls += 1; return create.promise; },
      removeBinaryCopy: () => { removalCalls += 1; return removal.promise; },
      requestConfirmation: () => { confirmationCalls += 1; return confirmation.promise; },
      requestUpdate: () => undefined,
    }, { actionId: "remove-binary-copy", message: strings.settingsBinaryRemoveConfirm, confirmLabel: strings.settingsBinaryRemove, cancelLabel: "cancel", destructive: true });

    const createRun = runtime.run("create-or-update-binary-copy", binaryInput);
    expect(runtime.getActionState()).toEqual({ status: "pending", actionId: "create-or-update-binary-copy" });
    create.resolve({ status: "valid" });
    await createRun;
    expect(createCalls).toBe(1);
    expect(runtime.getActionState()).toEqual({ status: "success", actionId: "create-or-update-binary-copy" });

    const removeRun = runtime.run("remove-binary-copy", binaryInput);
    await runtime.run("remove-binary-copy", binaryInput);
    expect(confirmationCalls).toBe(1);
    expect(removalCalls).toBe(0);
    confirmation.resolve(true);
    await Promise.resolve();
    expect(removalCalls).toBe(1);
    removal.resolve();
    await removeRun;
    expect(runtime.getActionState()).toEqual({ status: "success", actionId: "remove-binary-copy" });
  });

  it("keeps binary removal behind destructive confirmation and cancels without calling the remove port", async () => {
    const confirmations: unknown[] = [];
    let removeCalls = 0;
    const updates: string[] = [];
    let confirmed = false;
    const runtime = createPureBinaryRuntime({
      checkBinaryCopy: async () => ({ status: "valid" }),
      createOrUpdateBinaryCopy: async () => ({ status: "valid" }),
      removeBinaryCopy: async () => { removeCalls += 1; },
      requestConfirmation: async (request) => { confirmations.push(request); return confirmed; },
      requestUpdate: () => { updates.push("update"); },
    }, { actionId: "remove-binary-copy", message: strings.settingsBinaryRemoveConfirm, confirmLabel: strings.settingsBinaryRemove, cancelLabel: "cancel", destructive: true });

    await runtime.run("remove-binary-copy", binaryInput);
    expect(confirmations).toEqual([{ actionId: "remove-binary-copy", message: strings.settingsBinaryRemoveConfirm, confirmLabel: strings.settingsBinaryRemove, cancelLabel: "cancel", destructive: true }]);
    expect(removeCalls).toBe(0);
    expect(runtime.getActionState()).toEqual({ status: "idle" });
    expect(updates).toEqual(["update", "update"]);

    confirmed = true;
    await runtime.run("remove-binary-copy", binaryInput);
    expect(removeCalls).toBe(1);
    expect(runtime.getActionState()).toEqual({ status: "success", actionId: "remove-binary-copy" });
    expect(runtime.getStatusState()).toEqual({ status: "absent" });
    expect(updates).toEqual(["update", "update", "update", "update", "update"]);
  });
});
