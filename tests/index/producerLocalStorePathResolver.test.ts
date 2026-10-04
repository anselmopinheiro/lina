import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import {
  PRODUCER_STORE_DEFAULT_DB_NAME,
  PRODUCER_STORE_SCHEMA_VERSION,
} from "../../src/index/producerLocalStoreTypes";
import {
  DefaultProducerLocalStorePathResolver,
  canonicalizePath,
  checkPathSeparationFromVault,
  resolveDefaultStoreDirectory,
} from "../../src/index/producerLocalStorePathResolver";

describe("ProducerLocalStore Path Resolver (Phase M0)", () => {
  describe("Constants and Contracts", () => {
    it("exports canonical schema version 1 and default db name", () => {
      expect(PRODUCER_STORE_SCHEMA_VERSION).toBe(1);
      expect(PRODUCER_STORE_DEFAULT_DB_NAME).toBe("lina-producer.db");
    });
  });

  describe("Cross-Platform Default Path Resolution", () => {
    it("resolves Windows path using non-roaming LOCALAPPDATA and ignores Roaming APPDATA", () => {
      const dir = resolveDefaultStoreDirectory({
        platform: "win32",
        env: {
          LOCALAPPDATA: "C:\\Users\\TestUser\\AppData\\Local",
          APPDATA: "C:\\Users\\TestUser\\AppData\\Roaming",
        },
        homedir: "C:\\Users\\TestUser",
      });
      expect(dir).toBe("C:/Users/TestUser/AppData/Local/lina/db");
      expect(dir).not.toContain("Roaming");
    });

    it("resolves Windows path using homedir fallback when LOCALAPPDATA is missing", () => {
      const dir = resolveDefaultStoreDirectory({
        platform: "win32",
        env: {},
        homedir: "C:\\Users\\TestUser",
      });
      expect(dir).toBe("C:/Users/TestUser/AppData/Local/lina/db");
    });

    it("resolves macOS path using Application Support", () => {
      const dir = resolveDefaultStoreDirectory({
        platform: "darwin",
        homedir: "/Users/TestUser",
      });
      expect(dir).toBe("/Users/TestUser/Library/Application Support/lina/db");
    });

    it("resolves Linux path using XDG_STATE_HOME if present", () => {
      const dir = resolveDefaultStoreDirectory({
        platform: "linux",
        env: { XDG_STATE_HOME: "/home/testuser/.custom-state" },
        homedir: "/home/testuser",
      });
      expect(dir).toBe("/home/testuser/.custom-state/lina/db");
    });

    it("resolves Linux path using ~/.local/state fallback when XDG_STATE_HOME is unset", () => {
      const dir = resolveDefaultStoreDirectory({
        platform: "linux",
        env: {},
        homedir: "/home/testuser",
      });
      expect(dir).toBe("/home/testuser/.local/state/lina/db");
    });
  });

  describe("Vault Separation and Boundary Checking", () => {
    const vaultPath = "/mock/vault";

    it("identifies paths outside the vault correctly", () => {
      const externalPath = "/mock/user/appdata/lina/db/lina-producer.db";
      const result = checkPathSeparationFromVault(vaultPath, externalPath, "linux");
      expect(result.insideVault).toBe(false);
      expect(result.canonicalVaultPath).toBe("/mock/vault");
      expect(result.canonicalTargetPath).toBe("/mock/user/appdata/lina/db/lina-producer.db");
    });

    it("identifies paths inside the vault root correctly", () => {
      const insidePath = "/mock/vault/.lina/db/lina-producer.db";
      const result = checkPathSeparationFromVault(vaultPath, insidePath, "linux");
      expect(result.insideVault).toBe(true);
    });

    it("identifies target identical to vault root as inside vault", () => {
      const result = checkPathSeparationFromVault(vaultPath, vaultPath, "linux");
      expect(result.insideVault).toBe(true);
    });

    it("handles case-insensitivity on Windows", () => {
      const winVault = "C:/Users/User/Documents/Vault";
      const winInside = "c:/users/user/documents/vault/.lina/store.db";
      const result = checkPathSeparationFromVault(winVault, winInside, "win32");
      expect(result.insideVault).toBe(true);
    });

    it("handles sibling directories on the same drive on Windows", () => {
      const winVault = "C:/Users/User/Documents/Vault";
      const winSibling = "C:/Users/User/Documents/Vault-Other/store.db";
      const result = checkPathSeparationFromVault(winVault, winSibling, "win32");
      expect(result.insideVault).toBe(false);
    });
  });

  describe("DefaultProducerLocalStorePathResolver Class", () => {
    it("resolves full resolution structure with default paths", () => {
      const vaultPath = "/workspace/obsidian-vault";
      const homedir = "/home/testuser";
      const resolver = new DefaultProducerLocalStorePathResolver(vaultPath, {
        platform: "linux",
        homedir,
      });

      const resolution = resolver.resolveStorePath();
      expect(resolution.isCustomPath).toBe(false);
      expect(resolution.storeDirectory).toBe("/home/testuser/.local/state/lina/db");
      expect(resolution.databasePath).toBe(
        `/home/testuser/.local/state/lina/db/${PRODUCER_STORE_DEFAULT_DB_NAME}`
      );
      expect(resolution.separation.insideVault).toBe(false);
    });

    it("resolves custom directory path correctly", () => {
      const vaultPath = "/workspace/obsidian-vault";
      const resolver = new DefaultProducerLocalStorePathResolver(vaultPath, {
        platform: "linux",
        homedir: "/home/testuser",
      });

      const customDir = "/opt/lina-storage";
      const resolution = resolver.resolveStorePath(customDir);
      expect(resolution.isCustomPath).toBe(true);
      expect(resolution.storeDirectory).toBe("/opt/lina-storage");
      expect(resolution.databasePath).toBe(`/opt/lina-storage/${PRODUCER_STORE_DEFAULT_DB_NAME}`);
      expect(resolution.separation.insideVault).toBe(false);
    });

    it("resolves custom file path ending with .db correctly", () => {
      const vaultPath = "/workspace/obsidian-vault";
      const resolver = new DefaultProducerLocalStorePathResolver(vaultPath, {
        platform: "linux",
        homedir: "/home/testuser",
      });

      const customFile = "/opt/lina-storage/custom-database.db";
      const resolution = resolver.resolveStorePath(customFile);
      expect(resolution.isCustomPath).toBe(true);
      expect(resolution.storeDirectory).toBe("/opt/lina-storage");
      expect(resolution.databasePath).toBe(customFile);
      expect(resolution.separation.insideVault).toBe(false);
    });

    it("flags custom path that is placed inside the vault", () => {
      const vaultPath = "/workspace/obsidian-vault";
      const resolver = new DefaultProducerLocalStorePathResolver(vaultPath, {
        platform: "linux",
        homedir: "/home/testuser",
      });

      const insideVaultPath = "/workspace/obsidian-vault/local-db/my.db";
      const resolution = resolver.resolveStorePath(insideVaultPath);
      expect(resolution.separation.insideVault).toBe(true);
    });
  });

  describe("Zero Side Effects in M0", () => {
    it("does not create files or directories during path resolution", () => {
      const vaultPath = "./mock-test-vault-m0";
      const nonExistentDir = "./non-existent-test-dir-m0-check";

      expect(fs.existsSync(nonExistentDir)).toBe(false);

      const resolver = new DefaultProducerLocalStorePathResolver(vaultPath, {
        platform: "linux",
        homedir: nonExistentDir,
      });

      resolver.resolveStorePath();
      expect(fs.existsSync(nonExistentDir)).toBe(false);
    });
  });
});
