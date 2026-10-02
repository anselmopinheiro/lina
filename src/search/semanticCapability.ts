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
  readonly lifecycleSnapshot?: EmbeddingLifecycleSnapshot;
}

export function evaluateSemanticCapabilityFromSnapshot(
  snapshot: EmbeddingLifecycleSnapshot,
  overrides?: Partial<EvaluateSemanticCapabilityInput>
): SemanticCapabilityState {
  const isChecking = overrides?.isChecking ?? (snapshot.primary === "VERIFYING" || snapshot.process.phase === "checking");
  const textIndexAvailable = overrides?.textIndexAvailable ?? (snapshot.primary !== "NO_TEXT_INDEX");

  // Contract state
  let contractState: "compatible" | "mismatch" | "none" = "none";
  if (overrides?.vectorContractState) {
    contractState = overrides.vectorContractState;
  } else if (snapshot.read.compatibility.status === "compatible") {
    contractState = "compatible";
  } else if (snapshot.read.compatibility.status === "incompatible") {
    contractState = "mismatch";
  } else if (snapshot.read.compatibility.status === "none") {
    contractState = "none";
  }

  // Vector file & embeddingsDeclared
  let vectorFile: "available" | "missing" | "empty" | "invalid" = "available";
  const embeddingsDeclared = snapshot.read.source !== "none" ||
    snapshot.primary === "READY" ||
    snapshot.primary === "UPDATE_AVAILABLE" ||
    snapshot.primary === "INCOMPATIBLE" ||
    Boolean(overrides?.embeddingsDeclaredInManifest);

  if (snapshot.primary === "INDEX_ONLY" || snapshot.primary === "NO_TEXT_INDEX" || (snapshot.read.source === "none" && snapshot.primary !== "INCOMPATIBLE")) {
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
  const semanticAvailable = (contractState === "mismatch" ? false : snapshot.read.semanticAvailable) && providerReachable && !isChecking;

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
      reason = "Contrato vetorial incompatível com o dispositivo.";
    } else if (
      snapshot.primary === "INDEX_ONLY" ||
      snapshot.read.reasonCode === "vector-file-missing" ||
      snapshot.read.reasonCode === "missing"
    ) {
      reasonCode = "vector-file-missing";
      reason = "Embeddings não encontrados.";
    } else if (snapshot.read.reasonCode === "no-contract" || snapshot.read.compatibility.status === "none") {
      reasonCode = "no-contract";
      reason = "Nenhum contrato vetorial ou embeddings publicados no vault.";
    } else if (snapshot.read.reasonCode === "vector-file-empty" || snapshot.read.reasonCode === "empty") {
      reasonCode = "vector-file-empty";
      reason = "Ficheiro de embeddings vazio.";
    } else if (snapshot.read.reasonCode === "binary-invalid") {
      reasonCode = "binary-invalid";
      reason = "Cópia binária de embeddings inválida.";
    } else if (snapshot.read.reasonCode === "corpus-load-failed") {
      reasonCode = "corpus-load-failed";
      reason = "Falha ao carregar corpus de embeddings.";
    } else if (snapshot.primary === "ERROR" || snapshot.history.lastFailure?.message) {
      reasonCode = (snapshot.read.reasonCode as SemanticOperationalReasonCode) ?? "corpus-load-failed";
      reason = snapshot.history.lastFailure?.message ?? "Erro operacional nos embeddings.";
    } else if (mismatchReason) {
      reasonCode = "model-incompatible";
      reason = "Contrato vetorial incompatível com o dispositivo.";
    } else {
      reasonCode = "vector-file-missing";
      reason = "Embeddings não encontrados.";
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

/**
 * Plain facts a device can establish without an `EmbeddingLifecycleSnapshot`
 * (manifest declarations, semantic availability probe, companion contract).
 * Nothing here is an identity: only whether an identity/evidence exists (LINA-15D-B / S3).
 */
export interface SemanticCapabilityFacts {
  readonly textIndexAvailable: boolean;
  readonly contractState: "compatible" | "mismatch" | "none";
  /** A canonical embeddings publication is declared or evidenced. */
  readonly canonicalExists: boolean;
  /** There is evidence of at least one vector valid for search. */
  readonly hasValidForSearchEvidence: boolean;
  /** A published identity (provider + model) is known from a real source. */
  readonly hasPublishedIdentity: boolean;
  readonly isChecking?: boolean;
  readonly providerReachable?: boolean;
}

/**
 * Semantic capability from plain facts, for callers that do not hold a lifecycle snapshot
 * (the device runtime state). Same output contract as `evaluateSemanticCapabilityFromSnapshot`.
 */
export function evaluateSemanticCapabilityFromFacts(facts: SemanticCapabilityFacts): SemanticCapabilityState {
  const isChecking = facts.isChecking === true;
  const providerReachable = facts.providerReachable ?? true;
  const readable = facts.canonicalExists && facts.hasValidForSearchEvidence && facts.hasPublishedIdentity;
  const semanticAvailable = (facts.contractState === "mismatch" ? false : readable) && providerReachable && !isChecking;
  // Declared-but-unreadable vectors are not "missing": only no index/declaration, or a known identity without valid vectors.
  const indexOnly = facts.textIndexAvailable
    && (!facts.canonicalExists || (facts.hasPublishedIdentity && !facts.hasValidForSearchEvidence));
  const vectorFileMissing = !isChecking && (!facts.textIndexAvailable || !facts.canonicalExists || indexOnly);

  const runtimeState: SemanticCapabilityState["runtimeState"] = isChecking
    ? "checking"
    : readable && providerReachable ? "ready" : "unavailable";
  const effectiveMode: SemanticCapabilityState["effectiveMode"] = !facts.textIndexAvailable
    ? "unavailable"
    : semanticAvailable ? "full" : "text-only";

  let reasonCode: SemanticOperationalReasonCode | undefined;
  let reason: string | undefined;
  if (isChecking) {
    reasonCode = "runtime-checking";
    reason = "A verificar disponibilidade semântica...";
  } else if (!providerReachable) {
    reasonCode = "provider-unreachable";
    reason = "Fornecedor de embeddings inacessível ou endpoint indisponível.";
  } else if (!semanticAvailable) {
    if (facts.contractState === "mismatch") {
      reasonCode = "model-incompatible";
      reason = "Contrato vetorial incompatível com o dispositivo.";
    } else if (indexOnly) {
      reasonCode = "vector-file-missing";
      reason = "Embeddings não encontrados.";
    } else if (!facts.hasPublishedIdentity) {
      reasonCode = "no-contract";
      reason = "Nenhum contrato vetorial ou embeddings publicados no vault.";
    } else {
      reasonCode = "vector-file-missing";
      reason = "Embeddings não encontrados.";
    }
  }

  return {
    artifactState: {
      textIndex: facts.textIndexAvailable ? "available" : "missing",
      embeddingsDeclared: true,
      vectorFile: vectorFileMissing ? "missing" : "available",
    },
    contractState: facts.contractState,
    runtimeState,
    semanticAvailable,
    effectiveMode,
    reasonCode,
    reason,
  };
}

export function evaluateSemanticCapability(
  input: EvaluateSemanticCapabilityInput & { readonly lifecycleSnapshot: EmbeddingLifecycleSnapshot }
): SemanticCapabilityState {
  return evaluateSemanticCapabilityFromSnapshot(input.lifecycleSnapshot, input);
}
