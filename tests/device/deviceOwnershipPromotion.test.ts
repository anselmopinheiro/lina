import { describe, it, expect, beforeEach } from "vitest";
import { App, Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { saveOwnership, loadOwnership, OwnershipManifest } from "../../src/device/deviceOwnership";
import { loadOwnershipAuditHistory, appendOwnershipAuditEvent } from "../../src/device/deviceOwnershipAudit";
import { generateDeviceId } from "../../src/device/deviceIdentity";
import {
  prepareOwnershipTransferPreview,
  confirmAndExecuteOwnershipTransfer,
} from "../../src/device/ownershipTransferSafety";
import { DEFAULT_SETTINGS, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";

describe("Phase 0.2.2.X.1.6 — Ownership Transfer Consistency & Standby Producer Promotion UX", () => {
  let app: App;
  let adapter: FakeAdapter;
  let plugin: LinaPlugin;
  const pt = getStrings("pt-PT");
  const en = getStrings("en");

  interface RegisteredCommand {
    id: string;
    name: string;
    checkCallback?: (checking: boolean) => boolean;
  }

  function getTransferCommand(p: LinaPlugin): RegisteredCommand | undefined {
    const commands = (p as unknown as { commands?: RegisteredCommand[] }).commands;
    return commands?.find((c) => c.id === "transferir-ownership-dispositivo");
  }

  beforeEach(async () => {
    Platform.isMobile = false;
    adapter = new FakeAdapter();
    app = new App();
    (app.vault as unknown as { adapter: FakeAdapter }).adapter = adapter;
    plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    await plugin.onload();
  });

  describe("Command palette consistency", () => {
    it("is available for Standby Producer and unavailable for Active Producer", async () => {
      const localId = plugin.getDeviceId();
      const remoteId = generateDeviceId();

      // Configure local device as Producer
      await plugin.assignDeviceRole("producer");

      // Set ownership to remote device -> local device is Standby Producer
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });
      await plugin.getOwnershipGate().evaluate();

      const cmd = getTransferCommand(plugin);
      expect(cmd).toBeDefined();
      expect(cmd?.checkCallback?.(true)).toBe(true);

      // Now set ownership to local device -> local device is Active Producer
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: localId,
        epoch: 2,
        acquiredAt: "2026-08-20T10:05:00.000Z",
        updatedAt: "2026-08-20T10:05:00.000Z",
        reason: "initial",
      });
      await plugin.getOwnershipGate().evaluate();

      expect(cmd?.checkCallback?.(true)).toBe(false);
    });

    it("is unavailable for Companion and Unassigned devices", async () => {
      const remoteId = generateDeviceId();
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      const cmd = getTransferCommand(plugin);
      expect(cmd).toBeDefined();

      // Case 1: Unassigned
      await plugin.getOwnershipGate().evaluate();
      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");
      expect(cmd?.checkCallback?.(true)).toBe(false);

      // Case 2: Companion
      await plugin.assignDeviceRole("companion");
      await plugin.getOwnershipGate().evaluate();
      expect(plugin.getEffectiveDeviceRole()).toBe("companion");
      expect(cmd?.checkCallback?.(true)).toBe(false);
    });

    it("is available for legacy-fallback Producer on standby and unavailable when active", async () => {
      const localId = plugin.getDeviceId();
      const remoteId = generateDeviceId();

      // Setup legacy device state without explicit role
      await adapter.write(`.lina/devices/${localId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId: localId,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      expect(plugin.getDeviceRoleResolution().assignmentState).toBe("legacy-fallback");
      expect(plugin.getEffectiveDeviceRole()).toBe("producer");

      const cmd = getTransferCommand(plugin);
      expect(cmd).toBeDefined();

      // Remote ownership -> Standby Producer -> available
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });
      await plugin.getOwnershipGate().evaluate();
      expect(cmd?.checkCallback?.(true)).toBe(true);

      // Local ownership -> Active Producer -> unavailable
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: localId,
        epoch: 2,
        acquiredAt: "2026-08-20T10:05:00.000Z",
        updatedAt: "2026-08-20T10:05:00.000Z",
        reason: "initial",
      });
      await plugin.getOwnershipGate().evaluate();
      expect(cmd?.checkCallback?.(true)).toBe(false);
    });
  });

  describe("Diagnostics consistency & transfer readiness", () => {
    it("reports Standby Producer as ready for transfer and enables transfer button", async () => {
      const localId = plugin.getDeviceId();
      const remoteId = generateDeviceId();

      await plugin.assignDeviceRole("producer");
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      const diag = await plugin.getDeviceDiagnostics();

      // Role section
      expect(diag.device.role).toBe("producer");
      expect(diag.device.assignmentState).toBe("assigned");
      expect(diag.device.effectiveRole).toBe("producer");

      // Ownership section
      expect(diag.ownership.isStandbyProducer).toBe(true);
      expect(diag.ownership.isActiveProducer).toBe(false);
      expect(diag.ownership.isCompanion).toBe(false);
      expect(diag.ownership.isUnassigned).toBe(false);

      // Transfer section
      expect(diag.transfer.canTransferOwnership).toBe(true);
      expect(diag.transfer.eligibilityReason).toBe("ready");
      expect(diag.transfer.isLocalActiveProducer).toBe(false);
    });

    it("reports Active Producer as not eligible to transfer to itself", async () => {
      const localId = plugin.getDeviceId();
      await plugin.assignDeviceRole("producer");
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: localId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      const diag = await plugin.getDeviceDiagnostics();
      expect(diag.ownership.isActiveProducer).toBe(true);
      expect(diag.ownership.isStandbyProducer).toBe(false);
      expect(diag.transfer.canTransferOwnership).toBe(false);
      expect(diag.transfer.eligibilityReason).toBe("already-active-producer");
    });

    it("reports Companion as companion-role and not eligible for transfer", async () => {
      const remoteId = generateDeviceId();
      await plugin.assignDeviceRole("companion");
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      const diag = await plugin.getDeviceDiagnostics();
      expect(diag.ownership.isCompanion).toBe(true);
      expect(diag.ownership.isStandbyProducer).toBe(false);
      expect(diag.transfer.canTransferOwnership).toBe(false);
      expect(diag.transfer.eligibilityReason).toBe("companion-role");
    });

    it("reports Unassigned as unassigned-role and not eligible for transfer", async () => {
      const remoteId = generateDeviceId();
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      const diag = await plugin.getDeviceDiagnostics();
      expect(diag.device.assignmentState).toBe("unassigned");
      expect(diag.ownership.isUnassigned).toBe(true);
      expect(diag.transfer.canTransferOwnership).toBe(false);
      expect(diag.transfer.eligibilityReason).toBe("unassigned-role");
    });

    it("ensures legacy-fallback Producer on standby agrees on role and transfer readiness", async () => {
      const localId = plugin.getDeviceId();
      const remoteId = generateDeviceId();

      await adapter.write(`.lina/devices/${localId}.json`, JSON.stringify({
        schemaVersion: 1,
        deviceId: localId,
      }));
      plugin.setLegacyRoleFallbackAllowed(true);

      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      const diag = await plugin.getDeviceDiagnostics();
      expect(diag.device.assignmentState).toBe("legacy-fallback");
      expect(diag.device.role).toBe("producer");
      expect(diag.ownership.isStandbyProducer).toBe(true);
      expect(diag.ownership.isUnassigned).toBe(false);
      expect(diag.transfer.canTransferOwnership).toBe(true);
      expect(diag.transfer.eligibilityReason).toBe("ready");
    });
  });

  describe("Standby Producer promotion flow & fencing", () => {
    it("promotes Desktop B to Active Producer, advances epoch to 2, and fences Desktop A", async () => {
      const desktopAId = generateDeviceId();
      const desktopBId = plugin.getDeviceId();

      // 1. Initial State: Desktop A is Active Producer at epoch 1
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: desktopAId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      // 2. Desktop B is explicitly assigned as Producer
      await plugin.assignDeviceRole("producer");

      // Verify B is Standby Producer
      const gateB = plugin.getOwnershipGate();
      const decisionB = await gateB.evaluate();
      expect(decisionB.authorized).toBe(false);
      expect(decisionB.status).toBe("standby-producer");
      expect(gateB.isStandbyProducerSync()).toBe(true);

      // 3. Prepare transfer preview for B
      const previewResult = await prepareOwnershipTransferPreview(adapter, desktopBId);
      expect(previewResult.success).toBe(true);
      if (!previewResult.success) throw new Error("Expected preview success");

      const preview = previewResult.preview;
      expect(preview.currentProducerId).toBe(desktopAId);
      expect(preview.targetProducerId).toBe(desktopBId);
      expect(preview.currentEpoch).toBe(1);
      expect(preview.nextEpoch).toBe(2);
      expect(preview.requiresConfirmation).toBe(true);

      // 4. Confirm and execute ownership transfer
      const transferResult = await confirmAndExecuteOwnershipTransfer(adapter, preview, {
        confirmed: true,
      });
      expect(transferResult.success).toBe(true);
      if (!transferResult.success) throw new Error("Expected transfer success");

      expect(transferResult.manifest.activeProducerId).toBe(desktopBId);
      expect(transferResult.manifest.epoch).toBe(2);

      // 5. Post-transfer refresh on Desktop B
      await gateB.evaluate();
      expect(gateB.isAuthorizedSync()).toBe(true);
      expect(gateB.isStandbyProducerSync()).toBe(false);
      expect(await gateB.canPublish()).toBe(true);

      const diagB = await plugin.getDeviceDiagnostics();
      expect(diagB.ownership.isActiveProducer).toBe(true);
      expect(diagB.ownership.isStandbyProducer).toBe(false);
      expect(diagB.transfer.canTransferOwnership).toBe(false);
      expect(diagB.transfer.eligibilityReason).toBe("already-active-producer");

      // Command is now unavailable on B because B is Active Producer
      const cmdB = getTransferCommand(plugin);
      expect(cmdB?.checkCallback?.(true)).toBe(false);

      // 6. Old Producer (Desktop A) safety & fencing check
      // Simulate Desktop A evaluating ownership gate after synchronizing new manifest
      const pluginA = new LinaPlugin(app);
      pluginA.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
      (pluginA as unknown as { localDeviceId: string }).localDeviceId = desktopAId;
      await pluginA.assignDeviceRole("producer");

      const gateA = pluginA.getOwnershipGate();
      const decisionA = await gateA.evaluate();
      expect(decisionA.authorized).toBe(false);
      expect(decisionA.status).toBe("standby-producer");
      expect(decisionA.activeProducerId).toBe(desktopBId);
      expect(decisionA.epoch).toBe(2);

      // Desktop A is fenced: cannot publish under new epoch
      expect(await gateA.canPublish()).toBe(false);
      expect(gateA.isAuthorizedSync()).toBe(false);
      expect(gateA.isStandbyProducerSync()).toBe(true);

      // Desktop A is fenced because active ownership now belongs to B:
      const staleEpochDecisionA = await gateA.evaluate(1);
      expect(staleEpochDecisionA.authorized).toBe(false);
      expect(staleEpochDecisionA.status).toBe("standby-producer");

      // Desktop B is active at epoch 2, so evaluating B with stale expectedEpoch = 1 fails with epoch-mismatch:
      const staleEpochDecisionB = await gateB.evaluate(1);
      expect(staleEpochDecisionB.authorized).toBe(false);
      expect(staleEpochDecisionB.status).toBe("epoch-mismatch");
    });
  });

  describe("Mandatory regression check", () => {
    it("allows a second desktop configured as Producer to initiate transfer entirely via Lina without manual file editing", async () => {
      const desktopAId = generateDeviceId();

      // Vault has existing Producer A at epoch 1
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: desktopAId,
        epoch: 1,
        acquiredAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        reason: "initial",
      });

      // Desktop B installs Lina, assigns role = "producer" via Lina's normal API
      await plugin.assignDeviceRole("producer");
      await plugin.getOwnershipGate().evaluate();

      // Verify B is eligible to transfer without editing any JSON file
      const cmd = getTransferCommand(plugin);
      expect(cmd?.checkCallback?.(true)).toBe(true);

      const diag = await plugin.getDeviceDiagnostics();
      expect(diag.transfer.canTransferOwnership).toBe(true);
      expect(diag.transfer.eligibilityReason).toBe("ready");

      // B executes transfer
      const previewRes = await prepareOwnershipTransferPreview(adapter, plugin.getDeviceId());
      expect(previewRes.success).toBe(true);
      if (!previewRes.success) throw new Error("Expected preview");

      const execRes = await confirmAndExecuteOwnershipTransfer(adapter, previewRes.preview, { confirmed: true });
      expect(execRes.success).toBe(true);

      // B is now active producer at epoch 2
      const manifest = JSON.parse(await adapter.read(".lina/ownership.json"));
      expect(manifest.activeProducerId).toBe(plugin.getDeviceId());
      expect(manifest.epoch).toBe(2);
    });
  });

  describe("Relinquished vault recovery flow (activeProducerId = null)", () => {
    it("successfully promotes Standby Producer in a relinquished vault to Active Producer at E+1", async () => {
      const targetDeviceId = plugin.getDeviceId();
      const previousProducerId = generateDeviceId();
      const initialEpoch = 5;

      // 1. Initial State: Vault ownership was relinquished at epoch 5
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: null,
        epoch: initialEpoch,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "relinquish",
      });
      await appendOwnershipAuditEvent(adapter, {
        previousProducerId,
        newProducerId: null,
        previousEpoch: 4,
        newEpoch: initialEpoch,
        reason: "relinquish",
        executedAt: "2026-09-01T10:00:00.000Z",
      });

      // 2. Local device is assigned as Producer
      await plugin.assignDeviceRole("producer");

      // Verify local device is a Standby Producer with publishing blocked
      const gate = plugin.getOwnershipGate();
      const initialDecision = await gate.evaluate();
      expect(initialDecision.authorized).toBe(false);
      expect(initialDecision.status).toBe("standby-producer");
      expect(initialDecision.activeProducerId).toBeUndefined();
      expect(initialDecision.epoch).toBe(initialEpoch);
      expect(gate.isAuthorizedSync()).toBe(false);
      expect(gate.isStandbyProducerSync()).toBe(true);
      expect(await gate.canPublish()).toBe(false);

      // Verify Command Palette visibility: command is available for Standby Producer
      const cmd = getTransferCommand(plugin);
      expect(cmd?.checkCallback?.(true)).toBe(true);

      // Verify Diagnostics snapshot: eligible for transfer
      const diag = await plugin.getDeviceDiagnostics();
      expect(diag.ownership.isActiveProducer).toBe(false);
      expect(diag.ownership.isStandbyProducer).toBe(true);
      expect(diag.ownership.activeProducerId).toBeUndefined();
      expect(diag.ownership.epoch).toBe(initialEpoch);
      expect(diag.transfer.canTransferOwnership).toBe(true);
      expect(diag.transfer.eligibilityReason).toBe("ready");

      // 3. Prepare transfer preview via real production safety layer
      const previewRes = await prepareOwnershipTransferPreview(adapter, targetDeviceId);
      expect(previewRes.success).toBe(true);
      if (!previewRes.success) throw new Error("Expected preview success");

      const preview = previewRes.preview;
      expect(preview.currentProducerId).toBeUndefined(); // Transfer succeeds without previous Producer ID
      expect(preview.targetProducerId).toBe(targetDeviceId);
      expect(preview.currentEpoch).toBe(initialEpoch);
      expect(preview.nextEpoch).toBe(initialEpoch + 1);
      expect(preview.reason).toBe("manual-transfer");
      expect(preview.requiresConfirmation).toBe(true);

      // 4. Confirm and execute ownership transfer using canonical boundary
      const execRes = await confirmAndExecuteOwnershipTransfer(adapter, preview, { confirmed: true });
      expect(execRes.success).toBe(true);
      if (!execRes.success) throw new Error("Expected transfer execution success");

      expect(execRes.manifest.activeProducerId).toBe(targetDeviceId);
      expect(execRes.manifest.epoch).toBe(initialEpoch + 1);
      expect(execRes.manifest.reason).toBe("manual-transfer");
      expect(execRes.previousManifest.activeProducerId).toBeNull();
      expect(execRes.previousManifest.epoch).toBe(initialEpoch);

      // 5. Assert persisted vault ownership manifest
      const persisted = await loadOwnership(adapter);
      expect(persisted).not.toBeNull();
      expect(persisted?.activeProducerId).toBe(targetDeviceId);
      expect(persisted?.epoch).toBe(initialEpoch + 1);
      expect(persisted?.reason).toBe("manual-transfer");

      // 6. Assert audit / history behavior remains valid
      const auditHistory = await loadOwnershipAuditHistory(adapter);
      expect(auditHistory.length).toBe(2);
      const latestAudit = auditHistory[auditHistory.length - 1];
      expect(latestAudit.previousProducerId).toBeUndefined();
      expect(latestAudit.newProducerId).toBe(targetDeviceId);
      expect(latestAudit.previousEpoch).toBe(initialEpoch);
      expect(latestAudit.newEpoch).toBe(initialEpoch + 1);
      expect(latestAudit.reason).toBe("manual-transfer");

      // 7. Assert post-transfer gate evaluation and local publishing authorization
      await gate.evaluate();
      expect(gate.isAuthorizedSync()).toBe(true);
      expect(gate.isStandbyProducerSync()).toBe(false);
      expect(await gate.canPublish()).toBe(true);

      // 8. Assert command becomes inactive (device is already Active Producer)
      expect(cmd?.checkCallback?.(true)).toBe(false);

      // 9. Assert diagnostics reflects active ownership
      const postDiag = await plugin.getDeviceDiagnostics();
      expect(postDiag.ownership.isActiveProducer).toBe(true);
      expect(postDiag.ownership.isStandbyProducer).toBe(false);
      expect(postDiag.ownership.activeProducerId).toBe(targetDeviceId);
      expect(postDiag.ownership.epoch).toBe(initialEpoch + 1);
      expect(postDiag.transfer.canTransferOwnership).toBe(false);
      expect(postDiag.transfer.eligibilityReason).toBe("already-active-producer");

      // 10. Invariant: Epoch never reset to 1
      expect(persisted?.epoch).toBe(6);
      expect(persisted?.epoch).not.toBe(1);
    });
  });
});
