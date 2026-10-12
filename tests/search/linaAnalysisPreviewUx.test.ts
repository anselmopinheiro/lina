import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { LinaSearchView } from "../../src/search/linaSearchView";

type Listener = (event: { target?: unknown; stopPropagation(): void }) => void | Promise<void>;
interface NodeStub {
  tag: string; text: string; checked: boolean; attrs: Map<string, string>; children: NodeStub[]; listeners: Map<string, Listener[]>;
  createEl(tag: string, options?: { text?: string; cls?: string }): NodeStub; createDiv(options?: { text?: string; cls?: string }): NodeStub; createSpan(options?: { text?: string; cls?: string }): NodeStub;
  addClass(_: string): void; removeClass(_: string): void; setAttribute(key: string, value: string): void; setText(value: string): void;
  addEventListener(type: string, listener: Listener): void; empty(): void; querySelector<T extends NodeStub>(selector: string): T | null;
}
function node(tag = "div", text = ""): NodeStub {
  const value: NodeStub = { tag, text, checked: false, attrs: new Map(), children: [], listeners: new Map(),
    createEl(childTag, options) { const child = node(childTag, options?.text ?? ""); value.children.push(child); return child; },
    createDiv(options) { return value.createEl("div", options); }, createSpan(options) { return value.createEl("span", options); },
    addClass() {}, removeClass() {}, setAttribute(key, attr) { value.attrs.set(key, attr); }, setText(next) { value.text = next; },
    addEventListener(type, listener) { value.listeners.set(type, [...(value.listeners.get(type) ?? []), listener]); }, empty() { value.children = []; },
    querySelector(selector) { const find = (current: NodeStub): NodeStub | null => { for (const child of current.children) { if (selector === "[data-lina-apply-selected]" && child.attrs.has("data-lina-apply-selected")) return child; const nested = find(child); if (nested) return nested; } return null; }; return find(value) as never; },
  }; return value;
}

function allText(current: NodeStub): string {
  return [current.text, ...current.children.map(allText)].join("\n");
}

function analysisView(): Record<string, any> {
  return Object.assign(Object.create(LinaSearchView.prototype), {
    plugin: { settings: { interfaceLanguage: "pt-PT" } }
  });
}

describe("LINA-007 structured analysis preview contracts", () => {
  const source = () => readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");

  it("renders analysis as reading content plus an explicit unselected write action", () => {
    const text = source();
    expect(text).toContain('analysisSection.createDiv({ text: result.analysis');
    expect(text).toContain('"analysis_text", "Gravar análise na nota", false, "analysis", result.analysis');
  });

  it("preserves analysis identity and write contract", () => {
    const text = source();
    expect(text).toContain('case "analysis"');
    expect(text).toContain("this.applyAnalysisToNote(");
    expect(text).toContain('"analysis_text"');
  });

  it("keeps H1 and rename as independent selectable items", () => {
    const text = source();
    expect(text).toContain('id: "suggested"');
    expect(text).toContain('kind: "title"');
    expect(text).toContain('id: "rename_file"');
    expect(text).toContain('kind: "rename-file"');
  });

  it("shows a move selection only when the resolved folder can move", () => {
    const text = source();
    const folderStart = text.lastIndexOf("// Pasta sugerida");
    const folder = text.slice(folderStart, text.indexOf("const validTags", folderStart));
    expect(folder).toContain("if (canMove)");
    expect(folder).toContain('"folder::move_suggested"');
    expect(folder).not.toContain('checkbox.disabled = true');
  });

  it("keeps folder path, status badge and move action separate without duplicating status", () => {
    const text = source();
    const folderStart = text.lastIndexOf("// Pasta sugerida");
    const folder = text.slice(folderStart, text.indexOf("const validTags", folderStart));
    expect(folder).toContain('cls: "lina-folder-preview-value-row"');
    expect(folder).toContain("this.getFolderPreviewStatusLabel(folderResolution)");
    expect(folder).toContain("folderResolution.reason, undefined, undefined, false");
    expect(text).toContain("private getFolderPreviewStatusLabel(");
    expect(text).toContain("if (resolution.canMove && resolution.exists) return this.L.previewFolderExistingBadge;");
    expect(text).toContain("if (resolution.isCurrentFolder) return this.L.previewFolderCurrentBadge;");
    expect(text).toContain("return resolution.reason;");
  });

  it("preserves YAML and tag semantic reasons while presenting status badges", () => {
    const text = source();
    expect(text).toContain('reason: "new"');
    expect(text).toContain('reason: "already_exists"');
    expect(text).toContain('reason: "conflict"');
    expect(text).toContain('reason: proposal.existsInVault ? "existing-tag" : "new-tag"');
    expect(text).toContain("lina-suggestion-status");
    expect(text).toContain('label: `${proposal.property}: ${proposal.valueText}`');
    expect(text).toContain("statusLabel: this.L.previewYamlNew");
    expect(text).toContain("label: proposal.tag,");
    expect(text).toContain("statusLabel");
  });

  it("separates title actions from their proposed values and keeps compact folder status", () => {
    const text = source();
    expect(text).toContain("label: this.L.renameUpdateH1");
    expect(text).toContain("description: result.suggestedTitle");
    expect(text).toContain("label: this.L.renameRenameFile");
    expect(text).toContain("description: readableFileName");
    expect(text).toContain("text: this.L.previewSectionFolder");
    expect(text).not.toContain('`${this.L.previewFolderStatus}: ${folderResolution.reason}`');
  });

  it("starts at zero and updates apply count for selection and deselection", () => {
    const text = source();
    expect(text).toContain('`${this.L.previewApplyButton} (0)`');
    expect(text).toContain('data-lina-apply-selected');
    expect(text).toContain("private updateApplySelectedCount()");
    expect(text.match(/this\.updateApplySelectedCount\(\);/g)).toHaveLength(2);
  });

  it("keeps related notes compact and removes permanent checkbox instructions", () => {
    const text = source();
    expect(text).toContain('notesInfoContainer.createEl("details")');
    expect(text).not.toContain("previewCheckboxExplanation");
  });

  it("uses concise section labels and retains summary metadata presentation", () => {
    const text = source();
    expect(text).toContain("this.L.previewSectionTitle");
    expect(text).toContain("this.L.previewSectionFolder");
    expect(text).toContain("this.L.previewSectionYaml");
    expect(text).toContain("this.L.previewSectionTags");
    expect(text).toContain('result.limitations.trim().toLowerCase() === "nenhuma"');
    expect(text).toContain('"lina-analysis-apply-button"');
  });

  it("starts application after a DOM checkbox selection and Apply button click", async () => {
    const root = node();
    const view = Object.create(LinaSearchView.prototype) as Record<string, any>;
    let applications = 0;
    Object.assign(view, {
      analysisResultEl: root, structuredSelections: new Map(), selectableItemsMap: new Map(),
      currentStructuredResult: undefined, currentActiveFilePath: undefined,
      app: { workspace: { getActiveFile: () => undefined } }, plugin: { settings: { interfaceLanguage: "pt-PT" } },
      renderCopyAiResponseButton() {}, formatStructuredAnalysisForClipboard: () => "",
      applySelectedChanges: async () => { applications++; },
    });
    await view.renderStructuredPreview({ analysis: "Texto de análise" }, 0, []);
    const findInput = (current: NodeStub): NodeStub | undefined => current.children.find((child) => child.tag === "input") ?? current.children.map(findInput).find(Boolean);
    const checkbox = findInput(root)!;
    checkbox.checked = true;
    for (const listener of checkbox.listeners.get("change") ?? []) await listener({ target: checkbox, stopPropagation() {} });
    const apply = root.querySelector<NodeStub>("[data-lina-apply-selected]")!;
    for (const listener of apply.listeners.get("click") ?? []) await listener({ target: apply, stopPropagation() {} });
    await Promise.resolve();
    expect(view.structuredSelections.get("analysis_text")).toBe(true);
    expect(applications).toBe(1);
  });

  it("applies an H1 selection when a legacy analysis already exists", async () => {
    const targetFile = Object.assign(Object.create(TFile.prototype), {
      path: "Nota.md", name: "Nota.md", extension: "md"
    }) as TFile;
    let content = "# Título anterior\n\n## Análise Lina\n\nAnálise legacy intacta.";
    const view = Object.create(LinaSearchView.prototype) as Record<string, any>;
    let reinsertChecks = 0;
    Object.assign(view, {
      currentStructuredResult: { suggestedTitle: "Título aplicado" },
      currentActiveFilePath: targetFile.path,
      structuredSelections: new Map([["suggested", true]]),
      selectableItemsMap: new Map([["suggested", { kind: "title", value: "Título aplicado" }]]),
      plugin: { settings: { interfaceLanguage: "pt-PT" } },
      app: {
        vault: {
          getAbstractFileByPath: () => targetFile,
          read: async () => content,
          modify: async (_file: TFile, nextContent: string) => { content = nextContent; }
        },
        workspace: { getActiveFile: () => targetFile },
        fileManager: { renameFile: async () => {} }
      },
      confirmReinsertAiContent: async () => { reinsertChecks++; return false; },
      confirmApplySuggestions: async () => true
    });

    await view.applySelectedChanges();

    expect(content).toContain("# Título aplicado");
    expect(content).toContain("Análise legacy intacta.");
    expect(reinsertChecks).toBe(0);
  });

  it("applies H1 and appends a selected analysis in the same batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 10, 24));
    const targetFile = Object.assign(Object.create(TFile.prototype), {
      path: "Nota.md", name: "Nota.md", extension: "md"
    }) as TFile;
    let content = "# Título anterior\n\n## Análise Lina\n\nAnálise legacy intacta.";
    const view = analysisView();
    Object.assign(view, {
      currentStructuredResult: { suggestedTitle: "Título aplicado", analysis: "Nova análise" },
      currentActiveFilePath: targetFile.path,
      structuredSelections: new Map([["suggested", true], ["analysis_text", true]]),
      selectableItemsMap: new Map([
        ["suggested", { kind: "title", value: "Título aplicado" }],
        ["analysis_text", { kind: "analysis", value: "Nova análise" }]
      ]),
      app: {
        vault: {
          getAbstractFileByPath: () => targetFile,
          read: async () => content,
          modify: async (_file: TFile, nextContent: string) => { content = nextContent; }
        },
        workspace: { getActiveFile: () => targetFile },
        fileManager: { renameFile: async () => {} }
      },
      confirmApplySuggestions: async () => true
    });

    await view.applySelectedChanges();
    vi.useRealTimers();

    expect(content).toContain("# Título aplicado");
    expect(content).toContain("Análise legacy intacta.");
    expect(content).toContain("> [!info]- 09/10/2026 · 10:24\n> Nova análise");
  });

  it("creates the analysis heading and a timestamped callout when none exists", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 10, 24));
    const content = analysisView().applyAnalysisToNote("# Nota", { analysis: "Nova análise" }, [], [], true);
    vi.useRealTimers();

    expect(content).toContain("## Análise Lina");
    expect(content).toContain("> [!info]- 09/10/2026 · 10:24");
    expect(content).toContain("> Nova análise");
  });

  it("preserves legacy analysis and appends the new analysis as a callout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 10, 24));
    const content = analysisView().applyAnalysisToNote(
      "# Nota\n\n## Análise Lina\n\nTexto legacy intacto.",
      { analysis: "Nova análise" }, [], [], true
    );
    vi.useRealTimers();

    expect(content).toContain("Texto legacy intacto.");
    expect(content).toContain("> [!info]- 09/10/2026 · 10:24");
    expect(content).toContain("> Nova análise");
  });

  it("appends a collapsed callout without migrating an earlier callout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 18, 37));
    const content = analysisView().applyAnalysisToNote(
      "## Análise Lina\n\n> [!info] 09/10/2026 · 10:24\n> Análise anterior",
      { analysis: "Nova análise" }, [], [], true
    );
    vi.useRealTimers();

    expect(content).toContain("> [!info] 09/10/2026 · 10:24\n> Análise anterior");
    expect(content).toContain("> [!info]- 15/10/2026 · 18:37\n> Nova análise");
  });

  it("keeps every line of a multiline analysis inside the callout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 10, 24));
    const content = analysisView().applyAnalysisToNote("# Nota", { analysis: "Primeira linha\n\nSegunda linha" }, [], [], true);
    vi.useRealTimers();

    expect(content).toContain("> [!info]- 09/10/2026 · 10:24\n> Primeira linha\n>\n> Segunda linha");
  });

  it("shows the existing-analysis badge and append message only when the heading exists", async () => {
    const targetFile = Object.assign(Object.create(TFile.prototype), { path: "Nota.md", name: "Nota.md", extension: "md" }) as TFile;
    const render = async (content: string) => {
      const root = node();
      const view = analysisView();
      Object.assign(view, {
        analysisResultEl: root, structuredSelections: new Map(), selectableItemsMap: new Map(),
        app: { vault: { read: async () => content }, workspace: { getActiveFile: () => targetFile } },
        renderCopyAiResponseButton() {}, formatStructuredAnalysisForClipboard: () => ""
      });
      await view.renderStructuredPreview({ analysis: "Texto de análise" }, 0, [], targetFile);
      return { root, view };
    };

    const existing = await render("# Nota\n\n## Análise Lina\n\nAnterior");
    expect(allText(existing.root)).toContain("já existe");
    expect(allText(existing.root)).toContain("Será acrescentada uma nova análise.");
    expect(existing.view.structuredSelections.get("analysis_text")).toBe(false);

    const absent = await render("# Nota\n\nSem análise anterior");
    expect(allText(absent.root)).not.toContain("já existe");
    expect(allText(absent.root)).not.toContain("Será acrescentada uma nova análise.");
    expect(absent.view.structuredSelections.get("analysis_text")).toBe(false);
  });
});

describe("post-taxonomy analysis panel presentation", () => {
  const targetFile = Object.assign(Object.create(TFile.prototype), { path: "Nota.md", name: "Nota.md", extension: "md" }) as TFile;
  const related = { title: "Outra", path: "Outra.md", snippet: "", score: 50 };
  const source = () => readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");

  const render = async (relatedNotes: unknown[], relatedCount = relatedNotes.length) => {
    const root = node();
    const view = analysisView();
    Object.assign(view, {
      analysisResultEl: root, structuredSelections: new Map(), selectableItemsMap: new Map(),
      app: {
        vault: { read: async () => "# Nota\n", getAllLoadedFiles: () => [] },
        workspace: { getActiveFile: () => targetFile },
        metadataCache: { getTags: () => ({ "#direcao/turma": 3 }) },
      },
      renderCopyAiResponseButton() {}, formatStructuredAnalysisForClipboard: () => "",
      renderRelatedNoteSummaryItem() {},
    });
    await view.renderStructuredPreview({
      summary: "Resumo",
      tags: ["direcao/turma"],
      yaml: { tipo: "contacto_ee", area: "escolar" },
      suggestedTitle: "Contacto EE",
    }, relatedCount, relatedNotes, targetFile);
    return { root, view };
  };

  it("never renders the experimental taxonomy diagnostic in the normal panel", async () => {
    const { root } = await render([related]);
    const text = allText(root);

    expect(text).not.toContain("Diagnóstico experimental");
    expect(text).not.toMatch(/MOTOR LOCAL|MOTOR ATUAL|PLANO|suporte \d+\/\d+/);
    expect(source()).not.toContain("renderSemanticTaxonomyDiagnostic");
    expect(source()).not.toContain("Diagnóstico experimental");
  });

  it("keeps the reconciled suggestions available, preserving hierarchical tags", async () => {
    const { root, view } = await render([]);
    const text = allText(root);

    expect(text).toContain("direcao/turma");
    expect(text).not.toContain("direcaoturma");
    expect(text).toContain("tipo: contacto_ee");
    expect(text).toContain("area: escolar");
    expect(text).toContain("Contacto EE");
    // Todas as sugestões começam por selecionar: Aplicar (0) até haver seleção explícita.
    expect([...view.structuredSelections.values()].every((selected: boolean) => selected === false)).toBe(true);
    expect(text).toMatch(/\(0\)/);
  });

  it("shows no related-notes row when there are none, and a compact list when there are", async () => {
    const none = allText((await render([])).root);
    const some = allText((await render([related])).root);

    expect(none).not.toContain("Notas relacionadas");
    expect(some).toContain("Notas relacionadas (1)");
  });
});
