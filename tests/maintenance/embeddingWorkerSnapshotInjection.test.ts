import { describe, expect, it, vi } from "vitest";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import {
  type EmbeddingLifecycleSnapshot,
  resolveEmbeddingLifecycle,
} from "../../src/index/embeddingLifecycleModel";
import {
  EmbeddingWorker,
  evaluateOperationDecisionFromSnapshot,
  type EmbeddingWorkerGenerationResult,
  type EmbeddingWorkerOptions,
} from "../../src/maintenance/embeddingWorker";

function createMockSnapshot(
  overrides: Partial<Parameters<typeof resolveEmbeddingLifecycle>[0]> = {}
): EmbeddingLifecycleSnapshot {
  const defaultIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none",
    contractId: "ollama:nomic-embed-text:768:1:none",
  };

  return resolveEmbeddingLifecycle({
    revision: 1,
    computedAt: new Date().toISOString(),
    deviceRole: "producer",
    isActiveProducer: true,
    embeddingsEnabled: true,
    upstreamTextIndex: "ready",
    canonicalExists: true,
    validForSearchCount: 100,
    activeSource: "canonical",
    publishedIdentity: defaultIdentity,
    deviceIdentity: defaultIdentity,
    workAssessment: {
      kind: "none",
      updateRequired: false,
      severity: "none",
      cost: "none",
      reasons: ["up-to-date"],
    },
    ...overrides,
  });
}

function createWorkerFixture(overrides: Partial<EmbeddingWorkerOptions> = {}) {
  const coordinator = new IndexWriteCoordinator();
  const binaryHandoff = vi.fn();
  const scheduleTextIndexFlush = vi.fn();
  const onGenerationFinalized = vi.fn();
  const statusNotify = vi.fn();

  const options: EmbeddingWorkerOptions = {
    capabilities: {
      canGenerateEmbeddings: () => resolveDeviceCapabilities({ isMobile: false }).canGenerateEmbeddings,
      canPublish: () => true,
    },
    canPublish: () => true,
    isTextIndexBusy: () => false,
    drainTextIndex: async () => true,
    scheduleTextIndexFlush,
    coordinator: {
      requestPreparation: () => coordinator.requestEmbeddingGenerationPreparation(),
      cancelPreparation: () => coordinator.cancelEmbeddingGenerationPreparation(),
      startGeneration: () => coordinator.startEmbeddingGeneration(),
      finish: (token) => coordinator.finish(token),
    },
    generationService: {
      generate: async (): Promise<EmbeddingWorkerGenerationResult> => ({
        success: true,
        message: "generated",
        publicationId: "pub-001",
      }),
    },
    persistence: { onGenerationFinalized },
    statusNotifications: { notify: statusNotify },
    binaryHandoff: { maintainAfterPublication: binaryHandoff },
    messages: {
      preparing: "preparing",
      waitingForTextIndex: "waiting",
      cancelled: "cancelled",
      blockedByTextIndex: () => "text index busy",
      generalError: "general error",
      cancelling: "cancelling",
    },
    ...overrides,
  };

  return {
    options,
    coordinator,
    binaryHandoff,
    scheduleTextIndexFlush,
    onGenerationFinalized,
    statusNotify,
  };
}

describe("EmbeddingWorker Canonical Snapshot Injection (LINA-14F.4-B4.0-B)", () => {
  describe("Cenário 1: Producer Ativo (READY, UPDATE_AVAILABLE, INDEX_ONLY)", () => {
    it("READY: avalia canStart=false e no-work-pending", () => {
      const snapshot = createMockSnapshot({
        workAssessment: {
          kind: "none",
          updateRequired: false,
          severity: "none",
          cost: "none",
          reasons: ["up-to-date"],
        },
      });

      expect(snapshot.primary).toBe("READY");
      const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
      const worker = new EmbeddingWorker(fixture.options);

      const decision = worker.evaluateCanonicalDecision();
      expect(decision).toBeDefined();
      expect(decision?.canStart).toBe(false);
      expect(decision?.action).toBe("none");
      expect(decision?.reason).toBe("no-work-pending");
    });

    it("UPDATE_AVAILABLE: autoriza execução incremental para o active producer", async () => {
      const snapshot = createMockSnapshot({
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "low",
          cost: "local",
          reasons: ["notes-modified"],
          counts: { totalChunks: 120, toGenerate: 20, missing: 20, reusableCanonical: 100 },
        },
      });

      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
      const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
      const worker = new EmbeddingWorker(fixture.options);

      const decision = worker.evaluateCanonicalDecision();
      expect(decision?.canStart).toBe(true);
      expect(decision?.action).toBe("update");
      expect(decision?.requiresConfirmation).toBe(false);

      const request = worker.requestGeneration("command");
      expect(request.status).toBe("accepted");
      if (request.status !== "accepted") throw new Error("Expected accepted request");
      const completion = await request.completion;
      expect(completion.result.success).toBe(true);
    });

    it("INDEX_ONLY: autoriza geração inicial completa para o active producer", async () => {
      const snapshot = createMockSnapshot({
        canonicalExists: false,
        validForSearchCount: 0,
        workAssessment: {
          kind: "pending",
          updateRequired: true,
          severity: "blocking",
          cost: "local",
          reasons: ["no-published-index"],
          counts: { totalChunks: 50, toGenerate: 50, missing: 50 },
        },
      });

      expect(snapshot.primary).toBe("INDEX_ONLY");
      const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
      const worker = new EmbeddingWorker(fixture.options);

      const decision = worker.evaluateCanonicalDecision();
      expect(decision?.canStart).toBe(true);
      expect(decision?.action).toBe("generate");

      const request = worker.requestGeneration("command");
      expect(request.status).toBe("accepted");
    });
  });

  describe("Cenário 2: Companion Isolation", () => {
    it("bloqueia estritamente qualquer tentativa de geração ou escrita em Companion", () => {
      const snapshot = createMockSnapshot({
        deviceRole: "companion",
        isActiveProducer: false,
        workAssessment: {
          kind: "pending",
          updateRequired: true,
          severity: "medium",
          cost: "local",
          reasons: ["notes-modified"],
        },
      });

      expect(snapshot.capability.blockedReason).toBe("companion");
      expect(snapshot.write.applicable).toBe(false);

      const fixture = createWorkerFixture({
        capabilities: {
          canGenerateEmbeddings: () => false,
          canPublish: () => false,
        },
        canPublish: () => false,
        getLifecycleSnapshot: () => snapshot,
      });
      const worker = new EmbeddingWorker(fixture.options);

      const decision = worker.evaluateCanonicalDecision();
      expect(decision?.canStart).toBe(false);
      expect(decision?.action).toBe("none");

      const manualReq = worker.requestGeneration("command");
      expect(manualReq.status).toBe("not-capable");

      const autoReq = worker.requestGeneration("automatic");
      expect(autoReq.status).toBe("not-capable");
    });
  });

  describe("Cenário 3: Standby Producer", () => {
    it("bloqueia execução local quando o dispositivo é Standby e não detém autoridade ativa", () => {
      const snapshot = createMockSnapshot({
        deviceRole: "producer",
        isActiveProducer: false,
        workAssessment: {
          kind: "pending",
          updateRequired: true,
          severity: "medium",
          cost: "local",
          reasons: ["notes-modified"],
        },
      });

      expect(snapshot.capability.blockedReason).toBe("standby");
      expect(snapshot.write.applicable).toBe(false);

      const fixture = createWorkerFixture({
        capabilities: {
          canGenerateEmbeddings: () => true,
          canPublish: () => false,
        },
        canPublish: () => false,
        getLifecycleSnapshot: () => snapshot,
      });
      const worker = new EmbeddingWorker(fixture.options);

      const decision = worker.evaluateCanonicalDecision();
      expect(decision?.canStart).toBe(false);

      const manualReq = worker.requestGeneration("command");
      expect(manualReq.status).toBe("not-active-producer");

      const autoReq = worker.requestGeneration("automatic");
      expect(autoReq.status).toBe("not-active-producer");
    });
  });

  describe("Cenário 4: Perda de Ownership Durante Operação", () => {
    it("deteta perda de autoridade de escrita durante a execução e rejeita com not-active-producer", () => {
      const snapshot = createMockSnapshot({
        deviceRole: "producer",
        isActiveProducer: false, // autoridade revogada
        operationState: {
          status: "running",
          phase: "generating",
          processedChunks: 50,
          totalChunks: 100,
        },
      });

      const decision = evaluateOperationDecisionFromSnapshot(snapshot);
      expect(decision.ownershipLostDuringOperation).toBe(true);
      expect(decision.canStart).toBe(false);
      expect(decision.reason).toBe("ownership-lost-during-operation");

      const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
      const worker = new EmbeddingWorker(fixture.options);

      const req = worker.requestGeneration("command");
      expect(req.status).toBe("not-active-producer");
    });
  });

  describe("Cenário 5: Incompatibilidade e Confirmação de Rebuild", () => {
    it("INCOMPATIBLE: bloqueia despacho automático e exige confirmação explícita para rebuild", () => {
      const snapshot = createMockSnapshot({
        publishedIdentity: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
        deviceIdentity: { provider: "ollama", model: "bge-m3", dimensions: 1024 },
        workAssessment: {
          kind: "pending",
          updateRequired: true,
          severity: "blocking",
          cost: "local",
          reasons: ["model-mismatch"],
        },
      });

      expect(snapshot.primary).toBe("INCOMPATIBLE");
      const fixture = createWorkerFixture({ getLifecycleSnapshot: () => snapshot });
      const worker = new EmbeddingWorker(fixture.options);

      const decision = worker.evaluateCanonicalDecision();
      expect(decision?.action).toBe("rebuild");
      expect(decision?.requiresConfirmation).toBe(true);

      // Despacho automático sem confirmação é bloqueado
      const autoReq = worker.requestGeneration("automatic");
      expect(autoReq.status).toBe("not-capable");

      // Pedido manual/confirmado é aceite para execução do rebuild
      const manualReq = worker.requestGeneration("command");
      expect(manualReq.status).toBe("accepted");
    });
  });
});
