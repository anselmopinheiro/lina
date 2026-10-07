import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  evaluateCanonicalWriteEligibility,
  performProducerSqliteCanonicalWrite,
  reprojectLegacyFromSqlite,
  deleteProducerNoteEmbeddings,
} from "../../src/index/sqliteProducerCanonicalWriter";
import {
  SqliteProducerLocalStore,
  type DatabaseSyncLike,
  type DatabaseSyncStatementLike,
} from "../../src/index/sqliteProducerLocalStore";
import type { EmbeddingRecord, EmbeddingPublicationInfo } from "../../src/index/embeddingPersistence";
import { DEFAULT_SETTINGS } from "../../src/settings";

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
    if (sql.includes("DELETE FROM embedding_records;")) {
      this.tables.embedding_records = [];
    } else if (sql.includes("INSERT INTO schema_migrations")) {
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
        } else if (cleanSql.includes("DELETE FROM embedding_records WHERE note_path = ?")) {
          const path = params[0] as string;
          const beforeCount = self.tables.embedding_records.length;
          self.tables.embedding_records = self.tables.embedding_records.filter((r) => r.note_path !== path);
          return { changes: beforeCount - self.tables.embedding_records.length };
        } else if (cleanSql.includes("DELETE FROM embedding_records WHERE chunk_id = ?")) {
          const chunkId = params[0] as string;
          const beforeCount = self.tables.embedding_records.length;
          self.tables.embedding_records = self.tables.embedding_records.filter((r) => r.chunk_id !== chunkId);
          return { changes: beforeCount - self.tables.embedding_records.length };
        }
        return { changes: 1 };
      },

      get(...params: unknown[]) {
        if (cleanSql.includes("SELECT COUNT(*)")) {
          return { cnt: self.tables.embedding_records.length };
        } else if (cleanSql.includes("FROM embedding_spaces")) {
          return self.tables.embedding_spaces[0] ?? undefined;
        } else if (cleanSql.includes("FROM embedding_records WHERE chunk_id = ?")) {
          const chunkId = params[0] as string;
          return self.tables.embedding_records.find((r) => r.chunk_id === chunkId) ?? undefined;
        }
        return undefined;
      },

      all(...params: unknown[]) {
        if (cleanSql.includes("FROM embedding_records")) {
          if (cleanSql.includes("WHERE space_id = ?")) {
            const spaceId = params[0] as string;
            return self.tables.embedding_records.filter((r) => r.space_id === spaceId);
          }
          return self.tables.embedding_records;
        }
        return [];
      },
    };
  }

  close(): void {
    this.isClosed = true;
  }
}

function createMockApp(): any {
  const store = new Map<string, string>();
  const folders = new Set<string>([".lina", ".lina/index", ".lina/producer", ".lina/producer/checkpoints", ".lina/producer/staging", ".lina/producer/backups"]);
  return {
    vault: {
      adapter: {
        getBasePath: () => "/mock/vault",
        path: "/mock/vault",
        exists: async (path: string) => store.has(path) || folders.has(path),
        stat: async (path: string) => {
          if (store.has(path)) {
            const content = store.get(path) ?? "";
            return { type: "file", size: content.length, mtime: Date.now() };
          }
          if (folders.has(path)) return { type: "folder", size: 0, mtime: Date.now() };
          return null;
        },
        read: async (path: string) => {
          if (!store.has(path)) throw new Error(`File not found: ${path}`);
          return store.get(path) ?? "";
        },
        write: async (path: string, content: string) => { store.set(path, content); },
        remove: async (path: string) => { store.delete(path); },
        mkdir: async (path: string) => { folders.add(path); },
        rename: async (oldPath: string, newPath: string) => {
          const content = store.get(oldPath);
          if (content !== undefined) {
            store.set(newPath, content);
            store.delete(oldPath);
          }
        },
      },
    },
  };
}

describe("Sqlite Producer Canonical Writer (Phase M3)", () => {
  let mockDb: TestInMemoryDatabaseSync;
  let store: SqliteProducerLocalStore;
  let mockApp: any;

  const pubInfo: EmbeddingPublicationInfo = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 2,
    inputVersion: 1,
    prefixMode: "none",
  };

  const sampleRecords: EmbeddingRecord[] = [
    { chunkId: "c1", path: "NoteA.md", index: 0, textHash: "h1", embeddingInputHash: "input-1", model: "nomic-embed-text", provider: "ollama", dimensions: 2, embedding: [0.1, 0.2], createdAt: "t1" },
    { chunkId: "c2", path: "NoteB.md", index: 0, textHash: "h2", embeddingInputHash: "input-2", model: "nomic-embed-text", provider: "ollama", dimensions: 2, embedding: [0.3, 0.4], createdAt: "t1" },
  ];

  beforeEach(() => {
    mockDb = new TestInMemoryDatabaseSync();
    store = new SqliteProducerLocalStore({
      databasePath: "/mock/lina-producer.db",
      customDbInstance: mockDb,
    });
    store.open();
    mockApp = createMockApp();
    // Populate manifest in mockApp
    mockApp.vault.adapter.write(".lina/index/manifest.json", JSON.stringify({ indexType: "text_and_embeddings" }));
  });

  describe("Feature Flag & Eligibility Gate", () => {
    it("1. producerSqliteCanonicalEnabled defaults to false", () => {
      expect(DEFAULT_SETTINGS.producerSqliteCanonicalEnabled).toBe(false);
    });

    it("2. flag false preserves legacy mode behavior and rejects canonical cutover", async () => {
      const res = await evaluateCanonicalWriteEligibility(mockApp, store, { enabled: false, deviceRole: "producer" });
      expect(res.eligible).toBe(false);
      expect(res.mode).toBe("LEGACY_MODE");
      expect(res.reason).toBe("canonical-mode-disabled-by-flag");
    });

    it("3. requires Active Producer device role for canonical mode", async () => {
      const companionRes = await evaluateCanonicalWriteEligibility(mockApp, store, { enabled: true, deviceRole: "companion" });
      expect(companionRes.eligible).toBe(false);
      expect(companionRes.mode).toBe("LEGACY_MODE");

      const standbyRes = await evaluateCanonicalWriteEligibility(mockApp, store, { enabled: true, deviceRole: "standby" });
      expect(standbyRes.eligible).toBe(false);
      expect(standbyRes.mode).toBe("LEGACY_MODE");
    });

    it("4. requires pre-cutover equivalence check before canonical mode", async () => {
      const res = await evaluateCanonicalWriteEligibility(mockApp, store, {
        enabled: true,
        deviceRole: "producer",
        preCutoverAuditRequired: true,
      });
      // Legacy is empty, SQLite is empty -> equivalent
      expect(res.eligible).toBe(true);
      expect(res.mode).toBe("SQLITE_CANONICAL_MODE");
    });
  });

  describe("Canonical Write Pipeline & Failure Isolation", () => {
    it("5. writes to SQLite canonical store first before legacy projection", async () => {
      const res = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
        enabled: true,
        deviceRole: "producer",
        store,
        preCutoverAuditRequired: false,
      });

      expect(res.success).toBe(true);
      expect(res.mode).toBe("SQLITE_CANONICAL_MODE");
      expect(res.sqliteWritePassed).toBe(true);
      expect(res.legacyProjectionPassed).toBe(true);
      expect(store.countRecords()).toBe(2);
    });

    it("blocks durable writes when the ownership fence is no longer current", async () => {
      const res = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
        enabled: true,
        deviceRole: "producer",
        store,
        preCutoverAuditRequired: false,
        assertFence: async () => false,
      });

      expect(res).toMatchObject({ success: false, sqliteWritePassed: false, legacyProjectionPassed: false, error: "ownership-fence-rejected" });
      expect(store.countRecords()).toBe(0);
    });

    it("6. SQLite failure blocks publication of new legacy state", async () => {
      // Force SQLite write failure
      store.replaceAllRecords = () => {
        throw new Error("SQLite disk write error simulation");
      };

      const res = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
        enabled: true,
        deviceRole: "producer",
        store,
        preCutoverAuditRequired: false,
      });

      expect(res.success).toBe(false);
      expect(res.sqliteWritePassed).toBe(false);
      expect(res.legacyProjectionPassed).toBe(false);
    });

    it("7. SQLite PASS + legacy projection FAIL keeps SQLite canonical store intact", async () => {
      // Mock app adapter write error for legacy projection files
      const origWrite = mockApp.vault.adapter.write;
      mockApp.vault.adapter.write = async (path: string, content: string) => {
        if (path.includes("embeddings.publish.tmp") || path.includes("manifest")) {
          throw new Error("Disk full simulation for legacy projection");
        }
        return origWrite.call(mockApp.vault.adapter, path, content);
      };

      const res = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
        enabled: true,
        deviceRole: "producer",
        store,
        preCutoverAuditRequired: false,
      });

      // SQLite canonical write committed successfully
      expect(res.sqliteWritePassed).toBe(true);
      expect(res.legacyProjectionPassed).toBe(false);
      expect(res.warning).toContain("Legacy projection");
      expect(store.countRecords()).toBe(2); // SQLite records remain intact!
    });
  });

  describe("Reprojection & Zero AI Provider Calls", () => {
    it("8. reprojects legacy persistence directly from SQLite with 0 AI provider calls", async () => {
      // 1. Seed SQLite store directly
      store.replaceAllRecords(
        { spaceId: "ollama:nomic-embed-text:2", provider: "ollama", model: "nomic-embed-text", dimensions: 2, vectorContractId: "vc-1", inputVersion: 1, prefixMode: "none", createdAt: "t1", updatedAt: "t1" },
        [
          { chunkId: "c1", spaceId: "ollama:nomic-embed-text:2", notePath: "A.md", chunkIndex: 0, textHash: "h1", vectorContractId: "vc-1", embeddingInputHash: "input-1", embeddingBlob: new Float32Array([0.1, 0.2]), createdAt: "t1", updatedAt: "t1" },
          { chunkId: "c2", spaceId: "ollama:nomic-embed-text:2", notePath: "B.md", chunkIndex: 0, textHash: "h2", vectorContractId: "vc-1", embeddingInputHash: "input-2", embeddingBlob: new Float32Array([0.3, 0.4]), createdAt: "t1", updatedAt: "t1" },
        ]
      );

      // 2. Perform reprojection
      const reproj = await reprojectLegacyFromSqlite(mockApp, store, pubInfo);

      expect(reproj.success).toBe(true);
      expect(reproj.recordsCount).toBe(2);
      expect(reproj.providerCallsCount).toBe(0);

      // 3. Verify legacy file was written
      const jsonl = await mockApp.vault.adapter.read(".lina/index/embeddings.jsonl");
      expect(jsonl).toContain("c1");
      expect(jsonl).toContain("c2");
    });

    it("9. retries projection from SQLite after legacy failure without recalculating embeddings", async () => {
      // Seed SQLite
      store.replaceAllRecords(
        { spaceId: "ollama:nomic-embed-text:2", provider: "ollama", model: "nomic-embed-text", dimensions: 2, vectorContractId: "vc-1", inputVersion: 1, prefixMode: "none", createdAt: "t1", updatedAt: "t1" },
        [{ chunkId: "c1", spaceId: "ollama:nomic-embed-text:2", notePath: "A.md", chunkIndex: 0, textHash: "h1", vectorContractId: "vc-1", embeddingInputHash: "input-1", embeddingBlob: new Float32Array([0.1, 0.2]), createdAt: "t1", updatedAt: "t1" }]
      );

      // Re-execute reprojection directly from SQLite
      const retry = await reprojectLegacyFromSqlite(mockApp, store, pubInfo);
      expect(retry.success).toBe(true);
      expect(retry.providerCallsCount).toBe(0);
    });
  });

  describe("Reopen, Update, & Delete Semantics", () => {
    it("10. retains records across store reopen and allows reprojection", async () => {
      store.replaceAllRecords(
        { spaceId: "ollama:nomic-embed-text:2", provider: "ollama", model: "nomic-embed-text", dimensions: 2, vectorContractId: "vc-1", inputVersion: 1, prefixMode: "none", createdAt: "t1", updatedAt: "t1" },
        [{ chunkId: "c1", spaceId: "ollama:nomic-embed-text:2", notePath: "A.md", chunkIndex: 0, textHash: "h1", vectorContractId: "vc-1", embeddingInputHash: "input-1", embeddingBlob: new Float32Array([0.1, 0.2]), createdAt: "t1", updatedAt: "t1" }]
      );

      store.close();
      store.open();

      const reproj = await reprojectLegacyFromSqlite(mockApp, store, pubInfo);
      expect(reproj.success).toBe(true);
      expect(reproj.recordsCount).toBe(1);
    });

    it("11. handles note deletion by removing SQLite records and updating legacy projection", async () => {
      store.replaceAllRecords(
        { spaceId: "ollama:nomic-embed-text:2", provider: "ollama", model: "nomic-embed-text", dimensions: 2, vectorContractId: "vc-1", inputVersion: 1, prefixMode: "none", createdAt: "t1", updatedAt: "t1" },
        [
          { chunkId: "c1", spaceId: "ollama:nomic-embed-text:2", notePath: "A.md", chunkIndex: 0, textHash: "h1", vectorContractId: "vc-1", embeddingInputHash: "input-1", embeddingBlob: new Float32Array([0.1, 0.2]), createdAt: "t1", updatedAt: "t1" },
          { chunkId: "c2", spaceId: "ollama:nomic-embed-text:2", notePath: "B.md", chunkIndex: 0, textHash: "h2", vectorContractId: "vc-1", embeddingInputHash: "input-2", embeddingBlob: new Float32Array([0.3, 0.4]), createdAt: "t1", updatedAt: "t1" },
        ]
      );

      const delRes = await deleteProducerNoteEmbeddings(mockApp, store, "A.md", pubInfo);
      expect(delRes.deletedCount).toBe(1);
      expect(delRes.reprojection.success).toBe(true);
      expect(delRes.reprojection.recordsCount).toBe(1);
      expect(store.countRecords()).toBe(1);
    });

    it("12. updates existing embedding record on note rechunk", async () => {
      await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
        enabled: true,
        deviceRole: "producer",
        store,
        preCutoverAuditRequired: false,
      });

      const updatedRecords: EmbeddingRecord[] = [
        { chunkId: "c1", path: "NoteA.md", index: 0, textHash: "h1-new", embeddingInputHash: "input-new", model: "nomic-embed-text", provider: "ollama", dimensions: 2, embedding: [0.9, 0.9], createdAt: "t2" },
      ];

      await performProducerSqliteCanonicalWrite(mockApp, updatedRecords, pubInfo, {
        enabled: true,
        deviceRole: "producer",
        store,
        preCutoverAuditRequired: false,
      });

      const record = store.getEmbeddingRecord("c1");
      expect(record?.textHash).toBe("h1-new");
      expect(store.countRecords()).toBe(1);
    });
  });
});
