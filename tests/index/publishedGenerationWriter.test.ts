import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validatePublishedGenerationFiles } from "../../src/index/publishedGenerationValidator";
import { compareLegacyAndPublished } from "../../src/index/publishedGenerationEquivalence";
import { buildImmutableGeneration } from "../../src/index/publishedGenerationBuilder";
import { computeVectorContractId } from "../../src/index/vectorContract";
import { publishImmutableGeneration, recoverPublishedGenerationPointer, type PublishedGenerationFileAdapter, type PublishedGenerationFailurePoint } from "../../src/index/publishedGenerationWriter";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "../../src/index/producerLocalStoreTypes";

const contractId = computeVectorContractId({ provider: "p", model: "m", dimensions: 2, prefixMode: "none", inputVersion: 1 });
const space: EmbeddingSpaceRecord = { spaceId: "s", provider: "p", model: "m", dimensions: 2, vectorContractId: contractId, inputVersion: 1, prefixMode: "none", createdAt: "t", updatedAt: "t", sourceProvenance: { sourceTextGenerationId: "text-1", sourceChunksDigest: "sha256:chunks", sourcePublicationId: "pub-1", sourceRecordCount: 1 }, publicationProducerProvenance: { producerDeviceId: "dev-123e4567-e89b-42d3-a456-426614174000", producerEpoch: 1 } };
const record = (id: string, value: number): ProducerEmbeddingRecord => ({ chunkId: id, spaceId: "s", notePath: `${id}.md`, chunkIndex: 0, textHash: id, vectorContractId: contractId, embeddingInputHash: `input-${id}`, embeddingBlob: new Float32Array([value, value + 1]), createdAt: "t", updatedAt: "t" });
class MemoryAdapter implements PublishedGenerationFileAdapter {
  readonly text = new Map<string, string>(); readonly binary = new Map<string, ArrayBuffer>(); readonly dirs = new Set<string>();
  async exists(path: string): Promise<boolean> { return this.text.has(path) || this.binary.has(path) || this.dirs.has(path); }
  async read(path: string): Promise<string> { const value = this.text.get(path); if (value === undefined) throw new Error(`missing ${path}`); return value; }
  async readBinary(path: string): Promise<ArrayBuffer> { const value = this.binary.get(path); if (!value) throw new Error(`missing ${path}`); return value; }
  async write(path: string, value: string): Promise<void> { this.text.set(path, value); }
  async writeBinary(path: string, value: ArrayBuffer): Promise<void> { this.binary.set(path, value); }
  async mkdir(path: string): Promise<void> { this.dirs.add(path); }
  async rename(from: string, to: string): Promise<void> { for (const [key, value] of [...this.text]) if (key === from || key.startsWith(`${from}/`)) { this.text.delete(key); this.text.set(`${to}${key.slice(from.length)}`, value); } for (const [key, value] of [...this.binary]) if (key.startsWith(`${from}/`)) { this.binary.delete(key); this.binary.set(`${to}${key.slice(from.length)}`, value); } this.dirs.delete(from); this.dirs.add(to); }
  async remove(path: string): Promise<void> { for (const key of [...this.text.keys()]) if (key === path || key.startsWith(`${path}/`)) this.text.delete(key); for (const key of [...this.binary.keys()]) if (key.startsWith(`${path}/`)) this.binary.delete(key); this.dirs.delete(path); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> { return { files: [], folders: [...this.dirs].filter((dir) => dir.startsWith(`${path}/`)).map((dir) => dir.slice(path.length + 1)).filter((name) => !name.includes("/")) }; }
}
describe("M4 writer failure isolation", () => {
  it("fails closed when a stale fence is observed before promotion and preserves CURRENT", async () => {
    const adapter = new MemoryAdapter(); const current = buildImmutableGeneration(space, [record("a", 1)], 1, "t"); await publishImmutableGeneration(adapter, current);
    const stale = buildImmutableGeneration(space, [record("b", 2)], 2, "u");
    await expect(publishImmutableGeneration(adapter, stale, { assertFence: async () => false })).resolves.toMatchObject({ success: false, error: "OWNERSHIP_FENCE_REJECTED" });
    expect(await adapter.read(".lina/published/CURRENT")).toBe("generation-000001");
  });
  it.each(["F1", "F2", "F3", "F4", "F5", "F6", "F7"] as PublishedGenerationFailurePoint[]) ("%s preserves CURRENT and retry succeeds", async (point) => { const adapter = new MemoryAdapter(); const first = buildImmutableGeneration(space, [record("a", 1)], 1, "t"); await expect(publishImmutableGeneration(adapter, first)).resolves.toMatchObject({ success: true }); const second = buildImmutableGeneration(space, [record("b", 2)], 2, "u"); await expect(publishImmutableGeneration(adapter, second, { testFailurePoint: point })).resolves.toMatchObject({ success: false }); expect(await adapter.read(".lina/published/CURRENT")).toBe("generation-000001"); expect((await publishImmutableGeneration(adapter, second)).success).toBe(true); expect(await adapter.read(".lina/published/CURRENT")).toBe("generation-000002"); });
  it("keeps a promoted generation immutable and blocks downgrade", async () => { const adapter = new MemoryAdapter(); const one = buildImmutableGeneration(space, [record("a", 1)], 1, "t"); await publishImmutableGeneration(adapter, one); const before = await adapter.readBinary(".lina/published/generations/generation-000001/vectors.bin"); const two = buildImmutableGeneration(space, [record("a", 3)], 2, "u"); await publishImmutableGeneration(adapter, two); expect(new Uint8Array(await adapter.readBinary(".lina/published/generations/generation-000001/vectors.bin"))).toEqual(new Uint8Array(before)); expect((await publishImmutableGeneration(adapter, one)).error).toBe("ANTI_DOWNGRADE"); });
});

describe("M4 CURRENT crash recovery", () => {
  it.each([1, 2, 3])("accepts integrity-valid v%s for CURRENT and tmp recovery", async (version) => {
    const adapter = new MemoryAdapter(); const built = buildImmutableGeneration(space, [record("a", 1)], 1, "t");
    const records = JSON.stringify(built.records.map(({ embeddingInputHash, ...rest }) => version === 1 ? rest : { ...rest, embeddingInputHash }));
    const manifest = { ...built.manifest, formatVersion: version, recordsSha256: createHash("sha256").update(records).digest("hex") };
    const files = { manifest: JSON.stringify(manifest), records, vectors: built.vectors };
    expect(validatePublishedGenerationFiles(files)).toMatchObject({ integrityValid: true, cutoverEligible: false, legacyFormat: true });
    const base = ".lina/published/generations/generation-000001";
    await adapter.mkdir(base); await adapter.write(`${base}/manifest.json`, files.manifest); await adapter.write(`${base}/records.json`, records); await adapter.writeBinary(`${base}/vectors.bin`, built.vectors.slice().buffer);
    await adapter.write(".lina/published/CURRENT", "generation-000001");
    expect((await recoverPublishedGenerationPointer(adapter)).action).toBe("NO_OP");
    await adapter.remove(".lina/published/CURRENT"); await adapter.write(".lina/published/CURRENT.tmp", "generation-000001");
    expect((await recoverPublishedGenerationPointer(adapter)).action).toBe("RECOVERED_TMP");
    const next = buildImmutableGeneration(space, [record("a", 1)], 2, "u");
    expect((await publishImmutableGeneration(adapter, next)).success).toBe(true);
    expect(await adapter.read(".lina/published/CURRENT")).toBe("generation-000002");
    expect(await adapter.read(`${base}/records.json`)).toBe(records);
    expect(await adapter.read(`${base}/manifest.json`)).toBe(files.manifest);
    expect((await publishImmutableGeneration(adapter, next)).success).toBe(true);
    expect((await publishImmutableGeneration(adapter, built)).error).toBe("ANTI_DOWNGRADE");
    await adapter.write(`${base}/records.json`, "[]"); await adapter.write(".lina/published/CURRENT", "generation-000001");
    expect((await recoverPublishedGenerationPointer(adapter)).action).toBe("CURRENT_INVALID_TARGET");
  });
  it("rejects unknown formats and missing v3 hashes, including at build time", () => {
    const built = buildImmutableGeneration(space, [record("a", 1)], 1, "t");
    const files = { records: built.recordsJson, vectors: built.vectors };
    expect(validatePublishedGenerationFiles({ ...files, manifest: JSON.stringify({ ...built.manifest, formatVersion: 99 }) }).errors.map((e) => e.code)).toContain("FORMAT_UNSUPPORTED");
    const records = JSON.stringify(built.records.map(({ embeddingInputHash: _hash, ...rest }) => rest));
    expect(validatePublishedGenerationFiles({ ...files, records, manifest: JSON.stringify({ ...built.manifest, recordsSha256: createHash("sha256").update(records).digest("hex") }) })).toMatchObject({ integrityValid: false, cutoverEligible: false });
    expect(() => buildImmutableGeneration(space, [{ ...record("a", 1), embeddingInputHash: undefined }], 2)).toThrow("Missing embeddingInputHash");
  });
  it.each([1, 2, 3])("compares input hashes according to published v%s", (version) => {
    const metadata = { chunkId: "a", path: "a.md", index: 0, textHash: "h" };
    const comparison = compareLegacyAndPublished({ level: "L2", legacy: { records: [{ ...metadata, embeddingInputHash: "expected" }] }, published: { identity: { formatVersion: version }, records: [metadata] } });
    expect(comparison.equivalent).toBe(version === 1);
    expect(comparison.cutoverEligible).toBe(false);
    expect(comparison.formatVersion).toBe(version);
  });
  const one = () => buildImmutableGeneration(space, [record("a", 1)], 1, "t");
  const two = () => buildImmutableGeneration(space, [record("b", 2)], 2, "u");
  const three = () => buildImmutableGeneration(space, [record("c", 3)], 3, "v");
  async function published(adapter: MemoryAdapter, generation: ReturnType<typeof one>): Promise<void> { expect((await publishImmutableGeneration(adapter, generation)).success).toBe(true); }

  it("leaves a valid CURRENT without tmp unchanged", async () => {
    const adapter = new MemoryAdapter(); await published(adapter, one());
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: true, action: "NO_OP", currentAfter: "generation-000001", providerCalls: 0 });
  });

  it("restores a missing CURRENT from a valid CURRENT.tmp", async () => {
    const adapter = new MemoryAdapter(); await published(adapter, one());
    await adapter.remove(".lina/published/CURRENT"); await adapter.write(".lina/published/CURRENT.tmp", "generation-000001");
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: true, action: "RECOVERED_TMP", currentAfter: "generation-000001" });
  });

  it("completes an interrupted update only after validating the tmp target", async () => {
    const adapter = new MemoryAdapter(); await published(adapter, one()); await published(adapter, two());
    await adapter.write(".lina/published/CURRENT", "generation-000001"); await adapter.write(".lina/published/CURRENT.tmp", "generation-000002");
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: true, action: "RECOVERED_INTERRUPTED_UPDATE", currentAfter: "generation-000002" });
  });

  it.each(["generation-000999", "generation-000002"])("does not promote an invalid tmp target %s", async (target) => {
    const adapter = new MemoryAdapter(); await published(adapter, one());
    if (target === "generation-000002") { await published(adapter, two()); await adapter.write(".lina/published/CURRENT", "generation-000001"); await adapter.write(".lina/published/generations/generation-000002/manifest.json", "not-json"); }
    await adapter.write(".lina/published/CURRENT.tmp", target);
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: false, action: "CURRENT_RECOVERY_INVALID_TMP_TARGET", currentAfter: "generation-000001" });
    expect(await adapter.read(".lina/published/CURRENT")).toBe("generation-000001");
  });

  it("reports an invalid CURRENT instead of accepting it silently", async () => {
    const adapter = new MemoryAdapter(); await published(adapter, one()); await adapter.write(".lina/published/CURRENT", "generation-000999");
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: false, action: "CURRENT_INVALID_TARGET", error: "CURRENT_INVALID_TARGET" });
  });

  it("repairs promoted-not-current generations by selecting the highest validated final", async () => {
    const adapter = new MemoryAdapter(); await published(adapter, one()); await published(adapter, two()); await published(adapter, three());
    await adapter.write(".lina/published/CURRENT", "generation-000001");
    const before = new Uint8Array(await adapter.readBinary(".lina/published/generations/generation-000003/vectors.bin"));
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: true, action: "RECOVERED_PROMOTED_NOT_CURRENT", currentAfter: "generation-000003", providerCalls: 0 });
    expect(new Uint8Array(await adapter.readBinary(".lina/published/generations/generation-000003/vectors.bin"))).toEqual(before);
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: true, action: "NO_OP", currentAfter: "generation-000003" });
  });

  it("recovers a crash after final promotion before CURRENT.tmp and accepts Windows folder paths", async () => {
    const adapter = new MemoryAdapter(); await published(adapter, one()); await published(adapter, two());
    await adapter.write(".lina/published/CURRENT", "generation-000001"); await adapter.remove(".lina/published/CURRENT.tmp");
    const originalList = adapter.list.bind(adapter);
    adapter.list = async (path) => { const result = await originalList(path); return { ...result, folders: result.folders.map((folder) => `C:\\vault\\${path.replaceAll("/", "\\\\")}\\${folder}`) }; };
    await expect(recoverPublishedGenerationPointer(adapter)).resolves.toMatchObject({ success: true, action: "RECOVERED_PROMOTED_NOT_CURRENT", currentAfter: "generation-000002" });
  });
});
