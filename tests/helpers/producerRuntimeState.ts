import type { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";

/** Real-shaped runtime of an active Producer, for tests that need explicit device facts (LINA-15D-B / S2-c). */
export function activeProducerRuntime(overrides: Partial<DeviceRuntimeState> = {}): DeviceRuntimeState {
  return {
    deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
    effectiveRole: "producer",
    isActiveProducer: true,
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isStandbyProducer: false,
    isCompanion: false,
    isUnassigned: false,
    canPublish: true,
    canTransferOwnership: false,
    transferEligibilityReason: "already-active-producer",
    embeddings: {
      configured: true,
      textIndexAvailable: true,
      embeddingsDeclared: true,
      exists: true,
      vectorFileState: "available",
      provenance: { stale: false },
      compatibility: { compatible: true },
      contractState: "compatible",
      readiness: { loaded: true, runtimeReady: true },
      runtimeState: "ready",
      semanticAvailable: true,
      effectiveMode: "full",
    },
    ...overrides,
  };
}
