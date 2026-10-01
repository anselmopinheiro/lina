import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import {
  calculateEmbeddingUpdatePlan,
  CalculateEmbeddingUpdatePlanInput,
} from "../../src/index/embeddingUpdatePlan";
import {
  classifyEmbeddingWork,
  resolveEmbeddingLifecycle,
  ClassifyEmbeddingWorkInput,
  ResolveEmbeddingLifecycleInput,
} from "../../src/index/embeddingLifecycleModel";
import {
  deriveEmbeddingWritePathDecision,
  evaluateOperationStartGate,
} from "../../src/index/embeddingLifecycleWritePath";
import {
  evaluateEmbeddingBridgeRead,
  DESKTOP_BRIDGE_READ_GUARD,
  MOBILE_BRIDGE_READ_GUARD,
} from "../../src/index/embeddingResourceGuard";
import { Chunk } from "../../src/index/chunker";

describe("LINA-15C: Large Canonical State Separation from Physical Corruption", () => {
  const dummyChunk: Chunk = {
    chunkId: "c1",
    path: "note.md",
    chunkIndex: 0,
    text: "dummy text",
    startOffset: 0,
    endOffset: 10,
    charCount: 10,
    textHash: "th1",
  };

  const targetIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none" as const,
  };

  const publishedIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none" as const,
  };

  const dummyBuildInput = (chunk: Chunk) => chunk.text;
  const dummyHashInput = (input: string) => `hash_${input}`;

  describe("1. Resource Guard Thresholds (Desktop vs Mobile)", () => {
    it("verifies Desktop threshold is ~53.33 MB", () => {
      const allowed50MB = evaluateEmbeddingBridgeRead(50 * 1024 * 1024, "desktop");
      expect(allowed50MB.allowed).toBe(true);

      const denied55MB = evaluateEmbeddingBridgeRead(55 * 1024 * 1024, "desktop");
      expect(denied55MB.allowed).toBe(false);
      expect(denied55MB.code).toBe("mobile-bridge-read-limit-exceeded");
    });

    it("verifies Mobile threshold is ~11.20 MB", () => {
      const allowed10MB = evaluateEmbeddingBridgeRead(10 * 1024 * 1024, "mobile");
      expect(allowed10MB.allowed).toBe(true);

      const denied12MB = evaluateEmbeddingBridgeRead(12 * 1024 * 1024, "mobile");
      expect(denied12MB.allowed).toBe(false);
      expect(denied12MB.code).toBe("mobile-bridge-read-limit-exceeded");
    });
  });

  describe("2. UpdatePlan Calculation for all Readability & Integrity Scenarios", () => {
    it("handles small readable canonical with compatible identity as incremental", () => {
      const plan = calculateEmbeddingUpdatePlan({
        chunks: [dummyChunk],
        canonicalRecords: [
          {
            chunkId: "c1",
            provider: "ollama",
            model: "nomic-embed-text",
            dimensions: 768,
            textHash: "th1",
            embeddingInputHash: dummyHashInput(dummyChunk.text),
            embedding: new Array(768).fill(0.1),
          },
        ],
        canonicalExists: true,
        canonicalReadability: "readable",
        publishedIdentity,
        targetIdentity,
        buildInput: dummyBuildInput,
        hashInput: dummyHashInput,
      });

      expect(plan.mode).toBe("incremental");
      expect(plan.reusableCanonicalCount).toBe(1);
      expect(plan.toGenerateCount).toBe(0);
      expect(plan.reasons).toContain("published-identity-compatible");
    });

    it("handles large canonical above resource limit as full-rebuild (NOT indeterminate)", () => {
      const plan = calculateEmbeddingUpdatePlan({
        chunks: [dummyChunk],
        canonicalRecords: [],
        canonicalExists: true,
        canonicalReadability: "resource-limit-exceeded",
        publishedIdentity,
        targetIdentity,
        buildInput: dummyBuildInput,
        hashInput: dummyHashInput,
      });

      expect(plan.mode).toBe("full-rebuild");
      expect(plan.reusableCanonicalCount).toBe(0);
      expect(plan.toGenerateCount).toBe(1);
      expect(plan.reasons).toContain("canonical-resource-limit-exceeded");
    });

    it("handles physically unreadable / corrupted canonical as indeterminate (fail-closed)", () => {
      const plan = calculateEmbeddingUpdatePlan({
        chunks: [dummyChunk],
        canonicalRecords: [],
        canonicalExists: true,
        canonicalReadability: "unreadable",
        publishedIdentity,
        targetIdentity,
        buildInput: dummyBuildInput,
        hashInput: dummyHashInput,
      });

      expect(plan.mode).toBe("indeterminate");
      expect(plan.reusableCanonicalCount).toBe(0);
      expect(plan.toGenerateCount).toBe(0);
      expect(plan.reasons).toContain("canonical-unreadable");
    });

    it("handles missing canonical as initial-build", () => {
      const plan = calculateEmbeddingUpdatePlan({
        chunks: [dummyChunk],
        canonicalRecords: [],
        canonicalExists: false,
        canonicalReadability: "missing",
        publishedIdentity: {},
        targetIdentity,
        buildInput: dummyBuildInput,
        hashInput: dummyHashInput,
      });

      expect(plan.mode).toBe("initial-build");
      expect(plan.reusableCanonicalCount).toBe(0);
      expect(plan.toGenerateCount).toBe(1);
      expect(plan.reasons).toContain("canonical-missing");
    });

    it("handles empty canonical (0 bytes) as initial-build", () => {
      const plan = calculateEmbeddingUpdatePlan({
        chunks: [dummyChunk],
        canonicalRecords: [],
        canonicalExists: true,
        canonicalReadability: "empty",
        publishedIdentity: {},
        targetIdentity,
        buildInput: dummyBuildInput,
        hashInput: dummyHashInput,
      });

      expect(plan.mode).toBe("initial-build");
      expect(plan.reusableCanonicalCount).toBe(0);
      expect(plan.toGenerateCount).toBe(1);
      expect(plan.reasons).toContain("canonical-empty");
    });

    it("handles incompatible model as full-rebuild", () => {
      const plan = calculateEmbeddingUpdatePlan({
        chunks: [dummyChunk],
        canonicalRecords: [],
        canonicalExists: true,
        canonicalReadability: "readable",
        publishedIdentity: { ...publishedIdentity, model: "old-model" },
        targetIdentity,
        buildInput: dummyBuildInput,
        hashInput: dummyHashInput,
      });

      expect(plan.mode).toBe("full-rebuild");
      expect(plan.reasons).toContain("model-changed");
    });
  });

  describe("3. Lifecycle Classification & Snapshot Resolution", () => {
    it("classifies resource-limit-exceeded as pending full-rebuild with blocking severity", () => {
      const work = classifyEmbeddingWork({
        publishedIdentity,
        targetIdentity,
        canonicalExists: true,
        canonicalReadability: "resource-limit-exceeded",
        totalChunks: 10,
        toGenerateCount: 10,
        planMode: "full-rebuild",
        planReasons: ["canonical-resource-limit-exceeded"],
      });

      expect(work.kind).toBe("pending");
      expect(work.mode).toBe("full-rebuild");
      expect(work.updateRequired).toBe(true);
      expect(work.severity).toBe("blocking");
      expect(work.reasons).toContain("canonical-resource-limit-exceeded");
    });

    it("classifies unreadable / corrupted canonical as indeterminate", () => {
      const work = classifyEmbeddingWork({
        publishedIdentity,
        targetIdentity,
        canonicalExists: true,
        canonicalReadability: "unreadable",
        totalChunks: 10,
        planMode: "indeterminate",
        planReasons: ["canonical-unreadable"],
      });

      expect(work.kind).toBe("indeterminate");
      expect(work.updateRequired).toBe(false);
      expect(work.severity).toBe("none");
      expect(work.reasons).toContain("canonical-unreadable");
    });

    it("resolves lifecycle snapshot for large canonical to INCOMPATIBLE (allowing rebuild)", () => {
      const work = classifyEmbeddingWork({
        publishedIdentity,
        targetIdentity,
        canonicalExists: true,
        canonicalReadability: "resource-limit-exceeded",
        totalChunks: 5,
        toGenerateCount: 5,
        planMode: "full-rebuild",
        planReasons: ["canonical-resource-limit-exceeded"],
      });

      const snapshot = resolveEmbeddingLifecycle({
        revision: 1,
        deviceRole: "producer",
        isActiveProducer: true,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        publishedIdentity,
        deviceIdentity: targetIdentity,
        canonicalExists: true,
        validForSearchCount: 0,
        workAssessment: work,
        requiresConfirmation: true,
      });

      expect(snapshot.primary).toBe("INCOMPATIBLE");
      expect(snapshot.write.work.mode).toBe("full-rebuild");
      expect(snapshot.write.updateRequired).toBe(true);
      expect(snapshot.capability.canRequestUpdate).toBe(true);
      expect(snapshot.capability.requiresConfirmation).toBe(true);
    });

    it("resolves lifecycle snapshot for corrupted canonical to INDETERMINATE (blocking rebuild)", () => {
      const work = classifyEmbeddingWork({
        publishedIdentity,
        targetIdentity,
        canonicalExists: true,
        canonicalReadability: "unreadable",
        totalChunks: 5,
        planMode: "indeterminate",
        planReasons: ["canonical-unreadable"],
      });

      const snapshot = resolveEmbeddingLifecycle({
        revision: 1,
        deviceRole: "producer",
        isActiveProducer: true,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        publishedIdentity,
        deviceIdentity: targetIdentity,
        canonicalExists: true,
        validForSearchCount: 0,
        workAssessment: work,
      });

      expect(snapshot.primary).toBe("INDETERMINATE");
      expect(snapshot.write.work.kind).toBe("indeterminate");
      expect(snapshot.write.updateRequired).toBe(false);
    });
  });

  describe("4. Write Path Decision and Start Gate Invariants", () => {
    it("allows user-confirmed rebuild for large canonical exceeding resource limit", () => {
      const work = classifyEmbeddingWork({
        publishedIdentity,
        targetIdentity,
        canonicalExists: true,
        canonicalReadability: "resource-limit-exceeded",
        totalChunks: 5,
        toGenerateCount: 5,
        planMode: "full-rebuild",
        planReasons: ["canonical-resource-limit-exceeded"],
      });

      const snapshot = resolveEmbeddingLifecycle({
        revision: 1,
        deviceRole: "producer",
        isActiveProducer: true,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        publishedIdentity,
        deviceIdentity: targetIdentity,
        canonicalExists: true,
        validForSearchCount: 0,
        workAssessment: work,
        requiresConfirmation: true,
      });

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.primary).toBe("INCOMPATIBLE");
      expect(decision.action).toBe("rebuild");
      expect(decision.canExecute).toBe(true);
      expect(decision.requiresConfirmation).toBe(true);

      // Automatic dispatch is refused due to confirmation requirement
      const autoGate = evaluateOperationStartGate(decision, "automatic");
      expect(autoGate.allowed).toBe(false);
      expect((autoGate as { allowed: false; reason: string }).reason).toBe("confirmation-required");

      // Manual / Sidebar / Command dispatch is allowed!
      const manualGate = evaluateOperationStartGate(decision, "sidebar");
      expect(manualGate.allowed).toBe(true);
    });

    it("strictly blocks all operations for genuinely unreadable / corrupted canonical", () => {
      const work = classifyEmbeddingWork({
        publishedIdentity,
        targetIdentity,
        canonicalExists: true,
        canonicalReadability: "unreadable",
        totalChunks: 5,
        planMode: "indeterminate",
        planReasons: ["canonical-unreadable"],
      });

      const snapshot = resolveEmbeddingLifecycle({
        revision: 1,
        deviceRole: "producer",
        isActiveProducer: true,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        publishedIdentity,
        deviceIdentity: targetIdentity,
        canonicalExists: true,
        validForSearchCount: 0,
        workAssessment: work,
      });

      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.primary).toBe("INDETERMINATE");
      expect(decision.action).toBe("none");
      expect(decision.canExecute).toBe(false);

      const gate = evaluateOperationStartGate(decision, "sidebar");
      expect(gate.allowed).toBe(false);
      expect((gate as { allowed: false; reason: string }).reason).toBe("indeterminate");
    });
  });
});
