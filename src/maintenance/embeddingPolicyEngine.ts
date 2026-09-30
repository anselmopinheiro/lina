/**
 * Embedding Policy Engine (Phase LINA-14D.2-B)
 *
 * Pure decision engine that determines whether embedding updates are allowed,
 * require confirmation, or must be blocked based on the canonical
 * `EmbeddingLifecycleSnapshot` and `deriveEmbeddingWritePathDecision()`.
 *
 * Core Architectural Invariants:
 * 1. Single source of truth: Decisions derive strictly from `deriveEmbeddingWritePathDecision(snapshot)`.
 * 2. Strict Companion & Standby protection: Devices without active write authority never execute or schedule.
 * 3. Never silently consume external API resources (external providers always require confirmation).
 * 4. Indeterminate states are never converted into silent idle / no-work states.
 * 5. Rebuild operations always require explicit confirmation.
 */

import type { DeviceRole } from "../device/deviceRole";
import type { EmbeddingProviderCapability } from "../ai/providerCapabilities";
import type { EmbeddingUpdateMode } from "./embeddingUpdateSettings";
import { type EmbeddingLifecycleSnapshot } from "../index/embeddingLifecycleModel";
import { adaptCurrentStateToLifecycleSnapshot } from "../index/embeddingLifecycleAdapter";
import {
  type EmbeddingWritePathDecision,
  type EmbeddingWriteAction,
  deriveEmbeddingWritePathDecision,
} from "../index/embeddingLifecycleWritePath";
import { type DeviceRuntimeState } from "../device/deviceRuntimeState";

export type { EmbeddingUpdateMode } from "./embeddingUpdateSettings";
export type EmbeddingUpdatePolicy = EmbeddingUpdateMode;

export type EmbeddingPolicyDecisionReason =
  | "manual-confirmation-required"
  | "local-provider-auto-approved"
  | "external-provider-blocked"
  | "companion-device-not-allowed"
  | "standby-device-not-allowed"
  | "indeterminate-state-blocked"
  | "rebuild-confirmation-required"
  | "no-update-required";

export interface EmbeddingPolicyDecision {
  readonly allowed: boolean;
  readonly requiresConfirmation: boolean;
  readonly reason: EmbeddingPolicyDecisionReason;
  readonly action?: EmbeddingWriteAction;
  readonly decision?: EmbeddingWritePathDecision;
}

export interface EmbeddingPolicyStateInput {
  readonly hasPendingWork?: boolean;
  readonly missingCount?: number;
  readonly staleCount?: number;
  readonly obsoleteCount?: number;
  readonly toGenerateCount?: number;
}

export interface EvaluateEmbeddingUpdatePolicyOptions {
  readonly embeddingState?: EmbeddingPolicyStateInput | boolean;
  readonly providerCapability?: EmbeddingProviderCapability;
  readonly policy?: EmbeddingUpdatePolicy;
  readonly deviceRole?: DeviceRole;
  readonly lifecycleSnapshot?: EmbeddingLifecycleSnapshot;
  readonly decision?: EmbeddingWritePathDecision;
}

/**
 * Pure evaluation function deriving policy decisions directly from an `EmbeddingLifecycleSnapshot`.
 */
export function evaluateEmbeddingUpdatePolicyFromSnapshot(
  snapshot: EmbeddingLifecycleSnapshot,
  policy: EmbeddingUpdatePolicy = "manual"
): EmbeddingPolicyDecision {
  const decision = deriveEmbeddingWritePathDecision(snapshot);

  // 1. Companion Protection
  if (!decision.applicable && decision.blockedReason === "companion") {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "companion-device-not-allowed",
      action: "none",
      decision,
    };
  }

  // 2. Standby / Unassigned / Authority Loss
  if (!decision.applicable && decision.blockedReason === "standby") {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "standby-device-not-allowed",
      action: "none",
      decision,
    };
  }

  if (!decision.applicable && decision.blockedReason === "embeddings-disabled") {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "no-update-required",
      action: "none",
      decision,
    };
  }

  if (!decision.applicable && !decision.canExecute) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "no-update-required",
      action: "none",
      decision,
    };
  }

  // 3. Indeterminate state
  if (decision.primary === "INDETERMINATE" || decision.workKind === "indeterminate") {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "indeterminate-state-blocked",
      action: "none",
      decision,
    };
  }

  // 4. No pending work / action none
  if (decision.action === "none" || (!decision.updateRequired && decision.action !== "retry")) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "no-update-required",
      action: "none",
      decision,
    };
  }

  // 5. Action is executable (generate | update | rebuild | retry)
  if (policy === "automatic-local-only") {
    if (decision.cost === "local" && !decision.requiresConfirmation && decision.action !== "rebuild") {
      return {
        allowed: true,
        requiresConfirmation: false,
        reason: "local-provider-auto-approved",
        action: decision.action,
        decision,
      };
    }

    if (decision.action === "rebuild" || decision.requiresConfirmation) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: decision.action === "rebuild" ? "rebuild-confirmation-required" : (decision.cost === "external" ? "external-provider-blocked" : "manual-confirmation-required"),
        action: decision.action,
        decision,
      };
    }

    return {
      allowed: false,
      requiresConfirmation: true,
      reason: decision.cost === "external" ? "external-provider-blocked" : "manual-confirmation-required",
      action: decision.action,
      decision,
    };
  }

  // 6. Manual policy (default)
  return {
    allowed: false,
    requiresConfirmation: true,
    reason: "manual-confirmation-required",
    action: decision.action,
    decision,
  };
}

/**
 * Legacy evaluation logic preserved exclusively for shadow parity verification.
 */
export function evaluateLegacyEmbeddingUpdatePolicy(
  options: EvaluateEmbeddingUpdatePolicyOptions,
): EmbeddingPolicyDecision {
  const { deviceRole = "producer", policy = "manual", providerCapability } = options;
  const hasPendingWork = typeof options.embeddingState === "boolean"
    ? options.embeddingState
    : options.embeddingState
    ? (options.embeddingState.hasPendingWork ?? (
        (options.embeddingState.missingCount ?? 0) > 0 ||
        (options.embeddingState.staleCount ?? 0) > 0 ||
        (options.embeddingState.toGenerateCount ?? 0) > 0
      ))
    : false;

  if (deviceRole === "companion") {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "companion-device-not-allowed",
    };
  }

  if (!hasPendingWork) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "no-update-required",
    };
  }

  if (providerCapability && providerCapability.isLocal && !providerCapability.hasExternalCost && policy === "automatic-local-only") {
    return {
      allowed: true,
      requiresConfirmation: false,
      reason: "local-provider-auto-approved",
    };
  }

  if (providerCapability && (!providerCapability.isLocal || providerCapability.hasExternalCost) && policy === "automatic-local-only") {
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "external-provider-blocked",
    };
  }

  return {
    allowed: false,
    requiresConfirmation: true,
    reason: "manual-confirmation-required",
  };
}

/**
 * Evaluates whether an embedding update can proceed automatically or requires confirmation.
 * Delegates canonical decision making to `EmbeddingLifecycleSnapshot`.
 */
export function evaluateEmbeddingUpdatePolicy(
  options: EvaluateEmbeddingUpdatePolicyOptions,
): EmbeddingPolicyDecision {
  if (options.lifecycleSnapshot) {
    return evaluateEmbeddingUpdatePolicyFromSnapshot(options.lifecycleSnapshot, options.policy);
  }

  const { deviceRole = "producer", policy = "manual", providerCapability } = options;

  if (deviceRole === "companion") {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: "companion-device-not-allowed",
    };
  }

  const hasPendingWork = typeof options.embeddingState === "boolean"
    ? options.embeddingState
    : options.embeddingState
    ? (options.embeddingState.hasPendingWork ?? (
        (options.embeddingState.missingCount ?? 0) > 0 ||
        (options.embeddingState.staleCount ?? 0) > 0 ||
        (options.embeddingState.toGenerateCount ?? 0) > 0
      ))
    : false;

  const isExternal = providerCapability ? (!providerCapability.isLocal || providerCapability.hasExternalCost) : false;

  const defaultRuntime: DeviceRuntimeState = {
    deviceId: "local-device",
    effectiveRole: deviceRole,
    isActiveProducer: deviceRole === "producer",
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isStandbyProducer: false,
    isCompanion: false,
    isUnassigned: false,
    canPublish: true,
    canTransferOwnership: false,
    transferEligibilityReason: "ready",
    embeddings: {
      configured: true,
      textIndexAvailable: true,
      embeddingsDeclared: true,
      exists: true,
      vectorFileState: "available",
      provenance: { stale: false },
      compatibility: { compatible: true },
      contractState: "compatible",
      readiness: { loaded: true, runtimeReady: true },
      runtimeState: "ready",
      semanticAvailable: true,
      effectiveMode: "full",
    },
  };

  const snapshot = adaptCurrentStateToLifecycleSnapshot({
    deviceRuntimeState: defaultRuntime,
    isExternalProvider: isExternal,
    canonicalExists: true,
    upstreamTextIndex: "ready",
    validForSearchCount: 10,
    updatePlan: {
      mode: "incremental",
      totalChunks: 10,
      missingCount: hasPendingWork ? 1 : 0,
      staleToReplaceCount: 0,
      obsoleteToDropCount: 0,
      toGenerateCount: hasPendingWork ? 1 : 0,
      reusableCanonicalCount: hasPendingWork ? 9 : 10,
      recoverableCheckpointCount: 0,
      requiresPublication: hasPendingWork,
      reasons: [],
      targetIdentity: {
        provider: providerCapability?.providerId ?? "ollama",
        model: "default-model",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "none",
      },
    },
    publishedIdentity: {
      provider: providerCapability?.providerId ?? "ollama",
      model: "default-model",
      dimensions: 768,
      inputVersion: 1,
      prefixMode: "none",
    },
  });

  const result = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, policy);
  return {
    allowed: result.allowed,
    requiresConfirmation: result.requiresConfirmation,
    reason: result.reason,
  };
}
