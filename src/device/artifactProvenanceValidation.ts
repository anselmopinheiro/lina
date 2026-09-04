/**
 * Artifact Provenance Validation Audit (Phase D2.3.1)
 *
 * Implements pure evaluation of artifact provenance metadata against active vault ownership.
 *
 * Architectural Invariants:
 * - Ownership answers: "Who is authorized to publish now?"
 * - Provenance answers: "Who produced this specific artifact snapshot?"
 * - Evaluation is non-blocking: Stale, future, or unknown artifacts remain 100% usable for search.
 * - Zero automatic repair: Stale or future artifacts never trigger automatic rebuilds or ownership transfers.
 */

import { ArtifactProvenance, isValidArtifactProvenance } from "./artifactProvenance";
import { isOwnershipManifest } from "./deviceOwnership";

export type ArtifactProvenanceStatus = "valid" | "stale" | "unknown" | "future";

export interface ArtifactProvenanceValidationResult {
  readonly status: ArtifactProvenanceStatus;
  readonly reason: string;
  readonly artifactProvenance?: ArtifactProvenance;
  readonly ownershipEpoch?: number;
  readonly activeProducerId?: string;
  readonly isProducedByCurrentOwner: boolean;
  readonly isProducedByLocalDevice: boolean;
}

/**
 * Pure function to evaluate an artifact's provenance against the vault's active ownership state.
 *
 * @param provenanceInput - The artifact's provenance metadata (or manifest object, or undefined).
 * @param ownershipInput - The active ownership manifest (or { activeProducerId, epoch }, or undefined).
 * @param localDeviceId - The local installation's deviceId (optional, for local origin detection).
 */
export function evaluateArtifactProvenance(
  provenanceInput: unknown,
  ownershipInput: unknown,
  localDeviceId?: string
): ArtifactProvenanceValidationResult {
  // Extract artifact provenance
  let provenance: ArtifactProvenance | undefined;
  if (isValidArtifactProvenance(provenanceInput)) {
    provenance = provenanceInput;
  } else if (
    typeof provenanceInput === "object" &&
    provenanceInput !== null &&
    "provenance" in provenanceInput &&
    isValidArtifactProvenance((provenanceInput as Record<string, unknown>).provenance)
  ) {
    provenance = (provenanceInput as Record<string, unknown>).provenance as ArtifactProvenance;
  }

  // Extract ownership state
  let ownershipEpoch: number | undefined;
  let activeProducerId: string | undefined;

  if (isOwnershipManifest(ownershipInput)) {
    ownershipEpoch = ownershipInput.epoch;
    activeProducerId = ownershipInput.activeProducerId ?? undefined;
  } else if (
    typeof ownershipInput === "object" &&
    ownershipInput !== null &&
    typeof (ownershipInput as Record<string, unknown>).epoch === "number" &&
    Number.isInteger((ownershipInput as Record<string, unknown>).epoch) &&
    (ownershipInput as Record<string, unknown>).epoch as number >= 1
  ) {
    ownershipEpoch = (ownershipInput as Record<string, unknown>).epoch as number;
    if (typeof (ownershipInput as Record<string, unknown>).activeProducerId === "string") {
      activeProducerId = (ownershipInput as Record<string, unknown>).activeProducerId as string;
    }
  }

  const normalizedLocalId = localDeviceId ? localDeviceId.trim() : undefined;
  const isProducedByLocalDevice = Boolean(
    provenance &&
    normalizedLocalId &&
    provenance.producerDeviceId === normalizedLocalId
  );

  // Case 1: Ownership state is missing or invalid
  if (ownershipEpoch === undefined || !activeProducerId) {
    return {
      status: "unknown",
      reason: "ownership-unavailable",
      artifactProvenance: provenance,
      ownershipEpoch,
      activeProducerId,
      isProducedByCurrentOwner: false,
      isProducedByLocalDevice,
    };
  }

  // Case 2: Artifact provenance is missing or invalid
  if (!provenance) {
    let isMalformed = false;
    if (provenanceInput !== undefined && provenanceInput !== null) {
      if (typeof provenanceInput !== "object") {
        isMalformed = true;
      } else {
        const obj = provenanceInput as Record<string, unknown>;
        if ("provenance" in obj && obj.provenance !== undefined) {
          isMalformed = true;
        } else if ("producerDeviceId" in obj || "producerEpoch" in obj || "generatedAt" in obj) {
          isMalformed = true;
        }
      }
    }

    return {
      status: "unknown",
      reason: isMalformed ? "provenance-invalid" : "provenance-missing",
      ownershipEpoch,
      activeProducerId,
      isProducedByCurrentOwner: false,
      isProducedByLocalDevice: false,
    };
  }


  // Case 3: Artifact epoch matches active ownership epoch
  if (provenance.producerEpoch === ownershipEpoch) {
    if (provenance.producerDeviceId === activeProducerId) {
      return {
        status: "valid",
        reason: "epoch-and-producer-match",
        artifactProvenance: provenance,
        ownershipEpoch,
        activeProducerId,
        isProducedByCurrentOwner: true,
        isProducedByLocalDevice,
      };
    }

    // Same epoch, but producer device ID does not match active owner
    return {
      status: "stale",
      reason: "producer-mismatch",
      artifactProvenance: provenance,
      ownershipEpoch,
      activeProducerId,
      isProducedByCurrentOwner: false,
      isProducedByLocalDevice,
    };
  }

  // Case 4: Artifact epoch is older than current active ownership epoch
  if (provenance.producerEpoch < ownershipEpoch) {
    return {
      status: "stale",
      reason: "epoch-behind-ownership",
      artifactProvenance: provenance,
      ownershipEpoch,
      activeProducerId,
      isProducedByCurrentOwner: false,
      isProducedByLocalDevice,
    };
  }

  // Case 5: Artifact epoch is ahead of local active ownership epoch (out-of-order sync)
  return {
      status: "future",
      reason: "epoch-ahead-of-ownership",
      artifactProvenance: provenance,
      ownershipEpoch,
      activeProducerId,
      isProducedByCurrentOwner: false,
      isProducedByLocalDevice,
  };
}

/**
 * Formats a concise human-readable diagnostic description of an artifact provenance validation result.
 */
export function formatArtifactProvenanceDiagnostic(
  result: ArtifactProvenanceValidationResult
): string {
  switch (result.status) {
    case "valid":
      return `Válido (Epoch ${result.ownershipEpoch}, ${result.isProducedByLocalDevice ? "dispositivo local" : "produtor ativo"})`;
    case "stale":
      if (result.reason === "producer-mismatch") {
        return `Desatualizado (produtor divergente no Epoch ${result.artifactProvenance?.producerEpoch})`;
      }
      return `Desatualizado (Epoch ${result.artifactProvenance?.producerEpoch} vs Epoch atual ${result.ownershipEpoch})`;
    case "future":
      return `Futuro (Epoch ${result.artifactProvenance?.producerEpoch} à frente do Epoch local ${result.ownershipEpoch})`;
    case "unknown":
    default:
      if (result.reason === "ownership-unavailable") {
        return "Sem manifesto de ownership para comparação";
      }
      if (result.reason === "provenance-invalid") {
        return "Proveniência malformada";
      }
      return "Sem metadados de proveniência (índice legado)";
  }
}
