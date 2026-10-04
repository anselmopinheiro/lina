/**
 * Producer Local Store Types and Contracts (Phase M0)
 *
 * Defines the preliminary types, contracts, and interfaces for the future private SQLite
 * storage used exclusively by the Active Producer outside the Obsidian Vault.
 *
 * Invariants:
 * 1. Preparatory Only: These contracts do not activate SQLite in production runtime.
 * 2. Producer-Private: The local store is exclusively owned and accessed by the local Active Producer.
 * 3. Zero Consumer Dependency: Consumer and Companion devices never depend on or load this store.
 */

import type { VectorContractV1 } from "./vectorContract";

export const PRODUCER_STORE_SCHEMA_VERSION = 1;
export const PRODUCER_STORE_DEFAULT_DB_NAME = "lina-producer.db";

/**
 * Metadata record for a distinct embedding vector space in the local store.
 */
export interface EmbeddingSpaceRecord {
  readonly spaceId: string;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly vectorContractId: string;
  readonly inputVersion: number;
  readonly prefixMode: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly vectorContract?: VectorContractV1;
}

/**
 * Record representing a single embedded chunk stored natively in the local database.
 */
export interface ProducerEmbeddingRecord {
  readonly chunkId: string;
  readonly spaceId: string;
  readonly notePath: string;
  readonly chunkIndex: number;
  readonly textHash: string;
  readonly inputHash: string;
  readonly embeddingBlob: Float32Array | ArrayBuffer;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Candidate type for local operation checkpoints (batch generation progress).
 * Kept provisional as classified in architectural audit 001/002.
 */
export interface ProducerOperationCheckpoint {
  readonly operationId: string;
  readonly spaceId: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly totalChunks: number;
  readonly completedChunks: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly errorSummary?: string;
}

/**
 * Migration step contract for evolving the local SQLite store schema over time.
 */
export interface ProducerStoreMigration {
  readonly version: number;
  readonly appliedAt: string;
  readonly description: string;
}

/**
 * Configuration options for initializing the ProducerLocalStore.
 */
export interface ProducerLocalStoreConfig {
  readonly databasePath: string;
  readonly readOnly?: boolean;
}

/**
 * Result of evaluating path separation against the Obsidian Vault.
 */
export interface VaultPathSeparationResult {
  readonly insideVault: boolean;
  readonly canonicalVaultPath: string;
  readonly canonicalTargetPath: string;
  readonly relativePath: string;
}

/**
 * Structured resolution containing directory and database file paths outside the vault.
 */
export interface ProducerLocalStorePathResolution {
  readonly storeDirectory: string;
  readonly databasePath: string;
  readonly isCustomPath: boolean;
  readonly separation: VaultPathSeparationResult;
}

/**
 * Abstract path resolver contract for determining the private local storage location.
 */
export interface ProducerLocalStorePathResolver {
  resolveStorePath(customPath?: string): ProducerLocalStorePathResolution;
  isPathInsideVault(targetPath: string): VaultPathSeparationResult;
}

/**
 * Minimal lifecycle contract for the Producer local store.
 * Functional SQLite methods are deferred to subsequent phases (M1+).
 */
export interface ProducerLocalStore {
  readonly isOpen: boolean;
  getStorePath(): string;
  getSchemaVersion(): number;
  open(): Promise<void> | void;
  close(): Promise<void> | void;
}
