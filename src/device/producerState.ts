/**
 * Active Producer State & Artifact Freshness (Phase 0.3.x — LINA-03-006)
 *
 * Implements a canonical, synchronized snapshot describing the active producer's
 * latest publication activity and maintenance status in `.lina/producer-state.json`.
 *
 * Core Architectural Invariants:
 * 1. Ownership Authority: `.lina/ownership.json` is the sole authority for who is authorized
 *    to publish. `producer-state.json` NEVER grants or overrides ownership authority.
 * 2. Active Producer Gating: Only the Active Producer holding valid ownership may write/update
 *    the state. Companion and Standby devices access this file strictly read-only.
 * 3. Atomic Persistence: Updates follow the strict temporary -> backup -> canonical promotion
 *    with rollback on failure, fully compatible with mobile file systems.
 * 4. Pure Freshness Evaluation: Deterministic evaluation based on centralized thresholds
 *    (default: 24h aging, 48h stale).
 * 5. Minimal State: Avoids duplicating data that is already canonical in manifest.json or
 *    embeddings.jsonl.
 */

import { normalizePath } from "obsidian";
import { isValidDeviceId } from "./deviceIdentity";
import {
  type OwnershipManifest,
  type OwnershipDataAdapter,
  loadOwnership,
} from "./deviceOwnership";

export const PRODUCER_STATE_SCHEMA_VERSION = 1;
export const PRODUCER_STATE_FILE_PATH = ".lina/producer-state.json";

/** 24 hours in milliseconds — standard window before an artifact is considered aging */
export const DEFAULT_AGING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** 48 hours in milliseconds — standard window after which an artifact is considered stale */
export const DEFAULT_STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export type MaintenanceStatus = "idle" | "running" | "backoff" | "error";

export type FreshnessStatus = "fresh" | "aging" | "stale" | "unknown";

export interface ProducerStateTextIndex {
  readonly lastSuccessfulPublicationAt: string | null;
  readonly exclusionPolicyHash?: string;
  readonly exclusionPolicyRevision?: number;
}

export interface ProducerStateEmbeddings {
  readonly lastSuccessfulPublicationAt: string | null;
  readonly publicationId?: string;
  readonly vectorContractId?: string;
}

export interface ProducerStateMaintenance {
  readonly status: MaintenanceStatus;
  readonly lastError?: string | null;
  readonly lastRunAt?: string | null;
}

/**
 * Synchronized state snapshot of the active producer.
 */
export interface ProducerStateV1 {
  readonly schemaVersion: 1;
  readonly activeProducerId: string;
  readonly producerEpoch: number;
  readonly updatedAt: string;
  readonly textIndex: ProducerStateTextIndex;
  readonly embeddings: ProducerStateEmbeddings;
  readonly maintenance: ProducerStateMaintenance;
}

export interface CreateProducerStateInput {
  readonly activeProducerId: string;
  readonly producerEpoch: number;
  readonly updatedAt?: string;
  readonly textIndex?: Partial<ProducerStateTextIndex>;
  readonly embeddings?: Partial<ProducerStateEmbeddings>;
  readonly maintenance?: Partial<ProducerStateMaintenance>;
}

export interface FreshnessOptions {
  readonly now?: number | string | Date;
  readonly agingThresholdMs?: number;
  readonly staleThresholdMs?: number;
}

export interface ProducerFreshnessReport {
  readonly overallFreshness: FreshnessStatus;
  readonly textIndexFreshness: FreshnessStatus;
  readonly embeddingsFreshness: FreshnessStatus;
  readonly producerFreshness: FreshnessStatus;
  readonly producerHeartbeatFreshness: FreshnessStatus;
  readonly isEpochMatch: boolean;
}

export function getProducerStatePath(): string {
  return normalizePath(PRODUCER_STATE_FILE_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

function isValidMaintenanceStatus(value: unknown): value is MaintenanceStatus {
  return value === "idle" || value === "running" || value === "backoff" || value === "error";
}

/**
 * Validates whether an unknown value conforms to `ProducerStateV1`.
 */
export function isProducerStateV1(value: unknown): value is ProducerStateV1 {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== PRODUCER_STATE_SCHEMA_VERSION) {
    return false;
  }

  if (typeof value.activeProducerId !== "string" || !isValidDeviceId(value.activeProducerId)) {
    return false;
  }

  if (
    typeof value.producerEpoch !== "number" ||
    !Number.isInteger(value.producerEpoch) ||
    value.producerEpoch < 1
  ) {
    return false;
  }

  if (!isValidIsoTimestamp(value.updatedAt)) {
    return false;
  }

  // Text index section
  if (!isRecord(value.textIndex)) {
    return false;
  }
  const textIndex = value.textIndex;
  if (textIndex.lastSuccessfulPublicationAt !== null && !isValidIsoTimestamp(textIndex.lastSuccessfulPublicationAt)) {
    return false;
  }
  if (textIndex.exclusionPolicyHash !== undefined && typeof textIndex.exclusionPolicyHash !== "string") {
    return false;
  }
  if (
    textIndex.exclusionPolicyRevision !== undefined &&
    (!Number.isInteger(textIndex.exclusionPolicyRevision) || (textIndex.exclusionPolicyRevision as number) < 1)
  ) {
    return false;
  }

  // Embeddings section
  if (!isRecord(value.embeddings)) {
    return false;
  }
  const embeddings = value.embeddings;
  if (embeddings.lastSuccessfulPublicationAt !== null && !isValidIsoTimestamp(embeddings.lastSuccessfulPublicationAt)) {
    return false;
  }
  if (embeddings.publicationId !== undefined && typeof embeddings.publicationId !== "string") {
    return false;
  }
  if (embeddings.vectorContractId !== undefined && typeof embeddings.vectorContractId !== "string") {
    return false;
  }

  // Maintenance section
  if (!isRecord(value.maintenance)) {
    return false;
  }
  const maintenance = value.maintenance;
  if (!isValidMaintenanceStatus(maintenance.status)) {
    return false;
  }
  if (maintenance.lastError !== undefined && maintenance.lastError !== null && typeof maintenance.lastError !== "string") {
    return false;
  }
  if (maintenance.lastRunAt !== undefined && maintenance.lastRunAt !== null && !isValidIsoTimestamp(maintenance.lastRunAt)) {
    return false;
  }

  return true;
}

/**
 * Creates an immutable `ProducerStateV1` instance with safe defaults.
 */
export function createProducerState(input: CreateProducerStateInput): ProducerStateV1 {
  const normalizedId = input.activeProducerId ? input.activeProducerId.trim() : "";
  if (!isValidDeviceId(normalizedId)) {
    throw new Error(`Cannot create producer state with invalid activeProducerId: "${input.activeProducerId}"`);
  }

  if (!Number.isInteger(input.producerEpoch) || input.producerEpoch < 1) {
    throw new Error(`Cannot create producer state with invalid producerEpoch: ${input.producerEpoch}`);
  }

  const updatedAt = input.updatedAt ?? new Date().toISOString();
  if (!isValidIsoTimestamp(updatedAt)) {
    throw new Error(`Cannot create producer state with invalid updatedAt timestamp: "${String(updatedAt)}"`);
  }

  const textIndex: ProducerStateTextIndex = {
    lastSuccessfulPublicationAt: input.textIndex?.lastSuccessfulPublicationAt ?? null,
    ...(input.textIndex?.exclusionPolicyHash !== undefined ? { exclusionPolicyHash: input.textIndex.exclusionPolicyHash } : {}),
    ...(input.textIndex?.exclusionPolicyRevision !== undefined ? { exclusionPolicyRevision: input.textIndex.exclusionPolicyRevision } : {}),
  };

  const embeddings: ProducerStateEmbeddings = {
    lastSuccessfulPublicationAt: input.embeddings?.lastSuccessfulPublicationAt ?? null,
    ...(input.embeddings?.publicationId !== undefined ? { publicationId: input.embeddings.publicationId } : {}),
    ...(input.embeddings?.vectorContractId !== undefined ? { vectorContractId: input.embeddings.vectorContractId } : {}),
  };

  const maintenance: ProducerStateMaintenance = {
    status: input.maintenance?.status ?? "idle",
    ...(input.maintenance?.lastError !== undefined ? { lastError: input.maintenance.lastError } : {}),
    ...(input.maintenance?.lastRunAt !== undefined ? { lastRunAt: input.maintenance.lastRunAt } : {}),
  };

  return Object.freeze({
    schemaVersion: PRODUCER_STATE_SCHEMA_VERSION,
    activeProducerId: normalizedId,
    producerEpoch: input.producerEpoch,
    updatedAt,
    textIndex,
    embeddings,
    maintenance,
  });
}

function resolveNowTimestamp(now?: number | string | Date): number {
  if (now === undefined) {
    return Date.now();
  }
  if (typeof now === "number") {
    return now;
  }
  if (now instanceof Date) {
    return now.getTime();
  }
  const parsed = Date.parse(now);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * Pure, deterministic freshness evaluator for a single ISO timestamp.
 */
export function evaluateTimestampFreshness(
  timestamp: string | null | undefined,
  options?: FreshnessOptions
): FreshnessStatus {
  if (!timestamp || !isValidIsoTimestamp(timestamp)) {
    return "unknown";
  }

  const parsedTime = Date.parse(timestamp);
  const nowMs = resolveNowTimestamp(options?.now);
  const agingLimit = options?.agingThresholdMs ?? DEFAULT_AGING_THRESHOLD_MS;
  const staleLimit = options?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

  // Allow up to 5 minutes of future clock skew before classifying as unknown
  const futureSkewToleranceMs = 5 * 60 * 1000;
  if (parsedTime > nowMs + futureSkewToleranceMs) {
    return "unknown";
  }

  const ageMs = Math.max(0, nowMs - parsedTime);

  if (ageMs <= agingLimit) {
    return "fresh";
  }
  if (ageMs <= staleLimit) {
    return "aging";
  }
  return "stale";
}

/**
 * Pure evaluator for comprehensive producer state freshness.
 */
export function evaluateProducerStateFreshness(
  state: ProducerStateV1 | null | undefined,
  currentOwnership?: OwnershipManifest | null,
  options?: FreshnessOptions
): ProducerFreshnessReport {
  if (!state || !isProducerStateV1(state)) {
    return {
      overallFreshness: "unknown",
      textIndexFreshness: "unknown",
      embeddingsFreshness: "unknown",
      producerFreshness: "unknown",
      producerHeartbeatFreshness: "unknown",
      isEpochMatch: false,
    };
  }

  const isEpochMatch = Boolean(
    currentOwnership &&
    currentOwnership.activeProducerId === state.activeProducerId &&
    currentOwnership.epoch === state.producerEpoch
  );

  const rawHeartbeatFreshness = evaluateTimestampFreshness(state.updatedAt, options);
  const producerFreshness = (currentOwnership && !isEpochMatch) ? "stale" : rawHeartbeatFreshness;
  const textIndexFreshness = evaluateTimestampFreshness(state.textIndex.lastSuccessfulPublicationAt, options);
  const embeddingsFreshness = evaluateTimestampFreshness(state.embeddings.lastSuccessfulPublicationAt, options);

  // Overall freshness combines text index freshness and producer state freshness.
  // If either text index, embeddings or producer state is stale, overall state reflects stale.
  let overallFreshness: FreshnessStatus;
  if (textIndexFreshness === "stale" || embeddingsFreshness === "stale" || producerFreshness === "stale") {
    overallFreshness = "stale";
  } else if (textIndexFreshness === "aging" || embeddingsFreshness === "aging" || producerFreshness === "aging") {
    overallFreshness = "aging";
  } else if (textIndexFreshness === "fresh") {
    overallFreshness = "fresh";
  } else if (producerFreshness === "fresh") {
    overallFreshness = "fresh";
  } else {
    overallFreshness = "unknown";
  }

  return {
    overallFreshness,
    textIndexFreshness,
    embeddingsFreshness,
    producerFreshness,
    producerHeartbeatFreshness: producerFreshness,
    isEpochMatch,
  };
}

/**
 * Safe, read-only loader for `.lina/producer-state.json`.
 * Returns `null` if file is missing, empty, or corrupt. Never throws.
 */
export async function loadProducerState(
  adapter: OwnershipDataAdapter
): Promise<ProducerStateV1 | null> {
  const path = getProducerStatePath();
  try {
    const exists = await adapter.exists(path);
    if (!exists) {
      return null;
    }

    const content = await adapter.read(path);
    if (!content || content.trim().length === 0) {
      return null;
    }

    const parsed: unknown = JSON.parse(content);
    if (isProducerStateV1(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Atomic publisher for `.lina/producer-state.json`.
 *
 * Enforces:
 * - Active ownership authority: caller must provide active ownership matching state.activeProducerId & epoch.
 * - Atomic write: temp file -> backup -> rename -> cleanup with rollback on error.
 */
export async function saveProducerState(
  adapter: OwnershipDataAdapter,
  state: ProducerStateV1,
  ownership?: OwnershipManifest | null
): Promise<void> {
  if (!isProducerStateV1(state)) {
    throw new Error("Cannot save invalid producer state.");
  }

  const activeOwnership = ownership ?? (await loadOwnership(adapter));
  if (!activeOwnership) {
    throw new Error("Cannot save producer state: no active ownership manifest in .lina/ownership.json.");
  }

  if (activeOwnership.activeProducerId !== state.activeProducerId) {
    throw new Error(
      `Cannot save producer state: activeProducerId "${state.activeProducerId}" does not match authoritative owner "${activeOwnership.activeProducerId}".`
    );
  }

  if (activeOwnership.epoch !== state.producerEpoch) {
    throw new Error(
      `Cannot save producer state: producerEpoch ${state.producerEpoch} does not match authoritative epoch ${activeOwnership.epoch}.`
    );
  }

  const canonicalPath = getProducerStatePath();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temporaryPath = `${canonicalPath}.tmp-${suffix}`;
  const backupPath = `${canonicalPath}.bak-${suffix}`;

  let backedUp = false;
  let published = false;

  try {
    const content = JSON.stringify(state, null, 2);
    await adapter.write(temporaryPath, content);

    const hadOriginal = await adapter.exists(canonicalPath);
    if (hadOriginal) {
      await adapter.rename(canonicalPath, backupPath);
      backedUp = true;
    }

    await adapter.rename(temporaryPath, canonicalPath);
    published = true;

    if (backedUp) {
      try {
        await adapter.remove(backupPath);
      } catch {
        // Non-fatal cleanup
      }
    }
  } catch (error) {
    try {
      if (published) {
        // Rollback published file if subsequent step failed
        try {
          await adapter.remove(canonicalPath);
        } catch {
          // ignore
        }
      }
      if (backedUp) {
        await adapter.rename(backupPath, canonicalPath);
      }
      try {
        await adapter.remove(temporaryPath);
      } catch {
        // ignore
      }
    } catch {
      // rollback failure
    }
    throw error;
  }
}

/**
 * Helper to safely update producer state with partial mutator functions under active ownership.
 */
export async function updateProducerState(
  adapter: OwnershipDataAdapter,
  activeDeviceId: string,
  mutator: (current: ProducerStateV1 | null) => ProducerStateV1,
  ownership?: OwnershipManifest | null
): Promise<ProducerStateV1> {
  const activeOwnership = ownership ?? (await loadOwnership(adapter));
  if (!activeOwnership || activeOwnership.activeProducerId !== activeDeviceId) {
    throw new Error(`Device "${activeDeviceId}" is not the authoritative active producer.`);
  }

  const current = await loadProducerState(adapter);
  const next = mutator(current);

  await saveProducerState(adapter, next, activeOwnership);
  return next;
}
