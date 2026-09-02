import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { getEmbeddingProviderCapability } from "../../src/ai/providerCapabilities";
import { evaluateEmbeddingUpdatePolicy } from "../../src/maintenance/embeddingPolicyEngine";
import {
  explainEmbeddingStatus,
  type ExplainEmbeddingStatusOptions,
} from "../../src/maintenance/embeddingStatusExplanation";

describe("Embedding Status Explanation (Phase 0.2.2.2)", () => {
  const stringsPt = getStrings("pt-PT");
  const stringsEn = getStrings("en");

  const ollamaCapability = getEmbeddingProviderCapability("ollama");
  const mistralCapability = getEmbeddingProviderCapability("mistral");
  const openRouterCapability = getEmbeddingProviderCapability("openrouter");

  describe("Scenario: Up-to-date state", () => {
    it("explains up-to-date status for a Producer with no pending embeddings (pt-PT)", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: ollamaCapability,
        policy: "automatic-local-only",
        deviceRole: "producer",
        embeddingState: { missingCount: 0, staleCount: 0, toGenerateCount: 0 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 150, validCount: 150, missingCount: 0, staleCount: 0 },
        providerCapability: ollamaCapability,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "nomic-embed-text",
        strings: stringsPt,
      });

      expect(explanation.status).toBe("up-to-date");
      expect(explanation.title).toBe("Embeddings atualizados");
      expect(explanation.summary).toBe("Todas as notas possuem representações semânticas válidas.");
      expect(explanation.semanticSearchImpact).toBe("complete");
      expect(explanation.mayConsumeCredits).toBe(false);
      expect(explanation.recommendedAction).toBe("none");
      expect(explanation.providerDescription).toBe("ollama (nomic-embed-text)");
      expect(explanation.details).toContain("150 de 150 chunks estão prontos para pesquisa semântica.");
      expect(explanation.details).toContain("Processamento local sem consumo de créditos externos de API.");
    });

    it("explains up-to-date status in English (en)", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: mistralCapability,
        policy: "manual",
        deviceRole: "producer",
        embeddingState: { missingCount: 0, staleCount: 0 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 50, validCount: 50, missingCount: 0, staleCount: 0 },
        providerCapability: mistralCapability,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "mistral-embed",
        strings: stringsEn,
      });

      expect(explanation.status).toBe("up-to-date");
      expect(explanation.title).toBe("Embeddings up to date");
      expect(explanation.summary).toBe("All notes have valid semantic representations.");
      expect(explanation.semanticSearchImpact).toBe("complete");
      expect(explanation.details).toContain("50 of 50 chunks are ready for semantic search.");
      expect(explanation.details).toContain("This operation may consume external provider credits.");
    });
  });

  describe("Scenario: Missing embeddings", () => {
    it("explains missing embeddings with local provider without external cost (pt-PT)", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: ollamaCapability,
        policy: "automatic-local-only",
        deviceRole: "producer",
        embeddingState: { missingCount: 386, staleCount: 0, toGenerateCount: 386 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 386, validCount: 0, missingCount: 386, staleCount: 0 },
        providerCapability: ollamaCapability,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "nomic-embed-text",
        strings: stringsPt,
      });

      expect(explanation.status).toBe("needs-update");
      expect(explanation.title).toBe("Embeddings precisam de atualização");
      expect(explanation.summary).toBe("Existem notas que requerem geração ou atualização de embeddings.");
      expect(explanation.semanticSearchImpact).toBe("unavailable");
      expect(explanation.mayConsumeCredits).toBe(false);
      expect(explanation.recommendedAction).toBe("update");
      expect(explanation.details).toContain("386 notas não possuem representação semântica.");
      expect(explanation.details).toContain("Processamento local sem consumo de créditos externos de API.");
      expect(explanation.details).toContain("A política atual permite geração automática em segundo plano para providers locais.");
    });

    it("explains missing embeddings with external provider highlighting API cost risks", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: mistralCapability,
        policy: "manual",
        deviceRole: "producer",
        embeddingState: { missingCount: 120, staleCount: 0, toGenerateCount: 120 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 200, validCount: 80, missingCount: 120, staleCount: 0 },
        providerCapability: mistralCapability,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "mistral-embed",
        strings: stringsEn,
      });

      expect(explanation.status).toBe("needs-update");
      expect(explanation.title).toBe("Embeddings need updating");
      expect(explanation.semanticSearchImpact).toBe("partial");
      expect(explanation.mayConsumeCredits).toBe(true);
      expect(explanation.recommendedAction).toBe("update");
      expect(explanation.details).toContain("120 notes do not have semantic representations.");
      expect(explanation.details).toContain("80 of 200 chunks are ready for semantic search.");
      expect(explanation.details).toContain("This operation may consume external provider credits.");
      expect(explanation.details).toContain("The current policy requires manual confirmation before starting generation.");
    });
  });

  describe("Scenario: Outdated embeddings", () => {
    it("explains outdated embeddings impact on semantic search results", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: ollamaCapability,
        policy: "manual",
        deviceRole: "producer",
        embeddingState: { missingCount: 0, staleCount: 7, toGenerateCount: 7 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 100, validCount: 93, missingCount: 0, staleCount: 7, obsoleteCount: 2 },
        providerCapability: ollamaCapability,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "nomic-embed-text",
        strings: stringsPt,
      });

      expect(explanation.status).toBe("needs-update");
      expect(explanation.semanticSearchImpact).toBe("partial");
      expect(explanation.recommendedAction).toBe("update");
      expect(explanation.details).toContain("7 embeddings estão desatualizados face a alterações recentes.");
      expect(explanation.details).toContain("2 embeddings obsoletos serão removidos na próxima atualização.");
    });
  });

  describe("Scenario: External provider blocked under automatic policy", () => {
    it("explains why automatic generation was blocked for remote API", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: openRouterCapability,
        policy: "automatic-local-only",
        deviceRole: "producer",
        embeddingState: { missingCount: 45, staleCount: 0, toGenerateCount: 45 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 100, validCount: 55, missingCount: 45, staleCount: 0 },
        providerCapability: openRouterCapability,
        policyDecision: decision,
        deviceRole: "producer",
        modelName: "openai/text-embedding-3-small",
        strings: stringsPt,
      });

      expect(explanation.status).toBe("blocked");
      expect(explanation.title).toBe("Geração de embeddings bloqueada");
      expect(explanation.summary).toBe("A geração automática está desativada para providers com custos externos de API.");
      expect(explanation.semanticSearchImpact).toBe("partial");
      expect(explanation.mayConsumeCredits).toBe(true);
      expect(explanation.recommendedAction).toBe("review-policy");
      expect(explanation.details).toContain("45 notas não possuem representação semântica.");
      expect(explanation.details).toContain("Esta operação poderá consumir créditos do provider externo.");
    });
  });

  describe("Scenario: Companion device restrictions", () => {
    it("explains Companion role limitation when unsynced embeddings exist", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: ollamaCapability,
        policy: "automatic-local-only",
        deviceRole: "companion",
        embeddingState: { missingCount: 30, staleCount: 0, toGenerateCount: 30 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 100, validCount: 70, missingCount: 30, staleCount: 0 },
        providerCapability: ollamaCapability,
        policyDecision: decision,
        deviceRole: "companion",
        strings: stringsPt,
      });

      expect(explanation.status).toBe("blocked");
      expect(explanation.title).toBe("Geração de embeddings bloqueada");
      expect(explanation.summary).toBe("A geração de embeddings só está disponível num dispositivo Produtor (Desktop).");
      expect(explanation.semanticSearchImpact).toBe("partial");
      expect(explanation.mayConsumeCredits).toBe(false);
      expect(explanation.recommendedAction).toBe("none");
      expect(explanation.details).toContain("Este dispositivo funciona como Companion (apenas leitura) e consome os embeddings sincronizados.");
      expect(explanation.details).toContain("30 notas não possuem representação semântica.");
    });

    it("reports ready state on Companion when all embeddings are synchronized", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        providerCapability: ollamaCapability,
        policy: "automatic-local-only",
        deviceRole: "companion",
        embeddingState: { missingCount: 0, staleCount: 0 },
      });

      const explanation = explainEmbeddingStatus({
        state: { totalChunks: 100, validCount: 100, missingCount: 0, staleCount: 0 },
        providerCapability: ollamaCapability,
        policyDecision: decision,
        deviceRole: "companion",
        strings: stringsEn,
      });

      expect(explanation.status).toBe("ready");
      expect(explanation.title).toBe("Embeddings up to date");
      expect(explanation.summary).toBe("All notes have valid semantic representations.");
      expect(explanation.semanticSearchImpact).toBe("complete");
      expect(explanation.recommendedAction).toBe("none");
      expect(explanation.details).toContain("This device operates as a Companion (read-only) and consumes synchronized embeddings.");
    });
  });

  describe("Purity and invariants", () => {
    it("does not mutate any inputs and produces deterministic output", () => {
      const state = Object.freeze({ totalChunks: 10, validCount: 5, missingCount: 5, staleCount: 0 });
      const options: ExplainEmbeddingStatusOptions = {
        state,
        providerCapability: ollamaCapability,
        policyDecision: {
          allowed: false,
          requiresConfirmation: true,
          reason: "manual-confirmation-required",
        },
        deviceRole: "producer",
        strings: stringsPt,
      };

      const explanation1 = explainEmbeddingStatus(options);
      const explanation2 = explainEmbeddingStatus(options);

      expect(explanation1).toEqual(explanation2);
      expect(state.missingCount).toBe(5);
    });

    it("handles undefined state gracefully and defaults counts to zero", () => {
      const explanation = explainEmbeddingStatus({
        providerCapability: ollamaCapability,
        policyDecision: {
          allowed: false,
          requiresConfirmation: true,
          reason: "manual-confirmation-required",
        },
        deviceRole: "producer",
        strings: stringsEn,
      });

      expect(explanation.status).toBe("needs-update");
      expect(explanation.semanticSearchImpact).toBe("unavailable");
      expect(explanation.providerDescription).toBe("ollama");
    });

    it("formats provider description without model when model is not specified or empty", () => {
      const explanationWithEmpty = explainEmbeddingStatus({
        providerCapability: mistralCapability,
        policyDecision: {
          allowed: false,
          requiresConfirmation: true,
          reason: "manual-confirmation-required",
        },
        deviceRole: "producer",
        modelName: "   ",
        strings: stringsPt,
      });

      expect(explanationWithEmpty.providerDescription).toBe("mistral");
    });
  });
});
