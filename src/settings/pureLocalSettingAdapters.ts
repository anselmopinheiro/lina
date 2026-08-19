import {
  getPureLocalModelOptions,
  getPureLocalProviderMetadata,
  getPureLocalProviderOptions,
  isPureLocalModelManual,
  normalizePureLocalEmbeddingBatchSize,
  normalizePureLocalTimeout,
  resolvePureLocalProviderDefaults,
  shouldShowPureLocalApiKey,
  shouldShowPureLocalBaseUrl,
  shouldShowPureLocalManualModel,
  shouldShowPureLocalModelCatalog,
  type PureLocalEmbeddingStoragePreference,
  type PureLocalProviderDomain,
} from "./pureLocalSettingsModel";
import type { CredentialAvailability } from "./pureCredentialModel";

export type LocalSettingSaveStrategy = "device-local" | "global" | "no-save" | "async-action";
export type LocalSettingEffect =
  | { type: "set-default-base-url"; value: string }
  | { type: "set-default-model"; value: string }
  | { type: "refresh-model-options" }
  | { type: "refresh-embedding-configuration-state" }
  | { type: "invalidate-runtime-embedding-index" }
  | { type: "rerender-settings" };

export interface PureLocalAdapterStrings {
  provider: string;
  model: string;
  manualModel: string;
  manualModelDescription: string;
  timeout: string;
  timeoutDescription: string;
  batchSize: string;
  batchSizeDescription: string;
  storagePreference: string;
  storagePreferenceDescription: string;
  preferBinary: string;
  maintainBinaryCopy: string;
  maintainBinaryCopyDescription: string;
  credential: string;
  credentialDescription: string;
  credentialPlaceholder: string;
  credentialSavedPlaceholder: string;
}

export interface PureProviderAdapterInput {
  provider: string;
  currentModel: string;
  currentBaseUrl: string;
  strings: Pick<PureLocalAdapterStrings, "provider">;
}

export interface PureModelAdapterInput {
  provider: string;
  currentModel: string;
  strings: Pick<PureLocalAdapterStrings, "model" | "manualModel" | "manualModelDescription">;
  placeholder: string;
}

function providerEffects(domain: PureLocalProviderDomain): LocalSettingEffect[] {
  const effects: LocalSettingEffect[] = [];
  effects.push({ type: "refresh-model-options" }, { type: "rerender-settings" });
  return effects;
}

export function createPureProviderAdapter(domain: PureLocalProviderDomain, input: PureProviderAdapterInput) {
  const metadata = getPureLocalProviderMetadata(input.provider);
  const defaults = resolvePureLocalProviderDefaults(input.provider, domain);
  return {
    key: domain === "analysis" ? "analysisProvider" : "embeddingsProvider",
    name: input.strings.provider,
    value: input.provider,
    options: getPureLocalProviderOptions(domain),
    isLocal: metadata?.isLocal ?? false,
    usesBaseUrl: shouldShowPureLocalBaseUrl(input.provider),
    requiresCredential: shouldShowPureLocalApiKey(input.provider),
    showModelCatalog: shouldShowPureLocalModelCatalog(input.provider),
    allowManualModel: shouldShowPureLocalManualModel(input.provider),
    defaults,
    currentModel: input.currentModel,
    currentBaseUrl: input.currentBaseUrl,
    declaredEffects: providerEffects(domain),
    saveStrategy: "device-local" as const,
    requiresFutureUpdate: true,
  };
}

export function createPureModelAdapter(domain: PureLocalProviderDomain, input: PureModelAdapterInput) {
  const options = getPureLocalModelOptions(input.provider, domain);
  const showCatalog = shouldShowPureLocalModelCatalog(input.provider);
  const isManualValue = isPureLocalModelManual(input.provider, domain, input.currentModel);
  return {
    key: domain === "analysis" ? "analysisModel" : "embeddingsModel",
    name: input.strings.model,
    value: input.currentModel,
    catalog: options,
    selectedCatalogValue: options.some((option) => option.value === input.currentModel) ? input.currentModel : undefined,
    isManualValue,
    controlType: showCatalog ? "dropdown" as const : "text" as const,
    showCatalog,
    showManualControl: (!showCatalog || isManualValue) && shouldShowPureLocalManualModel(input.provider),
    manualControl: { name: input.strings.manualModel, desc: input.strings.manualModelDescription, placeholder: input.placeholder },
    preservesTwoControls: false,
    saveStrategy: "device-local" as const,
    declaredEffects: [] as LocalSettingEffect[],
    requiresFutureRender: true,
  };
}

export function createPureCredentialAdapter(
  provider: string,
  strings: Pick<PureLocalAdapterStrings, "credential" | "credentialDescription" | "credentialPlaceholder" | "credentialSavedPlaceholder">,
  availability?: CredentialAvailability,
) {
  const required = shouldShowPureLocalApiKey(provider);
  const safeAvailability: CredentialAvailability = {
    required,
    available: required && availability?.available === true,
  };
  return {
    isVisible: required, isRequired: required, isPassword: true,
    name: strings.credential, desc: strings.credentialDescription,
    placeholderWhenUnset: strings.credentialPlaceholder, placeholderWhenPresent: strings.credentialSavedPlaceholder,
    valueExposurePolicy: "do-not-expose" as const, indexingPolicy: "do-not-index" as const,
    saveStrategy: "device-local" as const, acceptsCredentialValue: false, availability: safeAvailability,
  };
}

export function createPureNumericAdapter(kind: "analysis-timeout" | "embeddings-timeout" | "embedding-batch-size", value: string, strings: Pick<PureLocalAdapterStrings, "timeout" | "timeoutDescription" | "batchSize" | "batchSizeDescription">) {
  const isBatch = kind === "embedding-batch-size";
  return {
    key: kind, value, name: isBatch ? strings.batchSize : strings.timeout, desc: isBatch ? strings.batchSizeDescription : strings.timeoutDescription,
    min: isBatch ? 1 : 10, max: isBatch ? 50 : 300, step: 1, fallback: isBatch ? "10" : "60",
    saveStrategy: "device-local" as const, commitStrategy: "normalize-on-change" as const,
    declaredEffects: [] as LocalSettingEffect[], requiresFutureUpdate: false,
  };
}

export const normalizePureLocalNumericValue = (kind: "analysis-timeout" | "embeddings-timeout" | "embedding-batch-size", value: string): string =>
  kind === "embedding-batch-size" ? normalizePureLocalEmbeddingBatchSize(value) : normalizePureLocalTimeout(value);

export function createPureBinaryPreferenceAdapter(value: PureLocalEmbeddingStoragePreference, strings: Pick<PureLocalAdapterStrings, "storagePreference" | "storagePreferenceDescription" | "preferBinary">) {
  return {
    key: "embeddingStorageReadPreference", value, name: strings.storagePreference, desc: strings.storagePreferenceDescription,
    options: [{ value: "jsonl", label: "JSONL" }, { value: "prefer-binary", label: strings.preferBinary }],
    saveStrategy: "device-local" as const,
    declaredEffects: [{ type: "invalidate-runtime-embedding-index" }, { type: "rerender-settings" }] satisfies LocalSettingEffect[],
    requiresFutureUpdate: true, unresolvedRuntimeInputs: ["embedding-read-diagnostic"] as const,
  };
}

export function createPureBinaryMaintenanceAdapter(value: boolean, strings: Pick<PureLocalAdapterStrings, "maintainBinaryCopy" | "maintainBinaryCopyDescription">) {
  return {
    key: "maintainBinaryEmbeddingCopy", value, name: strings.maintainBinaryCopy, desc: strings.maintainBinaryCopyDescription,
    controlType: "toggle" as const, isVisible: true, disabled: false, saveStrategy: "device-local" as const,
    declaredEffects: [{ type: "rerender-settings" }] satisfies LocalSettingEffect[], requiresFutureUpdate: true,
    unresolvedRuntimeInputs: ["embedding-operation-state", "canonical-publication-state"] as const,
  };
}
