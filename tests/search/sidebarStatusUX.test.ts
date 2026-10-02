import { buildSidebarVmForScenario } from "../helpers/sidebarScenarioSnapshot";
import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  buildSidebarStatusViewModel,
  formatRelativeTime,
  type BuildSidebarStatusViewModelInput,
} from "../../src/search/sidebarStatusViewModel";
import { CompanionArtifactConsumptionState } from "../../src/companion/companionConsumptionState";
import { DEFAULT_AGING_THRESHOLD_MS, DEFAULT_STALE_THRESHOLD_MS } from "../../src/device/producerState";

describe("Sidebar Status & UX (LINA-03-UX)", () => {
  const stringsPt = getStrings("pt-PT");
  const stringsEn = getStrings("en");

  const baseNow = new Date("2026-09-05T12:00:00.000Z").getTime();

  function createBaseInput(overrides: Partial<BuildSidebarStatusViewModelInput> = {}): BuildSidebarStatusViewModelInput {
    return {
      deviceId: "device-producer-1",
      deviceRole: "producer",
      isAuthorizedProducer: true,
      isStandbyProducer: false,
      textIndexReady: true,
      textIndexUsability: "usable",
      textIndexUpdatedAt: new Date(baseNow - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      embeddingsEnabled: true,
      embeddingsReady: true,
      embeddingsUpdatedAt: new Date(baseNow - 2 * 60 * 60 * 1000).toISOString(),
      semanticAvailable: true,
      semanticPreparing: false,
      currentSearchMode: "textual",
      strings: stringsPt,
      currentTime: baseNow,
      ...overrides,
    };
  }

  // 1. Active Producer shows correct role
  it("1. Active Producer shows correct role in pt-PT and en", () => {
    const vmPt = buildSidebarVmForScenario(createBaseInput({ isAuthorizedProducer: true, strings: stringsPt }));
    expect(vmPt.role.roleKey).toBe("active-producer");
    expect(vmPt.role.title).toBe("Produtor ativo");
    expect(vmPt.role.description).toBe("Mantém o índice e os embeddings");
    expect(vmPt.role.tone).toBe("accent");

    const vmEn = buildSidebarVmForScenario(createBaseInput({ isAuthorizedProducer: true, strings: stringsEn }));
    expect(vmEn.role.roleKey).toBe("active-producer");
    expect(vmEn.role.title).toBe("Active Producer");
    expect(vmEn.role.description).toBe("Maintains search index and embeddings");
  });

  // 2. Standby Producer shows correct role
  it("2. Standby Producer shows correct role in pt-PT and en", () => {
    const vmPt = buildSidebarVmForScenario(createBaseInput({
      deviceRole: "producer",
      isAuthorizedProducer: false,
      isStandbyProducer: true,
      strings: stringsPt,
    }));
    expect(vmPt.role.roleKey).toBe("standby-producer");
    expect(vmPt.role.title).toBe("Produtor em espera");
    expect(vmPt.role.description).toBe("Outro dispositivo é o Produtor ativo");
    expect(vmPt.role.tone).toBe("neutral");

    const vmEn = buildSidebarVmForScenario(createBaseInput({
      deviceRole: "producer",
      isAuthorizedProducer: false,
      isStandbyProducer: true,
      strings: stringsEn,
    }));
    expect(vmEn.role.roleKey).toBe("standby-producer");
    expect(vmEn.role.title).toBe("Standby Producer");
    expect(vmEn.role.description).toBe("Another device is the active Producer");
  });

  // 3. Companion shows correct role
  it("3. Companion shows correct role in pt-PT and en", () => {
    const vmPt = buildSidebarVmForScenario(createBaseInput({
      deviceRole: "companion",
      isAuthorizedProducer: false,
      isStandbyProducer: false,
      strings: stringsPt,
    }));
    expect(vmPt.role.roleKey).toBe("companion");
    expect(vmPt.role.title).toBe("Companion");
    expect(vmPt.role.description).toBe("Usa os artefactos produzidos noutro dispositivo");
    expect(vmPt.role.tone).toBe("muted");

    const vmEn = buildSidebarVmForScenario(createBaseInput({
      deviceRole: "companion",
      isAuthorizedProducer: false,
      isStandbyProducer: false,
      strings: stringsEn,
    }));
    expect(vmEn.role.roleKey).toBe("companion");
    expect(vmEn.role.title).toBe("Companion");
    expect(vmEn.role.description).toBe("Uses artifacts produced on another device");
  });

  // 4. Active Producer sees maintenance actions
  it("4. Active Producer sees maintenance actions as executable", () => {
    const vm = buildSidebarVmForScenario(createBaseInput({ isAuthorizedProducer: true }));
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
    expect(vm.maintenance.isCompanion).toBe(false);
    expect(vm.maintenance.isStandby).toBe(false);
    expect(vm.maintenance.gatingNotice).toBeUndefined();
  });

  // 5. Companion does not see Producer actions as executable
  it("5. Companion does not see Producer actions as executable", () => {
    const vm = buildSidebarVmForScenario(createBaseInput({
      deviceRole: "companion",
      isAuthorizedProducer: false,
      isStandbyProducer: false,
      strings: stringsPt,
    }));
    expect(vm.maintenance.canExecuteMaintenance).toBe(false);
    expect(vm.maintenance.isCompanion).toBe(true);
    expect(vm.maintenance.gatingNotice).toBe("Mantido pelo Produtor ativo");
  });

  // 6. Standby does not see Producer actions as executable
  it("6. Standby does not see Producer actions as executable", () => {
    const vm = buildSidebarVmForScenario(createBaseInput({
      deviceRole: "producer",
      isAuthorizedProducer: false,
      isStandbyProducer: true,
      strings: stringsPt,
    }));
    expect(vm.maintenance.canExecuteMaintenance).toBe(false);
    expect(vm.maintenance.isStandby).toBe(true);
    expect(vm.maintenance.gatingNotice).toBe("Manutenção disponível apenas no Produtor ativo");
  });

  // 7. Freshness fresh
  it("7. Freshness fresh within aging window (< 24h)", () => {
    const twoHoursAgo = new Date(baseNow - 2 * 60 * 60 * 1000).toISOString();
    const vm = buildSidebarVmForScenario(createBaseInput({
      textIndexUpdatedAt: twoHoursAgo,
      embeddingsUpdatedAt: twoHoursAgo,
      strings: stringsPt,
    }));
    expect(vm.freshness.textIndex.status).toBe("fresh");
    expect(vm.freshness.textIndex.humanText).toBe("Atualizado (há 2 h)");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.freshness.embeddings.humanText).toBe("Atualizado (há 2 h)");

    const vmEn = buildSidebarVmForScenario(createBaseInput({
      textIndexUpdatedAt: twoHoursAgo,
      embeddingsUpdatedAt: twoHoursAgo,
      strings: stringsEn,
    }));
    expect(vmEn.freshness.textIndex.humanText).toBe("Up to date (2 h ago)");
  });

  // 8. Freshness aging
  it("8. Freshness aging between 24h and 48h", () => {
    const thirtyHoursAgo = new Date(baseNow - 30 * 60 * 60 * 1000).toISOString();
    const vm = buildSidebarVmForScenario(createBaseInput({
      textIndexUpdatedAt: thirtyHoursAgo,
      embeddingsUpdatedAt: thirtyHoursAgo,
      strings: stringsPt,
    }));
    expect(vm.freshness.textIndex.status).toBe("aging");
    expect(vm.freshness.textIndex.humanText).toBe("A atualizar em breve (há 1 dia)");
  });

  // 9. Freshness stale
  it("9. Freshness stale beyond 48h", () => {
    const threeDaysAgo = new Date(baseNow - 72 * 60 * 60 * 1000).toISOString();
    const vm = buildSidebarVmForScenario(createBaseInput({
      textIndexUpdatedAt: threeDaysAgo,
      embeddingsUpdatedAt: threeDaysAgo,
      strings: stringsPt,
    }));
    expect(vm.freshness.textIndex.status).toBe("stale");
    expect(vm.freshness.textIndex.humanText).toBe("Desatualizado (há 3 dias)");
  });

  // 10. Freshness unknown
  it("10. Freshness unknown when timestamp is missing or unparseable", () => {
    const vm = buildSidebarVmForScenario(createBaseInput({
      textIndexReady: false,
      textIndexUpdatedAt: null,
      embeddingsReady: false,
      embeddingsUpdatedAt: "invalid-date",
      strings: stringsPt,
    }));
    expect(vm.freshness.textIndex.status).toBe("missing");
    expect(vm.freshness.embeddings.status).toBe("unknown");
    expect(vm.freshness.embeddings.humanText).toBe("Estado desconhecido");
  });

  // 11. Semantic available
  it("11. Semantic available produces positive operational headline", () => {
    const vmSemantic = buildSidebarVmForScenario(createBaseInput({
      currentSearchMode: "semantica",
      semanticAvailable: true,
      strings: stringsPt,
    }));
    expect(vmSemantic.searchAvailability.semanticAvailable).toBe(true);
    expect(vmSemantic.searchAvailability.currentModeHeadline).toBe("Pesquisa semântica disponível");
    expect(vmSemantic.searchAvailability.tone).toBe("success");

    const vmHybrid = buildSidebarVmForScenario(createBaseInput({
      currentSearchMode: "hibrida",
      semanticAvailable: true,
      strings: stringsPt,
    }));
    expect(vmHybrid.searchAvailability.hybridMode).toBe("full");
    expect(vmHybrid.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida disponível");
    expect(vmHybrid.searchAvailability.tone).toBe("success");
  });

  // 12. Semantic unavailable
  it("12. Semantic unavailable produces human-friendly notice and degraded alert in semantic mode", () => {
    const vm = buildSidebarVmForScenario(createBaseInput({
      currentSearchMode: "semantica",
      semanticAvailable: false,
      semanticReason: "Model not found on Ollama server",
      strings: stringsPt,
    }));
    expect(vm.searchAvailability.semanticAvailable).toBe(false);
    expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa semântica indisponível");
    expect(vm.degradedAlert).toBeDefined();
    expect(vm.degradedAlert?.kind).toBe("semantic-unavailable");
    expect(vm.degradedAlert?.message).toBe("Pesquisa semântica indisponível neste dispositivo.");
    expect(vm.degradedAlert?.detail).toBe("Model not found on Ollama server");
  });

  // 13. Hybrid text-only fallback
  it("13. Hybrid mode falls back cleanly to text-only mode when semantic is unavailable", () => {
    const vm = buildSidebarVmForScenario(createBaseInput({
      currentSearchMode: "hibrida",
      textIndexReady: true,
      semanticAvailable: false,
      strings: stringsPt,
    }));
    expect(vm.searchAvailability.hybridMode).toBe("text-only");
    expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida em modo textual");
    expect(vm.degradedAlert?.kind).toBe("semantic-unavailable");
  });

  // 14. Generation mismatch produces sync/integrity message
  it("14. Generation mismatch produces sync/integrity degraded message", () => {
    const mockCompanionState: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "digest-mismatch",
      canConsume: false,
    };
    const vm = buildSidebarVmForScenario(createBaseInput({
      companionState: mockCompanionState as CompanionArtifactConsumptionState,
      strings: stringsPt,
    }));
    expect(vm.degradedAlert).toBeDefined();
    expect(vm.degradedAlert?.kind).toBe("generation-integrity");
    expect(vm.degradedAlert?.level).toBe("error");
    expect(vm.degradedAlert?.message).toBe("Os ficheiros sincronizados ainda não estão consistentes. A aguardar nova sincronização.");
  });

  // 15. Policy mismatch produces adequate message
  it("15. Policy mismatch produces adequate degraded message", () => {
    const mockCompanionState: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "verified",
      policyCompatibility: {
        status: "mismatch",
        activeHash: "h1",
        artifactHash: "h2",
      },
    };
    const vm = buildSidebarVmForScenario(createBaseInput({
      companionState: mockCompanionState as CompanionArtifactConsumptionState,
      strings: stringsPt,
    }));
    expect(vm.degradedAlert).toBeDefined();
    expect(vm.degradedAlert?.kind).toBe("policy-mismatch");
    expect(vm.degradedAlert?.level).toBe("warning");
    expect(vm.degradedAlert?.message).toBe("As regras de exclusão foram atualizadas. A aguardar atualização dos artefactos.");
  });

  // 16. Vector mismatch produces adequate message
  it("16. Vector mismatch produces adequate degraded message", () => {
    const mockCompanionState: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "verified",
      policyCompatibility: { status: "compatible", activeHash: "h1", artifactHash: "h1" },
      vectorContractCompatibility: {
        status: "mismatch",
        reason: "model-mismatch",
      },
    };
    const vm = buildSidebarVmForScenario(createBaseInput({
      companionState: mockCompanionState as CompanionArtifactConsumptionState,
      strings: stringsPt,
    }));
    expect(vm.degradedAlert).toBeDefined();
    expect(vm.degradedAlert?.kind).toBe("vector-mismatch");
    expect(vm.degradedAlert?.level).toBe("warning");
    expect(vm.degradedAlert?.message).toBe("Os embeddings não são compatíveis com a configuração atual.");
  });

  // 17. Priority avoids multiple concurrent warnings
  it("17. Prioritized message ordering ensures exactly one top-priority degraded alert is emitted", () => {
    // When both generation-integrity AND policy-mismatch AND vector-mismatch AND producer-stale exist
    const mockCompanionState: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "digest-mismatch",
      policyCompatibility: { status: "mismatch", activeHash: "h1", artifactHash: "h2" },
      vectorContractCompatibility: { status: "mismatch", reason: "model-mismatch" },
      producerFreshness: "stale",
    };
    const vm = buildSidebarVmForScenario(createBaseInput({
      companionState: mockCompanionState as CompanionArtifactConsumptionState,
      currentSearchMode: "semantica",
      semanticAvailable: false,
      strings: stringsPt,
    }));
    // Generation integrity must win top priority (error level)
    expect(vm.degradedAlert?.kind).toBe("generation-integrity");
    expect(vm.degradedAlert?.level).toBe("error");

    // When integrity is verified, policy mismatch wins over vector mismatch & stale
    const mockPolicyWin: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "verified",
      policyCompatibility: { status: "mismatch", activeHash: "h1", artifactHash: "h2" },
      vectorContractCompatibility: { status: "mismatch", reason: "model-mismatch" },
      producerFreshness: "stale",
    };
    const vmPolicy = buildSidebarVmForScenario(createBaseInput({
      companionState: mockPolicyWin as CompanionArtifactConsumptionState,
      strings: stringsPt,
    }));
    expect(vmPolicy.degradedAlert?.kind).toBe("policy-mismatch");

    // When policy is compatible, vector mismatch wins over producer-stale
    const mockVectorWin: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "verified",
      policyCompatibility: { status: "compatible", activeHash: "h1", artifactHash: "h1" },
      vectorContractCompatibility: { status: "mismatch", reason: "model-mismatch" },
      producerFreshness: "stale",
    };
    const vmVector = buildSidebarVmForScenario(createBaseInput({
      companionState: mockVectorWin as CompanionArtifactConsumptionState,
      strings: stringsPt,
    }));
    expect(vmVector.degradedAlert?.kind).toBe("vector-mismatch");

    // When vector is compatible, producer-stale wins
    const mockStaleWin: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "verified",
      policyCompatibility: { status: "compatible", activeHash: "h1", artifactHash: "h1" },
      vectorContractCompatibility: { status: "compatible" },
      producerFreshness: "stale",
    };
    const vmStale = buildSidebarVmForScenario(createBaseInput({
      companionState: mockStaleWin as CompanionArtifactConsumptionState,
      strings: stringsPt,
    }));
    expect(vmStale.degradedAlert?.kind).toBe("producer-stale");
    expect(vmStale.degradedAlert?.message).toBe("O Produtor não atualiza os artefactos há mais de 48 h.");
  });

  // 18. Absence of Producer State does not crash UI
  it("18. Absence of Producer State handles gracefully with no crash", () => {
    expect(() => {
      const vm = buildSidebarVmForScenario(createBaseInput({
        companionState: null,
        textIndexUpdatedAt: null,
        embeddingsUpdatedAt: null,
        strings: stringsPt,
      }));
      expect(vm.role.roleKey).toBe("active-producer");
      expect(vm.freshness.textIndex.status).toBe("fresh");
      expect(vm.freshness.embeddings.status).toBe("fresh");
      expect(vm.degradedAlert).toBeUndefined();
    }).not.toThrow();
  });

  // 19. Legacy artifacts do not produce false critical error
  it("19. Legacy artifacts without provenance/digest do not produce false critical error", () => {
    const mockLegacyCompanionState: Partial<CompanionArtifactConsumptionState> = {
      generationIntegrity: "missing",
      artifactAvailability: {
        textIndex: "available",
        embeddings: "available",
        binaryCopy: "missing",
      },
      canConsume: true,
      consumptionMode: "full",
      embeddingState: {
        available: true,
        hasBinaryAcceleration: false,
      },
    };
    const vm = buildSidebarVmForScenario(createBaseInput({
      companionState: mockLegacyCompanionState as CompanionArtifactConsumptionState,
      textIndexReady: true,
      semanticAvailable: true,
      strings: stringsPt,
    }));
    expect(vm.degradedAlert).toBeUndefined();
    expect(vm.searchAvailability.textAvailable).toBe(true);
    expect(vm.searchAvailability.semanticAvailable).toBe(true);
  });

  // 20. Strings pass through i18n
  it("20. All sidebar status string keys are translated in both pt-PT and en", () => {
    const requiredKeys = [
      "sidebarRoleActiveProducerTitle",
      "sidebarRoleActiveProducerDesc",
      "sidebarRoleStandbyProducerTitle",
      "sidebarRoleStandbyProducerDesc",
      "sidebarRoleCompanionTitle",
      "sidebarRoleCompanionDesc",
      "sidebarFreshnessFresh",
      "sidebarFreshnessAging",
      "sidebarFreshnessStale",
      "sidebarFreshnessUpdateRequired",
      "sidebarFreshnessUnknown",
      "sidebarFreshnessMissing",
      "sidebarFreshnessDisabled",
      "sidebarFreshnessTextIndexLabel",
      "sidebarFreshnessEmbeddingsLabel",
      "sidebarFreshnessAgoPrefix",
      "sidebarFreshnessAgoSuffix",
      "sidebarFreshnessMinutes",
      "sidebarFreshnessHours",
      "sidebarFreshnessDays",
      "sidebarFreshnessDay",
      "sidebarFreshnessJustNow",
      "sidebarSearchTextAvailable",
      "sidebarSearchTextUnavailable",
      "sidebarSearchSemanticAvailable",
      "sidebarSearchSemanticUnavailable",
      "sidebarSearchHybridFull",
      "sidebarSearchHybridTextOnly",
      "sidebarSearchSemanticUnavailableOnDevice",
      "sidebarSearchModelUnavailableLocally",
      "sidebarMaintenanceManagedByActiveProducer",
      "sidebarMaintenanceStandbyNotice",
      "sidebarDegradedGenerationIntegrity",
      "sidebarDegradedPolicyMismatch",
      "sidebarDegradedVectorMismatch",
      "sidebarDegradedProducerStale",
      "sidebarDegradedProducerAging",
    ] as const;

    for (const key of requiredKeys) {
      expect(typeof stringsPt[key]).toBe("string");
      expect(typeof stringsEn[key]).toBe("string");
      if (key !== "sidebarFreshnessAgoPrefix" && key !== "sidebarFreshnessAgoSuffix") {
        expect(stringsPt[key].trim().length).toBeGreaterThan(0);
        expect(stringsEn[key].trim().length).toBeGreaterThan(0);
      }
    }
  });

  // Relative time helper tests
  it("formats relative time correctly", () => {
    expect(formatRelativeTime(null, baseNow, stringsPt)).toBe("");
    expect(formatRelativeTime("invalid", baseNow, stringsPt)).toBe("");
    expect(formatRelativeTime(new Date(baseNow - 30 * 1000).toISOString(), baseNow, stringsPt)).toBe("agora mesmo");
    expect(formatRelativeTime(new Date(baseNow - 5 * 60 * 1000).toISOString(), baseNow, stringsPt)).toBe("há 5 min");
    expect(formatRelativeTime(new Date(baseNow - 5 * 60 * 1000).toISOString(), baseNow, stringsEn)).toBe("5 min ago");
    expect(formatRelativeTime(new Date(baseNow - 3 * 60 * 60 * 1000).toISOString(), baseNow, stringsPt)).toBe("há 3 h");
    expect(formatRelativeTime(new Date(baseNow - 3 * 60 * 60 * 1000).toISOString(), baseNow, stringsEn)).toBe("3 h ago");
    expect(formatRelativeTime(new Date(baseNow - 24 * 60 * 60 * 1000).toISOString(), baseNow, stringsPt)).toBe("há 1 dia");
    expect(formatRelativeTime(new Date(baseNow - 24 * 60 * 60 * 1000).toISOString(), baseNow, stringsEn)).toBe("1 day ago");
    expect(formatRelativeTime(new Date(baseNow - 4 * 24 * 60 * 60 * 1000).toISOString(), baseNow, stringsPt)).toBe("há 4 dias");
    expect(formatRelativeTime(new Date(baseNow - 4 * 24 * 60 * 60 * 1000).toISOString(), baseNow, stringsEn)).toBe("4 days ago");
  });

  describe("LINA-08: Canonical Priority & Semantic Status Presentation", () => {
    it("Cenário 1: prior epoch provenance with valid embeddings never produces 'Estado desconhecido'", () => {
      const vm = buildSidebarVmForScenario(createBaseInput({
        currentSearchMode: "hibrida",
        semanticAvailable: true,
        embeddingsChecking: true, // sensor in transient/dirty state
        companionState: {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          deviceId: "device-producer-1",
          canConsume: true,
          consumptionMode: "full",
          embeddingFreshness: "unknown", // no producer heartbeat in vault
          provenanceValidity: "stale", // published in epoch 1 vs active epoch 3
          artifactFreshness: "fresh",
          artifactAvailability: { textIndex: "available", embeddings: "available", binaryCopy: "missing" },
          embeddingState: { available: true },
        } as unknown as CompanionArtifactConsumptionState,
        runtimeEmbeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: true,
          exists: true,
          vectorFileState: "available",
          provenance: { epoch: 1, producerId: "old-producer", stale: true },
          compatibility: { compatible: true, provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
          contractState: "compatible",
          readiness: { loaded: true, runtimeReady: true },
          runtimeState: "ready",
          semanticAvailable: true,
          effectiveMode: "full",
        },
      }));

      // Invariant: semanticAvailable === true MUST NOT show "Estado desconhecido" or "missing"
      expect(vm.searchAvailability.semanticAvailable).toBe(true);
      expect(vm.searchAvailability.hybridMode).toBe("full");
      expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida disponível");
      expect(vm.freshness.embeddings.status).not.toBe("unknown");
      expect(vm.freshness.embeddings.humanText).not.toBe("Estado desconhecido");
      expect(vm.freshness.embeddings.humanText).not.toBe("A verificar...");
    });

    it("Cenário 3: contract mismatch degrades to text-only mode with clear status", () => {
      const vm = buildSidebarVmForScenario(createBaseInput({
        currentSearchMode: "hibrida",
        semanticAvailable: false,
        runtimeEmbeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: true,
          exists: true,
          vectorFileState: "available",
          provenance: { epoch: 3, producerId: "device-producer-1", stale: false },
          compatibility: { compatible: false, provider: "ollama", model: "different-model", dimensions: 1536 },
          contractState: "mismatch",
          readiness: { loaded: false, runtimeReady: false },
          runtimeState: "unavailable",
          semanticAvailable: false,
          effectiveMode: "text-only",
          reasonCode: "model-incompatible",
          reason: "Modelo incompatível com os vetores publicados.",
        },
      }));

      expect(vm.searchAvailability.semanticAvailable).toBe(false);
      expect(vm.searchAvailability.hybridMode).toBe("text-only");
      expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida em modo textual");
      expect(vm.freshness.embeddings.status).toBe("stale");
    });

    it("Cenário 4: missing embeddings artifact displays missing and falls back to text-only", () => {
      const vm = buildSidebarVmForScenario(createBaseInput({
        currentSearchMode: "hibrida",
        semanticAvailable: false,
        embeddingsReady: false,
        embeddingsUpdatedAt: null,
        runtimeEmbeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: false,
          exists: false,
          vectorFileState: "missing",
          provenance: { stale: false },
          compatibility: { compatible: false },
          contractState: "none",
          readiness: { loaded: false, runtimeReady: false },
          runtimeState: "unavailable",
          semanticAvailable: false,
          effectiveMode: "text-only",
          reasonCode: "vector-file-missing",
        },
      }));

      expect(vm.searchAvailability.semanticAvailable).toBe(false);
      expect(vm.searchAvailability.hybridMode).toBe("text-only");
      expect(vm.freshness.embeddings.status).toBe("missing");
      expect(vm.freshness.embeddings.humanText).toBe(stringsPt.sidebarFreshnessMissing);
    });

    it("Cenário 5: checking state displays explicit checking text, never 'Estado desconhecido'", () => {
      const vm = buildSidebarVmForScenario(createBaseInput({
        currentSearchMode: "hibrida",
        semanticAvailable: false,
        embeddingsChecking: true,
        runtimeEmbeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: true,
          exists: true,
          vectorFileState: "available",
          provenance: { epoch: 3, producerId: "device-producer-1", stale: false },
          compatibility: { compatible: true },
          contractState: "compatible",
          readiness: { loaded: false, runtimeReady: false },
          runtimeState: "checking",
          semanticAvailable: false,
          effectiveMode: "text-only",
          reasonCode: "runtime-checking",
        },
      }));

      expect(vm.searchAvailability.semanticAvailable).toBe(false);
      expect(vm.freshness.embeddings.humanText).toBe("A verificar...");
      expect(vm.freshness.embeddings.humanText).not.toBe("Estado desconhecido");
    });
  });

  describe("LINA-09: Embedding Freshness vs Update Plan Coherence", () => {
    it("1. 21 days without note changes (workAvailable === false) displays 'Atualizado (há 21 dias)' and never 'Desatualizado'", () => {
      const twentyOneDaysAgo = new Date(baseNow - 21 * 24 * 60 * 60 * 1000).toISOString();
      const vmPt = buildSidebarVmForScenario(createBaseInput({
        embeddingsUpdatedAt: twentyOneDaysAgo,
        embeddingsWorkAvailable: false,
        semanticAvailable: true,
        embeddingsReady: true,
        strings: stringsPt,
      }));

      expect(vmPt.freshness.embeddings.status).toBe("fresh");
      expect(vmPt.freshness.embeddings.humanText).toBe("Atualizado (há 21 dias)");
      expect(vmPt.freshness.embeddings.humanText).not.toContain("Desatualizado");

      const vmEn = buildSidebarVmForScenario(createBaseInput({
        embeddingsUpdatedAt: twentyOneDaysAgo,
        embeddingsWorkAvailable: false,
        semanticAvailable: true,
        embeddingsReady: true,
        strings: stringsEn,
      }));

      expect(vmEn.freshness.embeddings.status).toBe("fresh");
      expect(vmEn.freshness.embeddings.humanText).toBe("Up to date (21 days ago)");
      expect(vmEn.freshness.embeddings.humanText).not.toContain("Outdated");
    });

    it("2. 21 days with real drift (workAvailable === true) displays 'Atualização necessária (há 21 dias)'", () => {
      const twentyOneDaysAgo = new Date(baseNow - 21 * 24 * 60 * 60 * 1000).toISOString();
      const vmPt = buildSidebarVmForScenario(createBaseInput({
        embeddingsUpdatedAt: twentyOneDaysAgo,
        embeddingsWorkAvailable: true,
        semanticAvailable: true,
        embeddingsReady: true,
        strings: stringsPt,
      }));

      expect(vmPt.freshness.embeddings.status).toBe("stale");
      expect(vmPt.freshness.embeddings.humanText).toBe("Atualização necessária (há 21 dias)");

      const vmEn = buildSidebarVmForScenario(createBaseInput({
        embeddingsUpdatedAt: twentyOneDaysAgo,
        embeddingsWorkAvailable: true,
        semanticAvailable: true,
        embeddingsReady: true,
        strings: stringsEn,
      }));

      expect(vmEn.freshness.embeddings.status).toBe("stale");
      expect(vmEn.freshness.embeddings.humanText).toBe("Update required (21 days ago)");
    });

    it("3. Recent publication without drift displays 'Atualizado (há 2 h)' and status 'fresh'", () => {
      const twoHoursAgo = new Date(baseNow - 2 * 60 * 60 * 1000).toISOString();
      const vm = buildSidebarVmForScenario(createBaseInput({
        embeddingsUpdatedAt: twoHoursAgo,
        embeddingsWorkAvailable: false,
        semanticAvailable: true,
        embeddingsReady: true,
        strings: stringsPt,
      }));

      expect(vm.freshness.embeddings.status).toBe("fresh");
      expect(vm.freshness.embeddings.humanText).toBe("Atualizado (há 2 h)");
    });

    it("4. Chronological age alone (e.g. 60 days) never causes 'stale' when embeddings are operational and workAvailable is false/undefined", () => {
      const sixtyDaysAgo = new Date(baseNow - 60 * 24 * 60 * 60 * 1000).toISOString();
      const vm = buildSidebarVmForScenario(createBaseInput({
        embeddingsUpdatedAt: sixtyDaysAgo,
        embeddingsWorkAvailable: false,
        semanticAvailable: true,
        embeddingsReady: true,
        strings: stringsPt,
      }));

      expect(vm.freshness.embeddings.status).toBe("fresh");
      expect(vm.freshness.embeddings.humanText).toBe("Atualizado (há 60 dias)");
      expect(vm.freshness.embeddings.status).not.toBe("stale");
    });

    it("5. Contract mismatch causes 'stale' with update required notice even if workAvailable is false", () => {
      const vm = buildSidebarVmForScenario(createBaseInput({
        currentSearchMode: "hibrida",
        semanticAvailable: false,
        embeddingsWorkAvailable: false,
        runtimeEmbeddings: {
          configured: true,
          textIndexAvailable: true,
          embeddingsDeclared: true,
          exists: true,
          vectorFileState: "available",
          provenance: { epoch: 1, producerId: "p1", stale: false },
          compatibility: { compatible: false },
          contractState: "mismatch",
          readiness: { loaded: false, runtimeReady: false },
          runtimeState: "unavailable",
          semanticAvailable: false,
          effectiveMode: "text-only",
        },
        strings: stringsPt,
      }));

      expect(vm.freshness.embeddings.status).toBe("stale");
      expect(vm.freshness.embeddings.humanText).toContain("Atualização necessária");
    });
  });
});
