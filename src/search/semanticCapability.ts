/**
 * Shared Semantic Capability Evaluation Foundation (Phase LINA-03-FIX-STATE-DIVERGENCE-001)
 *
 * Provides a canonical, pure evaluation uniting operational semantic search availability,
 * declared artifact states, and vector contract readiness.
 *
 * Consumed symmetrically by Sidebar search status and Device Diagnostics to eliminate
 * state divergence between UI surfaces.
 */

import { type SemanticCompatibility } from "./hybridSearch";

export type SemanticOperationalReasonCode =
  | "vector-file-missing"
  | "vector-file-empty"
  | "no-contract"
  | "model-incompatible"
  | "provider-unreachable"
  | "runtime-checking"
  | "missing"
  | "empty"
  | "incompatible"
  | "binary-required"
  | "binary-stale"
  | "binary-invalid"
  | "corpus-load-failed";

export interface SemanticCapabilityState {
  readonly artifactState: {
    readonly textIndex: "available" | "missing" | "invalid";
    readonly embeddingsDeclared: boolean;
    readonly vectorFile: "available" | "missing" | "empty" | "invalid";
  };
  readonly contractState: "compatible" | "mismatch" | "none";
  readonly runtimeState: "ready" | "checking" | "unavailable";
  readonly semanticAvailable: boolean;
  readonly effectiveMode: "full" | "text-only" | "unavailable";
  readonly reasonCode?: SemanticOperationalReasonCode;
  readonly reason?: string;
}

export interface EvaluateSemanticCapabilityInput {
  readonly textIndexAvailable: boolean;
  readonly embeddingsDeclaredInManifest?: boolean;
  readonly vectorContractState?: "compatible" | "mismatch" | "none";
  readonly semanticCompatibility?: SemanticCompatibility;
  readonly isChecking?: boolean;
  readonly providerReachable?: boolean;
}

export function evaluateSemanticCapability(
  input: EvaluateSemanticCapabilityInput
): SemanticCapabilityState {
  const {
    textIndexAvailable,
    embeddingsDeclaredInManifest = false,
    vectorContractState = "compatible",
    semanticCompatibility,
    isChecking = false,
    providerReachable = true,
  } = input;

  // Determine vector file state from semanticCompatibility or manifest
  let vectorFile: "available" | "missing" | "empty" | "invalid" = "available";
  if (!embeddingsDeclaredInManifest && !semanticCompatibility?.available) {
    vectorFile = "missing";
  } else if (semanticCompatibility?.reasonCode === "missing") {
    vectorFile = "missing";
  } else if (semanticCompatibility?.reasonCode === "empty") {
    vectorFile = "empty";
  } else if (
    semanticCompatibility?.reasonCode === "binary-invalid" ||
    semanticCompatibility?.reasonCode === "corpus-load-failed"
  ) {
    vectorFile = "invalid";
  }

  // Evaluate runtimeState
  let runtimeState: "ready" | "checking" | "unavailable" = "ready";
  if (isChecking) {
    runtimeState = "checking";
  } else if (!providerReachable || !semanticCompatibility?.available) {
    runtimeState = "unavailable";
  }

  // Determine reason code and reason
  let reasonCode: SemanticOperationalReasonCode | undefined;
  let reason: string | undefined;

  let semanticAvailable = false;

  if (isChecking) {
    reasonCode = "runtime-checking";
    reason = "A verificar disponibilidade semântica...";
    semanticAvailable = false;
  } else if (!providerReachable) {
    reasonCode = "provider-unreachable";
    reason = "Fornecedor de embeddings inacessível ou endpoint indisponível.";
    semanticAvailable = false;
  } else if (vectorContractState === "mismatch") {
    reasonCode = "model-incompatible";
    reason = "Contrato vetorial incompatível com o dispositivo.";
    semanticAvailable = false;
  } else if (semanticCompatibility) {
    semanticAvailable = semanticCompatibility.available && providerReachable && !isChecking;
    if (!semanticAvailable) {
      if (semanticCompatibility.reasonCode === "missing") {
        reasonCode = "vector-file-missing";
      } else if (semanticCompatibility.reasonCode === "empty") {
        reasonCode = "vector-file-empty";
      } else if (semanticCompatibility.reasonCode === "incompatible") {
        reasonCode = "model-incompatible";
      }
      reason = semanticCompatibility.reason;
    }
  } else if (vectorContractState === "none" && !embeddingsDeclaredInManifest) {
    reasonCode = "no-contract";
    reason = "Nenhum contrato vetorial ou embeddings publicados no vault.";
    semanticAvailable = false;
  } else if (embeddingsDeclaredInManifest) {
    // Declared in manifest but operational check not passed
    reasonCode = "vector-file-missing";
    reason = "Embeddings declarados no manifesto mas indisponíveis operacionalmente.";
    semanticAvailable = false;
  } else {
    reasonCode = "vector-file-missing";
    reason = "Embeddings não encontrados.";
    semanticAvailable = false;
  }

  // Calculate effective search mode
  let effectiveMode: "full" | "text-only" | "unavailable";
  if (!textIndexAvailable) {
    effectiveMode = "unavailable";
  } else if (semanticAvailable) {
    effectiveMode = "full";
  } else {
    effectiveMode = "text-only";
  }

  return {
    artifactState: {
      textIndex: textIndexAvailable ? "available" : "missing",
      embeddingsDeclared: embeddingsDeclaredInManifest,
      vectorFile,
    },
    contractState: vectorContractState,
    runtimeState,
    semanticAvailable,
    effectiveMode,
    reasonCode,
    reason,
  };
}
