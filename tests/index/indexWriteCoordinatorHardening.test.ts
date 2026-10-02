import { describe, expect, it } from "vitest";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";

function accepted<T extends { status: string; token?: unknown }>(result: T) {
  expect(result.status).toBe("accepted");
  return result.token as NonNullable<T["token"]> & { kind: string; id: number };
}

describe("LINA-15H-C — IndexWriteCoordinator hardening", () => {
  it("rejects a second automatic batch while one is active", () => {
    const coordinator = new IndexWriteCoordinator();
    const a = coordinator.startAutomaticBatch();
    expect(a.status).toBe("accepted");
    expect(coordinator.startAutomaticBatch().status).toBe("text-index-busy");
    expect(coordinator.getState().activeOperation).toBe("text-automatic-batch");
  });

  it("keeps batch A active when a rejected batch B is finished with a missing token", () => {
    const coordinator = new IndexWriteCoordinator();
    accepted(coordinator.startAutomaticBatch());
    const rejected = coordinator.startAutomaticBatch();
    coordinator.finish((rejected as { token?: never }).token);
    expect(coordinator.getState().activeOperation).toBe("text-automatic-batch");
  });

  it("does not accept a generation while an automatic batch is active, even after a rejected duplicate", () => {
    const coordinator = new IndexWriteCoordinator();
    accepted(coordinator.startAutomaticBatch());
    coordinator.startAutomaticBatch();
    expect(coordinator.startEmbeddingGeneration().status).toBe("text-index-busy");
  });

  it("rejects a text rebuild while any incompatible operation is active", () => {
    const batch = new IndexWriteCoordinator();
    batch.startAutomaticBatch();
    expect(batch.startTextRebuild().status).toBe("text-index-busy");

    const rebuild = new IndexWriteCoordinator();
    rebuild.startTextRebuild();
    expect(rebuild.startTextRebuild().status).toBe("text-index-busy");

    const maintenance = new IndexWriteCoordinator();
    maintenance.startCanonicalMaintenance();
    expect(maintenance.startTextRebuild().status).toBe("text-index-busy");

    const generation = new IndexWriteCoordinator();
    generation.startEmbeddingGeneration();
    expect(generation.startTextRebuild().status).toBe("embedding-generation-active");
  });

  it("preserves existing exclusions: rebuild blocks batches and binary maintenance blocks both", () => {
    const rebuild = new IndexWriteCoordinator();
    rebuild.startTextRebuild();
    expect(rebuild.startAutomaticBatch().status).toBe("text-index-busy");
    expect(rebuild.startEmbeddingGeneration().status).toBe("text-index-busy");

    const binary = new IndexWriteCoordinator();
    accepted(binary.startBinaryMaintenance());
    expect(binary.startAutomaticBatch().status).toBe("embedding-generation-active");
    expect(binary.startTextRebuild().status).toBe("embedding-generation-active");
    expect(binary.startEmbeddingGeneration().status).toBe("text-index-busy");

    const idle = new IndexWriteCoordinator();
    expect(idle.startEmbeddingGeneration().status).toBe("accepted");
  });

  it("a finished token cannot release a later operation of the same kind", () => {
    const coordinator = new IndexWriteCoordinator();
    const first = accepted(coordinator.startAutomaticBatch());
    coordinator.finish(first);
    const second = accepted(coordinator.startAutomaticBatch());
    expect(second.id).not.toBe(first.id);
    coordinator.finish(first);
    expect(coordinator.getState().activeOperation).toBe("text-automatic-batch");
    coordinator.finish(second);
    expect(coordinator.getState().activeOperation).toBeNull();
  });

  it("a stale token cannot release an operation of another kind", () => {
    const coordinator = new IndexWriteCoordinator();
    const batch = accepted(coordinator.startAutomaticBatch());
    coordinator.finish(batch);
    accepted(coordinator.startCanonicalMaintenance());
    coordinator.finish(batch);
    expect(coordinator.getState().activeOperation).toBe("canonical-maintenance");
  });

  describe("canonical maintenance (purge) lease", () => {
    it("is exclusive against generation, preparation, batches, rebuild and binary maintenance", () => {
      const coordinator = new IndexWriteCoordinator();
      const lease = accepted(coordinator.startCanonicalMaintenance());
      expect(coordinator.startEmbeddingGeneration().status).toBe("text-index-busy");
      expect(coordinator.requestEmbeddingGenerationPreparation().status).toBe("text-index-busy");
      expect(coordinator.startAutomaticBatch().status).toBe("text-index-busy");
      expect(coordinator.startAutomaticBatch({ allowEmbeddingReservation: true }).status).toBe("text-index-busy");
      expect(coordinator.startTextRebuild().status).toBe("text-index-busy");
      expect(coordinator.startBinaryMaintenance().status).toBe("text-index-busy");
      expect(coordinator.startCanonicalMaintenance().status).toBe("text-index-busy");
      coordinator.finish(lease);
      expect(coordinator.startEmbeddingGeneration().status).toBe("accepted");
    });

    it.each([
      ["generation", (c: IndexWriteCoordinator) => c.startEmbeddingGeneration()],
      ["text rebuild", (c: IndexWriteCoordinator) => c.startTextRebuild()],
      ["automatic batch", (c: IndexWriteCoordinator) => c.startAutomaticBatch()],
      ["binary maintenance", (c: IndexWriteCoordinator) => c.startBinaryMaintenance()],
    ])("is refused while %s is active", (_name, start) => {
      const coordinator = new IndexWriteCoordinator();
      start(coordinator);
      expect(coordinator.startCanonicalMaintenance().status).not.toBe("accepted");
    });

    it("is refused while a generation reservation is pending and after dispose", () => {
      const reserved = new IndexWriteCoordinator();
      reserved.requestEmbeddingGenerationPreparation();
      expect(reserved.startCanonicalMaintenance().status).not.toBe("accepted");

      const disposed = new IndexWriteCoordinator();
      disposed.dispose();
      expect(disposed.startCanonicalMaintenance().status).toBe("disposed");
    });
  });
});
