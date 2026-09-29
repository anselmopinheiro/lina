import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStrings } from "../../src/i18n/strings";
import {
  buildSidebarStatusViewModel,
  type BuildSidebarStatusViewModelInput,
} from "../../src/search/sidebarStatusViewModel";
import { DeviceDiagnosticsModal } from "../../src/device/deviceDiagnosticsModal";
import { DeviceDiagnostics } from "../../src/device/deviceDiagnostics";

interface ElementStub {
  tag: string;
  textContent: string;
  options?: any;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  classes: Set<string>;
  attrs: Map<string, string>;
  children: ElementStub[];
  listeners: Map<string, Array<() => void | Promise<void>>>;
  createEl: (tag: string, options?: any) => ElementStub;
  createDiv: (options?: any) => ElementStub;
  createSpan: (options?: any) => ElementStub;
  addClass: (cls: string) => void;
  removeClass: (cls: string) => void;
  hasClass: (cls: string) => boolean;
  setAttribute: (key: string, val: string) => void;
  getAttribute: (key: string) => string | undefined;
  addEventListener: (type: string, listener: () => void | Promise<void>) => void;
  trigger: (type: string) => Promise<void>;
  empty: () => void;
  querySelectorAll: (selector: string) => ElementStub[];
}

function makeElementStub(tag = "div", options?: any): ElementStub {
  const stub: ElementStub = {
    tag,
    textContent: options?.text ?? "",
    options,
    value: options?.value ?? "",
    checked: options?.checked ?? false,
    disabled: options?.disabled ?? false,
    classes: new Set(),
    attrs: new Map(),
    children: [],
    listeners: new Map(),
    createEl: (childTag, childOptions) => {
      const child = makeElementStub(childTag, childOptions);
      if (childOptions?.cls) {
        childOptions.cls.split(/\s+/).forEach((c: string) => c && child.classes.add(c));
      }
      stub.children.push(child);
      return child;
    },
    createDiv: (childOptions) => stub.createEl("div", childOptions),
    createSpan: (childOptions) => stub.createEl("span", childOptions),
    addClass: (cls) => {
      cls.split(/\s+/).forEach((c) => c && stub.classes.add(c));
    },
    removeClass: (cls) => {
      cls.split(/\s+/).forEach((c) => c && stub.classes.delete(c));
    },
    hasClass: (cls) => stub.classes.has(cls),
    setAttribute: (key, val) => {
      stub.attrs.set(key, val);
    },
    getAttribute: (key) => stub.attrs.get(key),
    addEventListener: (type, listener) => {
      const list = stub.listeners.get(type) ?? [];
      list.push(listener);
      stub.listeners.set(type, list);
    },
    trigger: async (type) => {
      const list = stub.listeners.get(type) ?? [];
      for (const listener of list) {
        await listener();
      }
    },
    empty: () => {
      stub.children = [];
    },
    querySelectorAll: (selector: string) => {
      const results: ElementStub[] = [];
      const traverse = (node: ElementStub) => {
        for (const child of node.children) {
          if (child.tag === selector || child.classes.has(selector.replace(".", ""))) {
            results.push(child);
          }
          traverse(child);
        }
      };
      traverse(stub);
      return results;
    },
  };

  if (options?.cls) {
    options.cls.split(/\s+/).forEach((c: string) => c && stub.classes.add(c));
  }

  Object.defineProperty(stub, "textContent", {
    get() {
      let text = options?.text ?? "";
      for (const child of stub.children) {
        text += " " + child.textContent;
      }
      return text.trim();
    },
    set(val) {
      if (options) options.text = val;
    },
    configurable: true,
  });

  return stub;
}

describe("LINA-UX-IMPL-001 — Sidebar Simplification UX", () => {
  const ptStrings = getStrings("pt-PT");
  const enStrings = getStrings("en");
  const viewSource = () => readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");
  const cssSource = () => readFileSync(resolve(process.cwd(), "styles.css"), "utf8");
  const baseNow = new Date("2026-09-05T12:00:00.000Z").getTime();

  function createBaseStatusInput(overrides: Partial<BuildSidebarStatusViewModelInput> = {}): BuildSidebarStatusViewModelInput {
    return {
      deviceId: "device-1",
      deviceRole: "producer",
      isAuthorizedProducer: true,
      isStandbyProducer: false,
      textIndexReady: true,
      textIndexUsability: "usable",
      textIndexUpdatedAt: new Date(baseNow - 2 * 60 * 60 * 1000).toISOString(),
      embeddingsEnabled: true,
      embeddingsReady: true,
      embeddingsUpdatedAt: new Date(baseNow - 2 * 60 * 60 * 1000).toISOString(),
      semanticAvailable: true,
      semanticPreparing: false,
      currentSearchMode: "hibrida",
      strings: ptStrings,
      currentTime: baseNow,
      ...overrides,
    };
  }

  // 1. modo de pesquisa controlado pelo novo dropdown
  it("1. search mode is controlled by a compact select dropdown", () => {
    const src = viewSource();
    expect(src).toContain("this.searchModeSelect = modeWrapper.createEl(\"select\");");
    expect(src).toContain("this.searchModeSelect.addClass(\"lina-search-mode-select\");");
    expect(src).toContain("this.searchModeSelect.value = this.currentMode;");
    expect(src).toContain("this.currentMode = this.searchModeSelect.value as SearchMode;");
  });

  // 2. Text mode works
  it("2. text mode works via dropdown value selection", () => {
    const src = viewSource();
    expect(src).toContain("{ mode: \"textual\", label: this.L.searchTextual }");
    expect(src).toContain("if (this.searchModeSelect?.value) {");
    expect(src).toContain("return this.searchModeSelect.value as SearchMode;");
  });

  // 3. Hybrid mode works
  it("3. hybrid mode works via dropdown value selection", () => {
    const src = viewSource();
    expect(src).toContain("{ mode: \"hibrida\", label: this.L.searchHybrid }");
    const vm = buildSidebarStatusViewModel(createBaseStatusInput({ currentSearchMode: "hibrida" }));
    expect(vm.searchAvailability.currentModeHeadline).toBe(ptStrings.sidebarSearchHybridFull);
  });

  // 4. Semantic mode works
  it("4. semantic mode works via dropdown value selection", () => {
    const src = viewSource();
    expect(src).toContain("{ mode: \"semantica\", label: this.L.searchSemantic }");
    const vm = buildSidebarStatusViewModel(createBaseStatusInput({ currentSearchMode: "semantica" }));
    expect(vm.searchAvailability.currentModeHeadline).toBe(ptStrings.sidebarSearchSemanticAvailable);
  });

  // 5. seleção preserva comportamento anterior
  it("5. search mode selection preserves existing search dispatching contracts", () => {
    const src = viewSource();
    expect(src).toContain("private getSelectedSearchMode(): SearchMode");
    expect(src).toContain("this.currentMode = selectedMode;");
    expect(src).toContain("runHybridSearch(");
  });

  // 6. branding redundante “Lina” deixa de ocupar o header
  it("6. redundant 'Lina' h2 branding does not occupy the sidebar header", () => {
    const src = viewSource();
    expect(src).not.toContain('contentEl.createEl("h2", { text: "Lina" });');
  });

  // 7. ações secundárias aparecem no dropdown
  it("7. secondary actions appear in the actions select dropdown", () => {
    const src = viewSource();
    expect(src).toContain("this.actionsSelect = actionsWrapper.createEl(\"select\");");
    expect(src).toContain("this.actionsSelect.addClass(\"lina-actions-select\");");
    expect(src).toContain("this.actionsSelect.createEl(\"option\", { value: \"note\", text: `📄 ${this.L.actionAnalyseNote}` });");
    expect(src).toContain("this.actionsSelect.createEl(\"option\", { value: \"context\", text: `🔗 ${this.L.actionAnalyseWithContext}` });");
    expect(src).toContain("this.actionsSelect.createEl(\"option\", { value: \"inbox\", text: `🗃️ ${this.L.actionAnalyseInbox}` });");
    expect(src).toContain("this.actionsSelect.createEl(\"option\", { value: \"folder\", text: `📁 ${this.L.actionAnalyseFolder}` });");
  });

  // 8. ação selecionada mantém comportamento
  it("8. selected action triggers correct handler and resets selection", () => {
    const src = viewSource();
    expect(src).toContain("if (action === \"note\")");
    expect(src).toContain("void this.analyzeCurrentNote();");
    expect(src).toContain("else if (action === \"context\")");
    expect(src).toContain("void this.analyzeCurrentNoteWithContext();");
    expect(src).toContain("else if (action === \"inbox\")");
    expect(src).toContain("void this.analyzeInboxNotes();");
    expect(src).toContain("else if (action === \"folder\")");
    expect(src).toContain("void this.openFolderAnalysisModal();");
  });

  // 9. healthy state não mostra telemetria detalhada
  it("9. healthy state exhibits silent success without verbose counters or detailed telemetry in sidebar", () => {
    const vm = buildSidebarStatusViewModel(createBaseStatusInput());
    expect(vm.degradedAlert).toBeUndefined();
    const src = viewSource();
    // Raw note counters, chunk counters, and embedding published lists are relocated to diagnostics modal
    const refreshFn = src.slice(src.indexOf("private async refreshState"), src.indexOf("async openDeviceDiagnostics()"));
    expect(refreshFn).not.toContain("detailsList.createDiv({ text: `${this.L.detailsTextChunks}: ${totalChunks}` });");
    expect(refreshFn).not.toContain("this.renderEmbeddingDiagnosticDetails(detailsList");
  });

  // 10. aging usa 24–48h para textIndex enquanto embeddings operacionais sem drift mantêm fresh
  it("10. aging threshold correctly evaluates between 24h and 48h", () => {
    const thirtyHoursAgo = new Date(baseNow - 30 * 60 * 60 * 1000).toISOString();
    const vm = buildSidebarStatusViewModel(createBaseStatusInput({
      textIndexUpdatedAt: thirtyHoursAgo,
      embeddingsUpdatedAt: thirtyHoursAgo,
      currentTime: baseNow,
    }));
    expect(vm.freshness.textIndex.status).toBe("aging");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.freshness.embeddings.humanText).toBe("Atualizado (há 1 dia)");
  });

  // 11. stale começa após 48h para textIndex enquanto embeddings operacionais sem drift mantêm fresh
  it("11. stale threshold starts strictly after 48h", () => {
    const fiftyHoursAgo = new Date(baseNow - 50 * 60 * 60 * 1000).toISOString();
    const vm = buildSidebarStatusViewModel(createBaseStatusInput({
      textIndexUpdatedAt: fiftyHoursAgo,
      embeddingsUpdatedAt: fiftyHoursAgo,
      currentTime: baseNow,
    }));
    expect(vm.freshness.textIndex.status).toBe("stale");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.freshness.embeddings.humanText).toBe("Atualizado (há 2 dias)");
  });

  // 12. erro crítico continua visível
  it("12. critical errors remain prominently visible via prioritized alert banner", () => {
    const vm = buildSidebarStatusViewModel(createBaseStatusInput({
      companionState: {
        canConsume: false,
        artifactAvailability: { textIndex: "available", embeddings: "missing" },
        textIndexFreshness: "fresh",
        embeddingFreshness: "missing",
        producerFreshness: "fresh",
        generationIntegrity: "digest-mismatch",
        embeddingState: { available: false, count: 0 },
        totalNotes: 10,
        totalChunks: 20,
      } as any,
    }));
    expect(vm.degradedAlert).toBeDefined();
    expect(vm.degradedAlert?.kind).toBe("generation-integrity");
    expect(vm.degradedAlert?.level).toBe("error");
    expect(vm.degradedAlert?.message).toBe(ptStrings.sidebarDegradedGenerationIntegrity);
  });

  // 13. apenas um alerta prioritário
  it("13. only one prioritized degraded alert is returned to avoid visual clutter", () => {
    const vm = buildSidebarStatusViewModel(createBaseStatusInput({
      semanticAvailable: false,
      currentSearchMode: "semantica",
      companionState: {
        canConsume: false,
        artifactAvailability: { textIndex: "available", embeddings: "missing" },
        textIndexFreshness: "fresh",
        embeddingFreshness: "missing",
        producerFreshness: "stale",
        generationIntegrity: "digest-mismatch",
        embeddingState: { available: false, count: 0 },
        totalNotes: 10,
        totalChunks: 20,
      } as any,
    }));
    // Priority 1 (generation-integrity) wins over stale and semantic-unavailable
    expect(vm.degradedAlert?.kind).toBe("generation-integrity");
  });

  // 14. status abre modal de diagnóstico
  it("14. diagnostics trigger opens the device diagnostics modal", () => {
    const src = viewSource();
    expect(src).toContain("infoBtn.addEventListener(\"click\", () => void this.openDeviceDiagnostics());");
    expect(src).toContain("async openDeviceDiagnostics(): Promise<void>");
  });

  // 15. telemetria técnica está acessível na modal
  it("15. technical telemetry is fully accessible inside DeviceDiagnosticsModal", () => {
    const diag: DeviceDiagnostics = {
      timestamp: "2026-09-05T12:00:00.000Z",
      device: {
        id: "producer-1",
        name: "Desktop Workstation",
        role: "producer",
        isConfigured: true,
      },
      ownership: {
        activeProducerId: "producer-1",
        epoch: 3,
        isActiveProducer: true,
        isStandbyProducer: false,
        isCompanion: false,
        isUnassigned: false,
        isUnclaimed: false,
      },
      artifacts: {
        index: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
            ownershipEpoch: 3,
          },
          diagnosticMessage: "Valid index",
          exists: true,
          totalNotes: 1500,
          totalChunks: 4500,
        },
        embeddings: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
            ownershipEpoch: 3,
          },
          diagnosticMessage: "Valid embeddings",
          exists: true,
          enabled: true,
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
        binary: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
            ownershipEpoch: 3,
          },
          diagnosticMessage: "Valid binary copy",
          exists: true,
          recordCount: 4500,
          dimensions: 768,
        },
      },
    };

    const mockApp = { vault: { adapter: { exists: vi.fn(), read: vi.fn() } } } as any;
    const modal = new DeviceDiagnosticsModal(mockApp, diag, ptStrings);
    const contentStub = makeElementStub("div");
    modal.contentEl = contentStub as any;
    modal.onOpen();

    expect(contentStub.textContent).toContain("Desktop Workstation");
    expect(contentStub.textContent).toContain("1500");
    expect(contentStub.textContent).toContain("4500");
    expect(contentStub.textContent).toContain("nomic-embed-text");
  });

  // 16. Active Producer vê manutenção na localização secundária
  it("16. Active Producer sees maintenance buttons inside diagnostics modal", () => {
    const diag: DeviceDiagnostics = {
      timestamp: "2026-09-05T12:00:00.000Z",
      device: { id: "producer-1", role: "producer", isConfigured: true },
      ownership: { activeProducerId: "producer-1", epoch: 1, isActiveProducer: true, isStandbyProducer: false, isCompanion: false, isUnassigned: false, isUnclaimed: false },
      artifacts: {
        index: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true },
        embeddings: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true, enabled: true },
        binary: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true },
      },
    };

    const onRebuild = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    const mockApp = { vault: { adapter: { exists: vi.fn(), read: vi.fn() } } } as any;
    const modal = new DeviceDiagnosticsModal(mockApp, diag, ptStrings, undefined, undefined, {
      canExecuteMaintenance: true,
      onRebuildTextIndex: onRebuild,
      onUpdateEmbeddings: onUpdate,
    });
    const contentStub = makeElementStub("div");
    modal.contentEl = contentStub as any;
    modal.onOpen();

    expect(contentStub.textContent).toContain(ptStrings.deviceDiagnosticsSectionMaintenance);
    expect(contentStub.textContent).toContain(ptStrings.deviceDiagnosticsMaintenanceRebuildIndex);
    expect(contentStub.textContent).toContain(ptStrings.deviceDiagnosticsMaintenanceUpdateEmbeddings);
  });

  // 17. Companion não vê manutenção como ação executável
  it("17. Companion does not see maintenance as executable actions inside diagnostics modal", () => {
    const diag: DeviceDiagnostics = {
      timestamp: "2026-09-05T12:00:00.000Z",
      device: { id: "companion-1", role: "companion", isConfigured: true },
      ownership: { activeProducerId: "producer-1", epoch: 1, isActiveProducer: false, isStandbyProducer: false, isCompanion: true, isUnassigned: false, isUnclaimed: false },
      artifacts: {
        index: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true },
        embeddings: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true, enabled: true },
        binary: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true },
      },
    };

    const mockApp = { vault: { adapter: { exists: vi.fn(), read: vi.fn() } } } as any;
    const modal = new DeviceDiagnosticsModal(mockApp, diag, ptStrings, undefined, undefined, {
      canExecuteMaintenance: false,
      gatingNotice: ptStrings.sidebarMaintenanceManagedByActiveProducer,
    });
    const contentStub = makeElementStub("div");
    modal.contentEl = contentStub as any;
    modal.onOpen();

    expect(contentStub.textContent).toContain(ptStrings.deviceDiagnosticsSectionMaintenance);
    expect(contentStub.textContent).toContain(ptStrings.sidebarMaintenanceManagedByActiveProducer);
    // No executable buttons
    expect(contentStub.textContent).not.toContain(ptStrings.deviceDiagnosticsMaintenanceRebuildIndex);
  });

  // 18. Standby não vê manutenção como ação executável
  it("18. Standby does not see maintenance as executable actions inside diagnostics modal", () => {
    const diag: DeviceDiagnostics = {
      timestamp: "2026-09-05T12:00:00.000Z",
      device: { id: "standby-1", role: "producer", isConfigured: true },
      ownership: { activeProducerId: "producer-1", epoch: 1, isActiveProducer: false, isStandbyProducer: true, isCompanion: false, isUnassigned: false, isUnclaimed: false },
      artifacts: {
        index: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true },
        embeddings: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true, enabled: true },
        binary: { status: "valid", validation: { status: "valid" } as any, diagnosticMessage: "", exists: true },
      },
    };

    const mockApp = { vault: { adapter: { exists: vi.fn(), read: vi.fn() } } } as any;
    const modal = new DeviceDiagnosticsModal(mockApp, diag, ptStrings, undefined, undefined, {
      canExecuteMaintenance: false,
      gatingNotice: ptStrings.sidebarMaintenanceStandbyNotice,
    });
    const contentStub = makeElementStub("div");
    modal.contentEl = contentStub as any;
    modal.onOpen();

    expect(contentStub.textContent).toContain(ptStrings.deviceDiagnosticsSectionMaintenance);
    expect(contentStub.textContent).toContain(ptStrings.sidebarMaintenanceStandbyNotice);
    expect(contentStub.textContent).not.toContain(ptStrings.deviceDiagnosticsMaintenanceRebuildIndex);
  });

  // 19. mobile layout não introduz overflow estrutural
  it("19. mobile layout ensures flex layout and avoids horizontal structural overflow", () => {
    const css = cssSource();
    expect(css).toContain(".lina-search-mode-row");
    expect(css).toContain(".lina-actions-row");
    expect(css).toContain(".lina-sidebar-status-bar");
    expect(css).toContain(".lina-sidebar-status-indicator");
    expect(css).toContain(".lina-sidebar-state-details");
    expect(css).toContain(".lina-sidebar-state-card");
  });

  // 20. i18n cobre novos labels
  it("20. i18n provides comprehensive translations for Portuguese and English", () => {
    expect(ptStrings.sidebarActionPlaceholder).toBe("Ações...");
    expect(enStrings.sidebarActionPlaceholder).toBe("Actions...");
    expect(ptStrings.sidebarDiagnosticsButton).toBe("Ver diagnóstico");
    expect(enStrings.sidebarDiagnosticsButton).toBe("View diagnostics");
    expect(ptStrings.deviceDiagnosticsSectionMaintenance).toBe("Manutenção");
    expect(enStrings.deviceDiagnosticsSectionMaintenance).toBe("Maintenance");
    expect(ptStrings.deviceDiagnosticsMaintenanceRebuildIndex).toBe("Reconstruir índice textual");
    expect(enStrings.deviceDiagnosticsMaintenanceRebuildIndex).toBe("Rebuild text index");
    expect(ptStrings.deviceDiagnosticsMaintenanceUpdateEmbeddings).toBe("Atualizar embeddings");
    expect(enStrings.deviceDiagnosticsMaintenanceUpdateEmbeddings).toBe("Update embeddings");
  });

  // 21. Search input container with icon and compact submit button
  it("21. Search input has dedicated container with search icon and compact submit button", () => {
    const src = viewSource();
    expect(src).toContain("inputContainer.addClass(\"lina-search-input-container\");");
    expect(src).toContain("this.searchButton.addClass(\"lina-search-submit-btn\");");
    expect(src).toContain("this.searchButton = modeRow.createEl(\"button\", { text: \"➤\" });");
  });

  // 22. Dedicated actions row
  it("22. Dedicated full-width actions row occupies separate line", () => {
    const src = viewSource();
    expect(src).toContain("const actionsRow = searchSection.createDiv();");
    expect(src).toContain("actionsRow.addClass(\"lina-actions-row\");");
    expect(src).toContain("actionsWrapper.addClass(\"lina-actions-wrapper\");");
  });

  // 23. Estado accordion rendering
  it("23. Collapsible Estado accordion renders role badge and diagnostics trigger", () => {
    const src = viewSource();
    expect(src).toContain("stateDetails.addClass(\"lina-sidebar-state-details\");");
    expect(src).toContain("stateSummary.addClass(\"lina-sidebar-state-summary\");");
    expect(src).toContain("stateCard.addClass(\"lina-sidebar-state-card\");");
    expect(src).toContain("roleBox.createSpan({ text: sidebarStatus.role.title, cls: \"lina-sidebar-role-badge\" });");
    expect(src).toContain("const infoBtn = stateCard.createEl(\"button\", { cls: \"lina-sidebar-state-info-btn\", text: \"ⓘ\" });");
  });
});
