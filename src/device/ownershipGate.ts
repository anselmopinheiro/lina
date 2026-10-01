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
  readOwnership,
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
  | "invalid-ownership"
  | "unsupported-ownership-schema"
  | "ownership-unreadable"
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

/** Immutable authority acquired by one operation and rechecked at each durable write boundary. */
export interface OwnershipFenceToken {
  readonly producerDeviceId: string;
  readonly epoch: number;
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

  const readResult = await readOwnership(adapter);
  if (readResult.status === "invalid") {
    return { authorized: false, status: "invalid-ownership", reason: `Ownership manifest is invalid (${readResult.reason}).` };
  }
  if (readResult.status === "unsupported-schema") {
    return { authorized: false, status: "unsupported-ownership-schema", reason: "Ownership manifest uses an unsupported future schema." };
  }
  if (readResult.status === "unreadable") {
    return { authorized: false, status: "ownership-unreadable", reason: "Ownership manifest could not be read safely." };
  }

  let manifest: OwnershipManifest | null = readResult.status === "valid" ? readResult.manifest : null;
  if (readResult.status === "missing") {
    if (options?.autoClaimIfUnclaimed) {
      try {
        manifest = await claimInitialOwnership(adapter, normalizedId);
      } catch {
        const afterClaim = await readOwnership(adapter);
        manifest = afterClaim.status === "valid" ? afterClaim.manifest : null;
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

  const resolvedManifest = manifest;
  if (!resolvedManifest) {
    return {
      authorized: false,
      status: "unclaimed-ownership",
      reason: "No active ownership manifest exists in .lina/ownership.json.",
    };
  }

  if (resolvedManifest.activeProducerId !== normalizedId) {
    return {
      authorized: false,
      status: "standby-producer",
      activeProducerId: resolvedManifest.activeProducerId ?? undefined,
      epoch: resolvedManifest.epoch,
      reason: resolvedManifest.activeProducerId
        ? `Device is in standby mode. Active producer is "${resolvedManifest.activeProducerId}" at epoch ${resolvedManifest.epoch}.`
        : `Ownership has been relinquished at epoch ${resolvedManifest.epoch}. No active producer.`,
    };
  }

  if (expectedEpoch !== undefined && resolvedManifest.epoch !== expectedEpoch) {
    return {
      authorized: false,
      status: "epoch-mismatch",
      activeProducerId: resolvedManifest.activeProducerId ?? undefined,
      epoch: resolvedManifest.epoch,
      reason: `Ownership epoch mismatch: expected epoch ${expectedEpoch}, but manifest is at epoch ${resolvedManifest.epoch}.`,
    };
  }

  return {
    authorized: true,
    status: "authorized",
    activeProducerId: resolvedManifest.activeProducerId,
    epoch: resolvedManifest.epoch,
  };
}

export interface IOwnershipGate {
  canPublish(): Promise<boolean>;
  evaluate(expectedEpoch?: number): Promise<OwnershipGateDecision>;
  acquireFence(): Promise<OwnershipFenceToken | undefined>;
  assertFence(token: OwnershipFenceToken): Promise<boolean>;
  isAuthorizedSync(): boolean;
  isStandbyProducerSync(): boolean;
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

  async acquireFence(): Promise<OwnershipFenceToken | undefined> {
    const decision = await this.evaluate();
    if (!decision.authorized || !decision.activeProducerId || !decision.epoch) {
      return undefined;
    }
    return { producerDeviceId: decision.activeProducerId, epoch: decision.epoch };
  }

  async assertFence(token: OwnershipFenceToken): Promise<boolean> {
    const decision = this.adapter
      ? await evaluateOwnershipGate(
        this.adapter,
        this.getDeviceId(),
        this.getRole(),
        token.epoch,
        { autoClaimIfUnclaimed: false }
      )
      : { authorized: true, status: "authorized" as const, activeProducerId: token.producerDeviceId, epoch: token.epoch };
    this.lastDecision = decision;
    return decision.authorized && decision.activeProducerId === token.producerDeviceId && decision.epoch === token.epoch;
  }

  isAuthorizedSync(): boolean {
    if (!this.adapter) {
      return true;
    }
    if (this.getRole() !== "producer") {
      return false;
    }
    if (this.lastDecision === null) return true;
    return this.lastDecision.authorized;
  }

  isStandbyProducerSync(): boolean {
    if (!this.adapter) {
      return false;
    }
    if (this.getRole() !== "producer") {
      return false;
    }
    if (this.lastDecision === null) {
      return false;
    }
    return this.lastDecision.status === "standby-producer";
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
