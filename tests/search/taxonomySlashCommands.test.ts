import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("taxonomy slash commands", () => {
  const source = readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");
  const between = (from: string, to: string): string => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + from.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  const flow = () => between("private async runTaxonomyCommand(", "private buildAskCommandPrompt(");

  it("routes /tags and /yaml through one component-scoped canonical flow", () => {
    expect(source).toContain('await this.runTaxonomyCommand("tags");');
    expect(source).toContain('await this.runTaxonomyCommand("yaml");');

    const commandFlow = flow();
    expect(commandFlow).toContain("this.computeTaxonomyRuntime(activeFile.path)");
    expect(commandFlow).toContain("taxonomyRuntime?.request.requestTags");
    expect(commandFlow).toContain("taxonomyRuntime?.request.requestedYamlProperties");
    expect(commandFlow).toContain("reconcileTaxonomyRuntime(");
    expect(commandFlow).toContain("fallbackTaxonomyRuntime(");
    expect(commandFlow).toContain('kind === "tags" ? ai.tags : []');
    expect(commandFlow).toContain('kind === "yaml" ? ai.yaml : {}');
  });

  it("keeps the active note as taxonomy anchor while selection only scopes AI text", () => {
    const commandFlow = flow();
    expect(commandFlow).toContain("resolveCommandContext(activeFile)");
    expect(commandFlow).toContain("this.computeTaxonomyRuntime(activeFile.path)");
    expect(commandFlow).toContain("commandContext.text");
    expect(commandFlow).toContain("commandContext.sourceLabel");
  });

  it("preserves the central privacy gate before local runtime and AI work", () => {
    const commandFlow = flow();
    const gate = commandFlow.indexOf("this.evaluateAiPrivacyGate(activeFile.path, commandContext.text)");
    const runtime = commandFlow.indexOf("this.computeTaxonomyRuntime(activeFile.path)");
    const provider = commandFlow.indexOf("this.generateTextWithActiveAiProfile(activeProfile, prompt, {");
    expect(gate).toBeGreaterThan(-1);
    expect(runtime).toBeGreaterThan(gate);
    expect(provider).toBeGreaterThan(runtime);
  });

  it("removes the independent tag and YAML prompt/parser pipelines", () => {
    expect(source).not.toContain("buildTagsCommandPrompt");
    expect(source).not.toContain("buildYamlCommandPrompt");
    expect(source).not.toContain("parseTagsCommandResponse");
    expect(source).not.toContain("parseYamlCommandResponse");
    expect(source).toContain("private buildTaxonomyCommandPrompt(");
    expect(source).toContain("private parseTaxonomyCommandResponse(");
  });
});
