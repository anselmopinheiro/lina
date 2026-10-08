import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { FakeApp } from "../helpers/fakeApp";
import { completeSummary } from "../helpers/completeWorkSummary";
import { activeProducerRuntime } from "../helpers/producerRuntimeState";
import { readEmbeddingStatus } from "../../src/index/embeddingGenerator";
import {
  buildEmbeddingWorkLifecycleSnapshot,
  type EmbeddingWorkSummary,
} from "../../src/index/embeddingWorkStatusController";
import { evaluateSemanticCapabilityFromSnapshot } from "../../src/search/semanticCapability";

const PUBLICATION = "emb-android-001";
const MOBILE_OVER_LIMIT = "x".repeat(12 * 1024 * 1024); // > 11.20 MB mobile bridge ceiling

function vault(binary: Record<string, unknown> | undefined): FakeApp {
  const files: Record<string, string> = {
    ".lina/index/manifest.json": JSON.stringify({
      embeddingsEnabled: true,
      embeddingInput: { version: 1, prefixMode: "none" },
      embeddings: {
        enabled: true, provider: "mistral", model: "mistral-embed", dimensions: 1024,
        totalEmbeddings: 2564, publicationId: PUBLICATION, updatedAt: "2026-10-06T22:02:07.064Z",
      },
    }),
    ".lina/index/embeddings.jsonl": MOBILE_OVER_LIMIT,
  };
  if (binary) files[".lina/index/embeddings.binary.manifest.json"] = JSON.stringify(binary);
  return new FakeApp(new FakeAdapter(files));
}

const validBinary = {
  format: "lina-embeddings-binary", version: 1, sourcePublicationId: PUBLICATION,
  provider: "mistral", model: "mistral-embed", dimensions: 1024, recordCount: 2564,
};

const companionRuntime = () => activeProducerRuntime({
  effectiveRole: "companion", isCompanion: true, isActiveProducer: false, canPublish: false,
});

async function companionCapability(app: FakeApp) {
  const status = await readEmbeddingStatus(app as unknown as App, { resourceProfile: "mobile" });
  expect(status).not.toBeNull();
  // Production always carries the update plan (target identity); the shared fixture helper completes it.
  const summary: EmbeddingWorkSummary = completeSummary({ ...status!, textIndexStatus: "ready", targetEndpointIsExternal: true });
  const snapshot = buildEmbeddingWorkLifecycleSnapshot(summary, 1, companionRuntime());
  return { status: status!, snapshot, capability: evaluateSemanticCapabilityFromSnapshot(snapshot, { textIndexAvailable: true }) };
}

describe("Android Companion: diagnostics vs semantic capability", () => {
  it("reports searchable vectors when the guarded canonical JSONL has a consistent binary copy", async () => {
    const { status, capability, snapshot } = await companionCapability(vault(validBinary));
    expect(status.canonicalReadability).toBe("resource-limit-exceeded");
    expect(status.validForSearchCount).toBe(2564);
    expect(capability.semanticAvailable).toBe(true);
    expect(capability.effectiveMode).toBe("full");
    expect(capability.reason).toBeUndefined();
    expect(snapshot.write.applicable).toBe(false);
    expect(snapshot.capability.canRequestUpdate).toBe(false);
  });

  it("does not claim searchable vectors for a stale binary copy (different publicationId)", async () => {
    const { status, capability } = await companionCapability(vault({ ...validBinary, sourcePublicationId: "emb-old" }));
    expect(status.validForSearchCount).toBe(0);
    expect(capability.semanticAvailable).toBe(false);
  });

  it("does not claim searchable vectors without a binary copy", async () => {
    const { status, capability } = await companionCapability(vault(undefined));
    expect(status.validForSearchCount).toBe(0);
    expect(capability.semanticAvailable).toBe(false);
  });

  it("does not claim searchable vectors when record counts diverge", async () => {
    const { status } = await companionCapability(vault({ ...validBinary, recordCount: 10 }));
    expect(status.validForSearchCount).toBe(0);
  });

  it("performs no writes while evaluating", async () => {
    const app = vault(validBinary);
    await companionCapability(app);
    expect(app.adapter.writeCount).toBe(0);
    expect(app.adapter.removeCount).toBe(0);
    expect(app.adapter.renameCount).toBe(0);
  });
});
