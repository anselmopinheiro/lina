import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  EMBEDDING_PERSISTENCE_FILES as files,
  inspectCanonicalPair,
  publishCanonicalEmbeddings,
  purgeOrphanEmbeddingsCoordinated,
  recoverEmbeddingPersistenceArtifacts,
  runCanonicalMaintenance,
  type EmbeddingWriteFence,
} from "../../src/index/embeddingPersistence";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import { OwnershipGate } from "../../src/device/ownershipGate";
import { getOwnershipPath } from "../../src/device/deviceOwnership";
import { saveTextIndex } from "../../src/index/indexStore";
import { chunkText } from "../../src/index/chunker";
import { readEmbeddingStatus } from "../../src/index/embeddingGenerator";

vi.stubGlobal("window", { setTimeout });

type FakeOps = ConstructorParameters<typeof FakeAdapter>[1];
const app = (adapter: FakeAdapter): App => ({ vault: { adapter, configDir: ".obsidian" } }) as unknown as App;
const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  chunkId: id, path: "N.md", index: 0, textHash: `h${id}`, model: "m1", provider: "ollama", dimensions: 3,
  embedding: [0.1, 0.2, 0.3], createdAt: "2026-01-01T00:00:00Z", ...extra,
});
const info = { provider: "ollama", model: "m1", dimensions: 3, inputVersion: 1, prefixMode: "none" as const };
const chunks = (...ids: string[]) => ids.map((chunkId) => ({ chunkId, path: "N.md" }));
const okFence: EmbeddingWriteFence = { assertCurrent: async () => true };
const acquireOk = async () => okFence;
const real = chunkText("N.md", "Hello world. A reasonably long note body used for chunking. ".repeat(40), { chunkSize: 1200, overlap: 150 });
const notes = [{ path: "N.md", basename: "N", extension: "md", size: 1, mtime: 1, contentHash: "x", indexedAt: "t" }];

async function createPair(ids: string[] = ["a", "b", "c"], options?: FakeOps) {
  const adapter = new FakeAdapter();
  await saveTextIndex(app(adapter), notes, real, { enabled: true, chunkSize: 1200, overlap: 150 });
  expect((await publishCanonicalEmbeddings(app(adapter), ids.map((id) => rec(id)), info)).success).toBe(true);
  if (options) adapter.setOptions(options);
  return adapter;
}
const jsonlIds = (adapter: FakeAdapter) => (adapter.getFile(files.canonicalEmbeddings) ?? "").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { chunkId: string }).chunkId);
const manifestOf = (adapter: FakeAdapter) => JSON.parse(adapter.getFile(files.canonicalManifest) ?? "null") as Record<string, unknown> | null;
const mutations = (adapter: FakeAdapter) => adapter.writeCount + adapter.removeCount + adapter.renameCount + adapter.mkdirCount;
const snapshot = (adapter: FakeAdapter) => Object.fromEntries(adapter.listFiles().sort().map((p) => [p, adapter.getFile(p)]));
const pairState = (adapter: FakeAdapter) => inspectCanonicalPair(adapter.getFile(files.canonicalEmbeddings), manifestOf(adapter));

describe("LINA-15H-C — coordinated canonical purge", () => {
  describe("canonical pair validation", () => {
    it("purges orphans from a consistent pair, keeps the rest and reports the mutation", async () => {
      const adapter = await createPair();
      const coordinator = new IndexWriteCoordinator();
      const onPurged = vi.fn();
      const result = await purgeOrphanEmbeddingsCoordinated(app(adapter), coordinator, async () => okFence, chunks("a", "b"), undefined, { onPurged });
      expect(result).toMatchObject({ status: "purged", purgedCount: 1, remainingCount: 2 });
      expect(jsonlIds(adapter)).toEqual(["a", "b"]);
      expect(pairState(adapter)).toBe("consistent");
      expect(onPurged).toHaveBeenCalledTimes(1);
      expect(coordinator.getState().activeOperation).toBeNull();
    });

    const refusals: Array<[string, (adapter: FakeAdapter) => void, string]> = [
      ["inconsistent (truncated on a line boundary)", (a) => a.setFile(files.canonicalEmbeddings, (a.getFile(files.canonicalEmbeddings) ?? "").split("\n").slice(0, 2).join("\n") + "\n"), "canonical-pair-inconsistent"],
      ["unreadable (invalid manifest)", (a) => a.setFile(files.canonicalManifest, "{"), "canonical-manifest-unreadable"],
      ["unverifiable-legacy (no publicationId)", (a) => {
        const manifest = JSON.parse(a.getFile(files.canonicalManifest) ?? "{}") as { embeddings: Record<string, unknown> };
        delete manifest.embeddings.publicationId;
        a.setFile(files.canonicalManifest, JSON.stringify(manifest));
      }, "canonical-pair-unverifiable-legacy"],
      ["resource-limit-exceeded", (a) => {
        const original = a.stat.bind(a);
        a.stat = async (path) => path === files.canonicalEmbeddings ? { type: "file", size: 60 * 1024 * 1024, mtime: 1 } : original(path);
      }, "resource-limit-exceeded"],
    ];
    it.each(refusals)("refuses a %s pair without any mutation or invalidation", async (_name, corrupt, reason) => {
      const adapter = await createPair();
      corrupt(adapter);
      const before = snapshot(adapter);
      adapter.writeCount = adapter.removeCount = adapter.renameCount = adapter.mkdirCount = 0;
      const onPurged = vi.fn();
      const result = await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), async () => okFence, chunks("a"), undefined, { onPurged });
      expect(result).toMatchObject({ status: "refused", reason, purgedCount: 0 });
      expect(mutations(adapter)).toBe(0);
      expect(snapshot(adapter)).toEqual(before);
      expect(onPurged).not.toHaveBeenCalled();
    });

    it("does nothing (and does not invalidate) when there is nothing to purge", async () => {
      const adapter = await createPair();
      const onPurged = vi.fn();
      const result = await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), async () => okFence, chunks("a", "b", "c"), undefined, { onPurged });
      expect(result.status).toBe("unchanged");
      expect(onPurged).not.toHaveBeenCalled();
    });
  });

  describe("ownership / fence", () => {
    it("never writes without a valid fence and never claims ownership", async () => {
      const adapter = await createPair();
      const gate = new OwnershipGate(adapter, () => "c9bf9e57-1685-4c89-bafb-ff5af830be8a", () => "producer", true);
      expect(adapter.hasFile(getOwnershipPath())).toBe(false);
      const before = snapshot(adapter);
      adapter.writeCount = adapter.removeCount = adapter.renameCount = adapter.mkdirCount = 0;
      const onPurged = vi.fn();
      const result = await purgeOrphanEmbeddingsCoordinated(
        app(adapter), new IndexWriteCoordinator(),
        async () => {
          const token = await gate.acquireFence({ autoClaimIfUnclaimed: false });
          return token ? { assertCurrent: () => gate.assertFence(token) } : undefined;
        },
        chunks("a"), undefined, { onPurged });
      expect(result).toMatchObject({ status: "refused", reason: "ownership-fence-rejected" });
      expect(adapter.hasFile(getOwnershipPath())).toBe(false);
      expect(mutations(adapter)).toBe(0);
      expect(snapshot(adapter)).toEqual(before);
      expect(onPurged).not.toHaveBeenCalled();
    });

    it("releases the lease when the fence is refused", async () => {
      const coordinator = new IndexWriteCoordinator();
      const adapter = await createPair();
      await purgeOrphanEmbeddingsCoordinated(app(adapter), coordinator, async () => undefined, chunks("a"));
      expect(coordinator.getState().activeOperation).toBeNull();
    });

    it("an ownership revocation between mutations leaves a state the existing recovery restores", async () => {
      for (let revokeAfter = 1; revokeAfter <= 6; revokeAfter++) {
        const adapter = await createPair();
        let calls = 0;
        const fence: EmbeddingWriteFence = { assertCurrent: async () => ++calls <= revokeAfter };
        try {
          await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), async () => fence, chunks("a", "b"));
        } catch {
          // a revoked fence aborts the purge; the recovery below decides the final state
        }
        await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
        expect(pairState(adapter), `revoke after ${revokeAfter}`).toBe("consistent");
        expect(["a,b,c", "a,b"]).toContain(jsonlIds(adapter).join(","));
      }
    });

    it("does not roll back the all-purged publication after fence rejection (P6)", async () => {
      const adapter = await createPair();
      let checks = 0;
      let rejected = false;
      let mutationsAfterRejection = 0;
      const fence: EmbeddingWriteFence = { assertCurrent: async () => {
        const current = ++checks <= 4;
        if (!current) rejected = true;
        return current;
      } };
      adapter.setOptions({ beforeOperation: (operation) => {
        if (rejected && ["write", "remove", "rename", "mkdir"].includes(operation)) mutationsAfterRejection++;
      } });

      await expect(purgeOrphanEmbeddingsCoordinated(
        app(adapter), new IndexWriteCoordinator(), async () => fence, chunks("zzz"),
      )).rejects.toThrow("Ownership fence rejected");
      adapter.setOptions({ beforeOperation: undefined });

      expect(rejected).toBe(true);
      expect(mutationsAfterRejection).toBe(0);
      expect(adapter.hasFile(files.embeddingsPublishBackup)).toBe(true);
      expect(adapter.hasFile(files.manifestPublishBackup)).toBe(true);
      await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
      expect(pairState(adapter)).toBe("consistent");
      expect(jsonlIds(adapter)).toEqual(["a", "b", "c"]);
    });
  });

  describe("purge × generation (probe q2-A) and purge × saveTextIndex (probe q2-B)", () => {
    it("never reverts a newer publication: the generation lease serializes both operations", async () => {
      const adapter = await createPair(["a", "b", "c"]);
      const coordinator = new IndexWriteCoordinator();
      const generation = coordinator.startEmbeddingGeneration();
      expect(generation.status).toBe("accepted");

      const refused = await purgeOrphanEmbeddingsCoordinated(app(adapter), coordinator, acquireOk, chunks("a", "b", "d"));
      expect(refused).toMatchObject({ status: "refused", reason: "index-write-busy" });

      await publishCanonicalEmbeddings(app(adapter), ["a", "b", "c", "d"].map((id) => rec(id)), info);
      coordinator.finish(generation.token);

      const purged = await purgeOrphanEmbeddingsCoordinated(app(adapter), coordinator, acquireOk, chunks("a", "b", "d"));
      expect(purged.status).toBe("purged");
      expect(jsonlIds(adapter)).toEqual(["a", "b", "d"]);
      expect(pairState(adapter)).toBe("consistent");
    });

    it("blocks a generation that tries to start in the middle of a purge", async () => {
      const adapter = await createPair(["a", "b", "c"]);
      const coordinator = new IndexWriteCoordinator();
      let intruder: string | undefined;
      let intruded = false;
      adapter.setOptions({
        beforeOperation: async (operation, path) => {
          if (intruded || operation !== "write" || path !== files.embeddingsPublishTemporary) return;
          intruded = true;
          const attempt = coordinator.startEmbeddingGeneration();
          intruder = attempt.status;
          if (attempt.status === "accepted") await publishCanonicalEmbeddings(app(adapter), ["a", "b", "c", "d"].map((id) => rec(id)), info);
        },
      });
      const result = await purgeOrphanEmbeddingsCoordinated(app(adapter), coordinator, acquireOk, chunks("a", "b"));
      expect(intruded).toBe(true);
      expect(intruder).not.toBe("accepted");
      expect(result.status).toBe("purged");
      expect(jsonlIds(adapter)).toEqual(["a", "b"]);
    });

    it("keeps the embeddings section when the shared manifest is republished under the lease", async () => {
      const adapter = await createPair(["a", "b"]);
      const coordinator = new IndexWriteCoordinator();
      let attempts: string[] = [];
      adapter.setOptions({
        beforeOperation: async (operation, path) => {
          if (operation !== "write" || !path.includes("text-manifest.publish.tmp") || attempts.length) return;
          attempts = [
            coordinator.startEmbeddingGeneration().status,
            coordinator.startAutomaticBatch().status,
            coordinator.startTextRebuild().status,
          ];
        },
      });
      const outcome = await runCanonicalMaintenance(coordinator, acquireOk, async () =>
        saveTextIndex(app(adapter), notes, real, { enabled: true, chunkSize: 1200, overlap: 150 }));
      expect(outcome).toEqual({ status: "completed", value: true });
      expect(attempts).toEqual(["text-index-busy", "text-index-busy", "text-index-busy"]);
      expect(pairState(adapter)).toBe("consistent");
      expect((await readEmbeddingStatus(app(adapter)))?.canonicalPairState).toBe("consistent");
    });

    it("blocks a purge while a text rebuild or an automatic batch is active", async () => {
      for (const start of [(c: IndexWriteCoordinator) => c.startTextRebuild(), (c: IndexWriteCoordinator) => c.startAutomaticBatch()]) {
        const adapter = await createPair();
        const coordinator = new IndexWriteCoordinator();
        start(coordinator);
        const before = snapshot(adapter);
        const result = await purgeOrphanEmbeddingsCoordinated(app(adapter), coordinator, acquireOk, chunks("a"));
        expect(result).toMatchObject({ status: "refused", reason: "index-write-busy" });
        expect(snapshot(adapter)).toEqual(before);
      }
    });
  });

  describe("invalidation hook", () => {
    it("fires once on success and never on refusal, busy lease or missing fence", async () => {
      const onPurged = vi.fn();
      const adapter = await createPair();
      const busy = new IndexWriteCoordinator();
      busy.startEmbeddingGeneration();
      await purgeOrphanEmbeddingsCoordinated(app(adapter), busy, acquireOk, chunks("a"), undefined, { onPurged });
      await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), async () => undefined, chunks("a"), undefined, { onPurged });
      expect(onPurged).not.toHaveBeenCalled();
      await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), acquireOk, chunks("a", "b"), undefined, { onPurged });
      expect(onPurged).toHaveBeenCalledTimes(1);
    });
  });

  describe('"all purged" branch (option P1)', () => {
    it("publishes the manifest by tmp + backup + rename, never in place, and leaves no residue", async () => {
      const adapter = await createPair();
      adapter.writtenPaths = [];
      const result = await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), acquireOk, chunks("zzz"));
      expect(result).toMatchObject({ status: "purged", remainingCount: 0, purgedCount: 3 });
      expect(adapter.writtenPaths).not.toContain(files.canonicalManifest);
      expect(adapter.writtenPaths).toContain(files.manifestPublishTemporary);
      const manifest = manifestOf(adapter);
      expect(manifest).toMatchObject({ embeddingsEnabled: false, indexType: "text" });
      expect(manifest).not.toHaveProperty("embeddings");
      expect(adapter.hasFile(files.canonicalEmbeddings)).toBe(false);
      for (const leftover of [files.manifestPublishTemporary, files.manifestPublishBackup, files.embeddingsPublishBackup]) {
        expect(adapter.hasFile(leftover)).toBe(false);
      }
      expect(pairState(adapter)).toBe("absent");
    });

    it("rolls back to the previous coherent pair when the final validation fails", async () => {
      const adapter = await createPair();
      const original = adapter.read.bind(adapter);
      let reads = 0;
      adapter.read = async (path) => {
        const content = await original(path);
        if (path === files.canonicalManifest && ++reads === 2) return JSON.stringify({ embeddingsEnabled: true });
        return content;
      };
      await expect(purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), acquireOk, chunks("zzz"))).rejects.toThrow();
      expect(pairState(adapter)).toBe("consistent");
      expect(jsonlIds(adapter)).toEqual(["a", "b", "c"]);
    });

    it("crash matrix: every crash point recovers to the previous pair or to the disabled state, never a partial manifest", async () => {
      const mutating = new Set(["write", "remove", "rename", "mkdir"]);
      let total = 0;
      {
        const adapter = await createPair();
        adapter.setOptions({ shouldFail: (op) => { if (mutating.has(op)) total++; return false; } });
        await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), acquireOk, chunks("zzz"));
      }
      expect(total).toBeGreaterThanOrEqual(6);
      const outcomes: string[] = [];
      for (let n = 1; n <= total; n++) {
        const adapter = await createPair();
        let count = 0;
        let crashed = false;
        adapter.setOptions({ shouldFail: (op) => { if (crashed) return true; if (mutating.has(op) && ++count === n) { crashed = true; return true; } return false; } });
        await purgeOrphanEmbeddingsCoordinated(app(adapter), new IndexWriteCoordinator(), acquireOk, chunks("zzz")).catch(() => undefined);
        adapter.setOptions({ shouldFail: undefined });
        // the manifest is never observed partially written: it is either absent (mid-rename) or valid JSON
        if (adapter.hasFile(files.canonicalManifest)) expect(() => JSON.parse(adapter.getFile(files.canonicalManifest) ?? "")).not.toThrow();
        await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
        const manifest = manifestOf(adapter);
        expect(manifest, `manifest after crash ${n}`).not.toBeNull();
        const state = pairState(adapter);
        expect(["consistent", "absent"], `pair after crash ${n}`).toContain(state);
        if (state === "consistent") expect(jsonlIds(adapter)).toEqual(["a", "b", "c"]);
        outcomes.push(`${n}:${state}`);
      }
      expect(outcomes.length).toBe(total);
    });
  });
});
