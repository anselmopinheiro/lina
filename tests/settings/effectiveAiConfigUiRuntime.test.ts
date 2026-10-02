import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { getAnalysisProviderDefaults, getEmbeddingProviderDefaults } from "../../src/ai/providerDefaults";
import {
  DEFAULT_SETTINGS,
  LEGACY_COMPATIBILITY_DEFAULTS,
  LinaSettingTab,
  resolveLoadedSettings,
  setDeviceSettingsContext,
  type LinaSettings,
} from "../../src/settings";
import {
  resolveEffectiveAnalysisConfig,
  resolveEffectiveEmbeddingsConfig,
} from "../../src/settings/effectiveAiConfig";

/**
 * LINA-15G (CR-03, Option B): existing installations keep their effective configuration, the UI shows
 * exactly what the runtime uses, and new installations get the documented defaults.
 */

type Domain = "analysis" | "embeddings";

const NEW_EMBEDDING_MODEL = getEmbeddingProviderDefaults("ollama").model;
const NEW_ANALYSIS_MODEL = getAnalysisProviderDefaults("ollama").model;

function createTab(settings: LinaSettings, device: Record<string, unknown> = {}) {
  const app = new App();
  const plugin = new LinaPlugin(app);
  plugin.settings = { ...settings, deviceSettingsById: { current: { ...device } } } as LinaSettings;
  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, "current");
  return { plugin, tab: new LinaSettingTab(app, plugin) };
}

/** The model the Settings UI displays (dropdown selection for catalog models, text for manual/custom). */
function shownModel(tab: LinaSettingTab, domain: Domain): string {
  let value = "";
  const dropdown = {
    addOption() { return dropdown; },
    setValue(next: string) { value = next; return dropdown; },
    onChange() { return dropdown; },
  };
  const text = {
    setPlaceholder() { return text; },
    setValue(next: string) { value = next; return text; },
    onChange() { return text; },
  };
  const setting = {
    setName() { return setting; },
    setDesc() { return setting; },
    addDropdown(callback: (component: typeof dropdown) => void) { callback(dropdown); return setting; },
    addText(callback: (component: typeof text) => void) { callback(text); return setting; },
  };
  const group = { listEl: { createEl() {} } };
  const id = domain === "analysis" ? "analysis-model" : "embeddings-model";
  const definition = tab.getSettingDefinitions()
    .flatMap((candidate) => candidate.items)
    .find((item) => (item as { id?: string }).id === id) as { render?: (target: unknown, targetGroup: unknown) => void } | undefined;
  if (!definition?.render) throw new Error(`Missing ${id}`);
  definition.render(setting, group);
  return value;
}

function shownBaseUrl(tab: LinaSettingTab, domain: Domain): string | undefined {
  const id = domain === "analysis" ? "analysis-base-url" : "embeddings-base-url";
  const definition = tab.getSettingDefinitions()
    .flatMap((group) => group.items)
    .find((item) => (item as { id?: string }).id === id) as { control?: { placeholder?: string } } | undefined;
  return definition?.control?.placeholder;
}

describe("LINA-15G — loading settings (existing vs new installation)", () => {
  it("new installation (no persisted settings) gets the documented defaults", () => {
    const settings = resolveLoadedSettings(undefined);
    expect(settings.embeddingModel).toBe("nomic-embed-text-v2-moe");
    expect(settings.aiAnalysisModel).toBe("gemma4:e2b");
    expect(settings.embeddingModel).toBe(NEW_EMBEDDING_MODEL);
    expect(settings.aiAnalysisModel).toBe(NEW_ANALYSIS_MODEL);
    expect(DEFAULT_SETTINGS.embeddingModel).toBe(NEW_EMBEDDING_MODEL);
  });

  it("existing installation without the model keys keeps the behaviour it always had", () => {
    const raw = { settingsSchemaVersion: 1, embeddingsEnabled: true };
    const settings = resolveLoadedSettings(raw);
    expect(settings.embeddingModel).toBe("nomic-embed-text");
    expect(settings.aiAnalysisModel).toBe("gemma4:12b");
    expect(LEGACY_COMPATIBILITY_DEFAULTS).toEqual({ embeddingModel: "nomic-embed-text", aiAnalysisModel: "gemma4:12b" });
    expect(settings.embeddingsEnabled).toBe(true);
  });

  it("persisted values always win (including a persisted new default and explicit choices)", () => {
    const settings = resolveLoadedSettings({
      embeddingModel: "nomic-embed-text-v2-moe",
      aiAnalysisModel: "my-custom-model",
    });
    expect(settings.embeddingModel).toBe("nomic-embed-text-v2-moe");
    expect(settings.aiAnalysisModel).toBe("my-custom-model");
    expect(resolveLoadedSettings({ embeddingModel: "nomic-embed-text" }).embeddingModel).toBe("nomic-embed-text");
  });

  it("is pure and idempotent: never mutates the persisted object and converges on re-load", () => {
    const raw: Record<string, unknown> = { settingsSchemaVersion: 1 };
    const snapshot = JSON.stringify(raw);
    const first = resolveLoadedSettings(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
    // Persisting the loaded settings and loading again yields the same effective values.
    const second = resolveLoadedSettings(JSON.parse(JSON.stringify(first)) as Record<string, unknown>);
    expect(second.embeddingModel).toBe(first.embeddingModel);
    expect(second.aiAnalysisModel).toBe(first.aiAnalysisModel);
    // A new installation, once saved and reloaded, keeps the new default (it is now "existing").
    const newInstall = resolveLoadedSettings(undefined);
    const reloaded = resolveLoadedSettings(JSON.parse(JSON.stringify(newInstall)) as Record<string, unknown>);
    expect(reloaded.embeddingModel).toBe(NEW_EMBEDDING_MODEL);
    expect(reloaded.aiAnalysisModel).toBe(NEW_ANALYSIS_MODEL);
  });
});

describe("LINA-15G — effective configuration resolver", () => {
  it("precedence: device-local → legacy global → provider default (no fabricated literal)", () => {
    const legacy = { embeddingModel: "legacy-model", embeddingBaseUrl: "http://10.0.0.5:11434", embeddingProvider: "ollama" };
    expect(resolveEffectiveEmbeddingsConfig({ model: "local-model" }, legacy).model).toBe("local-model");
    expect(resolveEffectiveEmbeddingsConfig({}, legacy).model).toBe("legacy-model");
    expect(resolveEffectiveEmbeddingsConfig({}, legacy).baseUrl).toBe("http://10.0.0.5:11434");
    expect(resolveEffectiveEmbeddingsConfig({}, {}).model).toBe(NEW_EMBEDDING_MODEL);
    expect(resolveEffectiveEmbeddingsConfig({ provider: "mistral" }, {}).model).toBe(getEmbeddingProviderDefaults("mistral").model);
    expect(resolveEffectiveAnalysisConfig({}, {}).model).toBe(NEW_ANALYSIS_MODEL);
    expect(resolveEffectiveAnalysisConfig({}, { aiAnalysisModel: "gemma4:12b" }).model).toBe("gemma4:12b");
  });

  it("does not leak another provider's default when the provider changes", () => {
    const config = resolveEffectiveEmbeddingsConfig({ provider: "mistral" }, { embeddingModel: "nomic-embed-text" });
    expect(config.provider).toBe("mistral");
    expect(config.model).toBe(getEmbeddingProviderDefaults("mistral").model);
    expect(config.baseUrl).toBe(getEmbeddingProviderDefaults("mistral").baseUrl);
  });
});

describe("LINA-15G — UI == runtime", () => {
  it("existing installation without a device-local model: UI shows the legacy runtime value, identity preserved", () => {
    const settings = resolveLoadedSettings({ settingsSchemaVersion: 1, embeddingsEnabled: true });
    const { plugin, tab } = createTab(settings);

    const runtime = plugin.getEffectiveEmbeddingConfig();
    expect(runtime.provider).toBe("ollama");
    expect(runtime.model).toBe("nomic-embed-text"); // unchanged effective model (identity of published embeddings)
    expect(shownModel(tab, "embeddings")).toBe(runtime.model);

    const analysis = resolveEffectiveAnalysisConfig({}, plugin.settings);
    expect(analysis.model).toBe("gemma4:12b");
    expect(shownModel(tab, "analysis")).toBe(analysis.model);
  });

  it("existing installation with the legacy model persisted in data.json: same", () => {
    const settings = resolveLoadedSettings({ embeddingModel: "nomic-embed-text", aiAnalysisModel: "gemma4:12b" });
    const { plugin, tab } = createTab(settings);
    expect(plugin.getEffectiveEmbeddingConfig().model).toBe("nomic-embed-text");
    expect(shownModel(tab, "embeddings")).toBe("nomic-embed-text");
    expect(shownModel(tab, "analysis")).toBe("gemma4:12b");
  });

  it("new installation: documented default in runtime and UI", () => {
    const { plugin, tab } = createTab(resolveLoadedSettings(undefined));
    expect(plugin.getEffectiveEmbeddingConfig().model).toBe(NEW_EMBEDDING_MODEL);
    expect(shownModel(tab, "embeddings")).toBe(NEW_EMBEDDING_MODEL);
    expect(shownModel(tab, "analysis")).toBe(NEW_ANALYSIS_MODEL);
  });

  it("explicit device-local choice: UI == runtime == chosen value", () => {
    const { plugin, tab } = createTab(resolveLoadedSettings({}), {
      embeddingsProvider: "ollama",
      embeddingsModel: "nomic-embed-text-v2-moe",
      analysisProvider: "ollama",
      analysisModel: "gemma4:e2b",
    });
    expect(plugin.getEffectiveEmbeddingConfig().model).toBe("nomic-embed-text-v2-moe");
    expect(shownModel(tab, "embeddings")).toBe("nomic-embed-text-v2-moe");
    expect(shownModel(tab, "analysis")).toBe("gemma4:e2b");
  });

  it("a legacy global Base URL is shown (placeholder) exactly as the runtime uses it", () => {
    const settings = resolveLoadedSettings({ embeddingBaseUrl: "http://192.168.1.20:11434", aiBaseUrl: "http://192.168.1.21:11434" });
    const { plugin, tab } = createTab(settings);
    expect(plugin.getEffectiveEmbeddingConfig().baseUrl).toBe("http://192.168.1.20:11434");
    expect(shownBaseUrl(tab, "embeddings")).toBe("http://192.168.1.20:11434");
    expect(shownBaseUrl(tab, "analysis")).toBe(resolveEffectiveAnalysisConfig({}, plugin.settings).baseUrl);
    expect(shownBaseUrl(tab, "analysis")).toBe("http://192.168.1.21:11434");
  });

  it("selected profile does not create a second source: profiles are not part of the effective chain", () => {
    const settings = resolveLoadedSettings({ aiProfiles: [
      { id: "ollama-local", name: "Ollama local", provider: "ollama", baseUrl: "http://localhost:11434", model: "gemma4:e2b", requestTimeoutSeconds: 60, isLocal: true },
      { id: "mistral", name: "Mistral", provider: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", requestTimeoutSeconds: 60, isLocal: false },
    ] });
    const { plugin, tab } = createTab(settings, { activeAiProfileId: "mistral" });
    expect(plugin.getEffectiveEmbeddingConfig().provider).toBe("ollama");
    expect(shownModel(tab, "embeddings")).toBe("nomic-embed-text");
    expect(shownModel(tab, "analysis")).toBe("gemma4:12b");
  });
});

describe("LINA-15G — no duplicated resolution in consumers", () => {
  it("runtime, search view and settings use the single resolver", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, "../..", relative), "utf-8");
    expect(read("main.ts")).toContain("resolveEffectiveEmbeddingsConfig(");
    expect(read("main.ts")).not.toContain('|| "nomic-embed-text"');
    expect(read("src/search/linaSearchView.ts")).toContain("resolveEffectiveAnalysisConfig(");
    expect(read("src/settings/declarativeSettingsCandidateComposition.ts")).toContain("resolveEffectiveEmbeddingsConfig(");
    expect(read("src/settings.ts")).not.toContain('getLocalEmbeddingsModel() || "nomic-embed-text"');
    expect(read("src/settings.ts")).not.toContain('getLocalAnalysisModel() || "gemma4:e2b"');
  });
});
