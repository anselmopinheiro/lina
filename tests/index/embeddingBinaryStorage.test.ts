import { describe, expect, it } from "vitest";
import type { EmbeddingRecord } from "../../src/index/embeddingPersistence";
import type { EmbeddingSpaceIdentity } from "../../src/index/embeddingUpdatePlan";
import {
  BINARY_EMBEDDING_FILES,
  BinaryEmbeddingDataAdapter,
  BinaryEmbeddingDigest,
  BinaryEmbeddingPublisher,
  DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS,
  DESKTOP_EMBEDDING_BINARY_RESOURCE_LIMITS,
  MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS,
  estimateEmbeddingBinaryPeakBytes,
  getEmbeddingBinaryResourceLimits,
  InMemoryBinaryEmbeddingWriteExclusion,
  readBinaryEmbeddingStorage,
  recoverBinaryEmbeddingPublication,
  resolveEmbeddingStorage,
} from "../../src/index/embeddingBinaryStorage";

class MemoryBinaryAdapter implements BinaryEmbeddingDataAdapter {
  readonly text = new Map<string, string>();
  readonly binary = new Map<string, ArrayBuffer>();
  readonly calls: string[] = [];
  fail?: (operation: string, path: string) => boolean;
  async exists(path: string): Promise<boolean> { return this.text.has(path) || this.binary.has(path); }
  async stat(path: string): Promise<{ type: string; size: number; mtime: number } | null> {
    const text = this.text.get(path); const binary = this.binary.get(path);
    return text !== undefined ? { type: "file", size: new TextEncoder().encode(text).byteLength, mtime: 1 } : binary ? { type: "file", size: binary.byteLength, mtime: 1 } : null;
  }
  private check(operation: string, path: string): void { this.calls.push(`${operation}:${path}`); if (this.fail?.(operation, path)) throw new Error(`injected ${operation}`); }
  async read(path: string): Promise<string> { this.check("read", path); const value = this.text.get(path); if (value === undefined) throw new Error("missing"); return value; }
  async write(path: string, value: string): Promise<void> { this.check("write", path); this.text.set(path, value); }
  async readBinary(path: string): Promise<ArrayBuffer> { this.check("readBinary", path); const value = this.binary.get(path); if (!value) throw new Error("missing"); return value.slice(0); }
  async writeBinary(path: string, value: ArrayBuffer): Promise<void> { this.check("writeBinary", path); this.binary.set(path, value.slice(0)); }
  async rename(from: string, to: string): Promise<void> { this.check("rename", from); const text = this.text.get(from); const binary = this.binary.get(from); this.text.delete(from); this.binary.delete(from); if (text !== undefined) this.text.set(to, text); else if (binary) this.binary.set(to, binary); else throw new Error("missing"); }
  async remove(path: string): Promise<void> { this.check("remove", path); this.text.delete(path); this.binary.delete(path); }
}

const digest: BinaryEmbeddingDigest = { async digest(value) { let hash = 2166136261; for (const byte of new Uint8Array(value)) hash = Math.imul(hash ^ byte, 16777619); return `sha256:${(hash >>> 0).toString(16).padStart(64, "0")}`; } };
const identity: EmbeddingSpaceIdentity = { provider: "ollama", model: "nomic", dimensions: 2, inputVersion: 2, prefixMode: "none" };
const descriptor = (generationId = "generation-a") => ({ format: "binary-v1" as const, identity, recordCount: 2, dimensions: 2, generationId, sourcePublicationId: `publication-${generationId}` });
const record = (chunkId: string, values: number[]): EmbeddingRecord => ({ chunkId, path: `${chunkId}.md`, index: 0, textHash: `hash-${chunkId}`, embeddingInputHash: `input-${chunkId}`, provider: "ollama", model: "nomic", dimensions: 2, embedding: values, createdAt: "2026-07-24T00:00:00.000Z" });
const records = () => [record("a", [1, 2]), record("b", [3, 4])];
const changedRecords = () => [record("a", [9, 8]), record("b", [7, 6])];

describe("binary embedding storage candidate", () => {
  it("publishes and reads a complete binary set, with the manifest last", async () => {
    const adapter = new MemoryBinaryAdapter();
    await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    const index = await readBinaryEmbeddingStorage(adapter, digest);
    expect(index.records.map((record) => record.chunkId)).toEqual(["a", "b"]);
    expect(Array.from(index.vectors)).toEqual([1, 2, 3, 4]);
    expect(adapter.calls.findIndex((call) => call === `rename:${BINARY_EMBEDDING_FILES.vectorsTemporary}`)).toBeLessThan(adapter.calls.findIndex((call) => call === `rename:${BINARY_EMBEDDING_FILES.manifestTemporary}`));
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifestTemporary)).toBe(false);
  });

  it("keeps JSONL selection as the default and only selects binary with explicit opt-in", async () => {
    const fallback = { count: 1 } as never;
    const defaultResult = await resolveEmbeddingStorage({ allowBinaryCandidate: false, allowJsonlFallback: true, readJsonl: async () => fallback, readBinary: async () => { throw new Error("must not read"); } });
    expect(defaultResult).toMatchObject({ format: "jsonl-v1", reason: "default-jsonl" });
    const binaryResult = await resolveEmbeddingStorage({ preferredFormat: "binary-v1", allowBinaryCandidate: true, allowJsonlFallback: true, readJsonl: async () => fallback, readBinary: async () => ({ count: 2 } as never) });
    expect(binaryResult).toMatchObject({ format: "binary-v1", reason: "binary-opt-in" });
  });

  it("rejects corrupt binary data and uses JSONL only when fallback is allowed", async () => {
    const adapter = new MemoryBinaryAdapter();
    await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    const vectors = await adapter.readBinary(BINARY_EMBEDDING_FILES.vectors); new Uint8Array(vectors)[0] ^= 1; await adapter.writeBinary(BINARY_EMBEDDING_FILES.vectors, vectors);
    await expect(readBinaryEmbeddingStorage(adapter, digest)).rejects.toMatchObject({ code: "binary-digest-mismatch" });
    const result = await resolveEmbeddingStorage({ preferredFormat: "binary-v1", allowBinaryCandidate: true, allowJsonlFallback: true, readJsonl: async () => ({ count: 1 } as never), readBinary: () => readBinaryEmbeddingStorage(adapter, digest) });
    expect(result).toMatchObject({ format: "jsonl-v1", reason: "binary-fallback-jsonl" });
  });

  it("fails safely when the digest is unavailable and reports a missing index when both readers are absent", async () => {
    const adapter = new MemoryBinaryAdapter(); await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    const unavailable: BinaryEmbeddingDigest = { async digest() { throw Object.assign(new Error("unavailable"), { code: "binary-digest-unavailable" }); } };
    await expect(readBinaryEmbeddingStorage(adapter, unavailable)).rejects.toMatchObject({ code: "binary-digest-unavailable" });
    await expect(resolveEmbeddingStorage({ allowBinaryCandidate: false, allowJsonlFallback: true, readJsonl: async () => null, readBinary: async () => ({ count: 1 } as never) })).resolves.toMatchObject({ format: null, reason: "missing" });
  });

  it("enforces injected record, dimension, member and total limits before large reads", async () => {
    const adapter = new MemoryBinaryAdapter(); await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    const originalManifest = await adapter.read(BINARY_EMBEDDING_FILES.manifest);
    const manifest = JSON.parse(originalManifest);
    const base = { ...DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS };
    await expect(readBinaryEmbeddingStorage(adapter, digest, { limits: { ...base, maxRecordCount: 2, maxDimensions: 2, maxVectorBytes: manifest.vectorsByteLength, maxMetadataBytes: manifest.metadataByteLength, maxTotalFileBytes: manifest.vectorsByteLength + manifest.metadataByteLength } })).resolves.toMatchObject({ count: 2, dimensions: 2 });
    for (const [limits, code] of [
      [{ ...base, maxRecordCount: 1 }, "binary-record-limit-exceeded"],
      [{ ...base, maxDimensions: 1 }, "binary-dimension-limit-exceeded"],
      [{ ...base, maxVectorBytes: manifest.vectorsByteLength - 1 }, "binary-resource-limit-exceeded"],
      [{ ...base, maxMetadataBytes: manifest.metadataByteLength - 1 }, "binary-resource-limit-exceeded"],
      [{ ...base, maxTotalFileBytes: manifest.vectorsByteLength + manifest.metadataByteLength - 1 }, "binary-resource-limit-exceeded"],
    ] as const) {
      adapter.calls.length = 0;
      await expect(readBinaryEmbeddingStorage(adapter, digest, { limits })).rejects.toMatchObject({ code });
      expect(adapter.calls.some((call) => call.startsWith("readBinary:"))).toBe(false);
    }
  });

  it("selects distinct desktop/mobile profiles and estimates every peak component deterministically", () => {
    expect(getEmbeddingBinaryResourceLimits("desktop")).toBe(DESKTOP_EMBEDDING_BINARY_RESOURCE_LIMITS);
    expect(getEmbeddingBinaryResourceLimits("mobile")).toBe(MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS);
    expect(MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS.maxEstimatedPeakBytes).toBeLessThan(DESKTOP_EMBEDDING_BINARY_RESOURCE_LIMITS.maxEstimatedPeakBytes);
    const crossProfile = estimateEmbeddingBinaryPeakBytes({ vectorFileBytes: 16 * 1024 * 1024, metadataFileBytes: 1024,
      recordCount: 4096, dimensions: 1024, limits: MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS });
    expect(crossProfile.estimatedPeakBytes).toBeGreaterThan(MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS.maxEstimatedPeakBytes);
    expect(crossProfile.estimatedPeakBytes).toBeLessThan(DESKTOP_EMBEDDING_BINARY_RESOURCE_LIMITS.maxEstimatedPeakBytes);
    const input = { vectorFileBytes: 4_000, metadataFileBytes: 1_000, recordCount: 10, dimensions: 100, limits: { workingMemoryReserveBytes: 500 } };
    const estimate = estimateEmbeddingBinaryPeakBytes(input);
    expect(estimate).toEqual({ vectorInputBytes: 4_000, vectorRuntimeBytes: 4_000, metadataInputBytes: 1_000,
      metadataRuntimeEstimateBytes: 3_840, digestWorkingBytes: 4_000, fixedWorkingReserveBytes: 500, estimatedPeakBytes: 17_340 });
    expect(estimateEmbeddingBinaryPeakBytes(input)).toEqual(estimate);
    expect(() => estimateEmbeddingBinaryPeakBytes({ ...input, dimensions: 0 })).toThrowError(expect.objectContaining({ code: "binary-size-overflow" }));
    expect(() => estimateEmbeddingBinaryPeakBytes({ ...input, recordCount: -1 })).toThrowError(expect.objectContaining({ code: "binary-size-overflow" }));
    expect(() => estimateEmbeddingBinaryPeakBytes({ ...input, recordCount: Number.MAX_SAFE_INTEGER })).toThrowError(expect.objectContaining({ code: "binary-size-overflow" }));
  });

  it("rejects an estimated peak before readBinary and retries with a smaller injected profile", async () => {
    const adapter = new MemoryBinaryAdapter(); await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    const tiny = { ...DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS, maxEstimatedPeakBytes: 1 };
    adapter.calls.length = 0;
    await expect(readBinaryEmbeddingStorage(adapter, digest, { limits: tiny })).rejects.toMatchObject({ code: "binary-estimated-peak-limit-exceeded" });
    expect(adapter.calls.some((call) => call.startsWith("readBinary:"))).toBe(false);
    expect(adapter.calls.filter((call) => call === `read:${BINARY_EMBEDDING_FILES.metadata}`)).toHaveLength(0);
    await expect(readBinaryEmbeddingStorage(adapter, digest, { limits: DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS })).resolves.toMatchObject({ count: 2 });
  });

  it("applies the same resource limits before candidate publication allocation", async () => {
    const adapter = new MemoryBinaryAdapter();
    const publisher = new BinaryEmbeddingPublisher(adapter, digest, { resourceLimits: { ...DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS, maxRecordCount: 1 } });
    await expect(publisher.publish(records(), descriptor())).rejects.toMatchObject({ code: "binary-record-limit-exceeded" });
    expect(adapter.calls.some((call) => call.startsWith("writeBinary:"))).toBe(false);
  });

  it("rejects multiplicative overflow and lying stat sizes before vector allocation", async () => {
    const adapter = new MemoryBinaryAdapter(); await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    const originalManifest = await adapter.read(BINARY_EMBEDDING_FILES.manifest);
    const manifest = JSON.parse(originalManifest);
    manifest.recordCount = Number.MAX_SAFE_INTEGER;
    manifest.dimensions = 4096;
    adapter.text.set(BINARY_EMBEDDING_FILES.manifest, JSON.stringify(manifest));
    adapter.calls.length = 0;
    await expect(readBinaryEmbeddingStorage(adapter, digest, { limits: { ...DEFAULT_EMBEDDING_BINARY_RESOURCE_LIMITS, maxRecordCount: Number.MAX_SAFE_INTEGER } })).rejects.toMatchObject({ code: "binary-size-overflow" });
    expect(adapter.calls.some((call) => call.startsWith("readBinary:"))).toBe(false);

    adapter.text.set(BINARY_EMBEDDING_FILES.manifest, originalManifest);
    const originalStat = adapter.stat.bind(adapter);
    adapter.stat = async (path) => path === BINARY_EMBEDDING_FILES.vectors ? { type: "file", size: 1, mtime: 1 } : originalStat(path);
    adapter.calls.length = 0;
    await expect(readBinaryEmbeddingStorage(adapter, digest)).rejects.toMatchObject({ code: "binary-size-mismatch" });
    expect(adapter.calls.some((call) => call.startsWith("readBinary:"))).toBe(false);
  });

  it("cancels cooperatively during metadata parsing without returning a partial index", async () => {
    const adapter = new MemoryBinaryAdapter(); await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    let cancelled = false;
    await expect(readBinaryEmbeddingStorage(adapter, digest, { scheduler: async () => { cancelled = true; }, isCancelled: () => cancelled })).rejects.toMatchObject({ code: "binary-read-cancelled" });
  });

  it("rolls back every member if publication fails after publishing vectors", async () => {
    const adapter = new MemoryBinaryAdapter(); const publisher = new BinaryEmbeddingPublisher(adapter, digest);
    await publisher.publish(records(), descriptor("old"));
    const oldManifest = await adapter.read(BINARY_EMBEDDING_FILES.manifest);
    adapter.fail = (operation, path) => operation === "rename" && path === BINARY_EMBEDDING_FILES.metadataTemporary;
    await expect(publisher.publish(records(), descriptor("new"))).rejects.toMatchObject({ code: "binary-publication-failed" });
    expect(await adapter.read(BINARY_EMBEDDING_FILES.manifest)).toBe(oldManifest);
    expect((await readBinaryEmbeddingStorage(adapter, digest)).count).toBe(2);
  });

  it("recovers a valid backup, rejects partial sync sets, and only promotes a complete temporary set by opt-in", async () => {
    const adapter = new MemoryBinaryAdapter(); const publisher = new BinaryEmbeddingPublisher(adapter, digest);
    await publisher.publish(records(), descriptor());
    await adapter.rename(BINARY_EMBEDDING_FILES.vectors, BINARY_EMBEDDING_FILES.vectorsBackup);
    await adapter.rename(BINARY_EMBEDDING_FILES.metadata, BINARY_EMBEDDING_FILES.metadataBackup);
    await adapter.rename(BINARY_EMBEDDING_FILES.manifest, BINARY_EMBEDDING_FILES.manifestBackup);
    expect(await recoverBinaryEmbeddingPublication(adapter, digest)).toBe("backup");
    await adapter.remove(BINARY_EMBEDDING_FILES.metadata);
    expect(await recoverBinaryEmbeddingPublication(adapter, digest)).toBe("none");
    expect(await adapter.exists(BINARY_EMBEDDING_FILES.manifest)).toBe(true);
  });

  it("does not promote a complete temporary generation without explicit opt-in", async () => {
    const moveToTemporary = async (adapter: MemoryBinaryAdapter) => {
      await adapter.rename(BINARY_EMBEDDING_FILES.vectors, BINARY_EMBEDDING_FILES.vectorsTemporary);
      await adapter.rename(BINARY_EMBEDDING_FILES.metadata, BINARY_EMBEDDING_FILES.metadataTemporary);
      await adapter.rename(BINARY_EMBEDDING_FILES.manifest, BINARY_EMBEDDING_FILES.manifestTemporary);
    };
    const withoutOptIn = new MemoryBinaryAdapter();
    await new BinaryEmbeddingPublisher(withoutOptIn, digest).publish(records(), descriptor());
    await moveToTemporary(withoutOptIn);
    expect(await recoverBinaryEmbeddingPublication(withoutOptIn, digest, false)).toBe("none");
    const withOptIn = new MemoryBinaryAdapter();
    await new BinaryEmbeddingPublisher(withOptIn, digest).publish(records(), descriptor());
    await moveToTemporary(withOptIn);
    expect(await recoverBinaryEmbeddingPublication(withOptIn, digest, true)).toBe("temporary");
    expect((await readBinaryEmbeddingStorage(withOptIn, digest)).count).toBe(2);
  });

  it("does not use Node-only APIs or modify JSONL/checkpoint paths", async () => {
    const adapter = new MemoryBinaryAdapter();
    await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor());
    expect(adapter.calls.some((call) => call.includes("embeddings.jsonl") || call.includes("checkpoint"))).toBe(false);
  });

  it("uses an injected write exclusion so binary and simulated JSONL writers cannot overlap", async () => {
    const adapter = new MemoryBinaryAdapter(); const exclusion = new InMemoryBinaryEmbeddingWriteExclusion();
    const jsonlLease = await exclusion.acquire("binary-candidate");
    expect(jsonlLease).not.toBeNull();
    const publisher = new BinaryEmbeddingPublisher(adapter, digest, { writeExclusion: exclusion });
    await expect(publisher.publish(records(), descriptor())).rejects.toMatchObject({ code: "binary-publication-failed" });
    jsonlLease?.release();
    await publisher.publish(records(), descriptor());
    expect((await readBinaryEmbeddingStorage(adapter, digest)).count).toBe(2);
  });

  it("serializes two binary publishers through the same injected write exclusion", async () => {
    const adapter = new MemoryBinaryAdapter(); const exclusion = new InMemoryBinaryEmbeddingWriteExclusion();
    let releaseFirstStage!: () => void;
    const firstStage = new Promise<void>((resolve) => { releaseFirstStage = resolve; });
    let markFirstStage!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStage = resolve; });
    const first = new BinaryEmbeddingPublisher(adapter, digest, { writeExclusion: exclusion, onStage: async (stage) => { if (stage === "temporary-vectors") { markFirstStage(); await firstStage; } } });
    const second = new BinaryEmbeddingPublisher(adapter, digest, { writeExclusion: exclusion });
    const firstPromise = first.publish(records(), descriptor());
    await firstStarted;
    await expect(second.publish(records(), descriptor("second"))).rejects.toMatchObject({ code: "binary-publication-failed" });
    releaseFirstStage(); await firstPromise;
  });

  it("keeps exact candidate publication order and restores the old set for every injected failure stage", async () => {
    const stages = ["temporary-vectors", "temporary-metadata", "temporary-manifest", "backups-created", "canonical-vectors", "canonical-metadata", "canonical-manifest", "before-final-validation"] as const;
    for (const faultStage of stages) {
      const adapter = new MemoryBinaryAdapter(); const initial = new BinaryEmbeddingPublisher(adapter, digest);
      await initial.publish(records(), descriptor("old"));
      await adapter.write(".lina/index/embeddings.jsonl", "jsonl-sentinel"); await adapter.write(".lina/index/embeddings.checkpoint.jsonl", "checkpoint-sentinel");
      const publisher = new BinaryEmbeddingPublisher(adapter, digest, {
        onStage: async (stage) => {
          if (stage === "before-final-validation" && faultStage === stage) {
            const vectors = await adapter.readBinary(BINARY_EMBEDDING_FILES.vectors); new Uint8Array(vectors)[0] ^= 1; await adapter.writeBinary(BINARY_EMBEDDING_FILES.vectors, vectors); return;
          }
          if (stage === faultStage) throw new Error(`fault-${stage}`);
        },
      });
      await expect(publisher.publish(changedRecords(), descriptor("new"))).rejects.toMatchObject({ code: faultStage === "before-final-validation" ? "binary-digest-mismatch" : "binary-publication-failed" });
      expect(Array.from((await readBinaryEmbeddingStorage(adapter, digest)).vectors)).toEqual([1, 2, 3, 4]);
      expect(await adapter.read(".lina/index/embeddings.jsonl")).toBe("jsonl-sentinel");
      expect(await adapter.read(".lina/index/embeddings.checkpoint.jsonl")).toBe("checkpoint-sentinel");
    }

    const adapter = new MemoryBinaryAdapter(); await new BinaryEmbeddingPublisher(adapter, digest).publish(records(), descriptor("old"));
    adapter.calls.length = 0; await new BinaryEmbeddingPublisher(adapter, digest).publish(changedRecords(), descriptor("new"));
    const calls = adapter.calls;
    const position = (call: string) => calls.indexOf(call);
    expect(position(`writeBinary:${BINARY_EMBEDDING_FILES.vectorsTemporary}`)).toBeLessThan(position(`write:${BINARY_EMBEDDING_FILES.metadataTemporary}`));
    expect(position(`write:${BINARY_EMBEDDING_FILES.metadataTemporary}`)).toBeLessThan(position(`write:${BINARY_EMBEDDING_FILES.manifestTemporary}`));
    expect(position(`rename:${BINARY_EMBEDDING_FILES.vectorsTemporary}`)).toBeLessThan(position(`rename:${BINARY_EMBEDDING_FILES.metadataTemporary}`));
    expect(position(`rename:${BINARY_EMBEDDING_FILES.metadataTemporary}`)).toBeLessThan(position(`rename:${BINARY_EMBEDDING_FILES.manifestTemporary}`));
    expect(calls.slice(position(`rename:${BINARY_EMBEDDING_FILES.manifestTemporary}`) + 1).some((call) => call === `read:${BINARY_EMBEDDING_FILES.manifest}`)).toBe(true);
  });
});
