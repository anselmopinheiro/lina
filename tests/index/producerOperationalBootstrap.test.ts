import { describe, expect, it } from "vitest";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
  EMBEDDING_PERSISTENCE_FILES,
  EmbeddingCheckpointMetadata,
  EmbeddingRecord,
  ensureProducerWorkDirectories,
  writeEmbeddingCheckpoint,
} from "../../src/index/embeddingPersistence";
import { saveTextIndex } from "../../src/index/indexStore";
import { Chunk } from "../../src/index/chunker";
import { hashContent } from "../../src/index/noteHasher";

const files = EMBEDDING_PERSISTENCE_FILES;

function makeRecord(chunkId: string, path: string): EmbeddingRecord {
  return {
    chunkId,
    path,
    index: 0,
    textHash: hashContent("sample text"),
    model: "mistral-embed",
    provider: "mistral",
    dimensions: 3,
    embedding: [0.1, 0.2, 0.3],
    createdAt: "2026-09-28T00:00:00.000Z",
  };
}

function makeMetadata(): EmbeddingCheckpointMetadata {
  return {
    schemaVersion: EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
    operationId: "op-bootstrap-test",
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
    provider: "mistral",
    model: "mistral-embed",
    dimension: 3,
    inputFormatVersion: "1:none",
    completedRecords: 0,
  };
}

describe("LINA-03-FIX-PRODUCER-BOOTSTRAP-001 — Producer Operational Bootstrap", () => {
  it("Caso 1: creates checkpoints folder automatically when staging already exists", async () => {
    const adapter = new FakeAdapter();
    // Simulate state where staging exists (e.g. created by earlier indexing) but checkpoints is absent
    await adapter.mkdir(".lina/producer");
    await adapter.mkdir(".lina/producer/staging");
    await adapter.mkdir(".lina/producer/backups");

    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(false);
    expect(adapter.hasFolder(".lina/producer/staging")).toBe(true);

    const app = { vault: { adapter } };
    const record = makeRecord("doc1.md::0", "doc1.md");

    // writeEmbeddingCheckpoint must not throw ENOENT and must create checkpoints directory
    const savedMeta = await writeEmbeddingCheckpoint(app as never, makeMetadata(), [record]);

    expect(savedMeta.completedRecords).toBe(1);
    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(true);
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
    expect(adapter.hasFile(files.checkpointMetadata)).toBe(true);
  });

  it("Caso 2: creates full Producer operational structure on a fresh vault without .lina", async () => {
    // Blank vault with emptyFolders option (neither .lina nor any subfolder exists)
    const adapter = new FakeAdapter(undefined, { emptyFolders: true });

    expect(adapter.hasFolder(".lina")).toBe(false);
    expect(adapter.hasFolder(".lina/producer")).toBe(false);
    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(false);

    const app = { vault: { adapter } };
    await ensureProducerWorkDirectories(app as never);

    expect(adapter.hasFolder(".lina")).toBe(true);
    expect(adapter.hasFolder(".lina/producer")).toBe(true);
    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(true);
    expect(adapter.hasFolder(".lina/producer/staging")).toBe(true);
    expect(adapter.hasFolder(".lina/producer/backups")).toBe(true);

    // Can write checkpoint immediately
    const record = makeRecord("note.md::0", "note.md");
    const meta = await writeEmbeddingCheckpoint(app as never, makeMetadata(), [record]);
    expect(meta.completedRecords).toBe(1);
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
  });

  it("Caso 3: recreates operational directory before writing if removed externally", async () => {
    const adapter = new FakeAdapter();
    const app = { vault: { adapter } };
    await ensureProducerWorkDirectories(app as never);

    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(true);

    // Externally remove checkpoints folder
    await adapter.remove(".lina/producer/checkpoints");
    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(false);
    expect(adapter.hasFolder(".lina/producer/staging")).toBe(true);

    // Subsequent checkpoint write automatically recreates it
    const record = makeRecord("note.md::0", "note.md");
    const meta = await writeEmbeddingCheckpoint(app as never, makeMetadata(), [record]);
    expect(meta.completedRecords).toBe(1);
    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(true);
    expect(adapter.hasFile(files.checkpoint)).toBe(true);
  });

  it("Caso 4: FakeAdapter rename fails with ENOENT when destination parent directory does not exist", async () => {
    const adapter = new FakeAdapter();
    adapter.setFile("source.txt", "hello");

    // Destination parent directory 'missing-dir' does not exist
    await expect(adapter.rename("source.txt", "missing-dir/target.txt")).rejects.toThrow(
      /ENOENT: no such file or directory, rename/
    );

    // After creating destination directory, rename succeeds
    await adapter.mkdir("missing-dir");
    await adapter.rename("source.txt", "missing-dir/target.txt");
    expect(adapter.hasFile("missing-dir/target.txt")).toBe(true);
    expect(adapter.hasFile("source.txt")).toBe(false);
  });

  it("indexStore: saveTextIndex creates .lina/producer/checkpoints preventively", async () => {
    const adapter = new FakeAdapter(undefined, { emptyFolders: true });
    const app = { vault: { adapter } };

    const chunks: Chunk[] = [{
      chunkId: "c1",
      path: "Doc.md",
      chunkIndex: 0,
      text: "Content",
      textHash: hashContent("Content"),
      createdAt: "2026-09-28T00:00:00.000Z",
    }];

    await saveTextIndex(app as never, [], chunks);

    expect(adapter.hasFolder(".lina/index")).toBe(true);
    expect(adapter.hasFolder(".lina/producer/checkpoints")).toBe(true);
    expect(adapter.hasFolder(".lina/producer/staging")).toBe(true);
    expect(adapter.hasFolder(".lina/producer/backups")).toBe(true);
  });
});
