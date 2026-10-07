import { describe, expect, it, beforeEach } from "vitest";
import {
  evaluateCanonicalWriteEligibility,
  performProducerSqliteCanonicalWrite,
  reprojectLegacyFromSqlite,
} from "../../src/index/sqliteProducerCanonicalWriter";
import {
  SqliteProducerLocalStore,
  type DatabaseSyncLike,
  type DatabaseSyncStatementLike,
} from "../../src/index/sqliteProducerLocalStore";
import type { EmbeddingRecord, EmbeddingPublicationInfo } from "../../src/index/embeddingPersistence";
import { auditStoreEquivalence } from "../../src/index/producerStoreEquivalenceAuditor";

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
        }
        return { changes: 1 };
      },

      get(...params: unknown[]) {
        if (cleanSql.includes("SELECT COUNT(*)")) {
          return { cnt: self.tables.embedding_records.length };
        } else if (cleanSql.includes("FROM embedding_spaces")) {
          return self.tables.embedding_spaces[0] ?? undefined;
        } else if (cleanSql.includes("FROM embedding_records") && params.length > 0) {
          const chunkId = params[0] as string;
          return self.tables.embedding_records.find((r) => r.chunk_id === chunkId) ?? undefined;
        }
        return undefined;
      },

      all(...params: unknown[]) {
        if (cleanSql.includes("FROM embedding_records")) {
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

describe("Phase M3B — Runtime Canonical Validation", () => {
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
    { chunkId: "rec-1", path: "DocA.md", index: 0, textHash: "h1", embeddingInputHash: "input-1", model: "nomic-embed-text", provider: "ollama", dimensions: 2, embedding: [0.1, 0.2], createdAt: "t1" },
    { chunkId: "rec-2", path: "DocB.md", index: 0, textHash: "h2", embeddingInputHash: "input-2", model: "nomic-embed-text", provider: "ollama", dimensions: 2, embedding: [0.3, 0.4], createdAt: "t1" },
  ];

  beforeEach(() => {
    mockDb = new TestInMemoryDatabaseSync();
    store = new SqliteProducerLocalStore({
      databasePath: "/mock/lina-producer.db",
      customDbInstance: mockDb,
    });
    store.open();
    mockApp = createMockApp();
    mockApp.vault.adapter.write(".lina/index/manifest.json", JSON.stringify({ indexType: "text_and_embeddings" }));
  });

  it("R1: Equivalence gate blocks cutover when divergences exist", async () => {
    // Seed store with different data to create divergence
    store.replaceAllRecords(
      { spaceId: "ollama:nomic-embed-text:2", provider: "ollama", model: "nomic-embed-text", dimensions: 2, vectorContractId: "vc-1", inputVersion: 1, prefixMode: "none", createdAt: "t1", updatedAt: "t1" },
      [{ chunkId: "legacy-only-sqlite", spaceId: "ollama:nomic-embed-text:2", notePath: "X.md", chunkIndex: 0, textHash: "hx", vectorContractId: "vc-1", embeddingInputHash: "input-x", embeddingBlob: new Float32Array([0.9, 0.9]), createdAt: "t1", updatedAt: "t1" }]
    );

    // Mock app has legacy records
    mockApp.vault.adapter.write(
      ".lina/index/embeddings.jsonl",
      JSON.stringify(sampleRecords[0]) + "\n"
    );

    const eligibility = await evaluateCanonicalWriteEligibility(mockApp, store, {
      enabled: true,
      deviceRole: "producer",
      preCutoverAuditRequired: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.mode).toBe("LEGACY_MODE");
    expect(eligibility.reason).toContain("pre-cutover-equivalence-failed");
  });

  it("R2: Cutover real executes SQLite transaction first, then legacy projection", async () => {
    const writeRes = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
      enabled: true,
      deviceRole: "producer",
      store,
      preCutoverAuditRequired: false,
    });

    expect(writeRes.success).toBe(true);
    expect(writeRes.mode).toBe("SQLITE_CANONICAL_MODE");
    expect(writeRes.sqliteWritePassed).toBe(true);
    expect(writeRes.legacyProjectionPassed).toBe(true);
    expect(store.countRecords()).toBe(2);

    // Post-operation audit
    const audit = auditStoreEquivalence(sampleRecords, store);
    expect(audit.isEquivalent).toBe(true);
    expect(audit.divergenceCount).toBe(0);
  });

  it("R3: SQLite failure before commit blocks legacy state publication", async () => {
    store.replaceAllRecords = () => {
      throw new Error("Disk hardware write error on SQLite DB");
    };

    const writeRes = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
      enabled: true,
      deviceRole: "producer",
      store,
      preCutoverAuditRequired: false,
    });

    expect(writeRes.success).toBe(false);
    expect(writeRes.sqliteWritePassed).toBe(false);
    expect(writeRes.legacyProjectionPassed).toBe(false);
    expect(await mockApp.vault.adapter.exists(".lina/index/embeddings.jsonl")).toBe(false);
  });

  it("R4: SQLite PASS + legacy projection FAIL isolates legacy failure and permits retry without AI", async () => {
    const origWrite = mockApp.vault.adapter.write;
    mockApp.vault.adapter.write = async (path: string, content: string) => {
      if (path.includes("embeddings.publish.tmp")) {
        throw new Error("Vault adapter I/O error during legacy publication");
      }
      return origWrite.call(mockApp.vault.adapter, path, content);
    };

    const writeRes = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
      enabled: true,
      deviceRole: "producer",
      store,
      preCutoverAuditRequired: false,
    });

    expect(writeRes.success).toBe(true);
    expect(writeRes.sqliteWritePassed).toBe(true);
    expect(writeRes.legacyProjectionPassed).toBe(false);
    expect(store.countRecords()).toBe(2); // SQLite intact

    // Restore write adapter and retry projection directly from SQLite
    mockApp.vault.adapter.write = origWrite;
    const retry = await reprojectLegacyFromSqlite(mockApp, store, pubInfo);
    expect(retry.success).toBe(true);
    expect(retry.providerCallsCount).toBe(0); // 0 AI calls
  });

  it("R5: Reprojection reconstructs legacy persistence with zero AI provider calls", async () => {
    store.replaceAllRecords(
      { spaceId: "ollama:nomic-embed-text:2", provider: "ollama", model: "nomic-embed-text", dimensions: 2, vectorContractId: "vc-1", inputVersion: 1, prefixMode: "none", createdAt: "t1", updatedAt: "t1" },
      [
        { chunkId: "rec-1", spaceId: "ollama:nomic-embed-text:2", notePath: "DocA.md", chunkIndex: 0, textHash: "h1", vectorContractId: "vc-1", embeddingInputHash: "input-1", embeddingBlob: new Float32Array([0.1, 0.2]), createdAt: "t1", updatedAt: "t1" },
        { chunkId: "rec-2", spaceId: "ollama:nomic-embed-text:2", notePath: "DocB.md", chunkIndex: 0, textHash: "h2", vectorContractId: "vc-1", embeddingInputHash: "input-2", embeddingBlob: new Float32Array([0.3, 0.4]), createdAt: "t1", updatedAt: "t1" },
      ]
    );

    const reproj = await reprojectLegacyFromSqlite(mockApp, store, pubInfo);
    expect(reproj.success).toBe(true);
    expect(reproj.recordsCount).toBe(2);
    expect(reproj.providerCallsCount).toBe(0);

    const jsonl = await mockApp.vault.adapter.read(".lina/index/embeddings.jsonl");
    expect(jsonl).toContain("rec-1");
    expect(jsonl).toContain("rec-2");
  });

  it("R6: Reopen preserves canonical store state and equivalence", async () => {
    await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
      enabled: true,
      deviceRole: "producer",
      store,
      preCutoverAuditRequired: false,
    });

    store.close();
    store.open();

    const audit = auditStoreEquivalence(sampleRecords, store);
    expect(audit.isEquivalent).toBe(true);
    expect(audit.matchedCount).toBe(2);
  });

  it("R7: Operational rollback of flag reverts to legacy mode without destroying SQLite store", async () => {
    // 1. Enable canonical mode and write
    await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
      enabled: true,
      deviceRole: "producer",
      store,
      preCutoverAuditRequired: false,
    });
    expect(store.countRecords()).toBe(2);

    // 2. Disable flag (Rollback)
    const rolledBack = await evaluateCanonicalWriteEligibility(mockApp, store, {
      enabled: false,
      deviceRole: "producer",
    });

    expect(rolledBack.eligible).toBe(false);
    expect(rolledBack.mode).toBe("LEGACY_MODE");
    expect(store.countRecords()).toBe(2); // SQLite data preserved!
  });
});
