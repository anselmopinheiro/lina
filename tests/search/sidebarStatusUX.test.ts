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
    const vmPt = buildSidebarStatusViewModel(createBaseInput({ isAuthorizedProducer: true, strings: stringsPt }));
    expect(vmPt.role.roleKey).toBe("active-producer");
    expect(vmPt.role.title).toBe("Produtor ativo");
    expect(vmPt.role.description).toBe("Mantém o índice e os embeddings");
    expect(vmPt.role.tone).toBe("accent");

    const vmEn = buildSidebarStatusViewModel(createBaseInput({ isAuthorizedProducer: true, strings: stringsEn }));
    expect(vmEn.role.roleKey).toBe("active-producer");
    expect(vmEn.role.title).toBe("Active Producer");
    expect(vmEn.role.description).toBe("Maintains search index and embeddings");
  });

  // 2. Standby Producer shows correct role
  it("2. Standby Producer shows correct role in pt-PT and en", () => {
    const vmPt = buildSidebarStatusViewModel(createBaseInput({
      deviceRole: "producer",
      isAuthorizedProducer: false,
      isStandbyProducer: true,
      strings: stringsPt,
    }));
    expect(vmPt.role.roleKey).toBe("standby-producer");
    expect(vmPt.role.title).toBe("Produtor em espera");
    expect(vmPt.role.description).toBe("Outro dispositivo é o Produtor ativo");
    expect(vmPt.role.tone).toBe("neutral");

    const vmEn = buildSidebarStatusViewModel(createBaseInput({
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
    const vmPt = buildSidebarStatusViewModel(createBaseInput({
      deviceRole: "companion",
      isAuthorizedProducer: false,
      isStandbyProducer: false,
      strings: stringsPt,
    }));
    expect(vmPt.role.roleKey).toBe("companion");
    expect(vmPt.role.title).toBe("Companion");
    expect(vmPt.role.description).toBe("Usa os artefactos produzidos noutro dispositivo");
    expect(vmPt.role.tone).toBe("muted");

    const vmEn = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({ isAuthorizedProducer: true }));
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
    expect(vm.maintenance.isCompanion).toBe(false);
    expect(vm.maintenance.isStandby).toBe(false);
    expect(vm.maintenance.gatingNotice).toBeUndefined();
  });

  // 5. Companion does not see Producer actions as executable
  it("5. Companion does not see Producer actions as executable", () => {
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
      textIndexUpdatedAt: twoHoursAgo,
      embeddingsUpdatedAt: twoHoursAgo,
      strings: stringsPt,
    }));
    expect(vm.freshness.textIndex.status).toBe("fresh");
    expect(vm.freshness.textIndex.humanText).toBe("Atualizado (há 2 h)");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.freshness.embeddings.humanText).toBe("Atualizado (há 2 h)");

    const vmEn = buildSidebarStatusViewModel(createBaseInput({
      textIndexUpdatedAt: twoHoursAgo,
      embeddingsUpdatedAt: twoHoursAgo,
      strings: stringsEn,
    }));
    expect(vmEn.freshness.textIndex.humanText).toBe("Up to date (2 h ago)");
  });

  // 8. Freshness aging
  it("8. Freshness aging between 24h and 48h", () => {
    const thirtyHoursAgo = new Date(baseNow - 30 * 60 * 60 * 1000).toISOString();
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
      textIndexUpdatedAt: threeDaysAgo,
      embeddingsUpdatedAt: threeDaysAgo,
      strings: stringsPt,
    }));
    expect(vm.freshness.textIndex.status).toBe("stale");
    expect(vm.freshness.textIndex.humanText).toBe("Desatualizado (há 3 dias)");
  });

  // 10. Freshness unknown
  it("10. Freshness unknown when timestamp is missing or unparseable", () => {
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vmSemantic = buildSidebarStatusViewModel(createBaseInput({
      currentSearchMode: "semantica",
      semanticAvailable: true,
      strings: stringsPt,
    }));
    expect(vmSemantic.searchAvailability.semanticAvailable).toBe(true);
    expect(vmSemantic.searchAvailability.currentModeHeadline).toBe("Pesquisa semântica disponível");
    expect(vmSemantic.searchAvailability.tone).toBe("success");

    const vmHybrid = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vmPolicy = buildSidebarStatusViewModel(createBaseInput({
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
    const vmVector = buildSidebarStatusViewModel(createBaseInput({
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
    const vmStale = buildSidebarStatusViewModel(createBaseInput({
      companionState: mockStaleWin as CompanionArtifactConsumptionState,
      strings: stringsPt,
    }));
    expect(vmStale.degradedAlert?.kind).toBe("producer-stale");
    expect(vmStale.degradedAlert?.message).toBe("O Produtor não atualiza os artefactos há mais de 48 h.");
  });

  // 18. Absence of Producer State does not crash UI
  it("18. Absence of Producer State handles gracefully with no crash", () => {
    expect(() => {
      const vm = buildSidebarStatusViewModel(createBaseInput({
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
    const vm = buildSidebarStatusViewModel(createBaseInput({
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
});
