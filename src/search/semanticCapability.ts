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
import { type EmbeddingLifecycleSnapshot } from "../index/embeddingLifecycleModel";

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
  readonly textIndexAvailable?: boolean;
  readonly embeddingsDeclaredInManifest?: boolean;
  readonly vectorContractState?: "compatible" | "mismatch" | "none";
  readonly semanticCompatibility?: SemanticCompatibility;
  readonly isChecking?: boolean;
  readonly providerReachable?: boolean;
  readonly lifecycleSnapshot?: EmbeddingLifecycleSnapshot | null;
}

export function evaluateSemanticCapabilityFromSnapshot(
  snapshot: EmbeddingLifecycleSnapshot,
  overrides?: Partial<EvaluateSemanticCapabilityInput>
): SemanticCapabilityState {
  const isChecking = overrides?.isChecking ?? (snapshot.primary === "VERIFYING" || snapshot.process.phase === "checking");
  const textIndexAvailable = overrides?.textIndexAvailable ?? (snapshot.primary !== "NO_TEXT_INDEX");

  // Contract state
  let contractState: "compatible" | "mismatch" | "none" = "none";
  if (snapshot.read.compatibility.status === "compatible") {
    contractState = "compatible";
  } else if (snapshot.read.compatibility.status === "incompatible") {
    contractState = "mismatch";
  } else if (snapshot.read.compatibility.status === "none") {
    contractState = "none";
  } else if (overrides?.vectorContractState) {
    contractState = overrides.vectorContractState;
  }

  // Vector file & embeddingsDeclared
  let vectorFile: "available" | "missing" | "empty" | "invalid" = "available";
  const embeddingsDeclared = snapshot.read.source !== "none" ||
    snapshot.primary === "READY" ||
    snapshot.primary === "UPDATE_AVAILABLE" ||
    snapshot.primary === "INCOMPATIBLE" ||
    Boolean(overrides?.embeddingsDeclaredInManifest);

  if (snapshot.primary === "INDEX_ONLY" || snapshot.primary === "NO_TEXT_INDEX" || snapshot.read.source === "none") {
    vectorFile = "missing";
  } else if (snapshot.read.reasonCode === "empty" || snapshot.read.reasonCode === "vector-file-empty") {
    vectorFile = "empty";
  } else if (
    snapshot.read.reasonCode === "binary-invalid" ||
    snapshot.read.reasonCode === "corpus-load-failed" ||
    snapshot.primary === "ERROR"
  ) {
    vectorFile = "invalid";
  }

  // Runtime state
  let runtimeState: "ready" | "checking" | "unavailable" = "ready";
  if (isChecking) {
    runtimeState = "checking";
  } else if (snapshot.read.semanticAvailable && (overrides?.providerReachable ?? true)) {
    runtimeState = "ready";
  } else {
    runtimeState = "unavailable";
  }

  // Semantic availability
  const providerReachable = overrides?.providerReachable ?? true;
  const semanticAvailable = snapshot.read.semanticAvailable && providerReachable && !isChecking;

  // Effective search mode
  let effectiveMode: "full" | "text-only" | "unavailable" = snapshot.read.effectiveMode;
  if (!textIndexAvailable) {
    effectiveMode = "unavailable";
  } else if (semanticAvailable) {
    effectiveMode = "full";
  } else {
    effectiveMode = "text-only";
  }

  // Reason code & reason
  let reasonCode: SemanticOperationalReasonCode | undefined;
  let reason: string | undefined;

  if (isChecking) {
    reasonCode = "runtime-checking";
    reason = "A verificar disponibilidade semântica...";
  } else if (!providerReachable) {
    reasonCode = "provider-unreachable";
    reason = "Fornecedor de embeddings inacessível ou endpoint indisponível.";
  } else if (!semanticAvailable) {
    const mismatchReason = snapshot.read.compatibility.reasons[0];
    if (snapshot.read.compatibility.status === "incompatible" || contractState === "mismatch") {
      reasonCode = "model-incompatible";
      reason = snapshot.write.reason ?? "Contrato vetorial incompatível com o dispositivo.";
    } else if (
      snapshot.primary === "INDEX_ONLY" ||
      snapshot.read.reasonCode === "vector-file-missing" ||
      snapshot.read.reasonCode === "missing"
    ) {
      reasonCode = "vector-file-missing";
      reason = snapshot.write.reason ?? "Embeddings não encontrados.";
    } else if (snapshot.read.reasonCode === "no-contract" || snapshot.read.compatibility.status === "none") {
      reasonCode = "no-contract";
      reason = snapshot.write.reason ?? "Nenhum contrato vetorial ou embeddings publicados no vault.";
    } else if (snapshot.read.reasonCode === "vector-file-empty" || snapshot.read.reasonCode === "empty") {
      reasonCode = "vector-file-empty";
      reason = snapshot.write.reason ?? "Ficheiro de embeddings vazio.";
    } else if (snapshot.read.reasonCode === "binary-invalid") {
      reasonCode = "binary-invalid";
      reason = snapshot.write.reason ?? "Cópia binária de embeddings inválida.";
    } else if (snapshot.read.reasonCode === "corpus-load-failed") {
      reasonCode = "corpus-load-failed";
      reason = snapshot.write.reason ?? "Falha ao carregar corpus de embeddings.";
    } else if (snapshot.primary === "ERROR" || snapshot.history.lastFailure?.message) {
      reasonCode = (snapshot.read.reasonCode as SemanticOperationalReasonCode) ?? "corpus-load-failed";
      reason = snapshot.history.lastFailure?.message ?? snapshot.write.reason ?? "Erro operacional nos embeddings.";
    } else if (mismatchReason) {
      reasonCode = "model-incompatible";
      reason = snapshot.write.reason ?? "Contrato vetorial incompatível com o dispositivo.";
    } else {
      reasonCode = "vector-file-missing";
      reason = snapshot.write.reason ?? "Embeddings não encontrados.";
    }
  }

  return {
    artifactState: {
      textIndex: textIndexAvailable ? "available" : "missing",
      embeddingsDeclared,
      vectorFile,
    },
    contractState,
    runtimeState,
    semanticAvailable,
    effectiveMode,
    reasonCode,
    reason,
  };
}

export function evaluateSemanticCapability(
  input: EvaluateSemanticCapabilityInput
): SemanticCapabilityState {
  if (input.lifecycleSnapshot) {
    return evaluateSemanticCapabilityFromSnapshot(input.lifecycleSnapshot, input);
  }

  const {
    textIndexAvailable = true,
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
