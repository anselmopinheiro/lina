import { describe, expect, it } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { ReconciliationWorker } from "../../src/maintenance/reconciliationWorker";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("reconciliation worker", () => {
  it("starts and exposes reconciling state on a desktop producer", async () => {
    const deferred = createDeferred();
    const worker = new ReconciliationWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      runStartupReconciliation: () => deferred.promise,
      runStartupBinaryArtifactMigration: async () => {},
      runExclusionReconciliation: async () => {},
      waitForAutomaticUpdates: async () => {},
    });

    worker.start();
    const reconciliation = worker.runStartupReconciliation();

    expect(worker.isStarted()).toBe(true);
    expect(worker.getState()).toEqual({ status: "reconciling", activeTask: "startup", lastError: null });

    deferred.resolve();
    await reconciliation;
    expect(worker.getState()).toEqual({ status: "idle", activeTask: null, lastError: null });
  });

  it("serializes exclusion reconciliation after pending automatic updates", async () => {
    const calls: string[] = [];
    const worker = new ReconciliationWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      runStartupReconciliation: async () => {},
      runStartupBinaryArtifactMigration: async () => {},
      waitForAutomaticUpdates: async () => { calls.push("automatic-updates"); },
      runExclusionReconciliation: async () => { calls.push("exclusions"); },
    });

    worker.start();
    await worker.runExclusionReconciliation();

    expect(calls).toEqual(["automatic-updates", "exclusions"]);
  });

  it("does not activate reconciliation on a mobile companion", async () => {
    const worker = new ReconciliationWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: true }),
      runStartupReconciliation: async () => { throw new Error("must not run"); },
      runStartupBinaryArtifactMigration: async () => { throw new Error("must not run"); },
      runExclusionReconciliation: async () => { throw new Error("must not run"); },
      waitForAutomaticUpdates: async () => {},
    });

    worker.start();

    expect(worker.isStarted()).toBe(false);
    await expect(worker.runStartupReconciliation()).resolves.toBe(false);
  });

  it("returns to idle with a safe error snapshot after a failed reconciliation", async () => {
    const worker = new ReconciliationWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      runStartupReconciliation: async () => { throw new Error("index unavailable"); },
      runStartupBinaryArtifactMigration: async () => {},
      runExclusionReconciliation: async () => {},
      waitForAutomaticUpdates: async () => {},
    });
    worker.start();

    await expect(worker.runStartupReconciliation()).rejects.toThrow("index unavailable");
    expect(worker.getState()).toEqual({
      status: "idle",
      activeTask: null,
      lastError: "index unavailable",
    });
  });

  it("runs binary artifact migration only after startup reconciliation", async () => {
    const calls: string[] = [];
    const worker = new ReconciliationWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      runStartupReconciliation: async () => { calls.push("canonical-reconciled"); },
      runStartupBinaryArtifactMigration: async () => { calls.push("binary-migrated"); },
      runExclusionReconciliation: async () => {},
      waitForAutomaticUpdates: async () => {},
    });
    worker.start();
    await expect(worker.runStartupReconciliation()).resolves.toBe(true);
    expect(calls).toEqual(["canonical-reconciled", "binary-migrated"]);
  });
});
