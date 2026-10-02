import { buildEmbeddingVmForScenario } from "../helpers/embeddingStatusScenario";
import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { buildEmbeddingStatusViewModel } from "../../src/search/embeddingStatusViewModel";
import type { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import type { EmbeddingWorkRuntimeState } from "../../src/index/embeddingWorkStatusController";
import { type EmbeddingLifecycleSnapshot, resolveEmbeddingLifecycle } from "../../src/index/embeddingLifecycleModel";
import { deriveEmbeddingWritePathDecision } from "../../src/index/embeddingLifecycleWritePath";

const L = getStrings("pt-PT");
type Input = Parameters<typeof resolveEmbeddingLifecycle>[0];

const identity = {
  provider: "ollama",
  model: "nomic-embed-text",
  dimensions: 768,
  inputVersion: 1,
  prefixMode: "none",
  contractId: "ollama:nomic-embed-text:768:1:none",
} as const;

function snap(overrides: Partial<Input> = {}): EmbeddingLifecycleSnapshot {
  return resolveEmbeddingLifecycle({
    revision: 1,
    computedAt: new Date().toISOString(),
    deviceRole: "producer",
    isActiveProducer: true,
    embeddingsEnabled: true,
    upstreamTextIndex: "ready",
    canonicalExists: true,
    validForSearchCount: 100,
    activeSource: "jsonl",
    publishedIdentity: identity,
    deviceIdentity: identity,
    workAssessment: { kind: "none", updateRequired: false, severity: "none", cost: "none", reasons: [] },
    ...overrides,
  });
}

const pending = (mode: "initial-build" | "incremental" | "full-rebuild") => ({
  kind: "pending" as const,
  mode,
  updateRequired: true,
  severity: "info" as const,
  cost: "local" as const,
  reasons: ["test"],
});

const idle: EmbeddingOperationState = {
  operationId: null, origin: null, status: "idle", startedAt: null, finishedAt: null, message: null,
  error: null, phase: null, totalChunks: null, processedChunks: 0, generatedChunks: 0, failedChunks: 0,
  reusedChunks: 0, percentage: null, currentChunk: null, cancelRequestedAt: null,
};
const work: EmbeddingWorkRuntimeState = { status: "ready", revision: 1, calculatedRevision: 1, workAvailable: false };

function actions(snapshot: EmbeddingLifecycleSnapshot, embeddingsReady = false) {
  return buildEmbeddingVmForScenario({
    workState: work,
    operationState: idle,
    configuredProvider: "ollama",
    configuredModel: "nomic-embed-text",
    indexReady: true,
    embeddingsReady,
    strings: L,
    lifecycleSnapshot: snapshot,
  }).actions;
}

describe("embedding status UI actions derive from the canonical write-path decision (LINA-14F.4-B4.1)", () => {
  it("READY without work: refresh only", () => {
    expect(actions(snap()).map((a) => a.kind)).toEqual(["refresh-status"]);
  });

  it("UPDATE_AVAILABLE: update", () => {
    const s = snap({ workAssessment: pending("incremental") });
    expect(deriveEmbeddingWritePathDecision(s).action).toBe("update");
    expect(actions(s)).toContainEqual({ kind: "update", label: L.btnUpdateEmbeddings, disabled: false, requiresFullRebuildConfirmation: false });
  });

  it("INDEX_ONLY: generate", () => {
    const s = snap({ canonicalExists: false, validForSearchCount: 0, publishedIdentity: undefined, workAssessment: pending("initial-build") });
    expect(deriveEmbeddingWritePathDecision(s).action).toBe("generate");
    expect(actions(s).map((a) => a.kind)).toEqual(["refresh-status", "generate"]);
  });

  it("INCOMPATIBLE / full-rebuild: rebuild with confirmation", () => {
    const s = snap({ workAssessment: pending("full-rebuild") });
    expect(actions(s)).toContainEqual({ kind: "rebuild", label: L.btnRebuildEmbeddings, disabled: false, requiresFullRebuildConfirmation: true });
  });

  it("ERROR: retry is presented as the work it repeats and is enabled only when executable", () => {
    const s = snap({
      workAssessment: pending("incremental"),
      operationState: { status: "failed", error: "boom" },
    });
    const d = deriveEmbeddingWritePathDecision(s);
    expect(d.action).toBe("retry");
    const a = actions(s).find((x) => x.kind !== "refresh-status");
    expect(a?.kind).toBe("update");
    expect(a?.disabled).toBe(!d.canExecute);
  });

  it("Companion: no write action", () => {
    const s = snap({ deviceRole: "companion", isActiveProducer: false, workAssessment: pending("incremental") });
    expect(actions(s).map((a) => a.kind)).toEqual(["refresh-status"]);
  });

  it("Standby Producer: no write action", () => {
    const s = snap({ deviceRole: "producer", isActiveProducer: false, workAssessment: pending("incremental") });
    expect(actions(s).map((a) => a.kind)).toEqual(["refresh-status"]);
  });

  it("INDETERMINATE: no write action", () => {
    const s = snap({ workAssessment: { kind: "indeterminate", updateRequired: false, severity: "none", cost: "none", reasons: ["canonical-unreadable"] } });
    expect(actions(s).map((a) => a.kind)).toEqual(["refresh-status"]);
  });

  it("retained legacy guard: no calculated details and vectors reported present offers no initial build", () => {
    const s = snap({ canonicalExists: false, validForSearchCount: 0, publishedIdentity: undefined, workAssessment: pending("initial-build") });
    expect(actions(s, true).map((a) => a.kind)).toEqual(["refresh-status"]);
  });

  it("the write action never disagrees with the canonical decision", () => {
    for (const mode of ["initial-build", "incremental", "full-rebuild"] as const) {
      const s = snap({ workAssessment: pending(mode) });
      const d = deriveEmbeddingWritePathDecision(s);
      const write = actions(s).filter((a) => a.kind !== "refresh-status");
      expect(write.map((a) => a.kind)).toEqual(d.action === "none" ? [] : [d.action]);
    }
  });
});
