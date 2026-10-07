import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PublishedGenerationReader, evaluatePublishedGenerationSemanticContract, evaluatePublishedGenerationSourceProvenance, type PublishedGenerationReaderPorts } from "../../src/index/publishedGenerationReader";
import { createVectorContract } from "../../src/index/vectorContract";
import type { BinaryEmbeddingDigest, EmbeddingBinaryResourceLimits } from "../../src/index/embeddingBinaryStorage";

const root = ".lina/published";
const limits: EmbeddingBinaryResourceLimits = { maxRecordCount: 10, maxDimensions: 10, maxVectorBytes: 1024, maxMetadataBytes: 1024, maxTotalFileBytes: 2048, maxEstimatedPeakBytes: 4096, workingMemoryReserveBytes: 16 };
const digest: BinaryEmbeddingDigest = { async digest(value) { let sum = 0; for (const byte of new Uint8Array(value)) sum = (sum + byte) % 65536; return `sha256:${sum.toString(16)}`; } };
const encode = (value: string): ArrayBuffer => { const bytes = new TextEncoder().encode(value); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };

class FakeAdapter {
  readonly text = new Map<string, string>();
  readonly binary = new Map<string, ArrayBuffer>();
  readonly paths = new Set<string>();
  readonly reads: string[] = [];
  currentReads = 0;
  currentAfter?: string;
  async exists(path: string): Promise<boolean> { return this.paths.has(path) || this.text.has(path) || this.binary.has(path); }
  async read(path: string): Promise<string> { this.reads.push(path); if (path === `${root}/CURRENT` && ++this.currentReads === 2 && this.currentAfter !== undefined) return this.currentAfter; const value = this.text.get(path); if (value === undefined) throw new Error(`missing ${path}`); return value; }
  async readBinary(path: string): Promise<ArrayBuffer> { this.reads.push(path); const value = this.binary.get(path); if (!value) throw new Error(`missing ${path}`); return value; }
  async list(): Promise<{ files: string[]; folders: string[] }> { return { files: [], folders: [] }; }
}

async function addValid(adapter: FakeAdapter, id = "generation-000001", formatVersion = 1, includeHash = true): Promise<void> {
  const base = `${root}/generations/${id}`;
  const records = JSON.stringify([{ index: 0, offsetBytes: 0, chunkId: "chunk", notePath: "note.md", chunkIndex: 4, textHash: "text", vectorContractId: "contract", ...(includeHash ? { embeddingInputHash: "input" } : {}) }]);
  const vectors = new Float32Array([1, 2]).buffer;
  const vectorContract = createVectorContract({ provider: "ollama", model: "model", dimensions: 2, prefixMode: "none", inputVersion: 1 });
  const manifest = { formatVersion, generationId: id, vectorContractId: formatVersion >= 3 ? vectorContract.contractId : "contract", provider: "ollama", model: "model", dimensions: 2, dtype: "float32", recordCount: 1, vectorsFile: "vectors.bin", recordsFile: "records.json", vectorsByteLength: vectors.byteLength, vectorsSha256: await digest.digest(vectors), recordsSha256: await digest.digest(encode(records)), ...(formatVersion >= 3 ? { metric: "cosine", inputVersion: 1, prefixMode: "none", vectorContract } : {}), ...(formatVersion >= 4 ? { sourceTextGenerationId: "text-1", sourceChunksDigest: "sha256:chunks", sourcePublicationId: "pub-1", sourceRecordCount: 1 } : {}), ...(formatVersion === 5 ? { producerDeviceId: "dev-123e4567-e89b-42d3-a456-426614174000", producerEpoch: 1 } : {}) };
  const v3Records = formatVersion >= 3 ? records.replaceAll('"vectorContractId":"contract"', `"vectorContractId":"${vectorContract.contractId}"`) : records;
  if (formatVersion >= 3) manifest.recordsSha256 = await digest.digest(encode(v3Records));
  adapter.paths.add(base); adapter.text.set(`${base}/manifest.json`, JSON.stringify(manifest)); adapter.text.set(`${base}/records.json`, v3Records); adapter.binary.set(`${base}/vectors.bin`, vectors);
}
function reader(adapter: FakeAdapter, resourceLimits = limits): PublishedGenerationReader { const ports: PublishedGenerationReaderPorts = { adapter, digest, limits: resourceLimits }; return new PublishedGenerationReader(ports); }

describe("PublishedGenerationReader M5A", () => {
  it.each([1, 2, 3])("exposes format and eligibility for v%s", async (version) => {
    const adapter = new FakeAdapter(); await addValid(adapter, "generation-000001", version, version !== 1);
    adapter.text.set(`${root}/CURRENT`, "generation-000001");
    const result = await reader(adapter).read();
    expect(result).toMatchObject({ status: "OK", formatVersion: version, cutoverEligible: false, legacyFormat: true });
    expect(result.index?.records[0]?.embeddingInputHash).toBe(version !== 1 ? "input" : undefined);
  });
  it("exposes v4 source provenance and rejects a missing required source field", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter, "generation-000001", 4, true); adapter.text.set(`${root}/CURRENT`, "generation-000001");
    const result = await reader(adapter).read();
    expect(result).toMatchObject({ status: "OK", formatVersion: 4, cutoverEligible: false, legacyFormat: true });
    expect(result.index && evaluatePublishedGenerationSourceProvenance(result.index, { sourceTextGenerationId: "text-1", sourceChunksDigest: "sha256:chunks", sourcePublicationId: "pub-1", sourceRecordCount: 1 })).toEqual({ status: "COMPATIBLE" });
    const path = `${root}/generations/generation-000001/manifest.json`; const manifest = JSON.parse(adapter.text.get(path) ?? "{}"); delete manifest.sourceChunksDigest; adapter.text.set(path, JSON.stringify(manifest));
    await expect(reader(adapter).read()).resolves.toMatchObject({ status: "MANIFEST_INVALID", detail: "SOURCE_CHUNKS_DIGEST_MISSING" });
  });
  it("rejects v2 without input hashes", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter, "generation-000001", 2, false);
    adapter.text.set(`${root}/CURRENT`, "generation-000001");
    expect((await reader(adapter).read()).status).toBe("RECORDS_INVALID");
  });
  it("rejects a v3 manifest whose recomputed contract differs", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter, "generation-000001", 3, true);
    adapter.text.set(`${root}/CURRENT`, "generation-000001");
    const path = `${root}/generations/generation-000001/manifest.json`;
    const manifest = JSON.parse(adapter.text.get(path) ?? "{}"); manifest.vectorContractId = "vec:wrong"; adapter.text.set(path, JSON.stringify(manifest));
    await expect(reader(adapter).read()).resolves.toMatchObject({ status: "MANIFEST_INVALID", detail: "VECTOR_CONTRACT_MISMATCH" });
  });
  it("returns a semantic mismatch without activating any cutover path", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter, "generation-000001", 3, true); adapter.text.set(`${root}/CURRENT`, "generation-000001");
    const result = await reader(adapter).read(); const query = createVectorContract({ provider: "ollama", model: "other", dimensions: 2, prefixMode: "none", inputVersion: 1 });
    expect(result.index && evaluatePublishedGenerationSemanticContract(result.index, query)).toMatchObject({ status: "SEMANTIC_CONTRACT_MISMATCH" });
  });
  it("reads a valid generation without write capabilities", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter); adapter.text.set(`${root}/CURRENT`, "generation-000001");
    const result = await reader(adapter).read();
    expect(result).toMatchObject({ status: "OK", generationId: "generation-000001", providerCalls: 0 });
    expect(result.index?.records[0]).toEqual({ chunkId: "chunk", path: "note.md", index: 4, textHash: "text", embeddingInputHash: "input" });
    expect(result.index?.vectors).toEqual(new Float32Array([1, 2]));
    expect("write" in adapter || "rename" in adapter || "remove" in adapter).toBe(false);
  });

  it("classifies absent, tmp-only, and malformed CURRENT", async () => {
    const adapter = new FakeAdapter(); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "NO_CURRENT" });
    adapter.text.set(`${root}/CURRENT.tmp`, "generation-000001"); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "CURRENT_TMP_ONLY" });
    adapter.text.set(`${root}/CURRENT`, "bad"); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "CURRENT_MALFORMED" });
  });

  it("classifies missing and partial targets", async () => {
    const adapter = new FakeAdapter(); adapter.text.set(`${root}/CURRENT`, "generation-000001");
    await expect(reader(adapter).read()).resolves.toMatchObject({ status: "TARGET_MISSING" });
    adapter.paths.add(`${root}/generations/generation-000001`); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "TARGET_PARTIAL" });
  });

  it.each(["manifest.json", "records.json", "vectors.bin"])("rejects a target missing %s", async (missing) => {
    const adapter = new FakeAdapter(); await addValid(adapter); adapter.text.set(`${root}/CURRENT`, "generation-000001");
    const base = `${root}/generations/generation-000001`; if (missing === "vectors.bin") adapter.binary.delete(`${base}/${missing}`); else adapter.text.delete(`${base}/${missing}`);
    await expect(reader(adapter).read()).resolves.toMatchObject({ status: "TARGET_PARTIAL" });
  });

  it("distinguishes manifest and format failures", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter); adapter.text.set(`${root}/CURRENT`, "generation-000001");
    adapter.text.set(`${root}/generations/generation-000001/manifest.json`, "{"); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "MANIFEST_INVALID" });
    await addValid(adapter); const manifest = JSON.parse(adapter.text.get(`${root}/generations/generation-000001/manifest.json`) ?? "{}"); manifest.formatVersion = 99; adapter.text.set(`${root}/generations/generation-000001/manifest.json`, JSON.stringify(manifest));
    await expect(reader(adapter).read()).resolves.toMatchObject({ status: "FORMAT_UNSUPPORTED" });
    await addValid(adapter); manifest.formatVersion = 1; manifest.dtype = "float64"; adapter.text.set(`${root}/generations/generation-000001/manifest.json`, JSON.stringify(manifest)); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "MANIFEST_INVALID" });
  });

  it("rejects record/vector hash failures and corrupt records", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter); adapter.text.set(`${root}/CURRENT`, "generation-000001"); const base = `${root}/generations/generation-000001`;
    adapter.text.set(`${base}/records.json`, "[]"); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "HASH_MISMATCH", detail: "records" });
    await addValid(adapter); adapter.binary.set(`${base}/vectors.bin`, new Float32Array([4, 5]).buffer); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "HASH_MISMATCH", detail: "vectors" });
    await addValid(adapter); const manifest = JSON.parse(adapter.text.get(`${base}/manifest.json`) ?? "{}"); const invalid = "not-json"; manifest.recordsSha256 = await digest.digest(encode(invalid)); adapter.text.set(`${base}/manifest.json`, JSON.stringify(manifest)); adapter.text.set(`${base}/records.json`, invalid); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "RECORDS_INVALID" });
  });

  it("rejects duplicate records, bad offsets, dimensions and truncated vectors", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter); adapter.text.set(`${root}/CURRENT`, "generation-000001"); const base = `${root}/generations/generation-000001`;
    const alter = async (records: unknown, manifestPatch: Record<string, unknown> = {}) => { const text = JSON.stringify(records); const manifest = JSON.parse(adapter.text.get(`${base}/manifest.json`) ?? "{}"); Object.assign(manifest, manifestPatch, { recordsSha256: await digest.digest(encode(text)) }); adapter.text.set(`${base}/manifest.json`, JSON.stringify(manifest)); adapter.text.set(`${base}/records.json`, text); };
    await alter([{ index: 0, offsetBytes: 0, chunkId: "x", notePath: "a", chunkIndex: 0, textHash: "x", vectorContractId: "contract", embeddingInputHash: "input-x" }, { index: 1, offsetBytes: 8, chunkId: "x", notePath: "b", chunkIndex: 1, textHash: "y", vectorContractId: "contract", embeddingInputHash: "input-y" }], { recordCount: 2, vectorsByteLength: 16 }); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "RECORDS_INVALID" });
    await addValid(adapter); const bad = [{ index: 0, offsetBytes: 4, chunkId: "x", notePath: "a", chunkIndex: 0, textHash: "x", vectorContractId: "contract", embeddingInputHash: "input-x" }]; await alter(bad); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "RECORDS_INVALID" });
    await addValid(adapter); const manifest = JSON.parse(adapter.text.get(`${base}/manifest.json`) ?? "{}"); manifest.dimensions = 3; manifest.vectorsByteLength = 12; adapter.text.set(`${base}/manifest.json`, JSON.stringify(manifest)); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "VECTORS_INVALID" });
    await addValid(adapter); adapter.binary.set(`${base}/vectors.bin`, new Float32Array([1]).buffer); await expect(reader(adapter).read()).resolves.toMatchObject({ status: "VECTORS_INVALID" });
  });

  it("enforces known resource limits before reading large files", async () => {
    const adapter = new FakeAdapter(); await addValid(adapter); adapter.text.set(`${root}/CURRENT`, "generation-000001");
    const strict = { ...limits, maxVectorBytes: 1 }; await expect(reader(adapter, strict).read()).resolves.toMatchObject({ status: "RESOURCE_LIMIT" });
    expect(adapter.reads).not.toContain(`${root}/generations/generation-000001/records.json`);
  });

  it("rejects downgrade and discards a generation when CURRENT changes", async () => {
    const downgrade = new FakeAdapter(); await addValid(downgrade); downgrade.text.set(`${root}/CURRENT`, "generation-000001"); await expect(reader(downgrade).read({ lastValidGenerationId: "generation-000002" })).resolves.toMatchObject({ status: "DOWNGRADE_REJECTED" });
    const changed = new FakeAdapter(); await addValid(changed); changed.text.set(`${root}/CURRENT`, "generation-000001"); changed.currentAfter = "generation-000002"; await expect(reader(changed).read()).resolves.toMatchObject({ status: "CURRENT_CHANGED", currentAfter: "generation-000002" });
  });

  it("has no prohibited runtime dependencies", () => {
    const source = readFileSync("src/index/publishedGenerationReader.ts", "utf8");
    expect(source).not.toMatch(/node:|sqliteProducerLocalStore|publishedGenerationWriter|recoverPublishedGenerationPointer|provider\/|ai\//);
  });
});
