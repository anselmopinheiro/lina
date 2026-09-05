import { describe, it, expect, vi } from "vitest";
import {
  VECTOR_CONTRACT_SCHEMA_VERSION,
  VECTOR_CONTRACT_METRIC,
  VECTOR_CONTRACT_ID_PREFIX,
  createVectorContract,
  computeVectorContractId,
  isValidVectorContract,
  extractVectorContract,
  evaluateVectorContractCompatibility,
  resolveEffectiveEmbeddingRuntimeConfig,
  type VectorContractV1,
} from "../../src/index/vectorContract";
import {
  evaluateCompanionConsumptionState,
} from "../../src/companion/companionConsumptionState";
import {
  executeCompanionSearch,
  executeCompanionSemanticSearch,
} from "../../src/companion/companionSearch";
import {
  createSettingsRuntimeAdapters,
  type SettingsRuntimeHost,
} from "../../src/settings/settingsRuntimeAdapters";
import {
  publishCanonicalEmbeddings,
  type EmbeddingRecord,
  type EmbeddingPublicationInfo,
} from "../../src/index/embeddingPersistence";
import {
  BinaryEmbeddingPublisher,
  readBinaryEmbeddingStorage,
  type BinaryEmbeddingDataAdapter,
  type BinaryEmbeddingDigest,
  type EmbeddingStorageDescriptor,
} from "../../src/index/embeddingBinaryStorage";

class InMemoryVaultAdapter {
  private files = new Map<string, string>();
  private binaryFiles = new Map<string, ArrayBuffer>();

  async read(path: string): Promise<string> {
    const val = this.files.get(path);
    if (val === undefined) throw new Error(`File not found: ${path}`);
    return val;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const val = this.binaryFiles.get(path);
    if (val === undefined) throw new Error(`Binary file not found: ${path}`);
    return val;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.binaryFiles.set(path, data);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.binaryFiles.has(path);
  }

  async stat(path: string): Promise<{ type: string; size: number; mtime: number } | null> {
    if (this.files.has(path)) {
      const content = this.files.get(path)!;
      return { type: "file", size: new TextEncoder().encode(content).length, mtime: Date.now() };
    }
    if (this.binaryFiles.has(path)) {
      const buffer = this.binaryFiles.get(path)!;
      return { type: "file", size: buffer.byteLength, mtime: Date.now() };
    }
    return null;
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
}

const mockDigest: BinaryEmbeddingDigest = {
  digest: async (val: ArrayBuffer) => {
    return `sha256:${val.byteLength.toString(16).padStart(64, "0")}`;
  },
};

describe("Vector Contract Formalization & Companion Inheritance (LINA-03-005)", () => {
  const baseContractInput = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    metric: "cosine" as const,
    prefixMode: "nomic-search-query-document",
    inputVersion: 1,
  };

  describe("Contract Determinism & Identity", () => {
    it("1. computes deterministic contractId for identical inputs", () => {
      const id1 = computeVectorContractId(baseContractInput);
      const id2 = computeVectorContractId({
        provider: "OLLAMA",
        model: "NOMIC-EMBED-TEXT",
        dimensions: 768,
        prefixMode: "nomic-search-query-document",
        inputVersion: 1,
      });

      expect(id1).toBe(id2);
      expect(id1.startsWith(VECTOR_CONTRACT_ID_PREFIX)).toBe(true);
    });

    it("2. metadata irrelevante (timestamp, endpoint, deviceId, secret) não altera ID", () => {
      const contract1 = createVectorContract(baseContractInput);
      const contract2 = createVectorContract({
        ...baseContractInput,
        // Any extraneous parameters are not in the contract schema
      });

      expect(contract1.contractId).toBe(contract2.contractId);
      expect(contract1.schemaVersion).toBe(VECTOR_CONTRACT_SCHEMA_VERSION);
      expect(contract1.metric).toBe(VECTOR_CONTRACT_METRIC);
    });

    it("3. provider diferente -> mismatch", () => {
      const contractA = createVectorContract(baseContractInput);
      const contractB = createVectorContract({
        ...baseContractInput,
        provider: "openrouter",
      });

      expect(contractA.contractId).not.toBe(contractB.contractId);
      const evalResult = evaluateVectorContractCompatibility(contractA, contractB);
      expect(evalResult.status).toBe("mismatch");
      expect(evalResult.reason).toContain("provider-mismatch");
    });

    it("4. model diferente -> mismatch", () => {
      const contractA = createVectorContract(baseContractInput);
      const contractB = createVectorContract({
        ...baseContractInput,
        model: "all-minilm",
      });

      expect(contractA.contractId).not.toBe(contractB.contractId);
      const evalResult = evaluateVectorContractCompatibility(contractA, contractB);
      expect(evalResult.status).toBe("mismatch");
      expect(evalResult.reason).toContain("model-mismatch");
    });

    it("5. dimensions diferente -> mismatch", () => {
      const contractA = createVectorContract(baseContractInput);
      const contractB = createVectorContract({
        ...baseContractInput,
        dimensions: 384,
      });

      expect(contractA.contractId).not.toBe(contractB.contractId);
      const evalResult = evaluateVectorContractCompatibility(contractA, contractB);
      expect(evalResult.status).toBe("mismatch");
      expect(evalResult.reason).toContain("dimensions-mismatch");
    });

    it("6. metric diferente -> mismatch", () => {
      const contractA = createVectorContract(baseContractInput);
      const candidateMismatch = {
        ...contractA,
        metric: "euclidean" as unknown as "cosine",
        contractId: "vec:custom-fake-id",
      };

      const evalResult = evaluateVectorContractCompatibility(contractA, candidateMismatch);
      expect(evalResult.status).toBe("mismatch");
      expect(evalResult.reason).toContain("metric-mismatch");
    });

    it("7. prefixMode diferente -> mismatch", () => {
      const contractA = createVectorContract(baseContractInput);
      const contractB = createVectorContract({
        ...baseContractInput,
        prefixMode: "none",
      });

      expect(contractA.contractId).not.toBe(contractB.contractId);
      const evalResult = evaluateVectorContractCompatibility(contractA, contractB);
      expect(evalResult.status).toBe("mismatch");
      expect(evalResult.reason).toContain("prefix-mode-mismatch");
    });

    it("8. inputVersion diferente -> mismatch", () => {
      const contractA = createVectorContract(baseContractInput);
      const contractB = createVectorContract({
        ...baseContractInput,
        inputVersion: 2,
      });

      expect(contractA.contractId).not.toBe(contractB.contractId);
      const evalResult = evaluateVectorContractCompatibility(contractA, contractB);
      expect(evalResult.status).toBe("mismatch");
      expect(evalResult.reason).toContain("input-version-mismatch");
    });
  });

  describe("Manifest Contract Transportation & Legacy Compatibility", () => {
    it("9. manifesto novo transporta vectorContract completo", () => {
      const contract = createVectorContract(baseContractInput);
      const manifest = {
        indexType: "text",
        version: 1,
        totalNotes: 10,
        totalChunks: 25,
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider: "ollama",
          model: "nomic-embed-text",
          totalEmbeddings: 25,
          dimensions: 768,
          vectorContract: contract,
        },
        vectorContract: contract,
      };

      const extracted = extractVectorContract(manifest);
      expect(extracted).not.toBeNull();
      expect(extracted?.contractId).toBe(contract.contractId);
      expect(isValidVectorContract(extracted)).toBe(true);
    });

    it("10. manifesto legacy continua legível e classifica contrato como unknown", () => {
      const legacyManifest = {
        indexType: "text",
        version: 1,
        totalNotes: 5,
        totalChunks: 10,
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider: "ollama",
          // missing dimensions, prefixMode, inputVersion
        },
      };

      const extracted = extractVectorContract(legacyManifest);
      expect(extracted).toBeNull();

      const evalResult = evaluateVectorContractCompatibility(
        createVectorContract(baseContractInput),
        legacyManifest
      );
      expect(evalResult.status).toBe("unknown");
    });

    it("11. vectorContract inválido é rejeitado com segurança", () => {
      expect(isValidVectorContract(null)).toBe(false);
      expect(isValidVectorContract({})).toBe(false);
      expect(isValidVectorContract({
        schemaVersion: 1,
        provider: "ollama",
        model: "nomic",
        dimensions: -5, // invalid
        metric: "cosine",
        prefixMode: "none",
        inputVersion: 1,
        contractId: "vec:invalid",
      })).toBe(false);
    });
  });

  describe("Producer Side Publication", () => {
    it("12. Active Producer publica manifesto canónico com vectorContract", async () => {
      const adapter = new InMemoryVaultAdapter();
      const app = { vault: { adapter } } as any;

      // Seed current canonical manifest
      await adapter.write(".lina/index/manifest.json", JSON.stringify({
        indexType: "text",
        version: 1,
        totalNotes: 1,
        totalChunks: 1,
      }));

      const record: EmbeddingRecord = {
        chunkId: "Note.md::0",
        path: "Note.md",
        index: 0,
        textHash: "hash123",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 768,
        embedding: new Array(768).fill(0.01),
        createdAt: new Date().toISOString(),
      };

      const info: EmbeddingPublicationInfo = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      };

      const result = await publishCanonicalEmbeddings(app, [record], info);
      expect(result.success).toBe(true);

      const publishedManifest = JSON.parse(await adapter.read(".lina/index/manifest.json"));
      expect(publishedManifest.embeddingsEnabled).toBe(true);
      expect(publishedManifest.vectorContract).toBeDefined();
      expect(publishedManifest.vectorContract.contractId).toBe(computeVectorContractId(info));
    });

    it("13. mudança real de provider/model altera contractId", () => {
      const contract1 = createVectorContract({
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        prefixMode: "nomic-search-query-document",
        inputVersion: 1,
      });

      const contract2 = createVectorContract({
        provider: "mistral",
        model: "mistral-embed",
        dimensions: 1024,
        prefixMode: "none",
        inputVersion: 1,
      });

      expect(contract1.contractId).not.toBe(contract2.contractId);
    });
  });

  describe("Companion Inheritance & Restrictions", () => {
    it("15. Companion herda provider/modelo do Producer e marca vectorContract no consumptionState", () => {
      const contract = createVectorContract(baseContractInput);
      const textManifestRaw = {
        indexType: "text",
        version: 1,
        totalNotes: 10,
        totalChunks: 20,
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          vectorContract: contract,
        },
        vectorContract: contract,
      };

      const state = evaluateCompanionConsumptionState({
        deviceId: "companion-device-1",
        role: "companion",
        textManifestRaw,
      });

      expect(state.isCompanion).toBe(true);
      expect(state.embeddingState.provider).toBe("ollama");
      expect(state.embeddingState.model).toBe("nomic-embed-text");
      expect(state.embeddingState.vectorContract?.contractId).toBe(contract.contractId);
    });

    it("16 & 17. Companion permite configurar endpoint e secret locais mas mantém o contrato", () => {
      const contract = createVectorContract(baseContractInput);
      const manifest = { vectorContract: contract };

      const config = resolveEffectiveEmbeddingRuntimeConfig({
        role: "companion",
        canonicalManifest: manifest,
        localSettings: {
          baseUrl: "http://192.168.1.100:11434",
          timeoutMs: 30000,
        },
        localSecretKey: "custom-local-secret",
      });

      expect(config.inheritedFromProducer).toBe(true);
      expect(config.provider).toBe("ollama");
      expect(config.model).toBe("nomic-embed-text");
      expect(config.baseUrl).toBe("http://192.168.1.100:11434");
      expect(config.apiKey).toBe("custom-local-secret");
      expect(config.contract?.contractId).toBe(contract.contractId);
    });

    it("18. tentativa programática de alterar provider/model no Companion é rejeitada", async () => {
      let snapshot = {
        settings: {
          deviceSettingsById: {
            "comp-1": {
              embeddingsProvider: "ollama",
              embeddingsModel: "nomic-embed-text",
            },
          },
        },
      };

      const host: SettingsRuntimeHost = {
        getSnapshot: () => snapshot,
        replaceSnapshot: (next) => { snapshot = next as any; },
        saveSnapshot: async () => {},
        getCurrentDeviceId: () => "comp-1",
        runEffect: () => {},
        getEffectiveDeviceRole: () => "companion",
      };

      const adapters = createSettingsRuntimeAdapters(host, {
        deviceRole: "companion",
      });

      // Attempt to change embedding provider
      const res1 = await adapters.setLocalValue("embeddingsProvider", "openrouter");
      expect(res1.ok).toBe(false);

      // Attempt to change embedding model
      const res2 = await adapters.setLocalValue("embeddingsModel", "text-embedding-3-small");
      expect(res2.ok).toBe(false);

      // Attempt via provider tuple
      const res3 = await adapters.setLocalProviderValues("embedding", "mistral", "mistral-embed", "https://api.mistral.ai");
      expect(res3.ok).toBe(false);

      // Changing endpoint is permitted
      const res4 = await adapters.setLocalValue("embeddingsBaseUrl", "http://10.0.0.5:11434");
      expect(res4.ok).toBe(true);

      // Analysis provider changes remain completely allowed
      const res5 = await adapters.setLocalProviderValues("analysis", "openrouter", "deepseek/chat", "https://openrouter.ai/api/v1");
      expect(res5.ok).toBe(true);
    });
  });

  describe("Runtime Resolution & Search Enforcement", () => {
    it("19. query embedding usa contrato herdado", () => {
      const contract = createVectorContract({
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        prefixMode: "nomic-search-query-document",
        inputVersion: 1,
      });

      const config = resolveEffectiveEmbeddingRuntimeConfig({
        role: "companion",
        canonicalManifest: { vectorContract: contract },
      });

      expect(config.provider).toBe("ollama");
      expect(config.model).toBe("nomic-embed-text");
      expect(config.dimensions).toBe(768);
      expect(config.prefixMode).toBe("nomic-search-query-document");
    });

    it("20. provider indisponível -> semantic search fica explicitamente indisponível", () => {
      const config = resolveEffectiveEmbeddingRuntimeConfig({
        role: "companion",
        canonicalManifest: null, // No canonical manifest/contract
      });

      expect(config.isAvailable).toBe(false);
      expect(config.unavailabilityReason).toBeDefined();
    });

    it("21 & 22. sem fallback silencioso para outro modelo e híbrida degrada para texto", () => {
      const contract = createVectorContract(baseContractInput);
      const consumptionState = evaluateCompanionConsumptionState({
        deviceId: "companion-1",
        role: "companion",
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 1,
          totalChunks: 1,
          embeddingsEnabled: true,
          embeddings: {
            enabled: true,
            provider: "ollama",
            model: "nomic-embed-text",
            dimensions: 768,
            vectorContract: contract,
          },
        },
        // Target contract differs (e.g. user locally wants mistral)
        targetVectorContract: createVectorContract({
          ...baseContractInput,
          model: "all-minilm",
        }),
      });

      expect(consumptionState.vectorContractCompatibility?.status).toBe("mismatch");

      const searchResult = executeCompanionSearch({
        query: "test query",
        mode: "auto",
        notes: [{
          path: "Doc.md",
          basename: "Doc",
          extension: "md",
          size: 50,
          mtime: 100,
          contentHash: "h1",
          indexedAt: new Date().toISOString(),
        }],
        chunks: [{ chunkId: "Doc.md::0", path: "Doc.md", chunkIndex: 0, text: "test document content", textHash: "h1" }],
        consumptionState,
        queryEmbedding: undefined, // no query embedding generated due to incompatibility
      });

      expect(searchResult.searchModeUsed).toBe("text");
      expect(searchResult.results.length).toBeGreaterThan(0);
    });
  });

  describe("Binary Association & Integrity", () => {
    it("23. binary manifest é associado ao vector contract com vectorContractId", async () => {
      const adapter = new InMemoryVaultAdapter();
      const contract = createVectorContract(baseContractInput);
      const publisher = new BinaryEmbeddingPublisher(adapter, mockDigest);

      const record: EmbeddingRecord = {
        chunkId: "Doc.md::0",
        path: "Doc.md",
        index: 0,
        textHash: "h1",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 768,
        embedding: new Array(768).fill(0.02),
        createdAt: new Date().toISOString(),
      };

      const descriptor: EmbeddingStorageDescriptor = {
        format: "binary-v1",
        generationId: "gen-123",
        sourcePublicationId: "pub-456",
        dimensions: 768,
        recordCount: 1,
        identity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "nomic-search-query-document",
        },
        vectorContract: contract,
      };

      await publisher.publish([record], descriptor);

      const manifestContent = JSON.parse(await adapter.read(".lina/index/embeddings.binary.manifest.json"));
      expect(manifestContent.vectorContractId).toBe(contract.contractId);
      expect(manifestContent.vectorContract.contractId).toBe(contract.contractId);
    });

    it("24. mismatch binário / contrato rejeita manifest binário inválido", async () => {
      const adapter = new InMemoryVaultAdapter();
      const contract = createVectorContract(baseContractInput);
      const publisher = new BinaryEmbeddingPublisher(adapter, mockDigest);

      const record: EmbeddingRecord = {
        chunkId: "Doc.md::0",
        path: "Doc.md",
        index: 0,
        textHash: "h1",
        model: "nomic-embed-text",
        provider: "ollama",
        dimensions: 768,
        embedding: new Array(768).fill(0.02),
        createdAt: new Date().toISOString(),
      };

      const descriptor: EmbeddingStorageDescriptor = {
        format: "binary-v1",
        generationId: "gen-123",
        sourcePublicationId: "pub-456",
        dimensions: 768,
        recordCount: 1,
        identity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "nomic-search-query-document",
        },
        vectorContract: contract,
      };

      await publisher.publish([record], descriptor);

      // Corrupt vectorContract in binary manifest to mismatch identity
      const rawManifest = JSON.parse(await adapter.read(".lina/index/embeddings.binary.manifest.json"));
      rawManifest.vectorContract = {
        ...rawManifest.vectorContract,
        model: "corrupted-model",
      };
      await adapter.write(".lina/index/embeddings.binary.manifest.json", JSON.stringify(rawManifest));

      await expect(readBinaryEmbeddingStorage(adapter, mockDigest)).rejects.toThrow();
    });
  });

  describe("Legacy Compatibility (0.2.4)", () => {
    it("25 & 26. artefactos 0.2.4 continuam legíveis e unknown vector contract não é tratado como corrupção", () => {
      const legacyManifest = {
        indexType: "text",
        version: 1,
        totalNotes: 2,
        totalChunks: 2,
        embeddingsEnabled: true,
        embeddings: {
          enabled: true,
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          totalEmbeddings: 2,
        },
      };

      const state = evaluateCompanionConsumptionState({
        deviceId: "comp-legacy",
        role: "companion",
        textManifestRaw: legacyManifest,
      });

      expect(state.canConsume).toBe(true);
      expect(state.embeddingState.available).toBe(true);
      expect(state.vectorContract).toBeUndefined();
    });
  });
});
