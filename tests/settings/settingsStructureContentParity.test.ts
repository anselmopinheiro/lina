import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { DEFAULT_SETTINGS, LinaSettingTab, setDeviceSettingsContext } from "../../src/settings";
import { getStrings } from "../../src/i18n/strings";
import { LINA_DEVELOPMENT_BUILD_TIMESTAMP } from "../../src/buildInfo";

function createStaticRendererDouble() {
  const calls: { name?: string; description?: string; elements: Array<{ text?: string }> } = { elements: [] };
  const setting = {
    setName(value: string) { calls.name = value; return setting; },
    setDesc(value: string) { calls.description = value; return setting; },
    descEl: {
      createDiv(options: { text?: string }) { calls.elements.push({ ...options }); },
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

    expect(groups).toHaveLength(13);
    expect(ids).toHaveLength(49);
    expect(new Set(ids).size).toBe(49);
    expect(ids).toEqual(expect.arrayContaining([
      "device-description", "analysis-credential", "test-analysis-connection",
      "binary-status", "remove-binary-copy", "embeddings-credential", "support-link", "support-email",
      "development-build-info",
    ]));
    expect(groups[0].heading).toBe("");
    expect(groups.slice(1, 9).every((group) => group.heading.startsWith(`${getStrings("pt-PT").settingsBasicSection} — `))).toBe(true);
    expect(groups.slice(9, 12).every((group) => group.heading.startsWith(`${getStrings("pt-PT").settingsAdvancedSection} — `))).toBe(true);
    const yamlGroup = groups.find((group) => group.heading === `${getStrings("pt-PT").settingsBasicSection} — ${getStrings("pt-PT").settingsYamlSection}`);
    expect(yamlGroup?.items.map((item) => (item as { id: string }).id)).toEqual(["yaml-enabled", "yaml-properties", "yaml-include-tags", "max-suggested-tags"]);
    expect(groups.some((group) => group.heading === `${getStrings("pt-PT").settingsAdvancedSection} — ${getStrings("pt-PT").settingsYamlSection}`)).toBe(false);
    expect(groups.some((group) => group.heading === `${getStrings("pt-PT").settingsAdvancedSection} — ${getStrings("pt-PT").settingsAnalysisSection}`)).toBe(false);
    expect(groups.some((group) => group.heading === `${getStrings("pt-PT").settingsAdvancedSection} — ${getStrings("pt-PT").settingsEmbeddingsSection}`)).toBe(false);
    expect(groups.find((group) => group.heading.endsWith(`— ${getStrings("pt-PT").settingsBinarySection}`))).toBeDefined();
    expect(groups.at(-1)?.heading).toBe(`${getStrings("pt-PT").settingsMaintenanceRecoverySection} — ${getStrings("pt-PT").settingsSearchDataSection}`);
    expect(groups.map((group) => group.heading).join("\n")).not.toContain("Armazenamento binário experimental");
    expect(groups.map((group) => group.heading)).not.toContain("Introduction");
    expect(groups.map((group) => group.heading)).not.toContain("Development build");
    const buildInfo = groups[0].items.find((item) => (item as { id?: string }).id === "development-build-info");
    expect(buildInfo).toMatchObject({ visible: false, searchable: false });
    expect(JSON.stringify(groups)).not.toContain("apiKey");
    tab.hide();
  });

  it("renders the Lina identity, authoritative version/build, and a description-only device row", () => {
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
        { text: `${strings.settingsVersion}: ${plugin.manifest.version}` },
        { text: `${strings.settingsBuild}: ${LINA_DEVELOPMENT_BUILD_TIMESTAMP}` },
      ],
    });
    expect(JSON.stringify(plugin.settings)).not.toContain(plugin.manifest.version);
    expect(JSON.stringify(plugin.settings)).not.toContain(LINA_DEVELOPMENT_BUILD_TIMESTAMP);

    const deviceGroup = groups.find((group) => group.heading === `${strings.settingsBasicSection} — ${strings.settingsDeviceSection}`);
    const deviceDescription = deviceGroup?.items.find((item) => (item as { id?: string }).id === "device-description") as {
      render?: (setting: unknown, group: unknown) => void;
    };
    expect(deviceDescription).toMatchObject({
      name: "",
      aliases: [strings.settingsDeviceDescription],
      visible: true,
      render: expect.any(Function),
    });
    expect(deviceDescription).not.toHaveProperty("desc");
    const deviceDescriptionRendered = createStaticRendererDouble();
    deviceDescription.render?.(deviceDescriptionRendered.setting, {});
    expect(deviceDescriptionRendered.calls).toEqual({
      description: strings.settingsDeviceDescription,
      elements: [],
    });
    expect(strings.settingsDeviceDescription).toBe("Estas opções são guardadas apenas neste dispositivo.");
    expect(getStrings("en").settingsDeviceDescription).toBe("These settings are stored locally on this device.");
    tab.hide();
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
