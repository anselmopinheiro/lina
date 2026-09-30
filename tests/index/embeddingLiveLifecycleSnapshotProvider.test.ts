import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { deriveEmbeddingWritePathDecision } from "../../src/index/embeddingLifecycleWritePath";
import type { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import type { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { FakeAdapter } from "../helpers/fakeAdapter";

function producerRuntime(): DeviceRuntimeState {
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
  };
}

function operation(overrides: Partial<EmbeddingOperationState>): EmbeddingOperationState {
  return {
    operationId: 1,
    origin: "command",
    status: "idle",
    startedAt: null,
    finishedAt: null,
    message: null,
    error: null,
    phase: null,
    totalChunks: null,
    processedChunks: 0,
    generatedChunks: 0,
    failedChunks: 0,
    reusedChunks: 0,
    percentage: null,
    currentChunk: null,
    cancelRequestedAt: null,
    ...overrides,
  };
}

async function createPlugin(authorized: boolean, state: EmbeddingOperationState) {
  const app = new App();
  app.vault.adapter = new FakeAdapter({});
  const plugin = new LinaPlugin(app);
  await plugin.loadDataFromDisk();
  vi.spyOn(plugin, "getDeviceRuntimeState").mockReturnValue(producerRuntime());
  vi.spyOn(plugin.getOwnershipGate(), "isAuthorizedSync").mockReturnValue(authorized);
  vi.spyOn(plugin.getMaintenanceEngine(), "getEmbeddingOperationState").mockReturnValue(state);
  return plugin;
}

describe("LinaPlugin.getEmbeddingLifecycleSnapshot — live composition (LINA-14F.4-B4.0-C)", () => {
  it("reflects the live operation phase instead of the cached idle snapshot", async () => {
    const plugin = await createPlugin(true, operation({ status: "running", phase: "persisting" }));
    const snapshot = plugin.getEmbeddingLifecycleSnapshot();
    expect(snapshot.primary).toBe("UPDATING");
    expect(snapshot.process.phase).toBe("persisting");
    expect(snapshot.process.cancellable).toBe(false);
  });

  it("overlays live ownership loss: an active operation becomes ownershipLostDuringOperation", async () => {
    const plugin = await createPlugin(false, operation({ status: "running", phase: "generating" }));
    const decision = deriveEmbeddingWritePathDecision(plugin.getEmbeddingLifecycleSnapshot());
    expect(decision.ownershipLostDuringOperation).toBe(true);
  });

  it("does not report lost authority while the gate still authorises the producer", async () => {
    const plugin = await createPlugin(true, operation({ status: "running", phase: "generating" }));
    const decision = deriveEmbeddingWritePathDecision(plugin.getEmbeddingLifecycleSnapshot());
    expect(decision.ownershipLostDuringOperation).toBe(false);
  });

  it("keeps an unreadable plan INDETERMINATE instead of falling back to 'no work'", async () => {
    const plugin = await createPlugin(true, operation({ status: "idle" }));
    const controller = (plugin as unknown as {
      getEmbeddingWorkStatusController(): { getState(): unknown };
    }).getEmbeddingWorkStatusController();
    vi.spyOn(controller, "getState").mockReturnValue({
      status: "ready",
      revision: 3,
      summary: { detailsAvailable: false, canonicalReadability: "unreadable" },
    });
    const snapshot = plugin.getEmbeddingLifecycleSnapshot();
    expect(snapshot.primary).toBe("INDETERMINATE");
  });

  it("a blocked Worker request never reaches the coordinator for an indeterminate state", async () => {
    const plugin = await createPlugin(true, operation({ status: "idle" }));
    const controller = (plugin as unknown as {
      getEmbeddingWorkStatusController(): { getState(): unknown };
    }).getEmbeddingWorkStatusController();
    vi.spyOn(controller, "getState").mockReturnValue({
      status: "ready",
      revision: 1,
      summary: { detailsAvailable: false, canonicalReadability: "unreadable" },
    });
    const result = plugin.requestEmbeddingIndexGeneration("command");
    expect(result.status).toBe("not-capable");
  });
});
