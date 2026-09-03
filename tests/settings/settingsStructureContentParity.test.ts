import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { LINA_DEVELOPMENT_BUILD_TIMESTAMP } from "../../src/buildInfo";

function createStaticRendererDouble() {
  const calls: {
    name?: string;
    description?: string;
    elements: Array<{ text?: string; tag?: string; cls?: string; attr?: Record<string, string> }>;
  } = { elements: [] };
  const setting = {
    setName(value: string) { calls.name = value; return setting; },
    setDesc(value: string) { calls.description = value; return setting; },
    descEl: {
      createDiv(options: { text?: string; cls?: string }) { calls.elements.push({ ...options }); return setting.descEl; },
      createSpan(options: { text?: string }) { calls.elements.push({ tag: "span", ...options }); },
      createEl(tag: string, options: { text?: string; attr?: Record<string, string> }) { calls.elements.push({ tag, ...options }); },
    },
  };
  return { calls, setting };
}

describe("C2 active settings structure and content", () => {
  it("keeps the canonical IDs while integrating generated build information into the Lina header", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const groups = tab.getSettingDefinitions();
    const ids = groups.flatMap((group) => group.items).map((item) => (item as { id: string }).id);

    expect(groups).toHaveLength(21);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toEqual(expect.arrayContaining([
      "device-description", "analysis-credential", "test-analysis-connection",
      "binary-status", "remove-binary-copy", "embeddings-credential", "support-link", "support-email",
      "development-build-info",
    ]));
    expect(groups[0].heading).toBe("");
    expect(groups.find((group) => group.heading === getStrings("pt-PT").settingsBasicSection)?.items).toEqual([]);
    expect(groups.find((group) => group.heading === getStrings("pt-PT").settingsAdvancedSection)?.items).toEqual([]);
    expect(groups.find((group) => group.heading === getStrings("pt-PT").settingsMaintenanceRecoverySection)?.items).toEqual([]);
    expect(groups.map((group) => group.heading).some((heading) => heading.includes(" — "))).toBe(false);
    const basicIndex = groups.find((group) => group.heading === getStrings("pt-PT").settingsIndexSection);
    expect(basicIndex?.items.map((item) => (item as { id: string }).id)).toEqual(["auto-update-index-on-file-changes"]);
    const advancedIndex = groups.find((group) => group.heading === getStrings("pt-PT").settingsIndexDiagnosticsSection);
    expect(advancedIndex?.items.map((item) => (item as { id: string }).id)).toEqual(["check-sync-on-startup", "debug-index-updates"]);
    const yamlGroup = groups.find((group) => group.heading === getStrings("pt-PT").settingsYamlSection);
    expect(yamlGroup?.items.map((item) => (item as { id: string }).id)).toEqual(["yaml-enabled", "yaml-include-tags"]);
    expect(groups.filter((group) => group.heading === getStrings("pt-PT").settingsYamlSection)).toHaveLength(1);
    expect(groups.filter((group) => group.heading === getStrings("pt-PT").settingsAnalysisSection)).toHaveLength(1);
    expect(groups.filter((group) => group.heading === getStrings("pt-PT").settingsEmbeddingsSection)).toHaveLength(1);
    expect(groups.find((group) => group.heading === getStrings("pt-PT").settingsSearchDataSection)).toBeDefined();
    expect(groups.at(-1)?.heading).toBe(getStrings("pt-PT").settingsSearchDataSection);
    expect(groups.map((group) => group.heading).join("\n")).not.toContain("Armazenamento binário experimental");
    expect(groups.map((group) => group.heading)).not.toContain("Introduction");
    expect(groups.map((group) => group.heading)).not.toContain("Development build");
    const buildInfo = groups[0].items.find((item) => (item as { id?: string }).id === "development-build-info");
    expect(buildInfo).toMatchObject({ visible: false, searchable: false });
    expect(JSON.stringify(groups)).not.toContain("apiKey");
    tab.hide();
  });

  it("renders the Lina identity, spaced version/build metadata, inline support link, and a description-only device row", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const groups = tab.getSettingDefinitions();
    const strings = getStrings("pt-PT");
    const introduction = groups[0].items.find((item) => (item as { id?: string }).id === "support-introduction") as { render?: (setting: unknown, group: unknown) => void };
    const introductionRendered = createStaticRendererDouble();
    introduction.render?.(introductionRendered.setting, {});

    expect(introductionRendered.calls).toEqual({
      name: strings.settingsTitle,
      description: strings.settingsDescription,
      elements: [
        {
          text: `${strings.settingsVersion}: ${plugin.manifest.version} · ${strings.settingsBuild}: ${LINA_DEVELOPMENT_BUILD_TIMESTAMP}`,
          cls: "lina-mt-8",
        },
        { cls: "lina-mt-8" },
        { tag: "span", text: `${strings.settingsSupportText} ` },
        {
          tag: "a",
          text: strings.settingsSupportCoffeeButton,
          attr: { href: "https://www.buymeacoffee.com/apinheiro", target: "_blank", rel: "noopener noreferrer" },
        },
      ],
    });
    expect(JSON.stringify(plugin.settings)).not.toContain(plugin.manifest.version);
    expect(JSON.stringify(plugin.settings)).not.toContain(LINA_DEVELOPMENT_BUILD_TIMESTAMP);

    const deviceGroup = groups.find((group) => group.heading === strings.settingsDeviceSection);
    const deviceDescription = deviceGroup?.items.find((item) => (item as { id?: string }).id === "device-description") as {
      render?: (setting: unknown, group: unknown) => void;
    };
    expect(deviceDescription).toMatchObject({
      name: strings.settingsDeviceRole,
      aliases: [
        strings.settingsDeviceRole,
        strings.settingsDeviceDescription,
        strings.settingsDeviceProducerTitle,
        strings.settingsDeviceProducerDesc,
        strings.settingsDeviceCompanionTitle,
        strings.settingsDeviceCompanionDesc,
      ],
      visible: true,
      render: expect.any(Function),
    });
    expect(deviceDescription).not.toHaveProperty("desc");
    const deviceDescriptionRendered = createStaticRendererDouble();
    deviceDescription.render?.(deviceDescriptionRendered.setting, {});
    expect(deviceDescriptionRendered.calls).toEqual({
      name: `${strings.settingsDeviceRole}: ⚪ ${strings.settingsDeviceUnconfiguredTitle}`,
      description: `${strings.settingsDeviceUnconfiguredDesc}\n• ${strings.settingsDeviceProducerOption} (${strings.settingsDeviceRoleRecommended}): ${strings.settingsDeviceProducerDesc}\n• ${strings.settingsDeviceCompanionOption}: ${strings.settingsDeviceCompanionDesc}`,
      elements: [],
    });
    expect(strings.settingsDeviceDescription).toBe("Estas opções são guardadas apenas neste dispositivo.");
    expect(getStrings("en").settingsDeviceDescription).toBe("These settings are stored locally on this device.");

    // Verify assigned Producer renders green badge
    plugin.localDeviceState = {
      schemaVersion: 2,
      deviceId: "current",
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z",
      role: "producer",
    };
    tab.hide();
    const assignedTab = new LinaSettingTab(app, plugin);
    const assignedGroup = assignedTab.getSettingDefinitions().find((g) => (g as { heading?: string }).heading === strings.settingsDeviceSection) as { items: { id?: string; render?: (s: unknown, g: unknown) => void }[] };
    const assignedDeviceDesc = assignedGroup?.items.find((item) => item.id === "device-description");
    const assignedRendered = createStaticRendererDouble();
    assignedDeviceDesc?.render?.(assignedRendered.setting, {});
    expect(assignedRendered.calls).toEqual({
      name: `${strings.settingsDeviceRole}: 🟢 ${strings.settingsDeviceProducerTitle}`,
      description: strings.settingsDeviceProducerDesc,
      elements: [],
    });
    assignedTab.hide();
  });

  it("keeps definitions deterministic and the single source of truth on the composition", () => {
    const app = new App();
    const plugin = new LinaPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS, deviceSettingsById: { current: {} } };
    setDeviceSettingsContext(plugin.settings, () => {}, "current");
    const tab = new LinaSettingTab(app, plugin);
    const first = tab.getSettingDefinitions();
    const second = tab.getSettingDefinitions();

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("SUPER_SECRET_SENTINEL");
    tab.hide();
  });
});
