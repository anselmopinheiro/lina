import { describe, expect, it } from "vitest";
import { activeProducerRuntime } from "../helpers/producerRuntimeState";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { readEmbeddingStatus } from "../../src/index/embeddingGenerator";
import {
  buildEmbeddingWorkLifecycleSnapshot,
  type EmbeddingWorkSummary,
} from "../../src/index/embeddingWorkStatusController";
import { deriveEmbeddingWritePathDecision } from "../../src/index/embeddingLifecycleWritePath";

const plan = (overrides: Record<string, unknown> = {}) => ({
  mode: "incremental" as const,
  totalChunks: 4,
  missingCount: 0,
  staleToReplaceCount: 0,
  obsoleteToDropCount: 0,
  toGenerateCount: 0,
  reusableCanonicalCount: 4,
  recoverableCheckpointCount: 0,
  requiresPublication: false,
  reasons: [],
  targetIdentity: { provider: "ollama", model: "nomic-embed-text", dimensions: 1024, inputVersion: 1, prefixMode: "none" as const },
  ...overrides,
});

const published = { provider: "ollama", model: "nomic-embed-text", dimensions: 1024, inputVersion: 1, prefixMode: "none" as const };

function summary(overrides: Partial<EmbeddingWorkSummary> = {}): EmbeddingWorkSummary {
  return {
    exists: true,
    canonicalReadability: "readable",
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 1024,
    publishedIdentity: published,
    updatePlan: plan(),
    textIndexStatus: "ready",
    ...overrides,
  };
}

describe("S2-a — the real published identity crosses readEmbeddingStatus → summary → snapshot (LINA-15D-B)", () => {
  it("keeps the manifest inputVersion instead of a hard-coded 1", async () => {
    const adapter = new FakeAdapter({
      ".lina/index/manifest.json": JSON.stringify({
        embeddingsEnabled: true,
        embeddings: { provider: "ollama", model: "nomic-embed-text", dimensions: 1024, updatedAt: "2026-08-01T00:00:00.000Z" },
        embeddingInput: { version: 7, prefixMode: "none" },
      }),
      ".lina/index/embeddings.jsonl": "",
    });
    const status = await readEmbeddingStatus({ vault: { adapter } } as never);
    expect(status?.publishedIdentity).toMatchObject({ inputVersion: 7, dimensions: 1024, prefixMode: "none" });

    const snapshot = buildEmbeddingWorkLifecycleSnapshot(
      { ...(status as EmbeddingWorkSummary), updatePlan: plan(), textIndexStatus: "ready" },
      1,
      activeProducerRuntime()
    );
    expect(snapshot.read.compatibility.published).toMatchObject({ inputVersion: 7 });
    // target inputVersion 1 ≠ published 7 ⇒ detected (it was invisible with the hard-coded 1)
    expect(snapshot.primary).toBe("INCOMPATIBLE");
  });

  it("a published identity matching the target is READY", () => {
    expect(buildEmbeddingWorkLifecycleSnapshot(summary(), 1, activeProducerRuntime()).primary).toBe("READY");
  });
});

describe("S2-b — unknown dimensions are never 768 or 0", () => {
  it("target dimensions unknown stay undefined", () => {
    const snapshot = buildEmbeddingWorkLifecycleSnapshot(
      summary({
        exists: false,
        canonicalReadability: "missing",
        publishedIdentity: undefined,
        dimensions: 0,
        updatePlan: plan({ mode: "initial-build", targetIdentity: { provider: "ollama", model: "m", dimensions: undefined, inputVersion: 1, prefixMode: "none" } }),
      }),
      1,
      activeProducerRuntime()
    );
    expect(snapshot.read.compatibility.device?.dimensions).toBeUndefined();
  });

  it("a 0 dimension in the published identity is not a valid identity", () => {
    const snapshot = buildEmbeddingWorkLifecycleSnapshot(
      summary({ publishedIdentity: { ...published, dimensions: 0 } }),
      1,
      activeProducerRuntime()
    );
    expect(snapshot.read.compatibility.published?.dimensions).toBeUndefined();
    expect(snapshot.primary).not.toBe("READY");
  });
});

describe("S2-c — no Active Producer is fabricated", () => {
  it("without a runtime the snapshot is INDETERMINATE and nothing can execute", () => {
    const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary({ updatePlan: plan({ mode: "initial-build", toGenerateCount: 4, missingCount: 4 }) }), 1);
    expect(snapshot.primary).toBe("INDETERMINATE");
    expect(deriveEmbeddingWritePathDecision(snapshot).canExecute).toBe(false);
  });

  it("without an update plan the work is indeterminate, not 'no work'", () => {
    const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary({ updatePlan: undefined }), 1, activeProducerRuntime());
    expect(snapshot.primary).toBe("INDETERMINATE");
  });

  it("Companion and Standby runtimes never apply write", () => {
    for (const runtime of [
      activeProducerRuntime({ effectiveRole: "companion", isCompanion: true, isActiveProducer: false, canPublish: false }),
      activeProducerRuntime({ isActiveProducer: false, isStandbyProducer: true, canPublish: false }),
    ]) {
      const decision = deriveEmbeddingWritePathDecision(
        buildEmbeddingWorkLifecycleSnapshot(summary({ updatePlan: plan({ missingCount: 2, toGenerateCount: 2 }) }), 1, runtime)
      );
      expect(decision.applicable).toBe(false);
      expect(decision.canExecute).toBe(false);
    }
  });
});

describe("S2-d — the text index state is factual", () => {
  it("a missing text index reaches NO_TEXT_INDEX", () => {
    expect(buildEmbeddingWorkLifecycleSnapshot(summary({ textIndexStatus: "missing" }), 1, activeProducerRuntime()).primary).toBe("NO_TEXT_INDEX");
  });

  it("an invalid text index is not 'ready'", () => {
    expect(buildEmbeddingWorkLifecycleSnapshot(summary({ textIndexStatus: "invalid" }), 1, activeProducerRuntime()).upstream.textIndex).toBe("invalid");
  });

  it("without a factual status it derives from the runtime fact, never a fixed 'ready'", () => {
    const runtime = activeProducerRuntime();
    const noIndex = { ...runtime, embeddings: { ...runtime.embeddings, textIndexAvailable: false } };
    const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary({ textIndexStatus: undefined }), 1, noIndex);
    expect(snapshot.upstream.textIndex).toBe("missing");
  });
});
