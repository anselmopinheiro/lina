import { afterEach, describe, expect, it } from "vitest";
import { Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { getDeviceCapabilities, resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { MaintenanceEngine } from "../../src/maintenance/maintenanceEngine";
import { ReconciliationWorker } from "../../src/maintenance/reconciliationWorker";
import { BinaryWorker } from "../../src/maintenance/binaryWorker";
import { EmbeddingWorker } from "../../src/maintenance/embeddingWorker";

describe("maintenance engine foundation", () => {
  afterEach(() => {
    Platform.isMobile = false;
  });

  it("initializes an idle engine with all producer maintenance capabilities", () => {
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
    });

    expect(engine.getState()).toEqual({ status: "idle", activeTask: null, lastError: null });
    expect(engine.isStarted()).toBe(false);
    expect(engine.getCapabilities().role).toBe("producer");
    expect(["vault-events", "text-index", "startup-reconciliation", "embeddings", "binary-copy"]
      .every((operation) => engine.canRun(operation))).toBe(true);

    engine.start();
    expect(engine.isStarted()).toBe(true);
  });

  it("recognizes a companion without enabling producer operations", () => {
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: true }),
    });

    engine.start();
    expect(engine.isStarted()).toBe(true);
    expect(engine.getCapabilities()).toMatchObject({ role: "companion", canExecuteSearch: true });
    expect(["vault-events", "text-index", "startup-reconciliation", "embeddings", "binary-copy"]
      .every((operation) => !engine.canRun(operation))).toBe(true);
  });

  it("is exposed by LinaPlugin as one lifecycle-owned instance", () => {
    const plugin = Object.create(LinaPlugin.prototype) as LinaPlugin;
    const engine = plugin.getMaintenanceEngine();

    expect(engine).toBe(plugin.getMaintenanceEngine());
    expect(engine.getCapabilities()).toEqual(getDeviceCapabilities());

    engine.start();
    engine.dispose();
    engine.dispose();
    expect(engine.isStarted()).toBe(false);
  });

  it("reports an indexing transition while a text-index task is running", async () => {
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
    });
    let complete!: () => void;
    const task = engine.runTextIndexTask(() => new Promise<void>((resolve) => {
      complete = resolve;
    }));

    expect(engine.getState()).toEqual({ status: "indexing", activeTask: "text-index", lastError: null });
    complete();
    await task;
    expect(engine.getState()).toEqual({ status: "idle", activeTask: null, lastError: null });
  });

  it("owns reconciliation worker lifecycle and exposes reconciliation state", async () => {
    let complete!: () => void;
    const worker = new ReconciliationWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      runStartupReconciliation: () => new Promise<void>((resolve) => { complete = resolve; }),
      runExclusionReconciliation: async () => {},
      waitForAutomaticUpdates: async () => {},
    });
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      reconciliationWorker: worker,
    });

    engine.start();
    const reconciliation = engine.runStartupReconciliation();

    expect(worker.isStarted()).toBe(true);
    expect(engine.getState()).toEqual({
      status: "reconciling",
      activeTask: "startup-reconciliation",
      lastError: null,
    });
    expect(engine.getReconciliationState()).toMatchObject({ status: "reconciling", activeTask: "startup" });

    complete();
    await reconciliation;
    expect(engine.getState()).toEqual({ status: "idle", activeTask: null, lastError: null });
  });

  it("owns binary worker lifecycle and exposes binary compilation state", async () => {
    let complete!: () => void;
    const worker = new BinaryWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      isAutomaticMaintenanceEnabled: () => true,
      check: async () => ({ status: "valid" }),
      createOrUpdate: () => new Promise((resolve) => { complete = () => resolve({ status: "valid" }); }),
      remove: async () => {},
      maintainAfterPublication: async () => ({ status: "valid" }),
      onBinaryPublicationReady: () => {},
      onAutomaticMaintenanceFailure: () => {},
    });
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      binaryWorker: worker,
    });

    engine.start();
    const operation = engine.createOrUpdateBinaryCopy();

    expect(worker.isStarted()).toBe(true);
    expect(engine.getState()).toEqual({
      status: "compiling-binary",
      activeTask: "binary-create-or-update",
      lastError: null,
    });
    expect(engine.getBinaryState()).toMatchObject({ status: "compiling-binary", activeTask: "create-or-update" });

    complete();
    await operation;
    expect(engine.getState()).toEqual({ status: "idle", activeTask: null, lastError: null });
  });

  it("owns an embedding worker foundation without invoking embedding execution", () => {
    const worker = new EmbeddingWorker({
      capabilities: {
        canGenerateEmbeddings: () => resolveDeviceCapabilities({ isMobile: false }).canGenerateEmbeddings,
      },
    });
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      embeddingWorker: worker,
    });

    engine.start();

    expect(engine.getEmbeddingWorker()).toBe(worker);
    expect(worker.isStarted()).toBe(true);
    expect(engine.getEmbeddingState()).toEqual({ status: "idle", lastError: null });
    engine.dispose();
    expect(worker.isStarted()).toBe(false);
  });
});
