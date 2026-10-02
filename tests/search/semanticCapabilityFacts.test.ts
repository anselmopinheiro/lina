import { expect, it } from "vitest";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import { evaluateSemanticCapabilityFromSnapshot, evaluateSemanticCapabilityFromFacts } from "../../src/search/semanticCapability";

it("facts evaluation equals the snapshot projection of equivalent facts (LINA-15D-B / S3)", () => {
  const bools = [true, false];
  let n = 0;
  for (const t of bools) for (const c of bools) for (const v of bools) for (const p of bools) for (const chk of [true, false, undefined]) for (const reach of [true, false, undefined])
    for (const cs of ["compatible", "mismatch", "none"] as const) {
      const identity = p ? { provider: "x", model: "y", dimensions: 768, inputVersion: 1, prefixMode: "none" as const } : undefined;
      const snap = adaptCurrentStateToLifecycleSnapshot({
        companionState: {} as never,
        upstreamTextIndex: t ? "ready" : "missing",
        canonicalExists: c,
        activeSource: "jsonl",
        validForSearchCount: v ? 1 : 0,
        factsChecking: chk,
        publishedIdentity: identity,
      });
      const old = evaluateSemanticCapabilityFromSnapshot(snap, { textIndexAvailable: t, vectorContractState: cs, isChecking: chk, providerReachable: reach });
      const nu = evaluateSemanticCapabilityFromFacts({ textIndexAvailable: t, contractState: cs, canonicalExists: c, hasValidForSearchEvidence: v, hasPublishedIdentity: p, isChecking: chk, providerReachable: reach });
      const strip = (x: typeof old) => ({ ...x, artifactState: { ...x.artifactState, embeddingsDeclared: undefined } });
      expect(strip(nu), JSON.stringify({ t, c, v, p, chk, reach, cs })).toEqual(strip(old));
      n++;
    }
  expect(n).toBe(2 * 2 * 2 * 2 * 3 * 3 * 3);
});
