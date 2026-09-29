import { describe, expect, it } from "vitest";
import {
  evaluateSemanticCapability,
  evaluateSemanticCapabilityFromSnapshot,
} from "../../src/search/semanticCapability";
import { VectorContractV1 } from "../../src/index/vectorContract";
import { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import { CompanionArtifactConsumptionState } from "../../src/companion/companionConsumptionState";

describe("LINA-14C.4: Semantic Capability with EmbeddingLifecycleSnapshot", () => {
  const baseContract: VectorContractV1 = {
    schemaVersion: 1,
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    metric: "cosine",
    prefixMode: "nomic-search-query-document",
    inputVersion: 1,
    contractId: "vec:ollama:nomic-embed-text:768:1:nomic-search-query-document",
  };

  const makeRuntimeState = (overrides: Partial<DeviceRuntimeState> = {}): DeviceRuntimeState => ({
    deviceId: "device-1",
    deviceName: "Studio Mac",
    effectiveRole: "producer",
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isActiveProducer: true,
    isStandbyProducer: false,
    isCompanion: false,
    isUnassigned: false,
    canPublish: true,
    canTransferOwnership: false,
    transferEligibilityReason: "already-active-producer",
    embeddings: {
      configured: true,
      textIndexAvailable: true,
      embeddingsDeclared: true,
      exists: true,
      vectorFileState: "available",
      provenance: { stale: false },
      compatibility: { compatible: true },
      contractState: "compatible",
      readiness: { loaded: true, runtimeReady: true },
      runtimeState: "ready",
      semanticAvailable: true,
      effectiveMode: "full",
    },
    ...overrides,
  });

  it("1. Scenario READY: semanticAvailable is true and effectiveMode is full", () => {
    const runtime = makeRuntimeState();
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: runtime,
      vectorContract: baseContract,
      canonicalExists: true,
      validForSearchCount: 1,
      upstreamTextIndex: "ready",
    });

    expect(snapshot.primary).toBe("READY");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: snapshot,
    });

    expect(result.semanticAvailable).toBe(true);
    expect(result.effectiveMode).toBe("full");
    expect(result.contractState).toBe("compatible");
    expect(result.runtimeState).toBe("ready");
    expect(result.reasonCode).toBeUndefined();
    expect(result.artifactState.textIndex).toBe("available");
    expect(result.artifactState.vectorFile).toBe("available");
  });

  it("2. Scenario UPDATE_AVAILABLE: semanticAvailable is true because existing embeddings are valid for search", () => {
    const runtime = makeRuntimeState();
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: runtime,
      vectorContract: baseContract,
      canonicalExists: true,
      validForSearchCount: 1,
      upstreamTextIndex: "ready",
      updatePlan: {
        totalTargetChunks: 20,
        chunksToGenerate: [{
          chunkId: "c2",
          fileHash: "h2",
          chunkIndex: 0,
          chunkCount: 1,
          text: "content 2",
          path: "note2.md",
        }],
        staleToReplaceCount: 1,
        missingCount: 0,
        obsoleteChunkIds: [],
        reusableCanonicalRecords: 10,
        recoverableCheckpointRecords: 0,
        recordsToPublish: 11,
      },
    });

    expect(snapshot.primary).toBe("UPDATE_AVAILABLE");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: snapshot,
    });

    expect(result.semanticAvailable).toBe(true);
    expect(result.effectiveMode).toBe("full");
    expect(result.contractState).toBe("compatible");
    expect(result.runtimeState).toBe("ready");
    expect(result.reasonCode).toBeUndefined();
  });

  it("3. Scenario INDEX_ONLY: semanticAvailable is false and effectiveMode is text-only", () => {
    const runtime = makeRuntimeState({
      embeddings: {
        configured: true,
        textIndexAvailable: true,
        embeddingsDeclared: false,
        exists: false,
        vectorFileState: "missing",
        provenance: { stale: false },
        compatibility: { compatible: false },
        contractState: "none",
        readiness: { loaded: false, runtimeReady: false },
        runtimeState: "unavailable",
        semanticAvailable: false,
        effectiveMode: "text-only",
      },
    });

    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: runtime,
      vectorContract: null,
      canonicalExists: false,
      validForSearchCount: 0,
      upstreamTextIndex: "ready",
    });

    expect(snapshot.primary).toBe("INDEX_ONLY");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: snapshot,
    });

    expect(result.semanticAvailable).toBe(false);
    expect(result.effectiveMode).toBe("text-only");
    expect(result.contractState).toBe("none");
    expect(result.runtimeState).toBe("unavailable");
    expect(result.reasonCode).toBe("vector-file-missing");
    expect(result.artifactState.vectorFile).toBe("missing");
  });

  it("4. Scenario INCOMPATIBLE provider: semanticAvailable is false and reason indicates mismatch", () => {
    const runtime = makeRuntimeState({
      embeddings: {
        configured: true,
        textIndexAvailable: true,
        embeddingsDeclared: true,
        exists: true,
        vectorFileState: "available",
        provenance: { stale: false },
        compatibility: { compatible: false, provider: "openai", model: "text-embedding-3-small" },
        contractState: "mismatch",
        readiness: { loaded: false, runtimeReady: false },
        runtimeState: "unavailable",
        semanticAvailable: false,
        effectiveMode: "text-only",
      },
    });

    const differentProviderContract: VectorContractV1 = {
      ...baseContract,
      provider: "openai",
      contractId: "vec:openai:nomic-embed-text:768:1:nomic-search-query-document",
    };

    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: runtime,
      publishedIdentity: {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      },
      vectorContract: differentProviderContract,
      canonicalExists: true,
      validForSearchCount: 1,
      upstreamTextIndex: "ready",
    });

    expect(snapshot.primary).toBe("INCOMPATIBLE");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: snapshot,
    });

    expect(result.semanticAvailable).toBe(false);
    expect(result.effectiveMode).toBe("text-only");
    expect(result.contractState).toBe("mismatch");
    expect(result.runtimeState).toBe("unavailable");
    expect(result.reasonCode).toBe("model-incompatible");
  });

  it("5. Scenario INCOMPATIBLE model: semanticAvailable is false and reason indicates mismatch", () => {
    const runtime = makeRuntimeState({
      embeddings: {
        configured: true,
        textIndexAvailable: true,
        embeddingsDeclared: true,
        exists: true,
        vectorFileState: "available",
        provenance: { stale: false },
        compatibility: { compatible: false, provider: "ollama", model: "mxbai-embed-large" },
        contractState: "mismatch",
        readiness: { loaded: false, runtimeReady: false },
        runtimeState: "unavailable",
        semanticAvailable: false,
        effectiveMode: "text-only",
      },
    });

    const differentModelContract: VectorContractV1 = {
      ...baseContract,
      model: "mxbai-embed-large",
      contractId: "vec:ollama:mxbai-embed-large:768:1:nomic-search-query-document",
    };

    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: runtime,
      publishedIdentity: {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      },
      vectorContract: differentModelContract,
      canonicalExists: true,
      validForSearchCount: 1,
      upstreamTextIndex: "ready",
    });

    expect(snapshot.primary).toBe("INCOMPATIBLE");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: snapshot,
    });

    expect(result.semanticAvailable).toBe(false);
    expect(result.effectiveMode).toBe("text-only");
    expect(result.contractState).toBe("mismatch");
    expect(result.reasonCode).toBe("model-incompatible");
  });

  it("6. Scenario Companion: consumes artifacts without write obligations", () => {
    const companionRuntime = makeRuntimeState({
      deviceId: "device-companion-1",
      effectiveRole: "companion",
      isActiveProducer: false,
      isCompanion: true,
      canPublish: false,
      transferEligibilityReason: "companion-role",
    });

    const companionState: CompanionArtifactConsumptionState = {
      deviceId: "device-companion-1",
      deviceRole: "companion",
      activeProducerId: "device-producer-1",
      ownershipEpoch: 2,
      lastKnownProducerEpoch: 2,
      provenanceValidity: "authoritative",
      canConsume: true,
      consumptionMode: "full",
      provenanceReason: "Artefactos publicados pelo produtor ativo",
      artifactAvailability: {
        textIndex: "available",
        embeddings: "available",
        binaryCopy: "none",
      },
      vectorContract: baseContract,
      vectorContractCompatibility: {
        status: "compatible",
        reason: "Contract match",
      },
      embeddingState: {
        exists: true,
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
      },
    };

    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: companionRuntime,
      companionState,
      vectorContract: baseContract,
      canonicalExists: true,
      validForSearchCount: 1,
      upstreamTextIndex: "ready",
    });

    expect(snapshot.primary).toBe("READY");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: snapshot,
    });

    expect(result.semanticAvailable).toBe(true);
    expect(result.effectiveMode).toBe("full");
    expect(result.contractState).toBe("compatible");
  });

  it("7. Scenario Standby Producer: operational search evaluation without assuming active producer duties", () => {
    const standbyRuntime = makeRuntimeState({
      deviceId: "device-standby-1",
      effectiveRole: "producer",
      isActiveProducer: false,
      isStandbyProducer: true,
      canPublish: false,
      transferEligibilityReason: "ready",
    });

    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: standbyRuntime,
      vectorContract: baseContract,
      canonicalExists: true,
      validForSearchCount: 1,
      upstreamTextIndex: "ready",
    });

    expect(snapshot.primary).toBe("STANDBY");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: snapshot,
    });

    expect(result.semanticAvailable).toBe(true);
    expect(result.effectiveMode).toBe("full");
    expect(result.contractState).toBe("compatible");
  });

  it("8. Scenario ERROR: semanticAvailable is false and error reason is preserved", () => {
    const runtime = makeRuntimeState();
    const errorSnapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: runtime,
      operationState: {
        status: "failed",
        phase: "idle",
        progress: null,
        error: "Ollama connection timed out during embedding execution",
      },
      vectorContract: baseContract,
      canonicalExists: true,
      validForSearchCount: 0,
      upstreamTextIndex: "ready",
    });

    expect(errorSnapshot.primary).toBe("ERROR");

    const result = evaluateSemanticCapability({
      lifecycleSnapshot: errorSnapshot,
    });

    expect(result.semanticAvailable).toBe(false);
    expect(result.effectiveMode).toBe("text-only");
    expect(result.runtimeState).toBe("unavailable");
    expect(result.reason).toContain("Ollama connection timed out");
  });

  it("9. Scenario Fallback without snapshot: gracefully evaluates legacy inputs", () => {
    const legacyCompatible = evaluateSemanticCapability({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      vectorContractState: "compatible",
      semanticCompatibility: {
        available: true,
        indexProvider: "ollama",
        indexModel: "nomic-embed-text",
      },
      providerReachable: true,
      isChecking: false,
    });

    expect(legacyCompatible.semanticAvailable).toBe(true);
    expect(legacyCompatible.effectiveMode).toBe("full");
    expect(legacyCompatible.contractState).toBe("compatible");
    expect(legacyCompatible.runtimeState).toBe("ready");

    const legacyMismatch = evaluateSemanticCapability({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      vectorContractState: "mismatch",
      semanticCompatibility: {
        available: false,
        reasonCode: "incompatible",
        reason: "Contrato vetorial incompatível com o dispositivo.",
      },
      providerReachable: true,
      isChecking: false,
    });

    expect(legacyMismatch.semanticAvailable).toBe(false);
    expect(legacyMismatch.effectiveMode).toBe("text-only");
    expect(legacyMismatch.contractState).toBe("mismatch");
    expect(legacyMismatch.reasonCode).toBe("model-incompatible");
  });

  it("Direct evaluateSemanticCapabilityFromSnapshot invocation parity", () => {
    const runtime = makeRuntimeState();
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      deviceRuntimeState: runtime,
      vectorContract: baseContract,
      canonicalExists: true,
      validForSearchCount: 1,
      upstreamTextIndex: "ready",
    });

    const fromDirect = evaluateSemanticCapabilityFromSnapshot(snapshot);
    const fromInput = evaluateSemanticCapability({ lifecycleSnapshot: snapshot });

    expect(fromDirect).toEqual(fromInput);
  });
});
