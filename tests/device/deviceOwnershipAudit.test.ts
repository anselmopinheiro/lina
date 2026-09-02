import { describe, expect, it, beforeEach } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  appendOwnershipAuditEvent,
  loadOwnershipAuditHistory,
  isOwnershipAuditEvent,
  OwnershipAuditEvent,
  OWNERSHIP_HISTORY_DIR,
} from "../../src/device/deviceOwnershipAudit";
import { saveOwnership, OwnershipManifest } from "../../src/device/deviceOwnership";
import {
  prepareOwnershipTransferPreview,
  confirmAndExecuteOwnershipTransfer,
} from "../../src/device/ownershipTransferSafety";

describe("deviceOwnershipAudit (Phase D2.5.5)", () => {
  let adapter: FakeAdapter;
  const producerA = "00000000-0000-4000-8000-000000000001";
  const producerB = "00000000-0000-4000-8000-000000000002";
  const producerC = "00000000-0000-4000-8000-000000000003";

  beforeEach(() => {
    adapter = new FakeAdapter();
  });

  describe("schema and validation", () => {
    it("validates well-formed OwnershipAuditEvent objects", () => {
      const validEvent: OwnershipAuditEvent = {
        schemaVersion: 1,
        eventId: "e1000000-0000-4000-8000-000000000001",
        previousProducerId: producerA,
        newProducerId: producerB,
        previousEpoch: 1,
        newEpoch: 2,
        reason: "manual-transfer",
        executedAt: "2026-09-01T12:00:00.000Z",
      };

      expect(isOwnershipAuditEvent(validEvent)).toBe(true);
    });

    it("validates initial ownership event without previousProducerId / previousEpoch", () => {
      const initialEvent: OwnershipAuditEvent = {
        schemaVersion: 1,
        eventId: "e1000000-0000-4000-8000-000000000002",
        newProducerId: producerA,
        newEpoch: 1,
        reason: "initial",
        executedAt: "2026-09-01T12:00:00.000Z",
      };

      expect(isOwnershipAuditEvent(initialEvent)).toBe(true);
    });

    it("rejects malformed audit events", () => {
      expect(isOwnershipAuditEvent(null)).toBe(false);
      expect(isOwnershipAuditEvent({})).toBe(false);
      expect(
        isOwnershipAuditEvent({
          schemaVersion: 2,
          eventId: "123",
          newProducerId: producerA,
          newEpoch: 1,
          reason: "initial",
          executedAt: "2026-09-01T12:00:00.000Z",
        })
      ).toBe(false);
      expect(
        isOwnershipAuditEvent({
          schemaVersion: 1,
          eventId: "",
          newProducerId: producerA,
          newEpoch: 1,
          reason: "initial",
          executedAt: "2026-09-01T12:00:00.000Z",
        })
      ).toBe(false);
      expect(
        isOwnershipAuditEvent({
          schemaVersion: 1,
          eventId: "valid-id",
          newProducerId: "invalid-id",
          newEpoch: 1,
          reason: "initial",
          executedAt: "2026-09-01T12:00:00.000Z",
        })
      ).toBe(false);
    });
  });

  describe("appendOwnershipAuditEvent", () => {
    it("creates 001.json on first event with valid fields", async () => {
      const event = await appendOwnershipAuditEvent(adapter, {
        previousProducerId: producerA,
        newProducerId: producerB,
        previousEpoch: 1,
        newEpoch: 2,
        reason: "manual-transfer",
        executedAt: "2026-09-01T14:00:00.000Z",
      });

      expect(event.schemaVersion).toBe(1);
      expect(event.previousProducerId).toBe(producerA);
      expect(event.newProducerId).toBe(producerB);
      expect(event.previousEpoch).toBe(1);
      expect(event.newEpoch).toBe(2);
      expect(event.reason).toBe("manual-transfer");
      expect(typeof event.eventId).toBe("string");
      expect(event.eventId.length).toBeGreaterThan(0);

      const filePath = `${OWNERSHIP_HISTORY_DIR}/001.json`;
      expect(await adapter.exists(filePath)).toBe(true);

      const savedContent = JSON.parse(await adapter.read(filePath));
      expect(savedContent).toEqual(event);
    });

    it("appends subsequent events sequentially (002.json, 003.json) without rewriting existing files", async () => {
      const event1 = await appendOwnershipAuditEvent(adapter, {
        newProducerId: producerA,
        newEpoch: 1,
        reason: "initial",
        executedAt: "2026-09-01T10:00:00.000Z",
      });

      const event2 = await appendOwnershipAuditEvent(adapter, {
        previousProducerId: producerA,
        newProducerId: producerB,
        previousEpoch: 1,
        newEpoch: 2,
        reason: "manual-transfer",
        executedAt: "2026-09-01T12:00:00.000Z",
      });

      const event3 = await appendOwnershipAuditEvent(adapter, {
        previousProducerId: producerB,
        newProducerId: producerC,
        previousEpoch: 2,
        newEpoch: 3,
        reason: "manual-transfer",
        executedAt: "2026-09-01T14:00:00.000Z",
      });

      expect(await adapter.exists(`${OWNERSHIP_HISTORY_DIR}/001.json`)).toBe(true);
      expect(await adapter.exists(`${OWNERSHIP_HISTORY_DIR}/002.json`)).toBe(true);
      expect(await adapter.exists(`${OWNERSHIP_HISTORY_DIR}/003.json`)).toBe(true);

      // Verify content of first file was never mutated
      const content1 = JSON.parse(await adapter.read(`${OWNERSHIP_HISTORY_DIR}/001.json`));
      expect(content1).toEqual(event1);

      const content2 = JSON.parse(await adapter.read(`${OWNERSHIP_HISTORY_DIR}/002.json`));
      expect(content2).toEqual(event2);

      const content3 = JSON.parse(await adapter.read(`${OWNERSHIP_HISTORY_DIR}/003.json`));
      expect(content3).toEqual(event3);
    });
  });

  describe("loadOwnershipAuditHistory", () => {
    it("returns empty array if history directory does not exist", async () => {
      const history = await loadOwnershipAuditHistory(adapter);
      expect(history).toEqual([]);
    });

    it("loads and sorts multiple events chronologically", async () => {
      await appendOwnershipAuditEvent(adapter, {
        previousProducerId: producerA,
        newProducerId: producerB,
        previousEpoch: 1,
        newEpoch: 2,
        reason: "manual-transfer",
        executedAt: "2026-09-01T12:00:00.000Z",
      });

      await appendOwnershipAuditEvent(adapter, {
        newProducerId: producerA,
        newEpoch: 1,
        reason: "initial",
        executedAt: "2026-09-01T10:00:00.000Z",
      });

      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(2);
      expect(history[0].newEpoch).toBe(1);
      expect(history[0].reason).toBe("initial");
      expect(history[1].newEpoch).toBe(2);
      expect(history[1].reason).toBe("manual-transfer");
    });

    it("safely ignores malformed, non-JSON, or schema-invalid files in history folder", async () => {
      await appendOwnershipAuditEvent(adapter, {
        newProducerId: producerA,
        newEpoch: 1,
        reason: "initial",
        executedAt: "2026-09-01T10:00:00.000Z",
      });

      // Write corrupt files
      await adapter.write(`${OWNERSHIP_HISTORY_DIR}/002.json`, "INVALID NOT JSON {");
      await adapter.write(`${OWNERSHIP_HISTORY_DIR}/003.json`, JSON.stringify({ schemaVersion: 99 }));
      await adapter.write(`${OWNERSHIP_HISTORY_DIR}/004.txt`, "Some text file");

      await appendOwnershipAuditEvent(adapter, {
        previousProducerId: producerA,
        newProducerId: producerB,
        previousEpoch: 1,
        newEpoch: 2,
        reason: "manual-transfer",
        executedAt: "2026-09-01T12:00:00.000Z",
      });

      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(2);
      expect(history[0].newEpoch).toBe(1);
      expect(history[1].newEpoch).toBe(2);
    });
  });

  describe("Integration with confirmAndExecuteOwnershipTransfer", () => {
    it("appends an audit event when manual transfer succeeds", async () => {
      const initialManifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 2,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };
      await saveOwnership(adapter, initialManifest);

      const previewResult = await prepareOwnershipTransferPreview(adapter, producerB);
      expect(previewResult.success).toBe(true);
      if (!previewResult.success) return;

      const transferResult = await confirmAndExecuteOwnershipTransfer(adapter, previewResult.preview, {
        confirmed: true,
      });
      expect(transferResult.success).toBe(true);

      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(1);
      expect(history[0].previousProducerId).toBe(producerA);
      expect(history[0].newProducerId).toBe(producerB);
      expect(history[0].previousEpoch).toBe(2);
      expect(history[0].newEpoch).toBe(3);
      expect(history[0].reason).toBe("manual-transfer");
    });

    it("does NOT create an audit event when transfer fails validation or epoch mismatch", async () => {
      const initialManifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 2,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };
      await saveOwnership(adapter, initialManifest);

      const previewResult = await prepareOwnershipTransferPreview(adapter, producerB);
      expect(previewResult.success).toBe(true);
      if (!previewResult.success) return;

      // Simulate concurrent change on disk (epoch changed to 3)
      await saveOwnership(adapter, {
        ...initialManifest,
        epoch: 3,
      });

      const transferResult = await confirmAndExecuteOwnershipTransfer(adapter, previewResult.preview, {
        confirmed: true,
      });
      expect(transferResult.success).toBe(false);
      expect(transferResult.reason).toBe("epoch-mismatch");

      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(0);
    });

    it("does NOT create an audit event when confirmation is missing", async () => {
      const initialManifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: producerA,
        epoch: 1,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };
      await saveOwnership(adapter, initialManifest);

      const previewResult = await prepareOwnershipTransferPreview(adapter, producerB);
      if (!previewResult.success) return;

      const transferResult = await confirmAndExecuteOwnershipTransfer(
        adapter,
        previewResult.preview,
        { confirmed: false }
      );
      expect(transferResult.success).toBe(false);
      expect(transferResult.reason).toBe("confirmation-required");

      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(0);
    });
  });

  describe("Invariants & Role Isolation", () => {
    it("never mutates device role files in .lina/devices/", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const auditSource = fs.readFileSync(
        path.resolve(__dirname, "../../src/device/deviceOwnershipAudit.ts"),
        "utf-8"
      );

      expect(auditSource).not.toContain("saveDeviceState");
      expect(auditSource).not.toContain("setDeviceRole");
      expect(auditSource).not.toContain(".lina/devices");
    });

    it("has zero dependency on UI or strings layer", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const auditSource = fs.readFileSync(
        path.resolve(__dirname, "../../src/device/deviceOwnershipAudit.ts"),
        "utf-8"
      );

      expect(auditSource).not.toContain("UiStrings");
      expect(auditSource).not.toContain("i18n");
      expect(auditSource).not.toContain("Notice");
      expect(auditSource).not.toContain("Modal");
    });
  });
});
