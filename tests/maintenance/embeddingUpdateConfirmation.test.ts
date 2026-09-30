import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  type EmbeddingProviderCapability,
  getEmbeddingProviderCapability,
} from "../../src/ai/providerCapabilities";
import {
  type EmbeddingPolicyDecision,
  type EmbeddingUpdatePolicy,
  evaluateEmbeddingUpdatePolicyFromSnapshot,
} from "../../src/maintenance/embeddingPolicyEngine";
import { resolveEmbeddingLifecycle } from "../../src/index/embeddingLifecycleModel";
import {
  prepareEmbeddingUpdateConfirmation,
  type PrepareEmbeddingUpdateConfirmationOptions,
} from "../../src/maintenance/embeddingUpdateConfirmation";

describe("Embedding Update Confirmation Flow (Phase 0.2.2.3)", () => {
  const stringsPt = getStrings("pt-PT");
  const stringsEn = getStrings("en");

  const ollama = getEmbeddingProviderCapability("ollama");
  const mistral = getEmbeddingProviderCapability("mistral");
  const openrouter = getEmbeddingProviderCapability("openrouter");
  const custom = getEmbeddingProviderCapability("custom-cloud");

  function makeDecision(options: {
    providerCapability?: EmbeddingProviderCapability;
    policy?: EmbeddingUpdatePolicy;
    deviceRole?: "producer" | "companion";
    hasWork?: boolean;
  }): EmbeddingPolicyDecision {
    const isCompanion = options.deviceRole === "companion";
    const isExternal = options.providerCapability ? (!options.providerCapability.isLocal || options.providerCapability.hasExternalCost) : false;
    const provider = options.providerCapability?.providerId ?? "ollama";
    const hasWork = options.hasWork ?? true;
    const identity = {
      provider,
      model: "default-model",
      dimensions: 768,
      inputVersion: 1,
      prefixMode: "none" as const,
    };

    const snapshot = resolveEmbeddingLifecycle({
      revision: 1,
      computedAt: 1,
      deviceRole: options.deviceRole ?? "producer",
      isActiveProducer: !isCompanion,
      embeddingsEnabled: true,
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 10,
      activeSource: "jsonl",
      publishedIdentity: identity,
      deviceIdentity: identity,
      targetIdentity: identity,
      workAssessment: hasWork ? {
        kind: "pending",
        mode: "incremental",
        updateRequired: true,
        severity: "action",
        cost: isExternal ? "external" : "local",
        reasons: ["missing-chunks"],
      } : {
        kind: "none",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["up-to-date"],
      },
    });

    return evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, options.policy ?? "manual");
  }

  describe("Local Provider (Ollama)", () => {
    it("prepares confirmation request with local no-cost disclosure under manual policy (pt-PT)", () => {
      const decision = makeDecision({
        providerCapability: ollama,
        policy: "manual",
        deviceRole: "producer",
        hasWork: true,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 100, validCount: 80, missingCount: 15, staleCount: 5, toGenerateCount: 20 },
        providerCapability: ollama,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "nomic-embed-text",
        strings: stringsPt,
      });

      expect(request).not.toBeNull();
      expect(request).toEqual({
        providerId: "ollama",
        modelName: "nomic-embed-text",
        isLocal: true,
        hasExternalCost: false,
        missingCount: 15,
        staleCount: 5,
        obsoleteCount: 0,
        totalToGenerate: 20,
        totalChunks: 100,
        semanticSearchImpact: "partial",
        requiresConfirmation: true,
        costWarningMessage: "Processamento local sem consumo de créditos externos de API.",
        isFullRebuild: false,
      });
    });

    it("prepares confirmation request in English (en)", () => {
      const decision = makeDecision({
        providerCapability: ollama,
        policy: "manual",
        deviceRole: "producer",
        hasWork: true,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 50, validCount: 0, missingCount: 50, staleCount: 0 },
        providerCapability: ollama,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "nomic-embed-text",
        strings: stringsEn,
      });

      expect(request).not.toBeNull();
      expect(request?.semanticSearchImpact).toBe("unavailable");
      expect(request?.costWarningMessage).toBe("Local processing with no external API credit consumption.");
    });
  });

  describe("External Cloud Providers (Mistral & OpenRouter)", () => {
    it("prepares confirmation request with explicit API credit cost warning for Mistral", () => {
      const decision = makeDecision({
        providerCapability: mistral,
        policy: "manual",
        deviceRole: "producer",
        hasWork: true,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 500, validCount: 290, missingCount: 200, staleCount: 10 },
        providerCapability: mistral,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "mistral-embed",
        strings: stringsPt,
      });

      expect(request).not.toBeNull();
      expect(request?.hasExternalCost).toBe(true);
      expect(request?.requiresConfirmation).toBe(true);
      expect(request?.costWarningMessage).toContain("mistral");
      expect(request?.costWarningMessage).toContain("poderá consumir créditos");
    });

    it("prepares confirmation request for OpenRouter in English with cost warning", () => {
      const decision = makeDecision({
        providerCapability: openrouter,
        policy: "manual",
        deviceRole: "producer",
        hasWork: true,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 100, validCount: 25, missingCount: 75, staleCount: 0 },
        providerCapability: openrouter,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "openai/text-embedding-3-small",
        strings: stringsEn,
      });

      expect(request).not.toBeNull();
      expect(request?.hasExternalCost).toBe(true);
      expect(request?.requiresConfirmation).toBe(true);
      expect(request?.costWarningMessage).toContain("openrouter");
      expect(request?.costWarningMessage).toContain("may consume account credits");
    });

    it("conservatively marks unknown/custom providers as having external costs", () => {
      const decision = makeDecision({
        providerCapability: custom,
        policy: "manual",
        deviceRole: "producer",
        hasWork: true,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 10, validCount: 0, missingCount: 10, staleCount: 0 },
        providerCapability: custom,
        policyDecision: decision,
        deviceRole: "producer",
        strings: stringsPt,
      });

      expect(request).not.toBeNull();
      expect(request?.hasExternalCost).toBe(true);
      expect(request?.requiresConfirmation).toBe(true);
      expect(request?.costWarningMessage).toContain("custom-cloud");
    });
  });

  describe("Invariants and Special States", () => {
    it("returns null for Companion device to strictly prevent generation triggers", () => {
      const decision = makeDecision({
        providerCapability: ollama,
        policy: "manual",
        deviceRole: "companion",
        hasWork: true,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 100, validCount: 0, missingCount: 100, staleCount: 0 },
        providerCapability: ollama,
        policyDecision: decision,
        deviceRole: "companion",
        strings: stringsPt,
      });

      expect(request).toBeNull();
    });

    it("returns null when no update is required and not a full rebuild", () => {
      const decision = makeDecision({
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "producer",
        hasWork: false,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 100, validCount: 100, missingCount: 0, staleCount: 0, toGenerateCount: 0 },
        providerCapability: ollama,
        policyDecision: decision,
        deviceRole: "producer",
        strings: stringsPt,
      });

      expect(request).toBeNull();
    });

    it("forces confirmation when isFullRebuild is true even if missing count is zero", () => {
      const decision = makeDecision({
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "producer",
        hasWork: true,
      });

      const request = prepareEmbeddingUpdateConfirmation({
        state: { totalChunks: 100, validCount: 100, missingCount: 0, staleCount: 0, toGenerateCount: 100 },
        providerCapability: ollama,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "nomic-embed-text",
        isFullRebuild: true,
        strings: stringsPt,
      });

      expect(request).not.toBeNull();
      expect(request?.isFullRebuild).toBe(true);
      expect(request?.requiresConfirmation).toBe(true);
    });

    it("is pure and does not mutate any inputs", () => {
      const state = Object.freeze({ totalChunks: 50, validCount: 20, missingCount: 30, staleCount: 0 });
      const options: PrepareEmbeddingUpdateConfirmationOptions = {
        state,
        providerCapability: ollama,
        policyDecision: {
          allowed: false,
          requiresConfirmation: true,
          reason: "manual-confirmation-required",
        },
        deviceRole: "producer",
        strings: stringsPt,
      };

      const request1 = prepareEmbeddingUpdateConfirmation(options);
      const request2 = prepareEmbeddingUpdateConfirmation(options);

      expect(request1).toEqual(request2);
      expect(state.missingCount).toBe(30);
    });
  });
});
