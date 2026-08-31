import {
  getCredentialAvailability,
  type CredentialAvailability,
  type CredentialDomain,
  type CredentialMutationPort,
  type CredentialMutationResult,
  type CredentialRef,
  type CredentialStatusPort,
} from "./pureCredentialModel";
import {
  isPureLocalProviderId,
  shouldShowPureLocalApiKey,
  type PureLocalProviderId,
} from "./pureLocalSettingsModel";
import {
  LINA_SECRET_KEYS,
  deleteSecretValue,
  getSecretValueSync,
  setSecretValue,
  type SecretStorageAdapter,
} from "../device/secretStorage";
import type {
  PureConnectionTestInput,
  PureConnectionTestResult,
  PureConnectionTestRuntimePorts,
} from "./pureSettingsAsyncActions";

export interface CredentialRuntimeDeviceSettings {
  analysisApiKey?: string;
  embeddingsApiKey?: string;
  [key: string]: unknown;
}

/** Structural snapshot of the existing settings fields used by credentials. */
export interface CredentialRuntimeSettingsSnapshot {
  deviceSettingsById?: Record<string, CredentialRuntimeDeviceSettings>;
  aiApiKey?: string;
  embeddingApiKey?: string;
  [key: string]: unknown;
}

export interface CredentialRuntimeStorageBoundary {
  getDeviceId(): string;
  readSettings(): CredentialRuntimeSettingsSnapshot;
  saveSettings(next: CredentialRuntimeSettingsSnapshot): Promise<void>;
  secretStorage?: SecretStorageAdapter;
}

interface RuntimeConnectionInput {
  provider: PureLocalProviderId;
  baseUrl: string;
  model: string;
  timeout: string;
  credential: string | undefined;
}

/** Internal-runtime boundary: the credential is available only while executing the injected request. */
export interface CredentialRuntimeConnectionExecutors {
  testAnalysis(input: RuntimeConnectionInput): Promise<PureConnectionTestResult>;
  testEmbeddings(input: RuntimeConnectionInput): Promise<PureConnectionTestResult>;
}

export interface CredentialRuntimeBridge extends CredentialStatusPort, CredentialMutationPort, Pick<PureConnectionTestRuntimePorts, "testAnalysisConnection" | "testEmbeddingsConnection"> {}

function hasStoredValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function getPresence(
  settings: CredentialRuntimeSettingsSnapshot,
  deviceId: string,
  secretStorage?: SecretStorageAdapter,
) {
  const device = settings.deviceSettingsById?.[deviceId];
  const hasAnalysisSecret = !!getSecretValueSync(secretStorage, LINA_SECRET_KEYS.analysisApiKey);
  const hasEmbeddingsSecret = !!getSecretValueSync(secretStorage, LINA_SECRET_KEYS.embeddingsApiKey);

  return {
    analysisDevice: hasAnalysisSecret || hasStoredValue(device?.analysisApiKey),
    embeddingsDevice: hasEmbeddingsSecret || hasStoredValue(device?.embeddingsApiKey),
    legacyAi: hasStoredValue(settings.aiApiKey),
    legacyEmbedding: hasStoredValue(settings.embeddingApiKey),
  };
}

function resolveCredential(
  settings: CredentialRuntimeSettingsSnapshot,
  ref: CredentialRef,
  provider: PureLocalProviderId,
  secretStorage?: SecretStorageAdapter,
): string | undefined {
  if (!shouldShowPureLocalApiKey(provider)) return undefined;

  const secretKey = ref.domain === "analysis"
    ? LINA_SECRET_KEYS.analysisApiKey
    : LINA_SECRET_KEYS.embeddingsApiKey;

  const directSecret = getSecretValueSync(secretStorage, secretKey);
  if (directSecret) return directSecret;

  if (ref.domain === "embeddings" && provider === "mistral") {
    const analysisSecret = getSecretValueSync(secretStorage, LINA_SECRET_KEYS.analysisApiKey);
    if (analysisSecret) return analysisSecret;
  }

  const device = settings.deviceSettingsById?.[ref.deviceId];
  if (ref.domain === "analysis") {
    return hasStoredValue(device?.analysisApiKey) ? device.analysisApiKey
      : hasStoredValue(settings.aiApiKey) ? settings.aiApiKey
        : undefined;
  }

  if (provider === "mistral") {
    return [device?.embeddingsApiKey, device?.analysisApiKey, settings.embeddingApiKey, settings.aiApiKey]
      .find(hasStoredValue);
  }

  return hasStoredValue(device?.embeddingsApiKey) ? device.embeddingsApiKey
    : hasStoredValue(settings.embeddingApiKey) ? settings.embeddingApiKey
      : undefined;
}

function cloneWithCredential(
  settings: CredentialRuntimeSettingsSnapshot,
  ref: CredentialRef,
  value: string | undefined,
  hasSecretStorage = false,
): CredentialRuntimeSettingsSnapshot {
  const devices = { ...(settings.deviceSettingsById ?? {}) };
  const device = { ...(devices[ref.deviceId] ?? {}) };
  const key = ref.domain === "analysis" ? "analysisApiKey" : "embeddingsApiKey";

  if (hasSecretStorage || value === undefined) {
    delete device[key];
  } else {
    device[key] = value;
  }

  devices[ref.deviceId] = device;
  const next = { ...settings, deviceSettingsById: devices };

  if (hasSecretStorage) {
    if (ref.domain === "analysis" && next.aiApiKey) next.aiApiKey = "";
    if (ref.domain === "embeddings" && next.embeddingApiKey) next.embeddingApiKey = "";
  }

  return next;
}

export function createCredentialRuntimeBridge(
  storage: CredentialRuntimeStorageBoundary,
  executors: CredentialRuntimeConnectionExecutors,
): CredentialRuntimeBridge {
  const activeRefs = new Set<string>();
  let writeQueue: Promise<void> = Promise.resolve();

  const refKey = (ref: CredentialRef): string => `${ref.deviceId}\u0000${ref.domain}`;
  const isCurrentRef = (ref: CredentialRef): boolean => ref.deviceId === storage.getDeviceId();
  const availabilityFor = (ref: CredentialRef, provider: PureLocalProviderId, settings = storage.readSettings()): CredentialAvailability =>
    getCredentialAvailability(ref, provider, getPresence(settings, ref.deviceId, storage.secretStorage));

  const withSerializedWrite = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const previous = writeQueue;
    let release: () => void = () => undefined;
    writeQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const mutate = async (
    ref: CredentialRef,
    operation: "save" | "clear",
    provider: PureLocalProviderId,
    value?: string,
  ): Promise<CredentialMutationResult> => {
    const key = refKey(ref);
    if (!isCurrentRef(ref) || activeRefs.has(key)) {
      return { ok: false, error: operation === "save" ? "save-failed" : "clear-failed" };
    }
    activeRefs.add(key);
    try {
      return await withSerializedWrite(async () => {
        const secretKey = ref.domain === "analysis"
          ? LINA_SECRET_KEYS.analysisApiKey
          : LINA_SECRET_KEYS.embeddingsApiKey;

        if (storage.secretStorage) {
          if (operation === "save" && value) {
            await setSecretValue(storage.secretStorage, secretKey, value);
          } else {
            await deleteSecretValue(storage.secretStorage, secretKey);
          }
        }

        const settings = storage.readSettings();
        const next = cloneWithCredential(settings, ref, value, !!storage.secretStorage);
        try {
          await storage.saveSettings(next);
        } catch {
          return { ok: false, error: operation === "save" ? "save-failed" : "clear-failed" };
        }
        return { ok: true, available: availabilityFor(ref, provider, next).available };
      });
    } finally {
      activeRefs.delete(key);
    }
  };

  const runConnection = async (
    domain: CredentialDomain,
    input: PureConnectionTestInput,
  ): Promise<PureConnectionTestResult> => {
    if (!isPureLocalProviderId(input.provider)) {
      return { outcome: "failed", messageKey: "connection-failed" };
    }
    const provider = input.provider;
    const ref: CredentialRef = { deviceId: storage.getDeviceId(), domain };
    const settings = storage.readSettings();
    const availability = availabilityFor(ref, provider, settings);
    if (availability.required && !availability.available) {
      return {
        outcome: "failed",
        messageKey: domain === "analysis" ? "analysis-api-key-missing" : "embeddings-api-key-missing",
      };
    }

    const executorInput: RuntimeConnectionInput = {
      provider,
      baseUrl: input.baseUrl,
      model: input.model,
      timeout: input.timeout,
      credential: resolveCredential(settings, ref, provider, storage.secretStorage),
    };
    try {
      return domain === "analysis"
        ? await executors.testAnalysis(executorInput)
        : await executors.testEmbeddings(executorInput);
    } catch {
      return { outcome: "failed", messageKey: "connection-failed" };
    }
  };

  return {
    getAvailability(ref, provider) {
      return availabilityFor(ref, provider);
    },
    async save(ref, value, provider = "mistral") {
      const normalized = value.trim();
      if (!normalized) return { ok: false, error: "save-failed" };
      return mutate(ref, "save", provider, normalized);
    },
    async clear(ref, provider = "mistral") {
      return mutate(ref, "clear", provider);
    },
    testAnalysisConnection(input) {
      return runConnection("analysis", input);
    },
    testEmbeddingsConnection(input) {
      return runConnection("embeddings", input);
    },
  };
}
