import { App, type SettingDefinitionPage } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";

describe("LINA-04 intent-based native settings pages", () => {
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
    return { tab: new LinaSettingTab(app, plugin) };
  }

  function pages(tab: LinaSettingTab): Array<SettingDefinitionPage & { id: string; visible?: boolean }> {
    return tab.getSettingDefinitions().filter((item): item is SettingDefinitionPage & { id: string; visible?: boolean } => item.type === "page");
  }

  it("renders the approved intent-based page order plus the support footer", () => {
    const { tab } = createTestSetup();
    const definitions = tab.getSettingDefinitions();
    expect(pages(tab).map((page) => page.id)).toEqual([
      "general", "search", "ai-analysis", "producer", "diagnostics",
    ]);
    expect(definitions.at(-1)?.type).toBe("group");
    expect(definitions.at(-1)?.heading).toBe(getStrings("pt-PT").settingsSupportSection);
    tab.hide();
  });

  it("keeps all canonical setting IDs exactly once across root groups and pages", () => {
    const { tab } = createTestSetup();
    const ids = tab.getSettingDefinitions().flatMap((definition) => definition.items?.map((item) => (item as { id: string }).id) ?? []);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toContain("create-or-update-binary-copy");
    expect(ids).toContain("embeddings-credential");
    expect(ids).toContain("development-build-info");
    tab.hide();
  });

  it("shows Producer page only for a Producer device and hides it for a Companion device", () => {
    const { tab: producerTab } = createTestSetup("producer");
    const producerPages = new Map(pages(producerTab).map((page) => [page.id, page]));
    expect(producerPages.get("producer")?.visible).toBe(true);
    expect(producerPages.get("producer")?.items?.map((item) => (item as { id: string }).id)).toContain("embedding-update-mode");
    producerTab.hide();

    const { tab: companionTab } = createTestSetup("companion");
    const companionPages = new Map(pages(companionTab).map((page) => [page.id, page]));
    expect(companionPages.get("producer")?.visible).toBe(false);
    companionTab.hide();
  });

  it("preserves search settings on Companion device and keeps exclusions note in general", () => {
    const { tab } = createTestSetup("companion");
    const byId = new Map(pages(tab).map((page) => [page.id, page]));
    expect(byId.get("producer")?.visible).toBe(false);
    expect(byId.get("general")?.items?.map((item) => (item as { id: string }).id)).toContain("exclusions-note");
    expect(byId.get("search")?.items?.map((item) => (item as { id: string }).id)).toEqual([
      "embeddings-enabled", "embeddings-provider", "embeddings-model", "embeddings-base-url", "embeddings-credential",
      "test-embeddings-connection", "embeddings-test-feedback", "embeddings-timeout", "embedding-language", "hybrid-text-weight", "hybrid-semantic-weight",
    ]);
    tab.hide();
  });

  it("consolidates synchronization, diagnostics, and debug settings in diagnostics page", () => {
    const { tab } = createTestSetup();
    const byId = new Map(pages(tab).map((page) => [page.id, page]));
    expect(byId.get("diagnostics")?.items?.map((item) => (item as { id: string }).id)).toEqual([
      "check-sync-on-startup", "binary-warning", "binary-status", "check-binary-copy", "binary-preference", "debug-index-updates",
    ]);
    expect(byId.get("diagnostics")?.items?.map((item) => (item as { id: string }).id)).not.toContain("remove-binary-copy");
    tab.hide();
  });

  it("preserves settings schema and defaults", () => {
    expect(DEFAULT_SETTINGS.embeddingsEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.embeddingProvider).toBe("ollama");
    expect(DEFAULT_SETTINGS.embeddingModel).toBe("nomic-embed-text");
    expect(DEFAULT_SETTINGS.settingsSchemaVersion).toBe(1);
  });
});
