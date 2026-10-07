import { describe, expect, it, beforeEach } from "vitest";
import {
  auditStoreEquivalence,
  compareVectorsFloat32,
} from "../../src/index/producerStoreEquivalenceAuditor";
import {
  bootstrapSqliteFromLegacyStore,
} from "../../src/index/sqliteProducerBootstrap";
import {
  SqliteProducerLocalStore,
  type DatabaseSyncLike,
  type DatabaseSyncStatementLike,
} from "../../src/index/sqliteProducerLocalStore";
import type { EmbeddingRecord, EmbeddingPublicationInfo } from "../../src/index/embeddingPersistence";

class TestInMemoryDatabaseSync implements DatabaseSyncLike {
  public executedSqls: string[] = [];
  public tables: Record<string, any[]> = {
    schema_migrations: [],
    embedding_spaces: [],
    embedding_records: [],
  };
  public isClosed = false;

  exec(sql: string): void {
    this.executedSqls.push(sql);
    if (sql.includes("INSERT INTO schema_migrations")) {
      const match = sql.match(/VALUES\s*\(\s*(\d+)/i);
      const version = match ? parseInt(match[1], 10) : 1;
      this.tables.schema_migrations.push({ version, applied_at: new Date().toISOString(), description: "Migration" });
    }
  }

  prepare(sql: string): DatabaseSyncStatementLike {
    const self = this;
    const cleanSql = sql.trim();

    return {
      run(...params: unknown[]) {
        if (cleanSql.includes("INSERT INTO embedding_spaces")) {
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
          return self.tables.embedding_records.find((r) => r.chunk_id === chunkId);
        } else if (cleanSql.includes("SELECT COUNT(*)")) {
          if (cleanSql.includes("WHERE space_id =")) {
            const spaceId = params[0] as string;
            return { cnt: self.tables.embedding_records.filter((r) => r.space_id === spaceId).length };
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

describe("Producer Store Equivalence Auditor & Bootstrap (Phase M2)", () => {
  let mockDb: TestInMemoryDatabaseSync;
  let store: SqliteProducerLocalStore;

  const pubInfo: EmbeddingPublicationInfo = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 3,
    inputVersion: 1,
    prefixMode: "none",
  };

  beforeEach(() => {
    mockDb = new TestInMemoryDatabaseSync();
    store = new SqliteProducerLocalStore({
      databasePath: "/mock/lina-producer.db",
      customDbInstance: mockDb,
    });
    store.open();
  });

  describe("Equivalence Auditor", () => {
    it("1. reports empty stores as equivalent", () => {
      const report = auditStoreEquivalence([], store);
      expect(report.legacyCount).toBe(0);
      expect(report.sqliteCount).toBe(0);
      expect(report.matchedCount).toBe(0);
      expect(report.divergenceCount).toBe(0);
      expect(report.isEquivalent).toBe(true);
    });

    it("2. reports identical records as matched and equivalent", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "nomic-embed-text", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];

      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      const report = auditStoreEquivalence(legacyRecords, store);
      expect(report.legacyCount).toBe(1);
      expect(report.sqliteCount).toBe(1);
      expect(report.matchedCount).toBe(1);
      expect(report.divergenceCount).toBe(0);
      expect(report.isEquivalent).toBe(true);
    });

    it("3. classifies LEGACY_ONLY when record is missing in SQLite", () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "missing-in-sqlite", path: "A.md", index: 0, textHash: "h1", model: "m", provider: "p", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];

      const report = auditStoreEquivalence(legacyRecords, store);
      expect(report.isEquivalent).toBe(false);
      expect(report.divergences).toHaveLength(1);
      expect(report.divergences[0].type).toBe("LEGACY_ONLY");
    });

    it("4. classifies METADATA_MISMATCH when path or index differs", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];
      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      const modifiedLegacy: EmbeddingRecord[] = [
        { chunkId: "c1", path: "B.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];

      const report = auditStoreEquivalence(modifiedLegacy, store);
      expect(report.isEquivalent).toBe(false);
      expect(report.divergences[0].type).toBe("METADATA_MISMATCH");
    });

    it("5. classifies HASH_MISMATCH when textHash differs", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "hash-original", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];
      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      const modifiedLegacy: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "hash-changed", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];

      const report = auditStoreEquivalence(modifiedLegacy, store);
      expect(report.isEquivalent).toBe(false);
      expect(report.divergences[0].type).toBe("HASH_MISMATCH");
    });

    it("6. classifies DIMENSION_MISMATCH when dimensions differ", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];
      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      const modifiedLegacy: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 2, embedding: [0.1, 0.2], createdAt: "t1" },
      ];

      const report = auditStoreEquivalence(modifiedLegacy, store);
      expect(report.isEquivalent).toBe(false);
      expect(report.divergences[0].type).toBe("DIMENSION_MISMATCH");
    });

    it("7. classifies VECTOR_MISMATCH when embedding values differ", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];
      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      const modifiedLegacy: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.9, 0.9, 0.9], createdAt: "t1" },
      ];

      const report = auditStoreEquivalence(modifiedLegacy, store);
      expect(report.isEquivalent).toBe(false);
      expect(report.divergences[0].type).toBe("VECTOR_MISMATCH");
    });

    it("8. classifies DUPLICATE_IDENTITY when legacy records contain duplicate chunkIds", () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "dup-1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
        { chunkId: "dup-1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
      ];

      const report = auditStoreEquivalence(legacyRecords, store);
      expect(report.isEquivalent).toBe(false);
      expect(report.divergences[0].type).toBe("DUPLICATE_IDENTITY");
    });

    it("9. compares float vectors float-by-float accurately using fround tolerance", () => {
      const v1 = new Float32Array([0.1, 0.2, 0.3]);
      const v2 = [0.1, 0.2, 0.3];
      expect(compareVectorsFloat32(v1, v2)).toBe(true);

      const v3 = [0.1, 0.2, 0.3001];
      expect(compareVectorsFloat32(v1, v3)).toBe(false);
    });
  });

  describe("Controlled Bootstrap", () => {
    it("10. bootstraps empty SQLite store from legacy records without calling AI providers", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "boot-1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 2, embedding: [0.5, 0.5], createdAt: "t1" },
        { chunkId: "boot-2", path: "B.md", index: 0, textHash: "h2", model: "nomic", provider: "ollama", dimensions: 2, embedding: [0.6, 0.6], createdAt: "t1" },
      ];

      const res = await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, {
        enabled: true,
        deviceRole: "producer",
        store,
        batchSize: 1,
      });

      expect(res.attempted).toBe(true);
      expect(res.success).toBe(true);
      expect(res.processedRecords).toBe(2);
      expect(res.batchesExecuted).toBe(2);
      expect(store.countRecords()).toBe(2);
    });

    it("11. executes bootstrap idempotently without corrupting data", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "boot-1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 2, embedding: [0.5, 0.5], createdAt: "t1" },
      ];

      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });
      expect(store.countRecords()).toBe(1);

      // Re-run bootstrap
      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });
      expect(store.countRecords()).toBe(1);
    });

    it("12. skips bootstrap when feature flag is disabled", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "b1", path: "A.md", index: 0, textHash: "h1", model: "m", provider: "p", dimensions: 2, embedding: [0.1, 0.2], createdAt: "t" },
      ];

      const res = await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, {
        enabled: false,
        deviceRole: "producer",
        store,
      });

      expect(res.attempted).toBe(false);
      expect(res.processedRecords).toBe(0);
      expect(store.countRecords()).toBe(0);
    });

    it("13. skips bootstrap on companion or standby device role", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "b1", path: "A.md", index: 0, textHash: "h1", model: "m", provider: "p", dimensions: 2, embedding: [0.1, 0.2], createdAt: "t" },
      ];

      const res = await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, {
        enabled: true,
        deviceRole: "companion",
        store,
      });

      expect(res.attempted).toBe(false);
      expect(res.processedRecords).toBe(0);
    });

    it("14. does not modify or mutate original legacy records during audit or bootstrap", async () => {
      const legacyRecords: EmbeddingRecord[] = Object.freeze([
        Object.freeze({ chunkId: "frozen-1", path: "A.md", index: 0, textHash: "h1", model: "m", provider: "p", dimensions: 2, embedding: Object.freeze([0.1, 0.2]) as unknown as number[], createdAt: "t" }),
      ]) as readonly EmbeddingRecord[];

      auditStoreEquivalence(legacyRecords, store);
      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      expect(legacyRecords[0].chunkId).toBe("frozen-1");
    });

    it("15. verifies post-bootstrap audit converges to full equivalence", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "c1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.1, 0.2, 0.3], createdAt: "t1" },
        { chunkId: "c2", path: "B.md", index: 0, textHash: "h2", model: "nomic", provider: "ollama", dimensions: 3, embedding: [0.4, 0.5, 0.6], createdAt: "t1" },
      ];

      const before = auditStoreEquivalence(legacyRecords, store);
      expect(before.isEquivalent).toBe(false);
      expect(before.divergenceCount).toBe(2);

      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      const after = auditStoreEquivalence(legacyRecords, store);
      expect(after.isEquivalent).toBe(true);
      expect(after.matchedCount).toBe(2);
      expect(after.divergenceCount).toBe(0);
    });

    it("16. retains records upon store reopen post-bootstrap", async () => {
      const legacyRecords: EmbeddingRecord[] = [
        { chunkId: "reopen-1", path: "A.md", index: 0, textHash: "h1", model: "nomic", provider: "ollama", dimensions: 2, embedding: [0.1, 0.9], createdAt: "t1" },
      ];

      await bootstrapSqliteFromLegacyStore(legacyRecords, pubInfo, { enabled: true, deviceRole: "producer", store });

      store.close();
      store.open();

      const afterReopen = auditStoreEquivalence(legacyRecords, store);
      expect(afterReopen.isEquivalent).toBe(true);
    });
  });
});
