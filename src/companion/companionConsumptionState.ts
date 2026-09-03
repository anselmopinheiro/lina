/**
 * Companion Artifact Consumption State Foundation (Phase 0.4.x)
 *
 * Provides a pure, read-only representation describing the state of synchronized
 * search artifacts from a Companion perspective.
 *
 * Core Architectural Invariants:
 * - Read-Only Model: Only inspects and describes artifact availability; never mutates vault files.
 * - Non-Blocking Usability: Valid artifacts remain 100% usable for local search regardless of stale/future provenance.
 * - Transport Agnostic: Operates seamlessly over files synced via Obsidian Sync, Syncthing, etc.
 * - Zero Rebuild Trigger: Never initiates background indexing or embedding generation on Companion.
 */

import { type DeviceRole } from "../device/deviceRole";
import {
  type OwnershipManifest,
  type OwnershipDataAdapter,
  loadOwnership,
} from "../device/deviceOwnership";
import {
  type ArtifactProvenanceStatus,
  evaluateArtifactProvenance,
} from "../device/artifactProvenanceValidation";
import { extractArtifactProvenance } from "../device/artifactProvenance";
import { evaluateCompanionCapability } from "./companionCapability";
import { BINARY_EMBEDDING_FILES } from "../index/embeddingBinaryStorage";

export type ArtifactFreshness = "fresh" | "stale" | "unknown" | "missing";

export type CompanionConsumptionMode = "full" | "text-only" | "degraded" | "unavailable";

export interface CompanionArtifactAvailability {
  /** Text index manifest and chunk availability. */
  readonly textIndex: "available" | "missing" | "invalid";

  /** Canonical vector embeddings availability. */
  readonly embeddings: "available" | "missing" | "invalid";

  /** Fast binary Float32Array vector copy availability. */
  readonly binaryCopy: "available" | "missing" | "invalid";
}

export interface CompanionEmbeddingState {
  /** Whether embeddings are enabled and available for vector search. */
  readonly available: boolean;

  /** Embedding AI provider name (e.g. "ollama", "openrouter"). */
  readonly provider?: string;

  /** Embedding model identifier. */
  readonly model?: string;

  /** Vector embedding dimension count. */
  readonly dimensions?: number;

  /** Number of embedded records/chunks if known from binary or text manifest. */
  readonly recordCount?: number;

  /** Whether binary acceleration buffer is available. */
  readonly hasBinaryAcceleration: boolean;
}

export interface CompanionArtifactConsumptionState {
  /** Schema version for forward/backward compatibility. */
  readonly schemaVersion: 1;

  /** Timestamp when this state was evaluated (ISO 8601). */
  readonly timestamp: string;

  /** Local device identifier inspecting the state. */
  readonly deviceId: string;

  /** Configured operational role on local device. */
  readonly role?: DeviceRole;

  /** Whether the device is operating as a Companion. */
  readonly isCompanion: boolean;

  /** Last known producer epoch recorded in the vault ownership or artifact provenance. */
  readonly lastKnownProducerEpoch?: number;

  /** Active producer device ID from ownership manifest, if known. */
  readonly activeProducerId?: string;

  /** Text index schema version from manifest. */
  readonly availableIndexVersion?: number;

  /** Total indexed notes count from manifest. */
  readonly totalNotes?: number;

  /** Total indexed chunks count from manifest. */
  readonly totalChunks?: number;

  /** Summary of available embeddings for semantic search. */
  readonly embeddingState: CompanionEmbeddingState;

  /** Provenance evaluation against active ownership. */
  readonly provenanceValidity: ArtifactProvenanceStatus;

  /** Contextual explanation of provenance validity. */
  readonly provenanceReason?: string;

  /** Freshness assessment of available artifacts. */
  readonly artifactFreshness: ArtifactFreshness;

  /** Availability classification of each shared artifact category. */
  readonly artifactAvailability: CompanionArtifactAvailability;

  /** Whether the local companion can safely consume available artifacts for search. */
  readonly canConsume: boolean;

  /** High-level operational consumption mode for search execution. */
  readonly consumptionMode: CompanionConsumptionMode;
}

export interface BuildCompanionConsumptionInput {
  readonly deviceId: string;
  readonly role?: DeviceRole;
  readonly ownership?: OwnershipManifest | null;
  readonly textManifestRaw?: unknown;
  readonly binaryManifestRaw?: unknown;
  readonly timestamp?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonSafely(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Pure function to build a structured `CompanionArtifactConsumptionState` snapshot.
 */
export function evaluateCompanionConsumptionState(
  input: BuildCompanionConsumptionInput
): CompanionArtifactConsumptionState {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const deviceId = input.deviceId.trim();
  const ownership = input.ownership ?? undefined;

  const caps = evaluateCompanionCapability({ role: input.role });
  const isCompanion = caps.isCompanion;

  const activeProducerId = ownership?.activeProducerId ?? undefined;
  const ownershipEpoch = ownership?.epoch;

  // 1. Text Index Manifest Evaluation
  let textIndexAvailability: "available" | "missing" | "invalid" = "missing";
  let indexVersion: number | undefined;
  let totalNotes: number | undefined;
  let totalChunks: number | undefined;
  let textManifestProvenance: unknown = undefined;
  let embeddingsSection: Record<string, unknown> | undefined;
  let embeddingsEnabled = false;

  if (input.textManifestRaw !== undefined && input.textManifestRaw !== null) {
    if (isRecord(input.textManifestRaw)) {
      const manifest = input.textManifestRaw;
      if (
        manifest.indexType === "text" &&
        typeof manifest.version === "number" &&
        typeof manifest.totalNotes === "number"
      ) {
        textIndexAvailability = "available";
        indexVersion = manifest.version;
        totalNotes = manifest.totalNotes;
        totalChunks = typeof manifest.totalChunks === "number" ? manifest.totalChunks : undefined;
        textManifestProvenance = extractArtifactProvenance(manifest);

        embeddingsEnabled = Boolean(manifest.embeddingsEnabled);
        if (isRecord(manifest.embeddings)) {
          embeddingsSection = manifest.embeddings;
        }
      } else {
        textIndexAvailability = "invalid";
      }
    } else {
      textIndexAvailability = "invalid";
    }
  }

  // 2. Binary Embedding Manifest Evaluation
  let binaryAvailability: "available" | "missing" | "invalid" = "missing";
  let binaryRecordCount: number | undefined;
  let binaryDimensions: number | undefined;
  let binaryProvider: string | undefined;
  let binaryModel: string | undefined;

  if (input.binaryManifestRaw !== undefined && input.binaryManifestRaw !== null) {
    if (isRecord(input.binaryManifestRaw)) {
      const bManifest = input.binaryManifestRaw;
      if (
        typeof bManifest.generationId === "string" &&
        typeof bManifest.recordCount === "number" &&
        typeof bManifest.dimensions === "number"
      ) {
        binaryAvailability = "available";
        binaryRecordCount = bManifest.recordCount;
        binaryDimensions = bManifest.dimensions;
        binaryProvider = typeof bManifest.provider === "string" ? bManifest.provider : undefined;
        binaryModel = typeof bManifest.model === "string" ? bManifest.model : undefined;
      } else {
        binaryAvailability = "invalid";
      }
    } else {
      binaryAvailability = "invalid";
    }
  }

  // 3. Embedding State Determination
  let embeddingsAvailability: "available" | "missing" | "invalid" = "missing";
  let embeddingProvider: string | undefined = binaryProvider;
  let embeddingModel: string | undefined = binaryModel;
  let embeddingDimensions: number | undefined = binaryDimensions;
  let embeddingRecordCount: number | undefined = binaryRecordCount;

  if (embeddingsSection) {
    embeddingProvider = typeof embeddingsSection.provider === "string" ? embeddingsSection.provider : embeddingProvider;
    embeddingModel = typeof embeddingsSection.model === "string" ? embeddingsSection.model : embeddingModel;
    embeddingDimensions = typeof embeddingsSection.dimensions === "number" ? embeddingsSection.dimensions : embeddingDimensions;
    embeddingRecordCount = typeof embeddingsSection.recordCount === "number" ? embeddingsSection.recordCount : embeddingRecordCount;
  }

  if (embeddingsEnabled) {
    if (embeddingProvider && embeddingModel) {
      embeddingsAvailability = "available";
    } else {
      embeddingsAvailability = "invalid";
    }
  } else if (embeddingsSection || binaryAvailability === "available") {
    embeddingsAvailability = "available";
  }

  const embeddingState: CompanionEmbeddingState = {
    available: embeddingsAvailability === "available",
    provider: embeddingProvider,
    model: embeddingModel,
    dimensions: embeddingDimensions,
    recordCount: embeddingRecordCount,
    hasBinaryAcceleration: binaryAvailability === "available",
  };

  // 4. Provenance Validation
  const provenanceValidation = evaluateArtifactProvenance(
    textManifestProvenance ?? input.textManifestRaw,
    ownership,
    deviceId
  );

  const lastKnownProducerEpoch =
    ownershipEpoch ??
    provenanceValidation.artifactProvenance?.producerEpoch;

  // 5. Freshness Assessment
  let artifactFreshness: ArtifactFreshness = "missing";
  if (textIndexAvailability === "missing") {
    artifactFreshness = "missing";
  } else if (textIndexAvailability === "invalid") {
    artifactFreshness = "stale";
  } else {
    switch (provenanceValidation.status) {
      case "valid":
        artifactFreshness = "fresh";
        break;
      case "stale":
        artifactFreshness = "stale";
        break;
      case "future":
        artifactFreshness = "unknown";
        break;
      case "unknown":
      default:
        artifactFreshness = "unknown";
        break;
    }
  }

  // 6. Usability & Consumption Mode
  const canConsume = textIndexAvailability === "available";

  let consumptionMode: CompanionConsumptionMode = "unavailable";
  if (textIndexAvailability === "available") {
    if (embeddingState.available) {
      consumptionMode = "full";
    } else {
      consumptionMode = "text-only";
    }
  } else if (textIndexAvailability === "invalid") {
    consumptionMode = "degraded";
  } else {
    consumptionMode = "unavailable";
  }

  const artifactAvailability: CompanionArtifactAvailability = {
    textIndex: textIndexAvailability,
    embeddings: embeddingsAvailability,
    binaryCopy: binaryAvailability,
  };

  return {
    schemaVersion: 1,
    timestamp,
    deviceId,
    role: input.role,
    isCompanion,
    lastKnownProducerEpoch,
    activeProducerId,
    availableIndexVersion: indexVersion,
    totalNotes,
    totalChunks,
    embeddingState,
    provenanceValidity: provenanceValidation.status,
    provenanceReason: provenanceValidation.reason,
    artifactFreshness,
    artifactAvailability,
    canConsume,
    consumptionMode,
  };
}

/**
 * Asynchronously reads vault files to construct a complete, read-only `CompanionArtifactConsumptionState`.
 *
 * Guarantees:
 * - Strictly read-only: Zero writes, zero temporary files, zero directory creations.
 * - Defensive fault tolerance: Missing or corrupt files are handled without throwing exceptions.
 */
export async function readCompanionConsumptionState(
  adapter: OwnershipDataAdapter,
  deviceId: string,
  role?: DeviceRole
): Promise<CompanionArtifactConsumptionState> {
  const normalizedId = deviceId.trim();

  // 1. Read ownership manifest
  let ownership: OwnershipManifest | null = null;
  try {
    ownership = await loadOwnership(adapter);
  } catch {
    ownership = null;
  }

  // 2. Read text index manifest
  let textManifestRaw: unknown = null;
  try {
    if (await adapter.exists(".lina/index/manifest.json")) {
      const text = await adapter.read(".lina/index/manifest.json");
      textManifestRaw = parseJsonSafely(text);
    }
  } catch {
    textManifestRaw = null;
  }

  // 3. Read binary embedding manifest
  let binaryManifestRaw: unknown = null;
  try {
    if (await adapter.exists(BINARY_EMBEDDING_FILES.manifest)) {
      const text = await adapter.read(BINARY_EMBEDDING_FILES.manifest);
      binaryManifestRaw = parseJsonSafely(text);
    }
  } catch {
    binaryManifestRaw = null;
  }

  return evaluateCompanionConsumptionState({
    deviceId: normalizedId,
    role,
    ownership,
    textManifestRaw,
    binaryManifestRaw,
  });
}
