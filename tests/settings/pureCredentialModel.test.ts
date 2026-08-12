import { describe, expect, it } from "vitest";
import {
  createCredentialRef,
  createCredentialState,
  getCredentialAvailability,
  isCredentialDomain,
  transitionCredentialState,
  type CredentialMutationPort,
  type CredentialStatusPort,
  type PersistedCredentialPresence,
} from "../../src/settings/pureCredentialModel";
import { createPureCredentialAdapter } from "../../src/settings/pureLocalSettingAdapters";
import { getStrings } from "../../src/i18n/strings";
import { createPureSettingsAsyncActionDescriptors } from "../../src/settings/pureSettingsAsyncActions";
import { assessDeclarativeSettingsParity, createPureDeclarativeSettingsBlueprint } from "../../src/settings/pureDeclarativeSettingsBlueprint";

const noPresence: PersistedCredentialPresence = {
  analysisDevice: false,
  embeddingsDevice: false,
  legacyAi: false,
  legacyEmbedding: false,
};
const strings = getStrings("pt-PT");
const credentialStrings = {
  credential: strings.settingsApiKey,
  credentialDescription: strings.settingsApiKeyDescription,
  credentialPlaceholder: strings.settingsApiKeyPlaceholder,
  credentialSavedPlaceholder: strings.settingsApiKeyLocalSaved,
};

describe("pure credential model", () => {
  it("uses closed domains and device-scoped references", () => {
    expect(isCredentialDomain("analysis")).toBe(true);
    expect(isCredentialDomain("embeddings")).toBe(true);
    expect(isCredentialDomain("unknown")).toBe(false);
    expect(createCredentialRef(" device-a ", "analysis")).toEqual({ deviceId: "device-a", domain: "analysis" });
    expect(() => createCredentialRef("", "analysis")).toThrow("Invalid credential reference.");
  });

  it("derives credential requirements from the shared provider metadata", () => {
    const analysis = createCredentialRef("device-a", "analysis");
    expect(getCredentialAvailability(analysis, "ollama", noPresence)).toEqual({ required: false, available: false });
    for (const provider of ["mistral", "openrouter"] as const) {
      expect(getCredentialAvailability(analysis, provider, noPresence)).toEqual({ required: true, available: false });
    }
  });

  it("preserves current presence-only fallback precedence", () => {
    const analysis = createCredentialRef("device-a", "analysis");
    const embeddings = createCredentialRef("device-a", "embeddings");
    expect(getCredentialAvailability(analysis, "mistral", { ...noPresence, legacyAi: true })).toEqual({ required: true, available: false });
    expect(getCredentialAvailability(embeddings, "mistral", { ...noPresence, legacyAi: true })).toEqual({ required: true, available: true });
    expect(getCredentialAvailability(embeddings, "mistral", { ...noPresence, legacyEmbedding: true })).toEqual({ required: true, available: true });
    expect(getCredentialAvailability(embeddings, "mistral", { ...noPresence, analysisDevice: true })).toEqual({ required: true, available: true });
    expect(getCredentialAvailability(embeddings, "mistral", { ...noPresence, embeddingsDevice: true })).toEqual({ required: true, available: true });
    expect(getCredentialAvailability(embeddings, "openrouter", { ...noPresence, analysisDevice: true })).toEqual({ required: true, available: false });
    expect(getCredentialAvailability(embeddings, "openrouter", { ...noPresence, legacyAi: true })).toEqual({ required: true, available: false });
    expect(getCredentialAvailability(embeddings, "openrouter", { ...noPresence, legacyEmbedding: true })).toEqual({ required: true, available: true });
  });

  it("keeps transitions explicit, normalized, and instance-local", () => {
    const absent = createCredentialState({ required: true, available: false });
    const stored = createCredentialState({ required: true, available: true });
    expect(absent).toEqual({ status: "absent", availability: { required: true, available: false } });
    expect(stored).toEqual({ status: "stored", availability: { required: true, available: true } });

    const saving = transitionCredentialState(absent, { type: "begin-save" });
    const success = transitionCredentialState(saving, { type: "mutation-complete", result: { ok: true, available: true } });
    const clearing = transitionCredentialState(success, { type: "begin-clear" });
    const error = transitionCredentialState(clearing, { type: "mutation-complete", result: { ok: false, error: "clear-failed" } });
    expect(saving.status).toBe("saving");
    expect(success).toEqual({ status: "success", availability: { required: true, available: true } });
    expect(clearing.status).toBe("clearing");
    expect(error).toEqual({ status: "error", availability: { required: true, available: true }, error: "clear-failed" });
    expect(stored).toEqual({ status: "stored", availability: { required: true, available: true } });
    expect(transitionCredentialState(error, { type: "reset" })).toEqual({ status: "stored", availability: { required: true, available: true } });
  });

  it("keeps ports and public models free of submitted values", async () => {
    const sentinel = "SUPER_SECRET_SENTINEL";
    const ref = createCredentialRef("device-a", "analysis");
    const statusPort: CredentialStatusPort = {
      getAvailability: () => ({ required: true, available: true }),
    };
    const received: string[] = [];
    const mutationPort: CredentialMutationPort = {
      async save(_ref, value) { received.push(value); return { ok: true, available: true }; },
      async clear() { return { ok: true, available: false }; },
    };
    const availability = statusPort.getAvailability(ref, "mistral");
    const saveResult = await mutationPort.save(ref, sentinel);
    const clearResult = await mutationPort.clear(ref);
    const state = transitionCredentialState(createCredentialState(availability), { type: "begin-save" });
    const completed = transitionCredentialState(state, { type: "mutation-complete", result: saveResult });
    const serializedPublicModels = JSON.stringify({ ref, availability, saveResult, clearResult, completed });

    expect(received).toEqual([sentinel]);
    expect(Object.keys(availability)).toEqual(["required", "available"]);
    expect(Object.keys(saveResult)).toEqual(["ok", "available"]);
    expect(Object.keys(clearResult)).toEqual(["ok", "available"]);
    expect(serializedPublicModels).not.toContain(sentinel);
  });

  it("adds availability to the detached credential adapter without exposing a value", () => {
    const adapter = createPureCredentialAdapter("mistral", credentialStrings, { required: true, available: true });
    expect(adapter.availability).toEqual({ required: true, available: true });
    expect(Object.keys(adapter)).not.toContain("value");
    expect(JSON.stringify(adapter)).not.toContain("SUPER_SECRET_SENTINEL");
  });

  it("keeps 9L connection descriptors redacted and the blueprint at 47 ready items", () => {
    const actionStrings = {
      testConnection: strings.settingsTestConnection, testEmbeddingsConnection: strings.settingsTestEmbeddingsConnection,
      testingConnection: strings.settingsTestingConnection, connectionSuccess: strings.settingsConnectionSuccess,
      connectionFailed: strings.settingsConnectionFailed, embeddingTestFailed: strings.settingsEmbeddingTestFailed,
      binaryCheck: strings.settingsBinaryCheck, binaryCreate: strings.settingsBinaryCreate, binaryRemove: strings.settingsBinaryRemove,
      binaryRemoveConfirm: strings.settingsBinaryRemoveConfirm, binaryWorking: strings.settingsBinaryWorking,
      binarySuccess: strings.settingsBinarySuccess, binaryError: strings.settingsBinaryError,
    };
    const descriptors = createPureSettingsAsyncActionDescriptors(actionStrings, {
      analysis: { provider: "mistral", baseUrl: "https://example.invalid", model: "mistral-small-latest", credentialAvailable: true, timeout: "60", actionInProgress: false },
      embeddings: { provider: "ollama", baseUrl: "http://localhost:11434", model: "nomic-embed-text", credentialAvailable: false, timeout: "60", actionInProgress: false },
      binary: { operationInProgress: false, legacyManifest: false },
    });
    expect(Object.keys(descriptors[0].inputs)).toEqual(["provider", "baseUrl", "model", "credentialAvailable", "timeout"]);
    const blueprint = assessDeclarativeSettingsParity(createPureDeclarativeSettingsBlueprint(strings));
    expect(blueprint).toMatchObject({ totalCount: 47, readyCount: 47, unresolvedCount: 0, complete: true });
  });
});
