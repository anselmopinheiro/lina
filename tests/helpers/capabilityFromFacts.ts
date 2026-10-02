import {
  evaluateSemanticCapability,
  evaluateSemanticCapabilityFromFacts,
  type EvaluateSemanticCapabilityInput,
  type SemanticCapabilityState,
} from "../../src/search/semanticCapability";

/**
 * Evaluates the capability from plain facts when a test has no lifecycle snapshot
 * (the production fallback that synthesised one no longer exists — LINA-15D-B / S6).
 */
export function evaluateCapabilityFromLegacyFacts(input: EvaluateSemanticCapabilityInput): SemanticCapabilityState {
  if (input.lifecycleSnapshot) {
    return evaluateSemanticCapability({ ...input, lifecycleSnapshot: input.lifecycleSnapshot });
  }
  const available = input.semanticCompatibility?.available === true;
  const compatible = input.vectorContractState === "compatible" || available;
  const canonicalExists = (input.embeddingsDeclaredInManifest ?? false) && input.semanticCompatibility?.reasonCode !== "missing";
  return evaluateSemanticCapabilityFromFacts({
    textIndexAvailable: input.textIndexAvailable ?? true,
    contractState: input.vectorContractState ?? (canonicalExists ? "compatible" : "none"),
    canonicalExists,
    hasValidForSearchEvidence: compatible,
    hasPublishedIdentity: canonicalExists,
    isChecking: input.isChecking,
    providerReachable: input.providerReachable,
  });
}
