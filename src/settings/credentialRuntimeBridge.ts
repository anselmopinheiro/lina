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

function getPresence(settings: CredentialRuntimeSettingsSnapshot, deviceId: string) {
  const device = settings.deviceSettingsById?.[deviceId];
  return {
    analysisDevice: hasStoredValue(device?.analysisApiKey),
    embeddingsDevice: hasStoredValue(device?.embeddingsApiKey),
    legacyAi: hasStoredValue(settings.aiApiKey),
    legacyEmbedding: hasStoredValue(settings.embeddingApiKey),
  };
}

function resolveCredential(
  settings: CredentialRuntimeSettingsSnapshot,
  ref: CredentialRef,
  provider: PureLocalProviderId,
): string | undefined {
  if (!shouldShowPureLocalApiKey(provider)) return undefined;

  const device = settings.deviceSettingsById?.[ref.deviceId];
  if (ref.domain === "analysis") {
    return hasStoredValue(device?.analysisApiKey) ? device.analysisApiKey : undefined;
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
): CredentialRuntimeSettingsSnapshot {
  const devices = { ...(settings.deviceSettingsById ?? {}) };
  const device = { ...(devices[ref.deviceId] ?? {}) };
  const key = ref.domain === "analysis" ? "analysisApiKey" : "embeddingsApiKey";
  if (value === undefined) {
    delete device[key];
  } else {
    device[key] = value;
  }
  devices[ref.deviceId] = device;
  return { ...settings, deviceSettingsById: devices };
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
    getCredentialAvailability(ref, provider, getPresence(settings, ref.deviceId));

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
        const settings = storage.readSettings();
        const next = cloneWithCredential(settings, ref, value);
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
      credential: resolveCredential(settings, ref, provider),
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
