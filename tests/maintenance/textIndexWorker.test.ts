import { describe, expect, it, vi } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { TextIndexWorker } from "../../src/maintenance/textIndexWorker";

describe("text index worker", () => {
  it("starts producer listeners and routes each vault event", () => {
    const subscribe = vi.fn((_event, _callback) => vi.fn());
    const onVaultEvent = vi.fn();
    const worker = new TextIndexWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      isAutomaticUpdateEnabled: () => true,
      subscribeVaultEvent: subscribe,
      onVaultEvent,
      timers: { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() },
    });

    worker.start();

    expect(worker.isStarted()).toBe(true);
    expect(subscribe.mock.calls.map(([event]) => event)).toEqual(["create", "modify", "delete", "rename"]);
    for (const [event, callback] of subscribe.mock.calls) {
      callback({ path: `${event}.md` }, event === "rename" ? "old.md" : undefined);
    }
    expect(onVaultEvent).toHaveBeenCalledTimes(4);
  });

  it("does not activate on a companion", () => {
    const subscribe = vi.fn();
    const worker = new TextIndexWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: true }),
      isAutomaticUpdateEnabled: () => true,
      subscribeVaultEvent: subscribe,
      onVaultEvent: vi.fn(),
      timers: { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() },
    });

    worker.start();

    expect(worker.isStarted()).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("owns the two-second modify debounce", () => {
    let scheduled: (() => void) | undefined;
    const worker = new TextIndexWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      isAutomaticUpdateEnabled: () => true,
      subscribeVaultEvent: vi.fn(() => vi.fn()),
      onVaultEvent: vi.fn(),
      timers: {
        setTimeout: (callback) => {
          scheduled = callback;
          return 1;
        },
        clearTimeout: vi.fn(),
      },
    });
    const run = vi.fn();

    worker.start();
    worker.scheduleModify("Note.md", run);
    scheduled?.();

    expect(run).toHaveBeenCalledOnce();
  });

  it("owns the coalesced automatic-update queue and flushes it through its host port", async () => {
    const scheduled: Array<() => void> = [];
    const runAutomaticBatch = vi.fn(async () => true);
    const worker = new TextIndexWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      isAutomaticUpdateEnabled: () => true,
      subscribeVaultEvent: vi.fn(() => vi.fn()),
      onVaultEvent: vi.fn(),
      runAutomaticBatch,
      timers: {
        setTimeout: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        clearTimeout: vi.fn(),
      },
    });

    worker.setAutomaticUpdatesReady(true);
    worker.queueAutomaticIndexUpdate({
      changeType: "create",
      path: "Note.md",
      receivedAt: "2026-08-17T00:00:00.000Z",
    });
    worker.queueAutomaticIndexUpdate({
      changeType: "modify",
      path: "Note.md",
      receivedAt: "2026-08-17T00:00:01.000Z",
    });

    expect(worker.getPendingAutomaticUpdates().size).toBe(1);
    scheduled.at(-1)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(runAutomaticBatch).toHaveBeenCalledWith([
      expect.objectContaining({ changeType: "create", path: "Note.md" }),
    ], {});
    expect(worker.getPendingAutomaticUpdates().size).toBe(0);
  });

  it("keeps a batch queued when the host defers it", async () => {
    const scheduled: Array<() => void> = [];
    const worker = new TextIndexWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      isAutomaticUpdateEnabled: () => true,
      subscribeVaultEvent: vi.fn(() => vi.fn()),
      onVaultEvent: vi.fn(),
      runAutomaticBatch: vi.fn(async () => false),
      timers: {
        setTimeout: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        clearTimeout: vi.fn(),
      },
    });

    worker.setAutomaticUpdatesReady(true);
    worker.queueAutomaticIndexUpdate({
      changeType: "delete",
      path: "Later.md",
      receivedAt: "2026-08-17T00:00:00.000Z",
    });
    scheduled.at(-1)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(worker.getPendingAutomaticUpdates().size).toBe(1);
  });
});
