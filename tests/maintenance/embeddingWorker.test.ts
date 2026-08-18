import { describe, expect, it, vi } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import {
  EmbeddingWorker,
  EmbeddingWorkerGenerationResult,
  EmbeddingWorkerOptions,
} from "../../src/maintenance/embeddingWorker";

function createOptions(overrides: Partial<EmbeddingWorkerOptions> = {}) {
  const coordinator = new IndexWriteCoordinator();
  const binaryHandoff = vi.fn();
  const scheduleTextIndexFlush = vi.fn();
  const onGenerationFinalized = vi.fn();
  const options: EmbeddingWorkerOptions = {
    capabilities: {
      canGenerateEmbeddings: () => resolveDeviceCapabilities({ isMobile: false }).canGenerateEmbeddings,
    },
    isTextIndexBusy: () => false,
    drainTextIndex: async () => true,
    scheduleTextIndexFlush,
    coordinator: {
      requestPreparation: () => coordinator.requestEmbeddingGenerationPreparation(),
      cancelPreparation: () => coordinator.cancelEmbeddingGenerationPreparation(),
      startGeneration: () => coordinator.startEmbeddingGeneration(),
      finish: (token) => coordinator.finish(token),
    },
    generationService: {
      generate: async (): Promise<EmbeddingWorkerGenerationResult> => ({
        success: true,
        message: "generated",
        publicationId: "publication-1",
      }),
    },
    persistence: { onGenerationFinalized },
    statusNotifications: { notify: () => undefined },
    binaryHandoff: { maintainAfterPublication: binaryHandoff },
    messages: {
      preparing: "preparing",
      waitingForTextIndex: "waiting",
      cancelled: "cancelled",
      blockedByTextIndex: () => "text index busy",
      generalError: "general error",
      cancelling: "cancelling",
    },
    ...overrides,
  };
  return { options, coordinator, binaryHandoff, scheduleTextIndexFlush, onGenerationFinalized };
}

async function completeRequest(worker: EmbeddingWorker) {
  const request = worker.requestGeneration("command");
  expect(request.status).toBe("accepted");
  if (request.status !== "accepted") throw new Error("Expected accepted embedding request.");
  return await request.completion;
}

describe("EmbeddingWorker execution cutover", () => {
  it("owns a successful producer execution and hands off only after the canonical token is released", async () => {
    const fixture = createOptions();
    const worker = new EmbeddingWorker(fixture.options);

    const completion = await completeRequest(worker);

    expect(completion.result).toMatchObject({ success: true, publicationId: "publication-1" });
    expect(fixture.onGenerationFinalized).toHaveBeenCalledWith(completion.result);
    expect(fixture.binaryHandoff).toHaveBeenCalledWith("publication-1");
    expect(fixture.coordinator.getState().activeOperation).toBeNull();
    expect(fixture.scheduleTextIndexFlush).toHaveBeenCalledTimes(1);
    expect(worker.getOperationState()).toMatchObject({ status: "completed" });
  });

  it("propagates cancellation through the worker-owned operation lifecycle", async () => {
    const fixture = createOptions({
      generationService: {
        generate: async (operation) => await new Promise<EmbeddingWorkerGenerationResult>((resolve) => {
          operation.signal.addEventListener("abort", () => {
            resolve({ success: false, message: "cancelled", cancelled: true });
          }, { once: true });
        }),
      },
    });
    const worker = new EmbeddingWorker(fixture.options);
    const request = worker.requestGeneration("command");
    expect(request.status).toBe("accepted");

    await Promise.resolve();
    expect(worker.cancelActiveOperation()).toBe("cancel-requested");
    if (request.status !== "accepted") throw new Error("Expected accepted embedding request.");
    const completion = await request.completion;

    expect(completion.result).toMatchObject({ success: false, cancelled: true });
    expect(fixture.binaryHandoff).not.toHaveBeenCalled();
    expect(worker.getOperationState()).toMatchObject({ status: "cancelled" });
  });

  it("reports provider and persistence failures without starting binary maintenance", async () => {
    const providerFailure = createOptions({
      generationService: { generate: async () => { throw new Error("provider unavailable"); } },
    });
    const providerWorker = new EmbeddingWorker(providerFailure.options);
    const providerCompletion = await completeRequest(providerWorker);

    expect(providerCompletion.result).toMatchObject({ success: false, message: "provider unavailable" });
    expect(providerFailure.binaryHandoff).not.toHaveBeenCalled();
    expect(providerWorker.getState()).toMatchObject({ status: "error" });

    const persistenceFailure = createOptions({
      persistence: { onGenerationFinalized: () => { throw new Error("persistence failed"); } },
    });
    const persistenceWorker = new EmbeddingWorker(persistenceFailure.options);
    const persistenceCompletion = await completeRequest(persistenceWorker);

    expect(persistenceCompletion.result).toMatchObject({ success: false, message: "persistence failed" });
    expect(persistenceFailure.binaryHandoff).not.toHaveBeenCalled();
    expect(persistenceFailure.coordinator.getState().activeOperation).toBeNull();
  });

  it("does not hand off a failed canonical publication", async () => {
    const fixture = createOptions({
      generationService: {
        generate: async () => ({ success: false, message: "canonical publication failed" }),
      },
    });
    const worker = new EmbeddingWorker(fixture.options);

    const completion = await completeRequest(worker);

    expect(completion.result).toMatchObject({ success: false, message: "canonical publication failed" });
    expect(fixture.binaryHandoff).not.toHaveBeenCalled();
    expect(fixture.coordinator.getState()).toMatchObject({ activeOperation: null, embeddingGenerationRequested: false });
  });

  it("uses the same single-flight worker lifecycle for automatic and manual requests", async () => {
    let complete!: (result: EmbeddingWorkerGenerationResult) => void;
    let generationCount = 0;
    const fixture = createOptions({
      generationService: {
        generate: async () => {
          generationCount += 1;
          if (generationCount > 1) {
            return { success: true, message: "generated", publicationId: "publication-manual" };
          }
          return await new Promise<EmbeddingWorkerGenerationResult>((resolve) => { complete = resolve; });
        },
      },
    });
    const worker = new EmbeddingWorker(fixture.options);

    const automatic = worker.requestGeneration("automatic");
    expect(automatic.status).toBe("accepted");
    expect(worker.getOperationState()).toMatchObject({ origin: "automatic", status: "running" });
    expect(worker.requestGeneration("command")).toMatchObject({ status: "already-running" });

    await Promise.resolve();
    await Promise.resolve();
    complete({ success: true, message: "generated", publicationId: "publication-automatic" });
    if (automatic.status !== "accepted") throw new Error("Expected accepted automatic embedding request.");
    await automatic.completion;

    const manual = worker.requestGeneration("command");
    expect(manual.status).toBe("accepted");
    if (manual.status !== "accepted") throw new Error("Expected accepted manual embedding request.");
    await manual.completion;

    expect(fixture.binaryHandoff).toHaveBeenCalledWith("publication-automatic");
    expect(fixture.binaryHandoff).toHaveBeenCalledTimes(2);
  });

  it("blocks Companion execution before invoking any port", () => {
    const generate = vi.fn(async (): Promise<EmbeddingWorkerGenerationResult> => ({
      success: true,
      message: "generated",
    }));
    const fixture = createOptions({
      capabilities: {
        canGenerateEmbeddings: () => resolveDeviceCapabilities({ isMobile: true }).canGenerateEmbeddings,
      },
      generationService: { generate },
    });
    const worker = new EmbeddingWorker(fixture.options);

    const request = worker.requestGeneration("command");

    expect(request).toMatchObject({ status: "not-capable" });
    expect(generate).not.toHaveBeenCalled();
    expect(worker.isStarted()).toBe(false);
  });
});
