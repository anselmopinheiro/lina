/**
 * Canonical Exclusion Policy Service and Persistence (LINA-03-001)
 *
 * Implements defensive loading, Active Producer ownership verification, and
 * transactional staged persistence (temp -> backup -> canonical -> remove backup)
 * with automatic rollback for `.lina/exclusions.json`.
 */

import { normalizePath } from "obsidian";
import { ArtifactProvenance } from "../device/artifactProvenance";
import {
  createInitialExclusionPolicy,
  evolveExclusionPolicy,
  ExclusionPolicyLoadResult,
  ExclusionPolicyRulesInput,
  ExclusionPolicyV1,
  getExclusionPolicyPath,
  validatePolicyIntegrity,
} from "./exclusionPolicy";

/**
 * Minimal DataAdapter contract needed for exclusion policy persistence.
 */
export interface ExclusionPolicyDataAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  stat?(path: string): Promise<{ type: string; size: number; mtime: number } | null>;
  mkdir?(path: string): Promise<void>;
  list?(path: string): Promise<{ files: string[]; folders: string[] }>;
}

/**
 * Minimal OwnershipGate contract needed to authorize exclusion policy publications.
 */
export interface ExclusionPolicyOwnershipGate {
  canPublish(): Promise<boolean>;
  getProvenance?(generatedAt?: string): ArtifactProvenance | undefined;
  evaluateProvenance?(generatedAt?: string): Promise<ArtifactProvenance | undefined>;
}

export type ExclusionPolicySaveResult =
  | { readonly success: true; readonly policy: ExclusionPolicyV1 }
  | {
      readonly success: false;
      readonly reason: "unauthorized" | "invalid-policy" | "persistence-error";
      readonly error?: string;
    };

export interface UpdateExclusionRulesOptions {
  readonly provenance?: ArtifactProvenance;
  readonly now?: string;
}

/**
 * Ensures the parent directory `.lina` exists in the vault.
 */
async function ensureExclusionPolicyDirectory(
  adapter: ExclusionPolicyDataAdapter
): Promise<void> {
  const dirPath = normalizePath(".lina");
  try {
    if (adapter.stat) {
      const stat = await adapter.stat(dirPath);
      if (!stat) {
        if (adapter.mkdir) {
          await adapter.mkdir(dirPath);
        }
      }
    } else if (adapter.mkdir) {
      const exists = await adapter.exists(dirPath);
      if (!exists) {
        await adapter.mkdir(dirPath);
      }
    }
  } catch {
    // Ignore directory creation error if directory already exists
  }
}

/**
 * Defensively loads and validates the exclusion policy from `.lina/exclusions.json`.
 *
 * Never crashes on corrupt files. Returns explicit load result indicating missing,
 * invalid (with specific reason), or successfully loaded policy.
 */
export async function loadExclusionPolicy(
  adapter: ExclusionPolicyDataAdapter
): Promise<ExclusionPolicyLoadResult> {
  const targetPath = getExclusionPolicyPath();

  try {
    const exists = await adapter.exists(targetPath);
    if (!exists) {
      return { status: "missing" };
    }

    const rawContent = await adapter.read(targetPath);
    if (!rawContent || rawContent.trim().length === 0) {
      return {
        status: "invalid",
        reason: "invalid-json",
        error: "File is empty",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseError) {
      return {
        status: "invalid",
        reason: "invalid-json",
        error: parseError instanceof Error ? parseError.message : String(parseError),
      };
    }

    const integrity = validatePolicyIntegrity(parsed);
    if (!integrity.valid) {
      return {
        status: "invalid",
        reason: integrity.reason ?? "invalid-rules",
        error: integrity.error,
      };
    }

    return {
      status: "loaded",
      policy: parsed as ExclusionPolicyV1,
    };
  } catch (error) {
    return {
      status: "invalid",
      reason: "invalid-json",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Atomically persists the exclusion policy using the tested 4-step staged pattern:
 * 1. write temporary file
 * 2. move canonical to backup (if present)
 * 3. promote temporary to canonical
 * 4. remove backup
 *
 * Enforces:
 * - Active Producer authorization gating via `gate.canPublish()`
 * - Rejection occurs before any filesystem side-effects
 * - Policy integrity validation prior to staging
 * - Full rollback on promotion failure to preserve last known canonical
 */
export async function saveExclusionPolicy(
  adapter: ExclusionPolicyDataAdapter,
  policy: ExclusionPolicyV1,
  gate: ExclusionPolicyOwnershipGate
): Promise<ExclusionPolicySaveResult> {
  const isAuthorized = await gate.canPublish();
  if (!isAuthorized) {
    return {
      success: false,
      reason: "unauthorized",
      error: "Device is not the active producer authorized to publish exclusion policy.",
    };
  }

  const integrity = validatePolicyIntegrity(policy);
  if (!integrity.valid) {
    return {
      success: false,
      reason: "invalid-policy",
      error: integrity.error ?? "Policy failed integrity validation.",
    };
  }

  await ensureExclusionPolicyDirectory(adapter);

  const targetPath = getExclusionPolicyPath();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temporaryPath = `${targetPath}.tmp-${suffix}`;
  const backupPath = `${targetPath}.bak-${suffix}`;
  const serialized = JSON.stringify(policy, null, 2);
  let backedUp = false;

  try {
    await adapter.write(temporaryPath, serialized);

    if (await adapter.exists(targetPath)) {
      await adapter.rename(targetPath, backupPath);
      backedUp = true;
    }

    await adapter.rename(temporaryPath, targetPath);

    if (backedUp && (await adapter.exists(backupPath))) {
      try {
        await adapter.remove(backupPath);
      } catch (cleanupError) {
        console.warn(
          `Lina: failed to remove temporary exclusion policy backup ${backupPath}:`,
          cleanupError
        );
      }
    }

    return {
      success: true,
      policy,
    };
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath);
      }
      if (backedUp) {
        if (await adapter.exists(targetPath)) {
          await adapter.remove(targetPath);
        }
        if (await adapter.exists(backupPath)) {
          await adapter.rename(backupPath, targetPath);
        }
      }
    } catch (rollbackError) {
      console.warn(
        `Lina: failed to roll back exclusion policy save for ${targetPath}:`,
        rollbackError
      );
    }

    return {
      success: false,
      reason: "persistence-error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Service encapsulating exclusion policy lifecycle operations.
 */
export class ExclusionPolicyService {
  constructor(
    private readonly adapter: ExclusionPolicyDataAdapter,
    private readonly gate: ExclusionPolicyOwnershipGate
  ) {}

  /**
   * Loads the current exclusion policy from `.lina/exclusions.json`.
   */
  async load(): Promise<ExclusionPolicyLoadResult> {
    return loadExclusionPolicy(this.adapter);
  }

  /**
   * Directly saves an existing ExclusionPolicyV1 record after verifying authority and integrity.
   */
  async save(policy: ExclusionPolicyV1): Promise<ExclusionPolicySaveResult> {
    return saveExclusionPolicy(this.adapter, policy, this.gate);
  }

  /**
   * Updates exclusion rules with automatic monotonic revision handling and provenance tagging.
   *
   * Rules:
   * - If policy does not exist yet, initializes policyRevision = 1.
   * - If policy exists and rules are semantically different, increments policyRevision.
   * - If policy exists and rules are semantically identical (idempotent save), preserves policyRevision.
   * - If policy exists but is corrupt/invalid, refuses to overwrite silently.
   */
  async updateRules(
    rulesInput: ExclusionPolicyRulesInput,
    options?: UpdateExclusionRulesOptions
  ): Promise<ExclusionPolicySaveResult> {
    const isAuthorized = await this.gate.canPublish();
    if (!isAuthorized) {
      return {
        success: false,
        reason: "unauthorized",
        error: "Device is not the active producer authorized to publish exclusion policy.",
      };
    }

    const currentResult = await this.load();
    if (currentResult.status === "invalid") {
      return {
        success: false,
        reason: "invalid-policy",
        error: `Cannot update rules: existing exclusion policy at "${getExclusionPolicyPath()}" is invalid (${currentResult.reason}). Refusing to overwrite corrupt policy.`,
      };
    }

    let provenance = options?.provenance;
    if (!provenance) {
      if (this.gate.evaluateProvenance) {
        provenance = await this.gate.evaluateProvenance();
      } else if (this.gate.getProvenance) {
        provenance = this.gate.getProvenance();
      }
    }

    if (!provenance) {
      return {
        success: false,
        reason: "unauthorized",
        error: "Active producer provenance metadata is unavailable.",
      };
    }

    let nextPolicy: ExclusionPolicyV1;
    if (currentResult.status === "loaded") {
      nextPolicy = evolveExclusionPolicy(
        currentResult.policy,
        rulesInput,
        provenance,
        options?.now
      );
    } else {
      nextPolicy = createInitialExclusionPolicy(
        rulesInput,
        provenance,
        options?.now
      );
    }

    return this.save(nextPolicy);
  }
}
