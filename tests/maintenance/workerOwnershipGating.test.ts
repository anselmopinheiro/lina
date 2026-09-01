import { describe, expect, it, vi } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { TextIndexWorker } from "../../src/maintenance/textIndexWorker";
import { ReconciliationWorker } from "../../src/maintenance/reconciliationWorker";
import { EmbeddingWorker } from "../../src/maintenance/embeddingWorker";
import { BinaryWorker } from "../../src/maintenance/binaryWorker";
import { MaintenanceEngine } from "../../src/maintenance/maintenanceEngine";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { claimInitialOwnership } from "../../src/device/deviceOwnership";
import { OwnershipGate } from "../../src/device/ownershipGate";

describe("worker ownership gating (Phase D2.2)", () => {
  const localDeviceId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const remoteDeviceId = "550e8400-e29b-41d4-a716-446655440000";

  describe("TextIndexWorker gating", () => {
    it("flushes automatic batches when ownership is authorized", async () => {
      const runAutomaticBatch = vi.fn(async () => true);
      const worker = new TextIndexWorker({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        isAutomaticUpdateEnabled: () => true,
        canPublish: async () => true,
        subscribeVaultEvent: () => () => {},
        onVaultEvent: () => {},
        runAutomaticBatch,
        timers: { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() },
      });

      worker.setAutomaticUpdatesReady(true);
      worker.queueAutomaticIndexUpdate({
        changeType: "modify",
        path: "note.md",
        receivedAt: new Date().toISOString(),
      });

      await worker.processPendingAutomaticUpdates(true);
      expect(runAutomaticBatch).toHaveBeenCalledOnce();
    });

    it("skips batch flushing without error when device is a standby producer", async () => {
      const runAutomaticBatch = vi.fn(async () => true);
      const worker = new TextIndexWorker({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        isAutomaticUpdateEnabled: () => true,
        canPublish: async () => false, // Standby producer blocked
        subscribeVaultEvent: () => () => {},
        onVaultEvent: () => {},
        runAutomaticBatch,
        timers: { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() },
      });

      worker.setAutomaticUpdatesReady(true);
      worker.queueAutomaticIndexUpdate({
        changeType: "modify",
        path: "note.md",
        receivedAt: new Date().toISOString(),
      });

      await worker.processPendingAutomaticUpdates(true);
      expect(runAutomaticBatch).not.toHaveBeenCalled();
      // Pending updates are preserved, not cleared or lost
      expect(worker.getPendingAutomaticUpdates().size).toBe(1);
    });
  });

  describe("ReconciliationWorker gating", () => {
    it("runs startup reconciliation when ownership is authorized", async () => {
      const runStartup = vi.fn(async () => {});
      const worker = new ReconciliationWorker({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        canPublish: async () => true,
        runStartupReconciliation: runStartup,
        runStartupBinaryArtifactMigration: async () => {},
        runExclusionReconciliation: async () => {},
        waitForAutomaticUpdates: async () => {},
      });

      worker.start();
      const result = await worker.runStartupReconciliation();

      expect(result).toBe(true);
      expect(runStartup).toHaveBeenCalledOnce();
    });

    it("skips startup reconciliation safely when device is a standby producer", async () => {
      const runStartup = vi.fn(async () => {});
      const worker = new ReconciliationWorker({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        canPublish: async () => false, // Standby producer blocked
        runStartupReconciliation: runStartup,
        runStartupBinaryArtifactMigration: async () => {},
        runExclusionReconciliation: async () => {},
        waitForAutomaticUpdates: async () => {},
      });

      worker.start();
      const result = await worker.runStartupReconciliation();

      expect(result).toBe(false);
      expect(runStartup).not.toHaveBeenCalled();
      expect(worker.getState().status).toBe("idle");
    });
  });

  describe("EmbeddingWorker gating", () => {
    it("rejects embedding generation requests with not-active-producer when not authorized", async () => {
      const generateService = vi.fn(async () => ({ success: true }));
      const worker = new EmbeddingWorker({
        capabilities: {
          canGenerateEmbeddings: () => true,
          canPublish: () => false, // Standby producer blocked
        },
        canPublish: () => false,
        isTextIndexBusy: () => false,
        coordinator: {
          requestPreparation: () => ({ status: "accepted", state: { activeOperation: null, activeStartedAt: null, embeddingGenerationRequested: true, disposed: false } }),
          cancelPreparation: () => {},
          startGeneration: () => ({ status: "accepted", state: { activeOperation: null, activeStartedAt: null, embeddingGenerationRequested: false, disposed: false } }),
          finish: () => {},
        },
        generationService: { generate: generateService },
        persistence: { onGenerationFinalized: () => {} },
        statusNotifications: { notify: () => {} },
        binaryHandoff: { maintainAfterPublication: () => {} },
        messages: {
          preparing: "preparing",
          waitingForTextIndex: "waiting",
          cancelled: "cancelled",
          blockedByTextIndex: () => "blocked",
          generalError: "error",
          cancelling: "cancelling",
        },
      });

      const request = worker.requestGeneration("manual");
      expect(request.status).toBe("not-active-producer");
      expect(generateService).not.toHaveBeenCalled();
    });
  });

  describe("BinaryWorker gating", () => {
    it("allows createOrUpdate when ownership is authorized", async () => {
      const createOrUpdate = vi.fn(async () => ({ status: "valid" as const }));
      const worker = new BinaryWorker({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        canPublish: async () => true,
        check: async () => ({ status: "valid" }),
        createOrUpdate,
        remove: async () => {},
        maintainAfterPublication: async () => ({ status: "valid" }),
        onBinaryPublicationReady: () => {},
        onAutomaticMaintenanceFailure: () => {},
      });

      worker.start();
      const result = await worker.createOrUpdate();

      expect(result).toEqual({ status: "valid" });
      expect(createOrUpdate).toHaveBeenCalledOnce();
    });

    it("skips createOrUpdate when device is a standby producer", async () => {
      const createOrUpdate = vi.fn(async () => ({ status: "valid" as const }));
      const worker = new BinaryWorker({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        canPublish: async () => false, // Standby producer blocked
        check: async () => ({ status: "valid" }),
        createOrUpdate,
        remove: async () => {},
        maintainAfterPublication: async () => ({ status: "valid" }),
        onBinaryPublicationReady: () => {},
        onAutomaticMaintenanceFailure: () => {},
      });

      worker.start();
      const result = await worker.createOrUpdate();

      expect(result).toBeUndefined();
      expect(createOrUpdate).not.toHaveBeenCalled();
    });

    it("keeps check() read-only and available to standby producers and companions", async () => {
      const check = vi.fn(async () => ({ status: "valid" as const }));
      const worker = new BinaryWorker({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        canPublish: async () => false, // Standby producer
        check,
        createOrUpdate: async () => ({ status: "valid" }),
        remove: async () => {},
        maintainAfterPublication: async () => ({ status: "valid" }),
        onBinaryPublicationReady: () => {},
        onAutomaticMaintenanceFailure: () => {},
      });

      const summary = await worker.check();
      expect(summary).toEqual({ status: "valid" });
      expect(check).toHaveBeenCalledOnce();
    });
  });

  describe("MaintenanceEngine end-to-end integration", () => {
    it("coordinates ownership with all workers through OwnershipGate", async () => {
      const adapter = new FakeAdapter();
      // Remote device is active producer
      await claimInitialOwnership(adapter, remoteDeviceId);

      const gate = new OwnershipGate(
        adapter,
        () => localDeviceId,
        () => "producer",
        true
      );

      const engine = new MaintenanceEngine({
        capabilities: resolveDeviceCapabilities({ isMobile: false }),
        canPublish: () => gate.canPublish(),
      });

      expect(await engine.canPublish()).toBe(false);
    });
  });
});
