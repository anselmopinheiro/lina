import { describe, expect, it } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";

describe("device capabilities", () => {
  it("resolves the complete desktop producer profile", () => {
    expect(resolveDeviceCapabilities({ isMobile: false })).toEqual({
      role: "producer",
      resourceProfile: "desktop",
      canWatchVaultEvents: true,
      canMaintainTextIndex: true,
      canGenerateEmbeddings: true,
      canMaintainBinaryCopy: true,
      canReconcileStartupDiffs: true,
      canReadArtifacts: true,
      canExecuteSearch: true,
    });
  });

  it("resolves the mobile companion profile while retaining artifact reads and search", () => {
    expect(resolveDeviceCapabilities({ isMobile: true })).toEqual({
      role: "companion",
      resourceProfile: "mobile",
      canWatchVaultEvents: false,
      canMaintainTextIndex: false,
      canGenerateEmbeddings: false,
      canMaintainBinaryCopy: false,
      canReconcileStartupDiffs: false,
      canReadArtifacts: true,
      canExecuteSearch: true,
    });
  });
});
