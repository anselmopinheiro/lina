import { Platform } from "obsidian";

/**
 * The role a device is prepared to take in Lina's future producer/companion
 * architecture. The role is descriptive only in this foundation phase.
 */
export type DeviceRole = "producer" | "companion";

export type DeviceResourceProfile = "desktop" | "mobile";

export interface DevicePlatform {
  readonly isMobile: boolean;
}

/**
 * Capabilities resolved for the current host device.
 *
 * Maintenance flags deliberately have no enforcement side effects yet. They
 * provide the single capability seam that later phases will use to gate
 * producer-only operations without scattering host-platform checks.
 */
export interface DeviceCapabilities {
  readonly role: DeviceRole;
  readonly resourceProfile: DeviceResourceProfile;
  readonly canWatchVaultEvents: boolean;
  readonly canMaintainTextIndex: boolean;
  readonly canGenerateEmbeddings: boolean;
  readonly canMaintainBinaryCopy: boolean;
  readonly canReconcileStartupDiffs: boolean;
  readonly canReadArtifacts: boolean;
  readonly canExecuteSearch: boolean;
}

/**
 * Resolves a capability profile from an injected host platform.
 * Injection keeps the capability rules independently testable.
 */
export function resolveDeviceCapabilities(platform: DevicePlatform): DeviceCapabilities {
  const isProducer = !platform.isMobile;

  return {
    role: isProducer ? "producer" : "companion",
    resourceProfile: platform.isMobile ? "mobile" : "desktop",
    canWatchVaultEvents: isProducer,
    canMaintainTextIndex: isProducer,
    canGenerateEmbeddings: isProducer,
    canMaintainBinaryCopy: isProducer,
    canReconcileStartupDiffs: isProducer,
    canReadArtifacts: true,
    canExecuteSearch: true,
  };
}

/**
 * Preferred production entry point for device capability decisions.
 */
export function getDeviceCapabilities(): DeviceCapabilities {
  return resolveDeviceCapabilities(Platform);
}
