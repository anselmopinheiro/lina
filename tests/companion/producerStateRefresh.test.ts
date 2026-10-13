import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createProducerStateChangeDetector,
  isProducerStateVaultChange,
  PRODUCER_STATE_FILE_PATH,
} from "../../src/companion/producerStateRefresh";
import { createPathScopedDebouncer } from "../../src/index/automaticUpdateEvents";

describe("Producer-state Consumer refresh", () => {
  it("accepts only the synchronized producer-state artifact, including either side of a rename", () => {
    expect(isProducerStateVaultChange({ path: PRODUCER_STATE_FILE_PATH })).toBe(true);
    expect(isProducerStateVaultChange({ path: "notes/irrelevant.md" })).toBe(false);
    expect(isProducerStateVaultChange(
      { path: ".lina/producer-state.json.tmp-next" },
      PRODUCER_STATE_FILE_PATH
    )).toBe(true);
  });

  it("coalesces nearby relevant events and can cancel a queued refresh", () => {
    const callbacks: Array<() => void> = [];
    const refresh = vi.fn();
    const debouncer = createPathScopedDebouncer(
      refresh,
      100,
      {
        setTimeout: (callback) => {
          callbacks.push(callback);
          return callbacks.length;
        },
        clearTimeout: vi.fn(),
      }
    );

    debouncer.schedule(PRODUCER_STATE_FILE_PATH, true);
    debouncer.schedule(PRODUCER_STATE_FILE_PATH, true);
    expect(debouncer.pendingCount()).toBe(1);

    callbacks.at(-1)?.();
    expect(refresh).toHaveBeenCalledTimes(1);

    debouncer.schedule(PRODUCER_STATE_FILE_PATH, true);
    debouncer.cancelAll();
    expect(debouncer.pendingCount()).toBe(0);
  });
});

describe("Producer-state stat detector (hidden .lina folder)", () => {
  const stat = (mtime: number, size: number) => ({ mtime, size });

  it("uses the first observation as baseline and reports only later metadata changes", async () => {
    const results = [stat(1, 10), stat(1, 10), stat(2, 10), stat(2, 11), stat(2, 11)];
    const adapter = { stat: vi.fn(async () => results.shift() ?? null) };
    const detector = createProducerStateChangeDetector(adapter);

    expect(await detector.check()).toBe(false); // baseline
    expect(await detector.check()).toBe(false); // unchanged
    expect(await detector.check()).toBe(true);  // mtime changed
    expect(await detector.check()).toBe(true);  // size changed
    expect(await detector.check()).toBe(false); // unchanged again
    expect(adapter.stat).toHaveBeenCalledWith(PRODUCER_STATE_FILE_PATH);
  });

  it("reports removal and re-creation, and treats missing as a distinct state", async () => {
    const results = [stat(1, 10), null, null, stat(3, 10)];
    const detector = createProducerStateChangeDetector({ stat: async () => results.shift() ?? null });

    expect(await detector.check()).toBe(false);
    expect(await detector.check()).toBe(true);  // deleted
    expect(await detector.check()).toBe(false); // still missing
    expect(await detector.check()).toBe(true);  // created again
  });

  it("does not report or move the baseline when stat fails", async () => {
    let fail = false;
    let current = stat(1, 10);
    const detector = createProducerStateChangeDetector({
      stat: async () => {
        if (fail) throw new Error("adapter unavailable");
        return current;
      },
    });

    await detector.check();
    fail = true;
    expect(await detector.check()).toBe(false);
    fail = false;
    expect(await detector.check()).toBe(false); // same as baseline: no refresh loop
    current = stat(5, 10);
    expect(await detector.check()).toBe(true);
  });

  it("shares one stat between concurrent checks (single-flight)", async () => {
    let release: (value: { mtime: number; size: number }) => void = () => undefined;
    const adapter = {
      stat: vi.fn(() => new Promise<{ mtime: number; size: number }>((resolve) => { release = resolve; })),
    };
    const detector = createProducerStateChangeDetector(adapter);

    const first = detector.check();
    const second = detector.check();
    release(stat(1, 1));
    await Promise.all([first, second]);

    expect(adapter.stat).toHaveBeenCalledTimes(1);
  });
});

describe("Lina view wiring of the producer-state refresh", () => {
  const source = readFileSync("src/search/linaSearchView.ts", "utf8");

  it("observes the artifact by stat on an interval and when the leaf becomes active", () => {
    expect(source).toContain("createProducerStateChangeDetector(this.app.vault.adapter)");
    expect(source).toContain("this.registerInterval(window.setInterval(checkProducerStateByStat, PRODUCER_STATE_STAT_POLL_INTERVAL_MS))");
    expect(source).toContain('this.app.workspace.on("active-leaf-change"');
    expect(source).toContain("this.containerEl.isShown()");
  });

  it("keeps the vault-event listeners as a complementary trigger", () => {
    for (const event of ["create", "modify", "delete", "rename"]) {
      expect(source).toContain(`this.app.vault.on("${event}", requestProducerStateRefresh)`);
    }
  });
});
