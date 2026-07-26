import { describe, expect, it } from "vitest";
import { BinaryEmbeddingCopyController } from "../../src/index/embeddingBinaryCopyController";
import { BINARY_EMBEDDING_FILES, BinaryEmbeddingDataAdapter, BinaryEmbeddingDigest } from "../../src/index/embeddingBinaryStorage";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";

class Adapter implements BinaryEmbeddingDataAdapter {
  text = new Map<string, string>(); binary = new Map<string, ArrayBuffer>(); reads: string[] = [];
  beforeRead?: (path: string) => void; beforeRename?: (from: string, to: string) => void;
  async exists(path: string): Promise<boolean> { return this.text.has(path) || this.binary.has(path); }
  async stat(path: string): Promise<{ type: string; size: number; mtime: number } | null> { const value = this.text.get(path); const binary = this.binary.get(path); return value === undefined && !binary ? null : { type: "file", size: value === undefined ? binary!.byteLength : value.length, mtime: 1 }; }
  async read(path: string): Promise<string> { this.reads.push(path); this.beforeRead?.(path); const value = this.text.get(path); if (value === undefined) throw new Error("missing"); return value; }
  async write(path: string, value: string): Promise<void> { this.text.set(path, value); }
  async readBinary(path: string): Promise<ArrayBuffer> { const value = this.binary.get(path); if (!value) throw new Error("missing"); return value.slice(0); }
  async writeBinary(path: string, value: ArrayBuffer): Promise<void> { this.binary.set(path, value.slice(0)); }
  async rename(from: string, to: string): Promise<void> { this.beforeRename?.(from, to); const text = this.text.get(from); const binary = this.binary.get(from); this.text.delete(from); this.binary.delete(from); if (text !== undefined) this.text.set(to, text); else if (binary) this.binary.set(to, binary); else throw new Error("missing"); }
  async remove(path: string): Promise<void> { this.text.delete(path); this.binary.delete(path); }
}

const digest: BinaryEmbeddingDigest = { async digest(value) { let total = 0; for (const byte of new Uint8Array(value)) total += byte; return `sha256:${total.toString(16).padStart(64, "0")}`; } };
const record = { chunkId: "a", path: "a.md", index: 0, textHash: "hash", embeddingInputHash: "input", provider: "ollama", model: "nomic", dimensions: 2, embedding: [1, 2], createdAt: "2026-07-24T00:00:00.000Z" };
function seed(adapter: Adapter, publicationId = "publication-a"): void {
  adapter.text.set(".lina/index/embeddings.jsonl", `${JSON.stringify(record)}\n`);
  adapter.text.set(".lina/index/manifest.json", JSON.stringify({ embeddingsEnabled: true, embeddings: { provider: "ollama", model: "nomic", dimensions: 2, totalEmbeddings: 1, publicationId }, embeddingInput: { version: 2, prefixMode: "none" } }));
}

describe("binary copy maintenance", () => {
  it("builds a valid copy from the current JSONL publication and preserves canonical files", async () => {
    const adapter = new Adapter(); seed(adapter); const coordinator = new IndexWriteCoordinator();
    const controller = new BinaryEmbeddingCopyController(adapter, digest, coordinator);
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "valid", sourcePublicationId: "publication-a" });
    expect(await adapter.read(".lina/index/embeddings.jsonl")).toContain("chunkId");
    expect(await adapter.read(".lina/index/manifest.json")).toContain("publication-a");
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(true);
    expect(coordinator.getState().activeOperation).toBeNull();
  });

  it("does not inspect or create binary artefacts when maintenance is disabled by the caller", async () => {
    const adapter = new Adapter(); seed(adapter);
    const controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    await expect(controller.check(false)).resolves.toEqual({ status: "disabled" });
    expect(adapter.reads).toEqual([]);
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
  });

  it("rejects a legacy canonical manifest before taking a lease or reading JSONL", async () => {
    const adapter = new Adapter(); seed(adapter);
    const manifest = JSON.parse(adapter.text.get(".lina/index/manifest.json")!);
    delete manifest.embeddings.publicationId;
    adapter.text.set(".lina/index/manifest.json", JSON.stringify(manifest));
    adapter.text.set(".lina/index/embeddings.checkpoint.jsonl", "checkpoint");
    const coordinator = new IndexWriteCoordinator();
    const controller = new BinaryEmbeddingCopyController(adapter, digest, coordinator);

    await expect(controller.createOrUpdate()).resolves.toMatchObject({ status: "unsupported", reasonCode: "legacy-manifest" });
    expect(adapter.reads).toEqual([".lina/index/manifest.json"]);
    expect(await adapter.read(".lina/index/embeddings.checkpoint.jsonl")).toBe("checkpoint");
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
    expect(coordinator.getState().activeOperation).toBeNull();
    expect(controller.getState()).toMatchObject({ phase: "completed", summary: { status: "unsupported", reasonCode: "legacy-manifest" } });
  });

  it("serializes automatic, manual, and removal writes through the canonical coordinator", async () => {
    const adapter = new Adapter(); seed(adapter); const coordinator = new IndexWriteCoordinator();
    const controller = new BinaryEmbeddingCopyController(adapter, digest, coordinator);
    const lease = coordinator.startEmbeddingGeneration();
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "error" });
    if (lease.status === "accepted") coordinator.finish(lease.token);
    await controller.createOrUpdate();
    const removal = controller.remove();
    await removal;
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
  });

  it("deduplicates callbacks for one publication and supersedes queued older work", async () => {
    const adapter = new Adapter(); seed(adapter, "publication-a"); const controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    const first = controller.maintainAfterCanonicalPublication("publication-a");
    const duplicate = controller.maintainAfterCanonicalPublication("publication-a");
    expect(duplicate).toBe(first);
    seed(adapter, "publication-b");
    const newer = controller.maintainAfterCanonicalPublication("publication-b");
    await expect(first).resolves.toMatchObject({ status: "outdated" });
    await expect(newer).resolves.toMatchObject({ status: "valid", sourcePublicationId: "publication-b" });
    expect(controller.getState()).toMatchObject({ phase: "completed", expectedPublicationId: "publication-b" });
  });

  it("marks maintenance superseded when the canonical manifest changes during JSONL reading", async () => {
    const adapter = new Adapter(); seed(adapter, "publication-a"); let changed = false;
    adapter.beforeRead = (path) => { if (!changed && path === ".lina/index/embeddings.jsonl") { changed = true; seed(adapter, "publication-b"); } };
    const controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "outdated" });
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
    expect(controller.getState().phase).toBe("superseded");
  });

  it("rolls back binary temporaries when the manifest changes before binary commit", async () => {
    const adapter = new Adapter(); seed(adapter, "publication-a"); let changed = false;
    adapter.beforeRename = (from) => { if (!changed && from === BINARY_EMBEDDING_FILES.metadataTemporary) { changed = true; seed(adapter, "publication-b"); } };
    const controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "outdated" });
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.vectorsTemporary)).toBe(false);
    expect(await adapter.read(".lina/index/manifest.json")).toContain("publication-b");
    expect(controller.getState().phase).toBe("superseded");
  });

  it("does not read JSONL or publish when the captured publication is already superseded", async () => {
    const adapter = new Adapter(); seed(adapter, "publication-b"); const controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "outdated" });
    expect(adapter.reads).not.toContain(".lina/index/embeddings.jsonl");
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
  });

  it("keeps JSONL and checkpoint intact when derived digesting fails", async () => {
    const adapter = new Adapter(); seed(adapter); adapter.text.set(".lina/index/embeddings.checkpoint.jsonl", "checkpoint");
    const unavailable: BinaryEmbeddingDigest = { async digest() { throw new Error("digest unavailable"); } };
    const controller = new BinaryEmbeddingCopyController(adapter, unavailable, new IndexWriteCoordinator());
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "error" });
    expect(await adapter.read(".lina/index/embeddings.jsonl")).toContain("chunkId");
    expect(await adapter.read(".lina/index/embeddings.checkpoint.jsonl")).toBe("checkpoint");
    expect(controller.getState().phase).toBe("failed");
  });

  it("ignores a queued callback after dispose without creating binary files", async () => {
    const adapter = new Adapter(); seed(adapter); const controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    const maintenance = controller.maintainAfterCanonicalPublication("publication-a");
    controller.dispose();
    await expect(maintenance).resolves.toMatchObject({ status: "error" });
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
    expect(controller.getState().phase).toBe("disposed");
  });

  it("stops after unload during JSONL reading without publishing a binary set", async () => {
    const adapter = new Adapter(); seed(adapter); let controller!: BinaryEmbeddingCopyController;
    adapter.beforeRead = (path) => { if (path === ".lina/index/embeddings.jsonl") controller.dispose(); };
    controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "error" });
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
    expect(controller.getState().phase).toBe("disposed");
  });

  it("rolls back binary work when unload occurs before the binary commit marker", async () => {
    const adapter = new Adapter(); seed(adapter); let controller!: BinaryEmbeddingCopyController;
    adapter.beforeRename = (from) => { if (from === BINARY_EMBEDDING_FILES.metadataTemporary) controller.dispose(); };
    controller = new BinaryEmbeddingCopyController(adapter, digest, new IndexWriteCoordinator());
    await expect(controller.maintainAfterCanonicalPublication("publication-a")).resolves.toMatchObject({ status: "error" });
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(false);
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.vectorsTemporary)).toBe(false);
    expect(await adapter.read(".lina/index/embeddings.jsonl")).toContain("chunkId");
  });
});
