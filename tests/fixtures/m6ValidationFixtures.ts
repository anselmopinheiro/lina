import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildImmutableGeneration } from "../../src/index/publishedGenerationBuilder";
import { computeVectorContractId } from "../../src/index/vectorContract";
import { buildEmbeddingInput } from "../../src/index/embeddingGenerator";
import { hashContent } from "../../src/index/noteHasher";
import type { EmbeddingSpaceRecord, ProducerEmbeddingRecord } from "../../src/index/producerLocalStoreTypes";
import type { Chunk } from "../../src/index/chunker";

export const M6_FIXTURE_ACTIVE_PRODUCER_ID = "440d9ef0-9ff9-424e-ae55-7c386b885ec8";
export const M6_FIXTURE_EPOCH = 3;
export const M6_FIXTURE_GENERATION_ID = "generation-000015";

export async function populateM6ValidationFixtureVault(vaultDir: string): Promise<void> {
  const contractId = computeVectorContractId({
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 2,
    prefixMode: "none",
    inputVersion: 1,
  });

  const chunks: Chunk[] = [
    {
      chunkId: "note1.md::0",
      path: "note1.md",
      chunkIndex: 0,
      text: "First sample note about obsidian lina assistant",
      textHash: hashContent("First sample note about obsidian lina assistant"),
      createdAt: "2026-10-13T00:00:00.000Z",
    },
    {
      chunkId: "note2.md::0",
      path: "note2.md",
      chunkIndex: 0,
      text: "Second sample note for cutover runtime validation",
      textHash: hashContent("Second sample note for cutover runtime validation"),
      createdAt: "2026-10-13T00:00:00.000Z",
    },
  ];

  const inputHash1 = hashContent(buildEmbeddingInput(chunks[0], "none"));
  const inputHash2 = hashContent(buildEmbeddingInput(chunks[1], "none"));

  const space: EmbeddingSpaceRecord = {
    spaceId: "space-m6-fixture",
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 2,
    vectorContractId: contractId,
    inputVersion: 1,
    prefixMode: "none",
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    sourceProvenance: {
      sourceTextGenerationId: "text-1",
      sourceChunksDigest: "sha256:chunks123",
      sourcePublicationId: "pub-1",
      sourceRecordCount: 2,
    },
    publicationProducerProvenance: {
      producerDeviceId: M6_FIXTURE_ACTIVE_PRODUCER_ID,
      producerEpoch: M6_FIXTURE_EPOCH,
    },
  };

  const producerRecords: ProducerEmbeddingRecord[] = [
    {
      chunkId: chunks[0].chunkId,
      spaceId: "space-m6-fixture",
      notePath: chunks[0].path,
      chunkIndex: chunks[0].chunkIndex,
      textHash: chunks[0].textHash,
      vectorContractId: contractId,
      embeddingInputHash: inputHash1,
      embeddingBlob: new Float32Array([1.0, 0.0]),
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
    },
    {
      chunkId: chunks[1].chunkId,
      spaceId: "space-m6-fixture",
      notePath: chunks[1].path,
      chunkIndex: chunks[1].chunkIndex,
      textHash: chunks[1].textHash,
      vectorContractId: contractId,
      embeddingInputHash: inputHash2,
      embeddingBlob: new Float32Array([0.0, 1.0]),
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
    },
  ];

  const built = buildImmutableGeneration(space, producerRecords, 15, "2026-10-13T00:00:00.000Z");

  const pubDir = path.join(vaultDir, ".lina", "published");
  const genDir = path.join(pubDir, "generations", M6_FIXTURE_GENERATION_ID);
  const indexDir = path.join(vaultDir, ".lina", "index");
  const pluginDir = path.join(vaultDir, ".obsidian", "plugins", "lina");

  await fs.mkdir(genDir, { recursive: true });
  await fs.mkdir(indexDir, { recursive: true });
  await fs.mkdir(pluginDir, { recursive: true });

  // 1. Published generation files
  await fs.writeFile(path.join(pubDir, "CURRENT"), `${M6_FIXTURE_GENERATION_ID}\n`, "utf-8");
  await fs.writeFile(path.join(genDir, "manifest.json"), JSON.stringify(built.manifest, null, 2), "utf-8");
  await fs.writeFile(path.join(genDir, "records.json"), built.recordsJson, "utf-8");
  await fs.writeFile(path.join(genDir, "vectors.bin"), Buffer.from(built.vectors.buffer, built.vectors.byteOffset, built.vectors.byteLength));

  // 2. Ownership
  await fs.writeFile(
    path.join(vaultDir, ".lina", "ownership.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        activeProducerId: M6_FIXTURE_ACTIVE_PRODUCER_ID,
        epoch: M6_FIXTURE_EPOCH,
        acquiredAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        reason: "initial",
      },
      null,
      2
    ),
    "utf-8"
  );

  // 3. Settings / data.json
  await fs.writeFile(
    path.join(pluginDir, "data.json"),
    JSON.stringify(
      {
        settings: {
          deviceSettingsById: {
            [M6_FIXTURE_ACTIVE_PRODUCER_ID]: {
              deviceName: "desktop-producer",
            },
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  // 4. Chunks file (chunks.jsonl)
  await fs.writeFile(path.join(indexDir, "chunks.jsonl"), chunks.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf-8");

  // 5. Canonical Index Manifest
  const manifest = {
    version: 1,
    indexType: "text",
    embeddingsEnabled: true,
    generationId: "text-1",
    chunksDigest: "sha256:chunks123",
    totalNotes: 2,
    totalChunks: 2,
    updatedAt: "2026-10-13T00:00:00.000Z",
    embeddings: {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 2,
      updatedAt: "2026-10-13T00:00:00.000Z",
      publicationId: "pub-1",
      totalEmbeddings: 2,
      sourceTotalChunks: 2,
    },
    embeddingInput: {
      version: 1,
      prefixMode: "none",
    },
  };
  await fs.writeFile(path.join(indexDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // 6. Legacy embeddings.jsonl
  const legacyRecords = [
    {
      chunkId: chunks[0].chunkId,
      path: chunks[0].path,
      index: chunks[0].chunkIndex,
      textHash: chunks[0].textHash,
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 2,
      vectorContractId: contractId,
      embeddingInputHash: inputHash1,
      createdAt: "2026-10-13T00:00:00.000Z",
      embedding: [1.0, 0.0],
    },
    {
      chunkId: chunks[1].chunkId,
      path: chunks[1].path,
      index: chunks[1].chunkIndex,
      textHash: chunks[1].textHash,
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 2,
      vectorContractId: contractId,
      embeddingInputHash: inputHash2,
      createdAt: "2026-10-13T00:00:00.000Z",
      embedding: [0.0, 1.0],
    },
  ];
  await fs.writeFile(
    path.join(indexDir, "embeddings.jsonl"),
    legacyRecords.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf-8"
  );
}
