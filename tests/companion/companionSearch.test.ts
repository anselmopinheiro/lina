import { describe, it, expect } from "vitest";
import {
  executeCompanionTextSearch,
  executeCompanionSemanticSearch,
  executeCompanionSearch,
} from "../../src/companion/companionSearch";
import { evaluateCompanionConsumptionState } from "../../src/companion/companionConsumptionState";
import { IndexedNote } from "../../src/index/indexStore";
import { Chunk } from "../../src/index/chunker";
import { EmbeddingRecord } from "../../src/index/embeddingGenerator";
import { RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";

const MOCK_PRODUCER_ID = "550e8400-e29b-41d4-a716-446655440001";
const MOCK_COMPANION_ID = "550e8400-e29b-41d4-a716-446655440002";

const mockNotes: IndexedNote[] = [
  {
    path: "Projects/Lina.md",
    basename: "Lina",
    extension: "md",
    size: 500,
    mtime: 1700000000,
    contentHash: "hash-lina",
    indexedAt: "2026-08-31T10:00:00.000Z",
  },
  {
    path: "Work/Notes.md",
    basename: "Notes",
    extension: "md",
    size: 300,
    mtime: 1700000000,
    contentHash: "hash-notes",
    indexedAt: "2026-08-31T10:00:00.000Z",
  },
];

const mockChunks: Chunk[] = [
  {
    chunkId: "c1",
    path: "Projects/Lina.md",
    chunkIndex: 0,
    text: "Lina is an intelligent local-first assistant for Obsidian vaults.",
    textHash: "th1",
    createdAt: "2026-08-31T10:00:00.000Z",
  },
  {
    chunkId: "c2",
    path: "Work/Notes.md",
    chunkIndex: 0,
    text: "Meeting notes regarding companion delta search and synchronized knowledge.",
    textHash: "th2",
    createdAt: "2026-08-31T10:00:00.000Z",
  },
];

function createMockEmbeddingRecord(chunkId: string, path: string, vector: number[]): EmbeddingRecord {
  return {
    chunkId,
    path,
    embedding: vector,
    dimensions: vector.length,
    provider: "ollama",
    model: "nomic-embed-text",
    textHash: "th",
  };
}

describe("CompanionSearch (Phase 0.4.1 Read-Only Query Layer)", () => {
  describe("executeCompanionTextSearch", () => {
    it("executes textual search successfully with valid index", () => {
      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 2,
        },
      });

      const result = executeCompanionTextSearch({
        query: "assistant",
        notes: mockNotes,
        chunks: mockChunks,
        consumptionState,
      });

      expect(result.canConsume).toBe(true);
      expect(result.searchModeUsed).toBe("text");
      expect(result.totalResults).toBeGreaterThan(0);
      expect(result.results[0].path).toBe("Projects/Lina.md");
      expect(result.warnings).toHaveLength(0);
    });

    it("handles empty queries gracefully", () => {
      const result = executeCompanionTextSearch({
        query: "   ",
        notes: mockNotes,
        chunks: mockChunks,
      });

      expect(result.canConsume).toBe(true);
      expect(result.searchModeUsed).toBe("text");
      expect(result.totalResults).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it("returns clean empty results when index is unavailable", () => {
      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        textManifestRaw: null, // missing manifest
      });

      const result = executeCompanionTextSearch({
        query: "assistant",
        notes: [],
        chunks: [],
        consumptionState,
      });

      expect(result.canConsume).toBe(false);
      expect(result.searchModeUsed).toBe("none");
      expect(result.totalResults).toBe(0);
      expect(result.warnings).toContain("O índice de texto não está disponível para consumo.");
    });

    it("preserves non-blocking usability under stale provenance", () => {
      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership: {
          schemaVersion: 1,
          activeProducerId: MOCK_PRODUCER_ID,
          epoch: 5,
          acquiredAt: "2026-08-31T10:00:00.000Z",
          updatedAt: "2026-08-31T10:00:00.000Z",
        },
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 2,
          provenance: {
            producerDeviceId: MOCK_PRODUCER_ID,
            producerEpoch: 3, // older epoch
            generatedAt: "2026-08-31T09:00:00.000Z",
          },
        },
      });

      expect(consumptionState.provenanceValidity).toBe("stale");

      // Search must remain fully functional
      const result = executeCompanionTextSearch({
        query: "Lina",
        notes: mockNotes,
        chunks: mockChunks,
        consumptionState,
      });

      expect(result.canConsume).toBe(true);
      expect(result.provenanceValidity).toBe("stale");
      expect(result.searchModeUsed).toBe("text");
      expect(result.totalResults).toBeGreaterThan(0);
    });

    it("preserves usability with unknown / legacy provenance", () => {
      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 2,
          totalChunks: 2,
        },
      });

      expect(consumptionState.provenanceValidity).toBe("unknown");

      const result = executeCompanionTextSearch({
        query: "delta",
        notes: mockNotes,
        chunks: mockChunks,
        consumptionState,
      });

      expect(result.canConsume).toBe(true);
      expect(result.provenanceValidity).toBe("unknown");
      expect(result.searchModeUsed).toBe("text");
      expect(result.totalResults).toBeGreaterThan(0);
    });
  });

  describe("executeCompanionSemanticSearch", () => {
    it("executes semantic search with runtime binary vector index", () => {
      const dim = 4;
      const vectors = new Float32Array([
        1, 0, 0, 0, // c1 vector
        0, 1, 0, 0, // c2 vector
      ]);

      const runtimeIndex: RuntimeEmbeddingIndex = {
        vectors,
        dimensions: dim,
        count: 2,
        provider: "ollama",
        model: "nomic-embed-text",
        sourceIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: dim,
          inputVersion: 1,
          prefixMode: "none",
          publicationId: "pub-1",
          storageFormat: "binary-v1",
        },
        records: [
          { chunkId: "c1", path: "Projects/Lina.md", dimensions: dim },
          { chunkId: "c2", path: "Work/Notes.md", dimensions: dim },
        ],
      };

      const queryVector = [1, 0, 0, 0]; // Exact match for c1

      const result = executeCompanionSemanticSearch({
        query: "assistant",
        queryEmbedding: queryVector,
        runtimeIndex,
        chunks: mockChunks,
      });

      expect(result.canConsume).toBe(true);
      expect(result.searchModeUsed).toBe("semantic");
      expect(result.totalResults).toBeGreaterThan(0);
      expect(result.results[0].chunkId).toBe("c1");
      expect(result.results[0].score).toBeCloseTo(1.0);
    });

    it("executes semantic search with JSONL embedding records fallback", () => {
      const dim = 3;
      const embeddings: EmbeddingRecord[] = [
        createMockEmbeddingRecord("c1", "Projects/Lina.md", [0.9, 0.1, 0.0]),
        createMockEmbeddingRecord("c2", "Work/Notes.md", [0.0, 0.2, 0.9]),
      ];

      const queryVector = [0.9, 0.1, 0.0];

      const result = executeCompanionSemanticSearch({
        query: "companion",
        queryEmbedding: queryVector,
        embeddings,
        chunks: mockChunks,
      });

      expect(result.searchModeUsed).toBe("semantic");
      expect(result.totalResults).toBeGreaterThan(0);
      expect(result.results[0].chunkId).toBe("c1");
    });

    it("warns when query embedding is missing", () => {
      const result = executeCompanionSemanticSearch({
        query: "test",
        queryEmbedding: undefined,
        chunks: mockChunks,
      });

      expect(result.searchModeUsed).toBe("none");
      expect(result.totalResults).toBe(0);
      expect(result.warnings).toContain("Nenhum embedding de query fornecido para pesquisa semântica.");
    });

    it("warns when vector embeddings storage is missing", () => {
      const result = executeCompanionSemanticSearch({
        query: "test",
        queryEmbedding: [1, 2, 3],
        runtimeIndex: null,
        embeddings: null,
        chunks: mockChunks,
      });

      expect(result.searchModeUsed).toBe("none");
      expect(result.totalResults).toBe(0);
      expect(result.warnings).toContain("Nenhum vetor de embeddings disponível para pesquisa semântica.");
    });
  });

  describe("executeCompanionSearch (Unified Entry Point)", () => {
    it("auto-selects text search when no query embedding is provided", () => {
      const result = executeCompanionSearch({
        query: "Obsidian",
        notes: mockNotes,
        chunks: mockChunks,
        mode: "auto",
      });

      expect(result.searchModeUsed).toBe("text");
      expect(result.totalResults).toBeGreaterThan(0);
    });

    it("auto-selects semantic search when query embedding and binary index are present", () => {
      const dim = 2;
      const runtimeIndex: RuntimeEmbeddingIndex = {
        vectors: new Float32Array([1, 0, 0, 1]),
        dimensions: dim,
        count: 2,
        provider: "ollama",
        model: "nomic-embed-text",
        sourceIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: dim,
          inputVersion: 1,
          prefixMode: "none",
          publicationId: "pub-1",
          storageFormat: "binary-v1",
        },
        records: [
          { chunkId: "c1", path: "Projects/Lina.md", dimensions: dim },
          { chunkId: "c2", path: "Work/Notes.md", dimensions: dim },
        ],
      };

      const result = executeCompanionSearch({
        query: "assistant",
        notes: mockNotes,
        chunks: mockChunks,
        mode: "auto",
        queryEmbedding: [1, 0],
        runtimeIndex,
      });

      expect(result.searchModeUsed).toBe("semantic");
      expect(result.totalResults).toBeGreaterThan(0);
    });

    it("falls back to text search in auto mode when embeddings are unavailable", () => {
      const result = executeCompanionSearch({
        query: "knowledge",
        notes: mockNotes,
        chunks: mockChunks,
        mode: "auto",
        queryEmbedding: [1, 0, 0],
        runtimeIndex: null,
        embeddings: [], // empty embeddings
      });

      expect(result.searchModeUsed).toBe("text");
      expect(result.totalResults).toBeGreaterThan(0);
      expect(result.results[0].path).toBe("Work/Notes.md");
    });

    it("respects explicit text mode even if embeddings are present", () => {
      const dim = 2;
      const runtimeIndex: RuntimeEmbeddingIndex = {
        vectors: new Float32Array([1, 0, 0, 1]),
        dimensions: dim,
        count: 2,
        provider: "ollama",
        model: "nomic-embed-text",
        sourceIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: dim,
          inputVersion: 1,
          prefixMode: "none",
          publicationId: "pub-1",
          storageFormat: "binary-v1",
        },
        records: [
          { chunkId: "c1", path: "Projects/Lina.md", dimensions: dim },
          { chunkId: "c2", path: "Work/Notes.md", dimensions: dim },
        ],
      };

      const result = executeCompanionSearch({
        query: "assistant",
        notes: mockNotes,
        chunks: mockChunks,
        mode: "text",
        queryEmbedding: [1, 0],
        runtimeIndex,
      });

      expect(result.searchModeUsed).toBe("text");
    });
  });
});
