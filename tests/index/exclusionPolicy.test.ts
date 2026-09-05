/**
 * Test suite for Canonical Exclusion Policy Contract and Service (LINA-03-001)
 */

import { describe, expect, it } from "vitest";
import {
  ArtifactProvenance,
  createArtifactProvenance,
} from "../../src/device/artifactProvenance";
import {
  canonicalizeRulesForHash,
  computePolicyHash,
  convertLegacySettingsToExclusionRules,
  createInitialExclusionPolicy,
  evolveExclusionPolicy,
  EXCLUSION_POLICY_FILE_PATH,
  EXCLUSION_POLICY_SCHEMA_VERSION,
  ExclusionPolicyRules,
  ExclusionPolicyV1,
  getExclusionPolicyPath,
  isExclusionPolicy,
  isValidPolicyHash,
  normalizeExclusionRules,
  sha256Hex,
  validatePolicyIntegrity,
} from "../../src/index/exclusionPolicy";
import {
  ExclusionPolicyDataAdapter,
  ExclusionPolicyOwnershipGate,
  ExclusionPolicyService,
  loadExclusionPolicy,
  saveExclusionPolicy,
} from "../../src/index/exclusionPolicyService";
import {
  DEFAULT_EXCLUDED_FOLDERS,
  DEFAULT_EXCLUDED_PATH_CONTAINS,
  shouldExcludeContent,
  shouldExcludePath,
} from "../../src/index/indexExclusions";
import { FakeAdapter } from "../helpers/fakeAdapter";

describe("Exclusion Policy Contract and Service (LINA-03-001)", () => {
  const validDeviceId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const validProvenance: ArtifactProvenance = createArtifactProvenance(
    validDeviceId,
    1,
    "2026-09-01T10:00:00.000Z"
  );

  const sampleRules: ExclusionPolicyRules = Object.freeze({
    excludedFolders: Object.freeze(["03_pessoal/"]),
    excludedPathContains: Object.freeze(["password", "senha"]),
    excludedContentContains: Object.freeze(["confidential"]),
  });

  // -------------------------------------------------------------------------
  // 1. Semantic Normalization
  // -------------------------------------------------------------------------
  describe("Semantic Normalization", () => {
    it("trims whitespace, removes empty entries, and normalizes backslashes", () => {
      const normalized = normalizeExclusionRules({
        excludedFolders: [
          "  03_Pessoal/  ",
          "",
          "   ",
          "Archive\\Secret\\",
        ],
        excludedPathContains: ["  password  ", "", "  ", "API-KEY"],
        excludedContentContains: ["  CONFIDENTIAL  ", ""],
      });

      expect(normalized.excludedFolders).toEqual([
        "03_pessoal/",
        "archive/secret/",
      ]);
      expect(normalized.excludedPathContains).toEqual(["api-key", "password"]);
      expect(normalized.excludedContentContains).toEqual(["confidential"]);
    });

    it("deduplicates entries", () => {
      const normalized = normalizeExclusionRules({
        excludedFolders: ["folderA/", "foldera/", "folderA/"],
        excludedPathContains: ["token", "Token", "TOKEN"],
        excludedContentContains: ["secret", "Secret", " secret "],
      });

      expect(normalized.excludedFolders).toEqual(["foldera/"]);
      expect(normalized.excludedPathContains).toEqual(["token"]);
      expect(normalized.excludedContentContains).toEqual(["secret"]);
    });

    it("sorts entries deterministically", () => {
      const normalized = normalizeExclusionRules({
        excludedFolders: ["zebra/", "alpha/", "beta/"],
        excludedPathContains: ["zoo", "apple", "banana"],
        excludedContentContains: ["xyz", "abc"],
      });

      expect(normalized.excludedFolders).toEqual(["alpha/", "beta/", "zebra/"]);
      expect(normalized.excludedPathContains).toEqual([
        "apple",
        "banana",
        "zoo",
      ]);
      expect(normalized.excludedContentContains).toEqual(["abc", "xyz"]);
    });

    it("handles undefined or empty inputs gracefully", () => {
      const empty1 = normalizeExclusionRules();
      expect(empty1.excludedFolders).toEqual([]);
      expect(empty1.excludedPathContains).toEqual([]);
      expect(empty1.excludedContentContains).toEqual([]);

      const empty2 = normalizeExclusionRules({});
      expect(empty2.excludedFolders).toEqual([]);
      expect(empty2.excludedPathContains).toEqual([]);
      expect(empty2.excludedContentContains).toEqual([]);
    });

    it("preserves search engine matching semantics with normalized rules", () => {
      const rawRules = {
        excludedFolders: ["03_Pessoal/"],
        excludedPathContains: ["Password", "SENHA"],
        excludedContentContains: ["Confidential"],
      };
      const normalized = normalizeExclusionRules(rawRules);

      const testExclusions = {
        excludedFolders: [...normalized.excludedFolders],
        excludedPathContains: [...normalized.excludedPathContains],
        excludedContentContains: [...normalized.excludedContentContains],
      };

      // Folder match
      expect(
        shouldExcludePath("03_pessoal/doc.md", testExclusions, ".obsidian")
          .excluded
      ).toBe(true);
      expect(
        shouldExcludePath("03_Pessoal/doc.md", testExclusions, ".obsidian")
          .excluded
      ).toBe(true);

      // Path contains match
      expect(
        shouldExcludePath("notes/my-password.md", testExclusions, ".obsidian")
          .excluded
      ).toBe(true);
      expect(
        shouldExcludePath("notes/SENHA_backup.md", testExclusions, ".obsidian")
          .excluded
      ).toBe(true);

      // Content contains match
      expect(
        shouldExcludeContent(
          "this is highly CONFIDENTIAL text",
          normalized.excludedContentContains as string[]
        ).excluded
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Deterministic Hashing (policyHash)
  // -------------------------------------------------------------------------
  describe("policyHash and SHA-256", () => {
    it("computes standard SHA-256 for known test vector", () => {
      // SHA-256 of empty string is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const emptyHex = sha256Hex("");
      expect(emptyHex).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
    });

    it("produces identical hash for semantically equivalent rules in different order", () => {
      const hash1 = computePolicyHash({
        excludedFolders: ["b/", "a/"],
        excludedPathContains: ["two", "one"],
        excludedContentContains: ["beta", "alpha"],
      });

      const hash2 = computePolicyHash({
        excludedFolders: ["a/", "b/"],
        excludedPathContains: ["one", "two"],
        excludedContentContains: ["alpha", "beta"],
      });

      expect(hash1).toBe(hash2);
      expect(isValidPolicyHash(hash1)).toBe(true);
    });

    it("produces identical hash regardless of whitespace, casing, or duplicates", () => {
      const hash1 = computePolicyHash({
        excludedFolders: ["03_Pessoal/"],
        excludedPathContains: ["token"],
        excludedContentContains: ["secret"],
      });

      const hash2 = computePolicyHash({
        excludedFolders: ["  03_pessoal/  ", "03_Pessoal/"],
        excludedPathContains: ["TOKEN", "token", "  token  "],
        excludedContentContains: ["  Secret  ", "SECRET"],
      });

      expect(hash1).toBe(hash2);
    });

    it("produces different hash when rules semantically differ", () => {
      const hashBase = computePolicyHash({
        excludedFolders: ["03_pessoal/"],
        excludedPathContains: ["token"],
        excludedContentContains: ["secret"],
      });

      const hashAddedFolder = computePolicyHash({
        excludedFolders: ["03_pessoal/", "archive/"],
        excludedPathContains: ["token"],
        excludedContentContains: ["secret"],
      });

      const hashChangedPath = computePolicyHash({
        excludedFolders: ["03_pessoal/"],
        excludedPathContains: ["apikey"],
        excludedContentContains: ["secret"],
      });

      expect(hashBase).not.toBe(hashAddedFolder);
      expect(hashBase).not.toBe(hashChangedPath);
    });

    it("excludes provenance, revision, and timestamps from hash", () => {
      const rules = {
        excludedFolders: ["03_pessoal/"],
        excludedPathContains: ["password"],
        excludedContentContains: ["secret"],
      };

      const hashRules = computePolicyHash(rules);

      const deviceIdA = "550e8400-e29b-41d4-a716-446655440000";
      const deviceIdB = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

      const policyA: ExclusionPolicyV1 = {
        schemaVersion: 1,
        policyRevision: 1,
        policyHash: hashRules,
        provenance: createArtifactProvenance(deviceIdA, 1, "2026-09-01T00:00:00.000Z"),
        updatedAt: "2026-09-01T00:00:00.000Z",
        rules: normalizeExclusionRules(rules),
      };

      const policyB: ExclusionPolicyV1 = {
        schemaVersion: 1,
        policyRevision: 5,
        policyHash: hashRules,
        provenance: createArtifactProvenance(deviceIdB, 9, "2026-09-05T00:00:00.000Z"),
        updatedAt: "2026-09-05T00:00:00.000Z",
        rules: normalizeExclusionRules(rules),
      };

      expect(computePolicyHash(policyA.rules)).toBe(hashRules);
      expect(computePolicyHash(policyB.rules)).toBe(hashRules);
      expect(canonicalizeRulesForHash(policyA.rules)).toBe(
        canonicalizeRulesForHash(policyB.rules)
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Monotonic Revision Management
  // -------------------------------------------------------------------------
  describe("Monotonic policyRevision", () => {
    it("creates initial policy with policyRevision = 1", () => {
      const policy = createInitialExclusionPolicy(
        sampleRules,
        validProvenance,
        "2026-09-01T10:00:00.000Z"
      );

      expect(policy.schemaVersion).toBe(EXCLUSION_POLICY_SCHEMA_VERSION);
      expect(policy.policyRevision).toBe(1);
      expect(policy.policyHash).toBe(computePolicyHash(sampleRules));
      expect(policy.provenance).toEqual(validProvenance);
      expect(policy.updatedAt).toBe("2026-09-01T10:00:00.000Z");
    });

    it("increments revision (R -> R + 1) on semantic change", () => {
      const initial = createInitialExclusionPolicy(sampleRules, validProvenance);
      expect(initial.policyRevision).toBe(1);

      const updatedRules = {
        ...sampleRules,
        excludedFolders: ["03_pessoal/", "archive/"],
      };
      const evolved = evolveExclusionPolicy(
        initial,
        updatedRules,
        validProvenance
      );

      expect(evolved.policyRevision).toBe(2);
      expect(evolved.policyHash).not.toBe(initial.policyHash);
    });

    it("does NOT increment revision on idempotent save with identical semantics", () => {
      const initial = createInitialExclusionPolicy(sampleRules, validProvenance);

      // Equivalent rules with different order / casing / extra whitespace
      const equivalentRules = {
        excludedFolders: ["  03_PESSOAL/  "],
        excludedPathContains: ["SENHA", "PASSWORD", "senha"],
        excludedContentContains: ["confidential"],
      };

      const newProvenance = createArtifactProvenance(validDeviceId, 2);
      const evolved = evolveExclusionPolicy(
        initial,
        equivalentRules,
        newProvenance,
        "2026-09-05T12:00:00.000Z"
      );

      expect(evolved.policyRevision).toBe(initial.policyRevision);
      expect(evolved.policyHash).toBe(initial.policyHash);
      expect(evolved.provenance).toEqual(newProvenance);
      expect(evolved.updatedAt).toBe("2026-09-05T12:00:00.000Z");
    });

    it("rejects non-positive or non-integer revisions in validation", () => {
      const base = createInitialExclusionPolicy(sampleRules, validProvenance);

      expect(
        validatePolicyIntegrity({ ...base, policyRevision: 0 }).valid
      ).toBe(false);
      expect(
        validatePolicyIntegrity({ ...base, policyRevision: -1 }).valid
      ).toBe(false);
      expect(
        validatePolicyIntegrity({ ...base, policyRevision: 1.5 }).valid
      ).toBe(false);
      expect(
        validatePolicyIntegrity({ ...base, policyRevision: NaN }).valid
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Parsing and Integrity Validation
  // -------------------------------------------------------------------------
  describe("Parsing and Integrity Validation", () => {
    it("returns missing when file does not exist", async () => {
      const adapter = new FakeAdapter();
      const result = await loadExclusionPolicy(adapter);

      expect(result.status).toBe("missing");
    });

    it("loads and validates a well-formed policy", async () => {
      const adapter = new FakeAdapter();
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);
      await adapter.write(
        getExclusionPolicyPath(),
        JSON.stringify(policy, null, 2)
      );

      const result = await loadExclusionPolicy(adapter);
      expect(result.status).toBe("loaded");
      if (result.status === "loaded") {
        expect(result.policy).toEqual(policy);
        expect(isExclusionPolicy(result.policy)).toBe(true);
      }
    });

    it("defensively handles corrupt JSON and empty files without crashing", async () => {
      const adapter = new FakeAdapter();
      const targetPath = getExclusionPolicyPath();

      await adapter.write(targetPath, "");
      const emptyResult = await loadExclusionPolicy(adapter);
      expect(emptyResult.status).toBe("invalid");
      if (emptyResult.status === "invalid") {
        expect(emptyResult.reason).toBe("invalid-json");
      }

      await adapter.write(targetPath, "NOT_JSON{{{");
      const corruptResult = await loadExclusionPolicy(adapter);
      expect(corruptResult.status).toBe("invalid");
      if (corruptResult.status === "invalid") {
        expect(corruptResult.reason).toBe("invalid-json");
      }
    });

    it("rejects unsupported schemaVersion", async () => {
      const adapter = new FakeAdapter();
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);
      const unsupported = { ...policy, schemaVersion: 99 };
      await adapter.write(
        getExclusionPolicyPath(),
        JSON.stringify(unsupported)
      );

      const result = await loadExclusionPolicy(adapter);
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.reason).toBe("unsupported-schema");
      }
    });

    it("detects tampered policyHash and returns hash-mismatch", async () => {
      const adapter = new FakeAdapter();
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);
      const tampered = {
        ...policy,
        policyHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      };
      await adapter.write(getExclusionPolicyPath(), JSON.stringify(tampered));

      const result = await loadExclusionPolicy(adapter);
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.reason).toBe("hash-mismatch");
      }
    });

    it("rejects invalid hash format", async () => {
      const adapter = new FakeAdapter();
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);
      const invalidHash = {
        ...policy,
        policyHash: "md5:not-a-sha256",
      };
      await adapter.write(
        getExclusionPolicyPath(),
        JSON.stringify(invalidHash)
      );

      const result = await loadExclusionPolicy(adapter);
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.reason).toBe("invalid-hash-format");
      }
    });

    it("rejects invalid provenance or timestamps", () => {
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);

      expect(
        validatePolicyIntegrity({ ...policy, updatedAt: "not-a-date" }).valid
      ).toBe(false);

      expect(
        validatePolicyIntegrity({
          ...policy,
          provenance: { producerDeviceId: "bad-id" },
        }).valid
      ).toBe(false);
    });

    it("rejects non-array rules", () => {
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);
      const invalidRules = {
        ...policy,
        rules: {
          excludedFolders: "not-an-array",
          excludedPathContains: [],
          excludedContentContains: [],
        },
      };

      expect(validatePolicyIntegrity(invalidRules).valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Ownership Gating
  // -------------------------------------------------------------------------
  describe("Ownership Gating", () => {
    it("allows authorized Active Producer to write", async () => {
      const adapter = new FakeAdapter();
      const gate: ExclusionPolicyOwnershipGate = {
        canPublish: async () => true,
        getProvenance: () => validProvenance,
      };

      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);
      const result = await saveExclusionPolicy(adapter, policy, gate);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.policy).toEqual(policy);
      }
      expect(await adapter.exists(getExclusionPolicyPath())).toBe(true);
    });

    it("blocks Standby Producer from writing before any filesystem effects", async () => {
      const adapter = new FakeAdapter();
      const gate: ExclusionPolicyOwnershipGate = {
        canPublish: async () => false,
      };

      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);
      const result = await saveExclusionPolicy(adapter, policy, gate);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("unauthorized");
      }

      // Crucial: No write occurred, no temporary file created
      expect(adapter.writeCount).toBe(0);
      expect(await adapter.exists(getExclusionPolicyPath())).toBe(false);
      expect(adapter.listTempFiles()).toEqual([]);
    });

    it("blocks Companion device from writing", async () => {
      const adapter = new FakeAdapter();
      const service = new ExclusionPolicyService(adapter, {
        canPublish: async () => false,
      });

      const result = await service.updateRules(sampleRules);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("unauthorized");
      }
      expect(adapter.writeCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Persistence and Atomic Rollback (with FakeAdapter)
  // -------------------------------------------------------------------------
  describe("Staged Persistence and Rollback", () => {
    it("successfully creates initial canonical policy without leftover temps", async () => {
      const adapter = new FakeAdapter();
      const gate: ExclusionPolicyOwnershipGate = {
        canPublish: async () => true,
      };
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);

      const result = await saveExclusionPolicy(adapter, policy, gate);
      expect(result.success).toBe(true);

      const loaded = await loadExclusionPolicy(adapter);
      expect(loaded.status).toBe("loaded");
      if (loaded.status === "loaded") {
        expect(loaded.policy).toEqual(policy);
      }

      expect(adapter.listTempFiles()).toEqual([]);
      expect(adapter.listBackupFiles()).toEqual([]);
    });

    it("replaces existing canonical policy under strict mobile adapter rename constraint", async () => {
      const adapter = new FakeAdapter(undefined, {
        failRenameIfDestinationExists: true,
      });
      const gate: ExclusionPolicyOwnershipGate = {
        canPublish: async () => true,
        getProvenance: () => validProvenance,
      };

      const initial = createInitialExclusionPolicy(sampleRules, validProvenance);
      const save1 = await saveExclusionPolicy(adapter, initial, gate);
      expect(save1.success).toBe(true);

      const updated = evolveExclusionPolicy(
        initial,
        { ...sampleRules, excludedFolders: ["03_pessoal/", "archive/"] },
        validProvenance
      );
      const save2 = await saveExclusionPolicy(adapter, updated, gate);
      expect(save2.success).toBe(true);

      const loaded = await loadExclusionPolicy(adapter);
      expect(loaded.status).toBe("loaded");
      if (loaded.status === "loaded") {
        expect(loaded.policy).toEqual(updated);
        expect(loaded.policy.policyRevision).toBe(2);
      }

      expect(adapter.listTempFiles()).toEqual([]);
      expect(adapter.listBackupFiles()).toEqual([]);
    });

    it("restores last known canonical and cleans up temp when promotion fails", async () => {
      const targetPath = getExclusionPolicyPath();
      const adapter = new FakeAdapter(undefined, {
        failRenameIfDestinationExists: true,
      });
      const gate: ExclusionPolicyOwnershipGate = {
        canPublish: async () => true,
      };

      const initial = createInitialExclusionPolicy(sampleRules, validProvenance);
      const save1 = await saveExclusionPolicy(adapter, initial, gate);
      expect(save1.success).toBe(true);

      // Simulate failure during promotion (rename temp -> target)
      adapter.setOptions({
        shouldFail: (operation, path, destination) =>
          operation === "rename" &&
          path.includes(".tmp-") &&
          destination === targetPath,
      });

      const updated = evolveExclusionPolicy(
        initial,
        { ...sampleRules, excludedFolders: ["other/"] },
        validProvenance
      );

      const save2 = await saveExclusionPolicy(adapter, updated, gate);
      expect(save2.success).toBe(false);
      if (!save2.success) {
        expect(save2.reason).toBe("persistence-error");
      }

      // Verification: original canonical was restored via rollback
      const loaded = await loadExclusionPolicy(adapter);
      expect(loaded.status).toBe("loaded");
      if (loaded.status === "loaded") {
        expect(loaded.policy).toEqual(initial);
      }

      // No leftover temporary or backup files
      expect(adapter.listTempFiles()).toEqual([]);
      expect(adapter.listBackupFiles()).toEqual([]);
    });

    it("cleans up temporary file if write fails initially", async () => {
      const adapter = new FakeAdapter();
      adapter.setOptions({
        shouldFail: (operation, path) =>
          operation === "write" && path.includes(".tmp-"),
      });

      const gate: ExclusionPolicyOwnershipGate = {
        canPublish: async () => true,
      };
      const policy = createInitialExclusionPolicy(sampleRules, validProvenance);

      const result = await saveExclusionPolicy(adapter, policy, gate);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("persistence-error");
      }

      expect(await adapter.exists(getExclusionPolicyPath())).toBe(false);
      expect(adapter.listTempFiles()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 7. ExclusionPolicyService Lifecycle & updateRules
  // -------------------------------------------------------------------------
  describe("ExclusionPolicyService", () => {
    it("coordinates initial creation, semantic update, and idempotent update", async () => {
      const adapter = new FakeAdapter();
      let currentEpoch = 1;
      const gate: ExclusionPolicyOwnershipGate = {
        canPublish: async () => true,
        evaluateProvenance: async () =>
          createArtifactProvenance(validDeviceId, currentEpoch),
      };

      const service = new ExclusionPolicyService(adapter, gate);

      // 1. Initial creation
      const result1 = await service.updateRules(sampleRules);
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.policy.policyRevision).toBe(1);
      }

      // 2. Idempotent save (same rules with different casing/order)
      currentEpoch = 2;
      const result2 = await service.updateRules({
        excludedFolders: ["03_PESSOAL/"],
        excludedPathContains: ["SENHA", "PASSWORD"],
        excludedContentContains: ["CONFIDENTIAL"],
      });
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.policy.policyRevision).toBe(1); // Not incremented!
        expect(result2.policy.provenance.producerEpoch).toBe(2); // Provenance updated
      }

      // 3. Semantic change
      currentEpoch = 3;
      const result3 = await service.updateRules({
        excludedFolders: ["03_pessoal/", "04_projetos/"],
        excludedPathContains: ["senha"],
        excludedContentContains: ["confidential"],
      });
      expect(result3.success).toBe(true);
      if (result3.success) {
        expect(result3.policy.policyRevision).toBe(2); // Incremented!
      }
    });

    it("refuses to overwrite a corrupt existing policy silently", async () => {
      const adapter = new FakeAdapter();
      await adapter.write(getExclusionPolicyPath(), "INVALID_CORRUPT_DATA");

      const service = new ExclusionPolicyService(adapter, {
        canPublish: async () => true,
        getProvenance: () => validProvenance,
      });

      const result = await service.updateRules(sampleRules);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("invalid-policy");
        expect(result.error).toContain("existing exclusion policy");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. Legacy Settings Conversion
  // -------------------------------------------------------------------------
  describe("convertLegacySettingsToExclusionRules", () => {
    it("converts legacy string settings to normalized rules preserving semantics", () => {
      const converted = convertLegacySettingsToExclusionRules({
        indexExcludedFolders: "03_Pessoal/\nArchive\\Notes\n\n",
        indexExcludedPathContains: "senha\nsenhas\npassword\n",
        indexExcludedContentContains: "confidential, internal; secret\nprivate",
      });

      expect(converted.excludedFolders).toEqual([
        "03_pessoal/",
        "archive/notes",
      ]);
      expect(converted.excludedPathContains).toEqual([
        "password",
        "senha",
        "senhas",
      ]);
      expect(converted.excludedContentContains).toEqual([
        "confidential",
        "internal",
        "private",
        "secret",
      ]);
    });

    it("converts default settings constants cleanly", () => {
      const converted = convertLegacySettingsToExclusionRules({
        indexExcludedFolders: DEFAULT_EXCLUDED_FOLDERS.join("\n"),
        indexExcludedPathContains: DEFAULT_EXCLUDED_PATH_CONTAINS.join("\n"),
        indexExcludedContentContains: "",
      });

      expect(converted.excludedFolders).toEqual(["03_pessoal/"]);
      expect(converted.excludedPathContains.length).toBe(
        DEFAULT_EXCLUDED_PATH_CONTAINS.length
      );
      expect(converted.excludedContentContains).toEqual([]);
    });

    it("handles undefined settings without throwing", () => {
      const converted = convertLegacySettingsToExclusionRules({});
      expect(converted.excludedFolders).toEqual([]);
      expect(converted.excludedPathContains).toEqual([]);
      expect(converted.excludedContentContains).toEqual([]);
    });
  });
});
