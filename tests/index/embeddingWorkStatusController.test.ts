import { describe, expect, it, vi } from "vitest";
import { EmbeddingStateSummary } from "../../src/index/embeddingState";
import {
  EmbeddingWorkStatusClock,
  EmbeddingWorkStatusController,
  hasEmbeddingWorkAvailable,
} from "../../src/index/embeddingWorkStatusController";

function summary(overrides: Partial<EmbeddingStateSummary> = {}): EmbeddingStateSummary {
  return {
    totalChunks: 2,
    totalCanonicalRecords: 2,
    validCount: 2,
    missingCount: 0,
    staleCount: 0,
    obsoleteCount: 0,
    validForSearchCount: 2,
    reusableForNextGenerationCount: 2,
    recoverableCheckpointCount: 0,
    operationActive: false,
    duplicateRecordCount: 0,
    invalidRecordCount: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class ManualClock implements EmbeddingWorkStatusClock {
  private nextId = 0;
  private timers = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = ++this.nextId;
    this.timers.set(id, callback);
    return id;
  }

  clearTimeout(timeoutId: number): void {
    this.timers.delete(timeoutId);
  }

  pendingCount(): number {
    return this.timers.size;
  }

  runNext(): void {
    const [id, callback] = [...this.timers.entries()][0] ?? [];
    if (id === undefined || !callback) return;
    this.timers.delete(id);
    callback();
  }
}

describe("embedding work status controller — initial and read-only behaviour", () => {
  it("starts as unknown and getState does not calculate", () => {
    const refreshSummary = vi.fn(async () => summary());
    const controller = new EmbeddingWorkStatusController({ refreshSummary });

    expect(controller.getState()).toMatchObject({ status: "unknown", revision: 0 });
    expect(refreshSummary).not.toHaveBeenCalled();
  });

  it("explicit refresh produces ready state", async () => {
    const controller = new EmbeddingWorkStatusController({
      refreshSummary: async () => summary({ missingCount: 1, validCount: 1 }),
    });

    const state = await controller.refresh();

    expect(state).toMatchObject({
      status: "ready",
      revision: 0,
      calculatedRevision: 0,
      workAvailable: true,
    });
    expect(state.summary?.missingCount).toBe(1);
  });

  it("error state can recover on a later refresh", async () => {
    const refreshSummary = vi
      .fn<() => Promise<EmbeddingStateSummary>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(summary());
    const controller = new EmbeddingWorkStatusController({ refreshSummary });

    expect((await controller.refresh()).status).toBe("error");
    expect((await controller.refresh()).status).toBe("ready");
  });
});

describe("embedding work status controller — invalidation and lazy refresh", () => {
  it("markDirty increments revision without calculating", () => {
    const refreshSummary = vi.fn(async () => summary());
    const controller = new EmbeddingWorkStatusController({ refreshSummary });

    controller.markDirty("text-index-published");

    expect(controller.getState()).toMatchObject({
      status: "dirty",
      revision: 1,
      reason: "text-index-published",
    });
    expect(refreshSummary).not.toHaveBeenCalled();
  });

  it("100 invalidations without subscribers do not schedule parsing", () => {
    const clock = new ManualClock();
    const refreshSummary = vi.fn(async () => summary());
    const controller = new EmbeddingWorkStatusController({ refreshSummary, clock });

    for (let index = 0; index < 100; index++) {
      controller.markDirty("text-index-published");
    }

    expect(controller.getState().revision).toBe(100);
    expect(clock.pendingCount()).toBe(0);
    expect(refreshSummary).not.toHaveBeenCalled();
  });

  it("active subscriber schedules one coalesced refresh", async () => {
    const clock = new ManualClock();
    const refreshSummary = vi.fn(async () => summary());
    const controller = new EmbeddingWorkStatusController({ refreshSummary, clock });
    controller.subscribe(() => undefined);

    controller.markDirty("text-index-published");
    controller.markDirty("text-index-published");
    controller.markDirty("embeddings-published");

    expect(clock.pendingCount()).toBe(1);
    clock.runNext();
    await Promise.resolve();

    expect(refreshSummary).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: "ready", revision: 3 });
  });

  it("unsubscribe cancels a pending lazy refresh", () => {
    const clock = new ManualClock();
    const refreshSummary = vi.fn(async () => summary());
    const controller = new EmbeddingWorkStatusController({ refreshSummary, clock });
    const unsubscribe = controller.subscribe(() => undefined);

    controller.markDirty("text-index-published");
    expect(clock.pendingCount()).toBe(1);
    unsubscribe();

    expect(clock.pendingCount()).toBe(0);
    expect(refreshSummary).not.toHaveBeenCalled();
  });
});

describe("embedding work status controller — single-flight and revision protection", () => {
  it("simultaneous refreshes share one calculation", async () => {
    const refresh = deferred<EmbeddingStateSummary>();
    const refreshSummary = vi.fn(() => refresh.promise);
    const controller = new EmbeddingWorkStatusController({ refreshSummary });

    const first = controller.refresh();
    const second = controller.refresh();
    refresh.resolve(summary());

    await expect(first).resolves.toMatchObject({ status: "ready" });
    await expect(second).resolves.toMatchObject({ status: "ready" });
    expect(refreshSummary).toHaveBeenCalledTimes(1);
  });

  it("late result after invalidation does not mark the new revision ready", async () => {
    const refresh = deferred<EmbeddingStateSummary>();
    const refreshSummary = vi.fn(() => refresh.promise);
    const controller = new EmbeddingWorkStatusController({ refreshSummary });

    const first = controller.refresh();
    controller.markDirty("text-index-published");
    refresh.resolve(summary());
    await first;

    expect(controller.getState()).toMatchObject({
      status: "dirty",
      revision: 1,
    });
    expect(controller.getState().calculatedRevision).toBeUndefined();
  });

  it("runs at most one follow-up refresh for the latest revision", async () => {
    const first = deferred<EmbeddingStateSummary>();
    const second = deferred<EmbeddingStateSummary>();
    const refreshSummary = vi
      .fn<() => Promise<EmbeddingStateSummary>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = new EmbeddingWorkStatusController({ refreshSummary });

    const firstRefresh = controller.refresh();
    controller.markDirty("text-index-published");
    const followUpA = controller.refresh();
    const followUpB = controller.refresh();

    first.resolve(summary({ validCount: 1, missingCount: 1 }));
    await firstRefresh;
    second.resolve(summary({ validCount: 2 }));
    await followUpA;
    await followUpB;

    expect(refreshSummary).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      status: "ready",
      revision: 1,
      calculatedRevision: 1,
    });
  });

  it("ignores callbacks after dispose", async () => {
    const refresh = deferred<EmbeddingStateSummary>();
    const controller = new EmbeddingWorkStatusController({ refreshSummary: () => refresh.promise });

    const active = controller.refresh();
    controller.dispose();
    refresh.resolve(summary({ missingCount: 1 }));
    await active;

    expect(controller.getState()).toMatchObject({ status: "disposed" });
    expect(controller.getState().summary).toBeUndefined();
  });
});

describe("embedding work status controller — defer and workAvailable", () => {
  it("defers refresh while a critical publication is active", async () => {
    let defer = true;
    const clock = new ManualClock();
    const refreshSummary = vi.fn(async () => summary());
    const controller = new EmbeddingWorkStatusController({
      refreshSummary,
      clock,
      shouldDeferRefresh: () => defer,
    });
    controller.subscribe(() => undefined);

    const deferredState = await controller.refresh();

    expect(deferredState.status).toBe("dirty");
    expect(refreshSummary).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
    defer = false;
    await controller.refresh();

    expect(refreshSummary).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("ready");
  });

  it("derives workAvailable from missing, stale, obsolete, duplicate or invalid records", () => {
    expect(hasEmbeddingWorkAvailable(summary())).toBe(false);
    expect(hasEmbeddingWorkAvailable(summary({ missingCount: 1 }))).toBe(true);
    expect(hasEmbeddingWorkAvailable(summary({ staleCount: 1 }))).toBe(true);
    expect(hasEmbeddingWorkAvailable(summary({ obsoleteCount: 1 }))).toBe(true);
    expect(hasEmbeddingWorkAvailable(summary({ duplicateRecordCount: 1 }))).toBe(true);
    expect(hasEmbeddingWorkAvailable(summary({ invalidRecordCount: 1 }))).toBe(true);
    expect(hasEmbeddingWorkAvailable(summary({ recoverableCheckpointCount: 2 }))).toBe(false);
  });
});
