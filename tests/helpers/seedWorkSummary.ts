import { vi } from "vitest";

/**
 * Gives the plugin's embedding work controller a readable work summary (pending incremental work),
 * so the start gate does not see the fail-closed "no summary" state (LINA-15D-B / S9).
 */
export function seedReadableWorkSummary(plugin: object): void {
  const controller = (plugin as unknown as {
    getEmbeddingWorkStatusController(): { getState(): unknown };
  }).getEmbeddingWorkStatusController();
  vi.spyOn(controller, "getState").mockReturnValue({
    status: "ready",
    revision: 1,
    summary: {
      exists: true,
      canonicalReadability: "readable",
      provider: "ollama",
      model: "nomic-embed-text-v2-moe",
      dimensions: 768,
      updatePlan: {
        mode: "initial-build",
        totalChunks: 1,
        missingCount: 1,
        staleToReplaceCount: 0,
        obsoleteToDropCount: 0,
        toGenerateCount: 1,
        reusableCanonicalCount: 0,
        recoverableCheckpointCount: 0,
        requiresPublication: true,
        reasons: [],
        targetIdentity: { provider: "ollama", model: "nomic-embed-text-v2-moe", dimensions: 768, inputVersion: 1, prefixMode: "none" },
      },
    },
  });
}
