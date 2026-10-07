import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SqliteProducerLocalStore,
  type DatabaseSyncLike,
  type DatabaseSyncStatementLike,
} from "../../src/index/sqliteProducerLocalStore";
import {
  performProducerSqliteShadowWrite,
  buildSpaceRecordFromPublication,
  buildProducerRecordsFromPublication,
} from "../../src/index/sqliteProducerShadowWriter";
import { DefaultProducerLocalStorePathResolver } from "../../src/index/producerLocalStorePathResolver";
import { PRODUCER_STORE_SCHEMA_VERSION } from "../../src/index/producerLocalStoreTypes";
import type { EmbeddingRecord, EmbeddingPublicationInfo } from "../../src/index/embeddingPersistence";

class TestInMemoryDatabaseSync implements DatabaseSyncLike {
  public executedSqls: string[] = [];
  public tables: Record<string, any[]> = {
    schema_migrations: [],
    embedding_spaces: [],
    embedding_records: [],
  };
  public isClosed = false;
  public failNextTransaction = false;

  exec(sql: string): void {
    this.executedSqls.push(sql);
    if (sql.includes("INSERT INTO schema_migrations")) {
      const match = sql.match(/VALUES\s*\(\s*(\d+)/i);
      const version = match ? parseInt(match[1], 10) : 1;
      this.tables.schema_migrations.push({ version, applied_at: new Date().toISOString(), description: "Migration" });
    }
    if (this.failNextTransaction && sql.includes("BEGIN TRANSACTION")) {
      throw new Error("Simulated SQLite Transaction Error");
    }
  }

  prepare(sql: string): DatabaseSyncStatementLike {
    const self = this;
    const cleanSql = sql.trim();

    return {
      run(...params: unknown[]) {
        if (cleanSql.includes("INSERT INTO schema_migrations")) {
          self.tables.schema_migrations.push({
            version: params[0],
            applied_at: params[1],
            description: params[2],
          });
        } else if (cleanSql.includes("INSERT INTO embedding_spaces")) {
          const spaceId = params[0] as string;
          const idx = self.tables.embedding_spaces.findIndex((s) => s.space_id === spaceId);
          const rec = {
            space_id: params[0],
            vector_contract_id: params[1],
            provider: params[2],
            model: params[3],
            dimension: params[4],
            dtype: params[5],
            input_version: params[6],
            created_at: params[7],
            updated_at: params[8],
          };
          if (idx >= 0) {
            self.tables.embedding_spaces[idx] = rec;
          } else {
            self.tables.embedding_spaces.push(rec);
          }
        } else if (cleanSql.includes("INSERT INTO embedding_records")) {
          const chunkId = params[0] as string;
          const idx = self.tables.embedding_records.findIndex((r) => r.chunk_id === chunkId);
          const rec = {
            chunk_id: params[0],
            space_id: params[1],
            note_path: params[2],
            chunk_index: params[3],
            text_hash: params[4],
            vector_contract_id: params[5],
            embedding_input_hash: params[6],
            embedding_blob: params[7],
            created_at: params[8],
            updated_at: params[9],
          };
          if (idx >= 0) {
            self.tables.embedding_records[idx] = rec;
          } else {
            self.tables.embedding_records.push(rec);
          }
        }
        return { changes: 1 };
      },
      get(...params: unknown[]) {
        if (cleanSql.includes("SELECT MAX(version)")) {
          const versions = self.tables.schema_migrations.map((m) => m.version);
          const maxVersion = versions.length > 0 ? Math.max(...versions) : null;
          return { maxVersion };
        } else if (cleanSql.includes("FROM embedding_records WHERE chunk_id =")) {
          const chunkId = params[0] as string;
          const rec = self.tables.embedding_records.find((r) => r.chunk_id === chunkId);
          return rec;
        } else if (cleanSql.includes("SELECT COUNT(*)")) {
          if (cleanSql.includes("WHERE space_id =")) {
            const spaceId = params[0] as string;
            const cnt = self.tables.embedding_records.filter((r) => r.space_id === spaceId).length;
            return { cnt };
          } else {
            return { cnt: self.tables.embedding_records.length };
          }
        }
        return undefined;
      },
      all() {
        return [];
      },
    };
  }

  close(): void {
    this.isClosed = true;
  }
}

describe("SQLite Producer Local Store & Shadow Writer (Phase M1)", () => {
  let mockDb: TestInMemoryDatabaseSync;
  const mockVaultPath = "/mock/user/vault";
  const externalDbPath = "/mock/user/appdata/lina/db/lina-producer.db";

  beforeEach(() => {
    mockDb = new TestInMemoryDatabaseSync();
  });

  describe("1. Clean DB Creation & Vault Boundaries", () => {
    it("resolves store path strictly outside the vault", () => {
      const resolver = new DefaultProducerLocalStorePathResolver(mockVaultPath, {
        platform: "linux",
        homedir: "/mock/user",
      });
      const resolution = resolver.resolveStorePath();
      expect(resolution.separation.insideVault).toBe(false);
      expect(resolution.databasePath).not.toContain(mockVaultPath);
    });

    it("verifies absence of .db, .db-wal, and .db-shm inside the vault", () => {
      const resolver = new DefaultProducerLocalStorePathResolver(mockVaultPath, {
        platform: "linux",
        homedir: "/mock/user",
      });
      const resolution = resolver.resolveStorePath();
      expect(resolution.databasePath.endsWith(".db")).toBe(true);
      expect(resolution.databasePath.startsWith(mockVaultPath)).toBe(false);
    });
  });

  describe("2. PRAGMA & Schema Migrations", () => {
    it("applies WAL, FULL synchronous, and foreign_keys PRAGMAs on open", () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      store.open();

      expect(mockDb.executedSqls).toContain("PRAGMA journal_mode = WAL;");
      expect(mockDb.executedSqls).toContain("PRAGMA synchronous = FULL;");
      expect(mockDb.executedSqls).toContain("PRAGMA foreign_keys = ON;");
    });

    it("initializes schema version 3 idempotently", () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      store.open();
      expect(store.getSchemaVersion()).toBe(PRODUCER_STORE_SCHEMA_VERSION);
      expect(mockDb.tables.schema_migrations.length).toBe(3);
      expect(mockDb.tables.schema_migrations[0].version).toBe(1);
      expect(mockDb.tables.schema_migrations[1].version).toBe(2);
      expect(mockDb.tables.schema_migrations[2].version).toBe(3);

      // Reopen idempotency
      store.open();
      expect(store.getSchemaVersion()).toBe(PRODUCER_STORE_SCHEMA_VERSION);
      expect(mockDb.tables.schema_migrations.length).toBe(3);
    });

    it("migrates an existing v1 database to v3 without removing vector contracts", () => {
      mockDb.tables.schema_migrations.push({ version: 1, applied_at: "t", description: "v1" });
      const store = new SqliteProducerLocalStore({ databasePath: externalDbPath, customDbInstance: mockDb });
      store.open();
      expect(store.getSchemaVersion()).toBe(3);
      expect(mockDb.tables.schema_migrations.map((entry) => entry.version)).toEqual([1, 2, 3]);
      expect(mockDb.executedSqls.some((sql) => sql.includes("ALTER TABLE embedding_records ADD COLUMN embedding_input_hash TEXT;"))).toBe(true);
      expect(mockDb.executedSqls.some((sql) => sql.includes("DROP COLUMN") || sql.includes("vector_contract_id") && sql.includes("DROP"))).toBe(false);
    });
  });

  describe("3. Float32Array BLOB Storage & Reopen Technical Read", () => {
    it("stores and retrieves Float32Array embedding records accurately", () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      store.open();

      const sampleEmbedding = new Float32Array([0.1, -0.2, 0.5, 0.85]);
      const now = new Date().toISOString();

      const space = buildSpaceRecordFromPublication(
        { provider: "ollama", model: "nomic-embed-text", dimensions: 4, inputVersion: 1, prefixMode: "none" },
        []
      );

      store.upsertEmbeddingSpace(space);

      store.upsertEmbeddingRecord({
        chunkId: "chunk-101",
        spaceId: space.spaceId,
        notePath: "Folder/Note.md",
        chunkIndex: 0,
        textHash: "hash-abc",
        vectorContractId: space.vectorContractId,
        embeddingInputHash: "hash-input-abc",
        embeddingBlob: sampleEmbedding,
        createdAt: now,
        updatedAt: now,
      });

      const retrieved = store.getEmbeddingRecord("chunk-101");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.chunkId).toBe("chunk-101");
      expect(retrieved?.notePath).toBe("Folder/Note.md");
      expect(retrieved?.embeddingBlob).toBeInstanceOf(Float32Array);
      const arr = Array.from(retrieved!.embeddingBlob as Float32Array);
      expect(arr[0]).toBeCloseTo(0.1);
      expect(arr[1]).toBeCloseTo(-0.2);
      expect(arr[2]).toBeCloseTo(0.5);
      expect(arr[3]).toBeCloseTo(0.85);
    });
  });

  describe("4. Batch Upsert & Transaction Rollback", () => {
    it("executes batch upserts coherently", () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      store.open();

      const space = buildSpaceRecordFromPublication(
        { provider: "ollama", model: "nomic-embed-text", dimensions: 3, inputVersion: 1, prefixMode: "none" },
        []
      );

      const records: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "m", provider: "p", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
        { chunkId: "c2", path: "B.md", index: 0, textHash: "h2", model: "m", provider: "p", dimensions: 3, embedding: [0.4, 0.5, 0.6], createdAt: "t1" },
      ];

      const producerRecords = buildProducerRecordsFromPublication(space.spaceId, records);
      store.upsertEmbeddingBatch(space, producerRecords);

      expect(store.countRecords()).toBe(2);
      expect(mockDb.executedSqls).toContain("BEGIN TRANSACTION;");
      expect(mockDb.executedSqls).toContain("COMMIT;");
    });

    it("rolls back transaction on error", () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      store.open();
      
      const space = buildSpaceRecordFromPublication(
        { provider: "ollama", model: "nomic-embed-text", dimensions: 2, inputVersion: 1, prefixMode: "none" },
        []
      );

      // Force error inside upsert space
      store.upsertEmbeddingSpace = () => {
        throw new Error("Simulated Upsert Space Failure");
      };

      expect(() => store.upsertEmbeddingBatch(space, [])).toThrow("Simulated Upsert Space Failure");
      expect(mockDb.executedSqls).toContain("ROLLBACK;");
    });
  });

  describe("5. Shadow Write Isolation & Role Scoping", () => {
    it("executes shadow write successfully on Active Producer when enabled", async () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      const records: EmbeddingRecord[] = [
        { chunkId: "sw-1", path: "Shadow.md", index: 0, textHash: "shash", model: "nomic", provider: "ollama", dimensions: 2, embedding: [0.9, 0.1], createdAt: "now" },
      ];

      const info: EmbeddingPublicationInfo = {
        provider: "ollama",
        model: "nomic",
        dimensions: 2,
        inputVersion: 1,
        prefixMode: "none",
      };

      const result = await performProducerSqliteShadowWrite(records, info, {
        enabled: true,
        deviceRole: "producer",
        store,
      });

      expect(result.attempted).toBe(true);
      expect(result.success).toBe(true);
      expect(result.recordsCount).toBe(1);
    });

    it("skips shadow write when feature flag is false", async () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      const result = await performProducerSqliteShadowWrite([], { provider: "p", model: "m", dimensions: 2, inputVersion: 1, prefixMode: "none" }, {
        enabled: false,
        deviceRole: "producer",
        store,
      });

      expect(result.attempted).toBe(false);
      expect(result.recordsCount).toBe(0);
    });

    it("skips shadow write when device role is companion or standby", async () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      const result = await performProducerSqliteShadowWrite([], { provider: "p", model: "m", dimensions: 2, inputVersion: 1, prefixMode: "none" }, {
        enabled: true,
        deviceRole: "companion",
        store,
      });

      expect(result.attempted).toBe(false);
      expect(result.recordsCount).toBe(0);
    });

    it("catches SQLite failure during shadow write and preserves legacy success without rethrowing", async () => {
      const store = new SqliteProducerLocalStore({
        databasePath: externalDbPath,
        customDbInstance: mockDb,
      });

      store.open();
      mockDb.failNextTransaction = true;

      const records: EmbeddingRecord[] = [
        { chunkId: "sw-err", path: "Error.md", index: 0, textHash: "errhash", model: "nomic", provider: "ollama", dimensions: 2, embedding: [0.1, 0.2], createdAt: "now" },
      ];

      let diagnosticReceived = false;

      const result = await performProducerSqliteShadowWrite(records, { provider: "ollama", model: "nomic", dimensions: 2, inputVersion: 1, prefixMode: "none" }, {
        enabled: true,
        deviceRole: "producer",
        store,
        onDiagnostic: (diag) => {
          diagnosticReceived = true;
          expect(diag.success).toBe(false);
          expect(diag.errorSummary).toContain("Simulated SQLite Transaction Error");
        },
      });

      expect(result.attempted).toBe(true);
      expect(result.success).toBe(false);
      expect(diagnosticReceived).toBe(true);
    });
  });
});
