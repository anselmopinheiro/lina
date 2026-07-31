import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("LinaSearchView rename/mobile hardening", () => {
  const source = () => readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");

  it("guards late lifecycle callbacks and refreshes by view generation", () => {
    const text = source();
    expect(text).toContain("private viewOpen = false;");
    expect(text).toContain("private viewGeneration = 0;");
    expect(text).toContain("this.viewOpen = false;");
    expect(text).toContain("this.viewGeneration++;");
    expect(text).toContain("generation !== this.viewGeneration");
    expect(text).toContain("if (!this.viewOpen || !this.statusEl) return;");
    expect(text).toContain("if (!this.viewOpen || !this.resultsStatusEl) return;");
  });

  it("keeps stale result opening defensive and prevents render-time file assumptions", () => {
    const text = source();
    expect(text).toContain("if (!(file instanceof TFile))");
    expect(text).toContain("new Notice(this.L.errorNoteNotFound);");
    expect(text).toContain("private renderGroupedCards");
    expect(text).toContain("if (!this.viewOpen) return;");
  });

  it("keeps panel opening passive and reserves detailed refresh for an explicit action", () => {
    const text = source();
    const openStart = text.indexOf("async onOpen(): Promise<void>");
    const refreshStart = text.indexOf("private async refreshState", openStart);
    const passiveOpenCode = text.slice(openStart, refreshStart);
    expect(passiveOpenCode).not.toContain("refreshEmbeddingWorkStatus()");
    expect(text).toContain("refreshEmbeddingWorkStatus: true, refreshSemanticAvailability: true");
    expect(text).toContain("this.plugin.getEmbeddingWorkStatus()");
  });
});
