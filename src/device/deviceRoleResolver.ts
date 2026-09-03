/**
 * Canonical Device Role Resolver (Phase 0.2.2.X.1.2)
 *
 * Provides a single, pure, authoritative architectural boundary for resolving
 * the operational role state of a device in Lina's multi-device architecture.
 *
 * Invariants:
 * - Pure and deterministic: Zero filesystem, global state, or UI inspections.
 * - Platform != Role: Platform provides a recommendation; user choice dictates role.
 * - Role != Ownership: Role defines operational intent, not publishing authority.
 * - Explicit lifecycle: Distinguishes between assigned, fresh unassigned, and legacy fallback.
 * - Persisted role is supreme: An explicitly assigned role always overrides recommendations.
 */

import { type DeviceRole, isValidDeviceRole } from "./deviceRole";
import { type DevicePlatform } from "../capabilities/deviceCapabilities";

/**
 * Lifecycle state of device role assignment.
 * - "assigned": An explicit role ("producer" | "companion") is persisted in device state.
 * - "unassigned": A fresh installation with no persisted role; awaiting user choice.
 * - "legacy-fallback": An existing pre-migration installation operating under temporary platform fallback.
 */
export type DeviceRoleAssignmentState =
  | "assigned"
  | "unassigned"
  | "legacy-fallback";

/**
 * Canonical resolved device role output model.
 */
export interface DeviceRoleResolution {
  /** The explicit role persisted in device state (if present and valid). */
  readonly persistedRole?: DeviceRole;

  /**
   * The operational role currently in effect for runtime subsystems
   * ("producer", "companion", or "unassigned").
   */
  readonly effectiveRole: DeviceRole | "unassigned";

  /**
   * The recommended role derived strictly from host platform capabilities
   * ("producer" on desktop, "companion" on mobile).
   */
  readonly recommendedRole: DeviceRole;

  /**
   * The assignment lifecycle state.
   */
  readonly assignmentState: DeviceRoleAssignmentState;
}

/**
 * Contextual input for role resolution.
 * Allows the caller/startup lifecycle to explicitly declare whether this device
 * is eligible for legacy compatibility fallback.
 */
export interface DeviceRoleResolutionContext {
  /**
   * Explicit flag indicating whether the caller has identified this device
   * as eligible for legacy compatibility fallback.
   *
   * When false or omitted: fresh device semantics apply (missing role -> "unassigned").
   * When true: pre-existing legacy device semantics apply (missing role -> "legacy-fallback").
   */
  readonly allowLegacyFallback?: boolean;
}

/**
 * Type representing supported persisted input:
 * - A DeviceRole string ("producer" | "companion")
 * - An object containing a `role` property (e.g., DeviceState)
 * - undefined / null / unknown
 */
export type DeviceRolePersistedInput =
  | DeviceRole
  | { readonly role?: unknown }
  | null
  | undefined
  | unknown;

/**
 * Pure function to resolve the canonical device role state given:
 * 1. Persisted device state (or candidate role string)
 * 2. Host platform profile
 * 3. Explicit resolution context
 *
 * Rules:
 * 1. If a valid `role` is persisted, it ALWAYS wins:
 *    `assignmentState = "assigned"`, `effectiveRole = persistedRole`.
 *    Platform recommendation does NOT override a persisted role.
 * 2. If no valid role is persisted and `context.allowLegacyFallback === true`:
 *    `assignmentState = "legacy-fallback"`, `effectiveRole = recommendedRole`.
 * 3. If no valid role is persisted and `context.allowLegacyFallback !== true`:
 *    `assignmentState = "unassigned"`, `effectiveRole = "unassigned"`.
 *    No silent Producer behavior on fresh installations.
 */
export function resolveDeviceRole(
  input: DeviceRolePersistedInput,
  platform: DevicePlatform,
  context?: DeviceRoleResolutionContext
): DeviceRoleResolution {
  const recommendedRole: DeviceRole = platform.isMobile ? "companion" : "producer";

  // Extract raw candidate role from string, DeviceState-like object, or primitive
  const rawRole = (input !== null && typeof input === "object" && "role" in input)
    ? (input as { readonly role?: unknown }).role
    : input;

  // 1. Assigned state: Valid persisted role always takes precedence
  if (isValidDeviceRole(rawRole)) {
    return {
      persistedRole: rawRole,
      effectiveRole: rawRole,
      recommendedRole,
      assignmentState: "assigned",
    };
  }

  // 2. Legacy compatibility fallback: Only when explicitly authorized by caller
  if (context?.allowLegacyFallback === true) {
    return {
      persistedRole: undefined,
      effectiveRole: recommendedRole,
      recommendedRole,
      assignmentState: "legacy-fallback",
    };
  }

  // 3. Fresh unassigned state: Missing or invalid role without explicit legacy fallback
  return {
    persistedRole: undefined,
    effectiveRole: "unassigned",
    recommendedRole,
    assignmentState: "unassigned",
  };
}

/**
 * Classifies whether a pre-existing device state is eligible for legacy role compatibility fallback.
 *
 * Requirements (Phase 0.2.2.X.1.3):
 * 1. A valid per-device state file must have already existed on disk before the current session.
 * 2. The existing state must have an undefined/missing role (pre-role-assignment installation).
 * 3. Fresh installations (state did not exist on disk, i.e., null or undefined input) return false.
 * 4. Already assigned installations (role is "producer" or "companion") return false (no fallback needed).
 * 5. Missing or corrupted states (null/undefined or malformed) fail safe to false.
 *
 * @param preExistingState - The device state loaded from disk before startup initialization, or null if missing/corrupted.
 * @returns boolean indicating whether the device is eligible for legacy compatibility fallback.
 */
export function isLegacyDeviceRoleFallbackEligible(
  preExistingState: { readonly role?: unknown } | null | undefined
): boolean {
  if (!preExistingState || typeof preExistingState !== "object") {
    return false;
  }
  if (preExistingState.role !== undefined) {
    return false;
  }
  return true;
}
