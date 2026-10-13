import { describe, expect, it } from "vitest";
import { evaluateAiPrivacyGate } from "../../src/ai/privacyGate";
import { normalizeExclusionRules } from "../../src/index/exclusionPolicy";

const rules = normalizeExclusionRules({
  excludedFolders: ["03_Pessoal/"],
  excludedPathContains: ["senha"],
  excludedContentContains: ["SEGREDO-LINA-TESTE"],
});

const evaluate = (overrides: Partial<Parameters<typeof evaluateAiPrivacyGate>[0]> = {}) =>
  evaluateAiPrivacyGate({
    policyStatus: "loaded",
    rules,
    path: "Projetos/nota.md",
    content: "Conteúdo permitido.",
    configDir: ".obsidian",
    ...overrides,
  });

describe("AI privacy gate", () => {
  it("permits a note under a validated policy when no canonical rule matches", () => {
    expect(evaluate()).toEqual({ allowed: true });
  });

  it("blocks excluded folders and path terms using the canonical path matcher", () => {
    expect(evaluate({ path: "03_Pessoal/nota.md" })).toEqual({ allowed: false, reason: "path-excluded" });
    expect(evaluate({ path: "Projetos/senha-nota.md" })).toEqual({ allowed: false, reason: "path-excluded" });
  });

  it("blocks excluded content using the canonical content matcher", () => {
    expect(evaluate({ content: "Inclui segredo-lina-teste, sem diferença de maiúsculas." }))
      .toEqual({ allowed: false, reason: "content-excluded" });
  });

  it("fails closed when the canonical policy is missing or invalid", () => {
    expect(evaluate({ policyStatus: "missing" })).toEqual({ allowed: false, reason: "policy-unavailable" });
    expect(evaluate({ policyStatus: "invalid" })).toEqual({ allowed: false, reason: "policy-unavailable" });
  });
});
