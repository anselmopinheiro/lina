import { buildSidebarVmForScenario } from "../helpers/sidebarScenarioSnapshot";
import { buildDiagnosticsWithSnapshot, readDiagnosticsWithSnapshot } from "../helpers/diagnosticsFixtures";
import { evaluateCapabilityFromLegacyFacts } from "../helpers/capabilityFromFacts";
import { describe, expect, it, vi } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { buildSidebarStatusViewModel } from "../../src/search/sidebarStatusViewModel";
import {
  evaluateSemanticCapability,
  type SemanticCapabilityState,
} from "../../src/search/semanticCapability";
import {
  buildDeviceDiagnostics,
  type DeviceDiagnostics,
} from "../../src/device/deviceDiagnostics";
import { DeviceDiagnosticsModal } from "../../src/device/deviceDiagnosticsModal";
import { evaluateOwnershipRecoveryState } from "../../src/device/ownershipRecoveryDiagnostics";
import { type OwnershipManifest } from "../../src/device/deviceOwnership";
import { type OwnershipAuditEvent } from "../../src/device/deviceOwnershipAudit";

interface ElementStub {
  tag: string;
  textContent: string;
  options?: any;
  children: ElementStub[];
  listeners: Map<string, Array<() => void>>;
  createEl: (tag: string, options?: any) => ElementStub;
  createDiv: (options?: any) => ElementStub;
  createSpan: (options?: any) => ElementStub;
  addClass: (cls: string) => void;
  addEventListener: (type: string, listener: () => void) => void;
  empty: () => void;
}

function makeElementStub(tag = "div", options?: any): ElementStub {
  const stub: ElementStub = {
    tag,
    textContent: options?.text ?? "",
    options,
    children: [],
    listeners: new Map(),
    createEl: (childTag, childOptions) => {
      const child = makeElementStub(childTag, childOptions);
      stub.children.push(child);
      return child;
    },
    createDiv: (childOptions) => stub.createEl("div", childOptions),
    createSpan: (childOptions) => stub.createEl("span", childOptions),
    addClass: vi.fn(),
    addEventListener: (type, listener) => {
      const list = stub.listeners.get(type) ?? [];
      list.push(listener);
      stub.listeners.set(type, list);
    },
    empty: () => {
      stub.children = [];
    },
  };

  Object.defineProperty(stub, "textContent", {
    get() {
      let text = options?.text ?? "";
      for (const child of stub.children) {
        text += " " + child.textContent;
      }
      return text;
    },
    configurable: true,
  });

  return stub;
}

function createModalWithStub(
  diagnostics: DeviceDiagnostics,
  strings = getStrings("pt-PT")
): { modal: DeviceDiagnosticsModal; root: ElementStub } {
  const mockApp = {
    vault: {
      adapter: {
        exists: vi.fn(),
        read: vi.fn(),
      },
    },
  } as any;

  const modal = new DeviceDiagnosticsModal(mockApp, diagnostics, strings);
  const root = makeElementStub("div");
  modal.contentEl = root as any;
  modal.close = vi.fn();
  return { modal, root };
}

describe("Semantic Availability, Diagnostics & Ownership Alignment (LINA-03-FIX-STATE-DIVERGENCE-001)", () => {
  const stringsPt = getStrings("pt-PT");
  const stringsEn = getStrings("en");
  const deviceId = "producer-device-1";
  const timestamp = "2026-09-06T12:00:00.000Z";

  // Scenario 1: Active Producer + text + vectors + reachable provider
  it("1. Active Producer + text + vectors + reachable provider: sidebar available, diagnostics available, no 'Companion' label", () => {
    const semanticCap = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      vectorContractState: "compatible",
      semanticCompatibility: { available: true },
      providerReachable: true,
    });

    expect(semanticCap.semanticAvailable).toBe(true);
    expect(semanticCap.effectiveMode).toBe("full");

    const sidebarVm = buildSidebarVmForScenario({
      deviceId,
      deviceRole: "producer",
      isAuthorizedProducer: true,
      textIndexReady: true,
      embeddingsReady: true,
      semanticAvailable: semanticCap.semanticAvailable,
      currentSearchMode: "hibrida",
      strings: stringsPt,
    });

    expect(sidebarVm.searchAvailability.hybridMode).toBe("full");

    const diag = buildDiagnosticsWithSnapshot({
      deviceId,
      deviceState: { schemaVersion: 2, deviceId, deviceName: "Studio", role: "producer" },
      ownership: { schemaVersion: 1, activeProducerId: deviceId, epoch: 1, acquiredAt: timestamp, updatedAt: timestamp, reason: "initial" },
      textManifestRaw: {
        schemaVersion: 1,
        indexType: "text",
        version: 1,
        totalNotes: 100,
        totalChunks: 500,
        embeddingsEnabled: true,
        embeddings: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
      },
      semanticCapability: semanticCap,
    });

    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");

    const { modal, root } = createModalWithStub(diag, stringsPt);
    modal.onOpen();

    const headings = root.children.filter((c) => c.tag === "h3").map((c) => c.textContent.trim());
    // Active Producer heading should be "Capacidade de Pesquisa", NEVER "Pesquisa Companion (Modo Leitura)"
    expect(headings).toContain("Capacidade de Pesquisa");
    expect(headings.some((h) => h.includes("Companion"))).toBe(false);
  });

  // Scenario 2: Active Producer + text + vectors + provider/model default effective
  it("2. Active Producer: effective config resolves provider and model correctly without empty-model incompatibility", () => {
    // Simulated plugin method getEffectiveEmbeddingConfig logic:
    // When local model is empty "", canonical resolver falls back to chooseProviderDefaultModel
    const defaultModel = "nomic-embed-text";
    const resolvedConfig = {
      provider: "ollama",
      model: defaultModel,
    };

    // Vector contract from index matches the effective model
    const semanticCap = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      vectorContractState: "compatible",
      semanticCompatibility: {
        available: true,
        deviceProvider: resolvedConfig.provider,
        deviceModel: resolvedConfig.model,
        indexProvider: "ollama",
        indexModel: "nomic-embed-text",
      },
    });

    expect(semanticCap.semanticAvailable).toBe(true);
    expect(semanticCap.reasonCode).toBeUndefined();
  });

  // Scenario 3: Active Producer + text + vectors + runtime checking
  it("3. Active Producer + runtime checking: sidebar shows 'A verificar...', not permanent unknown, and suppresses degraded alert", () => {
    const sidebarVm = buildSidebarVmForScenario({
      deviceId,
      deviceRole: "producer",
      isAuthorizedProducer: true,
      textIndexReady: true,
      embeddingsReady: false,
      embeddingsChecking: true,
      semanticAvailable: false,
      semanticPreparing: false,
      currentSearchMode: "hibrida",
      strings: stringsPt,
    });

    expect(sidebarVm.freshness.embeddings.humanText).toBe("A verificar...");
    // Crucial: degradedAlert for semantic-unavailable must not show while checking
    expect(sidebarVm.degradedAlert).toBeUndefined();

    const sidebarVmEn = buildSidebarVmForScenario({
      deviceId,
      deviceRole: "producer",
      isAuthorizedProducer: true,
      textIndexReady: true,
      embeddingsReady: false,
      embeddingsChecking: true,
      semanticAvailable: false,
      semanticPreparing: false,
      currentSearchMode: "hibrida",
      strings: stringsEn,
    });
    expect(sidebarVmEn.freshness.embeddings.humanText).toBe("Checking...");
  });

  // Scenario 4: Active Producer + vectors present in manifest but physical vector file missing
  it("4. Active Producer + vectors in manifest but physical file missing: diagnostics shows declared artifact but operational mode degrades to text-only", () => {
    const semanticCap = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      semanticCompatibility: {
        available: false,
        reasonCode: "missing",
        reason: "Embeddings não existem ou estão vazios.",
      },
    });

    expect(semanticCap.artifactState.embeddingsDeclared).toBe(true);
    expect(semanticCap.artifactState.vectorFile).toBe("missing");
    expect(semanticCap.semanticAvailable).toBe(false);
    expect(semanticCap.effectiveMode).toBe("text-only");
    expect(semanticCap.reasonCode).toBe("vector-file-missing");

    const diag = buildDiagnosticsWithSnapshot({
      deviceId,
      deviceState: { schemaVersion: 2, deviceId, deviceName: "Studio", role: "producer" },
      ownership: { schemaVersion: 1, activeProducerId: deviceId, epoch: 1, acquiredAt: timestamp, updatedAt: timestamp, reason: "initial" },
      textManifestRaw: {
        schemaVersion: 1,
        indexType: "text",
        version: 1,
        totalNotes: 50,
        totalChunks: 200,
        embeddingsEnabled: true,
        embeddings: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
      },
      semanticCapability: semanticCap,
    });

    // Artifact declared in manifest:
    expect(diag.companionSearch.embeddingsAvailable).toBe(true);
    // But operational semantic is unavailable:
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(false);
    expect(diag.companionSearch.operationalMode).toBe("text-only");

    const { modal, root } = createModalWithStub(diag, stringsPt);
    modal.onOpen();

    // In modal, mode displayed must be "Apenas Texto" and not "Pesquisa Completa"
    const textContent = root.textContent;
    expect(textContent).toContain("Apenas Texto");
    expect(textContent).not.toContain("Pesquisa Completa (Texto + Vetores)");
  });

  // Scenario 5: Companion + valid contract + valid vector file
  it("5. Companion + valid contract + valid vector file: diagnostics and sidebar agree on semantic capability", () => {
    const companionId = "companion-device-1";
    const semanticCap = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      vectorContractState: "compatible",
      semanticCompatibility: { available: true },
      providerReachable: true,
    });

    const sidebarVm = buildSidebarVmForScenario({
      deviceId: companionId,
      deviceRole: "companion",
      isAuthorizedProducer: false,
      textIndexReady: true,
      embeddingsReady: true,
      semanticAvailable: semanticCap.semanticAvailable,
      currentSearchMode: "hibrida",
      strings: stringsPt,
    });

    const diag = buildDiagnosticsWithSnapshot({
      deviceId: companionId,
      deviceState: { schemaVersion: 2, deviceId: companionId, deviceName: "Tablet", role: "companion" },
      ownership: { schemaVersion: 1, activeProducerId: deviceId, epoch: 1, acquiredAt: timestamp, updatedAt: timestamp, reason: "initial" },
      textManifestRaw: {
        schemaVersion: 1,
        indexType: "text",
        version: 1,
        totalNotes: 50,
        totalChunks: 200,
        embeddingsEnabled: true,
        embeddings: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
      },
      semanticCapability: semanticCap,
    });

    expect(sidebarVm.searchAvailability.hybridMode).toBe("full");
    expect(diag.companionSearch.operationalSemanticAvailable).toBe(true);
    expect(diag.companionSearch.operationalMode).toBe("full");
  });

  // Scenario 6: Companion + no endpoint / runtime unavailable
  it("6. Companion + no endpoint / runtime unavailable: artifacts valid, operational semantic unavailable, wording distinguishes both", () => {
    const companionId = "companion-device-1";
    const semanticCap = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      vectorContractState: "compatible",
      semanticCompatibility: {
        available: false,
        reasonCode: "incompatible",
        reason: "Endpoint do fornecedor não configurado no dispositivo.",
      },
      providerReachable: false,
    });

    expect(semanticCap.artifactState.embeddingsDeclared).toBe(true);
    expect(semanticCap.semanticAvailable).toBe(false);
    expect(semanticCap.effectiveMode).toBe("text-only");
    expect(semanticCap.reasonCode).toBe("provider-unreachable");

    const diag = buildDiagnosticsWithSnapshot({
      deviceId: companionId,
      deviceState: { schemaVersion: 2, deviceId: companionId, deviceName: "Tablet", role: "companion" },
      ownership: { schemaVersion: 1, activeProducerId: deviceId, epoch: 1, acquiredAt: timestamp, updatedAt: timestamp, reason: "initial" },
      textManifestRaw: {
        schemaVersion: 1,
        indexType: "text",
        version: 1,
        totalNotes: 50,
        totalChunks: 200,
        embeddingsEnabled: true,
        embeddings: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
      },
      semanticCapability: semanticCap,
    });

    const { modal, root } = createModalWithStub(diag, stringsPt);
    modal.onOpen();

    const textContent = root.textContent;
    // When semanticAvailable === false, search capability line reports Embeddings indisponíveis:
    expect(textContent).toContain("Embeddings indisponíveis");
    // And operational mode is text-only:
    expect(textContent).toContain("Apenas Texto");
    expect(textContent).not.toContain("Pesquisa Completa (Texto + Vetores)");
    expect(textContent).toContain("Fornecedor de embeddings inacessível ou endpoint indisponível.");
  });

  // Scenario 7: Ownership epoch 1 + no history
  it("7. ownership epoch 1 + no history: healthy initial bootstrap without integrity warning", () => {
    const manifest: OwnershipManifest = {
      schemaVersion: 1,
      activeProducerId: deviceId,
      epoch: 1,
      acquiredAt: timestamp,
      updatedAt: timestamp,
      reason: "initial",
    };

    const recovery = evaluateOwnershipRecoveryState(manifest, []);
    expect(recovery.status).toBe("healthy");
    expect(recovery.warnings).toHaveLength(0);
    expect(recovery.hasManifest).toBe(true);
    expect(recovery.hasHistory).toBe(false);
    expect(recovery.currentEpoch).toBe(1);
  });

  // Scenario 8: Ownership epoch > 1 + no history
  it("8. ownership epoch > 1 + no history: integrity warning preserved as missing-history", () => {
    const manifest: OwnershipManifest = {
      schemaVersion: 1,
      activeProducerId: deviceId,
      epoch: 2,
      acquiredAt: timestamp,
      updatedAt: timestamp,
      reason: "manual-transfer",
    };

    const recovery = evaluateOwnershipRecoveryState(manifest, []);
    expect(recovery.status).toBe("missing-history");
    expect(recovery.warnings.length).toBeGreaterThan(0);
    expect(recovery.warnings[0]).toContain("no audit history was found");
  });

  // Scenario 9: Ownership history exists
  it("9. ownership history exists: coherence preserved between manifest and audit trail", () => {
    const manifest: OwnershipManifest = {
      schemaVersion: 1,
      activeProducerId: deviceId,
      epoch: 2,
      acquiredAt: timestamp,
      updatedAt: timestamp,
      reason: "manual-transfer",
    };

    const history: OwnershipAuditEvent[] = [
      {
        schemaVersion: 1,
        eventId: "evt-1",
        newProducerId: "device-old",
        newEpoch: 1,
        reason: "initial",
        executedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        schemaVersion: 1,
        eventId: "evt-2",
        previousProducerId: "device-old",
        newProducerId: deviceId,
        previousEpoch: 1,
        newEpoch: 2,
        reason: "manual-transfer",
        executedAt: timestamp,
      },
    ];

    const recovery = evaluateOwnershipRecoveryState(manifest, history);
    expect(recovery.status).toBe("healthy");
    expect(recovery.hasHistory).toBe(true);
    expect(recovery.currentEpoch).toBe(2);
    expect(recovery.latestAuditEpoch).toBe(2);
    expect(recovery.warnings).toHaveLength(0);
  });

  // Scenario 10: Sidebar and diagnostics consume the same canonical semantic capability
  it("10. sidebar and diagnostics consume the same semantic capability result", () => {
    const sharedCapability: SemanticCapabilityState = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      semanticCompatibility: { available: true },
      providerReachable: true,
    });

    const sidebarVm = buildSidebarVmForScenario({
      deviceId,
      deviceRole: "producer",
      isAuthorizedProducer: true,
      textIndexReady: true,
      embeddingsReady: true,
      semanticAvailable: sharedCapability.semanticAvailable,
      currentSearchMode: "hibrida",
      strings: stringsPt,
    });

    const diag = buildDiagnosticsWithSnapshot({
      deviceId,
      deviceState: { schemaVersion: 2, deviceId, deviceName: "Studio", role: "producer" },
      ownership: { schemaVersion: 1, activeProducerId: deviceId, epoch: 1, acquiredAt: timestamp, updatedAt: timestamp, reason: "initial" },
      textManifestRaw: {
        schemaVersion: 1,
        indexType: "text",
        version: 1,
        totalNotes: 50,
        totalChunks: 200,
        embeddingsEnabled: true,
        embeddings: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
      },
      semanticCapability: sharedCapability,
    });

    expect(sidebarVm.searchAvailability.hybridMode).toBe(diag.companionSearch.operationalMode);
    expect(sidebarVm.searchAvailability.hybridMode).toBe("full");
  });

  // Scenario 11: No regression in text-only fallback
  it("11. no regression in text-only fallback when semantic search is unavailable", () => {
    const semanticCap = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: false,
      vectorContractState: "none",
    });

    expect(semanticCap.semanticAvailable).toBe(false);
    expect(semanticCap.effectiveMode).toBe("text-only");

    const sidebarVm = buildSidebarVmForScenario({
      deviceId,
      deviceRole: "producer",
      isAuthorizedProducer: true,
      textIndexReady: true,
      embeddingsReady: false,
      semanticAvailable: semanticCap.semanticAvailable,
      currentSearchMode: "textual",
      strings: stringsPt,
    });

    expect(sidebarVm.searchAvailability.currentModeHeadline).toBe(stringsPt.sidebarSearchTextAvailable);
    expect(sidebarVm.searchAvailability.tone).toBe("success");
    expect(sidebarVm.degradedAlert).toBeUndefined();
  });

  // Scenario 12: Hybrid degrades correctly when semantic unavailable
  it("12. hybrid degrades correctly when semantic is unavailable", () => {
    const semanticCap = evaluateCapabilityFromLegacyFacts({
      textIndexAvailable: true,
      embeddingsDeclaredInManifest: true,
      semanticCompatibility: {
        available: false,
        reasonCode: "incompatible",
        reason: "Modelo incompatível.",
      },
    });

    expect(semanticCap.effectiveMode).toBe("text-only");

    const sidebarVm = buildSidebarVmForScenario({
      deviceId,
      deviceRole: "producer",
      isAuthorizedProducer: true,
      textIndexReady: true,
      embeddingsReady: false,
      semanticAvailable: semanticCap.semanticAvailable,
      semanticReason: semanticCap.reason,
      semanticReasonCode: semanticCap.reasonCode,
      currentSearchMode: "hibrida",
      strings: stringsPt,
    });

    // In hybrid mode without semantic capability, mode is text-only and degraded alert is surfaced
    expect(sidebarVm.searchAvailability.hybridMode).toBe("text-only");
    expect(sidebarVm.degradedAlert).toBeDefined();
    expect(sidebarVm.degradedAlert?.kind).toBe("semantic-unavailable");
    expect(sidebarVm.degradedAlert?.level).toBe("warning");
  });
});
