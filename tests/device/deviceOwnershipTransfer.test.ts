import { describe, expect, it, vi } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  saveOwnership,
  loadOwnership,
  type OwnershipManifest,
  OWNERSHIP_SCHEMA_VERSION,
} from "../../src/device/deviceOwnership";
import {
  transferOwnershipToDevice,
  type OwnershipTransferResult,
} from "../../src/device/deviceOwnershipTransfer";

describe("deviceOwnershipTransfer (Phase D2.5.1)", () => {
  const deviceA = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const deviceB = "550e8400-e29b-41d4-a716-446655440000";
  const deviceC = "123e4567-e89b-12d3-a456-426614174000";

  function createInitialManifest(activeId = deviceA, epoch = 1): OwnershipManifest {
    return {
      schemaVersion: OWNERSHIP_SCHEMA_VERSION,
      activeProducerId: activeId,
      epoch,
      acquiredAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      reason: "initial",
    };
  }

  describe("Successful Transfer", () => {
    it("transfers active producer ownership to target device and increments epoch by 1", async () => {
      const adapter = new FakeAdapter();
      const initial = createInitialManifest(deviceA, 1);
      await saveOwnership(adapter, initial);

      const result = await transferOwnershipToDevice(adapter, deviceB);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.manifest.activeProducerId).toBe(deviceB);
      expect(result.manifest.epoch).toBe(2);
      expect(result.manifest.reason).toBe("manual-transfer");
      expect(result.previousManifest.activeProducerId).toBe(deviceA);
      expect(result.previousManifest.epoch).toBe(1);

      // Verify persisted state in vault
      const persisted = await loadOwnership(adapter);
      expect(persisted).not.toBeNull();
      expect(persisted?.activeProducerId).toBe(deviceB);
      expect(persisted?.epoch).toBe(2);
      expect(persisted?.reason).toBe("manual-transfer");
    });

    it("supports sequential transfers across multiple devices preserving monotonic fencing", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createInitialManifest(deviceA, 5));

      // Transfer A -> B (epoch 5 -> 6)
      const res1 = await transferOwnershipToDevice(adapter, deviceB);
      expect(res1.success).toBe(true);
      if (res1.success) {
        expect(res1.manifest.epoch).toBe(6);
        expect(res1.manifest.activeProducerId).toBe(deviceB);
      }

      // Transfer B -> C (epoch 6 -> 7)
      const res2 = await transferOwnershipToDevice(adapter, deviceC);
      expect(res2.success).toBe(true);
      if (res2.success) {
        expect(res2.manifest.epoch).toBe(7);
        expect(res2.manifest.activeProducerId).toBe(deviceC);
      }

      // Transfer C -> A (epoch 7 -> 8)
      const res3 = await transferOwnershipToDevice(adapter, deviceA);
      expect(res3.success).toBe(true);
      if (res3.success) {
        expect(res3.manifest.epoch).toBe(8);
        expect(res3.manifest.activeProducerId).toBe(deviceA);
      }
    });

    it("succeeds when expectedEpoch matches the current manifest epoch", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createInitialManifest(deviceA, 3));

      const result = await transferOwnershipToDevice(adapter, deviceB, { expectedEpoch: 3 });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.manifest.activeProducerId).toBe(deviceB);
      expect(result.manifest.epoch).toBe(4);
    });

    it("successfully transfers ownership when current manifest has activeProducerId null (relinquished vault)", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, {
        schemaVersion: OWNERSHIP_SCHEMA_VERSION,
        activeProducerId: null,
        epoch: 8,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "relinquish",
      });

      const result = await transferOwnershipToDevice(adapter, deviceB);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.manifest.activeProducerId).toBe(deviceB);
      expect(result.manifest.epoch).toBe(9);
      expect(result.manifest.reason).toBe("manual-transfer");
      expect(result.previousManifest.activeProducerId).toBeNull();
      expect(result.previousManifest.epoch).toBe(8);

      const persisted = await loadOwnership(adapter);
      expect(persisted?.activeProducerId).toBe(deviceB);
      expect(persisted?.epoch).toBe(9);
      expect(persisted?.reason).toBe("manual-transfer");
    });
  });

  describe("Validation and Protection Rules", () => {
    it("fails with 'missing-ownership' when no ownership manifest exists", async () => {
      const adapter = new FakeAdapter();

      const result = await transferOwnershipToDevice(adapter, deviceB);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.reason).toBe("missing-ownership");
      // Must not auto-create manifest
      expect(await adapter.exists(".lina/ownership.json")).toBe(false);
    });

    it("fails with 'invalid-target-device' when target device ID is invalid", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createInitialManifest(deviceA, 1));

      const invalidIds = ["", "   ", "not-a-uuid", "12345", null as any, undefined as any];

      for (const invalidId of invalidIds) {
        const result = await transferOwnershipToDevice(adapter, invalidId);
        expect(result.success).toBe(false);
        if (result.success) continue;

        expect(result.reason).toBe("invalid-target-device");
      }

      // Manifest on disk must remain untouched
      const current = await loadOwnership(adapter);
      expect(current?.activeProducerId).toBe(deviceA);
      expect(current?.epoch).toBe(1);
    });

    it("fails with 'already-active-producer' when target device is already active producer", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createInitialManifest(deviceA, 2));

      const result = await transferOwnershipToDevice(adapter, deviceA);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.reason).toBe("already-active-producer");
      expect(result.currentManifest?.activeProducerId).toBe(deviceA);
      expect(result.currentManifest?.epoch).toBe(2);

      // Manifest on disk must remain unchanged (no epoch bump)
      const current = await loadOwnership(adapter);
      expect(current?.epoch).toBe(2);
      expect(current?.activeProducerId).toBe(deviceA);
    });

    it("fails with 'epoch-mismatch' when expectedEpoch does not match current epoch", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createInitialManifest(deviceA, 5));

      const result = await transferOwnershipToDevice(adapter, deviceB, { expectedEpoch: 4 });

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.reason).toBe("epoch-mismatch");
      expect(result.currentManifest?.epoch).toBe(5);

      // Manifest on disk must remain unchanged
      const current = await loadOwnership(adapter);
      expect(current?.activeProducerId).toBe(deviceA);
      expect(current?.epoch).toBe(5);
    });
  });

  describe("Persistence and Safety Invariants", () => {
    it("handles persistence failure gracefully and returns structured result", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createInitialManifest(deviceA, 1));

      // Simulate write error on temporary file
      const writeSpy = vi.spyOn(adapter, "write").mockRejectedValueOnce(new Error("Disk I/O failure"));

      const result = await transferOwnershipToDevice(adapter, deviceB);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.reason).toBe("persistence-failure");
      expect(result.error?.message).toBe("Disk I/O failure");
      expect(result.currentManifest?.activeProducerId).toBe(deviceA);

      writeSpy.mockRestore();
    });

    it("strictly isolates ownership transfer without modifying device role files or triggering workers", async () => {
      const adapter = new FakeAdapter();
      await saveOwnership(adapter, createInitialManifest(deviceA, 1));

      // Put a mock device profile file in .lina/devices/
      await adapter.write(
        `.lina/devices/${deviceA}.json`,
        JSON.stringify({ schemaVersion: 2, role: "producer" })
      );
      await adapter.write(
        `.lina/devices/${deviceB}.json`,
        JSON.stringify({ schemaVersion: 2, role: "companion" })
      );

      const result = await transferOwnershipToDevice(adapter, deviceB);
      expect(result.success).toBe(true);

      // Verify that device profiles were NOT altered
      const deviceAState = JSON.parse(await adapter.read(`.lina/devices/${deviceA}.json`));
      const deviceBState = JSON.parse(await adapter.read(`.lina/devices/${deviceB}.json`));

      expect(deviceAState.role).toBe("producer");
      expect(deviceBState.role).toBe("companion");

      // Verify no other files were created (no index changes, no worker side effects)
      const allFiles = Array.from(adapter.files.keys());
      expect(allFiles.sort()).toEqual([
        ".lina/devices/550e8400-e29b-41d4-a716-446655440000.json",
        ".lina/devices/c9bf9e57-1685-4c89-bafb-ff5af830be8a.json",
        ".lina/ownership.json",
      ]);
    });
  });
});
