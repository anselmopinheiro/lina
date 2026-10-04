/**
 * SQLite Producer Local Store (Phase M1)
 *
 * Implements the concrete ProducerLocalStore backed by private SQLite storage using `node:sqlite`.
 *
 * Invariants:
 * 1. Vault Separation: The SQLite database file resides strictly outside the Obsidian Vault.
 * 2. Producer-Private: Used exclusively for shadow writes by the Active Producer.
 * 3. Shadow / Non-Authoritative: Failure in SQLite never invalidates or breaks legacy operations.
 * 4. Zero External Dependencies: Uses `node:sqlite` (DatabaseSync) without npm SQLite packages.
 * 5. PRAGMA Integrity: Enforces `journal_mode = WAL`, `synchronous = FULL`, `foreign_keys = ON`.
 */

import {
  PRODUCER_STORE_SCHEMA_VERSION,
  type EmbeddingSpaceRecord,
  type ProducerEmbeddingRecord,
  type ProducerLocalStore,
} from "./producerLocalStoreTypes";

export interface DatabaseSyncStatementLike {
  run(...params: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): DatabaseSyncStatementLike;
  close(): void;
}

export type DatabaseSyncConstructor = new (databasePath: string) => DatabaseSyncLike;

/**
 * Diagnostic status object returned when auditing SQLite store availability.
 */
export interface SqliteStoreDiagnostic {
  readonly isAvailable: boolean;
  readonly databasePath: string;
  readonly isOpen: boolean;
  readonly schemaVersion: number;
  readonly recordCount: number;
  readonly errorSummary: string | null;
}

export interface SqliteProducerLocalStoreOptions {
  readonly databasePath: string;
  readonly dbConstructor?: DatabaseSyncConstructor;
  readonly customDbInstance?: DatabaseSyncLike;
}

function getFsAndPathHelpers(): {
  existsSync: (targetPath: string) => boolean;
  mkdirSync: (targetPath: string, options?: { recursive?: boolean }) => void;
  dirname: (targetPath: string) => string;
} {
  try {
    // eslint-disable-next-line no-undef -- Safely probe for Node require in desktop environment
    const req = typeof require === "function" ? require : null;
    if (req) {
      const fsMod = req("fs") as { existsSync?: (p: string) => boolean; mkdirSync?: (p: string, opts?: { recursive?: boolean }) => void };
      const pathMod = req("path") as { dirname?: (p: string) => string };
      return {
        existsSync: (p: string) => (fsMod.existsSync ? fsMod.existsSync(p) : false),
        mkdirSync: (p: string, opts?: { recursive?: boolean }) => { if (fsMod.mkdirSync) fsMod.mkdirSync(p, opts); },
        dirname: (p: string) => (pathMod.dirname ? pathMod.dirname(p) : p.split("/").slice(0, -1).join("/")),
      };
    }
  } catch {
    // Fallback if not in desktop Node environment
  }
  return {
    existsSync: () => false,
    mkdirSync: () => {},
    dirname: (p: string) => p.split("/").slice(0, -1).join("/") || ".",
  };
}

function resolveNodeSqliteConstructor(): DatabaseSyncConstructor | null {
  try {
    // eslint-disable-next-line no-undef -- Safely probe for Node require in desktop environment
    const req = typeof require === "function" ? require : null;
    if (!req) return null;
    let mod: unknown = null;
    try {
      mod = req("node:sqlite");
    } catch {
      try {
        mod = req("sqlite");
      } catch {
        return null;
      }
    }
    if (mod && typeof mod === "object") {
      const dbSync = (mod as Record<string, unknown>).DatabaseSync;
      if (typeof dbSync === "function") {
        return dbSync as DatabaseSyncConstructor;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export class SqliteProducerLocalStore implements ProducerLocalStore {
  private readonly databasePath: string;
  private readonly dbConstructor?: DatabaseSyncConstructor;
  private db: DatabaseSyncLike | null = null;
  private currentSchemaVersion = 0;

  constructor(options: SqliteProducerLocalStoreOptions) {
    this.databasePath = options.databasePath;
    this.dbConstructor = options.dbConstructor;
    if (options.customDbInstance) {
      this.db = options.customDbInstance;
    }
  }

  public get isOpen(): boolean {
    return this.db !== null;
  }

  public getStorePath(): string {
    return this.databasePath;
  }

  public getSchemaVersion(): number {
    return this.currentSchemaVersion;
  }

  public open(): void {
    if (this.db) {
      this.applyPragmasAndMigrations();
      return;
    }

    const ctor = this.dbConstructor ?? resolveNodeSqliteConstructor();
    if (!ctor) {
      throw new Error(`node:sqlite DatabaseSync module is unavailable in this runtime environment (${this.databasePath}).`);
    }

    const helpers = getFsAndPathHelpers();
    const dir = helpers.dirname(this.databasePath);
    if (!helpers.existsSync(dir)) {
      helpers.mkdirSync(dir, { recursive: true });
    }

    this.db = new ctor(this.databasePath);
    this.applyPragmasAndMigrations();
  }

  public close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Idempotent close
      } finally {
        this.db = null;
        this.currentSchemaVersion = 0;
      }
    }
  }

  private applyPragmasAndMigrations(): void {
    if (!this.db) return;

    // Enforce WAL, FULL sync, and Foreign Keys as required by M1 architecture
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = FULL;");
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.runMigrations();
  }

  private runMigrations(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      );
    `);

    const versionRow = this.db.prepare("SELECT MAX(version) as maxVersion FROM schema_migrations;").get() as { maxVersion?: number | null } | undefined;
    const activeVersion = typeof versionRow?.maxVersion === "number" ? versionRow.maxVersion : 0;

    if (activeVersion < 1) {
      this.db.exec("BEGIN TRANSACTION;");
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS embedding_spaces (
            space_id TEXT PRIMARY KEY,
            vector_contract_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            dimension INTEGER NOT NULL,
            dtype TEXT NOT NULL,
            input_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS embedding_records (
            chunk_id TEXT PRIMARY KEY,
            space_id TEXT NOT NULL,
            note_path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            text_hash TEXT NOT NULL,
            vector_contract_id TEXT NOT NULL,
            embedding_blob BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (space_id) REFERENCES embedding_spaces (space_id) ON DELETE CASCADE
          );

          INSERT INTO schema_migrations (version, applied_at, description)
          VALUES (1, '${new Date().toISOString()}', 'Phase M1 initial schema for embedding spaces and records');
        `);
        this.db.exec("COMMIT;");
        this.currentSchemaVersion = PRODUCER_STORE_SCHEMA_VERSION;
      } catch (err) {
        this.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      this.currentSchemaVersion = activeVersion;
    }
  }

  public upsertEmbeddingSpace(space: EmbeddingSpaceRecord): void {
    if (!this.db) {
      throw new Error("Cannot upsert embedding space: SQLite store is not open.");
    }
    const stmt = this.db.prepare(`
      INSERT INTO embedding_spaces (
        space_id, vector_contract_id, provider, model, dimension, dtype, input_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        vector_contract_id = excluded.vector_contract_id,
        provider = excluded.provider,
        model = excluded.model,
        dimension = excluded.dimension,
        dtype = excluded.dtype,
        input_version = excluded.input_version,
        updated_at = excluded.updated_at;
    `);

    stmt.run(
      space.spaceId,
      space.vectorContractId,
      space.provider,
      space.model,
      space.dimensions,
      "float32",
      space.inputVersion,
      space.createdAt,
      space.updatedAt
    );
  }

  public upsertEmbeddingRecord(record: ProducerEmbeddingRecord): void {
    if (!this.db) {
      throw new Error("Cannot upsert embedding record: SQLite store is not open.");
    }

    const blob = record.embeddingBlob instanceof Float32Array
      ? new Uint8Array(record.embeddingBlob.buffer, record.embeddingBlob.byteOffset, record.embeddingBlob.byteLength)
      : new Uint8Array(record.embeddingBlob);

    const stmt = this.db.prepare(`
      INSERT INTO embedding_records (
        chunk_id, space_id, note_path, chunk_index, text_hash, vector_contract_id, embedding_blob, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        space_id = excluded.space_id,
        note_path = excluded.note_path,
        chunk_index = excluded.chunk_index,
        text_hash = excluded.text_hash,
        vector_contract_id = excluded.vector_contract_id,
        embedding_blob = excluded.embedding_blob,
        updated_at = excluded.updated_at;
    `);

    stmt.run(
      record.chunkId,
      record.spaceId,
      record.notePath,
      record.chunkIndex,
      record.textHash,
      record.inputHash,
      blob,
      record.createdAt,
      record.updatedAt
    );
  }

  public upsertEmbeddingBatch(space: EmbeddingSpaceRecord, records: readonly ProducerEmbeddingRecord[]): void {
    if (!this.db) {
      throw new Error("Cannot upsert embedding batch: SQLite store is not open.");
    }
    this.db.exec("BEGIN TRANSACTION;");
    try {
      this.upsertEmbeddingSpace(space);
      for (const record of records) {
        this.upsertEmbeddingRecord(record);
      }
      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  public getEmbeddingRecord(chunkId: string): ProducerEmbeddingRecord | null {
    if (!this.db) return null;
    const row = this.db.prepare(`
      SELECT chunk_id, space_id, note_path, chunk_index, text_hash, vector_contract_id, embedding_blob, created_at, updated_at
      FROM embedding_records WHERE chunk_id = ?;
    `).get(chunkId) as {
      chunk_id: string;
      space_id: string;
      note_path: string;
      chunk_index: number;
      text_hash: string;
      vector_contract_id: string;
      embedding_blob: Uint8Array | ArrayBuffer;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    let blobBuffer: ArrayBuffer;
    if (row.embedding_blob instanceof ArrayBuffer) {
      blobBuffer = row.embedding_blob;
    } else if (ArrayBuffer.isView(row.embedding_blob)) {
      blobBuffer = row.embedding_blob.buffer.slice(row.embedding_blob.byteOffset, row.embedding_blob.byteOffset + row.embedding_blob.byteLength);
    } else {
      const u8 = new Uint8Array(row.embedding_blob);
      blobBuffer = u8.buffer;
    }

    const float32 = new Float32Array(blobBuffer);

    return {
      chunkId: row.chunk_id,
      spaceId: row.space_id,
      notePath: row.note_path,
      chunkIndex: row.chunk_index,
      textHash: row.text_hash,
      inputHash: row.vector_contract_id,
      embeddingBlob: float32,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public countRecords(spaceId?: string): number {
    if (!this.db) return 0;
    if (spaceId) {
      const row = this.db.prepare("SELECT COUNT(*) as cnt FROM embedding_records WHERE space_id = ?;").get(spaceId) as { cnt?: number } | undefined;
      return row?.cnt ?? 0;
    } else {
      const row = this.db.prepare("SELECT COUNT(*) as cnt FROM embedding_records;").get() as { cnt?: number } | undefined;
      return row?.cnt ?? 0;
    }
  }

  public diagnose(): SqliteStoreDiagnostic {
    let count = 0;
    let errSummary: string | null = null;
    if (this.db) {
      try {
        count = this.countRecords();
      } catch (err) {
        errSummary = err instanceof Error ? err.message : String(err);
      }
    } else {
      errSummary = "Database connection is not open.";
    }

    return {
      isAvailable: this.db !== null,
      databasePath: this.databasePath,
      isOpen: this.isOpen,
      schemaVersion: this.currentSchemaVersion,
      recordCount: count,
      errorSummary: errSummary,
    };
  }
}
