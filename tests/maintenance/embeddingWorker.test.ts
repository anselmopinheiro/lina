import { describe, expect, it } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { EmbeddingWorker } from "../../src/maintenance/embeddingWorker";

describe("embedding worker foundation", () => {
  it("starts and owns minimal future-maintenance state on a desktop producer", () => {
    const worker = new EmbeddingWorker(resolveDeviceCapabilities({ isMobile: false }));

    worker.start();

    expect(worker.isStarted()).toBe(true);
    expect(worker.getState()).toEqual({ status: "idle", lastError: null });
    expect(worker.beginFutureMaintenance()).toBe(true);
    expect(worker.getState()).toEqual({ status: "running", lastError: null });
    worker.finishFutureMaintenance();
    expect(worker.getState()).toEqual({ status: "idle", lastError: null });
  });

  it("does not activate future embedding maintenance on a mobile companion", () => {
    const worker = new EmbeddingWorker(resolveDeviceCapabilities({ isMobile: true }));

    worker.start();

    expect(worker.isStarted()).toBe(false);
    expect(worker.beginFutureMaintenance()).toBe(false);
    expect(worker.getState()).toEqual({ status: "idle", lastError: null });
  });

  it("returns a safe error state and disposes idempotently", () => {
    const worker = new EmbeddingWorker(resolveDeviceCapabilities({ isMobile: false }));
    worker.start();
    worker.beginFutureMaintenance();
    worker.finishFutureMaintenance(new Error("future operation failed"));

    expect(worker.getState()).toEqual({ status: "error", lastError: "future operation failed" });
    worker.dispose();
    worker.dispose();
    expect(worker.isStarted()).toBe(false);
  });
});
