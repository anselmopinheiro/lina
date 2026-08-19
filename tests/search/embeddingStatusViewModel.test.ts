import { describe, expect, it } from "vitest";
import { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../../src/index/embeddingWorkStatusController";
import { buildEmbeddingStatusViewModel } from "../../src/search/embeddingStatusViewModel";
import { getStrings } from "../../src/i18n/strings";

const L = getStrings("pt-PT");

function idleOperation(): EmbeddingOperationState {
  return {
    operationId: null,
    origin: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    message: null,
    error: null,
    phase: null,
    totalChunks: null,
    processedChunks: 0,
    generatedChunks: 0,
    failedChunks: 0,
    reusedChunks: 0,
    percentage: null,
    currentChunk: null,
    cancelRequestedAt: null,
  };
}

function readyWork(overrides: Partial<EmbeddingWorkRuntimeState["summary"]> = {}): EmbeddingWorkRuntimeState {
  return {
    status: "ready",
    revision: 1,
    calculatedRevision: 1,
    workAvailable: true,
    summary: {
      exists: true,
      totalEmbeddings: 3,
      totalChunks: 4,
      totalCanonicalRecords: 3,
      validCount: 2,
      missingCount: 1,
      staleCount: 1,
      obsoleteCount: 1,
      validForSearchCount: 2,
      reusableForNextGenerationCount: 2,
      recoverableCheckpointCount: 0,
      operationActive: false,
      duplicateRecordCount: 0,
      invalidRecordCount: 0,
      provider: "ollama",
      model: "nomic-embed-text-v2-moe",
      dimensions: 768,
      updatedAt: "2026-07-20T10:00:00.000Z",
      expectedPrefixMode: "nomic-search-query-document",
      manifestPrefixMode: "nomic-search-query-document",
      updatePlan: {
        mode: "incremental",
        targetIdentity: {
          provider: "ollama",
          model: "nomic-embed-text-v2-moe",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "nomic-search-query-document",
        },
        totalChunks: 4,
        reusableCanonicalCount: 2,
        recoverableCheckpointCount: 0,
        toGenerateCount: 2,
        staleToReplaceCount: 1,
        missingCount: 1,
        obsoleteToDropCount: 1,
        requiresPublication: false,
        reasons: ["missing-chunks", "stale-chunks", "obsolete-records"],
      },
      ...overrides,
    },
  };
}

describe("embedding sidebar diagnostic view-model", () => {
  it("shows incremental work as an update without full rebuild confirmation", () => {
    const model = buildEmbeddingStatusViewModel({
      workState: readyWork(),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text-v2-moe",
      indexReady: true,
      embeddingsReady: true,
      strings: L,
    });

    expect(model.headline).toBe(L.stateEmbeddingUpdateAvailable);
    expect(model.counts).toContainEqual({ label: L.diagnosticValidForSearch, value: "2" });
    expect(model.counts).toContainEqual({ label: L.diagnosticEmbeddingsObsolete, value: "1" });
    expect(model.actions).toContainEqual({
      kind: "update",
      label: L.btnUpdateEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: false,
    });
  });

  it("requires confirmation for a full rebuild and does not expose internal identifiers", () => {
    const model = buildEmbeddingStatusViewModel({
      workState: {
        ...readyWork({
        provider: "ollama",
        model: "old-model",
        validCount: 4,
        missingCount: 0,
        staleCount: 0,
        obsoleteCount: 0,
        validForSearchCount: 4,
        updatePlan: {
          mode: "full-rebuild",
          targetIdentity: {
            provider: "mistral",
            model: "mistral-embed",
            dimensions: 1024,
            inputVersion: 1,
            prefixMode: "none",
          },
          totalChunks: 4,
          reusableCanonicalCount: 0,
          recoverableCheckpointCount: 0,
          toGenerateCount: 4,
          staleToReplaceCount: 0,
          missingCount: 0,
          obsoleteToDropCount: 0,
          requiresPublication: false,
          reasons: ["provider-changed", "model-changed"],
        },
      }),
        workAvailable: false,
      },
      operationState: idleOperation(),
      configuredProvider: "mistral",
      configuredModel: "mistral-embed",
      indexReady: true,
      embeddingsReady: true,
      strings: L,
    });

    expect(model.headline).toBe(L.diagnosticEmbeddingFullRebuildRequired);
    expect(model.actions).toContainEqual({
      kind: "rebuild",
      label: L.btnRebuildEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: true,
    });
    expect(JSON.stringify(model)).not.toMatch(/chunkId|A\.md|textHash|embeddingInputHash|operationId/i);
  });

  it("shows recoverable checkpoints as reusable work, not pending active work", () => {
    const model = buildEmbeddingStatusViewModel({
      workState: readyWork({
        recoverableCheckpointCount: 2,
        updatePlan: {
          mode: "incremental",
          targetIdentity: {
            provider: "ollama",
            model: "nomic-embed-text-v2-moe",
            dimensions: 768,
            inputVersion: 1,
            prefixMode: "nomic-search-query-document",
          },
          totalChunks: 4,
          reusableCanonicalCount: 1,
          recoverableCheckpointCount: 2,
          toGenerateCount: 1,
          staleToReplaceCount: 0,
          missingCount: 1,
          obsoleteToDropCount: 0,
          requiresPublication: false,
          reasons: ["checkpoint-compatible-records", "missing-chunks"],
        },
      }),
      operationState: idleOperation(),
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text-v2-moe",
      indexReady: true,
      embeddingsReady: true,
      strings: L,
    });

    expect(model.checkpointLabel).toBe(`${L.diagnosticEmbeddingCheckpointRecoverable}: 2`);
    expect(model.nextGeneration).toContainEqual({ label: L.diagnosticEmbeddingReusable, value: "3" });
    expect(model.headline).not.toContain("pendente");
  });

  it("prioritizes active operation controls over generation actions", () => {
    const running = {
      ...idleOperation(),
      operationId: 7,
      origin: "sidebar" as const,
      status: "running" as const,
      phase: "generating" as const,
      startedAt: "2026-07-20T10:00:00.000Z",
    };
    const model = buildEmbeddingStatusViewModel({
      workState: readyWork(),
      operationState: running,
      configuredProvider: "ollama",
      configuredModel: "nomic-embed-text-v2-moe",
      indexReady: true,
      embeddingsReady: true,
      strings: L,
    });

    expect(model.headline).toBe(L.diagnosticEmbeddingActiveOperation);
    expect(model.actions.map((action) => action.kind)).toEqual(["refresh-status", "cancel"]);
  });

  it("does not claim embeddings are up to date when a ready state has no calculated details", () => {
    const model = buildEmbeddingStatusViewModel({
      workState: {
        status: "ready",
        revision: 3,
        calculatedRevision: 3,
        workAvailable: false,
      },
      operationState: idleOperation(),
      configuredProvider: "openrouter",
      configuredModel: "openai/text-embedding-3-small",
      indexReady: true,
      embeddingsReady: true,
      strings: L,
    });

    expect(model.headline).toBe(L.diagnosticEmbeddingDetailsUnavailable);
    expect(model.headline).not.toBe(L.stateEmbeddingStatusUpToDate);
    expect(model.actions.map((action) => action.kind)).toEqual(["refresh-status"]);
  });

  it("keeps a manifest-derived full rebuild actionable when vector details are unavailable", () => {
    const model = buildEmbeddingStatusViewModel({
      workState: {
        ...readyWork({
          detailsAvailable: false,
          canonicalReadability: "unreadable",
          provider: "openrouter",
          model: "openai/text-embedding-3-small",
          updatePlan: {
            mode: "full-rebuild",
            targetIdentity: { provider: "mistral", model: "mistral-embed", inputVersion: 1, prefixMode: "none" },
            totalChunks: 4,
            reusableCanonicalCount: 0,
            recoverableCheckpointCount: 0,
            toGenerateCount: 4,
            staleToReplaceCount: 0,
            missingCount: 0,
            obsoleteToDropCount: 0,
            requiresPublication: false,
            reasons: ["provider-changed", "model-changed"],
          },
        }),
        workAvailable: true,
      },
      operationState: idleOperation(),
      configuredProvider: "mistral",
      configuredModel: "mistral-embed",
      indexReady: true,
      embeddingsReady: false,
      strings: L,
    });

    expect(model.headline).toBe(L.diagnosticEmbeddingFullRebuildRequired);
    expect(model.detailsAvailable).toBe(false);
    expect(model.published).toContainEqual({ label: L.detailsProvider, value: "openrouter" });
    expect(model.nextGeneration).toContainEqual({ label: L.detailsProvider, value: "mistral" });
    expect(model.actions).toContainEqual({
      kind: "rebuild",
      label: L.btnRebuildEmbeddings,
      disabled: false,
      requiresFullRebuildConfirmation: true,
    });
  });
});
