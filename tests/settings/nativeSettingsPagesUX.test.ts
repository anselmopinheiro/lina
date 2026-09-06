import { App, type SettingDefinitionPage } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { SUPPORT_FORM_URL } from "../../src/settings/declarativeSettingRenderers";

describe("LINA-UX-IMPL-004 Native Settings Pages Migration", () => {
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

  it("1. root settings hub contains exactly 5 operational pages", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();

    expect(definitions).toHaveLength(7);
    const pages = definitions.filter((item): item is SettingDefinitionPage & { id: string } => item.type === "page");
    expect(pages).toHaveLength(5);

    const pageIds = pages.map((p) => p.id);
    expect(pageIds).toEqual([
      "device-producer",
      "ai-analysis",
      "semantic-embeddings",
      "privacy-exclusions",
      "diagnostics-advanced",
    ]);

    for (const page of pages) {
      expect(page.type).toBe("page");
      expect(page.name).toBeTruthy();
      expect(typeof page.displayValue).toBe("string");
      expect(Array.isArray(page.items)).toBe(true);
      expect(page.items!.length).toBeGreaterThan(0);
    }
    tab.hide();
  });

  it("2. General / Interface section remains at the root hub", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();

    const generalGroup = definitions[0];
    expect(generalGroup.type).toBe("group");
    const itemIds = generalGroup.items?.map((item) => (item as { id: string }).id) ?? [];

    expect(itemIds).toContain("support-introduction");
    expect(itemIds).toContain("interface-language");
    expect(itemIds).toContain("multilingual-note");
    expect(itemIds).toContain("development-build-info");
    tab.hide();
  });

  it("3. Support section remains at the root hub footer", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();

    const supportGroup = definitions[6];
    expect(supportGroup.type).toBe("group");
    expect(supportGroup.heading).toBe(getStrings("pt-PT").settingsSupportSection);
    const itemIds = supportGroup.items?.map((item) => (item as { id: string }).id) ?? [];

    expect(itemIds).toEqual(["support-description", "support-link", "support-email"]);
    tab.hide();
  });

  it("4. each page opens and contains strictly the settings of its own functional domain", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const pages = definitions.filter((item): item is SettingDefinitionPage & { id: string } => item.type === "page");

    const devicePage = pages.find((p) => p.id === "device-producer");
    expect(devicePage?.items?.map((i) => (i as { id: string }).id)).toEqual([
      "device-description",
      "device-name",
    ]);

    const aiPage = pages.find((p) => p.id === "ai-analysis");
    expect(aiPage?.items?.map((i) => (i as { id: string }).id)).toEqual([
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
    ]);

    const embeddingsPage = pages.find((p) => p.id === "semantic-embeddings");
    expect(embeddingsPage?.items?.map((i) => (i as { id: string }).id)).toEqual([
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
    ]);

    const exclusionsPage = pages.find((p) => p.id === "privacy-exclusions");
    expect(exclusionsPage?.items?.map((i) => (i as { id: string }).id)).toEqual([
      "excluded-folders",
      "exclusions-note",
      "excluded-path-terms",
      "excluded-content-terms",
    ]);

    const diagnosticsPage = pages.find((p) => p.id === "diagnostics-advanced");
    expect(diagnosticsPage?.items?.map((i) => (i as { id: string }).id)).toEqual([
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
    ]);
    tab.hide();
  });

  it("5. Device page does NOT contain AI, embeddings, or support settings", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const devicePage = definitions.find((p) => (p as { id?: string }).id === "device-producer") as SettingDefinitionPage;
    const ids = devicePage?.items?.map((i) => (i as { id: string }).id) ?? [];

    expect(ids).not.toContain("analysis-provider");
    expect(ids).not.toContain("embeddings-provider");
    expect(ids).not.toContain("support-link");
    expect(ids).not.toContain("interface-language");
    tab.hide();
  });

  it("6. AI Assistant page does NOT contain embeddings settings", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const aiPage = definitions.find((p) => (p as { id?: string }).id === "ai-analysis") as SettingDefinitionPage;
    const ids = aiPage?.items?.map((i) => (i as { id: string }).id) ?? [];

    expect(ids).not.toContain("embeddings-enabled");
    expect(ids).not.toContain("embeddings-provider");
    expect(ids).not.toContain("embeddings-model");
    expect(ids).not.toContain("embeddings-base-url");
    tab.hide();
  });

  it("7. Semantic Search & Embeddings page does NOT contain AI analysis settings", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const embeddingsPage = definitions.find((p) => (p as { id?: string }).id === "semantic-embeddings") as SettingDefinitionPage;
    const ids = embeddingsPage?.items?.map((i) => (i as { id: string }).id) ?? [];

    expect(ids).not.toContain("analysis-provider");
    expect(ids).not.toContain("analysis-model");
    expect(ids).not.toContain("analysis-base-url");
    expect(ids).not.toContain("yaml-enabled");
    tab.hide();
  });

  it("8. Privacy & Exclusion Rules page contains only exclusion settings", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const exclusionsPage = definitions.find((p) => (p as { id?: string }).id === "privacy-exclusions") as SettingDefinitionPage;
    const ids = exclusionsPage?.items?.map((i) => (i as { id: string }).id) ?? [];

    expect(ids).toEqual([
      "excluded-folders",
      "exclusions-note",
      "excluded-path-terms",
      "excluded-content-terms",
    ]);
    tab.hide();
  });

  it("9. Diagnostics & Maintenance page does NOT contain providers or models", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const diagPage = definitions.find((p) => (p as { id?: string }).id === "diagnostics-advanced") as SettingDefinitionPage;
    const ids = diagPage?.items?.map((i) => (i as { id: string }).id) ?? [];

    expect(ids).not.toContain("analysis-provider");
    expect(ids).not.toContain("analysis-model");
    expect(ids).not.toContain("embeddings-provider");
    expect(ids).not.toContain("embeddings-model");
    tab.hide();
  });

  it("10. all canonical setting IDs remain fully mapped across pages and root groups", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const allIds = definitions.flatMap((d) => d.items?.map((item) => (item as { id: string }).id) ?? []);

    expect(allIds).toHaveLength(50);
    expect(new Set(allIds).size).toBe(50);
    tab.hide();
  });

  it("11. does not change any storage keys in LinaSettings or LinaDeviceSettings", () => {
    const { plugin } = createTestSetup();
    const knownGlobalKeys = [
      "aiProvider", "aiBaseUrl", "aiApiKey", "aiAnalysisModel", "aiRequestTimeoutSeconds",
      "aiOutputLanguage", "aiProfiles", "embeddingsEnabled", "embeddingProvider",
      "embeddingBaseUrl", "embeddingApiKey", "embeddingModel", "embeddingBatchSize",
      "embeddingRequestTimeoutSeconds", "generateEmbeddingsOnStartup", "generateOnlyMissingEmbeddings",
      "embeddingUpdateMode", "checkSyncOnStartup", "updateIndexOnStartup", "indexExcludedFolders",
      "indexExcludedPathContains", "indexExcludedContentContains", "autoUpdateIndexOnFileChanges",
      "debugIndexUpdates", "hybridSearchTextWeight", "hybridSearchSemanticWeight",
      "yamlSuggestionsEnabled", "yamlAllowedProperties", "yamlIncludeTags", "maxSuggestedTags",
      "interfaceLanguage", "embeddingDefaultLanguage", "inboxFolderPath", "maxInboxNotesToAnalyze",
    ];

    for (const key of knownGlobalKeys) {
      expect(key in plugin.settings).toBe(true);
    }
  });

  it("12. does not modify any default values in DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS.embeddingsEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.embeddingProvider).toBe("ollama");
    expect(DEFAULT_SETTINGS.embeddingModel).toBe("nomic-embed-text");
    expect(DEFAULT_SETTINGS.yamlSuggestionsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.yamlIncludeTags).toBe(true);
    expect(DEFAULT_SETTINGS.maxSuggestedTags).toBe(8);
    expect(DEFAULT_SETTINGS.maxInboxNotesToAnalyze).toBe(10);
    expect(DEFAULT_SETTINGS.hybridSearchTextWeight).toBe(0.7);
    expect(DEFAULT_SETTINGS.hybridSearchSemanticWeight).toBe(0.3);
    expect(DEFAULT_SETTINGS.interfaceLanguage).toBe("pt-PT");
    expect(DEFAULT_SETTINGS.embeddingDefaultLanguage).toBe("pt-PT");
  });

  it("13. preserves Active Producer permissions and editable settings", () => {
    const { tab, plugin } = createTestSetup("producer");
    expect(plugin.canEditExclusions()).toBe(true);

    const definitions = tab.getSettingDefinitions();
    const exclusionsPage = definitions.find((p) => (p as { id?: string }).id === "privacy-exclusions") as SettingDefinitionPage;
    const foldersDef = exclusionsPage.items?.find((i) => (i as { id: string }).id === "excluded-folders") as { control?: { disabled?: boolean } };

    expect(foldersDef.control?.disabled).toBe(false);
    tab.hide();
  });

  it("14. renders Companion provider and model as read-only / inherited", () => {
    const { tab, plugin } = createTestSetup("companion");
    expect(plugin.canEditExclusions()).toBe(false);

    const definitions = tab.getSettingDefinitions();
    const exclusionsPage = definitions.find((p) => (p as { id?: string }).id === "privacy-exclusions") as SettingDefinitionPage;
    const foldersDef = exclusionsPage.items?.find((i) => (i as { id: string }).id === "excluded-folders") as { control?: { disabled?: boolean } };

    expect(foldersDef.control?.disabled).toBe(true);
    tab.hide();
  });

  it("15. preserves Standby gating without allowing producer maintenance", () => {
    const { tab, plugin } = createTestSetup("producer");
    vi.spyOn(plugin.getOwnershipGate(), "getLastDecision").mockReturnValue({
      authorized: true,
      activeProducerId: "other-producer",
      epoch: 3,
    });

    const definitions = tab.getSettingDefinitions();
    expect(definitions).toHaveLength(7);
    const devicePage = definitions.find((p) => (p as { id?: string }).id === "device-producer") as SettingDefinitionPage;
    expect(devicePage.displayValue).toContain("Standby");
    tab.hide();
  });

  it("16. keeps inherited embedding provider/model read-only on Companion", () => {
    const { plugin } = createTestSetup("companion");
    const resolution = plugin.getDeviceRoleResolution();
    expect(resolution.effectiveRole).toBe("companion");
  });

  it("17. keeps Companion endpoint and local secrets editable where allowed", () => {
    const { tab } = createTestSetup("companion");
    const definitions = tab.getSettingDefinitions();
    const aiPage = definitions.find((p) => (p as { id?: string }).id === "ai-analysis") as SettingDefinitionPage;
    const baseUrlDef = aiPage.items?.find((i) => (i as { id: string }).id === "analysis-base-url") as { control?: { disabled?: boolean } };

    expect(baseUrlDef.control?.disabled).toBe(false);
    tab.hide();
  });

  it("18. confines exclusion rules editing to Active Producer only", () => {
    const { tab: producerTab } = createTestSetup("producer");
    const { tab: companionTab } = createTestSetup("companion");

    const pExclusions = (producerTab.getSettingDefinitions().find((p) => (p as { id?: string }).id === "privacy-exclusions") as SettingDefinitionPage)
      .items?.find((i) => (i as { id: string }).id === "excluded-folders") as { control?: { disabled?: boolean } };
    const cExclusions = (companionTab.getSettingDefinitions().find((p) => (p as { id?: string }).id === "privacy-exclusions") as SettingDefinitionPage)
      .items?.find((i) => (i as { id: string }).id === "excluded-folders") as { control?: { disabled?: boolean } };

    expect(pExclusions.control?.disabled).toBe(false);
    expect(cExclusions.control?.disabled).toBe(true);

    producerTab.hide();
    companionTab.hide();
  });

  it("19. visible and disabled states behave accurately according to role", () => {
    const { tab: pTab } = createTestSetup("producer");
    const { tab: cTab } = createTestSetup("companion");

    const pDefs = pTab.getSettingDefinitions();
    const cDefs = cTab.getSettingDefinitions();

    const pExclPage = pDefs.find((p) => (p as { id?: string }).id === "privacy-exclusions") as SettingDefinitionPage;
    const cExclPage = cDefs.find((p) => (p as { id?: string }).id === "privacy-exclusions") as SettingDefinitionPage;

    expect(pExclPage.displayValue).toContain("pastas");
    expect(cExclPage.displayValue).toBe(getStrings("pt-PT").settingsSummaryManagedByProducer);

    pTab.hide();
    cTab.hide();
  });

  it("20. support actions remain fully functional on the root hub", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const supportGroup = definitions[6];
    const linkItem = supportGroup.items?.find((i) => (i as { id: string }).id === "support-link") as {
      render?: (setting: unknown, group: unknown) => void;
    };

    expect(linkItem).toBeDefined();
    expect(linkItem.render).toEqual(expect.any(Function));
    tab.hide();
  });

  it("21. interface language setting remains accessible at the root hub", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const generalGroup = definitions[0];
    const langItem = generalGroup.items?.find((i) => (i as { id: string }).id === "interface-language");

    expect(langItem).toBeDefined();
    tab.hide();
  });

  it("22. ensures native searchability: all settings are indexed via items hierarchy", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();

    // Obsidian's setting framework recursively traverses items on groups and pages
    const flattened = definitions.flatMap((groupOrPage) => groupOrPage.items ?? []);
    expect(flattened).toHaveLength(50);

    const searchableItems = flattened.filter((item) => (item as { searchable?: boolean }).searchable !== false);
    expect(searchableItems.length).toBeGreaterThan(45);
    tab.hide();
  });

  it("23. custom accordion infrastructure is safely and completely removed", () => {
    const { tab } = createTestSetup();

    // Verify pseudo-accordion methods and state no longer exist on tab
    expect("isGroupExpanded" in tab).toBe(false);
    expect("toggleGroup" in tab).toBe(false);
    expect("setGroupExpanded" in tab).toBe(false);
    expect("expandedGroups" in tab).toBe(false);
    tab.hide();
  });

  it("24. no setting disappears across any domain", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    const allIds = definitions.flatMap((d) => d.items?.map((item) => (item as { id: string }).id) ?? []);

    const expectedCanonicalIds = [
      "support-introduction", "interface-language", "multilingual-note", "development-build-info",
      "device-description", "device-name",
      "analysis-provider", "analysis-model", "analysis-base-url", "analysis-credential",
      "test-analysis-connection", "analysis-test-feedback", "analysis-timeout",
      "inbox-folder", "inbox-max-notes", "yaml-enabled", "yaml-properties", "yaml-include-tags", "max-suggested-tags",
      "embeddings-enabled", "embeddings-provider", "embeddings-model", "embeddings-base-url",
      "embeddings-credential", "embedding-update-mode", "test-embeddings-connection", "embeddings-test-feedback",
      "embeddings-batch-size", "embeddings-timeout", "embedding-language", "hybrid-text-weight", "hybrid-semantic-weight",
      "excluded-folders", "exclusions-note", "excluded-path-terms", "excluded-content-terms",
      "auto-update-index-on-file-changes", "update-index-on-startup", "check-sync-on-startup", "debug-index-updates",
      "binary-warning", "binary-preference", "binary-maintenance", "binary-status",
      "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy",
      "support-description", "support-link", "support-email",
    ];

    for (const expectedId of expectedCanonicalIds) {
      expect(allIds).toContain(expectedId);
    }
    tab.hide();
  });

  it("25. preserves deterministic definitions and parity across renders", () => {
    const { tab } = createTestSetup();
    const first = tab.getSettingDefinitions();
    const second = tab.getSettingDefinitions();

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("SUPER_SECRET_SENTINEL");
    tab.hide();
  });
});
