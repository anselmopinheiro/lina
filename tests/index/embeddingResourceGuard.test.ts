import { describe, expect, it } from "vitest";
import {
  DESKTOP_BRIDGE_READ_GUARD,
  MOBILE_BRIDGE_READ_GUARD,
  estimateCapacitorBridgePeakBytes,
  evaluateEmbeddingBridgeRead,
} from "../../src/index/embeddingResourceGuard";
import { readEmbeddingStatus } from "../../src/index/embeddingGenerator";
import { FakeAdapter } from "../helpers/fakeAdapter";

describe("Capacitor embedding bridge read guard", () => {
  it("uses deterministic amplification plus fixed margin", () => {
    expect(estimateCapacitorBridgePeakBytes(1_000, MOBILE_BRIDGE_READ_GUARD)).toBe(
      1_000 * MOBILE_BRIDGE_READ_GUARD.estimatedBridgeAmplification + MOBILE_BRIDGE_READ_GUARD.fixedMarginBytes,
    );
  });

  it("keeps desktop more permissive than mobile", () => {
    expect(evaluateEmbeddingBridgeRead(20 * 1024 * 1024, "desktop").allowed).toBe(true);
    expect(evaluateEmbeddingBridgeRead(20 * 1024 * 1024, "mobile").allowed).toBe(false);
    expect(DESKTOP_BRIDGE_READ_GUARD.maxEstimatedBridgePeakBytes).toBeGreaterThan(MOBILE_BRIDGE_READ_GUARD.maxEstimatedBridgePeakBytes);
  });

  it("rejects invalid sizes and arithmetic overflow without reading", () => {
    expect(evaluateEmbeddingBridgeRead(undefined, "mobile")).toMatchObject({ allowed: false, code: "mobile-bridge-read-limit-exceeded" });
    expect(evaluateEmbeddingBridgeRead(-1, "mobile")).toMatchObject({ allowed: false, code: "mobile-bridge-read-limit-exceeded" });
    expect(() => estimateCapacitorBridgePeakBytes(Number.MAX_SAFE_INTEGER, MOBILE_BRIDGE_READ_GUARD)).toThrow("mobile-bridge-read-size-overflow");
  });

  it("returns partial manifest status before a dangerous mobile JSONL read", async () => {
    const adapter = new FakeAdapter({
      ".lina/index/manifest.json": JSON.stringify({
        embeddingsEnabled: true,
        embeddings: { provider: "mistral", model: "mistral-embed", dimensions: 768, updatedAt: "2026-07-31T00:00:00.000Z", publicationId: "pub-a" },
        embeddingInput: { version: 1, prefixMode: "none" },
      }),
      ".lina/index/embeddings.jsonl": "{}\n",
    });
    const originalStat = adapter.stat.bind(adapter);
    adapter.stat = async (path) => path.endsWith("embeddings.jsonl")
      ? { type: "file", size: 13 * 1024 * 1024, mtime: 1 }
      : originalStat(path);
    const status = await readEmbeddingStatus({ vault: { adapter } } as never, { resourceProfile: "mobile" });
    expect(status).toMatchObject({ exists: true, canonicalReadability: "unreadable", detailsAvailable: false, resourceLimitCode: "mobile-bridge-read-limit-exceeded", provider: "mistral", model: "mistral-embed", dimensions: 768 });
    expect(adapter.readPaths.filter((path) => path.endsWith("embeddings.jsonl"))).toHaveLength(0);
  });
});
