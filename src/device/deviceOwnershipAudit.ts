/**
 * Ownership Transfer Audit Trail Foundation (Phase D2.5.5)
 *
 * Provides an immutable, append-only historical record of active producer
 * ownership transitions in `.lina/ownership-history/`.
 *
 * Architectural Invariants:
 * - Append-only: Existing audit records are immutable and never rewritten or deleted.
 * - Atomic persistence: Writes to temporary files before moving to permanent event files.
 * - Schema isolation: Does not modify or depend on `.lina/ownership.json` schema.
 * - Non-blocking / fault-tolerant: Malformed or unparseable history files are skipped safely.
 * - Chronological ordering: Historical queries return events sorted chronologically.
 * - Strictly isolated: Zero UI, zero worker side-effects, zero automatic takeovers, zero role mutations.
 */

import { normalizePath } from "obsidian";
import { isValidDeviceId } from "./deviceIdentity";
import { OwnershipDataAdapter } from "./deviceOwnership";

export const OWNERSHIP_AUDIT_SCHEMA_VERSION = 1;
export const OWNERSHIP_HISTORY_DIR = ".lina/ownership-history";

export interface OwnershipAuditEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly previousProducerId?: string;
  readonly newProducerId?: string | null;
  readonly previousEpoch?: number;
  readonly newEpoch: number;
  readonly reason: "initial" | "manual-transfer" | "recovery-claim" | "relinquish";
  readonly executedAt: string;
}

export interface AppendOwnershipAuditEventInput {
  readonly previousProducerId?: string;
  readonly newProducerId?: string | null;
  readonly previousEpoch?: number;
  readonly newEpoch: number;
  readonly reason: "initial" | "manual-transfer" | "recovery-claim" | "relinquish";
  readonly eventId?: string;
  readonly executedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidAuditReason(value: unknown): value is OwnershipAuditEvent["reason"] {
  return (
    value === "initial" ||
    value === "manual-transfer" ||
    value === "recovery-claim" ||
    value === "relinquish"
  );
}

/**
 * Validates whether an unknown object conforms to the `OwnershipAuditEvent` schema.
 */
export function isOwnershipAuditEvent(value: unknown): value is OwnershipAuditEvent {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== OWNERSHIP_AUDIT_SCHEMA_VERSION) {
    return false;
  }

  if (typeof value.eventId !== "string" || value.eventId.trim().length === 0) {
    return false;
  }

  if (value.previousProducerId !== undefined) {
    if (typeof value.previousProducerId !== "string" || !isValidDeviceId(value.previousProducerId)) {
      return false;
    }
  }

  if (value.reason === "relinquish") {
    if (value.newProducerId !== undefined && value.newProducerId !== null) {
      return false;
    }
  } else {
    if (typeof value.newProducerId !== "string" || !isValidDeviceId(value.newProducerId)) {
      return false;
    }
  }

  if (value.previousEpoch !== undefined) {
    if (typeof value.previousEpoch !== "number" || !Number.isInteger(value.previousEpoch) || value.previousEpoch < 1) {
      return false;
    }
  }

  if (typeof value.newEpoch !== "number" || !Number.isInteger(value.newEpoch) || value.newEpoch < 1) {
    return false;
  }

  if (!isValidAuditReason(value.reason)) {
    return false;
  }

  if (typeof value.executedAt !== "string" || value.executedAt.trim().length === 0 || isNaN(Date.parse(value.executedAt))) {
    return false;
  }

  return true;
}

/**
 * Generates a unique event identifier.
 */
function generateEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Ensures the `.lina/ownership-history` directory exists in the vault.
 */
async function ensureHistoryDirectory(adapter: OwnershipDataAdapter): Promise<void> {
  const rootDir = normalizePath(".lina");
  const historyDir = normalizePath(OWNERSHIP_HISTORY_DIR);

  try {
    if (adapter.stat) {
      const rootStat = await adapter.stat(rootDir);
      if (!rootStat && adapter.mkdir) {
        await adapter.mkdir(rootDir);
      }
      const historyStat = await adapter.stat(historyDir);
      if (!historyStat && adapter.mkdir) {
        await adapter.mkdir(historyDir);
      }
    } else if (adapter.mkdir) {
      if (!(await adapter.exists(rootDir))) {
        await adapter.mkdir(rootDir);
      }
      if (!(await adapter.exists(historyDir))) {
        await adapter.mkdir(historyDir);
      }
    }
  } catch {
    // Ignore directory creation errors if already exists
  }
}

/**
 * Appends a new ownership transition event to `.lina/ownership-history/`.
 *
 * Rules:
 * - Creates a new numbered file (e.g. `001.json`, `002.json`).
 * - Existing files are never modified or rewritten.
 * - Writes atomically via temporary staging file.
 */
export async function appendOwnershipAuditEvent(
  adapter: OwnershipDataAdapter,
  input: AppendOwnershipAuditEventInput
): Promise<OwnershipAuditEvent> {
  await ensureHistoryDirectory(adapter);

  const event: OwnershipAuditEvent = {
    schemaVersion: OWNERSHIP_AUDIT_SCHEMA_VERSION,
    eventId: input.eventId ?? generateEventId(),
    previousProducerId: input.previousProducerId,
    newProducerId: input.newProducerId,
    previousEpoch: input.previousEpoch,
    newEpoch: input.newEpoch,
    reason: input.reason,
    executedAt: input.executedAt ?? new Date().toISOString(),
  };

  if (!isOwnershipAuditEvent(event)) {
    throw new Error("Invalid ownership audit event structure");
  }

  // Determine next filename sequence
  const historyDir = normalizePath(OWNERSHIP_HISTORY_DIR);
  let nextSequence = 1;

  if (adapter.list) {
    try {
      const listing = await adapter.list(historyDir);
      const jsonFiles = listing.files.filter((f) => f.endsWith(".json"));
      for (const filePath of jsonFiles) {
        const basename = filePath.split("/").pop()?.replace(/\.json$/, "") ?? "";
        const seq = parseInt(basename, 10);
        if (!isNaN(seq) && seq >= nextSequence) {
          nextSequence = seq + 1;
        }
      }
    } catch {
      // Fall back to probe loop if listing fails
    }
  }

  // Probe loop to guarantee we never overwrite an existing sequence number
  let targetFilename = `${String(nextSequence).padStart(3, "0")}.json`;
  let targetPath = normalizePath(`${historyDir}/${targetFilename}`);
  while (await adapter.exists(targetPath)) {
    nextSequence++;
    targetFilename = `${String(nextSequence).padStart(3, "0")}.json`;
    targetPath = normalizePath(`${historyDir}/${targetFilename}`);
  }

  const temporaryPath = normalizePath(`${historyDir}/.${targetFilename}.${Date.now()}.tmp`);
  const serialized = JSON.stringify(event, null, 2);

  try {
    await adapter.write(temporaryPath, serialized);
    await adapter.rename(temporaryPath, targetPath);
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath);
      }
    } catch {
      // Ignore temporary cleanup error
    }
    throw error;
  }

  return event;
}

/**
 * Loads all audit events from `.lina/ownership-history/` in chronological order.
 *
 * Fault Tolerance:
 * - If `.lina/ownership-history/` does not exist, returns `[]`.
 * - Corrupted, empty, or schema-invalid files are safely ignored.
 * - Results are sorted chronologically by `newEpoch` ascending, then `executedAt`.
 */
export async function loadOwnershipAuditHistory(
  adapter: OwnershipDataAdapter
): Promise<OwnershipAuditEvent[]> {
  const historyDir = normalizePath(OWNERSHIP_HISTORY_DIR);

  try {
    const exists = await adapter.exists(historyDir);
    if (!exists) {
      return [];
    }
  } catch {
    return [];
  }

  const events: OwnershipAuditEvent[] = [];

  if (adapter.list) {
    try {
      const listing = await adapter.list(historyDir);
      const jsonFiles = listing.files.filter((f) => f.endsWith(".json") && !f.split("/").pop()?.startsWith("."));
      for (const filePath of jsonFiles) {
        try {
          const raw = await adapter.read(filePath);
          const parsed = JSON.parse(raw);
          if (isOwnershipAuditEvent(parsed)) {
            events.push(parsed);
          }
        } catch {
          // Skip corrupted or unparseable files
        }
      }
    } catch {
      return [];
    }
  } else {
    // If adapter.list is not available, probe sequential files
    let seq = 1;
    let consecutiveMisses = 0;
    while (consecutiveMisses < 5) {
      const filename = `${String(seq).padStart(3, "0")}.json`;
      const filePath = normalizePath(`${historyDir}/${filename}`);
      try {
        if (await adapter.exists(filePath)) {
          consecutiveMisses = 0;
          const raw = await adapter.read(filePath);
          const parsed = JSON.parse(raw);
          if (isOwnershipAuditEvent(parsed)) {
            events.push(parsed);
          }
        } else {
          consecutiveMisses++;
        }
      } catch {
        consecutiveMisses++;
      }
      seq++;
    }
  }

  // Sort chronologically by newEpoch ascending, then executedAt ascending
  events.sort((a, b) => {
    if (a.newEpoch !== b.newEpoch) {
      return a.newEpoch - b.newEpoch;
    }
    return new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime();
  });

  return events;
}
