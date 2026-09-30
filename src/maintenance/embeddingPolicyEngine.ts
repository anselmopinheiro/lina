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

import type { EmbeddingUpdateMode } from "./embeddingUpdateSettings";
import { type EmbeddingLifecycleSnapshot } from "../index/embeddingLifecycleModel";
import {
  type EmbeddingWritePathDecision,
  type EmbeddingWriteAction,
  deriveEmbeddingWritePathDecision,
} from "../index/embeddingLifecycleWritePath";

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
