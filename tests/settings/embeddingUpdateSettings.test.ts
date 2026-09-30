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
import { evaluateEmbeddingUpdatePolicyFromSnapshot } from "../../src/maintenance/embeddingPolicyEngine";
import { resolveEmbeddingLifecycle, type EmbeddingLifecycleSnapshot } from "../../src/index/embeddingLifecycleModel";
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
    function makeSnapshot(options: {
      isExternal?: boolean;
      deviceRole?: "producer" | "companion";
      hasWork?: boolean;
      provider?: string;
    } = {}): EmbeddingLifecycleSnapshot {
      const isCompanion = options.deviceRole === "companion";
      const isExternal = options.isExternal ?? false;
      const provider = options.provider ?? (isExternal ? "mistral" : "ollama");
      const hasWork = options.hasWork ?? true;
      const identity = {
        provider,
        model: "default-model",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "none" as const,
      };

      return resolveEmbeddingLifecycle({
        revision: 1,
        computedAt: 1,
        deviceRole: options.deviceRole ?? "producer",
        isActiveProducer: !isCompanion,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 10,
        activeSource: "jsonl",
        publishedIdentity: identity,
        deviceIdentity: identity,
        targetIdentity: identity,
        workAssessment: hasWork ? {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "action",
          cost: isExternal ? "external" : "local",
          reasons: ["missing-chunks"],
        } : {
          kind: "none",
          updateRequired: false,
          severity: "none",
          cost: "none",
          reasons: ["up-to-date"],
        },
      });
    }

    it("requires confirmation when policy is manual for all providers", () => {
      const ollamaSnapshot = makeSnapshot({ isExternal: false, provider: "ollama" });
      const mistralSnapshot = makeSnapshot({ isExternal: true, provider: "mistral" });

      const ollamaDecision = evaluateEmbeddingUpdatePolicyFromSnapshot(ollamaSnapshot, "manual");
      expect(ollamaDecision.allowed).toBe(false);
      expect(ollamaDecision.requiresConfirmation).toBe(true);
      expect(ollamaDecision.reason).toBe("manual-confirmation-required");

      const mistralDecision = evaluateEmbeddingUpdatePolicyFromSnapshot(mistralSnapshot, "manual");
      expect(mistralDecision.allowed).toBe(false);
      expect(mistralDecision.requiresConfirmation).toBe(true);
      expect(mistralDecision.reason).toBe("manual-confirmation-required");
    });

    it("allows auto-approval for local providers under automatic-local-only policy", () => {
      const ollamaSnapshot = makeSnapshot({ isExternal: false, provider: "ollama" });

      const decision = evaluateEmbeddingUpdatePolicyFromSnapshot(ollamaSnapshot, "automatic-local-only");
      expect(decision.allowed).toBe(true);
      expect(decision.requiresConfirmation).toBe(false);
      expect(decision.reason).toBe("local-provider-auto-approved");
    });

    it("blocks automatic generation and requires confirmation for external providers even under automatic-local-only policy", () => {
      const mistralSnapshot = makeSnapshot({ isExternal: true, provider: "mistral" });
      const openrouterSnapshot = makeSnapshot({ isExternal: true, provider: "openrouter" });

      const mistralDecision = evaluateEmbeddingUpdatePolicyFromSnapshot(mistralSnapshot, "automatic-local-only");
      expect(mistralDecision.allowed).toBe(false);
      expect(mistralDecision.requiresConfirmation).toBe(true);
      expect(mistralDecision.reason).toBe("external-provider-blocked");

      const openrouterDecision = evaluateEmbeddingUpdatePolicyFromSnapshot(openrouterSnapshot, "automatic-local-only");
      expect(openrouterDecision.allowed).toBe(false);
      expect(openrouterDecision.requiresConfirmation).toBe(true);
      expect(openrouterDecision.reason).toBe("external-provider-blocked");
    });
  });

  describe("4. Companion Constraints", () => {
    function makeCompanionSnapshot(): EmbeddingLifecycleSnapshot {
      return resolveEmbeddingLifecycle({
        revision: 1,
        computedAt: 1,
        deviceRole: "companion",
        isActiveProducer: false,
        embeddingsEnabled: true,
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 10,
        activeSource: "jsonl",
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "action",
          cost: "local",
          reasons: ["missing-chunks"],
        },
      });
    }

    it("never allows embedding generation on Companion regardless of update setting", () => {
      const companion = makeCompanionSnapshot();

      const manualCompanion = evaluateEmbeddingUpdatePolicyFromSnapshot(companion, "manual");
      expect(manualCompanion.allowed).toBe(false);
      expect(manualCompanion.requiresConfirmation).toBe(false);
      expect(manualCompanion.reason).toBe("companion-device-not-allowed");

      const autoCompanion = evaluateEmbeddingUpdatePolicyFromSnapshot(companion, "automatic-local-only");
      expect(autoCompanion.allowed).toBe(false);
      expect(autoCompanion.requiresConfirmation).toBe(false);
      expect(autoCompanion.reason).toBe("companion-device-not-allowed");
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
