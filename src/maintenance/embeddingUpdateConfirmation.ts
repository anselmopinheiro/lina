/**
 * Embedding Update Confirmation Model & Preparation (Phase 0.2.2.3)
 *
 * Provides pure confirmation request preparation before executing
 * user-triggered embedding updates.
 *
 * Architectural Invariants:
 * - Pure data preparation; zero network requests, zero worker starts, zero filesystem mutations.
 * - Strict Companion protection: Companion devices return null.
 * - External provider cost transparency: flags hasExternalCost and generates cost warning.
 */

import type { DeviceRole } from "../device/deviceRole";
import type { EmbeddingProviderCapability } from "../ai/providerCapabilities";
import type { EmbeddingPolicyDecision } from "./embeddingPolicyEngine";
import type { UiStrings } from "../i18n/strings";
import type { SemanticSearchImpact } from "./embeddingStatusExplanation";

export type EmbeddingUpdateOrigin =
  | "command"
  | "sidebar"
  | "automatic";

export interface EmbeddingUpdateConfirmationRequest {
  readonly providerId: string;
  readonly modelName?: string;
  readonly isLocal: boolean;
  readonly hasExternalCost: boolean;
  readonly missingCount: number;
  readonly staleCount: number;
  readonly obsoleteCount: number;
  readonly totalToGenerate: number;
  readonly totalChunks: number;
  readonly semanticSearchImpact: SemanticSearchImpact;
  readonly requiresConfirmation: boolean;
  readonly costWarningMessage?: string;
  readonly isFullRebuild: boolean;
}

export interface PrepareEmbeddingUpdateConfirmationOptions {
  readonly state?: {
    readonly totalChunks?: number;
    readonly validCount?: number;
    readonly missingCount?: number;
    readonly staleCount?: number;
    readonly obsoleteCount?: number;
    readonly toGenerateCount?: number;
  };
  readonly providerCapability: EmbeddingProviderCapability;
  readonly policyDecision: EmbeddingPolicyDecision;
  readonly deviceRole: DeviceRole;
  readonly modelName?: string;
  readonly isFullRebuild?: boolean;
  readonly strings: UiStrings;
}

/**
 * Pure preparation function for embedding update confirmation requests.
 * Returns null if no confirmation request is applicable (e.g. Companion device or no work required).
 */
export function prepareEmbeddingUpdateConfirmation(
  options: PrepareEmbeddingUpdateConfirmationOptions,
): EmbeddingUpdateConfirmationRequest | null {
  const {
    state,
    providerCapability,
    policyDecision,
    deviceRole,
    modelName,
    isFullRebuild = false,
    strings,
  } = options;

  // 1. Companion Protection (Strict invariant: Companion devices never generate embeddings)
  if (deviceRole === "companion" || policyDecision.reason === "companion-device-not-allowed") {
    return null;
  }

  const validCount = Math.max(0, state?.validCount ?? 0);
  const missingCount = Math.max(0, state?.missingCount ?? 0);
  const staleCount = Math.max(0, state?.staleCount ?? 0);
  const obsoleteCount = Math.max(0, state?.obsoleteCount ?? 0);
  const totalToGenerate = Math.max(0, state?.toGenerateCount ?? (missingCount + staleCount));
  const totalChunks = Math.max(0, state?.totalChunks ?? (validCount + missingCount + staleCount));

  // 2. Up-to-date Bypass: If there is no work to perform and not a full rebuild, no confirmation is needed
  if (
    !isFullRebuild &&
    totalToGenerate === 0 &&
    missingCount === 0 &&
    staleCount === 0 &&
    policyDecision.reason === "no-update-required"
  ) {
    return null;
  }

  const semanticSearchImpact: SemanticSearchImpact =
    totalToGenerate === 0 && validCount > 0
      ? "complete"
      : validCount > 0
      ? "partial"
      : "unavailable";

  const costWarningMessage = providerCapability.hasExternalCost
    ? strings.confirmEmbeddingUpdateCostWarningText.replace("{provider}", providerCapability.providerId)
    : strings.confirmEmbeddingUpdateLocalNoCost;

  return {
    providerId: providerCapability.providerId,
    modelName: modelName && modelName.trim().length > 0 ? modelName.trim() : undefined,
    isLocal: providerCapability.isLocal,
    hasExternalCost: providerCapability.hasExternalCost,
    missingCount,
    staleCount,
    obsoleteCount,
    totalToGenerate,
    totalChunks,
    semanticSearchImpact,
    requiresConfirmation: policyDecision.requiresConfirmation || providerCapability.hasExternalCost || isFullRebuild,
    costWarningMessage,
    isFullRebuild,
  };
}
