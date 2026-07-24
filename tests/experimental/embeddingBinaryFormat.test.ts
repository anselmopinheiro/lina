import { describe, expect, it } from "vitest";
import type { EmbeddingRecord } from "../../src/index/embeddingPersistence";
import type { EmbeddingSpaceIdentity } from "../../src/index/embeddingUpdatePlan";
import {
  calculateExperimentalEmbeddingChecksum,
  ExperimentalEmbeddingBinaryError,
  ExperimentalEmbeddingBinaryManifest,
  readExperimentalEmbeddingBinary,
  writeExperimentalEmbeddingBinary,
} from "../../src/experimental/embeddingBinaryFormat";

const identity: EmbeddingSpaceIdentity = {
  provider: "ollama",
  model: "nomic-embed-text",
  dimensions: 3,
  inputVersion: 2,
  prefixMode: "none",
};

function record(chunkId: string, embedding = [1, -2.5, 3.25]): EmbeddingRecord {
  return {
    chunkId,
    path: `${chunkId}.md`,
    index: 0,
    textHash: `hash-${chunkId}`,
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions as number,
    embedding,
    createdAt: "2026-07-24T00:00:00.000Z",
    embeddingInputHash: `input-${chunkId}`,
  };
}

function withoutChecksums(manifest: ExperimentalEmbeddingBinaryManifest): ExperimentalEmbeddingBinaryManifest {
  const { metadataChecksum: _metadataChecksum, vectorsChecksum: _vectorsChecksum, ...remaining } = manifest;
  return remaining;
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentalEmbeddingBinaryError);
    expect((error as ExperimentalEmbeddingBinaryError).code).toBe(code);
  }
}

describe("experimental embedding binary format", () => {
  it("uses a deterministic SHA-256 checksum implementation", () => {
    expect(calculateExperimentalEmbeddingChecksum("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("writes a deterministic manifest, vector-free JSONL and explicit little-endian Float32 bytes", () => {
    const records = [record("one", [1, 2, 3]), record("two", [-1, 0.5, 4])];
    const original = JSON.stringify(records);
    const output = writeExperimentalEmbeddingBinary(records, identity);

    expect(output.manifest).toMatchObject({
      format: "lina-embedding-binary",
      version: 1,
      byteOrder: "little-endian",
      numericType: "float32",
      dimensions: 3,
      recordCount: 2,
      vectorByteLength: 24,
      provider: "ollama",
      model: "nomic-embed-text",
      inputFormatVersion: "2",
      prefixMode: "none",
    });
    expect(output.manifest.metadataChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(output.manifest.vectorsChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(output.metadataJsonl.trim().split("\n").every((line) => !("embedding" in JSON.parse(line)))).toBe(true);
    expect(output.metadataJsonl).toContain('"vectorOrdinal":0');
    expect(Array.from(new Uint8Array(output.vectors).slice(0, 4))).toEqual([0, 0, 128, 63]);
    expect(JSON.stringify(records)).toBe(original);
  });

  it("round-trips multiple records into the runtime-compatible metadata and Float32 block", () => {
    const output = writeExperimentalEmbeddingBinary([record("one"), record("two", [4, 5, 6])], identity);
    const result = readExperimentalEmbeddingBinary(output.manifest, output.metadataJsonl, output.vectors);

    expect(result.identity).toEqual(identity);
    expect(result.dimensions).toBe(3);
    expect(result.count).toBe(2);
    expect(result.records).toEqual([
      { chunkId: "one", path: "one.md", index: 0, textHash: "hash-one", embeddingInputHash: "input-one", vectorOrdinal: 0 },
      { chunkId: "two", path: "two.md", index: 0, textHash: "hash-two", embeddingInputHash: "input-two", vectorOrdinal: 1 },
    ]);
    expect(result.records.every((value) => !("embedding" in value))).toBe(true);
    expect(Array.from(result.vectors)).toEqual([1, -2.5, 3.25, 4, 5, 6]);
  });

  it("supports zero records and dimensions used by the current providers", () => {
    const empty = writeExperimentalEmbeddingBinary([], identity);
    expect(readExperimentalEmbeddingBinary(empty.manifest, empty.metadataJsonl, empty.vectors)).toMatchObject({ count: 0, dimensions: 3 });

    for (const dimensions of [384, 1536]) {
      const largeIdentity = { ...identity, dimensions };
      const output = writeExperimentalEmbeddingBinary([{
        ...record(`d${dimensions}`, Array.from({ length: dimensions }, (_, index) => index / 10)),
        dimensions,
      }], largeIdentity);
      const result = readExperimentalEmbeddingBinary(output.manifest, output.metadataJsonl, output.vectors);
      expect(result.vectors).toHaveLength(dimensions);
      expect(result.vectors[dimensions - 1]).toBeCloseTo((dimensions - 1) / 10, 5);
    }
  });

  it("reads known little-endian bytes without relying on Float32Array native byte order", () => {
    const output = writeExperimentalEmbeddingBinary([record("known", [0, 0, 0])], identity);
    const bytes = new Uint8Array(output.vectors);
    bytes.set([0, 0, 128, 63, 0, 0, 0, 192, 0, 0, 32, 64]);
    const manifest = { ...withoutChecksums(output.manifest) };
    expect(Array.from(readExperimentalEmbeddingBinary(manifest, output.metadataJsonl, output.vectors).vectors)).toEqual([1, -2, 2.5]);
  });

  it("rejects writer input with invalid vectors, duplicate chunk ids or heterogeneous identity", () => {
    expectCode(() => writeExperimentalEmbeddingBinary([record("nan", [NaN, 0, 0])], identity), "invalid-vector-value");
    expectCode(() => writeExperimentalEmbeddingBinary([record("infinity", [Infinity, 0, 0])], identity), "invalid-vector-value");
    expectCode(() => writeExperimentalEmbeddingBinary([record("same"), record("same")], identity), "duplicate-chunk-id");
    expectCode(() => writeExperimentalEmbeddingBinary([record("dimensions", [1, 2])], identity), "invalid-manifest");
    expectCode(() => writeExperimentalEmbeddingBinary([{ ...record("provider"), provider: "mistral" }], identity), "invalid-manifest");
  });

  it("rejects unsupported manifest properties and invalid manifest limits", () => {
    const output = writeExperimentalEmbeddingBinary([record("one")], identity);
    expectCode(() => readExperimentalEmbeddingBinary({ ...output.manifest, format: "other" } as ExperimentalEmbeddingBinaryManifest, output.metadataJsonl, output.vectors), "unsupported-format");
    expectCode(() => readExperimentalEmbeddingBinary({ ...output.manifest, version: 2 }, output.metadataJsonl, output.vectors), "unsupported-version");
    expectCode(() => readExperimentalEmbeddingBinary({ ...output.manifest, byteOrder: "big-endian" } as ExperimentalEmbeddingBinaryManifest, output.metadataJsonl, output.vectors), "unsupported-byte-order");
    expectCode(() => readExperimentalEmbeddingBinary({ ...output.manifest, numericType: "float64" } as ExperimentalEmbeddingBinaryManifest, output.metadataJsonl, output.vectors), "unsupported-numeric-type");
    expectCode(() => readExperimentalEmbeddingBinary({ ...withoutChecksums(output.manifest), dimensions: 0 }, output.metadataJsonl, output.vectors), "invalid-manifest");
    expectCode(() => readExperimentalEmbeddingBinary({ ...withoutChecksums(output.manifest), recordCount: -1 }, output.metadataJsonl, output.vectors), "invalid-manifest");
    expectCode(() => readExperimentalEmbeddingBinary({ ...withoutChecksums(output.manifest), recordCount: Number.MAX_SAFE_INTEGER, dimensions: 2 }, output.metadataJsonl, output.vectors), "overflow");
  });

  it("rejects truncation, missing vectors, extra vectors and inconsistent declared length", () => {
    const output = writeExperimentalEmbeddingBinary([record("one"), record("two")], identity);
    const manifest = withoutChecksums(output.manifest);
    expectCode(() => readExperimentalEmbeddingBinary(manifest, output.metadataJsonl, output.vectors.slice(0, output.vectors.byteLength - 1)), "truncated-vectors");
    expectCode(() => readExperimentalEmbeddingBinary(manifest, output.metadataJsonl, output.vectors.slice(0, output.vectors.byteLength - 4)), "truncated-vectors");
    expectCode(() => readExperimentalEmbeddingBinary(manifest, output.metadataJsonl, output.vectors.slice(0, 12)), "truncated-vectors");
    const extra = new ArrayBuffer(output.vectors.byteLength + 4);
    new Uint8Array(extra).set(new Uint8Array(output.vectors));
    expectCode(() => readExperimentalEmbeddingBinary(manifest, output.metadataJsonl, extra), "invalid-vector-length");
    expectCode(() => readExperimentalEmbeddingBinary({ ...manifest, vectorByteLength: 12 }, output.metadataJsonl, output.vectors), "invalid-vector-length");
  });

  it("rejects malformed, extra, duplicate, missing and out-of-range metadata ordinals", () => {
    const output = writeExperimentalEmbeddingBinary([record("one"), record("two")], identity);
    const manifest = withoutChecksums(output.manifest);
    expectCode(() => readExperimentalEmbeddingBinary(manifest, "not json\n", output.vectors), "invalid-metadata");
    expectCode(() => readExperimentalEmbeddingBinary(manifest, "{oops}\n{also}\n", output.vectors), "corrupt-metadata");
    expectCode(() => readExperimentalEmbeddingBinary(manifest, output.metadataJsonl + "{}\n", output.vectors), "invalid-metadata");
    const rows = output.metadataJsonl.trim().split("\n").map((row) => JSON.parse(row));
    expectCode(() => readExperimentalEmbeddingBinary(manifest, `${JSON.stringify(rows[0])}\n${JSON.stringify({ ...rows[1], chunkId: "one" })}\n`, output.vectors), "duplicate-chunk-id");
    expectCode(() => readExperimentalEmbeddingBinary(manifest, `${JSON.stringify(rows[0])}\n${JSON.stringify({ ...rows[1], vectorOrdinal: 0 })}\n`, output.vectors), "duplicate-vector-ordinal");
    expectCode(() => readExperimentalEmbeddingBinary(manifest, `${JSON.stringify({ ...rows[0], vectorOrdinal: 1 })}\n${JSON.stringify(rows[1])}\n`, output.vectors), "duplicate-vector-ordinal");
    expectCode(() => readExperimentalEmbeddingBinary(manifest, `${JSON.stringify(rows[0])}\n${JSON.stringify({ ...rows[1], vectorOrdinal: 2 })}\n`, output.vectors), "invalid-metadata");
  });

  it("rejects non-finite stored Float32 values and detects both checksum domains", () => {
    const output = writeExperimentalEmbeddingBinary([record("one")], identity);
    const noChecksums = withoutChecksums(output.manifest);
    const nanVectors = output.vectors.slice(0);
    new DataView(nanVectors).setUint32(0, 0x7fc00000, true);
    expectCode(() => readExperimentalEmbeddingBinary(noChecksums, output.metadataJsonl, nanVectors), "invalid-vector-value");
    expectCode(() => readExperimentalEmbeddingBinary(output.manifest, `${output.metadataJsonl} `, output.vectors), "checksum-mismatch");
    const changedVectors = output.vectors.slice(0);
    new Uint8Array(changedVectors)[0] ^= 1;
    expectCode(() => readExperimentalEmbeddingBinary(output.manifest, output.metadataJsonl, changedVectors), "checksum-mismatch");
  });
});
