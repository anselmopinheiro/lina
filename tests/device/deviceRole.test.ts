import { describe, expect, it } from "vitest";
import {
  DEVICE_ROLES,
  getDefaultDeviceRole,
  isValidDeviceRole,
  normalizeDeviceRole,
  type DeviceRole,
} from "../../src/device/deviceRole";

describe("deviceRole", () => {
  describe("DEVICE_ROLES constants", () => {
    it("contains producer and companion roles", () => {
      expect(DEVICE_ROLES).toEqual(["producer", "companion"]);
    });
  });

  describe("isValidDeviceRole", () => {
    it("returns true for valid roles", () => {
      expect(isValidDeviceRole("producer")).toBe(true);
      expect(isValidDeviceRole("companion")).toBe(true);
    });

    it("returns false for invalid roles, null, and non-strings", () => {
      expect(isValidDeviceRole("master")).toBe(false);
      expect(isValidDeviceRole("worker")).toBe(false);
      expect(isValidDeviceRole("")).toBe(false);
      expect(isValidDeviceRole(null)).toBe(false);
      expect(isValidDeviceRole(undefined)).toBe(false);
      expect(isValidDeviceRole(123)).toBe(false);
      expect(isValidDeviceRole({})).toBe(false);
    });
  });

  describe("getDefaultDeviceRole", () => {
    it("defaults desktop to producer", () => {
      expect(getDefaultDeviceRole(false)).toBe("producer");
      expect(getDefaultDeviceRole()).toBe("producer");
    });

    it("defaults mobile to companion", () => {
      expect(getDefaultDeviceRole(true)).toBe("companion");
    });
  });

  describe("normalizeDeviceRole", () => {
    it("preserves valid roles", () => {
      expect(normalizeDeviceRole("producer")).toBe("producer");
      expect(normalizeDeviceRole("companion")).toBe("companion");
    });

    it("falls back to default fallback when invalid", () => {
      expect(normalizeDeviceRole("invalid", "producer")).toBe("producer");
      expect(normalizeDeviceRole("invalid", "companion")).toBe("companion");
      expect(normalizeDeviceRole(null)).toBe("producer");
    });
  });
});
