import { describe, it, expect } from "vitest";
import {
  evaluateCompanionCapability,
  isCompanionRole,
} from "../../src/companion/companionCapability";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";

describe("CompanionCapability (Phase 0.4.x Foundation)", () => {
  describe("isCompanionRole", () => {
    it("returns true only for 'companion'", () => {
      expect(isCompanionRole("companion")).toBe(true);
      expect(isCompanionRole("producer")).toBe(false);
      expect(isCompanionRole(undefined)).toBe(false);
      expect(isCompanionRole(null)).toBe(false);
      expect(isCompanionRole("unknown")).toBe(false);
    });
  });

  describe("evaluateCompanionCapability", () => {
    it("evaluates explicit companion role correctly on desktop", () => {
      const caps = evaluateCompanionCapability({
        role: "companion",
        isMobile: false,
      });

      expect(caps.role).toBe("companion");
      expect(caps.isCompanion).toBe(true);
      expect(caps.isProducer).toBe(false);
      expect(caps.canConsumeArtifacts).toBe(true);
      expect(caps.canPerformDeltaSearch).toBe(true);
      // Invariants: Companion never writes shared assets
      expect(caps.canGenerateEmbeddings).toBe(false);
      expect(caps.canMaintainSharedIndex).toBe(false);
      expect(caps.canMaintainBinaryCopy).toBe(false);
      expect(caps.resourceProfile).toBe("desktop");
    });

    it("evaluates explicit companion role correctly on mobile", () => {
      const caps = evaluateCompanionCapability({
        role: "companion",
        isMobile: true,
      });

      expect(caps.role).toBe("companion");
      expect(caps.isCompanion).toBe(true);
      expect(caps.isProducer).toBe(false);
      expect(caps.canConsumeArtifacts).toBe(true);
      expect(caps.canPerformDeltaSearch).toBe(true);
      expect(caps.canGenerateEmbeddings).toBe(false);
      expect(caps.canMaintainSharedIndex).toBe(false);
      expect(caps.canMaintainBinaryCopy).toBe(false);
      expect(caps.resourceProfile).toBe("mobile");
    });

    it("evaluates explicit producer role correctly on desktop", () => {
      const caps = evaluateCompanionCapability({
        role: "producer",
        isMobile: false,
      });

      expect(caps.role).toBe("producer");
      expect(caps.isCompanion).toBe(false);
      expect(caps.isProducer).toBe(true);
      expect(caps.canConsumeArtifacts).toBe(true);
      expect(caps.canPerformDeltaSearch).toBe(true);
      expect(caps.canGenerateEmbeddings).toBe(true);
      expect(caps.canMaintainSharedIndex).toBe(true);
      expect(caps.canMaintainBinaryCopy).toBe(true);
      expect(caps.resourceProfile).toBe("desktop");
    });

    it("evaluates explicit producer role on mobile (preserves producer intent within platform limits)", () => {
      const baseCaps = resolveDeviceCapabilities({ isMobile: true });
      const caps = evaluateCompanionCapability({
        role: "producer",
        capabilities: baseCaps,
      });

      expect(caps.role).toBe("producer");
      expect(caps.isCompanion).toBe(false);
      expect(caps.isProducer).toBe(true);
      expect(caps.canConsumeArtifacts).toBe(true);
      expect(caps.canPerformDeltaSearch).toBe(true);
      // Base mobile capabilities govern actual write permissions
      expect(caps.canGenerateEmbeddings).toBe(baseCaps.canGenerateEmbeddings);
      expect(caps.canMaintainSharedIndex).toBe(baseCaps.canMaintainTextIndex);
      expect(caps.resourceProfile).toBe("mobile");
    });

    it("handles unassigned/neutral role on mobile by defaulting to companion behavior", () => {
      const caps = evaluateCompanionCapability({
        isMobile: true,
      });

      expect(caps.role).toBeUndefined();
      expect(caps.isCompanion).toBe(true);
      expect(caps.isProducer).toBe(false);
      expect(caps.canConsumeArtifacts).toBe(true);
      expect(caps.canPerformDeltaSearch).toBe(true);
      expect(caps.canGenerateEmbeddings).toBe(false);
      expect(caps.canMaintainSharedIndex).toBe(false);
      expect(caps.canMaintainBinaryCopy).toBe(false);
      expect(caps.resourceProfile).toBe("mobile");
    });

    it("handles unassigned/neutral role on desktop", () => {
      const caps = evaluateCompanionCapability({
        isMobile: false,
      });

      expect(caps.role).toBeUndefined();
      expect(caps.isCompanion).toBe(false);
      expect(caps.isProducer).toBe(true);
      expect(caps.canConsumeArtifacts).toBe(true);
      expect(caps.canPerformDeltaSearch).toBe(true);
      expect(caps.canGenerateEmbeddings).toBe(true);
      expect(caps.canMaintainSharedIndex).toBe(true);
      expect(caps.resourceProfile).toBe("desktop");
    });

    it("preserves strict producer vs companion separation", () => {
      const producerCaps = evaluateCompanionCapability({ role: "producer", isMobile: false });
      const companionCaps = evaluateCompanionCapability({ role: "companion", isMobile: false });

      expect(producerCaps.canGenerateEmbeddings).toBe(true);
      expect(companionCaps.canGenerateEmbeddings).toBe(false);

      expect(producerCaps.canMaintainSharedIndex).toBe(true);
      expect(companionCaps.canMaintainSharedIndex).toBe(false);

      expect(producerCaps.canMaintainBinaryCopy).toBe(true);
      expect(companionCaps.canMaintainBinaryCopy).toBe(false);
    });
  });
});
