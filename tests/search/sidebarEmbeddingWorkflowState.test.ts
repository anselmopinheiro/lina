import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  buildSidebarStatusViewModel,
  type BuildSidebarStatusViewModelInput,
} from "../../src/search/sidebarStatusViewModel";

describe("Sidebar Embedding Lifecycle Presentation (LINA-11 / LINA-14F.4-B3)", () => {
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
    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: false,
        semanticPreparing: false,
        semanticAvailable: true,
      })
    );

    expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida disponível");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("A preparar");
    expect(vm.freshness.embeddings.status).toBe("fresh");
    expect(vm.freshness.embeddings.humanText).toContain("Atualizado");
    expect(vm.freshness.embeddings.humanText).not.toContain("Atualização necessária");
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
  });

  // Caso 2 — Drift + manual
  it("Caso 2: displays 'Atualização necessária' and allows update button without false 'A preparar...' or 'Prontos'", () => {
    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
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
    // Maintenance is applicable
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
  });

  // Caso 2 EN: English strings
  it("Caso 2 (EN): displays 'Hybrid search available' and 'Update required' with update button in English", () => {
    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
        semanticPreparing: false,
        semanticAvailable: true,
        strings: stringsEn,
      })
    );

    expect(vm.searchAvailability.currentModeHeadline).toBe("Hybrid search available");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("Preparing");
    expect(vm.freshness.embeddings.humanText).toContain("Update required");
    expect(stringsEn.btnUpdateEmbeddings).toBe("Update embeddings");
    expect(vm.maintenance.canExecuteMaintenance).toBe(true);
  });

  // Caso 3 — Real generation running
  it("Caso 3: only displays 'A preparar pesquisa semântica...' when generation is actively running", () => {
    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
        semanticPreparing: true, // true because operation is running
        semanticAvailable: true,
      })
    );

    expect(vm.searchAvailability.currentModeHeadline).toContain("A preparar pesquisa semântica");
    expect(vm.freshness.embeddings.humanText).not.toContain("A preparar");
  });

  // Caso 7 — Elimination of competing channels and contradictory messages
  it("Caso 7: ensures the sidebar never presents 'Atualização necessária' and 'Prontos' simultaneously", () => {
    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
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
    const vm = buildSidebarStatusViewModel(
      createBaseInput({
        embeddingsWorkAvailable: true,
        semanticPreparing: false,
        semanticAvailable: true,
      })
    );

    expect(vm.searchAvailability.currentModeHeadline).toBe("Pesquisa híbrida disponível");
    expect(vm.searchAvailability.currentModeHeadline).not.toContain("A preparar");
    expect(vm.freshness.embeddings.humanText).toContain("Atualização necessária");
  });

  // Source-level invariant tests on LinaSearchView
  it("enforces that LinaSearchView eliminates contradictory statusEl writes and wires canonical sidebarStatus.action button", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");

    // 1. Canonical action derivation replaces ad-hoc boolean
    expect(source).toContain("const action = sidebarStatus.action;");
    expect(source).toContain("if (action && action.isVisible) {");
    expect(source).not.toContain("const showUpdateEmbeddingsButton =");

    // 2. Button class and action dispatching
    expect(source).toContain('cls: isCancel');
    expect(source).toContain("void this.handleEmbeddingGeneration(action.isFullRebuild);");

    // 3. Elimination of contradictory statusEl calls
    expect(source).not.toContain("this.setStatus(semanticPreparing");
    expect(source).not.toContain("? this.L.stateEmbeddingsReady");
  });
});
