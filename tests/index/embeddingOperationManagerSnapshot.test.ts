import { describe, expect, it } from "vitest";
import {
  type EmbeddingLifecycleSnapshot,
  resolveEmbeddingLifecycle,
} from "../../src/index/embeddingLifecycleModel";
import {
  deriveEmbeddingWritePathDecision,
  evaluateOperationStartGate,
} from "../../src/index/embeddingLifecycleWritePath";
import {
  EmbeddingOperationManager,
  type EmbeddingOperationContext,
  type EmbeddingOperationRunResult,
} from "../../src/index/embeddingOperationManager";

type LifecycleInput = Parameters<typeof resolveEmbeddingLifecycle>[0];

const identity = {
  provider: "ollama",
  model: "nomic-embed-text",
  dimensions: 768,
  inputVersion: 1,
  prefixMode: "none",
  contractId: "ollama:nomic-embed-text:768:1:none",
} as const;

function snapshot(overrides: Partial<LifecycleInput> = {}): EmbeddingLifecycleSnapshot {
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
    workAssessment: {
      kind: "pending",
      mode: "incremental",
      updateRequired: true,
      severity: "info",
      cost: "local",
      reasons: ["stale-chunks"],
    },
    ...overrides,
  });
}

function managerFor(getSnapshot: () => EmbeddingLifecycleSnapshot): EmbeddingOperationManager {
  return new EmbeddingOperationManager({
    getWritePathDecision: () => deriveEmbeddingWritePathDecision(getSnapshot()),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const okResult: EmbeddingOperationRunResult = { success: true, message: "done" };

describe("EmbeddingOperationManager — canonical snapshot consolidation (LINA-14F.4-B4.0-C)", () => {
  describe("start gate", () => {
    it("accepts an authorised Active Producer with pending work", async () => {
      const manager = managerFor(() => snapshot());
      const request = manager.request("command", async () => okResult);
      expect(request.status).toBe("accepted");
      if (request.status === "accepted") await request.completion;
    });

    it.each([
      ["UPDATE_AVAILABLE", snapshot()],
      [
        "INDEX_ONLY",
        snapshot({
          canonicalExists: false,
          validForSearchCount: 0,
          publishedIdentity: undefined,
          workAssessment: {
            kind: "pending",
            mode: "initial-build",
            updateRequired: true,
            severity: "info",
            cost: "local",
            reasons: ["no-embeddings"],
          },
        }),
      ],
    ])("accepts %s for a manual request", (_label, snap) => {
      const manager = managerFor(() => snap);
      expect(manager.request("sidebar", async () => okResult).status).toBe("accepted");
    });

    it("blocks a Companion device (no local operation ever starts)", () => {
      const manager = managerFor(() => snapshot({ deviceRole: "companion", isActiveProducer: false }));
      const request = manager.request("command", async () => okResult);
      expect(request).toMatchObject({ status: "blocked", reason: "companion" });
      expect(manager.getState().status).toBe("idle");
    });

    it("blocks a Standby Producer", () => {
      const manager = managerFor(() => snapshot({ deviceRole: "producer", isActiveProducer: false }));
      const request = manager.request("command", async () => okResult);
      expect(request.status).toBe("blocked");
      expect(manager.getState().status).toBe("idle");
    });

    it("blocks an INDETERMINATE state instead of treating it as normal", () => {
      const manager = managerFor(() =>
        snapshot({
          workAssessment: {
            kind: "indeterminate",
            updateRequired: false,
            severity: "none",
            cost: "none",
            reasons: ["canonical-unreadable"],
          },
        })
      );
      expect(manager.request("command", async () => okResult)).toMatchObject({
        status: "blocked",
        reason: "indeterminate",
      });
    });

    it("blocks an automatic start that needs confirmation (INCOMPATIBLE) but allows the manual one", () => {
      const incompatible = snapshot({
        workAssessment: {
          kind: "pending",
          mode: "full-rebuild",
          updateRequired: true,
          severity: "warning",
          cost: "local",
          reasons: ["model-changed"],
        },
      });
      const manager = managerFor(() => incompatible);
      expect(manager.request("automatic", async () => okResult)).toMatchObject({
        status: "blocked",
        reason: "confirmation-required",
      });
      expect(manager.request("command", async () => okResult).status).toBe("accepted");
    });

    it("allows a retry after ERROR (failed operation) for a manual request", async () => {
      const manager = managerFor(() => snapshot());
      const first = manager.request("command", async () => ({ success: false, message: "boom" }));
      if (first.status === "accepted") await first.completion;
      expect(manager.getState().status).toBe("failed");
      expect(manager.request("command", async () => okResult).status).toBe("accepted");
    });

    it("fails closed when the decision port throws (Zero Silent Fallback)", () => {
      const manager = new EmbeddingOperationManager({
        getWritePathDecision: () => {
          throw new Error("snapshot unavailable");
        },
      });
      expect(manager.request("command", async () => okResult)).toMatchObject({
        status: "blocked",
        reason: "indeterminate",
      });
    });

    it("keeps the standalone behaviour without a port", () => {
      const manager = new EmbeddingOperationManager();
      expect(manager.request("automatic", async () => okResult).status).toBe("accepted");
    });

    it("still reports already-running before evaluating the gate", () => {
      const pending = deferred<EmbeddingOperationRunResult>();
      const manager = managerFor(() => snapshot());
      manager.request("command", () => pending.promise);
      expect(manager.request("command", async () => okResult).status).toBe("already-running");
      pending.resolve(okResult);
    });
  });

  describe("shared start rule", () => {
    it("the gate rejects ownership loss during an active operation", () => {
      const lost = snapshot({
        isActiveProducer: false,
        operationState: { status: "running", phase: "generating", origin: "command" },
      });
      const decision = deriveEmbeddingWritePathDecision(lost);
      expect(decision.ownershipLostDuringOperation).toBe(true);
      expect(evaluateOperationStartGate(decision, "command")).toEqual({
        allowed: false,
        reason: "ownership-lost",
      });
    });
  });

  describe("cancellation", () => {
    function runningManager(getSnapshot: () => EmbeddingLifecycleSnapshot) {
      const manager = managerFor(getSnapshot);
      const pending = deferred<EmbeddingOperationRunResult>();
      let context: EmbeddingOperationContext | undefined;
      const request = manager.request("command", (ctx) => {
        context = ctx;
        return pending.promise;
      });
      expect(request.status).toBe("accepted");
      return { manager, pending, getContext: () => context };
    }

    it("cancels a generating operation", () => {
      const { manager, getContext } = runningManager(() =>
        snapshot({ operationState: { status: "running", phase: "generating" } })
      );
      expect(manager.cancelActiveOperation()).toBe("cancel-requested");
      expect(getContext()?.signal.aborted).toBe(true);
      expect(manager.getState().status).toBe("cancelling");
    });

    it("refuses to cancel when the snapshot is past the point of no return", () => {
      const { manager, getContext } = runningManager(() =>
        snapshot({ operationState: { status: "running", phase: "persisting" } })
      );
      expect(manager.cancelActiveOperation()).toBe("non-cancellable");
      expect(getContext()?.signal.aborted).toBe(false);
      expect(manager.getState().status).toBe("running");
    });

    it("refuses to cancel while finalizing", () => {
      const { manager } = runningManager(() =>
        snapshot({ operationState: { status: "running", phase: "finalizing" } })
      );
      expect(manager.cancelActiveOperation()).toBe("non-cancellable");
    });

    it("refuses to cancel when the manager itself is persisting, even with a stale idle snapshot", () => {
      const manager = managerFor(() => snapshot());
      const pending = deferred<EmbeddingOperationRunResult>();
      manager.request("command", (ctx) => {
        ctx.setPhase("persisting");
        return pending.promise;
      });
      expect(manager.cancelActiveOperation()).toBe("non-cancellable");
    });

    it("does not block cancel with a stale idle snapshot while generating", () => {
      const { manager } = runningManager(() => snapshot());
      expect(manager.cancelActiveOperation()).toBe("cancel-requested");
    });

    it("allows cancel when the decision port fails (safe direction)", () => {
      let fail = false;
      const manager = managerFor(() => {
        if (fail) throw new Error("boom");
        return snapshot();
      });
      manager.request("command", () => deferred<EmbeddingOperationRunResult>().promise);
      fail = true;
      expect(manager.cancelActiveOperation()).toBe("cancel-requested");
    });

    it("reports already-cancelling on repeated cancel", () => {
      const { manager } = runningManager(() => snapshot());
      manager.cancelActiveOperation();
      expect(manager.cancelActiveOperation()).toBe("already-cancelling");
    });

    it("returns no-active-operation for a Companion with nothing running", () => {
      const manager = managerFor(() => snapshot({ deviceRole: "companion", isActiveProducer: false }));
      expect(manager.cancelActiveOperation()).toBe("no-active-operation");
    });

    it("dispose() aborts unconditionally, even in persisting", () => {
      const { manager, getContext } = runningManager(() =>
        snapshot({ operationState: { status: "running", phase: "persisting" } })
      );
      manager.dispose();
      expect(getContext()?.signal.aborted).toBe(true);
    });
  });

  describe("legacy vs snapshot divergence", () => {
    it("the snapshot decision wins over permissive legacy manager state", () => {
      // Legacy manager (no port) would accept; the snapshot-backed manager refuses.
      const standby = snapshot({ deviceRole: "producer", isActiveProducer: false });
      expect(new EmbeddingOperationManager().request("command", async () => okResult).status).toBe("accepted");
      expect(managerFor(() => standby).request("command", async () => okResult).status).toBe("blocked");
    });
  });
});
