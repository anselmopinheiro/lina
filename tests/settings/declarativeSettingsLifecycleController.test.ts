import { describe, expect, it } from "vitest";
import {
  createDeclarativeSettingsLifecycleController,
  type DeclarativeSettingsLifecycleController,
} from "../../src/settings/declarativeSettingsLifecycleController";

function createHarness() {
  let updates = 0;
  let cleanupErrors = 0;
  const scheduled: Array<{ cancelled: boolean; callback: () => void }> = [];
  const controller = createDeclarativeSettingsLifecycleController({
    requestHostUpdate() {
      updates += 1;
    },
    scheduleUpdate(callback) {
      const entry = { cancelled: false, callback };
      scheduled.push(entry);
      return () => { entry.cancelled = true; };
    },
    onCleanupError() {
      cleanupErrors += 1;
    },
  });

  return {
    controller,
    flushAll() {
      for (const entry of scheduled.splice(0)) {
        if (!entry.cancelled) entry.callback();
      }
    },
    getUpdates: () => updates,
    getScheduledCount: () => scheduled.filter((entry) => !entry.cancelled).length,
    getCleanupErrors: () => cleanupErrors,
  };
}

function expectIdle(controller: DeclarativeSettingsLifecycleController) {
  expect(controller.getState().pendingDomains).toEqual([]);
  expect(Object.values(controller.getState().operationStatus)).toEqual([
    "idle", "idle", "idle", "idle", "idle",
  ]);
}

describe("declarative settings lifecycle controller", () => {
  it("keeps separate future-tab instances isolated, including dispose", () => {
    const first = createHarness();
    const second = createHarness();
    const firstToken = first.controller.beginPending("analysis");
    const secondToken = second.controller.beginPending("embeddings");

    expect(firstToken).toBeDefined();
    expect(secondToken).toBeDefined();
    expect(first.controller.isPending("analysis")).toBe(true);
    expect(second.controller.isPending("analysis")).toBe(false);
    first.controller.dispose();

    expect(first.controller.isDisposed()).toBe(true);
    expect(second.controller.isDisposed()).toBe(false);
    expect(second.controller.completePending(secondToken!, "success")).toBe(true);
    expect(second.controller.getOperationStatus("embeddings")).toBe("success");
  });

  it("accepts only current tokens and invalidates domains independently", () => {
    const { controller } = createHarness();
    const analysis = controller.beginPending("analysis");
    const embeddings = controller.beginPending("embeddings");
    let feedback = "idle";

    expect(controller.applyIfCurrent(analysis!, () => { feedback = "analysis-current"; })).toBe(true);
    controller.invalidateDomain("analysis");
    expect(controller.canApply(analysis!)).toBe(false);
    expect(controller.applyIfCurrent(analysis!, () => { feedback = "stale"; })).toBe(false);
    expect(feedback).toBe("analysis-current");
    expect(controller.canApply(embeddings!)).toBe(true);
    expect(controller.completePending(embeddings!, "success")).toBe(true);
    expect(controller.getOperationStatus("analysis")).toBe("idle");
    expect(controller.getOperationStatus("embeddings")).toBe("success");
  });

  it("tracks pending starts, duplicate blocking, independent domains, success, and errors", () => {
    const { controller } = createHarness();
    const analysis = controller.beginPending("analysis");
    expect(controller.beginPending("analysis")).toBeUndefined();
    const binary = controller.beginPending("binary");
    expect(controller.isPending("analysis")).toBe(true);
    expect(controller.isPending("binary")).toBe(true);

    expect(controller.completePending(analysis!, "success")).toBe(true);
    expect(controller.completePending(binary!, "error")).toBe(true);
    expect(controller.isPending("analysis")).toBe(false);
    expect(controller.getOperationStatus("analysis")).toBe("success");
    expect(controller.getOperationStatus("binary")).toBe("error");
  });

  it("runs owner cleanups once, contains cleanup errors, and clears every owner on dispose", () => {
    const { controller, getCleanupErrors } = createHarness();
    const calls: string[] = [];
    expect(controller.registerCleanup("credential-analysis", "draft", () => { calls.push("analysis"); })).toBe(true);
    expect(controller.registerCleanup("credential-analysis", "failing", () => { throw new Error("cleanup"); })).toBe(true);
    expect(controller.registerCleanup("credential-embeddings", "draft", () => { calls.push("embeddings"); })).toBe(true);
    expect(controller.registerCleanup("credential-analysis", "draft", () => { calls.push("duplicate"); })).toBe(false);

    expect(controller.removeCleanup("credential-analysis", "draft")).toBe(true);
    expect(controller.removeCleanup("credential-analysis", "draft")).toBe(false);
    expect(controller.removeOwner("credential-analysis")).toBe(1);
    expect(calls).toEqual(["analysis"]);
    expect(getCleanupErrors()).toBe(1);

    controller.dispose();
    controller.dispose();
    expect(calls).toEqual(["analysis", "embeddings"]);
  });

  it("clears a late registered draft immediately without exposing it in public state", () => {
    const { controller } = createHarness();
    let draft = "SUPER_SECRET_SENTINEL";
    expect(controller.registerCleanup("credential-analysis", "draft", () => { draft = ""; })).toBe(true);
    const beforeCleanup = JSON.stringify(controller.getState());
    expect(beforeCleanup).not.toContain("SUPER_SECRET_SENTINEL");

    expect(controller.removeOwner("credential-analysis")).toBe(1);
    expect(draft).toBe("");
    draft = "SUPER_SECRET_SENTINEL";
    controller.dispose();
    expect(controller.registerCleanup("credential-analysis", "late-draft", () => { draft = ""; })).toBe(false);
    expect(draft).toBe("");
    expect(JSON.stringify(controller.getState())).not.toContain("SUPER_SECRET_SENTINEL");
  });

  it("coalesces scheduled updates, supports a controlled flush, and prevents a refresh loop", () => {
    const harness = createHarness();
    const { controller } = harness;
    expect(controller.requestUpdate()).toBe(true);
    expect(controller.requestUpdate()).toBe(false);
    expect(harness.getScheduledCount()).toBe(1);
    expect(controller.flushUpdate()).toBe(true);
    expect(controller.flushUpdate()).toBe(false);
    expect(harness.getUpdates()).toBe(1);

    const looping = createDeclarativeSettingsLifecycleController({
      requestHostUpdate() { looping.requestUpdate(); },
      scheduleUpdate(callback) { callback(); },
    });
    expect(looping.requestUpdate()).toBe(true);
    expect(looping.getState().updateScheduled).toBe(false);
  });

  it("neutralizes late completions and errors after invalidation or dispose", () => {
    const { controller, flushAll, getUpdates } = createHarness();
    const old = controller.beginPending("credentials-analysis");
    controller.invalidateDomain("credentials-analysis");
    expect(controller.completePending(old!, "error")).toBe(false);
    expect(controller.getOperationStatus("credentials-analysis")).toBe("idle");

    const current = controller.beginPending("credentials-embeddings");
    controller.dispose();
    expect(controller.completePending(current!, "error")).toBe(false);
    expect(controller.applyIfCurrent(current!, () => { throw new Error("late callback"); })).toBe(false);
    expectIdle(controller);
    flushAll();
    expect(getUpdates()).toBe(0);
    expect(controller.beginPending("analysis")).toBeUndefined();
    expect(controller.requestUpdate()).toBe(false);
  });
});
