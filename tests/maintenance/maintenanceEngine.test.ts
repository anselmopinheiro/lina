import { afterEach, describe, expect, it } from "vitest";
import { Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { getDeviceCapabilities, resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { MaintenanceEngine } from "../../src/maintenance/maintenanceEngine";
import { ReconciliationWorker } from "../../src/maintenance/reconciliationWorker";
import { BinaryWorker } from "../../src/maintenance/binaryWorker";
import { EmbeddingWorker } from "../../src/maintenance/embeddingWorker";
import { EmbeddingScheduler } from "../../src/maintenance/embeddingScheduler";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";

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

  it("supervises scheduler lifecycle and preempts scheduled work before manual execution", () => {
    let nextTimer = 0;
    const scheduler = new EmbeddingScheduler({
      canScheduleEmbeddings: () => true,
      timers: {
        now: () => 0,
        setTimeout: () => ++nextTimer,
        clearTimeout: () => undefined,
      },
    });
    const engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      embeddingScheduler: scheduler,
    });

    engine.start();
    engine.markEmbeddingSchedulerDirty();
    expect(engine.getEmbeddingScheduler()).toBe(scheduler);
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "scheduled", ready: false });
    engine.preemptEmbeddingSchedulerForManual();
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "dirty", ready: false });
    engine.dispose();
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "disabled", ready: false });
  });

  it("routes automatic scheduling through the same engine-owned embedding worker", async () => {
    const coordinator = new IndexWriteCoordinator();
    let generationCalls = 0;
    const worker = new EmbeddingWorker({
      capabilities: { canGenerateEmbeddings: () => true },
      isTextIndexBusy: () => false,
      drainTextIndex: async () => true,
      scheduleTextIndexFlush: () => undefined,
      coordinator: {
        requestPreparation: () => coordinator.requestEmbeddingGenerationPreparation(),
        cancelPreparation: () => coordinator.cancelEmbeddingGenerationPreparation(),
        startGeneration: () => coordinator.startEmbeddingGeneration(),
        finish: (token) => coordinator.finish(token),
      },
      generationService: {
        generate: async () => {
          generationCalls += 1;
          return { success: true, message: "generated", publicationId: "automatic-publication" };
        },
      },
      persistence: { onGenerationFinalized: () => undefined },
      statusNotifications: { notify: () => undefined },
      binaryHandoff: { maintainAfterPublication: () => undefined },
      messages: {
        preparing: "preparing",
        waitingForTextIndex: "waiting",
        cancelled: "cancelled",
        blockedByTextIndex: () => "blocked",
        generalError: "error",
        cancelling: "cancelling",
      },
    });
    const callbacks: Array<{ readonly delay: number; readonly callback: () => void }> = [];
    let automaticCompletion: Promise<unknown> | undefined;
    let engine!: MaintenanceEngine;
    const scheduler = new EmbeddingScheduler({
      canScheduleEmbeddings: () => true,
      canDispatchAutomatically: () => true,
      hasEmbeddingWork: async () => generationCalls === 0,
      dispatchAutomatic: () => {
        const request = engine.requestEmbeddingGeneration("automatic");
        if (request.status !== "accepted") {
          return { status: request.status === "already-running" ? "already-running" : "unavailable" };
        }
        automaticCompletion = request.completion;
        return {
          status: "accepted",
          completion: request.completion.then(({ result }) => ({ success: result.success })),
        };
      },
      timers: {
        now: () => 0,
        setTimeout: (callback, delay) => {
          callbacks.push({ callback, delay });
          return callbacks.length;
        },
        clearTimeout: () => undefined,
      },
      quietPeriodMs: 0,
      maximumDelayMs: 1,
    });
    engine = new MaintenanceEngine({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      embeddingWorker: worker,
      embeddingScheduler: scheduler,
    });

    engine.start();
    engine.markEmbeddingSchedulerDirty();
    callbacks.find(({ delay }) => delay === 0)?.callback();
    await Promise.resolve();
    await Promise.resolve();
    if (!automaticCompletion) throw new Error("Expected scheduler to request automatic embedding generation.");
    await automaticCompletion;
    await Promise.resolve();
    await Promise.resolve();

    expect(generationCalls).toBe(1);
    expect(engine.getEmbeddingWorker()).toBe(worker);
    expect(worker.getOperationState()).toMatchObject({ origin: "automatic", status: "completed" });
    expect(engine.getEmbeddingSchedulerState()).toMatchObject({ status: "clean", ready: false });
  });
});
