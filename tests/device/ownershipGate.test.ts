import { describe, expect, it } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  evaluateOwnershipGate,
  OwnershipGate,
} from "../../src/device/ownershipGate";
import {
  claimInitialOwnership,
  saveOwnership,
  type OwnershipManifest,
} from "../../src/device/deviceOwnership";

describe("ownershipGate (Phase D2.2)", () => {
  const localDeviceId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const remoteDeviceId = "550e8400-e29b-41d4-a716-446655440000";

  describe("evaluateOwnershipGate", () => {
    it("authorizes an active producer matching the manifest at current epoch", async () => {
      const adapter = new FakeAdapter();
      await claimInitialOwnership(adapter, localDeviceId);

      const decision = await evaluateOwnershipGate(adapter, localDeviceId, "producer");
      expect(decision.authorized).toBe(true);
      expect(decision.status).toBe("authorized");
      expect(decision.activeProducerId).toBe(localDeviceId);
      expect(decision.epoch).toBe(1);
    });

    it("blocks a standby producer when another device owns the manifest", async () => {
      const adapter = new FakeAdapter();
      await claimInitialOwnership(adapter, remoteDeviceId);

      const decision = await evaluateOwnershipGate(adapter, localDeviceId, "producer");
      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("standby-producer");
      expect(decision.activeProducerId).toBe(remoteDeviceId);
      expect(decision.epoch).toBe(1);
    });

    it("blocks companion devices from publishing even if ownership is unclaimed", async () => {
      const adapter = new FakeAdapter();
      const decision = await evaluateOwnershipGate(adapter, localDeviceId, "companion");

      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("not-producer-role");
    });

    it("blocks unassigned devices from publishing", async () => {
      const adapter = new FakeAdapter();
      const decision = await evaluateOwnershipGate(adapter, localDeviceId, undefined);

      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("not-producer-role");
    });

    it("blocks a producer when epoch does not match expected epoch", async () => {
      const adapter = new FakeAdapter();
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: localDeviceId,
        epoch: 3,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      };
      await saveOwnership(adapter, manifest);

      // Expecting stale epoch 2 while manifest is at epoch 3
      const decision = await evaluateOwnershipGate(adapter, localDeviceId, "producer", 2);
      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("epoch-mismatch");
      expect(decision.epoch).toBe(3);
    });

    it("auto-claims initial ownership when unclaimed and autoClaim is true", async () => {
      const adapter = new FakeAdapter();
      const decision = await evaluateOwnershipGate(
        adapter,
        localDeviceId,
        "producer",
        undefined,
        { autoClaimIfUnclaimed: true }
      );

      expect(decision.authorized).toBe(true);
      expect(decision.status).toBe("authorized");
      expect(decision.epoch).toBe(1);
      expect(decision.activeProducerId).toBe(localDeviceId);
    });

    it("returns unclaimed-ownership when autoClaim is false and ownership is missing", async () => {
      const adapter = new FakeAdapter();
      const decision = await evaluateOwnershipGate(
        adapter,
        localDeviceId,
        "producer",
        undefined,
        { autoClaimIfUnclaimed: false }
      );

      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("unclaimed-ownership");
    });

    it("rejects invalid local device ID", async () => {
      const adapter = new FakeAdapter();
      const decision = await evaluateOwnershipGate(adapter, "invalid-id", "producer");

      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("invalid-device-id");
    });
  });

  describe("OwnershipGate class", () => {
    it("caches last decision and updates sync status", async () => {
      const adapter = new FakeAdapter();
      let currentRole: "producer" | "companion" = "companion";

      const gate = new OwnershipGate(
        adapter,
        () => localDeviceId,
        () => currentRole,
        true
      );

      expect(gate.isAuthorizedSync()).toBe(false);

      currentRole = "producer";
      const canPublish = await gate.canPublish();
      expect(canPublish).toBe(true);
      expect(gate.isAuthorizedSync()).toBe(true);
      expect(gate.getLastDecision()?.status).toBe("authorized");

      // Switch role back to companion
      currentRole = "companion";
      const secondCheck = await gate.canPublish();
      expect(secondCheck).toBe(false);
      expect(gate.isAuthorizedSync()).toBe(false);
      expect(gate.getLastDecision()?.status).toBe("not-producer-role");
    });

    it("prevents unassigned device from auto-claiming or publishing", async () => {
      const adapter = new FakeAdapter();
      const gate = new OwnershipGate(
        adapter,
        () => localDeviceId,
        () => undefined, // Unassigned role
        true // autoClaim enabled
      );

      expect(gate.isAuthorizedSync()).toBe(false);

      const decision = await gate.evaluate();
      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("not-producer-role");
      expect(adapter.hasFile(".lina/ownership.json")).toBe(false);
      expect(gate.isAuthorizedSync()).toBe(false);
      expect(await gate.canPublish()).toBe(false);
    });

    it("allows legacy-fallback producer to claim unclaimed ownership and publish", async () => {
      const adapter = new FakeAdapter();
      // Legacy fallback resolved effectiveRole is "producer"
      const gate = new OwnershipGate(
        adapter,
        () => localDeviceId,
        () => "producer",
        true
      );

      const decision = await gate.evaluate();
      expect(decision.authorized).toBe(true);
      expect(decision.status).toBe("authorized");
      expect(adapter.hasFile(".lina/ownership.json")).toBe(true);
      expect(gate.isAuthorizedSync()).toBe(true);
    });
  });
});
