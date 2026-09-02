import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  LinaSettings,
} from "../../src/settings";
import {
  DEFAULT_EMBEDDING_UPDATE_SETTINGS,
  isEmbeddingUpdateMode,
  normalizeEmbeddingUpdateMode,
  type EmbeddingUpdateMode,
} from "../../src/maintenance/embeddingUpdateSettings";
import { evaluateEmbeddingUpdatePolicy } from "../../src/maintenance/embeddingPolicyEngine";
import { getEmbeddingProviderCapability } from "../../src/ai/providerCapabilities";
import { getStrings } from "../../src/i18n/strings";
import {
  createSettingsRuntimeAdapters,
  type SettingsRuntimeHost,
} from "../../src/settings/settingsRuntimeAdapters";
import {
  getEmbeddingUpdateModeOptions,
  isDeclarativeGlobalSettingValue,
} from "../../src/settings/declarativeGlobalSettings";
import { createPureGlobalSettingDefinitions } from "../../src/settings/pureGlobalSettingDefinitions";

function createHostDouble(initialSettings: Partial<LinaSettings> = {}): {
  host: SettingsRuntimeHost;
  saved: LinaSettings[];
} {
  const saved: LinaSettings[] = [];
  let currentSettings: LinaSettings = {
    ...DEFAULT_SETTINGS,
    ...initialSettings,
    deviceSettingsById: {},
  };

  const host: SettingsRuntimeHost = {
    getSnapshot: () => ({ settings: currentSettings }),
    replaceSnapshot: (next) => {
      currentSettings = next.settings as LinaSettings;
    },
    saveSnapshot: async () => {
      saved.push({ ...currentSettings });
    },
    getCurrentDeviceId: () => "device-1",
    runEffect: vi.fn(),
  };

  return { host, saved };
}

describe("Lina 0.2.2.4 — Embedding Update Settings", () => {
  describe("1. Defaults and Normalization", () => {
    it("defaults to manual mode for new installations", () => {
      expect(DEFAULT_SETTINGS.embeddingUpdateMode).toBe("manual");
      expect(DEFAULT_EMBEDDING_UPDATE_SETTINGS.mode).toBe("manual");
    });

    it("identifies valid embedding update modes", () => {
      expect(isEmbeddingUpdateMode("manual")).toBe(true);
      expect(isEmbeddingUpdateMode("automatic-local-only")).toBe(true);
      expect(isEmbeddingUpdateMode("automatic")).toBe(false);
      expect(isEmbeddingUpdateMode(null)).toBe(false);
      expect(isEmbeddingUpdateMode(undefined)).toBe(false);
      expect(isEmbeddingUpdateMode(123)).toBe(false);
    });

    it("normalizes unknown or invalid values to manual fallback", () => {
      expect(normalizeEmbeddingUpdateMode("automatic-local-only")).toBe("automatic-local-only");
      expect(normalizeEmbeddingUpdateMode("manual")).toBe("manual");
      expect(normalizeEmbeddingUpdateMode("invalid")).toBe("manual");
      expect(normalizeEmbeddingUpdateMode(undefined)).toBe("manual");
      expect(normalizeEmbeddingUpdateMode(null)).toBe("manual");
    });
  });

  describe("2. Settings Persistence and Runtime Adapters", () => {
    it("reads default manual mode from global settings adapter", () => {
      const { host } = createHostDouble();
      const adapters = createSettingsRuntimeAdapters(host);

      expect(adapters.getGlobalValue("embeddingUpdateMode")).toBe("manual");
    });

    it("saves and persists manual and automatic-local-only modes", async () => {
      const { host, saved } = createHostDouble();
      const adapters = createSettingsRuntimeAdapters(host);

      const result1 = await adapters.setGlobalValue("embeddingUpdateMode", "automatic-local-only");
      expect(result1.ok).toBe(true);
      expect(adapters.getGlobalValue("embeddingUpdateMode")).toBe("automatic-local-only");
      expect(saved).toHaveLength(1);
      expect(saved[0].embeddingUpdateMode).toBe("automatic-local-only");

      const result2 = await adapters.setGlobalValue("embeddingUpdateMode", "manual");
      expect(result2.ok).toBe(true);
      expect(adapters.getGlobalValue("embeddingUpdateMode")).toBe("manual");
      expect(saved).toHaveLength(2);
      expect(saved[1].embeddingUpdateMode).toBe("manual");
    });

    it("rejects invalid global setting values", async () => {
      const { host, saved } = createHostDouble();
      const adapters = createSettingsRuntimeAdapters(host);

      const result = await adapters.setGlobalValue("embeddingUpdateMode", "invalid-mode" as unknown as EmbeddingUpdateMode);
      expect(result.ok).toBe(false);
      expect(saved).toHaveLength(0);
      expect(adapters.getGlobalValue("embeddingUpdateMode")).toBe("manual");
    });

    it("validates declarative global setting value kinds", () => {
      expect(isDeclarativeGlobalSettingValue("embeddingUpdateMode", "manual")).toBe(true);
      expect(isDeclarativeGlobalSettingValue("embeddingUpdateMode", "automatic-local-only")).toBe(true);
      expect(isDeclarativeGlobalSettingValue("embeddingUpdateMode", "invalid")).toBe(false);
      expect(isDeclarativeGlobalSettingValue("embeddingUpdateMode", 123)).toBe(false);
    });
  });

  describe("3. Policy Engine Integration", () => {
    it("requires confirmation when policy is manual for all providers", () => {
      const ollama = getEmbeddingProviderCapability("ollama");
      const mistral = getEmbeddingProviderCapability("mistral");

      const ollamaDecision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "manual",
        deviceRole: "producer",
      });
      expect(ollamaDecision).toEqual({
        allowed: false,
        requiresConfirmation: true,
        reason: "manual-confirmation-required",
      });

      const mistralDecision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: mistral,
        policy: "manual",
        deviceRole: "producer",
      });
      expect(mistralDecision).toEqual({
        allowed: false,
        requiresConfirmation: true,
        reason: "manual-confirmation-required",
      });
    });

    it("allows auto-approval for local providers under automatic-local-only policy", () => {
      const ollama = getEmbeddingProviderCapability("ollama");

      const decision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "producer",
      });
      expect(decision).toEqual({
        allowed: true,
        requiresConfirmation: false,
        reason: "local-provider-auto-approved",
      });
    });

    it("blocks automatic generation and requires confirmation for external providers even under automatic-local-only policy", () => {
      const mistral = getEmbeddingProviderCapability("mistral");
      const openrouter = getEmbeddingProviderCapability("openrouter");

      const mistralDecision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: mistral,
        policy: "automatic-local-only",
        deviceRole: "producer",
      });
      expect(mistralDecision).toEqual({
        allowed: false,
        requiresConfirmation: true,
        reason: "external-provider-blocked",
      });

      const openrouterDecision = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: openrouter,
        policy: "automatic-local-only",
        deviceRole: "producer",
      });
      expect(openrouterDecision).toEqual({
        allowed: false,
        requiresConfirmation: true,
        reason: "external-provider-blocked",
      });
    });
  });

  describe("4. Companion Constraints", () => {
    it("never allows embedding generation on Companion regardless of update setting", () => {
      const ollama = getEmbeddingProviderCapability("ollama");

      const manualCompanion = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "manual",
        deviceRole: "companion",
      });
      expect(manualCompanion).toEqual({
        allowed: false,
        requiresConfirmation: false,
        reason: "companion-device-not-allowed",
      });

      const autoCompanion = evaluateEmbeddingUpdatePolicy({
        embeddingState: { hasPendingWork: true },
        providerCapability: ollama,
        policy: "automatic-local-only",
        deviceRole: "companion",
      });
      expect(autoCompanion).toEqual({
        allowed: false,
        requiresConfirmation: false,
        reason: "companion-device-not-allowed",
      });
    });
  });

  describe("5. Localization & UI Strings", () => {
    it("exposes clear humanized options and descriptions in pt-PT and en", () => {
      const ptStrings = getStrings("pt-PT");
      const enStrings = getStrings("en");

      const ptOptions = getEmbeddingUpdateModeOptions({
        manual: ptStrings.settingsEmbeddingUpdateModeManual,
        automaticLocalOnly: ptStrings.settingsEmbeddingUpdateModeAutomaticLocalOnly,
      });
      expect(ptOptions).toEqual([
        { value: "manual", label: "Manual (perguntar antes de gerar)" },
        { value: "automatic-local-only", label: "Automático quando possível (apenas providers locais)" },
      ]);

      const enOptions = getEmbeddingUpdateModeOptions({
        manual: enStrings.settingsEmbeddingUpdateModeManual,
        automaticLocalOnly: enStrings.settingsEmbeddingUpdateModeAutomaticLocalOnly,
      });
      expect(enOptions).toEqual([
        { value: "manual", label: "Manual (ask before generating)" },
        { value: "automatic-local-only", label: "Automatic when possible (local providers only)" },
      ]);
    });

    it("includes the embedding update mode control in pure global definitions", () => {
      const definitions = createPureGlobalSettingDefinitions(getStrings("pt-PT"));
      const updateModeDefinition = definitions.find((d) => d.control.key === "embeddingUpdateMode");

      expect(updateModeDefinition).toBeDefined();
      expect(updateModeDefinition?.control.type).toBe("dropdown");
      expect(updateModeDefinition?.name).toBe("Atualizações de embeddings");
      expect(updateModeDefinition?.desc).toContain("Define como o Lina processa");
      expect(updateModeDefinition?.desc).toContain("Providers externos requerem sempre confirmação explícita");
    });
  });
});
