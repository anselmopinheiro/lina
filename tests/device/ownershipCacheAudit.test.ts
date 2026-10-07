import { describe, expect, it } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { OwnershipGate, evaluateOwnershipGate } from "../../src/device/ownershipGate";
import { BinaryWorker } from "../../src/maintenance/binaryWorker";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";

const id = "440d9ef0-9ff9-424e-ae55-7c386b885ec8";
function fixture() {
  const adapter = new FakeAdapter();
  adapter.setFile(".lina/ownership.json", JSON.stringify({schemaVersion: 1, activeProducerId: id, epoch: 3, acquiredAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", reason: "manual-transfer"}));
  const gate = new OwnershipGate(adapter, () => id, () => "producer", false);
  return { adapter, gate };
}
describe("G6 ownership cache audit (isolated regression coverage)", () => {
  it("repairs malformed preflight denial through a fresh fence before binary execution", async () => {
    const {adapter,gate} = fixture();
    const before = adapter.getFile(".lina/ownership.json");
    // Reflect reproduces the untyped JavaScript harness call; production signature is numeric.
    await Reflect.apply(gate.evaluate, gate, [{autoClaimIfUnclaimed:false}]);
    expect(gate.getLastDecision()).toMatchObject({authorized:false,status:"epoch-mismatch"});
    const token = await gate.acquireFence({autoClaimIfUnclaimed:false});
    expect(token).toMatchObject({producerDeviceId:id,epoch:3});
    expect(gate.isAuthorizedSync()).toBe(true);
    expect((await evaluateOwnershipGate(adapter,id,"producer",undefined,{autoClaimIfUnclaimed:false})).authorized).toBe(true);
    expect(gate.isAuthorizedSync()).toBe(true);
    let binaryCalls = 0;
    const worker = new BinaryWorker({capabilities:resolveDeviceCapabilities({isMobile:false}),canPublish:()=>gate.isAuthorizedSync(),check:async()=>({status:"valid"}),createOrUpdate:async()=>{binaryCalls++;return {status:"valid"};},remove:async()=>undefined,maintainAfterPublication:async()=>({status:"valid"}),onBinaryPublicationReady:()=>undefined,onAutomaticMaintenanceFailure:()=>undefined});
    worker.start();
    expect(await worker.createOrUpdate()).toEqual({status:"valid"});
    expect(binaryCalls).toBe(1);
    expect(adapter.getFile(".lina/ownership.json")).toBe(before);
  });
  it("shows deterministic recovery through fence assertion on an isolated instance", async () => {
    const {adapter,gate} = fixture();
    const before = adapter.getFile(".lina/ownership.json");
    await gate.evaluate(2);
    const token = await gate.acquireFence({autoClaimIfUnclaimed:false});
    expect(token).toBeDefined();
    if (!token) throw new Error("Expected valid fence");
    expect(await gate.assertFence(token)).toBe(true);
    expect(gate.getLastDecision()?.status).toBe("authorized");
    expect(new OwnershipGate(adapter,()=>id,()=>"producer",false).getLastDecision()).toBeNull();
    expect(adapter.getFile(".lina/ownership.json")).toBe(before);
  });
  it("does not treat invalidation alone as authoritative validation", async () => {
    const {gate} = fixture();
    await gate.evaluate(2);
    gate.invalidate();
    expect(gate.getLastDecision()).toBeNull();
    expect(gate.isAuthorizedSync()).toBe(true);
  });
  it("replaces a stale positive decision when acquireFence(options) rejects", async () => {
    const {adapter,gate} = fixture();
    await gate.evaluate();
    const manifest = JSON.parse(adapter.getFile(".lina/ownership.json") ?? "{}");
    manifest.activeProducerId = "550d9ef0-9ff9-424e-ae55-7c386b885ec8";
    manifest.epoch = 4;
    adapter.setFile(".lina/ownership.json",JSON.stringify(manifest));
    expect(await gate.acquireFence({autoClaimIfUnclaimed:false})).toBeUndefined();
    expect(gate.isAuthorizedSync()).toBe(false);
  });
});
