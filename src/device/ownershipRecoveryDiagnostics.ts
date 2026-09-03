/**
 * Ownership Recovery Diagnostics Foundation (Phase D2.5.6)
 *
 * Provides an observation-only diagnostic evaluation layer that detects
 * inconsistent, missing, or diverged ownership and audit trail states.
 *
 * Architectural Invariants:
 * - Strictly observation-only: Evaluates state and reports discrepancies; NEVER modifies the filesystem.
 * - Zero automatic recovery: Does NOT recreate missing manifests, perform auto-claims, or execute transfers.
 * - Zero side effects: Does NOT trigger background workers, index rebuilds, or UI mutations.
 * - Role isolation (Role != Ownership): Device role configurations (.lina/devices/*.json) are NEVER touched.
 */

import {
  OwnershipManifest,
  OwnershipDataAdapter,
  loadOwnership,
} from "./deviceOwnership";
import {
  OwnershipAuditEvent,
  loadOwnershipAuditHistory,
} from "./deviceOwnershipAudit";

export type OwnershipRecoveryStatus =
  | "healthy"
  | "missing-manifest"
  | "missing-history"
  | "history-ahead-of-manifest"
  | "epoch-inconsistency"
  | "unknown";

/**
 * Diagnostic result describing the consistency between the active ownership manifest
 * and the audit history trail.
 */
export interface OwnershipRecoveryDiagnostics {
  /** High-level consistency status. */
  readonly status: OwnershipRecoveryStatus;

  /** Whether a valid ownership manifest exists in `.lina/ownership.json`. */
  readonly hasManifest: boolean;

  /** Whether at least one valid audit event exists in `.lina/ownership-history/`. */
  readonly hasHistory: boolean;

  /** The active producer device ID from the manifest, if present. */
  readonly currentProducerId?: string;

  /** The current epoch fencing token from the manifest, if present. */
  readonly currentEpoch?: number;

  /** The producer device ID from the latest audit event, if history exists. */
  readonly latestAuditProducerId?: string;

  /** The epoch token from the latest audit event, if history exists. */
  readonly latestAuditEpoch?: number;

  /** The most authoritative or recent producer ID known (from manifest or audit). */
  readonly lastKnownProducerId?: string;

  /** Total number of valid audit events found in `.lina/ownership-history/`. */
  readonly totalAuditEvents: number;

  /** List of human-readable diagnostic warnings describing any detected inconsistencies. */
  readonly warnings: readonly string[];

  /** ISO 8601 timestamp when this evaluation was conducted. */
  readonly evaluatedAt: string;
}

/**
 * Pure evaluation of ownership recovery state given a manifest and audit history.
 *
 * Evaluation Rules:
 * 1. `unknown`: Neither manifest nor audit history exists (uninitialized vault state).
 * 2. `missing-manifest`: Audit history exists, but `ownership.json` is absent or unparseable.
 * 3. `missing-history`: Manifest exists, but no audit events are recorded in `.lina/ownership-history/`.
 * 4. `history-ahead-of-manifest`: Both exist, but `latestAudit.newEpoch > manifest.epoch`.
 * 5. `epoch-inconsistency`:
 *    - `manifest.epoch > latestAudit.newEpoch` (manifest is ahead of audit history);
 *    - `manifest.epoch === latestAudit.newEpoch` but `manifest.activeProducerId !== latestAudit.newProducerId`;
 *    - Invalid or non-positive epoch numbers.
 * 6. `healthy`: Manifest and history are present, with matching active producer ID and matching epoch.
 */
export function evaluateOwnershipRecoveryState(
  manifest: OwnershipManifest | null,
  history: readonly OwnershipAuditEvent[]
): OwnershipRecoveryDiagnostics {
  const evaluatedAt = new Date().toISOString();
  const hasManifest = manifest !== null;
  const hasHistory = history.length > 0;
  const totalAuditEvents = history.length;

  const currentProducerId = manifest?.activeProducerId ?? undefined;
  const currentEpoch = manifest?.epoch;

  const latestAuditEvent = hasHistory ? history[history.length - 1] : undefined;
  const latestAuditProducerId = latestAuditEvent?.newProducerId ?? undefined;
  const latestAuditEpoch = latestAuditEvent?.newEpoch;

  const lastKnownProducerId = currentProducerId ?? latestAuditProducerId ?? latestAuditEvent?.previousProducerId;

  // Case 1: Neither manifest nor history exists
  if (!hasManifest && !hasHistory) {
    return {
      status: "unknown",
      hasManifest: false,
      hasHistory: false,
      totalAuditEvents: 0,
      warnings: ["No ownership manifest (.lina/ownership.json) or audit history found in vault."],
      evaluatedAt,
    };
  }

  // Case 2: History exists, but manifest is missing
  if (!hasManifest && hasHistory) {
    return {
      status: "missing-manifest",
      hasManifest: false,
      hasHistory: true,
      latestAuditProducerId,
      latestAuditEpoch,
      lastKnownProducerId,
      totalAuditEvents,
      warnings: [
        `Ownership manifest (.lina/ownership.json) is missing, but audit history contains ${totalAuditEvents} event(s). Latest audit epoch is ${latestAuditEpoch} for producer "${latestAuditProducerId}".`,
      ],
      evaluatedAt,
    };
  }

  // Case 3: Manifest exists, but history is missing
  if (hasManifest && !hasHistory) {
    return {
      status: "missing-history",
      hasManifest: true,
      hasHistory: false,
      currentProducerId,
      currentEpoch,
      lastKnownProducerId,
      totalAuditEvents: 0,
      warnings: [
        `Ownership manifest exists at epoch ${currentEpoch} for producer "${currentProducerId}", but no audit history was found in .lina/ownership-history/.`,
      ],
      evaluatedAt,
    };
  }

  // Case 4: Both manifest and history exist — check consistency
  // At this point, manifest and latestAuditEvent are guaranteed non-null
  const m = manifest!;
  const a = latestAuditEvent!;

  // Check invalid epoch values
  if (m.epoch < 1 || a.newEpoch < 1) {
    return {
      status: "epoch-inconsistency",
      hasManifest: true,
      hasHistory: true,
      currentProducerId,
      currentEpoch,
      latestAuditProducerId,
      latestAuditEpoch,
      lastKnownProducerId,
      totalAuditEvents,
      warnings: [
        `Invalid epoch values detected: manifest epoch = ${m.epoch}, latest audit epoch = ${a.newEpoch}. Epochs must be positive integers.`,
      ],
      evaluatedAt,
    };
  }

  // Check history ahead of manifest
  if (a.newEpoch > m.epoch) {
    return {
      status: "history-ahead-of-manifest",
      hasManifest: true,
      hasHistory: true,
      currentProducerId,
      currentEpoch,
      latestAuditProducerId,
      latestAuditEpoch,
      lastKnownProducerId,
      totalAuditEvents,
      warnings: [
        `Audit history is ahead of current manifest: latest audit epoch is ${a.newEpoch} (producer "${a.newProducerId}"), but manifest epoch is ${m.epoch} (producer "${m.activeProducerId}").`,
      ],
      evaluatedAt,
    };
  }

  // Check manifest ahead of history
  if (m.epoch > a.newEpoch) {
    return {
      status: "epoch-inconsistency",
      hasManifest: true,
      hasHistory: true,
      currentProducerId,
      currentEpoch,
      latestAuditProducerId,
      latestAuditEpoch,
      lastKnownProducerId,
      totalAuditEvents,
      warnings: [
        `Manifest epoch (${m.epoch}) is ahead of latest audit history epoch (${a.newEpoch}).`,
      ],
      evaluatedAt,
    };
  }

  // Check producer discrepancy at matching epoch
  const manifestProducer = m.activeProducerId ?? null;
  const auditProducer = a.newProducerId ?? null;
  if (manifestProducer !== auditProducer) {
    return {
      status: "epoch-inconsistency",
      hasManifest: true,
      hasHistory: true,
      currentProducerId,
      currentEpoch,
      latestAuditProducerId,
      latestAuditEpoch,
      lastKnownProducerId,
      totalAuditEvents,
      warnings: [
        `Manifest producer ("${m.activeProducerId}") differs from latest audit event producer ("${a.newProducerId}") at matching epoch ${m.epoch}.`,
      ],
      evaluatedAt,
    };
  }

  // Case 5: Fully coherent and healthy
  return {
    status: "healthy",
    hasManifest: true,
    hasHistory: true,
    currentProducerId,
    currentEpoch,
    latestAuditProducerId,
    latestAuditEpoch,
    lastKnownProducerId,
    totalAuditEvents,
    warnings: [],
    evaluatedAt,
  };
}

/**
 * Asynchronously evaluates ownership recovery diagnostics by inspecting
 * the vault's `.lina/ownership.json` and `.lina/ownership-history/` without side effects.
 *
 * @param adapter - DataAdapter for vault file inspection.
 * @returns Comprehensive OwnershipRecoveryDiagnostics snapshot.
 */
export async function evaluateOwnershipRecovery(
  adapter: OwnershipDataAdapter
): Promise<OwnershipRecoveryDiagnostics> {
  let manifest: OwnershipManifest | null = null;
  try {
    manifest = await loadOwnership(adapter);
  } catch {
    manifest = null;
  }

  let history: OwnershipAuditEvent[] = [];
  try {
    history = await loadOwnershipAuditHistory(adapter);
  } catch {
    history = [];
  }

  return evaluateOwnershipRecoveryState(manifest, history);
}
