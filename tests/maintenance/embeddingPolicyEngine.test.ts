import { describe, expect, it } from "vitest";
import {
  EMBEDDING_PROVIDER_CAPABILITIES,
  EmbeddingProviderCapability,
  getEmbeddingProviderCapability,
} from "../../src/ai/providerCapabilities";
import {
  EmbeddingPolicyDecision,
  EmbeddingUpdatePolicy,
  evaluateEmbeddingUpdatePolicy,
} from "../../src/maintenance/embeddingPolicyEngine";

describe("Embedding Provider Capabilities (Phase 0.2.2.1)", () => {
  it("resolves Ollama as a local provider with no external cost and no API key requirement", () => {
    const capability = getEmbeddingProviderCapability("ollama");

    expect(capability).toEqual({
      providerId: "ollama",
      isLocal: true,
      hasExternalCost: false,
      requiresApiKey: false,
    });
  });

  it("resolves Mistral as a remote provider with external cost and API key requirement", () => {
    const capability = getEmbeddingProviderCapability("mistral");

    expect(capability).toEqual({
      providerId: "mistral",
      isLocal: false,
      hasExternalCost: true,
      requiresApiKey: true,
    });
  });

  it("resolves OpenRouter as a remote provider with external cost and API key requirement", () => {
    const capability = getEmbeddingProviderCapability("openrouter");

    expect(capability).toEqual({
      providerId: "openrouter",
      isLocal: false,
      hasExternalCost: true,
      requiresApiKey: true,
    });
  });

  it("handles case-insensitive and trimmed provider names", () => {
    expect(getEmbeddingProviderCapability("  OLLAMA  ")).toEqual(EMBEDDING_PROVIDER_CAPABILITIES.ollama);
    expect(getEmbeddingProviderCapability("Mistral")).toEqual(EMBEDDING_PROVIDER_CAPABILITIES.mistral);
    expect(getEmbeddingProviderCapability("OpenRouter ")).toEqual(EMBEDDING_PROVIDER_CAPABILITIES.openrouter);
  });

  it("safely falls back to conservative external cost characteristics for unknown providers", () => {
    const custom = getEmbeddingProviderCapability("custom-future-provider");

    expect(custom).toEqual({
      providerId: "custom-future-provider",
      isLocal: false,
      hasExternalCost: true,
      requiresApiKey: true,
    });
  });
});

describe("Embedding Policy Engine (Phase 0.2.2.1)", () => {
  const ollama = getEmbeddingProviderCapability("ollama");
  const mistral = getEmbeddingProviderCapability("mistral");
  const openrouter = getEmbeddingProviderCapability("openrouter");

  describe("Companion Device Invariants", () => {
    it("strictly blocks embedding generation on companion devices regardless of provider or policy", () => {
      const decisionOllamaAuto = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "companion",
      });

      expect(decisionOllamaAuto).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: false,
        reason: "companion-device-not-allowed",
      });

      const decisionMistralManual = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: mistral,
        policy: "manual",
        deviceRole: "companion",
      });

      expect(decisionMistralManual).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: false,
        reason: "companion-device-not-allowed",
      });

      const decisionNoWork = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: false },
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "companion",
      });

      expect(decisionNoWork).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: false,
        reason: "companion-device-not-allowed",
      });
    });
  });

  describe("Work Availability Invariants", () => {
    it("returns no-update-required when there are no pending embeddings on a Producer", () => {
      const decisionObjectState = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: false },
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "producer",
      });

      expect(decisionObjectState).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: false,
        reason: "no-update-required",
      });

      const decisionBooleanState = evaluateEmbeddingUpdatePolicy({
        embeddingState: false,
        providerCapability: mistral,
        policy: "manual",
        deviceRole: "producer",
      });

      expect(decisionBooleanState).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: false,
        reason: "no-update-required",
      });
    });
  });

  describe("Local Provider (Ollama) Policy Evaluation", () => {
    it("automatically approves updates for local providers when policy is automatic-local-only", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "producer",
      });

      expect(decision).toEqual<EmbeddingPolicyDecision>({
        allowed: true,
        requiresConfirmation: false,
        reason: "local-provider-auto-approved",
      });
    });

    it("requires manual confirmation for local providers when policy is manual", () => {
      const decision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "manual",
        deviceRole: "producer",
      });

      expect(decision).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: true,
        reason: "manual-confirmation-required",
      });
    });
  });

  describe("External API Providers (Mistral & OpenRouter) Policy Evaluation", () => {
    it.each<[string, EmbeddingProviderCapability]>([
      ["Mistral", mistral],
      ["OpenRouter", openrouter],
    ])("blocks automatic execution for external provider %s and requires confirmation", (_name, capability) => {
      const decision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: capability,
        policy: "automatic-local-only",
        deviceRole: "producer",
      });

      expect(decision).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: true,
        reason: "external-provider-blocked",
      });
    });

    it.each<[string, EmbeddingProviderCapability]>([
      ["Mistral", mistral],
      ["OpenRouter", openrouter],
    ])("requires manual confirmation for external provider %s under manual policy", (_name, capability) => {
      const decision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: capability,
        policy: "manual",
        deviceRole: "producer",
      });

      expect(decision).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: true,
        reason: "manual-confirmation-required",
      });
    });
  });

  describe("Custom/Unknown Provider Policy Evaluation", () => {
    it("treats custom providers conservatively with external cost characteristics", () => {
      const customProvider = getEmbeddingProviderCapability("custom-external");

      const autoDecision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: customProvider,
        policy: "automatic-local-only",
        deviceRole: "producer",
      });

      expect(autoDecision).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: true,
        reason: "external-provider-blocked",
      });

      const manualDecision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: customProvider,
        policy: "manual",
        deviceRole: "producer",
      });

      expect(manualDecision).toEqual<EmbeddingPolicyDecision>({
        allowed: false,
        requiresConfirmation: true,
        reason: "manual-confirmation-required",
      });
    });
  });

  describe("Purity and Isolation Invariants", () => {
    it("is a pure deterministic function with zero side effects", () => {
      const input = {
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "automatic-local-only" as EmbeddingUpdatePolicy,
        deviceRole: "producer" as const,
      };

      const result1 = evaluateEmbeddingUpdatePolicy(input);
      const result2 = evaluateEmbeddingUpdatePolicy(input);

      expect(result1).toEqual(result2);
      expect(input.embeddingState).toEqual({ hasPendingWork: true });
      expect(input.providerCapability).toEqual(ollama);
    });
  });
});
