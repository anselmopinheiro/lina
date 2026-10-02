import { describe, expect, it } from "vitest";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import { deriveEmbeddingWritePathDecision } from "../../src/index/embeddingLifecycleWritePath";
import { activeProducerRuntime } from "../helpers/producerRuntimeState";

const identity = { provider: "ollama", model: "m", dimensions: 8, inputVersion: 1, prefixMode: "none" as const };

describe("S1 — the adapter never turns absent facts into capability (LINA-15D-B)", () => {
  it("no device runtime: not an Active Producer, write never applies, nothing can execute", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      upstreamTextIndex: "ready",
      canonicalExists: false,
      workAssessment: { kind: "pending", mode: "initial-build", updateRequired: true, severity: "action", cost: "local", reasons: ["x"] },
    });
    expect(snapshot.write.applicable).toBe(false);
    const decision = deriveEmbeddingWritePathDecision(snapshot);
    expect(decision.canExecute).toBe(false);
    expect(decision.action).toBe("none");
  });

  it("unknown valid-vector count does not grant semantic availability", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: activeProducerRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      publishedIdentity: identity,
      targetIdentity: identity,
    });
    expect(snapshot.read.semanticAvailable).toBe(false);
  });

  it("an explicit valid-vector count is honoured and the canonical source is JSONL", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: activeProducerRuntime(),
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 5,
      publishedIdentity: identity,
      targetIdentity: identity,
    });
    expect(snapshot.read.semanticAvailable).toBe(true);
    expect(snapshot.read.source).toBe("jsonl");
  });

  it("without a canonical publication there is no read source", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({ deviceRuntimeState: activeProducerRuntime(), upstreamTextIndex: "ready", canonicalExists: false });
    expect(snapshot.read.source).toBe("none");
  });
});
