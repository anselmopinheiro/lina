/**
 * Test suite for LINA-03-003: Manifest & Policy Provenance.
 *
 * Covers:
 * 1. Schema & Serialization (stamped revision/hash, legacy omission, validation, manifest-last invariant)
 * 2. Pure Policy Compatibility Evaluation (compatible, mismatch, unknown reasons)
 * 3. Producer Publication Lifecycle (Active Producer stamping, Companion safety, invalid policy protection)
 * 4. Graceful Degradation & Legacy Support
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { App, TFile } from "obsidian";
import LinaPlugin from "../../main.ts";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { FakeApp } from "../helpers/fakeApp";
import {
  saveTextIndex,
  readTextIndexStatus,
  readIndexedNotes,
  readIndexedChunks,
  TextIndexManifest,
} from "../../src/index/indexStore";
import {
  evaluateExclusionPolicyCompatibility,
  getExclusionPolicyPath,
} from "../../src/index/exclusionPolicy";
import { evaluateCompanionConsumptionState } from "../../src/companion/companionConsumptionState";
import {
  VALID_MANIFEST,
  VALID_NOTES,
  VALID_CHUNKS,
} from "../fixtures/indexFixtures";
import { DEFAULT_SETTINGS, setDeviceSettingsContext } from "../../src/settings";

const HASH_A = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const HASH_B = "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

function asApp(fake: FakeApp): App {
  return fake as unknown as App;
}

const TEST_PRODUCER_DEVICE_ID = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";

function createTestPlugin(options?: {
  role?: "producer" | "companion";
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
  (app.vault as unknown as { adapter: FakeAdapter }).adapter = adapter;

  const plugin = new LinaPlugin(app);
  const deviceId = options?.deviceId ?? TEST_PRODUCER_DEVICE_ID;

  app.loadLocalStorage = (key: string) => {
    if (key === "lina_device_id") return deviceId;
    return undefined;
  };

  plugin.settings = {
    ...DEFAULT_SETTINGS,
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

  setDeviceSettingsContext(plugin.settings, () => { void plugin.saveSettings(); }, deviceId);

  return { plugin, adapter, app };
}

describe("LINA-03-003: Manifest & Policy Provenance", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
      clearTimeout: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // =========================================================================
  // 1. Schema & Serialização
  // =========================================================================
  describe("1. Schema & Serialização", () => {
    it("1. manifesto serialization inclui exclusionPolicyRevision e exclusionPolicyHash", async () => {
      const success = await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        undefined,
        undefined,
        { policyRevision: 3, policyHash: HASH_A }
      );

      expect(success).toBe(true);

      const manifestContent = await adapter.read(".lina/index/manifest.json");
      const manifest = JSON.parse(manifestContent) as TextIndexManifest;

      expect(manifest.exclusionPolicyRevision).toBe(3);
      expect(manifest.exclusionPolicyHash).toBe(HASH_A);
    });

    it("2. manifestos serializados omitem campos quando ausentes/legados", async () => {
      const success = await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 }
      );

      expect(success).toBe(true);

      const manifestContent = await adapter.read(".lina/index/manifest.json");
      const manifest = JSON.parse(manifestContent) as Record<string, unknown>;

      expect("exclusionPolicyRevision" in manifest).toBe(false);
      expect("exclusionPolicyHash" in manifest).toBe(false);
    });

    it("3. manifesto legacy sem campos continua válido", async () => {
      adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
      adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
      adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

      const status = await readTextIndexStatus(asApp(app), {
        activePolicy: { policyRevision: 1, policyHash: HASH_A },
      });

      expect(status.exists).toBe(true);
      expect(status.isUsable).toBe(true);
      expect(status.usability).toBe("ready");
      expect(status.manifest?.exclusionPolicyHash).toBeUndefined();
      expect(status.manifest?.exclusionPolicyRevision).toBeUndefined();
      expect(status.policyCompatibility).toEqual({
        status: "unknown",
        reason: "legacy-manifest",
      });
    });

    it("4. valores inválidos de hash/revision são rejeitados ou classificados adequadamente segundo o parser atual", async () => {
      // 4a. saveTextIndex com hash inválido -> rejeitado
      const invalidHashResult = await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        undefined,
        undefined,
        { policyRevision: 1, policyHash: "invalid-hash-string" }
      );
      expect(invalidHashResult).toBe(false);

      // 4b. saveTextIndex com revision inválida (<= 0) -> rejeitado
      const invalidRevisionResult = await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        undefined,
        undefined,
        { policyRevision: 0, policyHash: HASH_A }
      );
      expect(invalidRevisionResult).toBe(false);

      // 4c. readTextIndexStatus com manifesto contendo revision inválida no disco -> inválido
      const invalidManifestOnDisk: TextIndexManifest = {
        ...VALID_MANIFEST,
        exclusionPolicyRevision: -5,
        exclusionPolicyHash: HASH_A,
      };
      adapter.setFile(".lina/index/manifest.json", JSON.stringify(invalidManifestOnDisk, null, 2));
      adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
      adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

      const readStatus = await readTextIndexStatus(asApp(app));
      expect(readStatus.isUsable).toBe(false);
      expect(readStatus.usability).toBe("invalid");
    });

    it("5. manifest-last invariant continua intacto", async () => {
      const renameLog: string[] = [];
      const originalRename = adapter.rename.bind(adapter);

      adapter.rename = async (oldPath: string, newPath: string) => {
        renameLog.push(newPath);
        return originalRename(oldPath, newPath);
      };

      const success = await saveTextIndex(
        asApp(app),
        VALID_NOTES,
        VALID_CHUNKS,
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        undefined,
        undefined,
        { policyRevision: 1, policyHash: HASH_A }
      );

      expect(success).toBe(true);
      expect(renameLog).toHaveLength(3);
      // O manifesto deve ser o último ficheiro renomeado/publicado
      expect(renameLog[0]).toContain("notes.json");
      expect(renameLog[1]).toContain("chunks.jsonl");
      expect(renameLog[2]).toContain("manifest.json");
    });
  });

  // =========================================================================
  // 2. Avaliação de Compatibilidade
  // =========================================================================
  describe("2. Avaliação de Compatibilidade (evaluateExclusionPolicyCompatibility)", () => {
    it("6. mesmo hash -> compatible", () => {
      const result = evaluateExclusionPolicyCompatibility(
        { policyRevision: 2, policyHash: HASH_A },
        { exclusionPolicyRevision: 2, exclusionPolicyHash: HASH_A }
      );

      expect(result).toEqual({
        status: "compatible",
        activeHash: HASH_A,
        artifactHash: HASH_A,
        activeRevision: 2,
        artifactRevision: 2,
      });
    });

    it("7. hashes diferentes -> mismatch", () => {
      const result = evaluateExclusionPolicyCompatibility(
        { policyRevision: 1, policyHash: HASH_A },
        { exclusionPolicyRevision: 1, exclusionPolicyHash: HASH_B }
      );

      expect(result).toEqual({
        status: "mismatch",
        activeHash: HASH_A,
        artifactHash: HASH_B,
        activeRevision: 1,
        artifactRevision: 1,
      });
    });

    it("8. revision diferente + hash igual -> compatible", () => {
      const result = evaluateExclusionPolicyCompatibility(
        { policyRevision: 5, policyHash: HASH_A },
        { exclusionPolicyRevision: 1, exclusionPolicyHash: HASH_A }
      );

      expect(result.status).toBe("compatible");
    });

    it("9. revision igual + hash diferente -> mismatch", () => {
      const result = evaluateExclusionPolicyCompatibility(
        { policyRevision: 2, policyHash: HASH_A },
        { exclusionPolicyRevision: 2, exclusionPolicyHash: HASH_B }
      );

      expect(result.status).toBe("mismatch");
    });

    it("10. legacy manifest -> unknown (reason: legacy-manifest)", () => {
      const result = evaluateExclusionPolicyCompatibility(
        { policyRevision: 1, policyHash: HASH_A },
        { version: 1, indexType: "text" }
      );

      expect(result).toEqual({
        status: "unknown",
        reason: "legacy-manifest",
      });
    });

    it("11. active policy unavailable/invalid -> unknown (reason: policy-unavailable)", () => {
      // 11a. active policy undefined
      expect(
        evaluateExclusionPolicyCompatibility(undefined, { exclusionPolicyHash: HASH_A })
      ).toEqual({
        status: "unknown",
        reason: "policy-unavailable",
      });

      // 11b. active policy with invalid hash
      expect(
        evaluateExclusionPolicyCompatibility(
          { policyRevision: 1, policyHash: "bad-hash" },
          { exclusionPolicyHash: HASH_A }
        )
      ).toEqual({
        status: "unknown",
        reason: "policy-unavailable",
      });
    });
  });

  // =========================================================================
  // 3. Ciclo de Vida do Producer e Persistência Integrada
  // =========================================================================
  describe("3. Ciclo de Vida do Producer e Persistência", () => {
    it("12. Active Producer publica manifesto stamped", async () => {
      const { plugin, adapter, app } = createTestPlugin({ role: "producer" });

      // Setup vault files for rebuild
      const noteFile = new TFile("test-note.md", "Conteúdo da nota de teste.");
      (noteFile as unknown as { stat: { size: number; mtime: number } }).stat = { size: 50, mtime: Date.now() };

      app.vault.getMarkdownFiles = () => [noteFile];
      app.vault.getAbstractFileByPath = () => noteFile;
      app.vault.read = async () => "Conteúdo da nota de teste.";

      // Initialize policy to loaded
      await plugin.initializeExclusionPolicy();
      const policy = plugin.getCanonicalExclusionPolicy();
      expect(policy).toBeDefined();

      const result = await plugin.rebuildTextIndex();
      expect(result.success).toBe(true);

      const manifestContent = await adapter.read(".lina/index/manifest.json");
      const manifest = JSON.parse(manifestContent) as TextIndexManifest;

      expect(manifest.exclusionPolicyRevision).toBe(policy!.policyRevision);
      expect(manifest.exclusionPolicyHash).toBe(policy!.policyHash);
    });

    it("13. Standby/Companion não ganham nova capacidade de publicar", () => {
      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: "companion-device-1",
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          exclusionPolicyRevision: 1,
          exclusionPolicyHash: HASH_A,
        },
        activePolicy: { policyRevision: 1, policyHash: HASH_A },
      });

      // Companion can consume safely
      expect(consumptionState.canConsume).toBe(true);
      expect(consumptionState.isCompanion).toBe(true);
      expect(consumptionState.policyCompatibility).toEqual({
        status: "compatible",
        activeHash: HASH_A,
        artifactHash: HASH_A,
        activeRevision: 1,
        artifactRevision: 1,
      });
    });

    it("14. policy invalid impede publicação indevidamente estampada", async () => {
      const { plugin, adapter, app } = createTestPlugin({ role: "producer" });

      // Simulate corrupted/invalid exclusions.json
      const policyPath = getExclusionPolicyPath();
      adapter.setFile(policyPath, "corrupted json { invalid");

      await plugin.initializeExclusionPolicy();
      expect(plugin.getCanonicalExclusionPolicyStatus()).toBe("invalid");

      const rebuildResult = await plugin.rebuildTextIndex();
      expect(rebuildResult.success).toBe(false);
      expect(rebuildResult.message).toContain("Canonical exclusion policy is invalid");

      // Verify no manifest was written
      expect(await adapter.exists(".lina/index/manifest.json")).toBe(false);
    });

    it("15. policy valid + rebuild -> manifesto contém identidade correta", async () => {
      const { plugin, adapter, app } = createTestPlugin({ role: "producer" });

      const noteFile = new TFile("valid-note.md", "Conteúdo válido para rebuild.");
      (noteFile as unknown as { stat: { size: number; mtime: number } }).stat = { size: 30, mtime: Date.now() };

      app.vault.getMarkdownFiles = () => [noteFile];
      app.vault.getAbstractFileByPath = () => noteFile;
      app.vault.read = async () => "Conteúdo válido para rebuild.";

      await plugin.initializeExclusionPolicy();
      const loadedPolicy = plugin.getCanonicalExclusionPolicy()!;

      await plugin.rebuildTextIndex();

      const manifest = JSON.parse(await adapter.read(".lina/index/manifest.json")) as TextIndexManifest;
      expect(manifest.exclusionPolicyHash).toBe(loadedPolicy.policyHash);
      expect(manifest.exclusionPolicyRevision).toBe(loadedPolicy.policyRevision);
    });
  });

  // =========================================================================
  // 4. Degradação Graciosa e Suporte a Manifestos Legados
  // =========================================================================
  describe("4. Degradação Graciosa e Suporte a Legados", () => {
    it("16. inexistência de exclusionPolicyHash não causa erro em runtime", async () => {
      adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
      adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
      adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

      // Chamada sem política ativa
      const statusNoPolicy = await readTextIndexStatus(asApp(app));
      expect(statusNoPolicy.isUsable).toBe(true);
      expect(statusNoPolicy.policyCompatibility).toEqual({
        status: "unknown",
        reason: "policy-unavailable",
      });

      // Chamada com política ativa
      const statusWithPolicy = await readTextIndexStatus(asApp(app), {
        activePolicy: { policyRevision: 1, policyHash: HASH_A },
      });
      expect(statusWithPolicy.isUsable).toBe(true);
      expect(statusWithPolicy.policyCompatibility).toEqual({
        status: "unknown",
        reason: "legacy-manifest",
      });
    });

    it("17. leituras legacy continuam a operar normalmente", async () => {
      adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
      adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
      adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

      const notes = await readIndexedNotes(asApp(app));
      const chunks = await readIndexedChunks(asApp(app));
      const status = await readTextIndexStatus(asApp(app));

      expect(notes).toHaveLength(2);
      expect(chunks).toHaveLength(3);
      expect(status.exists).toBe(true);
      expect(status.isUsable).toBe(true);
      expect(status.usability).toBe("ready");
      expect(status.totalNotes).toBe(2);
      expect(status.totalChunks).toBe(3);
    });
  });
});
