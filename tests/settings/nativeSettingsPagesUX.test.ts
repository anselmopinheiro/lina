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
      "general", "search", "ai-analysis", "privacy", "diagnostics",
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
    expect(ids).toContain("support-introduction");
    tab.hide();
  });

  it("preserves search settings on Companion device and keeps exclusions out of general", () => {
    const { tab } = createTestSetup("companion");
    const byId = new Map(pages(tab).map((page) => [page.id, page]));
    const generalIds = byId.get("general")?.items?.map((item) => (item as { id: string }).id) ?? [];
    expect(generalIds).toContain("device-name");
    expect(generalIds).not.toContain("exclusions-note");
    expect(generalIds).not.toContain("excluded-folders");
    expect(byId.get("privacy")?.items?.map((item) => (item as { id: string }).id)).toContain("exclusions-note");
    expect(byId.get("search")?.items?.map((item) => (item as { id: string }).id)).toEqual([
      "embeddings-enabled", "embeddings-provider", "embeddings-model", "embeddings-base-url", "embeddings-credential",
      "test-embeddings-connection", "embeddings-test-feedback", "embeddings-timeout", "embedding-language", "hybrid-text-weight", "hybrid-semantic-weight",
    ]);
    tab.hide();
  });

  it("keeps Producer exclusion controls editable on the privacy page", () => {
    const { tab } = createTestSetup("producer");
    const privacy = new Map(pages(tab).find((page) => page.id === "privacy")?.items?.map((item) => [
      (item as { id: string }).id,
      item as { control?: { disabled?: boolean }; visible?: unknown },
    ]) ?? []);
    for (const id of ["excluded-folders", "excluded-path-terms", "excluded-content-terms"]) {
      expect(privacy.get(id)?.control?.disabled).toBe(false);
      expect((privacy.get(id)?.visible as (() => boolean))()).toBe(true);
    }
    const diagnosticsIds = pages(tab).find((page) => page.id === "diagnostics")?.items?.map((item) => (item as { id: string }).id) ?? [];
    expect(diagnosticsIds).not.toContain("excluded-folders");
    tab.hide();
  });

  it("shows the exclusions area on a Companion as a single read-only note without editable controls", () => {
    const { tab } = createTestSetup("companion");
    const privacyPage = pages(tab).find((page) => page.id === "privacy");
    expect(privacyPage?.visible).not.toBe(false);
    const items = new Map((privacyPage?.items ?? []).map((item) => [
      (item as { id: string }).id,
      item as { visible?: unknown },
    ]));
    expect(items.has("exclusions-note")).toBe(true);
    for (const id of ["excluded-folders", "excluded-path-terms", "excluded-content-terms"]) {
      expect((items.get(id)?.visible as (() => boolean))()).toBe(false);
    }
    tab.hide();
  });

  it("keeps the device name editable on every role, independently of exclusion permissions", () => {
    for (const role of ["producer", "companion"] as const) {
      const { tab } = createTestSetup(role);
      const general = pages(tab).find((page) => page.id === "general");
      const deviceName = general?.items?.find((item) => (item as { id: string }).id === "device-name") as
        { control?: { disabled?: boolean; key?: string } } | undefined;
      expect(deviceName?.control?.key).toBe("deviceName");
      expect(deviceName?.control?.disabled).toBe(false);
      tab.hide();
    }
  });

  it("consolidates synchronization, diagnostics, and debug settings in diagnostics page", () => {
    const { tab } = createTestSetup();
    const byId = new Map(pages(tab).map((page) => [page.id, page]));
    expect(byId.get("diagnostics")?.items?.map((item) => (item as { id: string }).id)).toEqual([
      "check-sync-on-startup", "embedding-update-mode", "embeddings-batch-size", "auto-update-index-on-file-changes",
      "update-index-on-startup", "binary-maintenance", "create-or-update-binary-copy", "remove-binary-copy",
      "binary-warning", "binary-status", "check-binary-copy", "binary-preference", "debug-index-updates",
    ]);
    tab.hide();
  });

  it("preserves settings schema and defaults", () => {
    expect(DEFAULT_SETTINGS.embeddingsEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.embeddingProvider).toBe("ollama");
    expect(DEFAULT_SETTINGS.embeddingModel).toBe("nomic-embed-text-v2-moe");
    expect(DEFAULT_SETTINGS.settingsSchemaVersion).toBe(1);
  });
});
