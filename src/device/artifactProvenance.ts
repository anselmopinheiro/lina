/**
 * Artifact Provenance Tracking (Phase D2.3)
 *
 * Implements immutable metadata tracking for generated shared artifacts.
 *
 * Architectural Invariant:
 * - Ownership answers: "Who is authorized to publish now?"
 * - Provenance answers: "Who produced this specific artifact snapshot?"
 */

import { isValidDeviceId } from "./deviceIdentity";

export interface ArtifactProvenance {
  readonly producerDeviceId: string;
  readonly producerEpoch: number;
  readonly generatedAt: string;
}

export type ProvenanceEpochComparison = "match" | "stale" | "newer" | "unknown";

/**
 * Validates whether an unknown value is a well-formed `ArtifactProvenance` object.
 */
export function isValidArtifactProvenance(value: unknown): value is ArtifactProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.producerDeviceId !== "string" || !isValidDeviceId(candidate.producerDeviceId)) {
    return false;
  }

  if (
    typeof candidate.producerEpoch !== "number" ||
    !Number.isInteger(candidate.producerEpoch) ||
    candidate.producerEpoch < 1
  ) {
    return false;
  }

  if (
    typeof candidate.generatedAt !== "string" ||
    candidate.generatedAt.trim().length === 0 ||
    Number.isNaN(Date.parse(candidate.generatedAt))
  ) {
    return false;
  }

  return true;
}

/**
 * Creates a valid `ArtifactProvenance` metadata record.
 */
export function createArtifactProvenance(
  producerDeviceId: string,
  producerEpoch: number,
  generatedAt?: string
): ArtifactProvenance {
  const normalizedId = producerDeviceId ? producerDeviceId.trim() : "";
  if (!isValidDeviceId(normalizedId)) {
    throw new Error(`Cannot create artifact provenance with invalid producerDeviceId: "${producerDeviceId}"`);
  }

  if (!Number.isInteger(producerEpoch) || producerEpoch < 1) {
    throw new Error(`Cannot create artifact provenance with invalid producerEpoch: ${producerEpoch}`);
  }

  const timestamp = generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Cannot create artifact provenance with invalid generatedAt timestamp: "${timestamp}"`);
  }

  return {
    producerDeviceId: normalizedId,
    producerEpoch,
    generatedAt: timestamp,
  };
}

/**
 * Safely extracts and validates `ArtifactProvenance` from an unknown manifest or object.
 */
export function extractArtifactProvenance(manifest: unknown): ArtifactProvenance | undefined {
  if (typeof manifest !== "object" || manifest === null) {
    return undefined;
  }

  const candidate = (manifest as Record<string, unknown>).provenance;
  return isValidArtifactProvenance(candidate) ? candidate : undefined;
}

/**
 * Compares an artifact's recorded producer epoch against an active ownership epoch.
 *
 * @param provenance - The provenance metadata attached to the artifact (or undefined if legacy).
 * @param activeEpoch - The current active epoch recorded in .lina/ownership.json.
 */
export function compareProvenanceEpoch(
  provenance: ArtifactProvenance | undefined,
  activeEpoch: number
): ProvenanceEpochComparison {
  if (!provenance || !Number.isInteger(activeEpoch) || activeEpoch < 1) {
    return "unknown";
  }

  if (provenance.producerEpoch === activeEpoch) {
    return "match";
  }

  if (provenance.producerEpoch < activeEpoch) {
    return "stale";
  }

  return "newer";
}

export type {
  ArtifactProvenanceStatus,
  ArtifactProvenanceValidationResult,
} from "./artifactProvenanceValidation";

export {
  evaluateArtifactProvenance,
  formatArtifactProvenanceDiagnostic,
} from "./artifactProvenanceValidation";
