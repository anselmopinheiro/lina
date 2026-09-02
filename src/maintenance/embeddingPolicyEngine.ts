/**
 * Embedding Policy Engine (Phase 0.2.2.1)
 *
 * Pure decision engine that determines whether embedding updates are allowed,
 * require confirmation, or must be blocked based on:
 * - Provider capability (isLocal, hasExternalCost)
 * - User policy ("manual" | "automatic-local-only")
 * - Device role ("producer" | "companion")
 * - Embedding state (hasPendingWork)
 *
 * Core Architectural Invariant: "Never silently consume external API resources."
 */

import type { DeviceRole } from "../device/deviceRole";
import type { EmbeddingProviderCapability } from "../ai/providerCapabilities";

export type EmbeddingUpdatePolicy =
  | "manual"
  | "automatic-local-only";

export type EmbeddingPolicyDecisionReason =
  | "manual-confirmation-required"
  | "local-provider-auto-approved"
  | "external-provider-blocked"
  | "companion-device-not-allowed"
  | "no-update-required";

export interface EmbeddingPolicyDecision {
  readonly allowed: boolean;
  readonly requiresConfirmation: boolean;
  readonly reason: EmbeddingPolicyDecisionReason;
}

export interface EmbeddingPolicyStateInput {
  readonly hasPendingWork?: boolean;
  readonly missingCount?: number;
  readonly staleCount?: number;
  readonly obsoleteCount?: number;
  readonly toGenerateCount?: number;
}

export interface EvaluateEmbeddingUpdatePolicyOptions {
  readonly embeddingState: EmbeddingPolicyStateInput | boolean;
  readonly providerCapability: EmbeddingProviderCapability;
  readonly policy: EmbeddingUpdatePolicy;
  readonly deviceRole: DeviceRole;
}

/**
 * Evaluates whether an embedding update can proceed automatically or requires confirmation.
 *
 * Evaluation Rules (in strict priority order):
 * 1. Companion Device:
 *    - If deviceRole === "companion" -> { allowed: false, requiresConfirmation: false, reason: "companion-device-not-allowed" }
 * 2. No Pending Work:
 *    - If !hasPendingWork -> { allowed: false, requiresConfirmation: false, reason: "no-update-required" }
 * 3. Local Provider + Automatic Local Policy:
 *    - If providerCapability.isLocal && !providerCapability.hasExternalCost && policy === "automatic-local-only"
 *      -> { allowed: true, requiresConfirmation: false, reason: "local-provider-auto-approved" }
 * 4. External Provider + Automatic Attempt:
 *    - If (!providerCapability.isLocal || providerCapability.hasExternalCost) && policy === "automatic-local-only"
 *      -> { allowed: false, requiresConfirmation: true, reason: "external-provider-blocked" }
 * 5. Manual Policy (default fallback for both local and external):
 *    - If policy === "manual"
 *      -> { allowed: false, requiresConfirmation: true, reason: "manual-confirmation-required" }
 */
export function evaluateEmbeddingUpdatePolicy(
  options: EvaluateEmbeddingUpdatePolicyOptions,
): EmbeddingPolicyDecision {
  const { deviceRole, policy, providerCapability } = options;
  const hasPendingWork = typeof options.embeddingState === "boolean"
    ? options.embeddingState
    : (options.embeddingState.hasPendingWork ?? (
        (options.embeddingState.missingCount ?? 0) > 0 ||
        (options.embeddingState.staleCount ?? 0) > 0 ||
        (options.embeddingState.toGenerateCount ?? 0) > 0
      ));

  // 1. Companion check (Strict invariant: Companion devices never generate embeddings)
  if (deviceRole === "companion") {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "companion-device-not-allowed",
    };
  }

  // 2. Work availability check
  if (!hasPendingWork) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "no-update-required",
    };
  }

  // 3. Local provider under automatic-local-only policy
  if (providerCapability.isLocal && !providerCapability.hasExternalCost && policy === "automatic-local-only") {
    return {
      allowed: true,
      requiresConfirmation: false,
      reason: "local-provider-auto-approved",
    };
  }

  // 4. External provider attempting automatic execution
  if ((!providerCapability.isLocal || providerCapability.hasExternalCost) && policy === "automatic-local-only") {
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "external-provider-blocked",
    };
  }

  // 5. Manual policy (default)
  return {
    allowed: false,
    requiresConfirmation: true,
    reason: "manual-confirmation-required",
  };
}
