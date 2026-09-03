/**
 * Active Producer Ownership Gate (Phase D2.2)
 *
 * Provides a unified gating abstraction that verifies whether the local device
 * is currently authorized to publish shared artifacts to `.lina/index/*`.
 *
 * Core Rule: Role != Ownership
 * - Having `role = "producer"` indicates readiness/capability.
 * - Only the device matching `activeProducerId` in `.lina/ownership.json` under the active epoch is authorized to write.
 */

import { isValidDeviceId } from "./deviceIdentity";
import { DeviceRole } from "./deviceRole";
import {
  claimInitialOwnership,
  loadOwnership,
  OwnershipDataAdapter,
  OwnershipManifest,
} from "./deviceOwnership";
import {
  ArtifactProvenance,
  createArtifactProvenance,
  ArtifactProvenanceValidationResult,
  evaluateArtifactProvenance,
} from "./artifactProvenance";

export type OwnershipGateStatus =
  | "authorized"
  | "not-producer-role"
  | "standby-producer"
  | "unclaimed-ownership"
  | "epoch-mismatch"
  | "invalid-device-id";

export interface OwnershipGateDecision {
  readonly authorized: boolean;
  readonly status: OwnershipGateStatus;
  readonly activeProducerId?: string;
  readonly epoch?: number;
  readonly reason?: string;
}

export interface EvaluateOwnershipGateOptions {
  readonly autoClaimIfUnclaimed?: boolean;
}

/**
 * Pure evaluation of the ownership gate for a given device and role.
 */
export async function evaluateOwnershipGate(
  adapter: OwnershipDataAdapter,
  localDeviceId: string,
  localRole?: DeviceRole,
  expectedEpoch?: number,
  options?: EvaluateOwnershipGateOptions
): Promise<OwnershipGateDecision> {
  const normalizedId = localDeviceId ? localDeviceId.trim() : "";
  if (!isValidDeviceId(normalizedId)) {
    return {
      authorized: false,
      status: "invalid-device-id",
      reason: `Invalid local device ID: "${localDeviceId}"`,
    };
  }

  if (localRole !== "producer") {
    return {
      authorized: false,
      status: "not-producer-role",
      reason: localRole
        ? `Device role is "${localRole}"; only configured producers may hold active ownership.`
        : "Device role is unassigned; unassigned devices cannot publish shared artifacts.",
    };
  }

  let manifest: OwnershipManifest | null = await loadOwnership(adapter);

  if (!manifest) {
    if (options?.autoClaimIfUnclaimed) {
      try {
        manifest = await claimInitialOwnership(adapter, normalizedId);
      } catch {
        manifest = await loadOwnership(adapter);
      }
    }

    if (!manifest) {
      return {
        authorized: false,
        status: "unclaimed-ownership",
        reason: "No active ownership manifest exists in .lina/ownership.json.",
      };
    }
  }

  if (manifest.activeProducerId !== normalizedId) {
    return {
      authorized: false,
      status: "standby-producer",
      activeProducerId: manifest.activeProducerId,
      epoch: manifest.epoch,
      reason: `Device is in standby mode. Active producer is "${manifest.activeProducerId}" at epoch ${manifest.epoch}.`,
    };
  }

  if (expectedEpoch !== undefined && manifest.epoch !== expectedEpoch) {
    return {
      authorized: false,
      status: "epoch-mismatch",
      activeProducerId: manifest.activeProducerId,
      epoch: manifest.epoch,
      reason: `Epoch mismatch: expected epoch ${expectedEpoch}, but manifest is at epoch ${manifest.epoch}.`,
    };
  }

  return {
    authorized: true,
    status: "authorized",
    activeProducerId: manifest.activeProducerId,
    epoch: manifest.epoch,
  };
}

export interface IOwnershipGate {
  canPublish(): Promise<boolean>;
  evaluate(expectedEpoch?: number): Promise<OwnershipGateDecision>;
  isAuthorizedSync(): boolean;
  getLastDecision(): OwnershipGateDecision | null;
  getProvenance(generatedAt?: string): ArtifactProvenance | undefined;
  evaluateProvenance(generatedAt?: string): Promise<ArtifactProvenance | undefined>;
  validateArtifact(provenance: unknown): ArtifactProvenanceValidationResult;
  validateArtifactAsync(provenance: unknown): Promise<ArtifactProvenanceValidationResult>;
}

/**
 * Stateful ownership gate helper for a running plugin instance.
 */
export class OwnershipGate implements IOwnershipGate {
  private lastDecision: OwnershipGateDecision | null = null;

  constructor(
    private readonly adapter?: OwnershipDataAdapter,
    private readonly getDeviceId: () => string = () => "",
    private readonly getRole: () => DeviceRole | undefined = () => undefined,
    private readonly autoClaim: boolean = true
  ) {}

  async evaluate(expectedEpoch?: number): Promise<OwnershipGateDecision> {
    if (!this.adapter) {
      const decision: OwnershipGateDecision = {
        authorized: true,
        status: "authorized",
      };
      this.lastDecision = decision;
      return decision;
    }
    const decision = await evaluateOwnershipGate(
      this.adapter,
      this.getDeviceId(),
      this.getRole(),
      expectedEpoch,
      { autoClaimIfUnclaimed: this.autoClaim }
    );
    this.lastDecision = decision;
    return decision;
  }

  async canPublish(): Promise<boolean> {
    if (!this.adapter) {
      return true;
    }
    const decision = await this.evaluate();
    return decision.authorized;
  }

  isAuthorizedSync(): boolean {
    if (!this.adapter) {
      return true;
    }
    if (this.getRole() !== "producer") {
      return false;
    }
    if (this.lastDecision === null) {
      return true;
    }
    return this.lastDecision.authorized;
  }

  getProvenance(generatedAt?: string): ArtifactProvenance | undefined {
    const decision = this.lastDecision;
    if (decision?.authorized && decision.activeProducerId && decision.epoch) {
      return createArtifactProvenance(
        decision.activeProducerId,
        decision.epoch,
        generatedAt
      );
    }
    return undefined;
  }

  async evaluateProvenance(generatedAt?: string): Promise<ArtifactProvenance | undefined> {
    const decision = await this.evaluate();
    if (decision.authorized && decision.activeProducerId && decision.epoch) {
      return createArtifactProvenance(
        decision.activeProducerId,
        decision.epoch,
        generatedAt
      );
    }
    return undefined;
  }

  validateArtifact(provenance: unknown): ArtifactProvenanceValidationResult {
    return evaluateArtifactProvenance(
      provenance,
      this.lastDecision
        ? {
            activeProducerId: this.lastDecision.activeProducerId,
            epoch: this.lastDecision.epoch,
          }
        : undefined,
      this.getDeviceId()
    );
  }

  async validateArtifactAsync(provenance: unknown): Promise<ArtifactProvenanceValidationResult> {
    if (this.lastDecision === null && this.adapter) {
      await this.evaluate();
    }
    return this.validateArtifact(provenance);
  }

  invalidate(): void {
    this.lastDecision = null;
  }

  getLastDecision(): OwnershipGateDecision | null {
    return this.lastDecision;
  }
}
