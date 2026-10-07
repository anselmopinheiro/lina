import { describe, expect, it, vi } from "vitest";
import { OwnershipGate } from "../../src/device/ownershipGate";
import { BinaryWorker } from "../../src/maintenance/binaryWorker";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { FakeAdapter } from "../helpers/fakeAdapter";

const local = "440d9ef0-9ff9-424e-ae55-7c386b885ec8";
const remote = "550d9ef0-9ff9-424e-ae55-7c386b885ec8";
function fixture() {
  const adapter = new FakeAdapter();
  let identity = local;
  let role: "producer" | "companion" = "producer";
  const ownership = (owner = local, epoch = 3) => adapter.setFile(".lina/ownership.json", JSON.stringify({ schemaVersion: 1, activeProducerId: owner, epoch, acquiredAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }));
  ownership();
  const gate = new OwnershipGate(adapter, () => identity, () => role, false);
  const execute = vi.fn(async () => ({ status: "valid" }));
  const preflight = async () => {
    const token = await gate.acquireFence({ autoClaimIfUnclaimed: false });
    return token ? gate.assertFence(token) : false;
  };
  const worker = new BinaryWorker({ capabilities: resolveDeviceCapabilities({ isMobile: false }), canPublish: preflight, check: execute, createOrUpdate: execute, remove: async () => {}, maintainAfterPublication: execute, onBinaryPublicationReady: () => {}, onAutomaticMaintenanceFailure: () => {} });
  worker.start();
  return { adapter, gate, ownership, worker, execute, preflight, setIdentity: (id: string) => { identity = id; }, setRole: (next: "producer" | "companion") => { role = next; } };
}

describe("G6 authoritative binary preflight", () => {
  it("replaces stale denial before the worker executes", async () => {
    const f = fixture(); await f.gate.evaluate(2);
    expect(await f.worker.createOrUpdate()).toEqual({ status: "valid" });
    expect(f.gate.getLastDecision()?.authorized).toBe(true);
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it("rejects stale allowance after ownership transfer", async () => {
    const f = fixture(); await f.gate.evaluate(); f.ownership(remote, 4);
    expect(await f.worker.createOrUpdate()).toBeUndefined();
    expect(f.gate.getLastDecision()?.authorized).toBe(false);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("synchronizes a successful fence acquisition", async () => {
    const f = fixture(); await f.gate.evaluate(2);
    expect(await f.gate.acquireFence({ autoClaimIfUnclaimed: false })).toEqual({ producerDeviceId: local, epoch: 3 });
    expect(f.gate.getLastDecision()?.authorized).toBe(true);
  });
  it("synchronizes denial when ownership is unreadable", async () => {
    const f = fixture(); await f.gate.evaluate(); f.adapter.setFile(".lina/ownership.json", "invalid");
    expect(await f.preflight()).toBe(false);
    expect(f.gate.getLastDecision()?.authorized).toBe(false);
  });
  it("stores epoch mismatch after a previously valid preflight", async () => {
    const f = fixture(); const token = await f.gate.acquireFence(); f.ownership(local, 4);
    expect(token && await f.gate.assertFence(token)).toBe(false);
    expect(f.gate.getLastDecision()).toMatchObject({ authorized: false, status: "epoch-mismatch" });
  });
  it("denies a token for another owner even when local ownership is valid", async () => {
    const f = fixture();
    expect(await f.gate.assertFence({ producerDeviceId: remote, epoch: 3 })).toBe(false);
    expect(f.gate.getLastDecision()?.authorized).toBe(false);
  });
  it("reevaluates role changes", async () => {
    const f = fixture(); await f.gate.evaluate(); f.setRole("companion");
    expect(await f.worker.createOrUpdate()).toBeUndefined();
    expect(f.gate.getLastDecision()?.status).toBe("not-producer-role");
  });
  it("reevaluates identity changes", async () => {
    const f = fixture(); await f.gate.evaluate(); f.setIdentity(remote);
    expect(await f.worker.createOrUpdate()).toBeUndefined();
    expect(f.gate.getLastDecision()?.status).toBe("standby-producer");
  });
  it("reload starts with no cache and still validates authority", async () => {
    const f = fixture(); expect(f.gate.getLastDecision()).toBeNull();
    expect(await f.preflight()).toBe(true);
  });
  it("repeated preflight is idempotent and never writes ownership", async () => {
    const f = fixture(); const before = f.adapter.getFile(".lina/ownership.json");
    expect(await f.preflight()).toBe(true); expect(await f.preflight()).toBe(true);
    expect(f.adapter.getFile(".lina/ownership.json")).toBe(before);
    expect(f.adapter.writeCount).toBe(0);
  });
  it("blocks asynchronous automatic maintenance after a denied fresh preflight", async () => {
    const f = fixture(); await f.gate.evaluate(); f.ownership(remote, 4);
    f.worker.maintainAfterPublication("existing-publication");
    await vi.waitFor(() => expect(f.gate.getLastDecision()?.authorized).toBe(false));
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("fails the durable fence after transfer without leaving an allow in cache", async () => {
    const f = fixture(); const token = await f.gate.acquireFence(); f.ownership(remote, 4);
    expect(token && await f.gate.assertFence(token)).toBe(false);
    expect(f.gate.isAuthorizedSync()).toBe(false);
  });
  it("does not auto-claim missing ownership", async () => {
    const f = fixture(); await f.adapter.remove(".lina/ownership.json");
    expect(await f.preflight()).toBe(false); expect(f.adapter.writeCount).toBe(0);
  });
  it("uses only the binary executor with no provider or embedding generation", async () => {
    const f = fixture(); const fetchSpy = vi.spyOn(globalThis, "fetch");
    try { await f.worker.createOrUpdate(); expect(fetchSpy).not.toHaveBeenCalled(); expect(f.execute).toHaveBeenCalledOnce(); }
    finally { fetchSpy.mockRestore(); }
  });
  it("does not overwrite a newer denial with an older allow completion", async () => {
    const f = fixture();
    const read = f.adapter.read.bind(f.adapter);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.adapter, "read").mockImplementationOnce(async path => {
      const old = await read(path); entered(); await pending; return old;
    });
    const oldAcquisition = f.gate.acquireFence({ autoClaimIfUnclaimed: false });
    await ready; f.ownership(remote, 4);
    expect(await f.gate.acquireFence({ autoClaimIfUnclaimed: false })).toBeUndefined();
    release(); const oldToken = await oldAcquisition;
    expect(f.gate.getLastDecision()?.authorized).toBe(false);
    expect(oldToken && await f.gate.assertFence(oldToken)).toBe(false);
    expect(f.gate.getLastDecision()?.authorized).toBe(false);
  });
  it("rejects identity changes during an awaited authoritative read", async () => {
    const f = fixture(); const read = f.adapter.read.bind(f.adapter);
    vi.spyOn(f.adapter, "read").mockImplementationOnce(async path => {
      const value = await read(path); f.setIdentity(remote); return value;
    });
    expect(await f.preflight()).toBe(false);
    expect(f.gate.getLastDecision()?.authorized).toBe(false);
  });
  it("does not write after dispose while an async preflight is pending", async () => {
    let release!: (allowed: boolean) => void;
    const decision = new Promise<boolean>(resolve => { release = resolve; });
    const execute = vi.fn(async () => ({ status: "valid" }));
    const worker = new BinaryWorker({ capabilities: resolveDeviceCapabilities({ isMobile: false }), canPublish: () => decision, check: execute, createOrUpdate: execute, remove: async () => {}, maintainAfterPublication: execute, onBinaryPublicationReady: () => {}, onAutomaticMaintenanceFailure: () => {} });
    worker.start(); const request = worker.createOrUpdate(); worker.dispose(); release(true);
    expect(await request).toBeUndefined(); expect(execute).not.toHaveBeenCalled();
  });
});
