import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  buildSidebarStatusViewModel,
  type BuildSidebarStatusViewModelInput,
} from "../../src/search/sidebarStatusViewModel";
import { resolveEmbeddingWorkflowState } from "../../src/index/embeddingWorkflowState";
import { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import { EmbeddingWorkRuntimeState } from "../../src/index/embeddingWorkStatusController";

describe("Sidebar Embedding Workflow State Presentation (LINA-11)", () => {
  const stringsPt = getStrings("pt-PT");
  const stringsEn = getStrings("en");
  const baseNow = new Date("2026-09-29T12:00:00.000Z").getTime();

  function createBaseInput(
    overrides: Partial<BuildSidebarStatusViewModelInput> = {}
  ): BuildSidebarStatusViewModelInput {
    return {
      deviceId: "device-producer-1",
      deviceRole: "producer",
      isAuthorizedProducer: true,
      isStandbyProducer: false,
      textIndexReady: true,
      textIndexUsability: "ready",
      textIndexUpdatedAt: new Date(baseNow - 60 * 60 * 1000).toISOString(),
      embeddingsEnabled: true,
      embeddingsReady: true,
      embeddingsUpdatedAt: new Date(baseNow - 60 * 60 * 1000).toISOString(),
      semanticAvailable: true,
      semanticPreparing: false,
      currentSearchMode: "hibrida",
      strings: stringsPt,
      currentTime: baseNow,
      ...overrides,
    };
  }

  // Caso 1 — Sem drift
  it("Caso 1: displays 'Pesquisa híbrida disponível' and 'Embeddings: Atualizado' without button or preparing notice", () => {
    const idleOp: EmbeddingOperationState = {
      status: "idle",
      phase: "idle",
      processedChunks: 0,
      totalChunks: 0,
    };
    const cleanWork: EmbeddingWorkRuntimeState = {
      status: "ready",
      revision: 1,
      workAvailable: false,
    };

    const workflow = resolveEmbeddingWorkflowState({
      workState: cleanWork,
      operationState: idleOp,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: false,
        workflowState: workflow,
        semanticPreparing: false,
        semanticAvailable: true,
      })
    );

    expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida disponível");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("A preparar");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.freshness.embeddings.humanText).toContain("Atualizado");
    expect(vm.freshness.embeddings.humanText).not.toContain("Atualização necessária");
    expect(workflow.canUpdate).toBe(false);
  });

  // Caso 2 — Drift + manual
  it("Caso 2: displays 'Atualização necessária' and allows update button without false 'A preparar...' or 'Prontos'", () => {
    const idleOp: EmbeddingOperationState = {
      status: "idle",
      phase: "idle",
      processedChunks: 0,
      totalChunks: 0,
    };
    const driftWork: EmbeddingWorkRuntimeState = {
      status: "ready",
      revision: 2,
      workAvailable: true,
    };

    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWork,
      operationState: idleOp,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
        workflowState: workflow,
        semanticPreparing: false,
        semanticAvailable: true,
      })
    );

    // Headline remains available (Read Path)
    expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida disponível");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("A preparar");
    // Freshness clearly indicates update required (Write Path)
    expect(vm.freshness.embeddings.status).toBe("stale");
    expect(vm.freshness.embeddings.humanText).toContain("Atualização necessária");
    expect(vm.freshness.embeddings.humanText).not.toContain("Prontos");
    expect(vm.freshness.embeddings.humanText).not.toContain("A preparar");
    // Button is enabled
    expect(workflow.canUpdate).toBe(true);
    expect(workflow.status).toBe("update-required");
  });

  // Caso 2 EN: English strings
  it("Caso 2 (EN): displays 'Hybrid search available' and 'Update required' with update button in English", () => {
    const idleOp: EmbeddingOperationState = {
      status: "idle",
      phase: "idle",
      processedChunks: 0,
      totalChunks: 0,
    };
    const driftWork: EmbeddingWorkRuntimeState = {
      status: "ready",
      revision: 2,
      workAvailable: true,
    };

    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWork,
      operationState: idleOp,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
        workflowState: workflow,
        semanticPreparing: false,
        semanticAvailable: true,
        strings: stringsEn,
      })
    );

    expect(vm.searchAvailability.currentModeHeadline).toBe("Hybrid search available");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("Preparing");
    expect(vm.freshness.embeddings.humanText).toContain("Update required");
    expect(stringsEn.btnUpdateEmbeddings).toBe("Update embeddings");
    expect(workflow.canUpdate).toBe(true);
  });

  // Caso 3 — Real generation running
  it("Caso 3: only displays 'A preparar pesquisa semântica...' when generation is actively running", () => {
    const preparingOp: EmbeddingOperationState = {
      status: "running",
      phase: "preparing",
      processedChunks: 0,
      totalChunks: 10,
    };
    const driftWork: EmbeddingWorkRuntimeState = {
      status: "ready",
      revision: 2,
      workAvailable: true,
    };

    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWork,
      operationState: preparingOp,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
        workflowState: workflow,
        semanticPreparing: true, // true because operation is running
        semanticAvailable: true,
      })
    );

    expect(vm.searchAvailability.currentModeHeadline).toContain("A preparar pesquisa semântica");
    expect(workflow.status).toBe("preparing");
    expect(workflow.operationRunning).toBe(true);
    expect(workflow.canUpdate).toBe(false); // cannot trigger another generation while running
  });

  // Caso 7 — Elimination of competing channels and contradictory messages
  it("Caso 7: ensures the sidebar never presents 'Atualização necessária' and 'Prontos' simultaneously", () => {
    const idleOp: EmbeddingOperationState = {
      status: "idle",
      phase: "idle",
      processedChunks: 0,
      totalChunks: 0,
    };
    const driftWork: EmbeddingWorkRuntimeState = {
      status: "ready",
      revision: 2,
      workAvailable: true,
    };

    const workflow = resolveEmbeddingWorkflowState({
      workState: driftWork,
      operationState: idleOp,
      isAuthorizedProducer: true,
      textIndexReady: true,
    });

    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
        workflowState: workflow,
        semanticPreparing: false,
        semanticAvailable: true,
      })
    );

    // Accordion says "Atualização necessária"
    expect(vm.freshness.embeddings.humanText).toContain("Atualização necessária");

    // Invariant: Headline and freshness MUST NOT say "Prontos" or "A preparar..."
    expect(vm.freshness.embeddings.humanText).not.toContain("Prontos");
    expect(vm.freshness.embeddings.humanText).not.toContain("A preparar");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("Prontos");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("A preparar");
  });

  // Binary copy phases never trigger semanticPreparing
  it("ensures binary copy maintenance phases do not trigger semanticPreparing", () => {
    // When binary maintenance is queued, reading-jsonl, or building
    const binaryPhases = ["queued", "reading-jsonl", "building", "digesting", "publishing", "validating"] as const;

    for (const phase of binaryPhases) {
      const workflow = resolveEmbeddingWorkflowState({
        workState: { status: "ready", revision: 1, workAvailable: true },
        operationState: { status: "idle", phase: "idle", processedChunks: 0, totalChunks: 0 },
        binaryMaintenancePhase: phase,
        isAuthorizedProducer: true,
        textIndexReady: true,
      });

      // Crucial: status must be update-required, NEVER preparing!
      expect(workflow.status).toBe("update-required");
      expect(workflow.status).not.toBe("preparing");
    }
  });

  // Source-level invariant tests on LinaSearchView
  it("enforces that LinaSearchView eliminates contradictory statusEl writes and wires contextual update button", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");

    // 1. Contextual button condition
    expect(source).toContain("const showUpdateEmbeddingsButton =");
    expect(source).toContain("isAuthorizedProducer === true &&");
    expect(source).toContain("embeddingWorkState?.workAvailable === true &&");
    expect(source).toContain('embeddingOperationState.status !== "running" &&');
    expect(source).toContain('embeddingOperationState.status !== "cancelling" &&');
    expect(source).toContain("indexReady === true;");

    // 2. Button class and action
    expect(source).toContain('cls: "lina-sidebar-update-btn mod-cta"');
    expect(source).toContain('this.plugin.confirmAndRequestEmbeddingGeneration("sidebar")');

    // 3. Elimination of contradictory statusEl calls
    expect(source).not.toContain("this.setStatus(semanticPreparing");
    expect(source).not.toContain("? this.L.stateEmbeddingsReady");
  });
});
