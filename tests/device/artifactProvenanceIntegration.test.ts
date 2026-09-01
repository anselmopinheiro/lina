import { describe, expect, it } from "vitest";
import {
  createArtifactProvenance,
  extractArtifactProvenance,
  isValidArtifactProvenance,
} from "../../src/device/artifactProvenance";
import {
  IndexedNote,
  readTextIndexStatus,
  saveTextIndex,
} from "../../src/index/indexStore";
import {
  EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
  EmbeddingCheckpointMetadata,
  EmbeddingRecord,
  publishCanonicalEmbeddings,
  writeEmbeddingCheckpoint,
} from "../../src/index/embeddingPersistence";
import {
  BinaryEmbeddingDataAdapter,
  BinaryEmbeddingDigest,
  BinaryEmbeddingPublisher,
  readBinaryEmbeddingStorage,
} from "../../src/index/embeddingBinaryStorage";
import { OwnershipGate } from "../../src/device/ownershipGate";
import { OwnershipDataAdapter } from "../../src/device/deviceOwnership";

class MemoryAdapter implements OwnershipDataAdapter, BinaryEmbeddingDataAdapter {
  private readonly files = new Map<string, string>();
  private readonly binaryFiles = new Map<string, ArrayBuffer>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.binaryFiles.has(path);
  }

  async stat(path: string): Promise<{ type: string; size: number; mtime: number } | null> {
    if (this.files.has(path)) {
      return {
        type: "file",
        size: this.files.get(path)!.length,
        mtime: Date.now(),
      };
    }
    if (this.binaryFiles.has(path)) {
      return {
        type: "file",
        size: this.binaryFiles.get(path)!.byteLength,
        mtime: Date.now(),
      };
    }
    return null;
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`File not found: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.binaryFiles.get(path);
    if (value === undefined) throw new Error(`Binary file not found: ${path}`);
    return value;
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.binaryFiles.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.binaryFiles.delete(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.files.has(oldPath)) {
      this.files.set(newPath, this.files.get(oldPath)!);
      this.files.delete(oldPath);
    }
    if (this.binaryFiles.has(oldPath)) {
      this.binaryFiles.set(newPath, this.binaryFiles.get(oldPath)!);
      this.binaryFiles.delete(oldPath);
    }
  }

  async mkdir(_path: string): Promise<void> {
    // In-memory directory creation
  }
}

function makeMockApp(adapter: MemoryAdapter) {
  return {
    vault: {
      adapter,
      configDir: ".obsidian",
    },
  } as any;
}

class MockDigest implements BinaryEmbeddingDigest {
  async digest(value: ArrayBuffer): Promise<string> {
    return `sha256:mock-${value.byteLength}`;
  }
}

describe("artifact provenance integration", () => {
  const producerA = "d35767c1-4c36-4cb7-a31b-c90cb307d565";
  const producerB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const validTimestamp = "2026-09-01T12:00:00.000Z";

  describe("Text Index publication provenance", () => {
    it("persists provenance into .lina/index/manifest.json when provided", async () => {
      const adapter = new MemoryAdapter();
      const app = makeMockApp(adapter);
      const provenance = createArtifactProvenance(producerA, 2, validTimestamp);

      const notes: IndexedNote[] = [
        {
          path: "note1.md",
          basename: "note1",
          extension: "md",
          size: 100,
          mtime: 1234567,
          contentHash: "hash1",
          indexedAt: validTimestamp,
        },
      ];

      const success = await saveTextIndex(
        app,
        notes,
        [],
        { enabled: true, chunkSize: 1200, overlap: 150 },
        0,
        undefined,
        provenance
      );
      expect(success).toBe(true);

      const status = await readTextIndexStatus(app);
      expect(status.isUsable).toBe(true);
      expect(status.manifest?.provenance).toEqual(provenance);
      expect(status.provenance).toEqual(provenance);
    });

    it("backward compatibility: loads legacy manifest without provenance seamlessly", async () => {
      const adapter = new MemoryAdapter();
      const app = makeMockApp(adapter);

      // Save without provenance (simulating legacy index)
      const notes: IndexedNote[] = [
        {
          path: "note1.md",
          basename: "note1",
          extension: "md",
          size: 100,
          mtime: 1234567,
          contentHash: "hash1",
          indexedAt: validTimestamp,
        },
      ];

      await saveTextIndex(
        app,
        notes,
        [],
        { enabled: true, chunkSize: 1200, overlap: 150 }
      );

      const status = await readTextIndexStatus(app);
      expect(status.isUsable).toBe(true);
      expect(status.manifest?.provenance).toBeUndefined();
      expect(status.provenance).toBeUndefined();
      expect(status.origin).toBe("unknown");
    });
  });

  describe("Canonical Embedding publication provenance", () => {
    it("persists provenance in manifest.embeddings.provenance", async () => {
      const adapter = new MemoryAdapter();
      const app = makeMockApp(adapter);
      const provenance = createArtifactProvenance(producerA, 3, validTimestamp);

      // Create base text index manifest first
      await adapter.write(
        ".lina/index/manifest.json",
        JSON.stringify({
          version: 1,
          indexType: "text",
          updatedAt: validTimestamp,
          totalNotes: 1,
        })
      );

      const record: EmbeddingRecord = {
        chunkId: "c1",
        path: "note1.md",
        index: 0,
        textHash: "thash1",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        createdAt: validTimestamp,
      };

      const result = await publishCanonicalEmbeddings(app, [record], {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 3,
        inputVersion: 1,
        prefixMode: "none",
        provenance,
      });

      expect(result.success).toBe(true);

      const manifestContent = await adapter.read(".lina/index/manifest.json");
      const manifest = JSON.parse(manifestContent);
      expect(manifest.embeddingsEnabled).toBe(true);
      expect(manifest.embeddings.provenance).toEqual(provenance);
    });

    it("backward compatibility: loads legacy embedding publication without provenance", async () => {
      const adapter = new MemoryAdapter();
      const app = makeMockApp(adapter);

      // Create base text index manifest first
      await adapter.write(
        ".lina/index/manifest.json",
        JSON.stringify({
          version: 1,
          indexType: "text",
          updatedAt: validTimestamp,
          totalNotes: 1,
        })
      );

      const record: EmbeddingRecord = {
        chunkId: "c1",
        path: "note1.md",
        index: 0,
        textHash: "thash1",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        createdAt: validTimestamp,
      };

      const result = await publishCanonicalEmbeddings(app, [record], {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 3,
        inputVersion: 1,
        prefixMode: "none",
      });

      expect(result.success).toBe(true);

      const manifestContent = await adapter.read(".lina/index/manifest.json");
      const manifest = JSON.parse(manifestContent);
      expect(manifest.embeddings.provenance).toBeUndefined();
    });
  });

  describe("Embedding Checkpoint provenance", () => {
    it("persists and restores provenance in checkpoint metadata", async () => {
      const adapter = new MemoryAdapter();
      const app = makeMockApp(adapter);
      const provenance = createArtifactProvenance(producerA, 1, validTimestamp);

      const metadata: EmbeddingCheckpointMetadata = {
        schemaVersion: EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
        operationId: "op-1",
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
        provider: "ollama",
        model: "nomic-embed-text",
        dimension: 3,
        inputFormatVersion: "1",
        completedRecords: 0,
        provenance,
      };

      const record: EmbeddingRecord = {
        chunkId: "c1",
        path: "note1.md",
        index: 0,
        textHash: "thash1",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        createdAt: validTimestamp,
      };

      const savedMeta = await writeEmbeddingCheckpoint(app, metadata, [record]);
      expect(savedMeta.provenance).toEqual(provenance);

      const metaRaw = await adapter.read(".lina/index/embeddings.checkpoint.meta.json");
      const parsed = JSON.parse(metaRaw);
      expect(parsed.provenance).toEqual(provenance);
    });
  });

  describe("Binary Embedding Storage provenance", () => {
    it("persists provenance into binary manifest and allows reading", async () => {
      const adapter = new MemoryAdapter();
      const digest = new MockDigest();
      const publisher = new BinaryEmbeddingPublisher(adapter, digest);
      const provenance = createArtifactProvenance(producerA, 4, validTimestamp);

      const record: EmbeddingRecord = {
        chunkId: "c1",
        path: "note1.md",
        index: 0,
        textHash: "thash1",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        createdAt: validTimestamp,
      };

      await publisher.publish([record], {
        format: "binary-v1",
        identity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 3,
          inputVersion: 1,
          prefixMode: "none",
        },
        recordCount: 1,
        dimensions: 3,
        generationId: "gen-1",
        sourcePublicationId: "pub-1",
        provenance,
      });

      const manifestRaw = await adapter.read(".lina/index/embeddings.binary.manifest.json");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.provenance).toEqual(provenance);

      const loaded = await readBinaryEmbeddingStorage(adapter, digest);
      expect(loaded).toBeDefined();
      expect(loaded.count).toBe(1);
    });

    it("backward compatibility: loads binary storage without provenance", async () => {
      const adapter = new MemoryAdapter();
      const digest = new MockDigest();
      const publisher = new BinaryEmbeddingPublisher(adapter, digest);

      const record: EmbeddingRecord = {
        chunkId: "c1",
        path: "note1.md",
        index: 0,
        textHash: "thash1",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        createdAt: validTimestamp,
      };

      await publisher.publish([record], {
        format: "binary-v1",
        identity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 3,
          inputVersion: 1,
          prefixMode: "none",
        },
        recordCount: 1,
        dimensions: 3,
        generationId: "gen-1",
        sourcePublicationId: "pub-1",
      });

      const manifestRaw = await adapter.read(".lina/index/embeddings.binary.manifest.json");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.provenance).toBeUndefined();

      const loaded = await readBinaryEmbeddingStorage(adapter, digest);
      expect(loaded).toBeDefined();
      expect(loaded.count).toBe(1);
    });
  });

  describe("OwnershipGate provenance helpers", () => {
    it("generates valid provenance matching the active producer and epoch", async () => {
      const adapter = new MemoryAdapter();
      const gate = new OwnershipGate(
        adapter,
        () => producerA,
        () => "producer",
        true
      );

      // Evaluate and auto-claim initial ownership
      const decision = await gate.evaluate();
      expect(decision.authorized).toBe(true);
      expect(decision.activeProducerId).toBe(producerA);
      expect(decision.epoch).toBe(1);

      const prov = gate.getProvenance(validTimestamp);
      expect(prov).toEqual({
        producerDeviceId: producerA,
        producerEpoch: 1,
        generatedAt: validTimestamp,
      });

      const asyncProv = await gate.evaluateProvenance(validTimestamp);
      expect(asyncProv).toEqual(prov);
    });

    it("returns undefined for standby producers or non-producer roles", async () => {
      const adapter = new MemoryAdapter();
      // First, set active owner to producerA
      const gateA = new OwnershipGate(
        adapter,
        () => producerA,
        () => "producer",
        true
      );
      await gateA.evaluate();

      // Now, test producerB (standby producer)
      const gateB = new OwnershipGate(
        adapter,
        () => producerB,
        () => "producer",
        false
      );
      await gateB.evaluate();

      expect(gateB.getProvenance()).toBeUndefined();
      expect(await gateB.evaluateProvenance()).toBeUndefined();

      // Companion role
      const gateCompanion = new OwnershipGate(
        adapter,
        () => producerA,
        () => "companion",
        false
      );
      await gateCompanion.evaluate();
      expect(gateCompanion.getProvenance()).toBeUndefined();
    });
  });
});
