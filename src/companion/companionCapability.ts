/**
 * Companion Capability Detection Foundation (Phase 0.4.x)
 *
 * Defines the capability detection model for Companion devices in Lina's architecture.
 *
 * Core Architectural Invariants:
 * - Role != Ownership: Operational roles dictate local behavior, not publishing authority.
 * - Producer remains authoritative: Full indexing, embedding generation, and canonical publication.
 * - Companion is a consumer: Reads synchronized artifacts and performs local lightweight operations.
 * - Zero Companion Mutations: Companion devices never write to shared indices or generate embeddings.
 */

import { type DeviceRole, isValidDeviceRole } from "../device/deviceRole";
import {
  type DeviceCapabilities,
  type DeviceResourceProfile,
  resolveDeviceCapabilities,
} from "../capabilities/deviceCapabilities";

export interface CompanionCapability {
  /** The operational role configured on the device ("companion", "producer", or undefined if neutral). */
  readonly role?: DeviceRole;

  /** Whether the device is explicitly configured or operating as a Companion. */
  readonly isCompanion: boolean;

  /** Whether the device is operating as a Producer. */
  readonly isProducer: boolean;

  /** Whether the device can consume synchronized shared search artifacts. */
  readonly canConsumeArtifacts: boolean;

  /** Whether the device can perform local ephemeral delta searches over recent unindexed content. */
  readonly canPerformDeltaSearch: boolean;

  /** Strict invariant: Companion devices never generate vector embeddings locally. */
  readonly canGenerateEmbeddings: boolean;

  /** Strict invariant: Companion devices never write or rebuild shared index files. */
  readonly canMaintainSharedIndex: boolean;

  /** Strict invariant: Companion devices never compile or maintain shared binary copies. */
  readonly canMaintainBinaryCopy: boolean;

  /** Platform resource profile ("desktop" | "mobile"). */
  readonly resourceProfile: DeviceResourceProfile;
}

export interface EvaluateCompanionCapabilityOptions {
  /** User-configured operational role from device-scoped state (.lina/devices/<deviceId>.json). */
  readonly role?: DeviceRole;

  /** Resolved device capabilities (or platform profile). */
  readonly capabilities?: DeviceCapabilities;

  /** Whether the host platform is mobile (if capabilities are not explicitly provided). */
  readonly isMobile?: boolean;
}

/**
 * Evaluates the companion capability model for a device given its configured role and platform bounds.
 *
 * Rules:
 * - If `role` is explicitly "companion", the device operates under Companion capabilities regardless of platform.
 * - If `role` is explicitly "producer", `isCompanion` is false and producer write capabilities are determined by `DeviceCapabilities`.
 * - If `role` is unassigned, a mobile platform defaults to companion behavior while desktop defaults to neutral non-companion.
 */
export function evaluateCompanionCapability(
  options: EvaluateCompanionCapabilityOptions = {}
): CompanionCapability {
  const role = isValidDeviceRole(options.role) ? options.role : undefined;
  const isMobile = options.isMobile ?? (options.capabilities?.resourceProfile === "mobile");
  const baseCaps = options.capabilities ?? resolveDeviceCapabilities({ isMobile: Boolean(isMobile) });

  const isExplicitCompanion = role === "companion";
  const isExplicitProducer = role === "producer";
  const isCompanion = isExplicitCompanion || (!isExplicitProducer && Boolean(isMobile));
  const isProducer = isExplicitProducer || (!isExplicitCompanion && !isMobile);

  return {
    role,
    isCompanion,
    isProducer,
    canConsumeArtifacts: true,
    canPerformDeltaSearch: true,
    canGenerateEmbeddings: isCompanion ? false : baseCaps.canGenerateEmbeddings,
    canMaintainSharedIndex: isCompanion ? false : baseCaps.canMaintainTextIndex,
    canMaintainBinaryCopy: isCompanion ? false : baseCaps.canMaintainBinaryCopy,
    resourceProfile: baseCaps.resourceProfile,
  };
}

/**
 * Helper to check whether an unknown role value represents a Companion.
 */
export function isCompanionRole(role: unknown): role is "companion" {
  return role === "companion";
}
