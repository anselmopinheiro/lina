import { describe, it, expect, beforeEach, vi } from "vitest";
import { App, Platform, Setting } from "obsidian";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  saveOwnership,
  loadOwnership,
  relinquishOwnership,
  isOwnershipManifest,
  OwnershipManifest,
} from "../../src/device/deviceOwnership";
import { loadOwnershipAuditHistory, isOwnershipAuditEvent } from "../../src/device/deviceOwnershipAudit";
import { generateDeviceId } from "../../src/device/deviceIdentity";
import { loadDeviceState } from "../../src/device/deviceState";
import { DEFAULT_SETTINGS, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { createDeviceRoleDescriptionRenderer } from "../../src/settings/declarativeSettingRenderers";
import { DeviceRoleChangeModal } from "../../src/device/deviceRoleChangeModal";

describe("Phase 0.2.2.X.1.7 — Controlled Device Role Changes & Active Producer Demotion", () => {
  let app: App;
  let adapter: FakeAdapter;
  let plugin: LinaPlugin;
  const pt = getStrings("pt-PT");
  const en = getStrings("en");

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

  describe("relinquishOwnership primitive", () => {
    it("safely advances epoch, sets activeProducerId = null, reason = 'relinquish', and appends audit event", async () => {
      const activeId = generateDeviceId();
      const initialManifest: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: activeId,
        epoch: 3,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      };
      await saveOwnership(adapter, initialManifest);

      const relinquished = await relinquishOwnership(adapter, activeId, 3);

      expect(relinquished.schemaVersion).toBe(1);
      expect(relinquished.activeProducerId).toBeNull();
      expect(relinquished.epoch).toBe(4);
      expect(relinquished.reason).toBe("relinquish");
      expect(isOwnershipManifest(relinquished)).toBe(true);

      const manifestOnDisk = await loadOwnership(adapter);
      expect(manifestOnDisk).toEqual(relinquished);

      // Audit history verification
      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(1);
      const event = history[0];
      expect(event.previousProducerId).toBe(activeId);
      expect(event.newProducerId).toBeNull();
      expect(event.previousEpoch).toBe(3);
      expect(event.newEpoch).toBe(4);
      expect(event.reason).toBe("relinquish");
      expect(isOwnershipAuditEvent(event)).toBe(true);
    });

    it("fails safe when device is not the active producer", async () => {
      const activeId = generateDeviceId();
      const impostorId = generateDeviceId();
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: activeId,
        epoch: 1,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      });

      await expect(relinquishOwnership(adapter, impostorId)).rejects.toThrow(
        /is not the active producer/
      );

      const manifestOnDisk = await loadOwnership(adapter);
      expect(manifestOnDisk?.activeProducerId).toBe(activeId);
      expect(manifestOnDisk?.epoch).toBe(1);
    });

    it("fails safe on epoch fencing mismatch", async () => {
      const activeId = generateDeviceId();
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: activeId,
        epoch: 5,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      });

      await expect(relinquishOwnership(adapter, activeId, 4)).rejects.toThrow(
        /epoch mismatch during relinquish/
      );

      const manifestOnDisk = await loadOwnership(adapter);
      expect(manifestOnDisk?.epoch).toBe(5);
    });

    it("fails safe when no ownership manifest exists", async () => {
      const activeId = generateDeviceId();
      await expect(relinquishOwnership(adapter, activeId)).rejects.toThrow(
        /no ownership manifest exists/
      );
    });
  });

  describe("Critical Path: Active Producer -> Companion", () => {
    it("safely relinquishes ownership, updates role, shuts down workers, and invalidates authority", async () => {
      const localId = plugin.getDeviceId();

      // Configure as initial Producer and active owner at epoch 1
      await plugin.assignDeviceRole("producer");
      const gate = plugin.getOwnershipGate();
      const initialDecision = await gate.evaluate();
      expect(initialDecision.authorized).toBe(true);
      expect(initialDecision.status).toBe("authorized");
      expect(initialDecision.activeProducerId).toBe(localId);
      expect(initialDecision.epoch).toBe(1);

      // Verify publishing is authorized
      expect(await gate.canPublish()).toBe(true);

      // Execute role change to Companion
      const updatedState = await plugin.changeDeviceRole("companion");
      expect(updatedState.role).toBe("companion");

      // Verify manifest on disk: epoch advanced to 2, activeProducerId is null, reason is relinquish
      const manifestOnDisk = await loadOwnership(adapter);
      expect(manifestOnDisk?.schemaVersion).toBe(1);
      expect(manifestOnDisk?.activeProducerId).toBeNull();
      expect(manifestOnDisk?.epoch).toBe(2);
      expect(manifestOnDisk?.reason).toBe("relinquish");

      // Verify gate evaluation: NOT authorized, not-producer-role
      const postDecision = await gate.evaluate();
      expect(postDecision.authorized).toBe(false);
      expect(postDecision.status).toBe("not-producer-role");
      expect(await gate.canPublish()).toBe(false);

      // Invariant: Never allow role = companion AND OwnershipGate authorized = true
      expect(plugin.getLocalDeviceRole()).toBe("companion");
      expect(gate.isAuthorizedSync()).toBe(false);

      // Verify audit trail
      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(1);
      expect(history[0].previousProducerId).toBe(localId);
      expect(history[0].newProducerId).toBeNull();
      expect(history[0].reason).toBe("relinquish");
      expect(history[0].newEpoch).toBe(2);
    });

    it("fails safe if ownership relinquish fails: remains Producer and preserves authority", async () => {
      const localId = plugin.getDeviceId();
      await plugin.assignDeviceRole("producer");
      await plugin.getOwnershipGate().evaluate();

      // Corrupt adapter write for ownership to simulate catastrophic IO/fencing error
      const originalWrite = adapter.write.bind(adapter);
      adapter.write = vi.fn(async (path: string, data: string) => {
        if (path.includes("ownership.json")) {
          throw new Error("Simulated storage write failure");
        }
        return originalWrite(path, data);
      });

      await expect(plugin.changeDeviceRole("companion")).rejects.toThrow(
        /Simulated storage write failure/
      );

      // Device remains Producer!
      const diskState = await loadDeviceState(adapter, localId);
      expect(diskState?.role).toBe("producer");
      expect(plugin.getLocalDeviceRole()).toBe("producer");

      // Manifest remains uncorrupted
      adapter.write = originalWrite;
      const manifest = await loadOwnership(adapter);
      expect(manifest?.activeProducerId).toBe(localId);
      expect(manifest?.epoch).toBe(1);
    });

    it("fails safe if role persistence fails after relinquish: publishing remains revoked", async () => {
      const localId = plugin.getDeviceId();
      await plugin.assignDeviceRole("producer");
      await plugin.getOwnershipGate().evaluate();

      // Make device state write fail, but ownership write succeed
      const originalWrite = adapter.write.bind(adapter);
      adapter.write = vi.fn(async (path: string, data: string) => {
        if (path.includes(`.lina/devices/${localId}.json`)) {
          throw new Error("Device state disk full");
        }
        return originalWrite(path, data);
      });

      await expect(plugin.changeDeviceRole("companion")).rejects.toThrow(
        /Ownership authority was safely relinquished, but failed to save role as companion/
      );

      // Ownership on disk is revoked at epoch 2
      adapter.write = originalWrite;
      const manifest = await loadOwnership(adapter);
      expect(manifest?.activeProducerId).toBeNull();
      expect(manifest?.epoch).toBe(2);

      // Gate evaluation confirms device CANNOT publish!
      const gateDecision = await plugin.getOwnershipGate().evaluate();
      expect(gateDecision.authorized).toBe(false);
      expect(await plugin.getOwnershipGate().canPublish()).toBe(false);
    });
  });

  describe("Standby Producer -> Companion", () => {
    it("changes role to companion without modifying ownership manifest or epoch", async () => {
      const localId = plugin.getDeviceId();
      const remoteActiveId = generateDeviceId();

      await plugin.assignDeviceRole("producer");
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteActiveId,
        epoch: 7,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "initial",
      });

      const initialDecision = await plugin.getOwnershipGate().evaluate();
      expect(initialDecision.status).toBe("standby-producer");
      expect(initialDecision.authorized).toBe(false);

      // Change Standby Producer -> Companion
      const updated = await plugin.changeDeviceRole("companion");
      expect(updated.role).toBe("companion");

      // Ownership manifest untouched
      const manifest = await loadOwnership(adapter);
      expect(manifest?.activeProducerId).toBe(remoteActiveId);
      expect(manifest?.epoch).toBe(7);

      // Gate is now not-producer-role
      const postDecision = await plugin.getOwnershipGate().evaluate();
      expect(postDecision.status).toBe("not-producer-role");
      expect(postDecision.authorized).toBe(false);

      // No relinquish audit event appended
      const history = await loadOwnershipAuditHistory(adapter);
      expect(history.length).toBe(0);
    });
  });

  describe("Companion -> Producer", () => {
    it("becomes Standby Producer when an Active Producer already exists without stealing ownership", async () => {
      const localId = plugin.getDeviceId();
      const remoteActiveId = generateDeviceId();

      // Configure local device as Companion
      await plugin.assignDeviceRole("companion");
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: remoteActiveId,
        epoch: 4,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "manual-transfer",
      });

      expect(plugin.getLocalDeviceRole()).toBe("companion");

      // Promote Companion -> Producer
      const updated = await plugin.changeDeviceRole("producer");
      expect(updated.role).toBe("producer");

      // Manifest remains owned by remote device at epoch 4 (NO theft)
      const manifest = await loadOwnership(adapter);
      expect(manifest?.activeProducerId).toBe(remoteActiveId);
      expect(manifest?.epoch).toBe(4);

      // Local device is now Standby Producer
      const decision = await plugin.getOwnershipGate().evaluate();
      expect(decision.status).toBe("standby-producer");
      expect(decision.authorized).toBe(false);
      expect(decision.activeProducerId).toBe(remoteActiveId);
      expect(await plugin.getOwnershipGate().canPublish()).toBe(false);
    });

    it("becomes Active Producer when vault has no existing ownership", async () => {
      const localId = plugin.getDeviceId();

      // Initial companion role in unowned vault
      await plugin.assignDeviceRole("companion");
      expect(await loadOwnership(adapter)).toBeNull();

      // Change to Producer
      const updated = await plugin.changeDeviceRole("producer");
      expect(updated.role).toBe("producer");

      // Auto-claim executes: epoch = 1, activeProducerId = localId
      const manifest = await loadOwnership(adapter);
      expect(manifest?.activeProducerId).toBe(localId);
      expect(manifest?.epoch).toBe(1);
      expect(manifest?.reason).toBe("initial");

      const decision = await plugin.getOwnershipGate().evaluate();
      expect(decision.authorized).toBe(true);
      expect(decision.status).toBe("authorized");
      expect(await plugin.getOwnershipGate().canPublish()).toBe(true);
    });

    it("becomes Standby Producer when vault ownership was previously relinquished", async () => {
      const localId = plugin.getDeviceId();
      const previousOwnerId = generateDeviceId();

      // Set relinquished manifest at epoch 5
      await saveOwnership(adapter, {
        schemaVersion: 1,
        activeProducerId: null,
        epoch: 5,
        acquiredAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        reason: "relinquish",
      });

      await plugin.assignDeviceRole("companion");

      // Promote to Producer
      await plugin.changeDeviceRole("producer");

      // Manifest remains at epoch 5, activeProducerId null (no silent steal)
      const manifest = await loadOwnership(adapter);
      expect(manifest?.activeProducerId).toBeNull();
      expect(manifest?.epoch).toBe(5);

      // Gate evaluates to standby
      const decision = await plugin.getOwnershipGate().evaluate();
      expect(decision.status).toBe("standby-producer");
      expect(decision.authorized).toBe(false);
    });
  });

  describe("Mobile restrictions in Lina 0.2.x", () => {
    it("rejects promotion to Producer when running on mobile", async () => {
      Platform.isMobile = true;
      await plugin.assignDeviceRole("companion");

      await expect(plugin.changeDeviceRole("producer")).rejects.toThrow(
        pt.deviceRoleChangeMobileProducerNotSupported
      );

      // Role unchanged
      expect(plugin.getLocalDeviceRole()).toBe("companion");
    });
  });

  describe("Idempotence", () => {
    it("returns immediately without side effects when target role matches current assigned role", async () => {
      await plugin.assignDeviceRole("companion");
      const writeSpy = vi.spyOn(adapter, "write");

      const res = await plugin.changeDeviceRole("companion");
      expect(res.role).toBe("companion");
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe("Settings UI Affordances & Modal Flow", () => {
    interface MockSetting {
      name: string;
      desc: string;
      buttons: Array<{ text: string; onClick: () => void }>;
      setName(n: string): MockSetting;
      setDesc(d: string): MockSetting;
      addButton(cb: (btn: any) => void): MockSetting;
    }

    function createMockSetting(): MockSetting {
      const mock: MockSetting = {
        name: "",
        desc: "",
        buttons: [],
        setName(n: string) {
          mock.name = n;
          return mock;
        },
        setDesc(d: string) {
          mock.desc = d;
          return mock;
        },
        addButton(cb: (btn: any) => void) {
          const btn = {
            buttonText: "",
            setButtonText(t: string) {
              btn.buttonText = t;
              return btn;
            },
            onClick(h: () => void) {
              mock.buttons.push({ text: btn.buttonText, onClick: h });
              return btn;
            },
          };
          cb(btn);
          return mock;
        },
      };
      return mock;
    }

    function createMockElement(tag = "div", options?: any) {
      const children: any[] = [];
      const classes = new Set<string>();
      const listeners: Record<string, Function[]> = {};

      const el: any = {
        tagName: tag.toUpperCase(),
        textContent: options?.text ?? "",
        classes,
        children,
        disabled: false,
        empty() {
          children.length = 0;
        },
        addClass(cls: string) {
          classes.add(cls);
        },
        classList: {
          contains(cls: string) {
            return classes.has(cls);
          },
        },
        createDiv(opts?: any) {
          const child = createMockElement("div", opts);
          children.push(child);
          return child;
        },
        createEl(childTag: string, opts?: any) {
          const child = createMockElement(childTag, opts);
          children.push(child);
          return child;
        },
        addEventListener(event: string, fn: Function) {
          listeners[event] ??= [];
          listeners[event].push(fn);
        },
        click() {
          listeners["click"]?.forEach((fn) => fn());
        },
        setText(t: string) {
          el.textContent = t;
        },
        querySelector(selector: string) {
          const sel = selector.toUpperCase();
          function search(node: any): any {
            if (node.tagName === sel) return node;
            for (const c of node.children) {
              const found = search(c);
              if (found) return found;
            }
            return null;
          }
          for (const c of children) {
            const found = search(c);
            if (found) return found;
          }
          return null;
        },
        querySelectorAll(selector: string) {
          const sel = selector.toUpperCase();
          const results: any[] = [];
          function collect(node: any) {
            if (node.tagName === sel) results.push(node);
            for (const c of node.children) {
              collect(c);
            }
          }
          for (const c of children) {
            collect(c);
          }
          return results;
        },
      };
      return el;
    }

    it("renders 'Change device role…' button for assigned desktop devices", () => {
      const mockSetting = createMockSetting();
      const onChangeDeviceRole = vi.fn();

      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        role: "producer",
        resolution: {
          assignmentState: "assigned",
          effectiveRole: "producer",
          recommendedRole: "producer",
          persistedRole: "producer",
          isLegacyFallbackEligible: false,
        },
        onChangeDeviceRole,
        isMobile: false,
      });

      renderer(mockSetting as any, {} as any);

      expect(mockSetting.buttons.length).toBe(1);
      expect(mockSetting.buttons[0].text).toBe(pt.settingsDeviceChangeRoleAction);

      mockSetting.buttons[0].onClick();
      expect(onChangeDeviceRole).toHaveBeenCalledTimes(1);
    });

    it("does NOT render 'Change device role…' button on mobile devices", () => {
      const mockSetting = createMockSetting();
      const onChangeDeviceRole = vi.fn();

      const renderer = createDeviceRoleDescriptionRenderer({
        strings: pt,
        role: "companion",
        resolution: {
          assignmentState: "assigned",
          effectiveRole: "companion",
          recommendedRole: "companion",
          persistedRole: "companion",
          isLegacyFallbackEligible: false,
        },
        onChangeDeviceRole,
        isMobile: true,
      });

      renderer(mockSetting as any, {} as any);

      expect(mockSetting.buttons.length).toBe(0);
    });

    it("DeviceRoleChangeModal displays active producer warning and triggers confirmation", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const onSuccess = vi.fn();

      const modal = new DeviceRoleChangeModal(app, {
        currentRole: "producer",
        targetRole: "companion",
        isActiveProducer: true,
        onConfirm,
        onSuccess,
        strings: pt,
      });

      modal.contentEl = createMockElement("div");
      modal.onOpen();

      // Check warning presence
      const warningHeader = modal.contentEl.querySelector("h4");
      expect(warningHeader?.textContent).toBe(pt.deviceRoleChangeActiveProducerWarningTitle);

      const buttons = modal.contentEl.querySelectorAll("button");
      expect(buttons.length).toBe(2);

      const cancelButton = buttons[0];
      const confirmButton = buttons[1];

      expect(cancelButton.textContent).toBe(pt.deviceRoleChangeCancelButton);
      expect(confirmButton.textContent).toBe(pt.deviceRoleChangeToCompanionTitle);
      expect(confirmButton.classList.contains("mod-warning")).toBe(true);

      // Click confirm
      confirmButton.click();
      await vi.waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith("companion");
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });
    });
  });
});
