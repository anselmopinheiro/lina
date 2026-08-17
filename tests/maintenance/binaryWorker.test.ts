import { describe, expect, it, vi } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { BinaryWorker } from "../../src/maintenance/binaryWorker";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("binary worker", () => {
  it("starts on a desktop producer and exposes binary compilation state", async () => {
    const deferred = createDeferred();
    const onBinaryPublicationReady = vi.fn();
    const worker = new BinaryWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      isAutomaticMaintenanceEnabled: () => true,
      check: async () => ({ status: "valid" }),
      createOrUpdate: async () => {
        await deferred.promise;
        return { status: "valid" };
      },
      remove: async () => {},
      maintainAfterPublication: async () => ({ status: "valid" }),
      onBinaryPublicationReady,
      onAutomaticMaintenanceFailure: vi.fn(),
    });

    worker.start();
    const operation = worker.createOrUpdate();

    expect(worker.isStarted()).toBe(true);
    expect(worker.getState()).toEqual({
      status: "compiling-binary",
      activeTask: "create-or-update",
      lastError: null,
    });

    deferred.resolve();
    await expect(operation).resolves.toEqual({ status: "valid" });
    expect(onBinaryPublicationReady).toHaveBeenCalledOnce();
    expect(worker.getState()).toEqual({ status: "idle", activeTask: null, lastError: null });
  });

  it("only consumes a published embedding state when automatic maintenance is enabled", async () => {
    const maintainAfterPublication = vi.fn(async () => ({ status: "valid" }));
    const onBinaryPublicationReady = vi.fn();
    const worker = new BinaryWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      isAutomaticMaintenanceEnabled: () => true,
      check: async () => ({ status: "valid" }),
      createOrUpdate: async () => ({ status: "valid" }),
      remove: async () => {},
      maintainAfterPublication,
      onBinaryPublicationReady,
      onAutomaticMaintenanceFailure: vi.fn(),
    });
    worker.start();

    worker.maintainAfterPublication("publication-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(maintainAfterPublication).toHaveBeenCalledWith("publication-1");
    expect(onBinaryPublicationReady).toHaveBeenCalledOnce();
  });

  it("does not activate or write a binary copy on a mobile companion", async () => {
    const createOrUpdate = vi.fn(async () => ({ status: "valid" }));
    const worker = new BinaryWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: true }),
      isAutomaticMaintenanceEnabled: () => true,
      check: async () => ({ status: "absent" }),
      createOrUpdate,
      remove: async () => {},
      maintainAfterPublication: async () => ({ status: "valid" }),
      onBinaryPublicationReady: vi.fn(),
      onAutomaticMaintenanceFailure: vi.fn(),
    });

    worker.start();

    expect(worker.isStarted()).toBe(false);
    await expect(worker.createOrUpdate()).resolves.toBeUndefined();
    expect(createOrUpdate).not.toHaveBeenCalled();
    await expect(worker.check()).resolves.toEqual({ status: "absent" });
  });
});
