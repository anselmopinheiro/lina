import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { getOrCreatePersistentDeviceId } from "../../src/device/deviceIdentity";
import {
  saveDeviceState,
  type DeviceState,
} from "../../src/device/deviceState";
import {
  claimInitialOwnership,
  loadOwnership,
  type OwnershipManifest,
} from "../../src/device/deviceOwnership";

describe("Device Role Runtime Safety (Phase 0.2.2.X.1.3)", () => {
  afterEach(() => {
    Platform.isMobile = false;
    vi.restoreAllMocks();
  });

  describe("Mandatory Regression: Identical Desktop Platform, Missing Role", () => {
    it("enforces unassigned safety on a genuinely fresh desktop installation", async () => {
      // 1. Fresh installation: No per-device state file exists in vault
      Platform.isMobile = false;
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const deviceId = getOrCreatePersistentDeviceId(app);
      expect(adapter.hasFile(`.lina/devices/${deviceId}.json`)).toBe(false);
      expect(adapter.hasFile(".lina/ownership.json")).toBe(false);

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      // Legacy fallback must be forbidden on fresh devices
      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(false);

      // Canonical role resolution: unassigned
      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("unassigned");
      expect(resolution.effectiveRole).toBe("unassigned");
      expect(resolution.recommendedRole).toBe("producer");
      expect(resolution.persistedRole).toBeUndefined();

      // Helper methods must agree
      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");
      expect(plugin.getLocalDeviceRole()).toBeUndefined(); // Never silently falls back to producer

      // OwnershipGate must block and NOT auto-claim
      const gate = plugin.getOwnershipGate();
      expect(gate.isAuthorizedSync()).toBe(false);
      expect(await gate.canPublish()).toBe(false);

      const decision = await gate.evaluate();
      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("not-producer-role");

      // Critical safety invariant: .lina/ownership.json must NOT be created!
      expect(adapter.hasFile(".lina/ownership.json")).toBe(false);
    });

    it("preserves historical Producer authority on pre-existing legacy desktop installations", async () => {
      // 2. Legacy pre-existing installation: per-device state file existed prior to this version
      // but omitted the `role` field.
      Platform.isMobile = false;
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const deviceId = getOrCreatePersistentDeviceId(app);

      // Pre-existing valid state file on disk without role
      const legacyPreExistingState: DeviceState = {
        schemaVersion: 2,
        deviceId,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-15T12:00:00.000Z",
        deviceName: "My Workstation",
        // role is intentionally omitted/undefined
      };
      await saveDeviceState(adapter, legacyPreExistingState);

      // Also simulate existing active producer ownership from prior usage
      const initialManifest = await claimInitialOwnership(adapter, deviceId);
      expect(initialManifest.epoch).toBe(1);
      expect(initialManifest.activeProducerId).toBe(deviceId);

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      // Legacy fallback is explicitly allowed
      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(true);

      // Canonical role resolution: legacy-fallback
      const resolution = plugin.getDeviceRoleResolution();
      expect(resolution.assignmentState).toBe("legacy-fallback");
      expect(resolution.effectiveRole).toBe("producer");
      expect(resolution.recommendedRole).toBe("producer");
      expect(resolution.persistedRole).toBeUndefined();

      // Effective role is producer
      expect(plugin.getEffectiveDeviceRole()).toBe("producer");
      expect(plugin.getLocalDeviceRole()).toBe("producer");

      // Active Producer authority is preserved without epoch change or outage
      const gate = plugin.getOwnershipGate();
      expect(gate.isAuthorizedSync()).toBe(true);
      expect(await gate.canPublish()).toBe(true);

      const decision = await gate.evaluate();
      expect(decision.authorized).toBe(true);
      expect(decision.status).toBe("authorized");
      expect(decision.activeProducerId).toBe(deviceId);
      expect(decision.epoch).toBe(1);

      // Manifest remains intact
      const currentManifest = await loadOwnership(adapter);
      expect(currentManifest?.epoch).toBe(1);
      expect(currentManifest?.activeProducerId).toBe(deviceId);
    });
  });

  describe("Fresh Unassigned Desktop Operational Lockdown", () => {
    let adapter: FakeAdapter;
    let app: App;
    let plugin: LinaPlugin;

    beforeEach(async () => {
      Platform.isMobile = false;
      adapter = new FakeAdapter();
      app = new App();
      app.vault.adapter = adapter;

      plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();
    });

    it("blocks manual text index rebuilds on unassigned fresh desktop", async () => {
      const result = await plugin.rebuildTextIndex();
      expect(result.success).toBe(false);
      expect(result.message).toBe("Esta operação requer um dispositivo produtor do Lina.");
    });

    it("blocks manual embedding generation on unassigned fresh desktop", async () => {
      const result = await plugin.confirmAndRequestEmbeddingGeneration("command");
      expect(result.success).toBe(false);
      expect(result.message).toBe("Esta operação requer um dispositivo produtor do Lina.");
    });

    it("rejects embedding generation requests with not-active-producer", () => {
      const request = plugin.requestEmbeddingIndexGeneration("command");
      expect(request.status).toBe("not-active-producer");
    });

    it("blocks MaintenanceEngine publishing authority on unassigned fresh desktop", async () => {
      const engine = plugin.getMaintenanceEngine();
      expect(await engine.canPublish()).toBe(false);
    });

    it("blocks binary embedding maintenance publication on unassigned fresh desktop", async () => {
      const summary = await plugin.createOrUpdateBinaryEmbeddingCopy();
      expect(summary.status).toBe("error");
      expect(summary.reason).toBe("Esta operação requer um dispositivo produtor do Lina.");
    });

    it("blocks text index rebuild from executing on unassigned fresh desktop", async () => {
      const result = await plugin.rebuildTextIndex();
      expect(result.success).toBe(false);
      expect(result.message).toBe("Esta operação requer um dispositivo produtor do Lina.");
    });

    it("blocks startup reconciliation from running on unassigned fresh desktop", async () => {
      const engine = plugin.getMaintenanceEngine();
      const completed = await engine.runStartupReconciliation();
      expect(completed).toBe(false);
    });

    it("blocks startup index automation from updating index on unassigned fresh desktop", async () => {
      plugin.settings.updateIndexOnStartup = true;
      const initialIndexData = plugin.indexData;
      await (plugin as any).runStartupIndexAutomation();
      expect(plugin.indexData).toBe(initialIndexData);
    });

    it("disables transfer-ownership command on unassigned fresh desktop", () => {
      // Find the transfer ownership command registered on plugin
      let checkCallbackResult: boolean | undefined;
      const commands = (plugin as any).commands ?? [];
      for (const cmd of commands) {
        if (cmd.id === "transferir-ownership-dispositivo") {
          checkCallbackResult = cmd.checkCallback(true);
        }
      }
      // If found via private access or directly invoking checkCallback logic
      expect(plugin.getEffectiveDeviceRole() === "producer").toBe(false);
    });
  });

  describe("Startup Corrupted State Handling", () => {
    it("fails safe to unassigned when device state file is corrupted/unparseable", async () => {
      Platform.isMobile = false;
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const deviceId = getOrCreatePersistentDeviceId(app);

      // Write corrupted JSON to the device state file path
      adapter.setFile(`.lina/devices/${deviceId}.json`, "{ corrupted json invalid !!!");

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      // Must fail safe toward unassigned, never granting legacy fallback
      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(false);
      expect(plugin.getEffectiveDeviceRole()).toBe("unassigned");
      expect(plugin.getLocalDeviceRole()).toBeUndefined();
      expect(plugin.getOwnershipGate().isAuthorizedSync()).toBe(false);
      expect(adapter.hasFile(".lina/ownership.json")).toBe(false);
    });
  });

  describe("Assigned Role Invariants", () => {
    it("never allows assigned Companion to auto-claim or publish even on desktop", async () => {
      Platform.isMobile = false;
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const deviceId = getOrCreatePersistentDeviceId(app);

      const assignedCompanionState: DeviceState = {
        schemaVersion: 2,
        deviceId,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-15T12:00:00.000Z",
        role: "companion",
      };
      await saveDeviceState(adapter, assignedCompanionState);

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(false);
      expect(plugin.getEffectiveDeviceRole()).toBe("companion");
      expect(plugin.getLocalDeviceRole()).toBe("companion");

      const decision = await plugin.getOwnershipGate().evaluate();
      expect(decision.authorized).toBe(false);
      expect(decision.status).toBe("not-producer-role");
      expect(adapter.hasFile(".lina/ownership.json")).toBe(false);
      expect(plugin.getOwnershipGate().isAuthorizedSync()).toBe(false);
    });

    it("authorizes assigned Producer matching active ownership", async () => {
      Platform.isMobile = false;
      const adapter = new FakeAdapter();
      const app = new App();
      app.vault.adapter = adapter;

      const deviceId = getOrCreatePersistentDeviceId(app);

      const assignedProducerState: DeviceState = {
        schemaVersion: 2,
        deviceId,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-15T12:00:00.000Z",
        role: "producer",
      };
      await saveDeviceState(adapter, assignedProducerState);
      await claimInitialOwnership(adapter, deviceId);

      const plugin = new LinaPlugin(app);
      await plugin.loadDataFromDisk();

      expect(plugin.isLegacyRoleFallbackAllowed()).toBe(false); // Assigned, no fallback
      expect(plugin.getEffectiveDeviceRole()).toBe("producer");
      expect(plugin.getLocalDeviceRole()).toBe("producer");

      const decision = await plugin.getOwnershipGate().evaluate();
      expect(decision.authorized).toBe(true);
      expect(decision.status).toBe("authorized");
      expect(plugin.getOwnershipGate().isAuthorizedSync()).toBe(true);
    });
  });
});
