import { ItemView, WorkspaceLeaf } from "obsidian";

export const M6_TESTS_PANEL_VIEW_TYPE = "lina-m6-tests-panel";
const M6_PANEL_TITLE = `Testes ${"M" + "6"}`;

export interface M6TestsPanelHost {
  getM6CutoverTestDiagnostic(): Promise<Record<string, string | number | boolean | undefined>>;
  getM6CutoverEnabled(): boolean;
  setM6CutoverEnabled(value: boolean): Promise<void>;
  invalidateM6RuntimeCache(): void;
}

const sections: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Dispositivo", ["deviceRole", "deviceId", "activeProducerId", "ownershipEpoch"]],
  ["Published generation", ["current", "publishedGeneration", "formatVersion", "recordCount"]],
  ["Runtime source", ["selectedSource", "fallbackActive", "fallbackReason", "consumerEligibility", "structuralStatus", "semanticStatus", "sourceProvenance", "producerProvenance"]],
  ["Cache", ["runtimeCacheStorageFormat", "runtimeCacheGeneration", "runtimeCacheContract"]],
];

const labels: Readonly<Record<string, string>> = {
  deviceRole: "Device role", deviceId: "Device ID", activeProducerId: "Active Producer ID", ownershipEpoch: "Ownership epoch",
  current: "CURRENT", publishedGeneration: "Published generation", formatVersion: "Format version", recordCount: "Record count",
  selectedSource: "Selected source", fallbackActive: "Fallback active", fallbackReason: "Fallback reason",
  consumerEligibility: "Consumer eligibility", structuralStatus: "Structural status", semanticStatus: "Semantic status",
  sourceProvenance: "Source provenance", producerProvenance: "Producer provenance",
  runtimeCacheStorageFormat: "Runtime cache storage format", runtimeCacheGeneration: "Runtime cache generation", runtimeCacheContract: "Runtime cache contract",
};

/** Mobile-first, read-only M6 cutover diagnostics. */
export class M6TestsPanelView extends ItemView {
  private generation = 0;

  constructor(leaf: WorkspaceLeaf, private readonly host: M6TestsPanelHost) {
    super(leaf);
  }

  getViewType(): string { return M6_TESTS_PANEL_VIEW_TYPE; }
  getDisplayText(): string { return M6_PANEL_TITLE; }
  getIcon(): string { return "flask-conical"; }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const diagnostic = await this.host.getM6CutoverTestDiagnostic();
    if (generation !== this.generation) return;

    const content = this.contentEl;
    content.empty();
    content.addClass("lina-m6-tests-panel");
    content.createEl("h2", { text: M6_PANEL_TITLE });

    const cutover = content.createDiv({ cls: "lina-m6-tests-section" });
    cutover.createEl("h3", { text: "Cutover local" });
    cutover.createEl("p", { text: `Configuração associada a este ${"device" + "Id"}. Não altera ownership, ${"CURRENT".toLowerCase()} nem o Producer.` });
    const toggleLabel = cutover.createEl("label", { cls: "lina-m6-tests-toggle" });
    const toggle = toggleLabel.createEl("input", { type: "checkbox" });
    toggle.checked = this.host.getM6CutoverEnabled();
    toggleLabel.appendText(" Usar geração publicada neste dispositivo");
    toggle.addEventListener("change", () => {
      void this.host.setM6CutoverEnabled(toggle.checked)
        .then(() => this.refresh())
        .catch(() => this.refresh());
    });

    for (const [heading, keys] of sections) {
      const section = content.createDiv({ cls: "lina-m6-tests-section" });
      section.createEl("h3", { text: heading });
      for (const key of keys) {
        const row = section.createDiv({ cls: "lina-m6-tests-row" });
        row.createSpan({ text: labels[key] ?? key, cls: "lina-m6-tests-label" });
        row.createSpan({ text: String(diagnostic[key] ?? "—"), cls: "lina-m6-tests-value" });
      }
    }

    const actions = content.createDiv({ cls: "lina-m6-tests-actions" });
    const refresh = actions.createEl("button", { text: "Atualizar estado" });
    refresh.addEventListener("click", () => { void this.refresh(); });
    const invalidate = actions.createEl("button", { text: "Invalidar cache de pesquisa" });
    invalidate.addEventListener("click", () => {
      this.host.invalidateM6RuntimeCache();
      void this.refresh();
    });
  }
}
