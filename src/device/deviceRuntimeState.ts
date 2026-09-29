/**
 * Device Runtime State Foundation (Phase LINA-06-IMPLEMENT-DEVICE-RUNTIME-STATE-001)
 *
 * Single, canonical source of derived runtime state across:
 * - Settings Hub
 * - Diagnostics Modal
 * - Sidebar Status Card
 * - Search View
 *
 * Architectural Invariants:
 * 1. Persistent sources of truth remain strictly:
 *    - Vault Authority: `.lina/ownership.json` (activeProducerId, epoch, lease/fencing)
 *    - Local Device: `.lina/devices/<deviceId>.json` (deviceId, deviceName, configuredRole)
 * 2. Purely derived in memory: Never creates parallel persistent state or adds fields to data.json.
 * 3. Unified resolution: Eliminates divergent evaluations, ad-hoc gate queries, and legacy setting leaks.
 * 4. 4-level capability separation for Search/Embeddings:
 *    - Physical Existence (manifest on disk)
 *    - Vector Contract Compatibility (provider/model match)
 *    - Runtime Readiness (memory index loaded/checking)
 *    - Operational Semantic Availability (ready for queries)
 */

import { DeviceRole } from "./deviceRole";
import { DeviceState } from "./deviceState";
import {
  DeviceRoleResolution,
  DeviceRoleAssignmentState,
  resolveDeviceRole,
} from "./deviceRoleResolver";
import { OwnershipManifest, OwnershipReason } from "./deviceOwnership";
import { evaluateCompanionConsumptionState } from "../companion";
import {
  type SemanticCapabilityState,
  type SemanticOperationalReasonCode,
  evaluateSemanticCapability,
} from "../search/semanticCapability";
import { type SemanticCompatibility } from "../search/hybridSearch";
import { type EmbeddingLifecycleSnapshot } from "../index/embeddingLifecycleModel";

export type DeviceTransferEligibilityReason =
  | "ready"
  | "already-active-producer"
  | "missing-ownership"
  | "companion-role"
  | "unassigned-role";

export interface DeviceRuntimeEmbeddingsProvenance {
  readonly epoch?: number;
  readonly producerId?: string;
  readonly stale: boolean;
}

export interface DeviceRuntimeEmbeddingsCompatibility {
  readonly provider?: string;
  readonly model?: string;
  readonly dimensions?: number;
  readonly compatible: boolean;
}

export interface DeviceRuntimeEmbeddingsReadiness {
  readonly loaded: boolean;
  readonly runtimeReady: boolean;
}

export interface DeviceRuntimeEmbeddingsState {
  readonly configured: boolean;
  readonly textIndexAvailable: boolean;
  readonly embeddingsDeclared: boolean;

  // 1. Existência física no vault
  readonly exists: boolean;
  readonly vectorFileState: "available" | "missing" | "empty" | "invalid";

  // 2. Proveniência (metadados do artefacto vs ownership)
  readonly provenance: DeviceRuntimeEmbeddingsProvenance;

  // 3. Compatibilidade do contrato vetorial
  readonly compatibility: DeviceRuntimeEmbeddingsCompatibility;
  readonly contractState: "compatible" | "mismatch" | "none";

  // 4. Prontidão operacional do runtime local
  readonly readiness: DeviceRuntimeEmbeddingsReadiness;
  readonly runtimeState: "ready" | "checking" | "unavailable";

  // 5. Disponibilidade semântica e modo efetivo
  readonly semanticAvailable: boolean;
  readonly effectiveMode: "full" | "text-only" | "unavailable";
  readonly reasonCode?: SemanticOperationalReasonCode;
  readonly reason?: string;
}

export interface DeviceRuntimeState {
  // 1. Identidade e Papel Local (.lina/devices/<deviceId>.json)
  readonly deviceId: string;
  readonly deviceName?: string;
  readonly configuredRole?: DeviceRole;
  readonly effectiveRole: DeviceRole | "unassigned";
  readonly assignmentState: DeviceRoleAssignmentState;
  readonly isConfigured: boolean;

  // 2. Ownership e Cluster (.lina/ownership.json)
  readonly ownershipExists: boolean;
  readonly activeProducerId?: string;
  readonly epoch?: number;
  readonly ownershipReason?: OwnershipReason;
  readonly isActiveProducer: boolean;
  readonly isStandbyProducer: boolean;
  readonly isCompanion: boolean;
  readonly isUnassigned: boolean;
  readonly canPublish: boolean;
  readonly canTransferOwnership: boolean;
  readonly transferEligibilityReason: DeviceTransferEligibilityReason;

  // 3. Capacidades de Embeddings e Pesquisa Semântica
  readonly embeddings: DeviceRuntimeEmbeddingsState;
}

export interface ResolveDeviceRuntimeStateInput {
  readonly deviceId: string;
  readonly deviceState?: DeviceState | null;
  readonly ownership?: OwnershipManifest | null;
  readonly roleResolution?: DeviceRoleResolution;
  readonly isMobile?: boolean;
  readonly legacyRoleFallbackAllowed?: boolean;
  readonly textManifestRaw?: unknown;
  readonly binaryManifestRaw?: unknown;
  readonly semanticAvailability?: SemanticCompatibility;
  readonly semanticCapability?: SemanticCapabilityState;
  readonly embeddingsEnabled?: boolean;
  readonly isChecking?: boolean;
  readonly providerReachable?: boolean;
  readonly isAuthorizedProducerOverride?: boolean;
  readonly lifecycleSnapshot?: EmbeddingLifecycleSnapshot | null;
}

/**
 * Pure function that deterministically derives the complete `DeviceRuntimeState`
 * from canonical persistent inputs and current capabilities.
 */
export function resolveDeviceRuntimeState(
  input: ResolveDeviceRuntimeStateInput
): DeviceRuntimeState {
  const deviceId = input.deviceId.trim();
  const deviceState = input.deviceState ?? undefined;
  const ownership = input.ownership ?? null;

  // 1. Resolve role from local device state
  const resolution: DeviceRoleResolution =
    input.roleResolution ??
    resolveDeviceRole(
      deviceState,
      { isMobile: input.isMobile ?? false },
      { allowLegacyFallback: input.legacyRoleFallbackAllowed ?? false }
    );
  const assignmentState = resolution.assignmentState;
  const effectiveRole = resolution.effectiveRole;
  const canonicalRole = effectiveRole === "unassigned" ? undefined : effectiveRole;

  const isConfigured = Boolean(
    deviceState && (
      deviceState.role !== undefined ||
      deviceState.deviceName !== undefined ||
      assignmentState === "assigned"
    )
  );

  // 2. Resolve ownership and cluster state
  const ownershipExists = ownership !== null && ownership !== undefined;
  const activeProducerId = ownership?.activeProducerId ?? undefined;
  const epoch = ownership?.epoch;
  const isEffectiveProducer = effectiveRole === "producer";

  let isActiveProducer: boolean;
  let isStandbyProducer: boolean;

  if (input.isAuthorizedProducerOverride !== undefined) {
    isActiveProducer = Boolean(isEffectiveProducer && input.isAuthorizedProducerOverride);
    isStandbyProducer = Boolean(isEffectiveProducer && !input.isAuthorizedProducerOverride);
  } else {
    isActiveProducer = Boolean(isEffectiveProducer && ownership && activeProducerId === deviceId);
    isStandbyProducer = Boolean(isEffectiveProducer && (!ownership || activeProducerId !== deviceId));
  }

  const isCompanion = effectiveRole === "companion";
  const isUnassigned = effectiveRole === "unassigned";
  const canPublish = isActiveProducer;

  // 3. Resolve transfer eligibility
  let canTransferOwnership = false;
  let transferEligibilityReason: DeviceTransferEligibilityReason = "missing-ownership";

  if (!ownershipExists) {
    canTransferOwnership = false;
    transferEligibilityReason = "missing-ownership";
  } else if (isActiveProducer) {
    canTransferOwnership = false;
    transferEligibilityReason = "already-active-producer";
  } else if (effectiveRole === "producer") {
    canTransferOwnership = true;
    transferEligibilityReason = "ready";
  } else if (effectiveRole === "companion") {
    canTransferOwnership = false;
    transferEligibilityReason = "companion-role";
  } else {
    canTransferOwnership = false;
    transferEligibilityReason = "unassigned-role";
  }

  // 4. Resolve embeddings & search capability (existence vs compatibility vs readiness vs availability)
  const companionState = evaluateCompanionConsumptionState({
    deviceId,
    role: canonicalRole,
    ownership: ownership ?? null,
    textManifestRaw: input.textManifestRaw,
    binaryManifestRaw: input.binaryManifestRaw,
  });

  const textIndexAvailable = companionState.artifactAvailability.textIndex === "available";
  const embeddingsDeclared = companionState.artifactAvailability.embeddings === "available";

  let vectorContractState: "compatible" | "mismatch" | "none" = "none";
  if (input.semanticAvailability?.reasonCode === "incompatible") {
    vectorContractState = "mismatch";
  } else if (input.semanticAvailability?.available) {
    vectorContractState = "compatible";
  } else if (companionState.vectorContractCompatibility?.status === "mismatch") {
    vectorContractState = "mismatch";
  } else if (companionState.vectorContract) {
    vectorContractState = "compatible";
  }

  const semanticCap = input.semanticCapability ?? evaluateSemanticCapability({
    textIndexAvailable,
    embeddingsDeclaredInManifest: embeddingsDeclared,
    vectorContractState,
    semanticCompatibility: input.semanticAvailability,
    isChecking: input.isChecking,
    providerReachable: input.providerReachable,
    lifecycleSnapshot: input.lifecycleSnapshot,
  });

  const exists = (embeddingsDeclared || companionState.artifactAvailability.binaryCopy === "available")
    && semanticCap.artifactState.vectorFile !== "missing";

  const provenanceEpoch = companionState.lastKnownProducerEpoch ?? ownership?.epoch;
  const isProvenanceStale = companionState.provenanceValidity === "stale";

  const provenance: DeviceRuntimeEmbeddingsProvenance = {
    epoch: provenanceEpoch,
    producerId: companionState.activeProducerId,
    stale: isProvenanceStale,
  };

  const compatibility: DeviceRuntimeEmbeddingsCompatibility = {
    provider: input.semanticAvailability?.indexProvider
      ?? companionState.embeddingState.provider
      ?? companionState.vectorContract?.provider,
    model: input.semanticAvailability?.indexModel
      ?? companionState.embeddingState.model
      ?? companionState.vectorContract?.model,
    dimensions: input.semanticAvailability?.indexDimensions
      ?? companionState.embeddingState.dimensions
      ?? companionState.vectorContract?.dimensions,
    compatible: semanticCap.contractState === "compatible",
  };

  const readiness: DeviceRuntimeEmbeddingsReadiness = {
    loaded: semanticCap.runtimeState === "ready",
    runtimeReady: semanticCap.runtimeState === "ready",
  };

  const embeddings: DeviceRuntimeEmbeddingsState = {
    configured: Boolean(input.embeddingsEnabled),
    textIndexAvailable,
    embeddingsDeclared,
    exists,
    vectorFileState: semanticCap.artifactState.vectorFile,
    provenance,
    compatibility,
    contractState: semanticCap.contractState,
    readiness,
    runtimeState: semanticCap.runtimeState,
    semanticAvailable: semanticCap.semanticAvailable,
    effectiveMode: semanticCap.effectiveMode,
    reasonCode: semanticCap.reasonCode,
    reason: semanticCap.reason,
  };

  return {
    deviceId,
    deviceName: deviceState?.deviceName,
    configuredRole: deviceState?.role,
    effectiveRole,
    assignmentState,
    isConfigured,
    ownershipExists,
    activeProducerId,
    epoch,
    ownershipReason: ownership?.reason,
    isActiveProducer,
    isStandbyProducer,
    isCompanion,
    isUnassigned,
    canPublish,
    canTransferOwnership,
    transferEligibilityReason,
    embeddings,
  };
}
