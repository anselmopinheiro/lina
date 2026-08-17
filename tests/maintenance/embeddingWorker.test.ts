import { describe, expect, it } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import {
  EmbeddingWorker,
  EmbeddingWorkerOptions,
} from "../../src/maintenance/embeddingWorker";

function createOptions(isMobile = false): EmbeddingWorkerOptions {
  return {
    capabilities: {
      canGenerateEmbeddings: () => resolveDeviceCapabilities({ isMobile }).canGenerateEmbeddings,
    },
    operationState: {
      getState: () => ({ status: "idle" }),
    },
    generationService: {
      generate: async () => undefined,
    },
    persistence: {
      persist: async () => undefined,
    },
    statusNotifications: {
      notify: () => undefined,
    },
    binaryHandoff: {
      maintainAfterPublication: () => undefined,
    },
  };
}

describe("embedding worker foundation", () => {
  it("starts and owns minimal future-maintenance state on a desktop producer", () => {
    const worker = new EmbeddingWorker(createOptions());

    worker.start();

    expect(worker.isStarted()).toBe(true);
    expect(worker.getState()).toEqual({ status: "idle", lastError: null });
    expect(worker.beginFutureMaintenance()).toBe(true);
    expect(worker.getState()).toEqual({ status: "running", lastError: null });
    worker.finishFutureMaintenance();
    expect(worker.getState()).toEqual({ status: "idle", lastError: null });
  });

  it("does not activate future embedding maintenance on a mobile companion", () => {
    const worker = new EmbeddingWorker(createOptions(true));

    worker.start();

    expect(worker.isStarted()).toBe(false);
    expect(worker.beginFutureMaintenance()).toBe(false);
    expect(worker.getState()).toEqual({ status: "idle", lastError: null });
  });

  it("returns a safe error state and disposes idempotently", () => {
    const worker = new EmbeddingWorker(createOptions());
    worker.start();
    worker.beginFutureMaintenance();
    worker.finishFutureMaintenance(new Error("future operation failed"));

    expect(worker.getState()).toEqual({ status: "error", lastError: "future operation failed" });
    worker.dispose();
    worker.dispose();
    expect(worker.isStarted()).toBe(false);
  });

  it("accepts injected ports and blocks future maintenance when a port is missing or invalid", () => {
    const options = createOptions();
    const worker = new EmbeddingWorker({
      ...options,
      persistence: undefined,
    });
    const invalidGenerationService = createOptions().generationService!;
    Reflect.set(invalidGenerationService, "generate", undefined);
    const invalidWorker = new EmbeddingWorker({
      ...createOptions(),
      generationService: invalidGenerationService,
    });

    worker.start();
    invalidWorker.start();

    expect(worker.isStarted()).toBe(true);
    expect(worker.isExecutionPrepared()).toBe(false);
    expect(worker.getMissingDependencies()).toEqual(["persistence"]);
    expect(worker.beginFutureMaintenance()).toBe(false);
    expect(invalidWorker.isExecutionPrepared()).toBe(false);
    expect(invalidWorker.getMissingDependencies()).toEqual(["generation-service"]);
    expect(invalidWorker.beginFutureMaintenance()).toBe(false);
  });
});
