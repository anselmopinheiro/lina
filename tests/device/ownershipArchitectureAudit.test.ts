import { describe, expect, it, vi } from "vitest";
import { DeviceState, saveDeviceState, loadDeviceState } from "../../src/device/deviceState";
import {
  claimInitialOwnership,
  loadOwnership,
  saveOwnership,
  OwnershipManifest,
} from "../../src/device/deviceOwnership";
import { OwnershipGate } from "../../src/device/ownershipGate";
import {
  createArtifactProvenance,
} from "../../src/device/artifactProvenance";
import {
  evaluateArtifactProvenance,
} from "../../src/device/artifactProvenanceValidation";
import {
  prepareOwnershipTransferPreview,
  confirmAndExecuteOwnershipTransfer,
} from "../../src/device/ownershipTransferSafety";
import {
  loadOwnershipAuditHistory,
} from "../../src/device/deviceOwnershipAudit";
import {
  evaluateOwnershipRecovery,
  evaluateOwnershipRecoveryState,
} from "../../src/device/ownershipRecoveryDiagnostics";
import {
  readDeviceDiagnostics,
  buildDeviceDiagnostics,
} from "../../src/device/deviceDiagnostics";

class AuditMemoryAdapter {
  readonly files = new Map<string, string>();
  readonly writeLog: string[] = [];
  readonly renameLog: Array<{ from: string; to: string }> = [];
  readonly removeLog: string[] = [];

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    for (const k of this.files.keys()) {
      if (k.startsWith(path + "/")) return true;
    }
    return false;
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`File not found: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.writeLog.push(path);
    this.files.set(path, content);
  }

  async rename(from: string, to: string): Promise<void> {
    this.renameLog.push({ from, to });
    const value = this.files.get(from);
    if (value !== undefined) {
      this.files.set(to, value);
      this.files.delete(from);
    }
  }

  async remove(path: string): Promise<void> {
    this.removeLog.push(path);
    this.files.delete(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path === "" ? "" : path.endsWith("/") ? path : path + "/";
    const matchingFiles: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        matchingFiles.push(key);
      }
    }
    return { files: matchingFiles, folders: [] };
  }
}

describe("Ownership Architecture Hardening & Final Audit (Phase D2.5.8)", () => {
  const deviceA = "a1111111-1111-4111-8111-111111111111";
  const deviceB = "b2222222-2222-4222-8222-222222222222";
  const deviceC = "c3333333-3333-4333-8333-333333333333";
  const timestamp = "2026-09-01T12:00:00.000Z";

  // -------------------------------------------------------------------------
  // 1. Complete Ownership Lifecycle Review
  // -------------------------------------------------------------------------
  describe("1. Complete Ownership Lifecycle & Isolation", () => {
    it("executes the complete end-to-end lifecycle with strict responsibility isolation", async () => {
      const adapter = new AuditMemoryAdapter();

      // Step 1: Device Identities & Roles
      const stateA: DeviceState = { schemaVersion: 2, deviceId: deviceA, deviceName: "Workstation A", role: "producer", createdAt: timestamp, updatedAt: timestamp };
      const stateB: DeviceState = { schemaVersion: 2, deviceId: deviceB, deviceName: "Laptop B", role: "producer", createdAt: timestamp, updatedAt: timestamp };
      const stateC: DeviceState = { schemaVersion: 2, deviceId: deviceC, deviceName: "Mobile C", role: "companion", createdAt: timestamp, updatedAt: timestamp };

      await saveDeviceState(adapter as any, stateA);
      await saveDeviceState(adapter as any, stateB);
      await saveDeviceState(adapter as any, stateC);

      const deviceWriteCountAfterInit = adapter.writeLog.filter((p) => p.startsWith(".lina/devices/")).length;

      // Step 2: Initial Ownership Claim by Device A
      const initialManifest = await claimInitialOwnership(adapter, deviceA);
      expect(initialManifest.activeProducerId).toBe(deviceA);
      expect(initialManifest.epoch).toBe(1);

      // Step 3: Ownership Gate Verification
      const gateA = new OwnershipGate(adapter, () => deviceA, () => "producer", false);
      const gateB = new OwnershipGate(adapter, () => deviceB, () => "producer", false);
      const gateC = new OwnershipGate(adapter, () => deviceC, () => "companion", false);

      expect(await gateA.canPublish()).toBe(true);
      expect(await gateB.canPublish()).toBe(false);
      expect(await gateC.canPublish()).toBe(false);

      // Step 4: Artifact Provenance Stamping & Validation
      const textIndexArtifact = {
        indexType: "text-v1",
        totalNotes: 100,
        provenance: createArtifactProvenance(deviceA, 1, timestamp),
      };
      const provValidationEpoch1 = evaluateArtifactProvenance(textIndexArtifact, initialManifest, deviceA);
      expect(provValidationEpoch1.status).toBe("valid");

      // Step 5: Manual Transfer Preparation & Execution from A to B
      const previewResult = await prepareOwnershipTransferPreview(adapter, deviceB);
      expect(previewResult.success).toBe(true);
      if (!previewResult.success) return;

      expect(previewResult.preview.currentProducerId).toBe(deviceA);
      expect(previewResult.preview.targetProducerId).toBe(deviceB);
      expect(previewResult.preview.currentEpoch).toBe(1);
      expect(previewResult.preview.nextEpoch).toBe(2);

      const transferExecResult = await confirmAndExecuteOwnershipTransfer(
        adapter,
        previewResult.preview,
        { confirmed: true }
      );
      expect(transferExecResult.success).toBe(true);
      if (!transferExecResult.success) return;

      expect(transferExecResult.manifest.activeProducerId).toBe(deviceB);
      expect(transferExecResult.manifest.epoch).toBe(2);

      // Step 6: Post-Transfer Gate Validation
      expect(await gateA.canPublish()).toBe(false);
      expect(await gateB.canPublish()).toBe(true);

      // Step 7: Post-Transfer Artifact Provenance Validation (Old artifact becomes stale)
      const currentManifest = await loadOwnership(adapter);
      const provValidationAfterTransfer = evaluateArtifactProvenance(textIndexArtifact, currentManifest, deviceA);
      expect(provValidationAfterTransfer.status).toBe("stale");

      // Step 8: Audit Trail Verification
      const history = await loadOwnershipAuditHistory(adapter);
      expect(history).toHaveLength(1);
      expect(history[0].previousProducerId).toBe(deviceA);
      expect(history[0].newProducerId).toBe(deviceB);
      expect(history[0].previousEpoch).toBe(1);
      expect(history[0].newEpoch).toBe(2);

      // Step 9: Recovery Diagnostics Observation
      const recoveryDiag = await evaluateOwnershipRecovery(adapter);
      expect(recoveryDiag.status).toBe("healthy");
      expect(recoveryDiag.currentEpoch).toBe(2);
      expect(recoveryDiag.latestAuditEpoch).toBe(2);
      expect(recoveryDiag.currentProducerId).toBe(deviceB);
      expect(recoveryDiag.totalAuditEvents).toBe(1);
      expect(recoveryDiag.warnings).toHaveLength(0);

      // Step 10: Strict Role Isolation Invariant Verification
      const deviceWritesDuringTransfer = adapter.writeLog.filter((p) => p.startsWith(".lina/devices/")).length;
      expect(deviceWritesDuringTransfer).toBe(deviceWriteCountAfterInit);

      const reloadedStateA = await loadDeviceState(adapter as any, deviceA);
      const reloadedStateB = await loadDeviceState(adapter as any, deviceB);
      expect(reloadedStateA?.role).toBe("producer");
      expect(reloadedStateB?.role).toBe("producer");
    });
  });

  // -------------------------------------------------------------------------
  // 2. State Matrix Verification
  // -------------------------------------------------------------------------
  describe("2. Comprehensive State Matrix", () => {
    describe("Device States Matrix", () => {
      it("evaluates Active Producer correctly", () => {
        const diag = buildDeviceDiagnostics({
          deviceId: deviceA,
          deviceState: { schemaVersion: 2, deviceId: deviceA, role: "producer" },
          ownership: { schemaVersion: 1, activeProducerId: deviceA, epoch: 5, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" },
        });

        expect(diag.ownership.isActiveProducer).toBe(true);
        expect(diag.ownership.isStandbyProducer).toBe(false);
        expect(diag.ownership.isCompanion).toBe(false);
        expect(diag.ownership.isUnassigned).toBe(false);
        expect(diag.transfer.canTransferOwnership).toBe(false);
        expect(diag.transfer.eligibilityReason).toBe("already-active-producer");
      });

      it("evaluates Standby Producer correctly", () => {
        const diag = buildDeviceDiagnostics({
          deviceId: deviceB,
          deviceState: { schemaVersion: 2, deviceId: deviceB, role: "producer" },
          ownership: { schemaVersion: 1, activeProducerId: deviceA, epoch: 5, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" },
        });

        expect(diag.ownership.isActiveProducer).toBe(false);
        expect(diag.ownership.isStandbyProducer).toBe(true);
        expect(diag.ownership.isCompanion).toBe(false);
        expect(diag.ownership.isUnassigned).toBe(false);
        expect(diag.transfer.canTransferOwnership).toBe(true);
        expect(diag.transfer.eligibilityReason).toBe("ready");
      });

      it("evaluates Companion correctly", () => {
        const diag = buildDeviceDiagnostics({
          deviceId: deviceC,
          deviceState: { schemaVersion: 2, deviceId: deviceC, role: "companion" },
          ownership: { schemaVersion: 1, activeProducerId: deviceA, epoch: 5, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" },
        });

        expect(diag.ownership.isActiveProducer).toBe(false);
        expect(diag.ownership.isStandbyProducer).toBe(false);
        expect(diag.ownership.isCompanion).toBe(true);
        expect(diag.ownership.isUnassigned).toBe(false);
        expect(diag.transfer.canTransferOwnership).toBe(false);
        expect(diag.transfer.eligibilityReason).toBe("companion-role");
      });

      it("evaluates Unassigned role correctly", () => {
        const diag = buildDeviceDiagnostics({
          deviceId: deviceB, // non-owner device with unassigned role
          deviceState: { schemaVersion: 2, deviceId: deviceB }, // role omitted
          ownership: { schemaVersion: 1, activeProducerId: deviceA, epoch: 5, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" },
        });

        expect(diag.ownership.isUnassigned).toBe(true);
        expect(diag.transfer.canTransferOwnership).toBe(false);
        expect(diag.transfer.eligibilityReason).toBe("unassigned-role");
      });
    });

    describe("Ownership & Recovery States Matrix", () => {
      it("evaluates 'healthy' when manifest and audit trail are synchronized", () => {
        const manifest: OwnershipManifest = { schemaVersion: 1, activeProducerId: deviceA, epoch: 3, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" };
        const history = [
          { schemaVersion: 1, eventId: "e1", newProducerId: deviceA, newEpoch: 1, reason: "initial" as const, executedAt: timestamp },
          { schemaVersion: 1, eventId: "e2", previousProducerId: deviceA, newProducerId: deviceB, previousEpoch: 1, newEpoch: 2, reason: "manual-transfer" as const, executedAt: timestamp },
          { schemaVersion: 1, eventId: "e3", previousProducerId: deviceB, newProducerId: deviceA, previousEpoch: 2, newEpoch: 3, reason: "manual-transfer" as const, executedAt: timestamp },
        ];

        const res = evaluateOwnershipRecoveryState(manifest, history);
        expect(res.status).toBe("healthy");
        expect(res.warnings).toHaveLength(0);
      });

      it("evaluates 'missing-manifest' when history exists without ownership.json", () => {
        const history = [
          { schemaVersion: 1, eventId: "e1", newProducerId: deviceA, newEpoch: 1, reason: "initial" as const, executedAt: timestamp },
        ];

        const res = evaluateOwnershipRecoveryState(null, history);
        expect(res.status).toBe("missing-manifest");
        expect(res.hasManifest).toBe(false);
        expect(res.hasHistory).toBe(true);
        expect(res.latestAuditProducerId).toBe(deviceA);
      });

      it("evaluates 'missing-history' when manifest exists with empty audit trail", () => {
        const manifest: OwnershipManifest = { schemaVersion: 1, activeProducerId: deviceA, epoch: 2, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" };
        const res = evaluateOwnershipRecoveryState(manifest, []);
        expect(res.status).toBe("missing-history");
        expect(res.hasManifest).toBe(true);
        expect(res.hasHistory).toBe(false);
      });

      it("evaluates 'history-ahead-of-manifest' when audit trail has higher epoch", () => {
        const manifest: OwnershipManifest = { schemaVersion: 1, activeProducerId: deviceA, epoch: 2, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" };
        const history = [
          { schemaVersion: 1, eventId: "e1", newProducerId: deviceB, newEpoch: 3, reason: "manual-transfer" as const, executedAt: timestamp },
        ];
        const res = evaluateOwnershipRecoveryState(manifest, history);
        expect(res.status).toBe("history-ahead-of-manifest");
      });

      it("evaluates 'epoch-inconsistency' when manifest has higher epoch or producer mismatch", () => {
        // Subcase A: Manifest ahead of audit
        const manifestA: OwnershipManifest = { schemaVersion: 1, activeProducerId: deviceA, epoch: 5, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" };
        const historyA = [{ schemaVersion: 1, eventId: "e1", newProducerId: deviceA, newEpoch: 2, reason: "manual-transfer" as const, executedAt: timestamp }];
        expect(evaluateOwnershipRecoveryState(manifestA, historyA).status).toBe("epoch-inconsistency");

        // Subcase B: Same epoch but different producer
        const manifestB: OwnershipManifest = { schemaVersion: 1, activeProducerId: deviceA, epoch: 2, acquiredAt: timestamp, updatedAt: timestamp, reason: "manual-transfer" };
        const historyB = [{ schemaVersion: 1, eventId: "e1", newProducerId: deviceB, newEpoch: 2, reason: "manual-transfer" as const, executedAt: timestamp }];
        expect(evaluateOwnershipRecoveryState(manifestB, historyB).status).toBe("epoch-inconsistency");
      });

      it("evaluates 'unknown' when neither manifest nor history exists", () => {
        const res = evaluateOwnershipRecoveryState(null, []);
        expect(res.status).toBe("unknown");
        expect(res.hasManifest).toBe(false);
        expect(res.hasHistory).toBe(false);
      });
    });

    describe("Artifact Provenance States Matrix", () => {
      const activeOwnership: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: deviceA,
        epoch: 4,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reason: "manual-transfer",
      };

      it("evaluates 'valid' provenance when producer and epoch match current ownership", () => {
        const artifact = { provenance: createArtifactProvenance(deviceA, 4, timestamp) };
        const res = evaluateArtifactProvenance(artifact, activeOwnership, deviceA);
        expect(res.status).toBe("valid");
        expect(res.isProducedByCurrentOwner).toBe(true);
      });

      it("evaluates 'stale' provenance when epoch is behind current ownership", () => {
        const artifact = { provenance: createArtifactProvenance(deviceA, 3, timestamp) };
        const res = evaluateArtifactProvenance(artifact, activeOwnership, deviceA);
        expect(res.status).toBe("stale");
        expect(res.reason).toBe("epoch-behind-ownership");
      });

      it("evaluates 'stale' provenance when producer mismatches at same epoch", () => {
        const artifact = { provenance: createArtifactProvenance(deviceB, 4, timestamp) };
        const res = evaluateArtifactProvenance(artifact, activeOwnership, deviceA);
        expect(res.status).toBe("stale");
        expect(res.reason).toBe("producer-mismatch");
      });

      it("evaluates 'future' provenance when epoch is ahead of active ownership", () => {
        const artifact = { provenance: createArtifactProvenance(deviceB, 5, timestamp) };
        const res = evaluateArtifactProvenance(artifact, activeOwnership, deviceA);
        expect(res.status).toBe("future");
        expect(res.reason).toBe("epoch-ahead-of-ownership");
      });

      it("evaluates 'unknown' for legacy artifacts without provenance metadata", () => {
        const legacyArtifact = { indexType: "text-v1", totalNotes: 50 };
        const res = evaluateArtifactProvenance(legacyArtifact, activeOwnership, deviceA);
        expect(res.status).toBe("unknown");
        expect(res.reason).toBe("provenance-missing");
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3. Epoch Fencing & Race Condition Protections
  // -------------------------------------------------------------------------
  describe("3. Epoch Fencing & Concurrency Protection", () => {
    it("rejects transfer execution if manifest epoch changes concurrently before confirmation", async () => {
      const adapter = new AuditMemoryAdapter();

      // Setup initial ownership at epoch 1
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: deviceA,
        epoch: 1,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reason: "initial",
      });

      // Prepare preview based on epoch 1
      const previewResult = await prepareOwnershipTransferPreview(adapter, deviceB);
      expect(previewResult.success).toBe(true);
      if (!previewResult.success) return;

      // Simulate concurrent transfer on disk to epoch 2
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: deviceC,
        epoch: 2,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reason: "manual-transfer",
      });

      // Attempt to execute stale preview (which expected epoch 1)
      const executionResult = await confirmAndExecuteOwnershipTransfer(
        adapter,
        previewResult.preview,
        { confirmed: true }
      );

      expect(executionResult.success).toBe(false);
      expect(executionResult.reason).toBe("epoch-mismatch");

      // Verify no audit events were created for the failed stale attempt
      const history = await loadOwnershipAuditHistory(adapter);
      expect(history).toHaveLength(0);

      // Verify active ownership remains on Device C at epoch 2
      const manifest = await loadOwnership(adapter);
      expect(manifest?.activeProducerId).toBe(deviceC);
      expect(manifest?.epoch).toBe(2);
    });

    it("rejects self-transfers to the current active producer", async () => {
      const adapter = new AuditMemoryAdapter();

      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: deviceA,
        epoch: 1,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reason: "initial",
      });

      const previewResult = await prepareOwnershipTransferPreview(adapter, deviceA);
      expect(previewResult.success).toBe(false);
      expect(previewResult.reason).toBe("already-active-producer");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Observation-Only & Zero-Automation Guarantees
  // -------------------------------------------------------------------------
  describe("4. Non-Mutation & Zero Automation Guarantees", () => {
    it("guarantees evaluateOwnershipRecovery performs zero filesystem writes or mutations", async () => {
      const adapter = new AuditMemoryAdapter();

      // Inconsistent state: history ahead of manifest
      adapter.files.set(
        ".lina/ownership.json",
        JSON.stringify({ schemaVersion: 1, activeProducerId: deviceA, epoch: 1, acquiredAt: timestamp, updatedAt: timestamp, reason: "initial" })
      );
      adapter.files.set(
        ".lina/ownership-history/001.json",
        JSON.stringify({ schemaVersion: 1, eventId: "e1", newProducerId: deviceB, newEpoch: 2, reason: "manual-transfer", executedAt: timestamp })
      );

      const writesBefore = adapter.writeLog.length;
      const renamesBefore = adapter.renameLog.length;
      const removesBefore = adapter.removeLog.length;

      const diagnostics = await evaluateOwnershipRecovery(adapter);
      expect(diagnostics.status).toBe("history-ahead-of-manifest");

      // Verify zero modifications
      expect(adapter.writeLog.length).toBe(writesBefore);
      expect(adapter.renameLog.length).toBe(renamesBefore);
      expect(adapter.removeLog.length).toBe(removesBefore);
    });

    it("guarantees readDeviceDiagnostics performs zero filesystem writes or mutations", async () => {
      const adapter = new AuditMemoryAdapter();

      adapter.files.set(
        `.lina/devices/${deviceA}.json`,
        JSON.stringify({ schemaVersion: 2, deviceId: deviceA, deviceName: "Studio", role: "producer" })
      );
      adapter.files.set(
        ".lina/ownership.json",
        JSON.stringify({ schemaVersion: 1, activeProducerId: deviceA, epoch: 1, acquiredAt: timestamp, updatedAt: timestamp, reason: "initial" })
      );

      const writesBefore = adapter.writeLog.length;
      const diagnostics = await readDeviceDiagnostics(adapter as any, deviceA);

      expect(diagnostics.device.id).toBe(deviceA);
      expect(diagnostics.recovery.status).toBe("missing-history");
      expect(adapter.writeLog.length).toBe(writesBefore);
    });
  });
});
