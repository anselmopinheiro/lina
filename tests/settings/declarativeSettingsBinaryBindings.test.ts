import { describe, expect, it } from "vitest";
import { createDeclarativeSettingsBinaryBindings } from "../../src/settings/declarativeSettingsBinaryBindings";
import { createDeclarativeSettingsLifecycleController } from "../../src/settings/declarativeSettingsLifecycleController";

function deferred<T>() { let resolve: (value: T) => void = () => undefined; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
function createBindings(status: { status: "valid" | "absent" | "outdated" | "incomplete" | "invalid" | "unsupported" | "error"; reasonCode?: "legacy-manifest" } = { status: "absent" }) {
  const lifecycle = createDeclarativeSettingsLifecycleController({ requestHostUpdate() {}, scheduleUpdate() {} });
  const check = deferred<typeof status>(); const create = deferred<typeof status>(); const removal = deferred<void>(); let confirms = true;
  const bindings = createDeclarativeSettingsBinaryBindings({ lifecycle, getCurrentStatus: () => status, check: () => check.promise, createOrUpdate: () => create.promise, remove: () => removal.promise, confirmRemove: async () => confirms, getReadPreference: () => "jsonl", getMaintainBinaryCopy: () => false });
  return { bindings, lifecycle, check, create, removal, setConfirm(value: boolean) { confirms = value; } };
}

describe("declarative binary lifecycle bindings", () => {
  it("exposes safe initial statuses and blocks legacy create only", () => {
    const legacy = createBindings({ status: "outdated", reasonCode: "legacy-manifest" });
    expect(legacy.bindings.getSnapshot()).toMatchObject({ status: "outdated", reasonCode: "legacy-manifest", canCheck: true, canCreateOrUpdate: false, canRemove: true });
  });
  it("serializes check and create, applies safe results, and ignores invalidated callbacks", async () => {
    const test = createBindings(); const checkRun = test.bindings.check();
    expect(await test.bindings.createOrUpdate()).toBe(false);
    test.check.resolve({ status: "valid" }); expect(await checkRun).toBe(true);
    expect(test.bindings.getSnapshot()).toMatchObject({ status: "valid", feedback: "success", pending: false });
    const stale = test.bindings.check(); test.bindings.invalidate(); test.check.resolve({ status: "unsupported" });
    expect(await stale).toBe(false); expect(test.bindings.getSnapshot().feedback).toBe("idle");
  });
  it("handles create errors and destructive removal cancellation/success without extra I/O", async () => {
    const test = createBindings(); const createRun = test.bindings.createOrUpdate(); test.create.resolve({ status: "error" });
    expect(await createRun).toBe(false); expect(test.bindings.getSnapshot()).toMatchObject({ status: "error", feedback: "error" });
    test.setConfirm(false); expect(await test.bindings.remove()).toBe(false);
    test.setConfirm(true); const removeRun = test.bindings.remove(); test.removal.resolve();
    expect(await removeRun).toBe(true); expect(test.bindings.getSnapshot()).toMatchObject({ status: "absent", feedback: "success" });
  });
});
