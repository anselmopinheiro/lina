import { describe, expect, it, beforeEach } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  evaluateOwnershipRecovery,
  evaluateOwnershipRecoveryState,
  OwnershipRecoveryDiagnostics,
} from "../../src/device/ownershipRecoveryDiagnostics";
import { saveOwnership, OwnershipManifest } from "../../src/device/deviceOwnership";
import { appendOwnershipAuditEvent, OwnershipAuditEvent } from "../../src/device/deviceOwnershipAudit";

describe("ownershipRecoveryDiagnostics (Phase D2.5.6)", () => {
  let adapter: FakeAdapter;
  const producerA = "00000000-0000-4000-8000-000000000001";
  const producerB = "00000000-0000-4000-8000-000000000002";

  beforeEach(() => {
    adapter = new FakeAdapter();
  });

  describe("evaluateOwnershipRecoveryState (Pure Unit Evaluation)", () => {
    it("returns 'healthy' when manifest and latest audit event match epoch and producer", () => {
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 2,
        acquiredAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
        reason: "manual-transfer",
      };

      const history: OwnershipAuditEvent[] = [
        {
          schemaVersion: 1,
          eventId: "e1",
          newProducerId: producerB,
          newEpoch: 1,
          reason: "initial",
          executedAt: "2026-09-01T10:00:00.000Z",
        },
        {
          schemaVersion: 1,
          eventId: "e2",
          previousProducerId: producerB,
          newProducerId: producerA,
          previousEpoch: 1,
          newEpoch: 2,
          reason: "manual-transfer",
          executedAt: "2026-09-01T12:00:00.000Z",
        },
      ];

      const diag = evaluateOwnershipRecoveryState(manifest, history);

      expect(diag.status).toBe("healthy");
      expect(diag.hasManifest).toBe(true);
      expect(diag.hasHistory).toBe(true);
      expect(diag.currentProducerId).toBe(producerA);
      expect(diag.currentEpoch).toBe(2);
      expect(diag.latestAuditProducerId).toBe(producerA);
      expect(diag.latestAuditEpoch).toBe(2);
      expect(diag.lastKnownProducerId).toBe(producerA);
      expect(diag.totalAuditEvents).toBe(2);
      expect(diag.warnings).toHaveLength(0);
    });

    it("returns 'missing-manifest' when history exists but manifest is null", () => {
      const history: OwnershipAuditEvent[] = [
        {
          schemaVersion: 1,
          eventId: "e1",
          newProducerId: producerA,
          newEpoch: 1,
          reason: "initial",
          executedAt: "2026-09-01T10:00:00.000Z",
        },
      ];

      const diag = evaluateOwnershipRecoveryState(null, history);

      expect(diag.status).toBe("missing-manifest");
      expect(diag.hasManifest).toBe(false);
      expect(diag.hasHistory).toBe(true);
      expect(diag.latestAuditProducerId).toBe(producerA);
      expect(diag.latestAuditEpoch).toBe(1);
      expect(diag.lastKnownProducerId).toBe(producerA);
      expect(diag.totalAuditEvents).toBe(1);
      expect(diag.warnings.length).toBeGreaterThan(0);
      expect(diag.warnings[0]).toContain("Ownership manifest (.lina/ownership.json) is missing");
    });

    it("returns 'missing-history' when manifest exists but history is empty", () => {
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 1,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };

      const diag = evaluateOwnershipRecoveryState(manifest, []);

      expect(diag.status).toBe("missing-history");
      expect(diag.hasManifest).toBe(true);
      expect(diag.hasHistory).toBe(false);
      expect(diag.currentProducerId).toBe(producerA);
      expect(diag.currentEpoch).toBe(1);
      expect(diag.lastKnownProducerId).toBe(producerA);
      expect(diag.totalAuditEvents).toBe(0);
      expect(diag.warnings.length).toBeGreaterThan(0);
      expect(diag.warnings[0]).toContain("no audit history was found");
    });

    it("returns 'history-ahead-of-manifest' when latest audit epoch exceeds manifest epoch", () => {
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 1,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };

      const history: OwnershipAuditEvent[] = [
        {
          schemaVersion: 1,
          eventId: "e1",
          newProducerId: producerA,
          newEpoch: 1,
          reason: "initial",
          executedAt: "2026-09-01T10:00:00.000Z",
        },
        {
          schemaVersion: 1,
          eventId: "e2",
          previousProducerId: producerA,
          newProducerId: producerB,
          previousEpoch: 1,
          newEpoch: 2,
          reason: "manual-transfer",
          executedAt: "2026-09-01T12:00:00.000Z",
        },
      ];

      const diag = evaluateOwnershipRecoveryState(manifest, history);

      expect(diag.status).toBe("history-ahead-of-manifest");
      expect(diag.currentEpoch).toBe(1);
      expect(diag.latestAuditEpoch).toBe(2);
      expect(diag.warnings[0]).toContain("Audit history is ahead of current manifest");
    });

    it("returns 'epoch-inconsistency' when manifest epoch is ahead of latest audit epoch", () => {
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerB,
        epoch: 3,
        acquiredAt: "2026-09-01T14:00:00.000Z",
        updatedAt: "2026-09-01T14:00:00.000Z",
        reason: "manual-transfer",
      };

      const history: OwnershipAuditEvent[] = [
        {
          schemaVersion: 1,
          eventId: "e1",
          newProducerId: producerA,
          newEpoch: 1,
          reason: "initial",
          executedAt: "2026-09-01T10:00:00.000Z",
        },
      ];

      const diag = evaluateOwnershipRecoveryState(manifest, history);

      expect(diag.status).toBe("epoch-inconsistency");
      expect(diag.warnings[0]).toContain("Manifest epoch (3) is ahead of latest audit history epoch (1)");
    });

    it("returns 'epoch-inconsistency' when producers mismatch at same epoch", () => {
      const manifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 2,
        acquiredAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
        reason: "manual-transfer",
      };

      const history: OwnershipAuditEvent[] = [
        {
          schemaVersion: 1,
          eventId: "e1",
          newProducerId: producerB,
          newEpoch: 2,
          reason: "manual-transfer",
          executedAt: "2026-09-01T12:00:00.000Z",
        },
      ];

      const diag = evaluateOwnershipRecoveryState(manifest, history);

      expect(diag.status).toBe("epoch-inconsistency");
      expect(diag.warnings[0]).toContain("Manifest producer");
      expect(diag.warnings[0]).toContain("differs from latest audit event producer");
    });

    it("returns 'unknown' when neither manifest nor history exists", () => {
      const diag = evaluateOwnershipRecoveryState(null, []);

      expect(diag.status).toBe("unknown");
      expect(diag.hasManifest).toBe(false);
      expect(diag.hasHistory).toBe(false);
      expect(diag.totalAuditEvents).toBe(0);
      expect(diag.warnings[0]).toContain("No ownership manifest");
    });
  });

  describe("evaluateOwnershipRecovery (Vault DataAdapter Integration)", () => {
    it("correctly evaluates a healthy vault with files on disk", async () => {
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 1,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      });

      await appendOwnershipAuditEvent(adapter, {
        newProducerId: producerA,
        newEpoch: 1,
        reason: "initial",
        executedAt: "2026-09-01T10:00:00.000Z",
      });

      const writeCountBefore = adapter.writeCount;
      const removeCountBefore = adapter.removeCount;
      const renameCountBefore = adapter.renameCount;

      const diag = await evaluateOwnershipRecovery(adapter);

      expect(diag.status).toBe("healthy");
      expect(diag.hasManifest).toBe(true);
      expect(diag.hasHistory).toBe(true);
      expect(diag.currentEpoch).toBe(1);
      expect(diag.latestAuditEpoch).toBe(1);

      // Verify ZERO filesystem mutations occurred during evaluation
      expect(adapter.writeCount).toBe(writeCountBefore);
      expect(adapter.removeCount).toBe(removeCountBefore);
      expect(adapter.renameCount).toBe(renameCountBefore);
    });

    it("evaluates 'missing-manifest' when only audit files exist without recreating manifest", async () => {
      await appendOwnershipAuditEvent(adapter, {
        newProducerId: producerA,
        newEpoch: 1,
        reason: "initial",
        executedAt: "2026-09-01T10:00:00.000Z",
      });

      const diag = await evaluateOwnershipRecovery(adapter);

      expect(diag.status).toBe("missing-manifest");
      expect(diag.hasManifest).toBe(false);
      expect(diag.hasHistory).toBe(true);
      expect(diag.lastKnownProducerId).toBe(producerA);

      // Verify ownership.json was NOT recreated automatically
      expect(await adapter.exists(".lina/ownership.json")).toBe(false);
    });
  });

  describe("Safety, Non-Mutation & Role Isolation Guarantees", () => {
    it("never mutates device role files in .lina/devices/", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const diagSource = fs.readFileSync(
        path.resolve(__dirname, "../../src/device/ownershipRecoveryDiagnostics.ts"),
        "utf-8"
      );

      expect(diagSource).not.toContain("saveDeviceState");
      expect(diagSource).not.toContain("setDeviceRole");
      expect(diagSource).not.toContain("saveOwnership");
      expect(diagSource).not.toContain("appendOwnershipAuditEvent");
      expect(diagSource).not.toContain("transferOwnershipToDevice");
      expect(diagSource).not.toContain("adapter.write");
      expect(diagSource).not.toContain("adapter.remove");
      expect(diagSource).not.toContain("adapter.rename");
    });

    it("has zero dependency on UI or strings layer", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const diagSource = fs.readFileSync(
        path.resolve(__dirname, "../../src/device/ownershipRecoveryDiagnostics.ts"),
        "utf-8"
      );

      expect(diagSource).not.toContain("UiStrings");
      expect(diagSource).not.toContain("i18n");
      expect(diagSource).not.toContain("Notice");
      expect(diagSource).not.toContain("Modal");
    });
  });
});
