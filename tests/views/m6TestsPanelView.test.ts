import { describe, expect, it } from "vitest";
import { M6_TESTS_PANEL_VIEW_TYPE } from "../../src/views/m6TestsPanelView";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const panelSource = readFileSync(resolve(process.cwd(), "src/views/m6TestsPanelView.ts"), "utf8");
const testFeatureSource = readFileSync(resolve(process.cwd(), "src/views/m6TestProfileFeatures.ts"), "utf8");
const testCommandSource = readFileSync(resolve(process.cwd(), "src/views/m6TestProfileCommands.ts"), "utf8");
const mainSource = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");
const settingsSource = readFileSync(resolve(process.cwd(), "src/settings/pureDeclarativeSettingsBlueprint.ts"), "utf8");

describe("M6 tests sidebar panel", () => {
  it("uses a stable view type and mobile-safe one-column rendering", () => {
    expect(M6_TESTS_PANEL_VIEW_TYPE).toBe("lina-m6-tests-panel");
    expect(panelSource).toContain("M6_PANEL_TITLE");
    expect(panelSource).toContain("lina-m6-tests-row");
    expect(panelSource).not.toContain("Platform.");
  });

  it("registers one dedicated view and opens or reveals a single existing leaf", () => {
    expect(mainSource).toContain("registerM6TestProfileFeatures(this)");
    expect(mainSource).toContain("registerM6TestProfileCommands(this)");
    expect(testFeatureSource).toContain("plugin.registerView(M6_TESTS_PANEL_VIEW_TYPE");
    expect(testCommandSource).toContain('id: "abrir-painel-testes-m6"');
    expect(testFeatureSource).toContain("workspace.getLeavesOfType(M6_TESTS_PANEL_VIEW_TYPE)[0]");
    expect(testFeatureSource).toContain("await workspace.revealLeaf(leaf)");
  });

  it("keeps diagnostics read-only and delegates only the canonical cache invalidation", () => {
    expect(panelSource).toContain("getM6CutoverTestDiagnostic");
    expect(panelSource).toContain("invalidateM6RuntimeCache");
    expect(mainSource).toContain('this.invalidateRuntimeEmbeddingIndex("manual")');
    expect(panelSource).not.toContain("SQLite");
  });

  it("keeps toggle activation lazy and turns fatal published-reader failures into a recoverable block", () => {
    const selector = mainSource.slice(mainSource.indexOf("async getRuntimeEmbeddingIndex"), mainSource.indexOf("getPublishedRuntimeSelectionDiagnostic"));
    const toggle = mainSource.slice(mainSource.indexOf("async setM6CutoverEnabled"), mainSource.indexOf("invalidateM6RuntimeCache"));
    expect(toggle).not.toContain("getRuntimeEmbeddingIndex");
    expect(selector).toContain("try {");
    expect(selector).toContain('selectedSource: "PUBLISHED_BLOCKED"');
    expect(selector).toContain("catch (error)");
    expect(selector).not.toContain("const legacy = await this.runtimeEmbeddingIndexCache.getOrLoad");
    expect(panelSource).toContain(".catch(() => this.refresh())");
  });

  it("removes M6 controls from Settings", () => {
    expect(settingsSource).not.toContain("published-generation-cutover");
    expect(settingsSource).not.toContain("published-generation-cutover-status");
  });
});
