/**
 * Internal Diagnostics Model Foundation (Phase D2.4.1)
 *
 * Provides a clean, unified, and read-only diagnostic representation aggregating:
 * - Device identity, name, and operational role.
 * - Active producer ownership manifest state and epoch fencing.
 * - Artifact states, manifests, and provenance validation across text index, embeddings, binary copies, and checkpoints.
 *
 * Architectural Invariants:
 * - Strictly read-only: Diagnostics only inspect and report state; they never mutate files, trigger auto-claims, or alter ownership.
 * - No business logic pollution: Diagnostics do not make worker, scheduling, or synchronization decisions.
 * - Zero automatic repair: Stale, future, or legacy artifacts are reported non-destructively without triggering rebuilds.
 */

import { DeviceRole } from "./deviceRole";
import { DeviceState, loadDeviceState } from "./deviceState";
import {
  OwnershipManifest,
  OwnershipReason,
  loadOwnership,
  OwnershipDataAdapter,
} from "./deviceOwnership";
import {
  ArtifactProvenanceStatus,
  ArtifactProvenanceValidationResult,
  evaluateArtifactProvenance,
  formatArtifactProvenanceDiagnostic,
} from "./artifactProvenanceValidation";
import { BINARY_EMBEDDING_FILES } from "../index/embeddingBinaryStorage";

export interface DeviceDiagnosticsDeviceSection {
  readonly id: string;
  readonly name?: string;
  readonly role?: DeviceRole;
  readonly isConfigured: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface DeviceDiagnosticsOwnershipSection {
  readonly activeProducerId?: string;
  readonly epoch?: number;
  readonly reason?: OwnershipReason;
  readonly acquiredAt?: string;
  readonly updatedAt?: string;
  readonly isActiveProducer: boolean;
  readonly isStandbyProducer: boolean;
  readonly isCompanion: boolean;
  readonly isUnassigned: boolean;
  readonly isUnclaimed: boolean;
}

export interface DeviceDiagnosticsArtifactItem {
  readonly status: ArtifactProvenanceStatus;
  readonly validation: ArtifactProvenanceValidationResult;
  readonly diagnosticMessage: string;
  readonly exists: boolean;
  readonly updatedAt?: string;
}

export interface DeviceDiagnosticsTextIndexArtifact extends DeviceDiagnosticsArtifactItem {
  readonly indexType?: string;
  readonly totalNotes?: number;
  readonly totalChunks?: number;
}

export interface DeviceDiagnosticsEmbeddingsArtifact extends DeviceDiagnosticsArtifactItem {
  readonly enabled: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly dimensions?: number;
  readonly publicationId?: string;
}

export interface DeviceDiagnosticsBinaryArtifact extends DeviceDiagnosticsArtifactItem {
  readonly generationId?: string;
  readonly sourcePublicationId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly recordCount?: number;
  readonly dimensions?: number;
}

export interface DeviceDiagnosticsCheckpointArtifact extends DeviceDiagnosticsArtifactItem {
  readonly operationId?: string;
  readonly completedRecords?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly dimensions?: number;
}

export interface DeviceDiagnosticsArtifactsSection {
  readonly index: DeviceDiagnosticsTextIndexArtifact;
  readonly embeddings: DeviceDiagnosticsEmbeddingsArtifact;
  readonly binary: DeviceDiagnosticsBinaryArtifact;
  readonly checkpoint?: DeviceDiagnosticsCheckpointArtifact;
}

export interface DeviceDiagnostics {
  readonly timestamp: string;
  readonly device: DeviceDiagnosticsDeviceSection;
  readonly ownership: DeviceDiagnosticsOwnershipSection;
  readonly artifacts: DeviceDiagnosticsArtifactsSection;
}

export interface BuildDeviceDiagnosticsInput {
  readonly deviceId: string;
  readonly deviceState?: DeviceState | null;
  readonly ownership?: OwnershipManifest | null;
  readonly textManifestRaw?: unknown;
  readonly binaryManifestRaw?: unknown;
  readonly checkpointMetaRaw?: unknown;
  readonly timestamp?: string;
}

function parseJsonSafely(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Pure function to build a structured `DeviceDiagnostics` snapshot from resolved state inputs.
 */
export function buildDeviceDiagnostics(input: BuildDeviceDiagnosticsInput): DeviceDiagnostics {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const deviceId = input.deviceId.trim();
  const deviceState = input.deviceState ?? undefined;
  const ownership = input.ownership ?? undefined;

  // 1. Device Section
  const role = deviceState?.role;
  const isConfigured = Boolean(deviceState && (deviceState.role !== undefined || deviceState.deviceName !== undefined));

  const deviceSection: DeviceDiagnosticsDeviceSection = {
    id: deviceId,
    name: deviceState?.deviceName,
    role,
    isConfigured,
    createdAt: deviceState?.createdAt,
    updatedAt: deviceState?.updatedAt,
  };

  // 2. Ownership Section
  const activeProducerId = ownership?.activeProducerId;
  const epoch = ownership?.epoch;
  const isUnclaimed = ownership === undefined || ownership === null;
  const isActiveProducer = Boolean(role === "producer" && ownership && activeProducerId === deviceId);
  const isStandbyProducer = Boolean(role === "producer" && (!ownership || activeProducerId !== deviceId));
  const isCompanion = role === "companion";
  const isUnassigned = role === undefined;

  const ownershipSection: DeviceDiagnosticsOwnershipSection = {
    activeProducerId,
    epoch,
    reason: ownership?.reason,
    acquiredAt: ownership?.acquiredAt,
    updatedAt: ownership?.updatedAt,
    isActiveProducer,
    isStandbyProducer,
    isCompanion,
    isUnassigned,
    isUnclaimed,
  };

  // 3. Artifacts Section
  // A. Text Index
  const textManifest =
    typeof input.textManifestRaw === "object" && input.textManifestRaw !== null
      ? (input.textManifestRaw as Record<string, unknown>)
      : undefined;

  const textValidation = evaluateArtifactProvenance(textManifest, ownership, deviceId);
  const textIndexArtifact: DeviceDiagnosticsTextIndexArtifact = {
    status: textValidation.status,
    validation: textValidation,
    diagnosticMessage: formatArtifactProvenanceDiagnostic(textValidation),
    exists: Boolean(textManifest),
    indexType: typeof textManifest?.indexType === "string" ? textManifest.indexType : undefined,
    totalNotes: typeof textManifest?.totalNotes === "number" ? textManifest.totalNotes : undefined,
    totalChunks: typeof textManifest?.totalChunks === "number" ? textManifest.totalChunks : undefined,
    updatedAt: typeof textManifest?.updatedAt === "string" ? textManifest.updatedAt : undefined,
  };

  // B. Canonical Embeddings
  const embeddingsSection =
    textManifest && typeof textManifest.embeddings === "object" && textManifest.embeddings !== null
      ? (textManifest.embeddings as Record<string, unknown>)
      : undefined;

  const embeddingsValidation = evaluateArtifactProvenance(embeddingsSection, ownership, deviceId);
  const embeddingsArtifact: DeviceDiagnosticsEmbeddingsArtifact = {
    status: embeddingsValidation.status,
    validation: embeddingsValidation,
    diagnosticMessage: formatArtifactProvenanceDiagnostic(embeddingsValidation),
    enabled: Boolean(textManifest?.embeddingsEnabled),
    exists: Boolean(embeddingsSection),
    provider: typeof embeddingsSection?.provider === "string" ? embeddingsSection.provider : undefined,
    model: typeof embeddingsSection?.model === "string" ? embeddingsSection.model : undefined,
    dimensions: typeof embeddingsSection?.dimensions === "number" ? embeddingsSection.dimensions : undefined,
    publicationId: typeof embeddingsSection?.publicationId === "string" ? embeddingsSection.publicationId : undefined,
    updatedAt: typeof embeddingsSection?.updatedAt === "string" ? embeddingsSection.updatedAt : undefined,
  };

  // C. Binary Embedding Copy
  const binaryManifest =
    typeof input.binaryManifestRaw === "object" && input.binaryManifestRaw !== null
      ? (input.binaryManifestRaw as Record<string, unknown>)
      : undefined;

  const binaryValidation = evaluateArtifactProvenance(binaryManifest, ownership, deviceId);
  const binaryArtifact: DeviceDiagnosticsBinaryArtifact = {
    status: binaryValidation.status,
    validation: binaryValidation,
    diagnosticMessage: formatArtifactProvenanceDiagnostic(binaryValidation),
    exists: Boolean(binaryManifest),
    generationId: typeof binaryManifest?.generationId === "string" ? binaryManifest.generationId : undefined,
    sourcePublicationId: typeof binaryManifest?.sourcePublicationId === "string" ? binaryManifest.sourcePublicationId : undefined,
    provider: typeof binaryManifest?.provider === "string" ? binaryManifest.provider : undefined,
    model: typeof binaryManifest?.model === "string" ? binaryManifest.model : undefined,
    recordCount: typeof binaryManifest?.recordCount === "number" ? binaryManifest.recordCount : undefined,
    dimensions: typeof binaryManifest?.dimensions === "number" ? binaryManifest.dimensions : undefined,
    updatedAt: typeof binaryManifest?.createdAt === "string" ? binaryManifest.createdAt : undefined,
  };

  // D. Embedding Checkpoint (Optional)
  let checkpointArtifact: DeviceDiagnosticsCheckpointArtifact | undefined;
  if (typeof input.checkpointMetaRaw === "object" && input.checkpointMetaRaw !== null) {
    const checkpointMeta = input.checkpointMetaRaw as Record<string, unknown>;
    const checkpointValidation = evaluateArtifactProvenance(checkpointMeta, ownership, deviceId);
    checkpointArtifact = {
      status: checkpointValidation.status,
      validation: checkpointValidation,
      diagnosticMessage: formatArtifactProvenanceDiagnostic(checkpointValidation),
      exists: true,
      operationId: typeof checkpointMeta.operationId === "string" ? checkpointMeta.operationId : undefined,
      completedRecords: typeof checkpointMeta.completedRecords === "number" ? checkpointMeta.completedRecords : undefined,
      provider: typeof checkpointMeta.provider === "string" ? checkpointMeta.provider : undefined,
      model: typeof checkpointMeta.model === "string" ? checkpointMeta.model : undefined,
      dimensions: typeof checkpointMeta.dimension === "number" ? checkpointMeta.dimension : undefined,
      updatedAt: typeof checkpointMeta.updatedAt === "string" ? checkpointMeta.updatedAt : undefined,
    };
  }

  const artifactsSection: DeviceDiagnosticsArtifactsSection = {
    index: textIndexArtifact,
    embeddings: embeddingsArtifact,
    binary: binaryArtifact,
    checkpoint: checkpointArtifact,
  };

  return {
    timestamp,
    device: deviceSection,
    ownership: ownershipSection,
    artifacts: artifactsSection,
  };
}

/**
 * Asynchronously reads vault files to produce a complete, read-only `DeviceDiagnostics` snapshot.
 *
 * Defensively reads files without creating directories or mutating vault files.
 */
export async function readDeviceDiagnostics(
  adapter: OwnershipDataAdapter,
  deviceId: string
): Promise<DeviceDiagnostics> {
  const normalizedId = deviceId.trim();

  // Read device state
  let deviceState: DeviceState | null = null;
  try {
    deviceState = await loadDeviceState(adapter as any, normalizedId);
  } catch {
    deviceState = null;
  }

  // Read ownership manifest
  let ownership: OwnershipManifest | null = null;
  try {
    ownership = await loadOwnership(adapter);
  } catch {
    ownership = null;
  }

  // Read text index manifest
  let textManifestRaw: unknown = null;
  try {
    if (await adapter.exists(".lina/index/manifest.json")) {
      const text = await adapter.read(".lina/index/manifest.json");
      textManifestRaw = parseJsonSafely(text);
    }
  } catch {
    textManifestRaw = null;
  }

  // Read binary embedding manifest
  let binaryManifestRaw: unknown = null;
  try {
    if (await adapter.exists(BINARY_EMBEDDING_FILES.manifest)) {
      const text = await adapter.read(BINARY_EMBEDDING_FILES.manifest);
      binaryManifestRaw = parseJsonSafely(text);
    }
  } catch {
    binaryManifestRaw = null;
  }

  // Read embedding checkpoint metadata
  let checkpointMetaRaw: unknown = null;
  try {
    if (await adapter.exists(".lina/index/embeddings.checkpoint.meta.json")) {
      const text = await adapter.read(".lina/index/embeddings.checkpoint.meta.json");
      checkpointMetaRaw = parseJsonSafely(text);
    }
  } catch {
    checkpointMetaRaw = null;
  }

  return buildDeviceDiagnostics({
    deviceId: normalizedId,
    deviceState,
    ownership,
    textManifestRaw,
    binaryManifestRaw,
    checkpointMetaRaw,
  });
}
