import { describe, expect, it } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  claimInitialOwnership,
  getOwnershipPath,
  isOwnershipManifest,
  loadOwnership,
  saveOwnership,
  transferOwnership,
  OWNERSHIP_SCHEMA_VERSION,
  type OwnershipManifest,
} from "../../src/device/deviceOwnership";

describe("deviceOwnership (Phase D2.1)", () => {
  const validUuidA = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const validUuidB = "550e8400-e29b-41d4-a716-446655440000";
  const validUuidC = "123e4567-e89b-12d3-a456-426614174000";

  describe("getOwnershipPath", () => {
    it("returns canonical path .lina/ownership.json", () => {
      expect(getOwnershipPath()).toBe(".lina/ownership.json");
    });
  });

  describe("isOwnershipManifest schema validation", () => {
    it("validates well-formed OwnershipManifest objects", () => {
      const manifest: OwnershipManifest = {
        schemaVersion: OWNERSHIP_SCHEMA_VERSION,
        activeProducerId: validUuidA,
        epoch: 1,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };

      expect(isOwnershipManifest(manifest)).toBe(true);
    });

    it("validates manifest without optional reason", () => {
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: validUuidA,
        epoch: 3,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:30:00.000Z",
      };

      expect(isOwnershipManifest(manifest)).toBe(true);
    });

    it("validates manifests with manual-transfer and recovery-claim reasons", () => {
      const transfer: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: validUuidB,
        epoch: 2,
        acquiredAt: "2026-09-01T11:00:00.000Z",
        updatedAt: "2026-09-01T11:00:00.000Z",
        reason: "manual-transfer",
      };
      const recovery: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: validUuidB,
        epoch: 5,
        acquiredAt: "2026-09-01T11:00:00.000Z",
        updatedAt: "2026-09-01T11:00:00.000Z",
        reason: "recovery-claim",
      };

      expect(isOwnershipManifest(transfer)).toBe(true);
      expect(isOwnershipManifest(recovery)).toBe(true);
    });

    it("rejects invalid structures, nulls, and primitives", () => {
      expect(isOwnershipManifest(null)).toBe(false);
      expect(isOwnershipManifest(undefined)).toBe(false);
      expect(isOwnershipManifest("string")).toBe(false);
      expect(isOwnershipManifest(123)).toBe(false);
      expect(isOwnershipManifest([])).toBe(false);
      expect(isOwnershipManifest({})).toBe(false);
    });

    it("rejects invalid schema versions", () => {
      expect(
        isOwnershipManifest({
          schemaVersion: 2,
          activeProducerId: validUuidA,
          epoch: 1,
          acquiredAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        })
      ).toBe(false);
    });

    it("rejects invalid producer UUIDs", () => {
      expect(
        isOwnershipManifest({
          schemaVersion: 1,
          activeProducerId: "not-a-valid-uuid",
          epoch: 1,
          acquiredAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        })
      ).toBe(false);

      expect(
        isOwnershipManifest({
          schemaVersion: 1,
          activeProducerId: "",
          epoch: 1,
          acquiredAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        })
      ).toBe(false);
    });

    it("rejects non-integer, zero, or negative epochs", () => {
      const base = {
        schemaVersion: 1,
        activeProducerId: validUuidA,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      };

      expect(isOwnershipManifest({ ...base, epoch: 0 })).toBe(false);
      expect(isOwnershipManifest({ ...base, epoch: -1 })).toBe(false);
      expect(isOwnershipManifest({ ...base, epoch: 1.5 })).toBe(false);
      expect(isOwnershipManifest({ ...base, epoch: "1" })).toBe(false);
      expect(isOwnershipManifest({ ...base, epoch: NaN })).toBe(false);
      expect(isOwnershipManifest({ ...base, epoch: Infinity })).toBe(false);
    });

    it("rejects empty dates or invalid reasons", () => {
      const base = {
        schemaVersion: 1,
        activeProducerId: validUuidA,
        epoch: 1,
      };

      expect(isOwnershipManifest({ ...base, acquiredAt: "", updatedAt: "2026" })).toBe(false);
      expect(isOwnershipManifest({ ...base, acquiredAt: "2026", updatedAt: "   " })).toBe(false);
      expect(
        isOwnershipManifest({
          ...base,
          acquiredAt: "2026",
          updatedAt: "2026",
          reason: "unknown-reason",
        })
      ).toBe(false);
    });
  });

  describe("loadOwnership and saveOwnership", () => {
    it("returns null when ownership.json does not exist", async () => {
      const adapter = new FakeAdapter();
      const loaded = await loadOwnership(adapter);

      expect(loaded).toBeNull();
    });

    it("returns null when file is empty or corrupted", async () => {
      const adapter = new FakeAdapter();
      await adapter.write(getOwnershipPath(), "");
      expect(await loadOwnership(adapter)).toBeNull();

      await adapter.write(getOwnershipPath(), "not-json-content");
      expect(await loadOwnership(adapter)).toBeNull();

      await adapter.write(getOwnershipPath(), JSON.stringify({ invalid: true }));
      expect(await loadOwnership(adapter)).toBeNull();
    });

    it("atomically saves and reloads ownership manifest", async () => {
      const adapter = new FakeAdapter();
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: validUuidA,
        epoch: 1,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };

      await saveOwnership(adapter, manifest);

      expect(await adapter.exists(getOwnershipPath())).toBe(true);
      const loaded = await loadOwnership(adapter);
      expect(loaded).toEqual(manifest);
    });

    it("throws when saving an invalid manifest object", async () => {
      const adapter = new FakeAdapter();
      const invalid = { schemaVersion: 99 } as unknown as OwnershipManifest;

      await expect(saveOwnership(adapter, invalid)).rejects.toThrow("Cannot save invalid OwnershipManifest");
    });
  });

  describe("claimInitialOwnership", () => {
    it("successfully creates ownership manifest with epoch 1 and reason initial", async () => {
      const adapter = new FakeAdapter();
      const manifest = await claimInitialOwnership(adapter, validUuidA);

      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.activeProducerId).toBe(validUuidA);
      expect(manifest.epoch).toBe(1);
      expect(manifest.reason).toBe("initial");
      expect(new Date(manifest.acquiredAt).getTime()).toBeGreaterThan(0);
      expect(new Date(manifest.updatedAt).getTime()).toBeGreaterThan(0);

      const reloaded = await loadOwnership(adapter);
      expect(reloaded).toEqual(manifest);
    });

    it("throws and does NOT overwrite when ownership manifest already exists", async () => {
      const adapter = new FakeAdapter();
      const initial = await claimInitialOwnership(adapter, validUuidA);

      await expect(claimInitialOwnership(adapter, validUuidB)).rejects.toThrow(
        /ownership manifest already exists/i
      );

      const loaded = await loadOwnership(adapter);
      expect(loaded).toEqual(initial);
      expect(loaded?.activeProducerId).toBe(validUuidA);
      expect(loaded?.epoch).toBe(1);
    });

    it("throws when provided with an invalid deviceId", async () => {
      const adapter = new FakeAdapter();
      await expect(claimInitialOwnership(adapter, "not-valid-id")).rejects.toThrow(
        /invalid deviceId/i
      );
    });
  });

  describe("transferOwnership", () => {
    it("increments epoch and updates activeProducerId on transfer", async () => {
      const adapter = new FakeAdapter();
      const initial = await claimInitialOwnership(adapter, validUuidA);
      expect(initial.epoch).toBe(1);

      const transferred = await transferOwnership(adapter, validUuidB);
      expect(transferred.activeProducerId).toBe(validUuidB);
      expect(transferred.epoch).toBe(2);
      expect(transferred.reason).toBe("manual-transfer");

      const loaded = await loadOwnership(adapter);
      expect(loaded).toEqual(transferred);
    });

    it("supports sequential multi-step transfers maintaining monotonic epoch", async () => {
      const adapter = new FakeAdapter();
      await claimInitialOwnership(adapter, validUuidA); // epoch 1

      const transfer1 = await transferOwnership(adapter, validUuidB); // epoch 2
      expect(transfer1.epoch).toBe(2);
      expect(transfer1.activeProducerId).toBe(validUuidB);

      const transfer2 = await transferOwnership(adapter, validUuidC); // epoch 3
      expect(transfer2.epoch).toBe(3);
      expect(transfer2.activeProducerId).toBe(validUuidC);

      const transfer3 = await transferOwnership(adapter, validUuidA, undefined, "recovery-claim"); // epoch 4
      expect(transfer3.epoch).toBe(4);
      expect(transfer3.activeProducerId).toBe(validUuidA);
      expect(transfer3.reason).toBe("recovery-claim");
    });

    it("enforces expectedCurrentEpoch match when provided", async () => {
      const adapter = new FakeAdapter();
      await claimInitialOwnership(adapter, validUuidA); // epoch 1

      // Matching expected epoch succeeds
      const successfulTransfer = await transferOwnership(adapter, validUuidB, 1);
      expect(successfulTransfer.epoch).toBe(2);

      // Stale expected epoch (expecting 1, but now epoch is 2) fails and does not mutate
      await expect(transferOwnership(adapter, validUuidC, 1)).rejects.toThrow(
        /Ownership epoch mismatch/i
      );

      const loaded = await loadOwnership(adapter);
      expect(loaded?.activeProducerId).toBe(validUuidB);
      expect(loaded?.epoch).toBe(2);
    });

    it("creates epoch 1 when transfer is performed on a vault with no existing ownership", async () => {
      const adapter = new FakeAdapter();
      const transfer = await transferOwnership(adapter, validUuidB);

      expect(transfer.epoch).toBe(1);
      expect(transfer.activeProducerId).toBe(validUuidB);
      expect(transfer.reason).toBe("manual-transfer");
    });

    it("rejects transfer with invalid deviceId", async () => {
      const adapter = new FakeAdapter();
      await expect(transferOwnership(adapter, "invalid-uuid")).rejects.toThrow(
        /invalid deviceId/i
      );
    });
  });
});
