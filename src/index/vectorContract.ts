/**
 * Canonical Vector Contract and Companion Inheritance (Phase 0.3.x — LINA-03-005)
 *
 * Formalizes the vector space identity contract for embeddings, enabling deterministic
 * verification of compatibility between published embeddings, query embeddings, and binary
 * copies, while guaranteeing that Companion devices inherit the Producer's vector contract.
 */

import { sha256Hex } from "./exclusionPolicy";

export const VECTOR_CONTRACT_SCHEMA_VERSION = 1;
export const VECTOR_CONTRACT_METRIC = "cosine" as const;
export const VECTOR_CONTRACT_ID_PREFIX = "vec:";

export interface VectorContractV1 {
  readonly schemaVersion: 1;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly metric: "cosine";
  readonly prefixMode: string;
  readonly inputVersion: number;
  readonly contractId: string;
}

export interface VectorContractInput {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly metric?: "cosine";
  readonly prefixMode: string;
  readonly inputVersion: number;
}

export type VectorContractCompatibilityStatus = "compatible" | "mismatch" | "unknown";

export interface VectorContractCompatibility {
  readonly status: VectorContractCompatibilityStatus;
  readonly targetContract?: VectorContractV1 | null;
  readonly candidateContract?: VectorContractV1 | null;
  readonly reason?: string;
}

export interface EffectiveEmbeddingRuntimeConfig {
  readonly isAvailable: boolean;
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly dimensions: number;
  readonly metric: "cosine";
  readonly prefixMode: string;
  readonly inputVersion: number;
  readonly contract: VectorContractV1 | null;
  readonly unavailabilityReason?: string;
  readonly inheritedFromProducer: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Computes a deterministic, collision-resistant identifier for a vector space specification.
 * Based strictly and exclusively on:
 * - provider
 * - model
 * - dimensions
 * - metric ("cosine")
 * - prefixMode
 * - inputVersion
 *
 * Never includes timestamps, device IDs, publication IDs, endpoints, or credentials.
 */
export function computeVectorContractId(input: VectorContractInput): string {
  const provider = normalizeString(input.provider);
  const model = normalizeString(input.model);
  const prefixMode = normalizeString(input.prefixMode);
  const dimensions = input.dimensions;
  const inputVersion = input.inputVersion;
  const metric = VECTOR_CONTRACT_METRIC;

  if (
    provider.length === 0 ||
    model.length === 0 ||
    !Number.isInteger(dimensions) ||
    dimensions <= 0 ||
    !Number.isInteger(inputVersion) ||
    inputVersion <= 0 ||
    prefixMode.length === 0
  ) {
    throw new Error("Invalid parameters for VectorContractId computation.");
  }

  const canonicalPayload = JSON.stringify({
    dimensions,
    inputVersion,
    metric,
    model,
    prefixMode,
    provider,
  });

  return `${VECTOR_CONTRACT_ID_PREFIX}${sha256Hex(canonicalPayload)}`;
}

/**
 * Creates an immutable VectorContractV1 instance.
 */
export function createVectorContract(input: VectorContractInput): VectorContractV1 {
  const provider = normalizeString(input.provider);
  const model = normalizeString(input.model);
  const prefixMode = normalizeString(input.prefixMode);
  const dimensions = input.dimensions;
  const inputVersion = input.inputVersion;
  const metric = VECTOR_CONTRACT_METRIC;

  const contractId = computeVectorContractId({
    provider,
    model,
    dimensions,
    metric,
    prefixMode,
    inputVersion,
  });

  return Object.freeze({
    schemaVersion: 1,
    provider,
    model,
    dimensions,
    metric,
    prefixMode,
    inputVersion,
    contractId,
  });
}

/**
 * Validates if an unknown object strictly satisfies the VectorContractV1 specification.
 */
export function isValidVectorContract(value: unknown): value is VectorContractV1 {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== VECTOR_CONTRACT_SCHEMA_VERSION) return false;
  if (typeof value.provider !== "string" || value.provider.trim().length === 0) return false;
  if (typeof value.model !== "string" || value.model.trim().length === 0) return false;
  if (typeof value.dimensions !== "number" || !Number.isInteger(value.dimensions) || value.dimensions <= 0) return false;
  if (value.metric !== VECTOR_CONTRACT_METRIC) return false;
  if (typeof value.prefixMode !== "string" || value.prefixMode.trim().length === 0) return false;
  if (typeof value.inputVersion !== "number" || !Number.isInteger(value.inputVersion) || value.inputVersion <= 0) return false;
  if (typeof value.contractId !== "string" || !value.contractId.startsWith(VECTOR_CONTRACT_ID_PREFIX)) return false;

  try {
    const expectedId = computeVectorContractId({
      provider: value.provider,
      model: value.model,
      dimensions: value.dimensions,
      metric: "cosine",
      prefixMode: value.prefixMode,
      inputVersion: value.inputVersion,
    });
    return value.contractId === expectedId;
  } catch {
    return false;
  }
}

/**
 * Safely extracts a VectorContractV1 from a manifest or embedding descriptor.
 * If only partial legacy fields exist without a full contract, returns null.
 */
export function extractVectorContract(source: unknown): VectorContractV1 | null {
  if (!isRecord(source)) return null;

  // Direct vectorContract field
  if (isValidVectorContract(source.vectorContract)) {
    return source.vectorContract;
  }

  // Nested in embeddings
  if (isRecord(source.embeddings) && isValidVectorContract(source.embeddings.vectorContract)) {
    return source.embeddings.vectorContract;
  }

  // Synthesize from full manifest fields if all components are present and valid
  const embeddings = isRecord(source.embeddings) ? source.embeddings : source;
  const input = isRecord(source.embeddingInput) ? source.embeddingInput : {};

  const provider = typeof embeddings.provider === "string" ? embeddings.provider : undefined;
  const model = typeof embeddings.model === "string" ? embeddings.model : undefined;
  const dimensions = typeof embeddings.dimensions === "number" ? embeddings.dimensions : undefined;
  const prefixMode = typeof input.prefixMode === "string" ? input.prefixMode : (typeof embeddings.prefixMode === "string" ? embeddings.prefixMode : undefined);
  const inputVersion = typeof input.version === "number" ? input.version : (typeof embeddings.inputVersion === "number" ? embeddings.inputVersion : undefined);

  if (
    provider &&
    model &&
    dimensions &&
    dimensions > 0 &&
    prefixMode &&
    inputVersion &&
    inputVersion > 0
  ) {
    try {
      return createVectorContract({
        provider,
        model,
        dimensions,
        metric: "cosine",
        prefixMode,
        inputVersion,
      });
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Evaluates compatibility between two vector contracts (or contract sources).
 *
 * Rules:
 * - compatible: Both contracts exist, are valid, and have identical vector contract identity.
 * - mismatch: Both contracts exist but differ in provider, model, dimensions, metric, prefixMode, or inputVersion.
 * - unknown: One or both contracts are absent, incomplete, or legacy (cannot prove compatibility).
 */
export function evaluateVectorContractCompatibility(
  target: VectorContractV1 | Record<string, unknown> | null | undefined,
  candidate: VectorContractV1 | Record<string, unknown> | null | undefined
): VectorContractCompatibility {
  const targetMetric = isRecord(target) && typeof target.metric === "string" ? target.metric : undefined;
  const candidateMetric = isRecord(candidate) && typeof candidate.metric === "string" ? candidate.metric : undefined;

  if (targetMetric && candidateMetric && targetMetric !== candidateMetric) {
    return {
      status: "mismatch",
      reason: `metric-mismatch (${targetMetric} vs ${candidateMetric})`,
    };
  }

  const targetContract = isValidVectorContract(target) ? target : extractVectorContract(target);
  const candidateContract = isValidVectorContract(candidate) ? candidate : extractVectorContract(candidate);

  if (!targetContract || !candidateContract) {
    return {
      status: "unknown",
      targetContract: targetContract ?? null,
      candidateContract: candidateContract ?? null,
      reason: "One or both vector contracts are missing, incomplete, or legacy.",
    };
  }

  if (targetContract.contractId === candidateContract.contractId) {
    return {
      status: "compatible",
      targetContract,
      candidateContract,
    };
  }

  // Identify specific mismatch reason
  const reasons: string[] = [];
  if (targetContract.provider !== candidateContract.provider) {
    reasons.push(`provider-mismatch (${targetContract.provider} vs ${candidateContract.provider})`);
  }
  if (targetContract.model !== candidateContract.model) {
    reasons.push(`model-mismatch (${targetContract.model} vs ${candidateContract.model})`);
  }
  if (targetContract.dimensions !== candidateContract.dimensions) {
    reasons.push(`dimensions-mismatch (${targetContract.dimensions} vs ${candidateContract.dimensions})`);
  }
  if (targetContract.metric !== candidateContract.metric) {
    reasons.push(`metric-mismatch (${String(targetContract.metric)} vs ${String(candidateContract.metric)})`);
  }
  if (targetContract.prefixMode !== candidateContract.prefixMode) {
    reasons.push(`prefix-mode-mismatch (${targetContract.prefixMode} vs ${candidateContract.prefixMode})`);
  }
  if (targetContract.inputVersion !== candidateContract.inputVersion) {
    reasons.push(`input-version-mismatch (${targetContract.inputVersion} vs ${candidateContract.inputVersion})`);
  }

  return {
    status: "mismatch",
    targetContract,
    candidateContract,
    reason: reasons.length > 0 ? reasons.join("; ") : "Vector contract identity mismatch.",
  };
}

/**
 * Resolves the effective local embedding runtime configuration for semantic querying.
 *
 * In Companion role:
 * - Vector identity (provider, model, dimensions, prefixMode, inputVersion) is inherited from the Producer's contract.
 * - Endpoint (baseUrl) and credentials (apiKey) are resolved from the local device's settings/secrets.
 * - Programmatic override of provider/model is not allowed.
 * - If the inherited provider is missing or cannot be satisfied locally, semantic search is marked unavailable.
 *
 * In Producer role:
 * - Vector identity and endpoint are resolved from local producer settings.
 */
export function resolveEffectiveEmbeddingRuntimeConfig(input: {
  role?: string;
  canonicalManifest?: unknown;
  localSettings?: {
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
  };
  localSecretKey?: string;
}): EffectiveEmbeddingRuntimeConfig {
  const isCompanion = input.role === "companion";
  const canonicalContract = extractVectorContract(input.canonicalManifest);

  if (isCompanion) {
    if (!canonicalContract) {
      return {
        isAvailable: false,
        provider: "",
        model: "",
        baseUrl: input.localSettings?.baseUrl ?? "",
        apiKey: input.localSecretKey ?? input.localSettings?.apiKey ?? "",
        dimensions: 0,
        metric: "cosine",
        prefixMode: "none",
        inputVersion: 1,
        contract: null,
        unavailabilityReason: "No canonical vector contract found in published manifest.",
        inheritedFromProducer: true,
      };
    }

    const effectiveApiKey = input.localSecretKey ?? input.localSettings?.apiKey ?? "";
    const effectiveBaseUrl = input.localSettings?.baseUrl ?? "";

    return {
      isAvailable: true,
      provider: canonicalContract.provider,
      model: canonicalContract.model,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      dimensions: canonicalContract.dimensions,
      metric: canonicalContract.metric,
      prefixMode: canonicalContract.prefixMode,
      inputVersion: canonicalContract.inputVersion,
      contract: canonicalContract,
      inheritedFromProducer: true,
    };
  }

  // Producer role: uses local settings
  const provider = normalizeString(input.localSettings?.provider ?? "");
  const model = normalizeString(input.localSettings?.model ?? "");
  const dimensions = canonicalContract ? canonicalContract.dimensions : 0;
  const prefixMode = canonicalContract ? canonicalContract.prefixMode : "none";
  const inputVersion = canonicalContract ? canonicalContract.inputVersion : 1;
  const effectiveBaseUrl = input.localSettings?.baseUrl ?? "";
  const effectiveApiKey = input.localSecretKey ?? input.localSettings?.apiKey ?? "";

  return {
    isAvailable: Boolean(provider && model),
    provider,
    model,
    baseUrl: effectiveBaseUrl,
    apiKey: effectiveApiKey,
    dimensions,
    metric: "cosine",
    prefixMode,
    inputVersion,
    contract: canonicalContract,
    inheritedFromProducer: false,
  };
}
