import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { PURE_SETTINGS_ASYNC_ACTION_IDS, createPureSettingsAsyncActionDescriptors, isPureBinaryCheckDisabled, isPureBinaryCreateDisabled, isPureBinaryRemoveDisabled, isPureConnectionActionDisabled, type PureAsyncActionState } from "../../src/settings/pureSettingsAsyncActions";

const strings = getStrings("pt-PT");
const text = { testConnection: strings.settingsTestConnection, testEmbeddingsConnection: strings.settingsTestEmbeddingsConnection, testingConnection: strings.settingsTestingConnection, connectionSuccess: strings.settingsConnectionSuccess, connectionFailed: strings.settingsConnectionFailed, embeddingTestFailed: strings.settingsEmbeddingTestFailed, binaryCheck: strings.settingsBinaryCheck, binaryCreate: strings.settingsBinaryCreate, binaryRemove: strings.settingsBinaryRemove, binaryRemoveConfirm: strings.settingsBinaryRemoveConfirm, binaryWorking: strings.settingsBinaryWorking, binarySuccess: strings.settingsBinarySuccess, binaryError: strings.settingsBinaryError };
const inputs = { analysis: { provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-small-latest", credentialAvailable: true, timeout: "60", actionInProgress: false }, embeddings: { provider: "ollama", baseUrl: "http://localhost:11434", model: "nomic-embed-text", credentialAvailable: false, timeout: "60", actionInProgress: false }, binary: { operationInProgress: false, legacyManifest: false } };

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
    expect(actions[0].feedback).toMatchObject({ supportsPending: true, supportsSuccess: true, supportsError: true, requiresAriaLive: false });
    expect(actions.slice(2).every((action) => action.feedback.ariaLivePoliteness === "polite")).toBe(true);
    expect(actions[3].declaredEffects.map((effect) => effect.type)).toContain("invalidate-runtime-embedding-index");
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
});
