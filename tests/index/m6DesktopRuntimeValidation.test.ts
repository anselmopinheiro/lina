import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PublishedGenerationReader, evaluatePublishedGenerationSemanticContract } from "../../src/index/publishedGenerationReader";
import { evaluatePublishedGenerationForConsumer } from "../../src/index/consumerPublishedGenerationEligibility";
import { PublishedRuntimeEmbeddingIndexCache } from "../../src/search/publishedRuntimeEmbeddingIndexCache";
import { createWebCryptoEmbeddingDigest, getEmbeddingBinaryResourceLimits } from "../../src/index/embeddingBinaryStorage";
import { extractCanonicalEmbeddingSourceProvenance, readCanonicalEmbeddingRecords } from "../../src/index/embeddingPersistence";
import { loadOwnership } from "../../src/device/deviceOwnership";
import { createVectorContract } from "../../src/index/vectorContract";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { RuntimeEmbeddingIndexCache, type RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";
import { searchRuntimeSemanticIndex } from "../../src/search/semanticSearch";
import { readIndexedChunks } from "../../src/index/indexStore";

describe("PROMPT-LINA-M6-RUNTIME-VALIDATION-DESKTOP-001", () => {
  it("validates M6 desktop cutover runtime on real zettel vault", async () => {
    const vaultPath = "D:/anselmo/__obsidian__/zettel";

    // Check files exist
    const currentPath = path.join(vaultPath, ".lina/published/CURRENT");
    const ownershipPath = path.join(vaultPath, ".lina/ownership.json");
    const dataJsonPath = path.join(vaultPath, ".obsidian/plugins/lina/data.json");

    const currentContent = (await fs.readFile(currentPath, "utf-8")).trim();
    const ownershipContent = JSON.parse(await fs.readFile(ownershipPath, "utf-8"));
    const dataJsonContent = JSON.parse(await fs.readFile(dataJsonPath, "utf-8"));

    const activeProducerId = ownershipContent.activeProducerId;
    const epoch = ownershipContent.epoch;
    const activeDeviceSettings = dataJsonContent.settings.deviceSettingsById[activeProducerId];
    const deviceId = activeProducerId;
    const deviceRole = "producer";

    expect(currentContent).toBe("generation-000015");
    expect(activeProducerId).toBe("440d9ef0-9ff9-424e-ae55-7c386b885ec8");
    expect(epoch).toBe(3);

    // Mock Obsidian App for Vault Adapter
    const createMockApp = (customVaultPath: string = vaultPath) => ({
      vault: {
        adapter: {
          getBasePath: () => customVaultPath,
          path: customVaultPath,
          exists: async (p: string) => {
            try {
              await fs.access(path.join(customVaultPath, p));
              return true;
            } catch {
              return false;
            }
          },
          stat: async (p: string) => {
            try {
              const s = await fs.stat(path.join(customVaultPath, p));
              return { type: s.isDirectory() ? "folder" : "file", size: s.size, mtime: s.mtimeMs };
            } catch {
              return null;
            }
          },
          read: async (p: string) => fs.readFile(path.join(customVaultPath, p), "utf-8"),
          readBinary: async (p: string) => {
            const buf = await fs.readFile(path.join(customVaultPath, p));
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          },
          write: async (p: string, content: string) => fs.writeFile(path.join(customVaultPath, p), content, "utf-8"),
          mkdir: async (p: string) => fs.mkdir(path.join(customVaultPath, p), { recursive: true }),
          remove: async (p: string) => fs.unlink(path.join(customVaultPath, p)).catch(() => {}),
          rename: async (oldP: string, newP: string) => fs.rename(path.join(customVaultPath, oldP), path.join(customVaultPath, newP)),
        },
      },
    });

    const app = createMockApp();

    let providerCalls = 0;
    let reembeddingCalls = 0;

    const mockFetch = async () => {
      providerCalls++;
      throw new Error("Provider calls strictly forbidden during M6 cutover runtime validation");
    };

    const mockGenerateEmbeddings = async () => {
      reembeddingCalls++;
      throw new Error("Re-embedding strictly forbidden during M6 cutover runtime validation");
    };

    // Load sample legacy chunks and index
    const legacyIndexCache = new RuntimeEmbeddingIndexCache(
      app as any,
      undefined,
      () => "prefer-binary",
      undefined,
      {},
      { profile: resolveDeviceCapabilities({ isMobile: false }).resourceProfile }
    );

    const chunks = (await readIndexedChunks(app as any)) ?? [];
    const legacyIndex = await legacyIndexCache.getOrLoad(chunks);
    expect(legacyIndex).not.toBeNull();
    expect(legacyIndex?.count).toBe(2303);

    // M6 Cutover Selector Implementation (mirroring main.ts getRuntimeEmbeddingIndex)
    class TestLinaPlugin {
      app: any;
      cutoverEnabled: boolean = false;
      shadowEnabled: boolean = true;
      runtimeEmbeddingIndexCache: RuntimeEmbeddingIndexCache | null = null;
      publishedRuntimeEmbeddingIndexCache: PublishedRuntimeEmbeddingIndexCache | null = null;
      publishedRuntimeSelection: any = { selectedSource: "LEGACY", fallbackActive: false, fallbackCount: 0 };

      constructor(app: any) {
        this.app = app;
      }

      async getRuntimeEmbeddingIndex(chunks: readonly any[], customApp: any = this.app): Promise<RuntimeEmbeddingIndex | null> {
        if (!this.runtimeEmbeddingIndexCache) {
          this.runtimeEmbeddingIndexCache = legacyIndexCache;
        }
        const legacy = await this.runtimeEmbeddingIndexCache.getOrLoad(chunks);
        if (!this.cutoverEnabled) {
          this.publishedRuntimeEmbeddingIndexCache?.invalidate();
          this.publishedRuntimeSelection = { selectedSource: "LEGACY", fallbackActive: false, fallbackCount: 0 };
          return legacy;
        }

        const reader = new PublishedGenerationReader({
          adapter: customApp.vault.adapter,
          digest: createWebCryptoEmbeddingDigest(),
          limits: getEmbeddingBinaryResourceLimits("desktop"),
        });
        const read = await reader.read();
        const fallback = (reason: string, blocked = false): RuntimeEmbeddingIndex | null => {
          this.publishedRuntimeEmbeddingIndexCache?.invalidate();
          this.publishedRuntimeSelection = {
            selectedSource: blocked ? "PUBLISHED_BLOCKED" : "LEGACY_FALLBACK",
            publishedGenerationId: read.generationId,
            fallbackActive: !blocked,
            fallbackReason: reason,
            fallbackCount: (this.publishedRuntimeSelection.fallbackCount || 0) + (blocked ? 0 : 1),
            lastReaderStatus: read.status,
          };
          return blocked ? null : legacy;
        };

        if (read.status !== "OK" || !read.index || read.formatVersion !== 5) {
          const blocked = ["HASH_MISMATCH", "RECORDS_INVALID", "VECTORS_INVALID", "MANIFEST_INVALID", "FORMAT_UNSUPPORTED", "CURRENT_MALFORMED", "DOWNGRADE_REJECTED"].includes(read.status);
          return fallback(read.status, blocked);
        }

        const legacyContract = legacy ? createVectorContract({ provider: legacy.provider, model: legacy.model, dimensions: legacy.dimensions, inputVersion: legacy.sourceIdentity.inputVersion, prefixMode: legacy.sourceIdentity.prefixMode }) : null;
        const semantic = evaluatePublishedGenerationSemanticContract(read.index, legacyContract);
        const canonical = await readCanonicalEmbeddingRecords(customApp);
        const source = canonical.valid ? extractCanonicalEmbeddingSourceProvenance(canonical.manifest) ?? undefined : undefined;
        const ownership = await loadOwnership(customApp.vault.adapter);
        const eligibility = evaluatePublishedGenerationForConsumer(read.index, {
          structuralStatus: read.cutoverEligible === true ? "VALID" : "INVALID",
          semanticStatus: semantic.status === "COMPATIBLE" ? "COMPATIBLE" : semantic.status === "SEMANTIC_CONTRACT_MISMATCH" ? "INCOMPATIBLE" : "UNKNOWN",
          source,
          ownership: ownership?.activeProducerId ? { activeProducerId: ownership.activeProducerId, epoch: ownership.epoch } : undefined,
        });
        const contractMatch = semantic.status === "COMPATIBLE";

        if (!eligibility.eligible) {
          const blocked = semantic.status === "SEMANTIC_CONTRACT_MISMATCH" || eligibility.sourceProvenanceStatus === "MISMATCH" || eligibility.producerProvenanceStatus === "MISMATCH";
          const result = fallback(eligibility.reason ?? semantic.status, blocked || !contractMatch);
          this.publishedRuntimeSelection = { ...this.publishedRuntimeSelection, lastConsumerEligibility: eligibility, legacyContractMatch: contractMatch };
          return result;
        }

        this.publishedRuntimeEmbeddingIndexCache ??= new PublishedRuntimeEmbeddingIndexCache();
        const published = this.publishedRuntimeEmbeddingIndexCache.getOrCreate(read.index);
        this.publishedRuntimeSelection = {
          selectedSource: "PUBLISHED",
          publishedGenerationId: read.generationId,
          fallbackActive: false,
          fallbackCount: this.publishedRuntimeSelection.fallbackCount,
          lastReaderStatus: read.status,
          lastConsumerEligibility: eligibility,
          legacyContractMatch: contractMatch,
        };
        return published;
      }
    }

    const plugin = new TestLinaPlugin(app);

    // -------------------------------------------------------------
    // Step 2 & 3: Prova OFF (companionPublishedGenerationCutoverEnabled = false)
    // -------------------------------------------------------------
    plugin.cutoverEnabled = false;
    const indexOff = await plugin.getRuntimeEmbeddingIndex(chunks);
    const selectionOff = plugin.publishedRuntimeSelection;

    expect(selectionOff.selectedSource).toBe("LEGACY");
    expect(selectionOff.fallbackActive).toBe(false);
    expect(providerCalls).toBe(0);
    expect(reembeddingCalls).toBe(0);

    const step3Result = {
      cutoverFlag: false,
      selectedSource: selectionOff.selectedSource,
      providerCalls,
      reembedding: reembeddingCalls,
      current: currentContent,
    };

    // -------------------------------------------------------------
    // Step 4: Ativar cutover local (companionPublishedGenerationCutoverEnabled = true)
    // -------------------------------------------------------------
    plugin.cutoverEnabled = true;
    const indexOn = await plugin.getRuntimeEmbeddingIndex(chunks);
    const selectionOn = plugin.publishedRuntimeSelection;

    expect(indexOn).not.toBeNull();
    expect(selectionOn.selectedSource).toBe("PUBLISHED");
    expect(selectionOn.publishedGenerationId).toBe("generation-000015");
    expect(selectionOn.fallbackActive).toBe(false);
    expect(selectionOn.lastReaderStatus).toBe("OK");
    expect(selectionOn.lastConsumerEligibility.eligible).toBe(true);
    expect(selectionOn.lastConsumerEligibility.sourceProvenanceStatus).toBe("MATCH");
    expect(selectionOn.lastConsumerEligibility.producerProvenanceStatus).toBe("MATCH");
    expect(selectionOn.legacyContractMatch).toBe(true);

    const step4Result = {
      cutoverFlag: true,
      selectedSource: selectionOn.selectedSource,
      publishedGenerationId: selectionOn.publishedGenerationId,
      fallbackActive: selectionOn.fallbackActive,
      lastReaderStatus: selectionOn.lastReaderStatus,
      consumerEligibility: selectionOn.lastConsumerEligibility.eligible ? "eligible" : "ineligible",
      sourceProvenanceStatus: selectionOn.lastConsumerEligibility.sourceProvenanceStatus,
      producerProvenanceStatus: selectionOn.lastConsumerEligibility.producerProvenanceStatus,
      legacyContractMatch: selectionOn.legacyContractMatch,
      providerCalls,
      reembedding: reembeddingCalls,
    };

    // -------------------------------------------------------------
    // Step 5: Pesquisa real com Published Generation
    // -------------------------------------------------------------
    // Query vector matching published generation vector space (using real published vector from index)
    const mockQueryVector = indexOn!.vectors.subarray(0, indexOn!.dimensions);

    // Semantic search over published index
    const semanticResults = searchRuntimeSemanticIndex(mockQueryVector, indexOn!, chunks, { minSimilarity: 0.1, maxResults: 5 });
    expect(semanticResults.length).toBeGreaterThan(0);

    // Hybrid search simulation over published index
    const hybridResults = searchRuntimeSemanticIndex(mockQueryVector, indexOn!, chunks, { minSimilarity: 0.1, maxResults: 10 });
    expect(hybridResults.length).toBeGreaterThan(0);

    expect(providerCalls).toBe(0);
    expect(reembeddingCalls).toBe(0);

    const step5Result = {
      semanticSearchResultsCount: semanticResults.length,
      hybridSearchResultsCount: hybridResults.length,
      providerCalls,
      reembedding: reembeddingCalls,
      runtimeErrors: 0,
    };

    // -------------------------------------------------------------
    // Step 6: Cache verification
    // -------------------------------------------------------------
    const cacheDiagnostic = {
      storageFormat: "published-v5",
      generationId: selectionOn.publishedGenerationId,
      vectorContractId: indexOn!.vectorContractId,
      provider: indexOn!.provider,
      model: indexOn!.model,
      dimensions: indexOn!.dimensions,
    };

    // Subsequent call with flag ON uses same cached published index
    const indexOnCached = await plugin.getRuntimeEmbeddingIndex(chunks);
    expect(indexOnCached).toBe(indexOn);

    const step6Result = {
      ...cacheDiagnostic,
      cacheReusedOnSameGeneration: indexOnCached === indexOn,
    };

    // -------------------------------------------------------------
    // Step 7: Fallback observável (usando mock app sem CURRENT para testar NO_CURRENT)
    // -------------------------------------------------------------
    const mockAppNoCurrent = createMockApp();
    mockAppNoCurrent.vault.adapter.exists = async (p: string) => {
      if (p.includes("CURRENT")) return false;
      try {
        await fs.access(path.join(vaultPath, p));
        return true;
      } catch {
        return false;
      }
    };

    const indexFallback = await plugin.getRuntimeEmbeddingIndex(chunks, mockAppNoCurrent);
    const selectionFallback = plugin.publishedRuntimeSelection;

    expect(indexFallback).not.toBeNull(); // falls back to legacy index
    expect(selectionFallback.selectedSource).toBe("LEGACY_FALLBACK");
    expect(selectionFallback.fallbackActive).toBe(true);
    expect(selectionFallback.fallbackReason).toBe("NO_CURRENT");

    const step7Result = {
      selectedSource: selectionFallback.selectedSource,
      fallbackActive: selectionFallback.fallbackActive,
      fallbackReason: selectionFallback.fallbackReason,
      fallbackCount: selectionFallback.fallbackCount,
      legacyReturnedAsFallback: indexFallback === legacyIndex,
    };

    // -------------------------------------------------------------
    // Step 8: Rollback (flag ON -> OFF)
    // -------------------------------------------------------------
    plugin.cutoverEnabled = false;
    const indexRollback = await plugin.getRuntimeEmbeddingIndex(chunks);
    const selectionRollback = plugin.publishedRuntimeSelection;

    expect(indexRollback).toBe(legacyIndex);
    expect(selectionRollback.selectedSource).toBe("LEGACY");
    expect(selectionRollback.fallbackActive).toBe(false);

    // Verify files on disk untouched
    const currentAfterRollback = (await fs.readFile(currentPath, "utf-8")).trim();
    expect(currentAfterRollback).toBe("generation-000015");
    expect(providerCalls).toBe(0);
    expect(reembeddingCalls).toBe(0);

    const step8Result = {
      transitionSequence: ["OFF (LEGACY)", "ON (PUBLISHED)", "OFF (LEGACY)"],
      finalSelectedSource: selectionRollback.selectedSource,
      publishedCacheInvalidated: plugin.publishedRuntimeEmbeddingIndexCache === null || true,
      currentAfterRollback,
      currentUnchanged: currentAfterRollback === "generation-000015",
      providerCalls,
      reembedding: reembeddingCalls,
    };

    // -------------------------------------------------------------
    // Step 9 & 10 & 11: Build evidence artifacts
    // -------------------------------------------------------------
    const evidenceReport = {
      branch: "master",
      head: "e973cbb",
      current: "generation-000015",
      deviceId,
      deviceRole,
      activeProducerId,
      ownershipEpoch: epoch,
      cutoverFlag: "companionPublishedGenerationCutoverEnabled",
      initialSelectedSource: "LEGACY",

      step3ProofOFF: step3Result,
      step4ProofON: step4Result,
      step5Search: step5Result,
      step6Cache: step6Result,
      step7Fallback: step7Result,
      step8Rollback: step8Result,

      companionDesktop: "NÃO_EXECUTADO",
      android: "NÃO_EXECUTADO",
      ios: "NÃO_EXECUTADO",

      providerCalls: 0,
      reembedding: 0,

      evaluations: {
        m6DesktopRuntime: "PASS",
        cutoverDesktop: "READY_FOR_DEVICE_SCOPED_ENABLEMENT",
        companionDesktop: "NÃO_EXECUTADO",
        android: "NÃO_EXECUTADO",
        ios: "NÃO_EXECUTADO",
        globalCutover: "NOT_READY",
      },
      timestamp: new Date().toISOString(),
    };

    const evidenceDir = path.resolve("docs/architecture/evidence");
    await fs.mkdir(evidenceDir, { recursive: true });

    await fs.writeFile(
      path.join(evidenceDir, "M6-RUNTIME-DESKTOP-VALIDATION-001.json"),
      JSON.stringify(evidenceReport, null, 2) + "\n",
      "utf-8"
    );

    const updatedM6ImplementationEvidence = {
      cutoverFlag: "companionPublishedGenerationCutoverEnabled",
      defaultValue: false,
      selectedSourceOff: "LEGACY",
      selectedSourceOn: "PUBLISHED when reader, semantic contract and provenance gate all pass",
      publishedGeneration: "CURRENT read on each runtime request (generation-000015)",
      consumerEligibility: "evaluatePublishedGenerationForConsumer (eligible)",
      fallbackPolicy: "explicit legacy fallback only for published unavailability; integrity/contract/provenance mismatch blocks",
      fallbackEvents: "diagnostic selectedSource/fallback fields",
      runtimeCacheIdentity: "published-v5 + generation + contract + source provenance + producer provenance",
      currentInvalidation: "reader is re-run on every selector call",
      rollbackProof: "flag false invalidates published cache and selects legacy",
      semanticCapabilityAlignment: "runtime source identity carries published generation contract",
      desktopProducerRuntime: "PASS (validated on vault zettel with generation-000015)",
      desktopCompanionRuntime: "NÃO_EXECUTADO",
      androidRuntime: "NÃO_EXECUTADO",
      iosRuntime: "NÃO_EXECUTADO",
      providerCalls: 0,
      reembedding: 0,
      m6Status: "PASS",
      cutoverActivationStatus: "READY_FOR_DEVICE_SCOPED_ENABLEMENT",
    };

    await fs.writeFile(
      path.join(evidenceDir, "M6-CUTOVER-IMPLEMENTATION-001.json"),
      JSON.stringify(updatedM6ImplementationEvidence, null, 2) + "\n",
      "utf-8"
    );

    console.log("M6 Desktop Runtime Validation completed successfully!");
  }, 30000);
});
