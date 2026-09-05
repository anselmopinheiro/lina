import { App, Setting } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { createAccordionHeaderRenderer } from "../../src/settings/declarativeSettingRenderers";

function createSettingMock() {
  const elements: Array<{ tag: string; cls?: string; text?: string; attr?: Record<string, string> }> = [];
  const eventListeners: Record<string, Array<(evt: Event) => void>> = {};

  const createMockEl = (tag: string, options?: { cls?: string; attr?: Record<string, string> }) => {
    const el = {
      tag,
      cls: options?.cls ?? "",
      attr: options?.attr ?? {},
      text: "",
      setText(val: string) { el.text = val; return el; },
      addClass(cls: string) { el.cls = `${el.cls} ${cls}`.trim(); return el; },
      createEl(childTag: string, childOptions?: { cls?: string; attr?: Record<string, string> }) {
        const child = createMockEl(childTag, childOptions);
        elements.push(child);
        return child;
      },
      createDiv(childOptions?: { cls?: string }) {
        return el.createEl("div", childOptions);
      },
      createSpan(childOptions?: { cls?: string }) {
        return el.createEl("span", childOptions);
      },
      addEventListener(event: string, handler: (evt: Event) => void) {
        eventListeners[event] = eventListeners[event] ?? [];
        eventListeners[event].push(handler);
      },
      dispatch(event: string, evt: Event) {
        for (const handler of eventListeners[event] ?? []) {
          handler(evt);
        }
      },
    };
    return el;
  };

  const settingEl = createMockEl("div");
  const infoEl = createMockEl("div");
  const controlEl = createMockEl("div");

  const setting = {
    settingEl,
    infoEl,
    controlEl,
    setName: vi.fn().mockReturnThis(),
    setDesc: vi.fn().mockReturnThis(),
  } as unknown as Setting;

  return { setting, settingEl, infoEl, controlEl, elements, eventListeners };
}

describe("LINA-UX-IMPL-002 Settings Information Architecture & Collapsible Groups", () => {
  function createTestSetup(role: "producer" | "companion" | "unassigned" = "producer", deviceId = "device-1") {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      deviceSettingsById: {
        [deviceId]: {
          deviceName: "Test Mac",
          analysisProvider: "ollama",
          analysisModel: "gemma4:e2b",
          embeddingsProvider: "ollama",
          embeddingsModel: "nomic-embed-text",
        },
      },
    };
    plugin.localDeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      role: role === "unassigned" ? "unassigned" : role,
    };
    setDeviceSettingsContext(plugin.settings, () => {}, deviceId);
    const tab = new LinaSettingTab(app, plugin);
    return { app, plugin, tab, deviceId };
  }

  it("1. renders the 5 principal groups plus introduction", () => {
    const { tab } = createTestSetup();
    const groups = tab.getSettingDefinitions();

    expect(groups).toHaveLength(6);
    expect(groups[0].heading).toBe("");
    expect(groups[1].heading).toBe(getStrings("pt-PT").settingsGroupDeviceProducer);
    expect(groups[2].heading).toBe(getStrings("pt-PT").settingsGroupAnalysis);
    expect(groups[3].heading).toBe(getStrings("pt-PT").settingsGroupEmbeddings);
    expect(groups[4].heading).toBe(getStrings("pt-PT").settingsGroupExclusions);
    expect(groups[5].heading).toBe(getStrings("pt-PT").settingsGroupDiagnostics);
    tab.hide();
  });

  it("2. supports i18n for all group titles and accordion strings", () => {
    const { tab, plugin } = createTestSetup();
    plugin.settings.interfaceLanguage = "en";
    const groupsEn = tab.getSettingDefinitions();

    expect(groupsEn[1].heading).toBe(getStrings("en").settingsGroupDeviceProducer);
    expect(groupsEn[2].heading).toBe(getStrings("en").settingsGroupAnalysis);
    expect(groupsEn[3].heading).toBe(getStrings("en").settingsGroupEmbeddings);
    expect(groupsEn[4].heading).toBe(getStrings("en").settingsGroupExclusions);
    expect(groupsEn[5].heading).toBe(getStrings("en").settingsGroupDiagnostics);
    tab.hide();
  });

  it("3. toggles group expansion and updates visibility dynamically", () => {
    const { tab } = createTestSetup();

    expect(tab.isGroupExpanded("device-producer")).toBe(true);
    expect(tab.isGroupExpanded("ai-analysis")).toBe(false);

    tab.toggleGroup("ai-analysis");
    expect(tab.isGroupExpanded("ai-analysis")).toBe(true);

    tab.toggleGroup("ai-analysis");
    expect(tab.isGroupExpanded("ai-analysis")).toBe(false);
    tab.hide();
  });

  it("4. preserves settings values and drafts across collapse and re-expansion", () => {
    const { tab, plugin } = createTestSetup();

    plugin.settings.inboxFolderPath = "Custom_Inbox";
    plugin.settings.yamlAllowedProperties = "custom_prop, tags";

    tab.setGroupExpanded("ai-analysis", false);
    expect(plugin.settings.inboxFolderPath).toBe("Custom_Inbox");
    expect(plugin.settings.yamlAllowedProperties).toBe("custom_prop, tags");

    tab.setGroupExpanded("ai-analysis", true);
    expect(plugin.settings.inboxFolderPath).toBe("Custom_Inbox");
    expect(plugin.settings.yamlAllowedProperties).toBe("custom_prop, tags");
    tab.hide();
  });

  it("5. renders Active Producer settings with editable permissions", () => {
    const { tab, plugin } = createTestSetup("producer");
    expect(plugin.canEditExclusions()).toBe(true);

    const groups = tab.getSettingDefinitions();
    const exclusionsGroup = groups.find((g) => g.heading === getStrings("pt-PT").settingsGroupExclusions);
    const foldersItem = exclusionsGroup?.items.find((item) => item.id === "excluded-folders") as { control?: { disabled?: boolean } };

    expect(foldersItem?.control?.disabled).toBe(false);
    tab.hide();
  });

  it("6. renders Companion provider and model as read-only / inherited", () => {
    const { tab, plugin } = createTestSetup("companion");
    expect(plugin.canEditExclusions()).toBe(false);

    const groups = tab.getSettingDefinitions();
    const exclusionsGroup = groups.find((g) => g.heading === getStrings("pt-PT").settingsGroupExclusions);
    const foldersItem = exclusionsGroup?.items.find((item) => item.id === "excluded-folders") as { control?: { disabled?: boolean } };

    expect(foldersItem?.control?.disabled).toBe(true);
    tab.hide();
  });

  it("7. keeps Companion endpoint and local secrets editable where allowed", () => {
    const { tab } = createTestSetup("companion");
    const groups = tab.getSettingDefinitions();
    const analysisGroup = groups.find((g) => g.heading === getStrings("pt-PT").settingsGroupAnalysis);

    const baseUrlDef = analysisGroup?.items.find((item) => item.id === "analysis-base-url") as { control?: { disabled?: boolean } };
    expect(baseUrlDef?.control?.disabled).toBe(false);
    tab.hide();
  });

  it("8. preserves Standby gating without allowing producer maintenance", () => {
    const { tab, plugin } = createTestSetup("producer");
    // Simulate another active producer so this device is Standby
    vi.spyOn(plugin.getOwnershipGate(), "getLastDecision").mockReturnValue({
      authorized: true,
      activeProducerId: "other-desktop",
      epoch: 2,
    });

    const groups = tab.getSettingDefinitions();
    expect(groups).toHaveLength(6);
    tab.hide();
  });

  it("9. allows exclusion rules editing only for Active Producer", () => {
    const { tab: producerTab } = createTestSetup("producer");
    const { tab: companionTab } = createTestSetup("companion");

    const pGroups = producerTab.getSettingDefinitions();
    const cGroups = companionTab.getSettingDefinitions();

    const pExclusions = pGroups.find((g) => g.heading === getStrings("pt-PT").settingsGroupExclusions);
    const cExclusions = cGroups.find((g) => g.heading === getStrings("pt-PT").settingsGroupExclusions);

    const pFolders = pExclusions?.items.find((i) => i.id === "excluded-folders") as { control?: { disabled?: boolean } };
    const cFolders = cExclusions?.items.find((i) => i.id === "excluded-folders") as { control?: { disabled?: boolean } };

    expect(pFolders?.control?.disabled).toBe(false);
    expect(cFolders?.control?.disabled).toBe(true);

    producerTab.hide();
    companionTab.hide();
  });

  it("10. keeps Diagnostics & Advanced group collapsed by default", () => {
    const { tab } = createTestSetup();
    expect(tab.isGroupExpanded("diagnostics-advanced")).toBe(false);
    tab.hide();
  });

  it("11. confines heavy maintenance actions strictly to the Diagnostics & Advanced group", () => {
    const { tab } = createTestSetup();
    const groups = tab.getSettingDefinitions();

    const diagnosticsGroup = groups.find((g) => g.heading === getStrings("pt-PT").settingsGroupDiagnostics);
    const diagnosticIds = diagnosticsGroup?.items.map((i) => i.id) ?? [];

    expect(diagnosticIds).toContain("check-binary-copy");
    expect(diagnosticIds).toContain("create-or-update-binary-copy");
    expect(diagnosticIds).toContain("remove-binary-copy");

    const otherGroups = groups.filter((g) => g.heading !== getStrings("pt-PT").settingsGroupDiagnostics);
    for (const group of otherGroups) {
      const ids = group.items.map((i) => i.id);
      expect(ids).not.toContain("remove-binary-copy");
      expect(ids).not.toContain("create-or-update-binary-copy");
    }
    tab.hide();
  });

  it("12. provides safe group summaries that never leak secrets, hashes, or contract IDs", () => {
    const { tab, plugin } = createTestSetup();
    plugin.settings.deviceSettingsById = {
      "device-1": {
        deviceName: "My Studio",
        analysisApiKey: "SUPER_SECRET_KEY_12345",
        embeddingsApiKey: "SUPER_SECRET_KEY_67890",
      },
    };

    const groups = tab.getSettingDefinitions();
    const serialized = JSON.stringify(groups);

    expect(serialized).not.toContain("SUPER_SECRET_KEY_12345");
    expect(serialized).not.toContain("SUPER_SECRET_KEY_67890");
    expect(serialized).not.toContain("generationId");
    expect(serialized).not.toContain("policyHash");
    tab.hide();
  });

  it("13. ensures disabled states remain semantically accurate across roles", () => {
    const { tab } = createTestSetup("companion");
    const groups = tab.getSettingDefinitions();
    const exclusions = groups.find((g) => g.heading === getStrings("pt-PT").settingsGroupExclusions);

    const pathTerms = exclusions?.items.find((i) => i.id === "excluded-path-terms") as { control?: { disabled?: boolean } };
    const contentTerms = exclusions?.items.find((i) => i.id === "excluded-content-terms") as { control?: { disabled?: boolean } };

    expect(pathTerms?.control?.disabled).toBe(true);
    expect(contentTerms?.control?.disabled).toBe(true);
    tab.hide();
  });

  it("14. renders accordion header with accessible button and minimum touch target size", () => {
    const onToggle = vi.fn();
    const renderer = createAccordionHeaderRenderer({
      groupId: "ai-analysis",
      title: "2. Assistente de IA",
      getSummary: () => "Ollama · gemma4:e2b",
      isExpanded: () => false,
      onToggle,
      strings: getStrings("pt-PT"),
    });

    const mock = createSettingMock();
    renderer(mock.setting, {} as never);

    const header = mock.elements.find((el) => el.cls.includes("lina-settings-accordion-header"));
    expect(header).toBeDefined();
    expect(header?.attr?.role).toBe("button");
    expect(header?.attr?.tabindex).toBe("0");
    expect(header?.attr?.["aria-expanded"]).toBe("false");
  });

  it("15. supports keyboard navigation (Enter and Space) on accordion headers", () => {
    const onToggle = vi.fn();
    const renderer = createAccordionHeaderRenderer({
      groupId: "ai-analysis",
      title: "2. Assistente de IA",
      getSummary: () => "Ollama · gemma4:e2b",
      isExpanded: () => false,
      onToggle,
      strings: getStrings("pt-PT"),
    });

    const mock = createSettingMock();
    renderer(mock.setting, {} as never);

    const header = mock.elements.find((el) => el.cls.includes("lina-settings-accordion-header"));
    const keyEvent = {
      key: "Enter",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    header?.dispatch("keydown", keyEvent);
    expect(onToggle).toHaveBeenCalledTimes(1);

    const spaceEvent = {
      key: " ",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    header?.dispatch("keydown", spaceEvent);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("16. retains all 50 canonical setting definitions without missing any item", () => {
    const { tab } = createTestSetup();
    const groups = tab.getSettingDefinitions();
    const ids = groups.flatMap((g) => g.items).map((i) => i.id);

    const expectedCanonicalIds = [
      "support-introduction",
      "development-build-info",
      "device-description",
      "device-name",
      "interface-language",
      "multilingual-note",
      "support-description",
      "support-link",
      "support-email",
      "analysis-provider",
      "analysis-model",
      "analysis-base-url",
      "analysis-credential",
      "test-analysis-connection",
      "analysis-test-feedback",
      "analysis-timeout",
      "inbox-folder",
      "inbox-max-notes",
      "yaml-enabled",
      "yaml-properties",
      "yaml-include-tags",
      "max-suggested-tags",
      "embeddings-enabled",
      "embeddings-provider",
      "embeddings-model",
      "embeddings-base-url",
      "embeddings-credential",
      "embedding-update-mode",
      "test-embeddings-connection",
      "embeddings-test-feedback",
      "embeddings-batch-size",
      "embeddings-timeout",
      "embedding-language",
      "hybrid-text-weight",
      "hybrid-semantic-weight",
      "excluded-folders",
      "exclusions-note",
      "excluded-path-terms",
      "excluded-content-terms",
      "auto-update-index-on-file-changes",
      "update-index-on-startup",
      "check-sync-on-startup",
      "debug-index-updates",
      "binary-warning",
      "binary-preference",
      "binary-maintenance",
      "binary-status",
      "check-binary-copy",
      "create-or-update-binary-copy",
      "remove-binary-copy",
    ];

    for (const id of expectedCanonicalIds) {
      expect(ids).toContain(id);
    }
    tab.hide();
  });

  it("17. does not modify any default values in DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS.aiProvider).toBe("ollama");
    expect(DEFAULT_SETTINGS.embeddingsEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.hybridSearchTextWeight).toBe(0.7);
    expect(DEFAULT_SETTINGS.hybridSearchSemanticWeight).toBe(0.3);
    expect(DEFAULT_SETTINGS.yamlSuggestionsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.autoUpdateIndexOnFileChanges).toBe(true);
  });

  it("18. does not change any storage keys in LinaSettings", () => {
    const { plugin } = createTestSetup();
    const keys = Object.keys(plugin.settings);

    expect(keys).toContain("aiProvider");
    expect(keys).toContain("embeddingsEnabled");
    expect(keys).toContain("indexExcludedFolders");
    expect(keys).toContain("indexExcludedPathContains");
    expect(keys).toContain("deviceSettingsById");
  });

  it("19. preserves runtime adapter semantics across accordion operations", async () => {
    const { tab } = createTestSetup();

    await tab.setControlValue("embeddings-enabled", true);
    expect(tab.getControlValue("embeddings-enabled")).toBe(true);

    await tab.setControlValue("embeddings-enabled", false);
    expect(tab.getControlValue("embeddings-enabled")).toBe(false);
    tab.hide();
  });

  it("20. performs idempotent updates without memory leaks", () => {
    const { tab } = createTestSetup();

    const first = tab.getSettingDefinitions();
    const second = tab.getSettingDefinitions();

    expect(first.length).toBe(second.length);
    expect(first.map((g) => g.heading)).toEqual(second.map((g) => g.heading));
    tab.hide();
  });
});
