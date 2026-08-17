import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { EmbeddingScheduler, EmbeddingSchedulerTimers } from "../../src/maintenance/embeddingScheduler";

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

function createScheduler(isMobile = false) {
  const timers = new FakeTimers();
  const scheduler = new EmbeddingScheduler({
    canScheduleEmbeddings: () => resolveDeviceCapabilities({ isMobile }).canGenerateEmbeddings,
    timers,
    quietPeriodMs: 30,
    maximumDelayMs: 100,
  });
  return { scheduler, timers };
}

describe("EmbeddingScheduler foundation", () => {
  it("contains no embedding execution dependency or dispatch path", () => {
    const source = readFileSync(resolve(process.cwd(), "src/maintenance/embeddingScheduler.ts"), "utf8");

    expect(source).not.toContain("EmbeddingWorker");
    expect(source).not.toContain("requestEmbeddingGeneration");
    expect(source).not.toContain("generateEmbeddings");
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

  it("coalesces dirty signals into one quiet timer and one maximum-delay timer", () => {
    const { scheduler, timers } = createScheduler();
    scheduler.start();
    scheduler.markDirty();
    scheduler.markDirty();
    scheduler.markDirty();

    expect(scheduler.getState()).toMatchObject({ status: "scheduled", ready: false, dirtySince: 0 });
    expect(timers.pendingCount()).toBe(2);
    timers.advanceBy(30);
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: true, dirtySince: 0 });
    expect(timers.pendingCount()).toBe(0);
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

  it("reaches readiness at maximum delay during continuous dirty activity without dispatching work", () => {
    const { scheduler, timers } = createScheduler();
    scheduler.start();
    scheduler.markDirty();
    for (let elapsed = 20; elapsed < 100; elapsed += 20) {
      timers.advanceBy(20);
      scheduler.markDirty();
    }

    timers.advanceBy(20);
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: true, dirtySince: 0 });
    expect(timers.pendingCount()).toBe(0);
  });

  it("preempts pending automatic scheduling for a manual request without executing embeddings", () => {
    const { scheduler, timers } = createScheduler();
    scheduler.start();
    scheduler.markDirty();

    scheduler.preemptForManual();
    timers.advanceBy(1_000);

    expect(timers.pendingCount()).toBe(0);
    expect(scheduler.getState()).toMatchObject({ status: "dirty", ready: false });
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

  it("keeps the Companion disabled and clears callbacks on disposal", () => {
    const companion = createScheduler(true);
    companion.scheduler.start();
    companion.scheduler.markDirty();
    expect(companion.scheduler.getState()).toMatchObject({ status: "disabled", ready: false });
    expect(companion.timers.pendingCount()).toBe(0);

    const producer = createScheduler();
    producer.scheduler.start();
    producer.scheduler.markDirty();
    producer.scheduler.dispose();
    producer.timers.advanceBy(1_000);
    expect(producer.scheduler.getState()).toMatchObject({ status: "disabled", ready: false });
  });
});
