import { describe, expect, it } from "vitest";
import {
  compareEmbeddingIdentity,
  classifyEmbeddingWork,
  resolveEmbeddingLifecycle,
  validateLifecycleInvariants,
  EmbeddingIdentitySummary,
  EmbeddingWorkAssessment,
} from "../../src/index/embeddingLifecycleModel";

describe("LINA-14A: Pure Embedding Lifecycle Model", () => {
  const baseIdentity: EmbeddingIdentitySummary = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "nomic-search-query-document",
    contractId: "vec:ollama:nomic-embed-text:768:1:nomic-search-query-document",
  };

  describe("1. Identity Comparison (compareEmbeddingIdentity)", () => {
    it("returns compatible when contractId matches exactly", () => {
      const pub: EmbeddingIdentitySummary = { contractId: "vec:custom-contract-123" };
      const target: EmbeddingIdentitySummary = { contractId: "vec:custom-contract-123" };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it("returns compatible when all individual fields match (case-insensitive provider)", () => {
      const pub: EmbeddingIdentitySummary = {
        provider: "Ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      };
      const target: EmbeddingIdentitySummary = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it("identifies provider mismatch", () => {
      const pub = { ...baseIdentity, provider: "ollama" };
      const target = { ...baseIdentity, provider: "mistral", contractId: undefined };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("provider-mismatch");
    });

    it("identifies model mismatch", () => {
      const pub = { ...baseIdentity, model: "nomic-embed-text" };
      const target = { ...baseIdentity, model: "bge-m3", contractId: undefined };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("model-mismatch");
    });

    it("identifies dimensions mismatch", () => {
      const pub = { ...baseIdentity, dimensions: 768 };
      const target = { ...baseIdentity, dimensions: 1024, contractId: undefined };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("dimensions-mismatch");
    });

    it("identifies inputVersion mismatch", () => {
      const pub = { ...baseIdentity, inputVersion: 1 };
      const target = { ...baseIdentity, inputVersion: 2, contractId: undefined };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("input-version-mismatch");
    });

    it("identifies prefixMode mismatch", () => {
      const pub = { ...baseIdentity, prefixMode: "none" };
      const target = { ...baseIdentity, prefixMode: "nomic-search-query-document", contractId: undefined };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("prefix-mode-mismatch");
    });

    it("identifies incomplete identity when fields are missing or invalid", () => {
      const pub: EmbeddingIdentitySummary = { provider: "ollama" };
      const target = { ...baseIdentity, contractId: undefined };

      const result = compareEmbeddingIdentity(pub, target);
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("incomplete-identity");
    });

    it("handles null or undefined inputs gracefully", () => {
      expect(compareEmbeddingIdentity(null, null).compatible).toBe(false);
      expect(compareEmbeddingIdentity(baseIdentity, undefined).compatible).toBe(false);
      expect(compareEmbeddingIdentity(undefined, baseIdentity).compatible).toBe(false);
    });
  });

  describe("2. Work Classification (classifyEmbeddingWork)", () => {
    it("classifies initial-build when canonical index is missing and chunks exist", () => {
      const assessment = classifyEmbeddingWork({
        canonicalExists: false,
        totalChunks: 50,
      });

      expect(assessment.kind).toBe("pending");
      expect(assessment.mode).toBe("initial-build");
      expect(assessment.updateRequired).toBe(true);
      expect(assessment.severity).toBe("action");
    });

    it("classifies no work when canonical index is missing and totalChunks is 0", () => {
      const assessment = classifyEmbeddingWork({
        canonicalExists: false,
        totalChunks: 0,
      });

      expect(assessment.kind).toBe("none");
      expect(assessment.updateRequired).toBe(false);
      expect(assessment.severity).toBe("none");
    });

    it("classifies indeterminate when canonical index is unreadable", () => {
      const assessment = classifyEmbeddingWork({
        canonicalExists: true,
        canonicalReadability: "unreadable",
        totalChunks: 50,
      });

      expect(assessment.kind).toBe("indeterminate");
      expect(assessment.updateRequired).toBe(false);
      expect(assessment.severity).toBe("none");
    });

    it("classifies full-rebuild when published identity is incompatible with target identity", () => {
      const published = { ...baseIdentity, model: "old-model" };
      const target = { ...baseIdentity, model: "new-model", contractId: undefined };

      const assessment = classifyEmbeddingWork({
        canonicalExists: true,
        totalChunks: 50,
        publishedIdentity: published,
        targetIdentity: target,
      });

      expect(assessment.kind).toBe("pending");
      expect(assessment.mode).toBe("full-rebuild");
      expect(assessment.updateRequired).toBe(true);
      expect(assessment.severity).toBe("blocking");
    });

    it("classifies incremental when chunks need generation", () => {
      const assessment = classifyEmbeddingWork({
        canonicalExists: true,
        publishedIdentity: baseIdentity,
        targetIdentity: baseIdentity,
        totalChunks: 50,
        toGenerateCount: 5,
        missingCount: 3,
        staleToReplaceCount: 2,
      });

      expect(assessment.kind).toBe("pending");
      expect(assessment.mode).toBe("incremental");
      expect(assessment.updateRequired).toBe(true);
      expect(assessment.severity).toBe("action");
    });

    it("classifies publish-only when only obsolete chunks or cleanups need publication (cost is none)", () => {
      const assessment = classifyEmbeddingWork({
        canonicalExists: true,
        publishedIdentity: baseIdentity,
        targetIdentity: baseIdentity,
        totalChunks: 40,
        toGenerateCount: 0,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 10,
        requiresPublication: true,
      });

      expect(assessment.kind).toBe("pending");
      expect(assessment.mode).toBe("publish-only");
      expect(assessment.updateRequired).toBe(true);
      expect(assessment.severity).toBe("info");
      expect(assessment.cost).toBe("none");
    });

    it("classifies none (up-to-date) when all chunks are valid and no publication is needed", () => {
      const assessment = classifyEmbeddingWork({
        canonicalExists: true,
        publishedIdentity: baseIdentity,
        targetIdentity: baseIdentity,
        totalChunks: 50,
        validForSearchCount: 50,
        reusableCanonicalCount: 50,
        toGenerateCount: 0,
        staleToReplaceCount: 0,
        missingCount: 0,
        obsoleteToDropCount: 0,
        requiresPublication: false,
      });

      expect(assessment.kind).toBe("none");
      expect(assessment.updateRequired).toBe(false);
      expect(assessment.severity).toBe("none");
      expect(assessment.cost).toBe("none");
    });
  });

  describe("3. Lifecycle State Resolution across 12 Primary States", () => {
    const baseInput = {
      revision: 1,
      deviceRole: "producer" as const,
      isActiveProducer: true,
      embeddingsEnabled: true,
      upstreamTextIndex: "ready" as const,
      publishedIdentity: baseIdentity,
      deviceIdentity: baseIdentity,
      targetIdentity: baseIdentity,
      canonicalExists: true,
      validForSearchCount: 50,
      activeSource: "jsonl" as const,
    };

    it("resolves NO_TEXT_INDEX when text index is missing or invalid", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        upstreamTextIndex: "missing",
      });

      expect(snapshot.primary).toBe("NO_TEXT_INDEX");
      expect(snapshot.read.effectiveMode).toBe("unavailable");
      expect(snapshot.capability.blockedReason).toBe("text-index-not-ready");
      expect(snapshot.capability.canRequestUpdate).toBe(false);
    });

    it("resolves DISABLED when embeddings are disabled", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        embeddingsEnabled: false,
      });

      expect(snapshot.primary).toBe("DISABLED");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("embeddings-disabled");
    });

    it("resolves INDEX_ONLY when text index is ready but no embeddings exist", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        canonicalExists: false,
        validForSearchCount: 0,
      });

      expect(snapshot.primary).toBe("INDEX_ONLY");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.effectiveMode).toBe("text-only");
    });

    it("resolves VERIFYING when facts checking is active", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        factsChecking: true,
      });

      expect(snapshot.primary).toBe("VERIFYING");
      expect(snapshot.process.phase).toBe("checking");
    });

    it("resolves READY when embeddings are valid and no work is required", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        workAssessment: {
          kind: "none",
          updateRequired: false,
          severity: "none",
          cost: "none",
          reasons: ["up-to-date"],
        },
      });

      expect(snapshot.primary).toBe("READY");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.write.updateRequired).toBe(false);
      expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
    });

    it("resolves UPDATE_AVAILABLE when embeddings are valid but work is pending", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "action",
          cost: "local",
          reasons: ["chunks-need-generation"],
        },
      });

      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.write.updateRequired).toBe(true);
      expect(snapshot.capability.canRequestUpdate).toBe(true);
      expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
    });

    it("resolves INCOMPATIBLE when published identity does not match device contract (Zero Silent Fallback)", () => {
      const incompatibleDevice = { ...baseIdentity, model: "other-model", contractId: undefined };
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        deviceIdentity: incompatibleDevice,
      });

      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.read.semanticAvailable).toBe(false);
      expect(snapshot.read.effectiveMode).toBe("text-only");
      expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
    });

    it("resolves INDETERMINATE when work assessment is indeterminate", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        workAssessment: {
          kind: "indeterminate",
          updateRequired: false,
          severity: "none",
          cost: "none",
          reasons: ["canonical-unreadable"],
        },
      });

      expect(snapshot.primary).toBe("INDETERMINATE");
      expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
    });

    it("resolves UPDATING during active operation phases", () => {
      const phases = ["preparing", "generating", "persisting", "finalizing"] as const;

      for (const phase of phases) {
        const snapshot = resolveEmbeddingLifecycle({
          ...baseInput,
          operationState: {
            status: "running",
            phase,
            processedChunks: 10,
            totalChunks: 50,
          },
        });

        expect(snapshot.primary).toBe("UPDATING");
        expect(snapshot.process.phase).toBe(phase);
        expect(snapshot.process.progress?.processed).toBe(10);
        expect(snapshot.capability.canRequestUpdate).toBe(false);
        expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
      }
    });

    it("resolves CANCELLING when operation is in cancelling phase", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        operationState: {
          status: "cancelling",
        },
      });

      expect(snapshot.primary).toBe("CANCELLING");
      expect(snapshot.process.phase).toBe("cancelling");
      expect(snapshot.process.cancellable).toBe(false);
    });

    it("resolves ERROR when operation failed", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        operationState: {
          status: "failed",
          error: "Network timeout connecting to Ollama",
        },
      });

      expect(snapshot.primary).toBe("ERROR");
      expect(snapshot.history.lastOperation?.kind).toBe("failed");
    });

    it("resolves STANDBY when device is a standby producer without active ownership", () => {
      const snapshot = resolveEmbeddingLifecycle({
        ...baseInput,
        deviceRole: "producer",
        isActiveProducer: false,
      });

      expect(snapshot.primary).toBe("STANDBY");
      expect(snapshot.write.applicable).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("standby");
      expect(snapshot.capability.canRequestUpdate).toBe(false);
    });
  });

  describe("4. Companion Role Isolation (C1 resolution)", () => {
    it("ensures Companion role cannot write, has write.applicable=false, and cannot request updates", () => {
      const companionInput = {
        revision: 1,
        deviceRole: "companion" as const,
        isActiveProducer: false,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready" as const,
        publishedIdentity: baseIdentity,
        deviceIdentity: baseIdentity,
        canonicalExists: true,
        validForSearchCount: 50,
        activeSource: "jsonl" as const,
        workAssessment: {
          kind: "pending" as const,
          mode: "incremental" as const,
          updateRequired: true,
          severity: "action" as const,
          cost: "local" as const,
          reasons: ["chunks-need-generation"],
        },
      };

      const snapshot = resolveEmbeddingLifecycle(companionInput);

      expect(snapshot.write.applicable).toBe(false);
      expect(snapshot.write.updateRequired).toBe(false);
      expect(snapshot.capability.blockedReason).toBe("companion");
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(snapshot.read.semanticAvailable).toBe(true);
      expect(snapshot.read.effectiveMode).toBe("full");
      expect(snapshot.primary).toBe("READY");
      expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
    });
  });

  describe("5. Architectural Invariants Verification (I1 - I15)", () => {
    it("enforces I1: READY requires write.work=none and read.semanticAvailable=true", () => {
      const invalidSnapshot = resolveEmbeddingLifecycle({
        revision: 1,
        deviceRole: "producer",
        isActiveProducer: true,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        publishedIdentity: baseIdentity,
        deviceIdentity: baseIdentity,
        canonicalExists: false, // will violate semanticAvailable
        validForSearchCount: 0,
      });

      expect(invalidSnapshot.primary).not.toBe("READY");
    });

    it("enforces I7: persisting phase is the point of no return (cancellable = false)", () => {
      const snapshot = resolveEmbeddingLifecycle({
        revision: 1,
        deviceRole: "producer",
        isActiveProducer: true,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 50,
        operationState: {
          status: "running",
          phase: "persisting",
        },
      });

      expect(snapshot.process.phase).toBe("persisting");
      expect(snapshot.process.cancellable).toBe(false);
      expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
    });

    it("enforces I9: non-applicable write strictly blocks canRequestUpdate", () => {
      const snapshot = resolveEmbeddingLifecycle({
        revision: 1,
        deviceRole: "companion",
        isActiveProducer: false,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 50,
      });

      expect(snapshot.write.applicable).toBe(false);
      expect(snapshot.capability.canRequestUpdate).toBe(false);
      expect(validateLifecycleInvariants(snapshot).valid).toBe(true);
    });
  });
});
