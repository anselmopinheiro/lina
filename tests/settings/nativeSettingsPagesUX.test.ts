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
      "general", "search", "ai-analysis", "producer", "companion", "synchronization", "diagnostics", "advanced",
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

  it("shows Producer and hides Companion for a Producer device", () => {
    const { tab } = createTestSetup("producer");
    const byId = new Map(pages(tab).map((page) => [page.id, page]));
    expect(byId.get("producer")?.visible).toBe(true);
    expect(byId.get("companion")?.visible).toBe(false);
    expect(byId.get("producer")?.items?.map((item) => (item as { id: string }).id)).toContain("embedding-update-mode");
    tab.hide();
  });

  it("shows Companion and hides Producer for a Companion device without removing inherited search settings", () => {
    const { tab } = createTestSetup("companion");
    const byId = new Map(pages(tab).map((page) => [page.id, page]));
    expect(byId.get("producer")?.visible).toBe(false);
    expect(byId.get("companion")?.visible).toBe(true);
    expect(byId.get("companion")?.desc).toBe(getStrings("pt-PT").settingsCompanionModeDesc);
    expect(byId.get("search")?.items?.map((item) => (item as { id: string }).id)).toEqual([
      "embeddings-enabled", "embeddings-provider", "embeddings-model", "embeddings-base-url", "embeddings-credential",
      "test-embeddings-connection", "embeddings-test-feedback", "embeddings-timeout", "embedding-language", "hybrid-text-weight", "hybrid-semantic-weight",
    ]);
    tab.hide();
  });

  it("separates synchronization, read-only diagnostics, and advanced maintenance", () => {
    const { tab } = createTestSetup();
    const byId = new Map(pages(tab).map((page) => [page.id, page]));
    expect(byId.get("synchronization")?.items?.map((item) => (item as { id: string }).id)).toEqual(["check-sync-on-startup"]);
    expect(byId.get("diagnostics")?.items?.map((item) => (item as { id: string }).id)).toEqual(["device-description", "binary-warning", "binary-status", "check-binary-copy", "binary-preference"]);
    expect(byId.get("advanced")?.items?.map((item) => (item as { id: string }).id)).toEqual(["debug-index-updates"]);
    expect(byId.get("advanced")?.items?.map((item) => (item as { id: string }).id)).not.toContain("remove-binary-copy");
    tab.hide();
  });

  it("preserves settings schema and defaults", () => {
    expect(DEFAULT_SETTINGS.embeddingsEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.embeddingProvider).toBe("ollama");
    expect(DEFAULT_SETTINGS.embeddingModel).toBe("nomic-embed-text");
    expect(DEFAULT_SETTINGS.settingsSchemaVersion).toBe(1);
  });
});
