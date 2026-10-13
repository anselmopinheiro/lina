import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI privacy gate integration", () => {
  const source = readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");
  const between = (from: string, to: string): string => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + from.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it("enforces the central gate again at the provider boundary", () => {
    const providerBoundary = between("private async generateTextWithActiveAiProfile(", "  getViewType(): string");
    expect(providerBoundary).toContain("privacyContext: AiPrivacyGateInput");
    expect(providerBoundary).toContain("await this.plugin.reloadExclusionPolicy();");
    expect(providerBoundary).toContain("const privacyDecision = evaluateAiPrivacyGate({");
    expect(providerBoundary).toContain("policyStatus: this.plugin.getCanonicalExclusionPolicyStatus()");
    expect(providerBoundary.indexOf("reloadExclusionPolicy"))
      .toBeLessThan(providerBoundary.indexOf("evaluateAiPrivacyGate({"));
    expect(providerBoundary.indexOf("!privacyDecision.allowed"))
      .toBeLessThan(providerBoundary.indexOf("return generateProviderText("));
  });

  it("sends every current note-content flow through a path and content privacy context", () => {
    for (const flow of [
      between("private async runAskCommand(", "private async runTagsCommand("),
      between("private async runTaxonomyCommand(", "private buildAskCommandPrompt("),
      between("private async analyzeMarkdownFile(", "private async analyzeInboxNotes("),
      between("private async analyzeInboxNotes(", "private async confirmRemoteFolderAnalysis("),
      between("private async analyzeFolderNotes(", "private buildInboxNoteAnalysisPrompt("),
    ]) {
      expect(flow).toContain("this.evaluateAiPrivacyGate(");
      expect(flow).toContain("policyStatus: this.plugin.getCanonicalExclusionPolicyStatus()");
      expect(flow).toContain("rules: this.plugin.getEffectiveExclusionRules()");
      expect(flow).toContain("configDir: this.app.vault.configDir");
    }
  });

  it("filters related-note enrichment with the same central decision", () => {
    const related = between("private async filterRelatedNotesByUserContentRules(", "private getExistingVaultTags(");
    expect(related).toContain("this.evaluateAiPrivacyGate(note.path, content)");
    expect(related).not.toContain("isIndexPathExcludedByUserRules");
  });
});

describe("AI privacy gate — structural metadata and embedding generation (0.3.2 audit)", () => {
  const view = readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");
  const main = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");

  it("does not disclose excluded folder names in the folder list sent to providers", () => {
    const start = view.indexOf("private formatExistingFoldersForPrompt(");
    const end = view.indexOf("private applyFolderSuggestionResolution(", start);
    const body = view.slice(start, end);
    expect(body).toContain("this.getFolderAnalysisChoices()");
    expect(body).not.toContain("this.getExistingVaultFolders()");
  });

  it("refuses embedding generation when the canonical exclusion policy is invalid", () => {
    const start = main.indexOf("private async runGenerateLocalEmbeddings(");
    const end = main.indexOf("generateEmbeddingsForChunks(", start);
    const body = main.slice(start, end);
    const gate = body.indexOf('this.canonicalPolicyStatus === "invalid"');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf("this.filterChunksByUserContentRules(chunks)"));
    expect(gate).toBeLessThan(body.indexOf("const embeddingConfig"));
  });
});
