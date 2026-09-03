import { describe, expect, it, vi } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  saveOwnership,
  loadOwnership,
  type OwnershipManifest,
  OWNERSHIP_SCHEMA_VERSION,
} from "../../src/device/deviceOwnership";
import {
  prepareOwnershipTransferPreview,
  confirmAndExecuteOwnershipTransfer,
  isOwnershipTransferPreview,
  type OwnershipTransferPreview,
} from "../../src/device/ownershipTransferSafety";

describe("ownershipTransferSafety (Phase D2.5.2)", () => {
  const deviceA = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const deviceB = "550e8400-e29b-41d4-a716-446655440000";
  const deviceC = "123e4567-e89b-12d3-a456-426614174000";

  function createManifest(activeId = deviceA, epoch = 1): OwnershipManifest {
    return {
      schemaVersion: OWNERSHIP_SCHEMA_VERSION,
      activeProducerId: activeId,
      epoch,
      acquiredAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      reason: "initial",
    };
  }

  describe("Preview Generation (prepareOwnershipTransferPreview)", () => {
    it("generates a valid transfer preview without modifying the filesystem", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 3));

      const writeSpy = vi.spyOn(adapter, "write");
      const renameSpy = vi.spyOn(adapter, "rename");
      const removeSpy = vi.spyOn(adapter, "remove");

      const result = await prepareOwnershipTransferPreview(adapter, deviceB);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.preview.currentProducerId).toBe(deviceA);
      expect(result.preview.targetProducerId).toBe(deviceB);
      expect(result.preview.currentEpoch).toBe(3);
      expect(result.preview.nextEpoch).toBe(4);
      expect(result.preview.reason).toBe("manual-transfer");
      expect(result.preview.requiresConfirmation).toBe(true);
      expect(typeof result.preview.preparedAt).toBe("string");

      // Verify ZERO filesystem mutations during preview
      expect(writeSpy).not.toHaveBeenCalled();
      expect(renameSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();

      // Verify on-disk manifest remained at epoch 3 with deviceA
      const onDisk = await loadOwnership(adapter);
      expect(onDisk?.activeProducerId).toBe(deviceA);
      expect(onDisk?.epoch).toBe(3);
    });

    it("fails with 'missing-ownership' when no ownership manifest exists", async () => {
      const adapter = new FakeAdapter();

      const result = await prepareOwnershipTransferPreview(adapter, deviceB);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.reason).toBe("missing-ownership");
      expect(await adapter.exists(".lina/ownership.json")).toBe(false);
    });

    it("fails with 'invalid-target-device' when target device ID is malformed", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 1));

      const invalidIds = ["", "   ", "not-a-uuid", "123", null as any, undefined as any];

      for (const invalidId of invalidIds) {
        const result = await prepareOwnershipTransferPreview(adapter, invalidId);
        expect(result.success).toBe(false);
        if (result.success) continue;

        expect(result.reason).toBe("invalid-target-device");
      }
    });

    it("fails with 'already-active-producer' when target device is already the active producer", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 2));

      const result = await prepareOwnershipTransferPreview(adapter, deviceA);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.reason).toBe("already-active-producer");
    });
  });

  describe("Schema Validation (isOwnershipTransferPreview)", () => {
    it("validates well-formed preview objects", () => {
      const preview: OwnershipTransferPreview = {
        currentProducerId: deviceA,
        targetProducerId: deviceB,
        currentEpoch: 5,
        nextEpoch: 6,
        reason: "manual-transfer",
        requiresConfirmation: true,
        preparedAt: "2026-09-01T12:00:00.000Z",
      };

      expect(isOwnershipTransferPreview(preview)).toBe(true);
    });

    it("validates well-formed preview objects with undefined currentProducerId (relinquished vault)", () => {
      const preview: OwnershipTransferPreview = {
        currentProducerId: undefined,
        targetProducerId: deviceB,
        currentEpoch: 5,
        nextEpoch: 6,
        reason: "manual-transfer",
        requiresConfirmation: true,
        preparedAt: "2026-09-01T12:00:00.000Z",
      };

      expect(isOwnershipTransferPreview(preview)).toBe(true);
    });

    it("rejects invalid preview objects", () => {
      expect(isOwnershipTransferPreview(null)).toBe(false);
      expect(isOwnershipTransferPreview({})).toBe(false);

      // Same current and target device
      expect(
        isOwnershipTransferPreview({
          currentProducerId: deviceA,
          targetProducerId: deviceA,
          currentEpoch: 1,
          nextEpoch: 2,
          reason: "manual-transfer",
          requiresConfirmation: true,
          preparedAt: "2026-09-01T12:00:00.000Z",
        })
      ).toBe(false);

      // Non-monotonic epoch
      expect(
        isOwnershipTransferPreview({
          currentProducerId: deviceA,
          targetProducerId: deviceB,
          currentEpoch: 5,
          nextEpoch: 5,
          reason: "manual-transfer",
          requiresConfirmation: true,
          preparedAt: "2026-09-01T12:00:00.000Z",
        })
      ).toBe(false);

      // Missing requiresConfirmation
      expect(
        isOwnershipTransferPreview({
          currentProducerId: deviceA,
          targetProducerId: deviceB,
          currentEpoch: 5,
          nextEpoch: 6,
          reason: "manual-transfer",
          requiresConfirmation: false,
          preparedAt: "2026-09-01T12:00:00.000Z",
        })
      ).toBe(false);
    });
  });

  describe("Confirmation & Execution (confirmAndExecuteOwnershipTransfer)", () => {
    it("executes transfer atomically when confirmed with valid preview", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 1));

      const previewRes = await prepareOwnershipTransferPreview(adapter, deviceB);
      expect(previewRes.success).toBe(true);
      if (!previewRes.success) return;

      const execRes = await confirmAndExecuteOwnershipTransfer(adapter, previewRes.preview, {
        confirmed: true,
      });

      expect(execRes.success).toBe(true);
      if (!execRes.success) return;

      expect(execRes.manifest.activeProducerId).toBe(deviceB);
      expect(execRes.manifest.epoch).toBe(2);
      expect(execRes.manifest.reason).toBe("manual-transfer");
      expect(execRes.previousManifest.activeProducerId).toBe(deviceA);
      expect(execRes.previousManifest.epoch).toBe(1);

      // Verify on-disk manifest
      const onDisk = await loadOwnership(adapter);
      expect(onDisk?.activeProducerId).toBe(deviceB);
      expect(onDisk?.epoch).toBe(2);
    });

    it("executes transfer atomically when confirmed from a relinquished vault (activeProducerId is null)", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, {
        schemaVersion: OWNERSHIP_SCHEMA_VERSION,
        activeProducerId: null,
        epoch: 7,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "relinquish",
      });

      const previewRes = await prepareOwnershipTransferPreview(adapter, deviceB);
      expect(previewRes.success).toBe(true);
      if (!previewRes.success) return;

      expect(previewRes.preview.currentProducerId).toBeUndefined();
      expect(previewRes.preview.currentEpoch).toBe(7);
      expect(previewRes.preview.nextEpoch).toBe(8);

      const execRes = await confirmAndExecuteOwnershipTransfer(adapter, previewRes.preview, {
        confirmed: true,
      });

      expect(execRes.success).toBe(true);
      if (!execRes.success) return;

      expect(execRes.manifest.activeProducerId).toBe(deviceB);
      expect(execRes.manifest.epoch).toBe(8);
      expect(execRes.manifest.reason).toBe("manual-transfer");
      expect(execRes.previousManifest.activeProducerId).toBeNull();
      expect(execRes.previousManifest.epoch).toBe(7);

      const onDisk = await loadOwnership(adapter);
      expect(onDisk?.activeProducerId).toBe(deviceB);
      expect(onDisk?.epoch).toBe(8);
      expect(onDisk?.reason).toBe("manual-transfer");
    });

    it("rejects execution with 'confirmation-required' when confirmed is false or missing", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 1));

      const previewRes = await prepareOwnershipTransferPreview(adapter, deviceB);
      expect(previewRes.success).toBe(true);
      if (!previewRes.success) return;

      // 1. confirmed: false
      const unconfirmedRes = await confirmAndExecuteOwnershipTransfer(adapter, previewRes.preview, {
        confirmed: false,
      });
      expect(unconfirmedRes.success).toBe(false);
      if (!unconfirmedRes.success) {
        expect(unconfirmedRes.reason).toBe("confirmation-required");
      }

      // 2. null/undefined confirmation
      const nullRes = await confirmAndExecuteOwnershipTransfer(adapter, previewRes.preview, null as any);
      expect(nullRes.success).toBe(false);
      if (!nullRes.success) {
        expect(nullRes.reason).toBe("confirmation-required");
      }

      // On-disk manifest must remain unchanged
      const onDisk = await loadOwnership(adapter);
      expect(onDisk?.activeProducerId).toBe(deviceA);
      expect(onDisk?.epoch).toBe(1);
    });

    it("rejects execution with 'invalid-preview' when preview object is corrupted", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 1));

      const corruptedPreview: any = {
        currentProducerId: deviceA,
        targetProducerId: "not-a-valid-uuid",
        currentEpoch: 1,
        nextEpoch: 2,
        reason: "manual-transfer",
        requiresConfirmation: true,
        preparedAt: "2026-09-01T12:00:00.000Z",
      };

      const result = await confirmAndExecuteOwnershipTransfer(adapter, corruptedPreview, {
        confirmed: true,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("invalid-preview");
      }
    });

    it("rejects execution with 'epoch-mismatch' when manifest on disk was updated concurrently", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 1));

      // Generate preview at epoch 1
      const previewRes = await prepareOwnershipTransferPreview(adapter, deviceB);
      expect(previewRes.success).toBe(true);
      if (!previewRes.success) return;

      // Concurrent change occurs on disk (e.g. transferred to deviceC at epoch 2)
      await saveOwnership(adapter, {
        schemaVersion: OWNERSHIP_SCHEMA_VERSION,
        activeProducerId: deviceC,
        epoch: 2,
        acquiredAt: "2026-09-01T11:00:00.000Z",
        updatedAt: "2026-09-01T11:00:00.000Z",
        reason: "manual-transfer",
      });

      // Attempt to execute the stale preview (which expected epoch 1)
      const execRes = await confirmAndExecuteOwnershipTransfer(adapter, previewRes.preview, {
        confirmed: true,
      });

      expect(execRes.success).toBe(false);
      if (!execRes.success) {
        expect(execRes.reason).toBe("epoch-mismatch");
        expect(execRes.currentManifest?.epoch).toBe(2);
        expect(execRes.currentManifest?.activeProducerId).toBe(deviceC);
      }

      // On-disk manifest remains at epoch 2 with deviceC
      const onDisk = await loadOwnership(adapter);
      expect(onDisk?.activeProducerId).toBe(deviceC);
      expect(onDisk?.epoch).toBe(2);
    });
  });

  describe("Safety Invariants & Non-Mutation Guarantees", () => {
    it("preserves device role files and produces zero worker side-effects", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createManifest(deviceA, 1));

      await adapter.write(
        `.lina/devices/${deviceA}.json`,
        JSON.stringify({ schemaVersion: 2, role: "producer" })
      );
      await adapter.write(
        `.lina/devices/${deviceB}.json`,
        JSON.stringify({ schemaVersion: 2, role: "companion" })
      );

      const previewRes = await prepareOwnershipTransferPreview(adapter, deviceB);
      expect(previewRes.success).toBe(true);
      if (!previewRes.success) return;

      const execRes = await confirmAndExecuteOwnershipTransfer(adapter, previewRes.preview, {
        confirmed: true,
      });
      expect(execRes.success).toBe(true);

      // Role files must remain 100% identical
      const stateA = JSON.parse(await adapter.read(`.lina/devices/${deviceA}.json`));
      const stateB = JSON.parse(await adapter.read(`.lina/devices/${deviceB}.json`));

      expect(stateA.role).toBe("producer");
      expect(stateB.role).toBe("companion");

      // Verify file state (device roles unchanged, ownership and history created)
      const allFiles = Array.from(adapter.files.keys()).sort();
      expect(allFiles).toEqual([
        ".lina/devices/550e8400-e29b-41d4-a716-446655440000.json",
        ".lina/devices/c9bf9e57-1685-4c89-bafb-ff5af830be8a.json",
        ".lina/ownership-history/001.json",
        ".lina/ownership.json",
      ]);
    });
  });
});
