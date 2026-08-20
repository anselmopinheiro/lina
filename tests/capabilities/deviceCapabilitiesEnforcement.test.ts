import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import LinaPlugin from "../../main.ts";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { searchTextIndex } from "../../src/search/textSearch";
import { FakeAdapter } from "../helpers/fakeAdapter";

type TestableLinaPlugin = LinaPlugin & Record<string, unknown>;

function createPluginHarness(): TestableLinaPlugin {
  const plugin = Object.create(LinaPlugin.prototype) as TestableLinaPlugin;
  plugin.settings = {
    autoUpdateIndexOnFileChanges: true,
    debugIndexUpdates: false,
  };
  plugin.indexDiagnostic = { pendingDebounces: new Set<string>() };
  plugin.pendingAutomaticUpdates = new Map();
  plugin.automaticUpdatesReady = false;
  plugin.startupReconciliationInProgress = false;
  plugin.startupReconciliationNeeded = false;
  plugin.startupIgnoredEventCount = 0;
  plugin.automaticUpdateInProgress = false;
  return plugin;
}

describe("device capability enforcement", () => {
  afterEach(() => {
    Platform.isMobile = false;
    vi.restoreAllMocks();
  });

  it("registers all vault maintenance listeners on a desktop producer", () => {
    const plugin = createPluginHarness();
    const on = vi.fn(() => ({ id: Symbol("listener") }));
    plugin.app = { vault: { on, offref: vi.fn() } };

    (plugin.registerVaultEventListeners as () => void).call(plugin);

    expect(on.mock.calls.map(([event]) => event)).toEqual(["create", "modify", "delete", "rename"]);
    expect(plugin.getMaintenanceEngine().getState().status).toBe("idle");
  });

  it("does not register vault maintenance listeners on a mobile companion", () => {
    Platform.isMobile = true;
    const plugin = createPluginHarness();
    const on = vi.fn();
    plugin.app = { vault: { on, offref: vi.fn() } };

    (plugin.registerVaultEventListeners as () => void).call(plugin);

    expect(on).not.toHaveBeenCalled();
    expect(plugin.getMaintenanceEngine().getState().status).toBe("idle");
  });

  it("runs startup reconciliation on a desktop producer", async () => {
    const plugin = createPluginHarness();
    plugin.app = { vault: { adapter: new FakeAdapter() } };
    const reconcile = vi.fn().mockResolvedValue(undefined);
    plugin.reconcileTextIndexAtStartup = reconcile;

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(reconcile).toHaveBeenCalledOnce();
    expect(plugin.automaticUpdatesReady).toBe(true);
  });

  it("skips startup reconciliation and producer operations on a mobile companion", async () => {
    Platform.isMobile = true;
    const plugin = createPluginHarness();
    const adapter = new FakeAdapter();
    plugin.app = { vault: { adapter } };
    const reconcile = vi.fn().mockResolvedValue(undefined);
    plugin.reconcileTextIndexAtStartup = reconcile;

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(reconcile).not.toHaveBeenCalled();
    expect(plugin.automaticUpdatesReady).toBe(true);
    await expect(plugin.rebuildTextIndex()).resolves.toMatchObject({
      success: false,
      message: "Esta operação requer um dispositivo produtor do Lina.",
    });
    expect(plugin.requestEmbeddingIndexGeneration("command")).toMatchObject({ status: "not-capable" });
    await expect(plugin.createOrUpdateBinaryEmbeddingCopy()).resolves.toMatchObject({
      status: "error",
      reason: "Esta operação requer um dispositivo produtor do Lina.",
    });
    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "create",
      path: "Mobile.md",
      receivedAt: "2026-08-16T00:00:00.000Z",
    }]);
    expect(adapter.writeCount).toBe(0);
  });

  it("keeps companion search capabilities and text search available", () => {
    expect(resolveDeviceCapabilities({ isMobile: true })).toMatchObject({
      canReadArtifacts: true,
      canExecuteSearch: true,
    });
    expect(searchTextIndex(
      [{ path: "Synced.md", basename: "Synced", extension: "md", size: 1, mtime: 1, contentHash: "hash", indexedAt: "now" }],
      [{ id: "Synced.md-0", path: "Synced.md", text: "A synchronized artifact remains searchable.", start: 0, end: 42 }],
      "searchable",
    )).toHaveLength(1);
  });
});
