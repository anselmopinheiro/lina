import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { activeProducerRuntime } from "../helpers/producerRuntimeState";
import { FakeAdapter } from "../helpers/fakeAdapter";
import type { EmbeddingWorkSummary } from "../../src/index/embeddingWorkStatusController";

const identity = { provider: "ollama", model: "nomic-embed-text-v2-moe", dimensions: 768, inputVersion: 1, prefixMode: "none" as const };

function summary(overrides: Partial<EmbeddingWorkSummary> = {}): EmbeddingWorkSummary {
  return {
    exists: true,
    canonicalReadability: "readable",
    provider: identity.provider,
    model: identity.model,
    dimensions: 768,
    publishedIdentity: identity,
    textIndexStatus: "ready",
    updatePlan: {
      mode: "incremental",
      totalChunks: 3,
      missingCount: 0,
      staleToReplaceCount: 0,
      obsoleteToDropCount: 0,
      toGenerateCount: 0,
      reusableCanonicalCount: 3,
      recoverableCheckpointCount: 0,
      requiresPublication: false,
      reasons: [],
      targetIdentity: identity,
    },
    ...overrides,
  };
}

async function pluginWith(workSummary: EmbeddingWorkSummary | undefined, runtime = activeProducerRuntime()) {
  const app = new App();
  app.vault.adapter = new FakeAdapter({});
  const plugin = new LinaPlugin(app);
  await plugin.loadDataFromDisk();
  vi.spyOn(plugin, "getDeviceRuntimeState").mockReturnValue(runtime);
  vi.spyOn(plugin.getOwnershipGate(), "isAuthorizedSync").mockReturnValue(runtime.isActiveProducer);
  const controller = (plugin as unknown as {
    getEmbeddingWorkStatusController(): { getState(): unknown; refresh(): Promise<unknown> };
  }).getEmbeddingWorkStatusController();
  vi.spyOn(controller, "getState").mockReturnValue({ status: "ready", revision: 1, summary: workSummary });
  vi.spyOn(controller, "refresh").mockResolvedValue({});
  return plugin;
}

describe("S8 — device diagnostics consume the live canonical snapshot (LINA-15D-B)", () => {
  const cases: Array<[string, EmbeddingWorkSummary | undefined, Partial<ReturnType<typeof activeProducerRuntime>>?, string?]> = [
    ["compatible", summary(), undefined, "READY"],
    ["incompatible (published dimensions differ)", summary({ publishedIdentity: { ...identity, dimensions: 1024 } }), undefined, "INCOMPATIBLE"],
    ["text index missing", summary({ textIndexStatus: "missing" }), undefined, "NO_TEXT_INDEX"],
    ["indeterminate (no summary)", undefined, undefined, "INDETERMINATE"],
    ["companion", summary(), { effectiveRole: "companion", isCompanion: true, isActiveProducer: false, canPublish: false }],
  ];

  for (const [label, workSummary, runtimeOverrides, expectedPrimary] of cases) {
    it(`${label}: diagnostics snapshot equals the Sidebar/Worker snapshot`, async () => {
      const plugin = await pluginWith(workSummary, activeProducerRuntime(runtimeOverrides));
      const live = plugin.getEmbeddingLifecycleSnapshot();
      const diagnostics = await plugin.getDeviceDiagnostics();
      const shown = diagnostics.lifecycleSnapshot;
      expect(shown.primary).toBe(live.primary);
      expect(shown.read.compatibility).toEqual(live.read.compatibility);
      expect(shown.upstream).toEqual(live.upstream);
      expect(shown.write.applicable).toBe(live.write.applicable);
      if (expectedPrimary) expect(shown.primary).toBe(expectedPrimary);
    });
  }

  it("no 0/1 validForSearch count is derived from semanticAvailable", () => {
    const text = require("node:fs").readFileSync("main.ts", "utf8") as string;
    expect(text).not.toMatch(/validForSearchCount:\s*runtimeState\.embeddings\.semanticAvailable/);
  });
});
