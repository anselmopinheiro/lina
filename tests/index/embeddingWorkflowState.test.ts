import { describe, expect, it } from "vitest";
import {
  resolveEmbeddingWorkflowState,
  EmbeddingWorkflowState,
} from "../../src/index/embeddingWorkflowState";
import { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../../src/index/embeddingWorkStatusController";

describe("EmbeddingWorkflowState (LINA-11)", () => {
  const idleOperation: EmbeddingOperationState = {
    status: "idle",
    phase: "idle",
    processedChunks: 0,
    totalChunks: 0,
  };

  const cleanWorkState: EmbeddingWorkRuntimeState = {
    status: "ready",
    revision: 1,
    workAvailable: false,
  };

  const driftWorkState: EmbeddingWorkRuntimeState = {
    status: "ready",
    revision: 2,
    workAvailable: true,
    summary: {
      exists: true,
      validCount: 10,
      obsoleteCount: 1,
      missingCount: 0,
      staleCount: 0,
      duplicateRecordCount: 0,
      invalidRecordCount: 0,
      updatePlan: {
        mode: "incremental",
        targetIdentity: {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          inputVersion: 1,
          prefixMode: "none",
        },
        toGenerateCount: 0,
        reusableCanonicalCount: 10,
        recoverableCheckpointCount: 0,
        obsoleteToDropCount: 1,
        requiresPublication: true,
      },
    },
  };

  // Caso 1 — Sem drift
  it("Caso 1: produces IDLE state without button when no drift exists and operation is idle", () => {
    const workflow = resolveEmbeddingWorkflowState({
      workState: cleanWorkState,
      operationState: idleOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(workflow.status).toBe("idle");
    expect(workflow.workAvailable).toBe(false);
    expect(workflow.operationRunning).toBe(false);
    expect(workflow.canUpdate).toBe(false);
  });

  // Caso 2 — Drift + manual
  it("Caso 2: produces UPDATE_REQUIRED with update button enabled when drift exists in manual mode", () => {
    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: idleOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(workflow.status).toBe("update-required");
    expect(workflow.workAvailable).toBe(true);
    expect(workflow.operationRunning).toBe(false);
    expect(workflow.canUpdate).toBe(true);
    // Invariant: NEVER "preparing" just because workAvailable is true
    expect(workflow.status).not.toBe("preparing");
  });

  it("Caso 2b: does not enable update button if device is not an authorized producer", () => {
    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: idleOperation,
      isAuthorizedProducer: false,
      textIndexReady: true,
    });

    expect(workflow.status).toBe("update-required");
    expect(workflow.canUpdate).toBe(false);
  });

  it("Caso 2c: does not enable update button if text index is not ready", () => {
    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: idleOperation,
      isAuthorizedProducer: true,
      textIndexReady: false,
    });

    expect(workflow.status).toBe("update-required");
    expect(workflow.canUpdate).toBe(false);
  });

  // Caso 3 — Transições após clique no botão (PREPARING -> GENERATING)
  it("Caso 3: transitions to PREPARING then GENERATING only when operation is actively running", () => {
    // 3a. Lease acquisition / provider validation: PREPARING
    const preparingOperation: EmbeddingOperationState = {
      status: "running",
      phase: "preparing",
      processedChunks: 0,
      totalChunks: 5,
    };
    const preparingWorkflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: preparingOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(preparingWorkflow.status).toBe("preparing");
    expect(preparingWorkflow.operationRunning).toBe(true);
    expect(preparingWorkflow.canUpdate).toBe(false);

    // 3b. Active batch execution: GENERATING
    const generatingOperation: EmbeddingOperationState = {
      status: "running",
      phase: "generating",
      processedChunks: 2,
      totalChunks: 5,
    };
    const generatingWorkflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: generatingOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(generatingWorkflow.status).toBe("generating");
    expect(generatingWorkflow.operationRunning).toBe(true);
    expect(generatingWorkflow.processedChunks).toBe(2);
    expect(generatingWorkflow.totalChunks).toBe(5);
    expect(generatingWorkflow.canUpdate).toBe(false);

    // 3c. Persistence: PERSISTING
    const persistingOperation: EmbeddingOperationState = {
      status: "running",
      phase: "persisting",
      processedChunks: 5,
      totalChunks: 5,
    };
    const persistingWorkflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: persistingOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(persistingWorkflow.status).toBe("persisting");
    expect(persistingWorkflow.operationRunning).toBe(true);
    expect(persistingWorkflow.canUpdate).toBe(false);
  });

  // Caso 4 — Geração concluída
  it("Caso 4: transitions back to IDLE when generation completes and drift is cleared", () => {
    const completedOperation: EmbeddingOperationState = {
      status: "completed",
      phase: "completed",
      processedChunks: 5,
      totalChunks: 5,
      message: "Embeddings atualizados com sucesso.",
    };
    const workflow = resolveEmbeddingWorkflowState({
      workState: cleanWorkState,
      operationState: completedOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(workflow.status).toBe("idle");
    expect(workflow.workAvailable).toBe(false);
    expect(workflow.operationRunning).toBe(false);
    expect(workflow.canUpdate).toBe(false);
  });

  // Caso 5 — Fases da cópia binária derivada
  it("Caso 5: binary copy maintenance phases do not produce PREPARING", () => {
    // Binary phase "queued" with drift MUST stay UPDATE_REQUIRED, never PREPARING
    const queuedWorkflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: idleOperation,
      binaryMaintenancePhase: "queued",
      isAuthorizedProducer: true,
      textIndexReady: true,
    });
    expect(queuedWorkflow.status).toBe("update-required");
    expect(queuedWorkflow.status).not.toBe("preparing");

    // Binary phase "reading-jsonl" without drift resolves to FINALIZING
    const finalizingWorkflow = resolveEmbeddingWorkflowState({
      workState: cleanWorkState,
      operationState: idleOperation,
      binaryMaintenancePhase: "building",
      isAuthorizedProducer: true,
      textIndexReady: true,
    });
    expect(finalizingWorkflow.status).toBe("finalizing");
    expect(finalizingWorkflow.status).not.toBe("preparing");
  });

  // Caso 6 — Erro do provider
  it("Caso 6: produces ERROR with retry capability when operation fails", () => {
    const failedOperation: EmbeddingOperationState = {
      status: "failed",
      phase: "failed",
      processedChunks: 1,
      totalChunks: 5,
      error: "Provider connection timeout",
    };
    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: failedOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(workflow.status).toBe("error");
    expect(workflow.operationRunning).toBe(false);
    expect(workflow.error).toBe("Provider connection timeout");
    expect(workflow.canUpdate).toBe(true); // retry allowed!
  });

  // Caso 7 — Checking state
  it("Caso 7: produces CHECKING state while update plan is calculating", () => {
    const calculatingWorkState: EmbeddingWorkRuntimeState = {
      status: "calculating",
      revision: 3,
    };
    const workflow = resolveEmbeddingWorkflowState({
      workState: calculatingWorkState,
      operationState: idleOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(workflow.status).toBe("checking");
    expect(workflow.operationRunning).toBe(false);
    expect(workflow.canUpdate).toBe(false);
  });

  // Cancelled state with drift returns to UPDATE_REQUIRED
  it("returns to UPDATE_REQUIRED when active operation was cancelled but drift remains", () => {
    const cancelledOperation: EmbeddingOperationState = {
      status: "cancelled",
      phase: "cancelled",
      processedChunks: 1,
      totalChunks: 5,
      message: "Operação cancelada pelo utilizador.",
    };
    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWorkState,
      operationState: cancelledOperation,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    expect(workflow.status).toBe("update-required");
    expect(workflow.workAvailable).toBe(true);
    expect(workflow.canUpdate).toBe(true);
  });
});
