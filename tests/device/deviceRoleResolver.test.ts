import { describe, expect, it } from "vitest";
import {
  resolveDeviceRole,
  isLegacyDeviceRoleFallbackEligible,
  type DeviceRoleAssignmentState,
  type DeviceRoleResolution,
  type DeviceRoleResolutionContext,
} from "../../src/device/deviceRoleResolver";
import { type DeviceRole } from "../../src/device/deviceRole";
import { type DeviceState } from "../../src/device/deviceState";

describe("deviceRoleResolver", () => {
  const desktopPlatform = { isMobile: false };
  const mobilePlatform = { isMobile: true };

  describe("Assigned state (persisted role present and valid)", () => {
    it("resolves persisted Producer on desktop as assigned Producer", () => {
      const result = resolveDeviceRole("producer", desktopPlatform);
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: "producer",
        effectiveRole: "producer",
        recommendedRole: "producer",
        assignmentState: "assigned",
      });
    });

    it("resolves persisted Companion on desktop as assigned Companion (overrides recommendation)", () => {
      const result = resolveDeviceRole("companion", desktopPlatform);
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: "companion",
        effectiveRole: "companion",
        recommendedRole: "producer",
        assignmentState: "assigned",
      });
    });

    it("resolves persisted Companion on mobile as assigned Companion", () => {
      const result = resolveDeviceRole("companion", mobilePlatform);
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: "companion",
        effectiveRole: "companion",
        recommendedRole: "companion",
        assignmentState: "assigned",
      });
    });

    it("resolves persisted Producer on mobile as Producer at role level (preserving capability separation)", () => {
      const result = resolveDeviceRole("producer", mobilePlatform);
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: "producer",
        effectiveRole: "producer",
        recommendedRole: "companion",
        assignmentState: "assigned",
      });
    });

    it("accepts full DeviceState object with persisted role", () => {
      const deviceState: DeviceState = {
        schemaVersion: 2,
        deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        role: "producer",
      };

      const result = resolveDeviceRole(deviceState, desktopPlatform);
      expect(result.assignmentState).toBe("assigned");
      expect(result.persistedRole).toBe("producer");
      expect(result.effectiveRole).toBe("producer");
      expect(result.recommendedRole).toBe("producer");
    });

    it("guarantees persisted role takes precedence even if legacy fallback is allowed", () => {
      const result = resolveDeviceRole("companion", desktopPlatform, { allowLegacyFallback: true });
      expect(result.assignmentState).toBe("assigned");
      expect(result.persistedRole).toBe("companion");
      expect(result.effectiveRole).toBe("companion");
      expect(result.recommendedRole).toBe("producer");
    });
  });

  describe("Fresh unassigned state (persisted role missing, context fresh/default)", () => {
    it("resolves fresh desktop with undefined role to unassigned without silent Producer assumption", () => {
      const result = resolveDeviceRole(undefined, desktopPlatform);
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: undefined,
        effectiveRole: "unassigned",
        recommendedRole: "producer",
        assignmentState: "unassigned",
      });
    });

    it("resolves fresh mobile with undefined role to unassigned with recommended Companion", () => {
      const result = resolveDeviceRole(undefined, mobilePlatform);
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: undefined,
        effectiveRole: "unassigned",
        recommendedRole: "companion",
        assignmentState: "unassigned",
      });
    });

    it("treats null input as unassigned when legacy fallback is not allowed", () => {
      const result = resolveDeviceRole(null, desktopPlatform);
      expect(result.assignmentState).toBe("unassigned");
      expect(result.effectiveRole).toBe("unassigned");
      expect(result.recommendedRole).toBe("producer");
    });

    it("treats empty DeviceState object without role as unassigned", () => {
      const deviceState: DeviceState = {
        schemaVersion: 2,
        deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      };

      const result = resolveDeviceRole(deviceState, desktopPlatform);
      expect(result.assignmentState).toBe("unassigned");
      expect(result.effectiveRole).toBe("unassigned");
      expect(result.recommendedRole).toBe("producer");
    });

    it("does NOT assign legacy-fallback merely because allowLegacyFallback is false", () => {
      const result = resolveDeviceRole(undefined, desktopPlatform, { allowLegacyFallback: false });
      expect(result.assignmentState).toBe("unassigned");
      expect(result.effectiveRole).toBe("unassigned");
    });
  });

  describe("Legacy fallback state (persisted role missing, context explicitly legacy)", () => {
    it("resolves legacy desktop with missing role to effective Producer and legacy-fallback", () => {
      const result = resolveDeviceRole(undefined, desktopPlatform, { allowLegacyFallback: true });
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: undefined,
        effectiveRole: "producer",
        recommendedRole: "producer",
        assignmentState: "legacy-fallback",
      });
    });

    it("resolves legacy mobile with missing role to effective Companion and legacy-fallback", () => {
      const result = resolveDeviceRole(undefined, mobilePlatform, { allowLegacyFallback: true });
      expect(result).toEqual<DeviceRoleResolution>({
        persistedRole: undefined,
        effectiveRole: "companion",
        recommendedRole: "companion",
        assignmentState: "legacy-fallback",
      });
    });

    it("applies legacy fallback to DeviceState without role when explicitly requested", () => {
      const legacyDeviceState: DeviceState = {
        schemaVersion: 2,
        deviceId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: "2026-08-30T12:00:00.000Z",
        updatedAt: "2026-08-30T12:00:00.000Z",
      };

      const result = resolveDeviceRole(legacyDeviceState, desktopPlatform, { allowLegacyFallback: true });
      expect(result.assignmentState).toBe("legacy-fallback");
      expect(result.effectiveRole).toBe("producer");
      expect(result.persistedRole).toBeUndefined();
    });
  });

  describe("Validation & resilience", () => {
    it("rejects unknown string roles and falls back to unassigned in default context", () => {
      const result = resolveDeviceRole("invalid-role", desktopPlatform);
      expect(result.assignmentState).toBe("unassigned");
      expect(result.effectiveRole).toBe("unassigned");
      expect(result.persistedRole).toBeUndefined();
    });

    it("rejects unknown string roles and uses legacy fallback if legacy fallback is explicitly enabled", () => {
      const result = resolveDeviceRole("invalid-role", desktopPlatform, { allowLegacyFallback: true });
      expect(result.assignmentState).toBe("legacy-fallback");
      expect(result.effectiveRole).toBe("producer");
      expect(result.persistedRole).toBeUndefined();
    });

    it("handles non-string, non-object corrupted inputs safely", () => {
      expect(resolveDeviceRole(12345, desktopPlatform).assignmentState).toBe("unassigned");
      expect(resolveDeviceRole(true, desktopPlatform).assignmentState).toBe("unassigned");
      expect(resolveDeviceRole([], desktopPlatform).assignmentState).toBe("unassigned");
    });

    it("is pure and deterministic across repeated evaluations", () => {
      const input = { role: "companion" as const };
      const run1 = resolveDeviceRole(input, desktopPlatform);
      const run2 = resolveDeviceRole(input, desktopPlatform);
      expect(run1).toEqual(run2);
    });
  });

  describe("Critical discrimination: Fresh vs Legacy (Regression Test)", () => {
    it("distinguishes fresh unassigned vs legacy-fallback on identical desktop platform with missing role", () => {
      const missingRoleState = { role: undefined };

      // Fresh installation
      const freshResolution = resolveDeviceRole(missingRoleState, desktopPlatform, {
        allowLegacyFallback: false,
      });
      expect(freshResolution.assignmentState).toBe("unassigned");
      expect(freshResolution.effectiveRole).toBe("unassigned");
      expect(freshResolution.recommendedRole).toBe("producer");

      // Legacy pre-existing installation upgraded without role
      const legacyResolution = resolveDeviceRole(missingRoleState, desktopPlatform, {
        allowLegacyFallback: true,
      });
      expect(legacyResolution.assignmentState).toBe("legacy-fallback");
      expect(legacyResolution.effectiveRole).toBe("producer");
      expect(legacyResolution.recommendedRole).toBe("producer");

      // Invariant: Both share the same recommendation, but differ in effective authority and lifecycle
      expect(freshResolution.recommendedRole).toBe(legacyResolution.recommendedRole);
      expect(freshResolution.assignmentState).not.toBe(legacyResolution.assignmentState);
      expect(freshResolution.effectiveRole).not.toBe(legacyResolution.effectiveRole);
    });

    it("distinguishes fresh unassigned vs legacy-fallback on identical mobile platform with missing role", () => {
      const missingRoleState = { role: undefined };

      const freshMobile = resolveDeviceRole(missingRoleState, mobilePlatform, {
        allowLegacyFallback: false,
      });
      expect(freshMobile.assignmentState).toBe("unassigned");
      expect(freshMobile.effectiveRole).toBe("unassigned");

      const legacyMobile = resolveDeviceRole(missingRoleState, mobilePlatform, {
        allowLegacyFallback: true,
      });
      expect(legacyMobile.assignmentState).toBe("legacy-fallback");
      expect(legacyMobile.effectiveRole).toBe("companion");
    });
  });

  describe("Legacy compatibility classification (isLegacyDeviceRoleFallbackEligible)", () => {
    it("classifies existing valid role-less device state as eligible for fallback", () => {
      const legacyState = {
        schemaVersion: 2,
        deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      };
      expect(isLegacyDeviceRoleFallbackEligible(legacyState)).toBe(true);
    });

    it("classifies existing valid state with undefined role as eligible for fallback", () => {
      const legacyState = {
        schemaVersion: 2,
        deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
        role: undefined,
      };
      expect(isLegacyDeviceRoleFallbackEligible(legacyState)).toBe(true);
    });

    it("classifies fresh missing device state (null) as NOT eligible", () => {
      expect(isLegacyDeviceRoleFallbackEligible(null)).toBe(false);
    });

    it("classifies fresh missing device state (undefined) as NOT eligible", () => {
      expect(isLegacyDeviceRoleFallbackEligible(undefined)).toBe(false);
    });

    it("classifies persisted Producer as NOT eligible for fallback (assigned, no fallback needed)", () => {
      const assignedProducer = {
        schemaVersion: 2,
        deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
        role: "producer",
      };
      expect(isLegacyDeviceRoleFallbackEligible(assignedProducer)).toBe(false);
    });

    it("classifies persisted Companion as NOT eligible for fallback (assigned, no fallback needed)", () => {
      const assignedCompanion = {
        schemaVersion: 2,
        deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
        role: "companion",
      };
      expect(isLegacyDeviceRoleFallbackEligible(assignedCompanion)).toBe(false);
    });

    it("classifies corrupted/primitive values as NOT eligible (fails safe)", () => {
      expect(isLegacyDeviceRoleFallbackEligible("invalid" as any)).toBe(false);
      expect(isLegacyDeviceRoleFallbackEligible(123 as any)).toBe(false);
      expect(isLegacyDeviceRoleFallbackEligible(true as any)).toBe(false);
    });
  });
});
