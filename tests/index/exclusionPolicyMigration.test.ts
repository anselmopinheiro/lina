/**
 * Test suite for LINA-03-002:
 * Integração, Migração e Mudança Controlada da Fonte de Verdade das Exclusões
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import {
  createArtifactProvenance,
} from "../../src/device/artifactProvenance";
import {
  EXCLUSION_POLICY_FILE_PATH,
  EMPTY_EXCLUSION_POLICY_RULES,
  ExclusionPolicyV1,
  createInitialExclusionPolicy,
  getExclusionPolicyPath,
} from "../../src/index/exclusionPolicy";
import {
  DEFAULT_SETTINGS,
  LinaSettingTab,
  setDeviceSettingsContext,
} from "../../src/settings";
import { FakeAdapter } from "../helpers/fakeAdapter";

const TEST_PRODUCER_DEVICE_ID = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
const OTHER_PRODUCER_DEVICE_ID = "a1111111-2222-4333-8444-555555555555";

function createTestPlugin(options?: {
  role?: "producer" | "companion";
  isStandby?: boolean;
  adapter?: FakeAdapter;
  settings?: Record<string, unknown>;
  deviceId?: string;
}): {
  plugin: LinaPlugin;
  adapter: FakeAdapter;
  app: App;
} {
  const adapter = options?.adapter ?? new FakeAdapter();
  const app = new App();
  (app.vault as { adapter: FakeAdapter }).adapter = adapter;

  const plugin = new LinaPlugin(app);
  const deviceId = options?.deviceId ?? TEST_PRODUCER_DEVICE_ID;

  // Set device id in app local storage so plugin.getDeviceId() matches
  app.loadLocalStorage = (key: string) => {
    if (key === "lina_device_id") return deviceId;
    return undefined;
  };

  plugin.settings = {
    ...DEFAULT_SETTINGS,
    indexExcludedFolders: "03_pessoal/\nCustomLegacyFolder/",
    indexExcludedPathContains: "legacy-password\nlegacy-token",
    indexExcludedContentContains: "LEGACY_SECRET",
    deviceSettingsById: {
      [deviceId]: {
        analysisProvider: "ollama",
        analysisModel: "gemma4:e2b",
        embeddingsProvider: "ollama",
        embeddingsModel: "nomic-embed-text-v2-moe",
      },
    },
    ...(options?.settings ?? {}),
  };

  if (options?.role) {
    plugin.localDeviceState = {
      schemaVersion: 2,
      deviceId,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      role: options.role,
    };
  }

  // If standby producer requested, set up ownership manifest with a different active producer
  if (options?.isStandby) {
    const ownership = {
      schemaVersion: 1,
      activeProducerId: OTHER_PRODUCER_DEVICE_ID,
      epoch: 1,
      acquiredAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      reason: "initial",
    };
    adapter.setFile(".lina/ownership.json", JSON.stringify(ownership, null, 2));
  }

  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, deviceId);

  return { plugin, adapter, app };
}

describe("LINA-03-002: Integração, Migração e Mudança Controlada da Fonte de Verdade", () => {
  // =========================================================================
  // 1. Migração (Casos A, B, C, D)
  // =========================================================================
  describe("Migração e Bootstrap", () => {
    it("Caso B: Active Producer + canonical missing + legacy values -> cria policy revision 1", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();

      expect(await adapter.exists(policyPath)).toBe(false);

      await plugin.initializeExclusionPolicy();

      expect(await adapter.exists(policyPath)).toBe(true);
      const content = await adapter.read(policyPath);
      const parsed = JSON.parse(content) as ExclusionPolicyV1;

      expect(parsed.policyRevision).toBe(1);
      expect(parsed.provenance.producerDeviceId).toBe(TEST_PRODUCER_DEVICE_ID);
      expect(parsed.rules.excludedFolders).toContain("customlegacyfolder/");
      expect(parsed.rules.excludedFolders).toContain("03_pessoal/");
      expect(parsed.rules.excludedPathContains).toContain("legacy-password");
      expect(parsed.rules.excludedContentContains).toContain("legacy_secret");

      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("loaded");
      expect(plugin.getCanonicalExclusionPolicy()?.policyRevision).toBe(1);
    });

    it("Caso A: Canonical já existe -> usa canonical e não re-migra a partir de data.json", async () => {
      const { plugin, adapter } = createTestPlugin({
        role: "producer",
        settings: {
          indexExcludedFolders: "divergent-folder/",
        },
      });
      const policyPath = getExclusionPolicyPath();

      const existingPolicy = createInitialExclusionPolicy(
        {
          excludedFolders: ["canonical-folder/"],
          excludedPathContains: ["canonical-path"],
          excludedContentContains: ["canonical-term"],
        },
        createArtifactProvenance(TEST_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      // Give it revision 5 to distinguish
      const policyWithRev5: ExclusionPolicyV1 = { ...existingPolicy, policyRevision: 5 };
      adapter.setFile(policyPath, JSON.stringify(policyWithRev5, null, 2));

      await plugin.initializeExclusionPolicy();

      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("loaded");
      expect(plugin.getCanonicalExclusionPolicy()?.policyRevision).toBe(5);
      const effective = plugin.getEffectiveExclusionRules();
      expect(effective.excludedFolders).toEqual(["canonical-folder/"]);
      expect(effective.excludedFolders).not.toContain("divergent-folder/");
    });

    it("Migração é idempotente: inicializações consecutivas não alteram a revisão", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();

      await plugin.initializeExclusionPolicy();
      const firstContent = await adapter.read(policyPath);
      const firstPolicy = plugin.getCanonicalExclusionPolicy();

      await plugin.initializeExclusionPolicy();
      const secondContent = await adapter.read(policyPath);
      const secondPolicy = plugin.getCanonicalExclusionPolicy();

      expect(firstContent).toBe(secondContent);
      expect(secondPolicy?.policyRevision).toBe(firstPolicy?.policyRevision);
    });

    it("Caso C: Companion + canonical missing -> zero escrita em disco, fallback legacy em memória", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "companion" });
      const policyPath = getExclusionPolicyPath();

      await plugin.initializeExclusionPolicy();

      expect(await adapter.exists(policyPath)).toBe(false);
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("missing");
      expect(plugin.getCanonicalExclusionPolicy()).toBeUndefined();

      // Em memória, usa o fallback legacy compatível
      const effective = plugin.getEffectiveExclusionRules();
      expect(effective.excludedFolders).toContain("customlegacyfolder/");
      expect(effective.excludedFolders).toContain("03_pessoal/");
    });

    it("Caso C: Standby Producer + canonical missing -> zero escrita em disco, fallback legacy em memória", async () => {
      const { plugin, adapter } = createTestPlugin({
        role: "producer",
        isStandby: true,
      });
      const policyPath = getExclusionPolicyPath();

      await plugin.initializeExclusionPolicy();

      expect(await adapter.exists(policyPath)).toBe(false);
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("missing");
      expect(plugin.getCanonicalExclusionPolicy()).toBeUndefined();

      const effective = plugin.getEffectiveExclusionRules();
      expect(effective.excludedFolders).toContain("customlegacyfolder/");
    });

    it("Falha de persistência durante bootstrap -> preserva fallback legacy em memória", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();

      // Forçar erro de escrita
      vi.spyOn(adapter, "write").mockRejectedValue(new Error("disk full"));

      await plugin.initializeExclusionPolicy();

      expect(await adapter.exists(policyPath)).toBe(false);
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("missing");
      const effective = plugin.getEffectiveExclusionRules();
      expect(effective.excludedFolders).toContain("customlegacyfolder/");
    });

    it("Caso D: Canonical corrupto/inválido -> ficheiro preservado, erro explícito, recusa overwrite silencioso", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();

      adapter.setFile(policyPath, "{ invalid json corrupt content");

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      await plugin.initializeExclusionPolicy();

      // Ficheiro continua intacto com o conteúdo corrupto (não destruído nem reescrito)
      expect(await adapter.read(policyPath)).toBe("{ invalid json corrupt content");
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("invalid");
      expect(plugin.getCanonicalExclusionPolicy()).toBeUndefined();
      expect(consoleError).toHaveBeenCalled();

      // Runtime usa fallback seguro não-legacy sem destruir o ficheiro
      const effective = plugin.getEffectiveExclusionRules();
      expect(effective.excludedFolders).toEqual([]);
      expect(effective.excludedPathContains).toEqual([]);
      expect(effective.excludedContentContains).toEqual([]);
      expect(effective).toEqual(EMPTY_EXCLUSION_POLICY_RULES);
    });
  });

  // =========================================================================
  // 2. Fonte de Verdade Canónica
  // =========================================================================
  describe("Fonte de Verdade Canónica (.lina/exclusions.json)", () => {
    it("Canonical válido vence valores diferentes em data.json / settings", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();

      const canonical = createInitialExclusionPolicy(
        {
          excludedFolders: ["authoritative-folder/"],
          excludedPathContains: ["authoritative-term"],
          excludedContentContains: ["authoritative-secret"],
        },
        createArtifactProvenance(TEST_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(policyPath, JSON.stringify(canonical, null, 2));

      await plugin.initializeExclusionPolicy();

      const effective = plugin.getEffectiveExclusionRules();
      expect(effective.excludedFolders).toEqual(["authoritative-folder/"]);
      expect(effective.excludedPathContains).toEqual(["authoritative-term"]);
      expect(effective.excludedContentContains).toEqual(["authoritative-secret"]);
    });

    it("Alterações legacy em data.json depois da migração não alteram o comportamento efetivo", async () => {
      const { plugin } = createTestPlugin({ role: "producer" });

      await plugin.initializeExclusionPolicy();
      const effectiveBefore = plugin.getEffectiveExclusionRules();

      // Simular alteração manual posterior em settings / data.json
      plugin.settings.indexExcludedFolders = "unauthorized-folder/\nshould-be-ignored/";

      const effectiveAfter = plugin.getEffectiveExclusionRules();
      expect(effectiveAfter.excludedFolders).toEqual(effectiveBefore.excludedFolders);
      expect(effectiveAfter.excludedFolders).not.toContain("unauthorized-folder/");
    });

    it("Fallback legacy só é utilizado se o canonical estiver ausente", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "companion" });
      expect(await adapter.exists(EXCLUSION_POLICY_FILE_PATH)).toBe(false);

      await plugin.initializeExclusionPolicy();
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("missing");

      // Modificar settings afeta o fallback legacy apenas enquanto missing
      plugin.settings.indexExcludedFolders = "temporary-fallback/";
      await plugin.reloadExclusionPolicy();
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toContain("temporary-fallback/");

      // Assim que a política canónica passa a existir, ela assume total autoridade
      const canonical = createInitialExclusionPolicy(
        { excludedFolders: ["synced-from-producer/"] },
        createArtifactProvenance(OTHER_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(EXCLUSION_POLICY_FILE_PATH, JSON.stringify(canonical, null, 2));

      await plugin.reloadExclusionPolicy();
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("loaded");
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual(["synced-from-producer/"]);
    });

    it("Canonical invalid NÃO usa legacy e preserva o ficheiro sem bootstrap", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();
      const corruptContent = "CORRUPT_NOT_JSON";
      adapter.setFile(policyPath, corruptContent);

      vi.spyOn(console, "error").mockImplementation(() => {});

      // Definir valores legacy explícitos em settings
      plugin.settings.indexExcludedFolders = "legacy-private/\nlegacy-vault/";
      plugin.settings.indexExcludedPathContains = "legacy-token";
      plugin.settings.indexExcludedContentContains = "legacy-secret";

      await plugin.initializeExclusionPolicy();

      // Estado é invalid
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("invalid");

      // Ficheiro em disco preservado e nenhum bootstrap ocorreu
      expect(await adapter.read(policyPath)).toBe(corruptContent);

      // Regras efetivas NÃO usam legacy
      const effective = plugin.getEffectiveExclusionRules();
      expect(effective.excludedFolders).toEqual([]);
      expect(effective.excludedPathContains).toEqual([]);
      expect(effective.excludedContentContains).toEqual([]);
      expect(effective.excludedFolders).not.toContain("legacy-private/");
    });

    it("Estado invalid: runtime não crasha e exclusões internas obrigatórias continuam protegidas", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();
      adapter.setFile(policyPath, "{ corrupt");

      vi.spyOn(console, "error").mockImplementation(() => {});
      await plugin.initializeExclusionPolicy();

      // Runtime não crasha
      expect(() => plugin.getEffectiveExclusionRules()).not.toThrow();
      expect(() => plugin.isContentExcludedByUserRules("some content")).not.toThrow();
      expect(() => plugin.isIndexPathExcludedByUserRules("notes/note.md")).not.toThrow();

      // Exclusões internas obrigatórias (.lina/, configDir) continuam protegidas
      expect(plugin.isIndexPathExcludedByUserRules(".lina/index/notes.json")).toBe(true);
      expect(plugin.isIndexPathExcludedByUserRules(".obsidian/plugins/lina/main.js")).toBe(true);

      // Caminhos normais não são excluídos (pois não há regras de utilizador em fallback inválido)
      expect(plugin.isIndexPathExcludedByUserRules("public/note.md")).toBe(false);
      expect(plugin.isContentExcludedByUserRules("normal content")).toBe(false);
    });

    it("Alterar data.json durante estado invalid não muda regras efetivas", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();
      adapter.setFile(policyPath, "{ invalid json");

      vi.spyOn(console, "error").mockImplementation(() => {});
      await plugin.initializeExclusionPolicy();

      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("invalid");
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual([]);

      // Alterar data.json / settings durante estado invalid
      plugin.settings.indexExcludedFolders = "attempted-legacy-override/";
      plugin.settings.indexExcludedContentContains = "attempted-secret";

      // Regras efetivas continuam vazias (legacy não tem autoridade)
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual([]);
      expect(plugin.getEffectiveExclusionRules().excludedContentContains).toEqual([]);
      expect(plugin.isIndexPathExcludedByUserRules("attempted-legacy-override/note.md")).toBe(false);
    });

    it("Quando canonical válido regressa após estado invalid, volta a ser a fonte efetiva", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();
      adapter.setFile(policyPath, "MALFORMED_JSON");

      vi.spyOn(console, "error").mockImplementation(() => {});
      await plugin.initializeExclusionPolicy();

      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("invalid");
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual([]);

      // Canonical válido é restaurado / corrigido em disco
      const validCanonical = createInitialExclusionPolicy(
        { excludedFolders: ["recovered-folder/"] },
        createArtifactProvenance(TEST_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(policyPath, JSON.stringify(validCanonical, null, 2));

      await plugin.reloadExclusionPolicy();

      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("loaded");
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual(["recovered-folder/"]);
      expect(plugin.isIndexPathExcludedByUserRules("recovered-folder/note.md")).toBe(true);
    });
  });

  // =========================================================================
  // 3. Settings Tab — Active Producer vs Companion / Standby
  // =========================================================================
  describe("Settings Tab Gating", () => {
    it("Active Producer pode editar exclusões e atualiza a política canónica", async () => {
      const { plugin, app } = createTestPlugin({ role: "producer" });
      await plugin.initializeExclusionPolicy();

      const tab = new LinaSettingTab(app, plugin);
      expect(plugin.canEditExclusions()).toBe(true);

      const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue();
      const reconcile = vi.spyOn(plugin, "reconcileIndexExclusionsAfterSettingsChange").mockResolvedValue();

      await tab.setControlValue("indexExcludedFolders", "NewFolder/\nSecretFolder/");

      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual(["newfolder/", "secretfolder/"]);
      expect(plugin.getCanonicalExclusionPolicy()?.policyRevision).toBe(2);
      expect(save).toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalled();
      tab.hide();
    });

    it("Companion vê os valores da política canónica mas os campos estão desativados", async () => {
      const { plugin, adapter, app } = createTestPlugin({ role: "companion" });

      const canonical = createInitialExclusionPolicy(
        {
          excludedFolders: ["shared-vault-folder/"],
          excludedPathContains: ["shared-secret"],
          excludedContentContains: ["shared-token"],
        },
        createArtifactProvenance(OTHER_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(EXCLUSION_POLICY_FILE_PATH, JSON.stringify(canonical, null, 2));
      await plugin.initializeExclusionPolicy();

      expect(plugin.canEditExclusions()).toBe(false);

      const tab = new LinaSettingTab(app, plugin);
      const defs = tab.getSettingDefinitions().flatMap((g) => g.items);
      const folderDef = defs.find((d) => (d as { id?: string }).id === "excluded-folders") as {
        control?: { disabled?: boolean };
        desc?: string;
      };

      expect(folderDef).toBeDefined();
      expect(folderDef.control?.disabled).toBe(true);
      expect(folderDef.desc).toContain("Gerido pelo Produtor Ativo");

      // Valores recebidos da política canónica são exibidos
      expect(tab.getControlValue("indexExcludedFolders")).toBe("shared-vault-folder/");

      // Tentativa de edição através do controlo é rejeitada
      await tab.setControlValue("indexExcludedFolders", "HackedFolder/");
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual(["shared-vault-folder/"]);
      tab.hide();
    });

    it("Standby Producer vê os valores mas campos estão desativados", async () => {
      const { plugin, adapter, app } = createTestPlugin({
        role: "producer",
        isStandby: true,
      });

      const canonical = createInitialExclusionPolicy(
        { excludedFolders: ["standby-read-only/"] },
        createArtifactProvenance(OTHER_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(EXCLUSION_POLICY_FILE_PATH, JSON.stringify(canonical, null, 2));
      await plugin.initializeExclusionPolicy();

      expect(plugin.canEditExclusions()).toBe(false);

      const tab = new LinaSettingTab(app, plugin);
      const defs = tab.getSettingDefinitions().flatMap((g) => g.items);
      const folderDef = defs.find((d) => (d as { id?: string }).id === "excluded-folders") as {
        control?: { disabled?: boolean };
        desc?: string;
      };

      expect(folderDef?.control?.disabled).toBe(true);
      expect(folderDef?.desc).toContain("Gerido pelo Produtor Ativo");
      tab.hide();
    });

    it("Tentativa programática direta de escrita por não-Active Producer é rejeitada no serviço", async () => {
      const { plugin } = createTestPlugin({ role: "companion" });
      await plugin.initializeExclusionPolicy();

      const result = await plugin.updateExclusionRules({
        excludedFolders: ["illegal-write/"],
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("unauthorized");
    });

    it("UI não apresenta sucesso se persistência falhar", async () => {
      const { plugin, app } = createTestPlugin({ role: "producer" });
      await plugin.initializeExclusionPolicy();

      const tab = new LinaSettingTab(app, plugin);

      // Simular falha de persistência no serviço
      const service = plugin.getExclusionPolicyService();
      vi.spyOn(service, "updateRules").mockResolvedValue({
        success: false,
        reason: "persistence-failed",
        error: "disk write error",
      });

      const initialFolders = plugin.getEffectiveExclusionRules().excludedFolders;
      await tab.setControlValue("indexExcludedFolders", "FailedFolder/");

      // Regras canónicas não foram alteradas
      expect(plugin.getEffectiveExclusionRules().excludedFolders).toEqual(initialFolders);
      expect(plugin.settings.indexExcludedFolders).not.toBe("FailedFolder/");
      tab.hide();
    });

    it("Em estado invalid: Settings Tab desativa controlos e recusa escrita", async () => {
      const { plugin, adapter, app } = createTestPlugin({ role: "producer" });
      const policyPath = getExclusionPolicyPath();
      adapter.setFile(policyPath, "{ corrupt invalid json");

      vi.spyOn(console, "error").mockImplementation(() => {});
      await plugin.initializeExclusionPolicy();

      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("invalid");
      expect(plugin.canEditExclusions()).toBe(false);

      const tab = new LinaSettingTab(app, plugin);
      const defs = tab.getSettingDefinitions().flatMap((g) => g.items);
      const folderDef = defs.find((d) => (d as { id?: string }).id === "excluded-folders") as {
        control?: { disabled?: boolean };
        desc?: string;
      };

      expect(folderDef?.control?.disabled).toBe(true);

      // Tentativa de escrita programática falha com invalid-policy
      const updateResult = await plugin.updateExclusionRules({
        excludedFolders: ["invalid-write/"],
      });
      expect(updateResult.success).toBe(false);
      expect(updateResult.reason).toBe("invalid-policy");

      tab.hide();
    });
  });

  // =========================================================================
  // 4. Integração Runtime
  // =========================================================================
  describe("Integração Runtime de Exclusões", () => {
    it("isIndexPathExcludedByUserRules respeita a política canónica ativa", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });

      const canonical = createInitialExclusionPolicy(
        {
          excludedFolders: ["private-docs/"],
          excludedPathContains: ["finance"],
        },
        createArtifactProvenance(TEST_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(EXCLUSION_POLICY_FILE_PATH, JSON.stringify(canonical, null, 2));
      await plugin.initializeExclusionPolicy();

      expect(plugin.isIndexPathExcludedByUserRules("private-docs/note.md")).toBe(true);
      expect(plugin.isIndexPathExcludedByUserRules("reports/finance-2026.md")).toBe(true);
      expect(plugin.isIndexPathExcludedByUserRules("public/note.md")).toBe(false);
    });

    it("isContentExcludedByUserRules respeita a política canónica ativa", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });

      const canonical = createInitialExclusionPolicy(
        {
          excludedContentContains: ["confidential", "topsecret"],
        },
        createArtifactProvenance(TEST_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(EXCLUSION_POLICY_FILE_PATH, JSON.stringify(canonical, null, 2));
      await plugin.initializeExclusionPolicy();

      expect(plugin.isContentExcludedByUserRules("This note contains confidential data.")).toBe(true);
      expect(plugin.isContentExcludedByUserRules("This is topsecret.")).toBe(true);
      expect(plugin.isContentExcludedByUserRules("This note is completely normal.")).toBe(false);
    });

    it("Event handling no vault e análise respeitam as regras da política canónica", async () => {
      const { plugin, adapter } = createTestPlugin({ role: "producer" });

      const canonical = createInitialExclusionPolicy(
        {
          excludedFolders: ["archive/"],
          excludedPathContains: ["draft"],
          excludedContentContains: ["skip-this-chunk"],
        },
        createArtifactProvenance(TEST_PRODUCER_DEVICE_ID, 1, "2026-09-01T10:00:00.000Z")
      );
      adapter.setFile(EXCLUSION_POLICY_FILE_PATH, JSON.stringify(canonical, null, 2));
      await plugin.initializeExclusionPolicy();

      // Caminhos excluídos pela política canónica são rejeitados pelo handler
      expect(plugin.isIndexPathExcludedByUserRules("archive/old-note.md")).toBe(true);
      expect(plugin.isIndexPathExcludedByUserRules("notes/draft-proposal.md")).toBe(true);
      expect(plugin.isIndexPathExcludedByUserRules("notes/published.md")).toBe(false);

      // Conteúdo excluído pela política canónica é rejeitado pelo handler
      expect(plugin.isContentExcludedByUserRules("content with skip-this-chunk in it")).toBe(true);
      expect(plugin.isContentExcludedByUserRules("content with standard text")).toBe(false);
    });
  });
});
