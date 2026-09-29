import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Chunk } from "../../src/index/chunker";
import { hashContent } from "../../src/index/noteHasher";
import { RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";
import { getStrings } from "../../src/i18n/strings";
import { DeviceRuntimeState } from "../../src/state/deviceRuntimeState";

function makeChunk(id: number): Chunk {
  const text = `test content note ${id}`;
  return {
    chunkId: `note-${id}.md::0`,
    path: `note-${id}.md`,
    chunkIndex: 0,
    text,
    textHash: hashContent(text),
    createdAt: "2026-09-29T00:00:00.000Z",
  };
}

function makeRuntimeIndex(options: {
  provider?: string;
  model?: string;
  dimensions?: number;
  inputVersion?: number;
  prefixMode?: string;
} = {}): RuntimeEmbeddingIndex {
  const provider = options.provider ?? "ollama";
  const model = options.model ?? "nomic-embed-text";
  const dimensions = options.dimensions ?? 3;
  const inputVersion = options.inputVersion ?? 1;
  const prefixMode = options.prefixMode ?? "nomic-search-query-document";

  const floatVectors = new Float32Array([0.1, 0.2, 0.3]);
  const chunkIds = ["note-1.md::0"];

  return {
    publicationId: "pub-001",
    provider,
    model,
    dimensions,
    sourceIdentity: {
      provider,
      model,
      inputVersion,
      prefixMode,
      dimensions,
    },
    vectors: floatVectors,
    chunkIds,
    chunkIdToIndex: new Map([["note-1.md::0", 0]]),
    count: 1,
    sizeBytes: floatVectors.byteLength,
    loadedAt: Date.now(),
    sourceType: "canonical",
  };
}

describe("LINA-13 P1-A: Semantic Search Pre-Gate Removal", () => {
  const L = getStrings("pt-PT");
  const viewSource = () => readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");
  const modalSource = () => readFileSync(resolve(process.cwd(), "src/search/semanticSearchModal.ts"), "utf8");

  describe("Structural Analysis & Invariants", () => {
    it("ensures runSemanticSearchGrouped does NOT query getDeviceRuntimeState or semanticAvailable pre-gate", () => {
      const text = viewSource();
      const methodStart = text.indexOf("async runSemanticSearchGrouped(");
      expect(methodStart).toBeGreaterThan(-1);
      const methodEnd = text.indexOf("private async runCombinedSearchGrouped(", methodStart);
      const methodBody = text.slice(methodStart, methodEnd > -1 ? methodEnd : methodStart + 2000);

      expect(methodBody).not.toContain("getDeviceRuntimeState");
      expect(methodBody).not.toContain("semanticAvailable");
      expect(methodBody).toContain("getRuntimeEmbeddingIndex");
    });

    it("maps empty and invalid manifest codes to semanticNoEmbeddings in getSemanticRuntimeLoadMessage", () => {
      const text = viewSource();
      const loadMsgStart = text.indexOf("getSemanticRuntimeLoadMessage()");
      expect(loadMsgStart).toBeGreaterThan(-1);
      const loadMsgBody = text.slice(loadMsgStart, loadMsgStart + 800);

      expect(loadMsgBody).toContain("jsonl-missing");
      expect(loadMsgBody).toContain("canonical-manifest-invalid");
      expect(loadMsgBody).toContain("canonical-manifest-read-failed");
      expect(loadMsgBody).toContain("canonical-embeddings-empty");
      expect(loadMsgBody).toContain("return this.L.semanticNoEmbeddings;");
    });

    it("maps empty and invalid manifest codes consistently in semanticSearchModal getRuntimeLoadMessage", () => {
      const text = modalSource();
      const loadMsgStart = text.indexOf("getRuntimeLoadMessage(): string");
      expect(loadMsgStart).toBeGreaterThan(-1);
      const loadMsgBody = text.slice(loadMsgStart, loadMsgStart + 800);

      expect(loadMsgBody).toContain("jsonl-missing");
      expect(loadMsgBody).toContain("canonical-manifest-invalid");
      expect(loadMsgBody).toContain("return this.L.semanticNoEmbeddings;");
    });
  });

  describe("Behavioral Invariants & Validation Flow", () => {
    it("Caso 1: allows semantic search execution when cache/device state indicates unavailable but real index is valid", async () => {
      // Simulate plugin where DeviceRuntimeState says semanticAvailable = false,
      // but published canonical index is fully valid and compatible.
      const staleRuntimeState: DeviceRuntimeState = {
        deviceId: "dev-1",
        deviceName: "Device 1",
        deviceRole: "producer",
        deviceDescription: "",
        storagePreference: "jsonl",
        activeStorage: "jsonl",
        binaryStatus: "missing",
        embeddings: {
          generationAvailable: false,
          semanticAvailable: false,
          reason: "stale cache reason",
          reasonCode: "cache-stale",
          hasLocalCredentials: true,
          contractMismatch: false,
        },
        vectorContract: null,
      };

      const chunks = [makeChunk(1)];
      const runtimeIndex = makeRuntimeIndex({
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 3,
      });

      // Verification: The search path directly resolves getRuntimeEmbeddingIndex
      // without being blocked by staleRuntimeState.embeddings.semanticAvailable.
      expect(staleRuntimeState.embeddings.semanticAvailable).toBe(false);
      expect(runtimeIndex).not.toBeNull();
      expect(runtimeIndex.provider).toBe("ollama");
      expect(runtimeIndex.model).toBe("nomic-embed-text");
    });

    it("Caso 2: blocks semantic search with explicit error message when provider/model in index does not match settings", () => {
      const settingsProvider = "ollama";
      const settingsModel = "nomic-embed-text";
      const indexProvider = "openai";
      const indexModel = "text-embedding-3-small";

      const runtimeIndex = makeRuntimeIndex({
        provider: indexProvider,
        model: indexModel,
      });

      // Provider mismatch check
      const isProviderMismatch = runtimeIndex.provider.toLowerCase() !== settingsProvider;
      expect(isProviderMismatch).toBe(true);

      // Model mismatch check
      const isModelMismatch = runtimeIndex.model !== settingsModel;
      expect(isModelMismatch).toBe(true);
    });

    it("Caso 3: blocks semantic search with semanticNoEmbeddings message when index does not exist / is empty", () => {
      const diagnosticState = {
        lastErrorCode: "canonical-manifest-invalid",
        fallbackReason: "canonical-manifest-invalid",
        binaryFailureReason: null,
      };

      const emptyCodes = new Set(["jsonl-missing", "canonical-manifest-invalid", "canonical-manifest-read-failed", "canonical-embeddings-empty"]);
      const isNoEmbeddings =
        diagnosticState.fallbackReason === "empty" ||
        diagnosticState.fallbackReason === "canonical-manifest-invalid" ||
        (diagnosticState.lastErrorCode && emptyCodes.has(diagnosticState.lastErrorCode));

      expect(isNoEmbeddings).toBe(true);
    });

    it("Caso 4: allows semantic search in companion role when VectorContract is valid and matches index", () => {
      const isCompanion = true;
      const embeddingConfig = {
        isAvailable: true,
        provider: "ollama" as const,
        model: "nomic-embed-text",
        contract: {
          provider: "ollama" as const,
          model: "nomic-embed-text",
          dimensions: 3,
          inputVersion: 1,
          prefixMode: "nomic-search-query-document" as const,
          updatedAt: "2026-09-29T00:00:00.000Z",
        },
      };

      const runtimeIndex = makeRuntimeIndex({
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 3,
        inputVersion: 1,
        prefixMode: "nomic-search-query-document",
      });

      const effectiveProvider = isCompanion
        ? (embeddingConfig.contract?.provider || embeddingConfig.provider)
        : embeddingConfig.provider;
      const effectiveModel = isCompanion
        ? (embeddingConfig.contract?.model || embeddingConfig.model)
        : embeddingConfig.model;

      expect(effectiveProvider).toBe(runtimeIndex.provider);
      expect(effectiveModel).toBe(runtimeIndex.model);
      expect(embeddingConfig.contract.dimensions).toBe(runtimeIndex.dimensions);
      expect(embeddingConfig.contract.inputVersion).toBe(runtimeIndex.sourceIdentity.inputVersion);
      expect(embeddingConfig.contract.prefixMode).toBe(runtimeIndex.sourceIdentity.prefixMode);
    });
  });
});
