/**
 * Device Role Model (Phase D1)
 *
 * Defines the operational role a device assumes in Lina's architecture.
 *
 * Separation of Concerns:
 * - Identity: Who is this installation? (Persistent UUID v4)
 * - Capabilities: What can this installation technically do? (Hardware & platform bounds)
 * - Role: How should Lina use this installation? ("producer" | "companion")
 * - Ownership: Which device is authorized to publish shared artifacts? (Future epoch coordination)
 */

export type DeviceRole = "producer" | "companion";

export const DEVICE_ROLES = Object.freeze(["producer", "companion"] as const);

/**
 * Validates whether an unknown value is a supported `DeviceRole`.
 */
export function isValidDeviceRole(value: unknown): value is DeviceRole {
  return typeof value === "string" && (value === "producer" || value === "companion");
}

/**
 * Determines the sensible default role for a device based on platform profile.
 * - Desktop installations default to "producer".
 * - Mobile installations default to "companion".
 */
export function getDefaultDeviceRole(isMobile = false): DeviceRole {
  return isMobile ? "companion" : "producer";
}

/**
 * Normalizes an unknown role value, falling back to a safe default if invalid.
 */
export function normalizeDeviceRole(value: unknown, fallback: DeviceRole = "producer"): DeviceRole {
  return isValidDeviceRole(value) ? value : fallback;
}

export {
  type DeviceRoleAssignmentState,
  type DeviceRoleResolution,
  type DeviceRoleResolutionContext,
  type DeviceRolePersistedInput,
  resolveDeviceRole,
  isLegacyDeviceRoleFallbackEligible,
} from "./deviceRoleResolver";
