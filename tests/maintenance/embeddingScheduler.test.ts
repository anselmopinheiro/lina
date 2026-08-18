import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import {
  EmbeddingScheduler,
  EmbeddingSchedulerAutomaticDispatchResult,
  EmbeddingSchedulerTimers,
} from "../../src/maintenance/embeddingScheduler";

class FakeTimers implements EmbeddingSchedulerTimers {
  private currentTime = 0;
  private nextId = 1;
  private callbacks = new Map<number, { dueAt: number; callback: () => void }>();

  now = (): number => this.currentTime;

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.callbacks.set(id, { dueAt: this.currentTime + delayMs, callback });
    return id;
  };

  clearTimeout = (timeoutId: number): void => {
    this.callbacks.delete(timeoutId);
  };

  pendingCount(): number {
    return this.callbacks.size;
  }

  advanceBy(milliseconds: number): void {
    const target = this.currentTime + milliseconds;
    while (true) {
      const due = [...this.callbacks.entries()]
        .filter(([, item]) => item.dueAt <= target)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!due) break;
      const [id, item] = due;
      this.callbacks.delete(id);
      this.currentTime = item.dueAt;
      item.callback();
    }
    this.currentTime = target;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface SchedulerFixtureOptions {
  readonly isMobile?: boolean;
  readonly canDispatchAutomatically?: boolean;
  readonly hasEmbeddingWork?: () => Promise<boolean>;
  readonly dispatchAutomatic?: () => EmbeddingSchedulerAutomaticDispatchResult;
}

function createScheduler(options: SchedulerFixtureOptions = {}) {
  const timers = new FakeTimers();
  const scheduler = new EmbeddingScheduler({
    canScheduleEmbeddings: () => resolveDeviceCapabilities({ isMobile: options.isMobile ?? false }).canGenerateEmbeddings,
    canDispatchAutomatically: () => options.canDispatchAutomatically ?? false,
    hasEmbeddingWork: options.hasEmbeddingWork ?? (async () => true),
    dispatchAutomatic: options.dispatchAutomatic ?? (() => ({ status: "unavailable" })),
    timers,
    quietPeriodMs: 30,
    maximumDelayMs: 100,
  });
  return { scheduler, timers };
}

function accepted(success = true): EmbeddingSchedulerAutomaticDispatchResult {
  return { status: "accepted", completion: Promise.resolve({ success }) };
}

describe("EmbeddingScheduler controlled automatic maintenance", () => {
  it("keeps execution outside the scheduler and exposes only injected ports", () => {
    const source = readFileSync(resolve(process.cwd(), "src/maintenance/embeddingScheduler.ts"), "utf8");

    expect(source).not.toContain("EmbeddingWorker");
    expect(source).not.toContain("requestEmbeddingGeneration");
    expect(source).not.toContain("generateEmbeddings");
    expect(source).not.toContain("calculateEmbeddingUpdatePlan");
  });

  it("starts clean on a producer and disposes idempotently", () => {
    const { scheduler } = createScheduler();

    expect(scheduler.getState()).toMatchObject({ status: "disabled", ready: false });
    scheduler.start();
    expect(scheduler.getState()).toMatchObject({ status: "clean", ready: false });
    scheduler.dispose();
    scheduler.dispose();
    expect(scheduler.getState()).toMatchObject({ status: "disabled", ready: false });
  });

  it("dispatches exactly one automatic request after the quiet period on a Desktop Producer", async () => {
    const dispatchAutomatic = vi.fn(() => accepted());
    const hasEmbeddingWork = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: true,
      hasEmbeddingWork,
      dispatchAutomatic,
    });

    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(30);
    await flushAsync();

    expect(dispatchAutomatic).toHaveBeenCalledTimes(1);
    expect(hasEmbeddingWork).toHaveBeenCalledTimes(2);
    expect(scheduler.getState()).toMatchObject({ status: "clean", ready: false });
  });

  it("coalesces repeated dirty signals into one automatic request", async () => {
    const dispatchAutomatic = vi.fn(() => accepted());
    const hasEmbeddingWork = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: true,
      hasEmbeddingWork,
      dispatchAutomatic,
    });

    scheduler.start();
    scheduler.markDirty();
    scheduler.markDirty();
    scheduler.markDirty();
    expect(timers.pendingCount()).toBe(2);
    timers.advanceBy(30);
    await flushAsync();

    expect(dispatchAutomatic).toHaveBeenCalledTimes(1);
    expect(scheduler.getState()).toMatchObject({ status: "clean", ready: false });
  });

  it("resets the quiet period while retaining the original maximum-delay bound", () => {
    const { scheduler, timers } = createScheduler();
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(20);
    scheduler.markDirty();
    timers.advanceBy(10);
    expect(scheduler.getState()).toMatchObject({ status: "scheduled", ready: false });
    timers.advanceBy(20);
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: true, dirtySince: 0 });
  });

  it("dispatches once when the maximum delay reaches eligibility during continuous dirty activity", async () => {
    const dispatchAutomatic = vi.fn(() => accepted());
    const hasEmbeddingWork = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: true,
      hasEmbeddingWork,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    for (let elapsed = 20; elapsed < 100; elapsed += 20) {
      timers.advanceBy(20);
      scheduler.markDirty();
    }

    timers.advanceBy(20);
    await flushAsync();

    expect(dispatchAutomatic).toHaveBeenCalledTimes(1);
    expect(scheduler.getState()).toMatchObject({ status: "clean", ready: false });
  });

  it("does not dispatch when the derived work state reports no embedding work", async () => {
    const dispatchAutomatic = vi.fn(() => accepted());
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: true,
      hasEmbeddingWork: async () => false,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(30);
    await flushAsync();

    expect(dispatchAutomatic).not.toHaveBeenCalled();
    expect(scheduler.getState()).toMatchObject({ status: "clean", ready: false });
  });

  it("keeps Mistral work manual-only", async () => {
    const dispatchAutomatic = vi.fn(() => accepted());
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: false,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(30);
    await flushAsync();

    expect(dispatchAutomatic).not.toHaveBeenCalled();
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: true });
  });

  it("keeps OpenRouter work manual-only", async () => {
    const dispatchAutomatic = vi.fn(() => accepted());
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: false,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(30);
    await flushAsync();

    expect(dispatchAutomatic).not.toHaveBeenCalled();
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: true });
  });

  it("preempts pending automatic scheduling for a manual request", () => {
    const { scheduler, timers } = createScheduler({ canDispatchAutomatically: true });
    scheduler.start();
    scheduler.markDirty();

    scheduler.preemptForManual();
    timers.advanceBy(1_000);

    expect(timers.pendingCount()).toBe(0);
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: false });
  });

  it("retains a new dirty signal received while automatic execution is running", async () => {
    const running = deferred<{ readonly success: boolean }>();
    const dispatchAutomatic = vi.fn((): EmbeddingSchedulerAutomaticDispatchResult => ({
      status: "accepted",
      completion: running.promise,
    }));
    const hasEmbeddingWork = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: true,
      hasEmbeddingWork,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(30);
    await flushAsync();
    expect(dispatchAutomatic).toHaveBeenCalledTimes(1);

    scheduler.markDirty();
    running.resolve({ success: true });
    await flushAsync();

    expect(scheduler.getState()).toMatchObject({ status: "scheduled", ready: false });
    expect(timers.pendingCount()).toBe(2);
  });

  it("does not falsely clean work when automatic execution fails", async () => {
    const dispatchAutomatic = vi.fn(() => accepted(false));
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: true,
      hasEmbeddingWork: async () => true,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(30);
    await flushAsync();

    expect(dispatchAutomatic).toHaveBeenCalledTimes(1);
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: true });
  });

  it("keeps the Mobile Companion disabled even when the host policy would allow dispatch", async () => {
    const dispatchAutomatic = vi.fn(() => accepted());
    const { scheduler, timers } = createScheduler({
      isMobile: true,
      canDispatchAutomatically: true,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(1_000);
    await flushAsync();

    expect(dispatchAutomatic).not.toHaveBeenCalled();
    expect(scheduler.getState()).toMatchObject({ status: "disabled", ready: false });
    expect(timers.pendingCount()).toBe(0);
  });

  it("prevents dispatch when disposed while asynchronous work eligibility is pending", async () => {
    const work = deferred<boolean>();
    const dispatchAutomatic = vi.fn(() => accepted());
    const { scheduler, timers } = createScheduler({
      canDispatchAutomatically: true,
      hasEmbeddingWork: () => work.promise,
      dispatchAutomatic,
    });
    scheduler.start();
    scheduler.markDirty();
    timers.advanceBy(30);
    scheduler.dispose();
    work.resolve(true);
    await flushAsync();

    expect(dispatchAutomatic).not.toHaveBeenCalled();
    expect(scheduler.getState()).toMatchObject({ status: "disabled", ready: false });
  });

  it("supports pause, resume, disable, and ignores dirty signals while inactive", () => {
    const { scheduler, timers } = createScheduler();
    scheduler.start();
    scheduler.markDirty();
    scheduler.pause();
    scheduler.markDirty();
    expect(scheduler.getState()).toMatchObject({ status: "paused", ready: false });
    expect(timers.pendingCount()).toBe(0);
    scheduler.resume();
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: false });
    scheduler.disable();
    scheduler.markDirty();
    expect(scheduler.getState()).toMatchObject({ status: "disabled", ready: false });
  });
});
