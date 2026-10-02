import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { App } from "obsidian";
import { FakeAdapter } from "../helpers/fakeAdapter";
import {
  EMBEDDING_PERSISTENCE_FILES as embeddingFiles,
  inspectCanonicalPair,
  publishCanonicalEmbeddings,
  recoverEmbeddingPersistenceArtifacts,
  runCanonicalMaintenance,
} from "../../src/index/embeddingPersistence";
import {
  TEXT_INDEX_PUBLICATION_FILES as text,
  readTextIndexStatus,
  recoverTextIndexPublication,
  saveTextIndex,
} from "../../src/index/indexStore";
import { IndexWriteFence } from "../../src/index/writeFence";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import { OwnershipGate } from "../../src/device/ownershipGate";
import { claimInitialOwnership, getOwnershipPath, transferOwnership } from "../../src/device/deviceOwnership";
import { chunkText } from "../../src/index/chunker";
import { readEmbeddingStatus } from "../../src/index/embeddingGenerator";

vi.stubGlobal("window", { setTimeout });

const app = (adapter: FakeAdapter): App => ({ vault: { adapter, configDir: ".obsidian" } }) as unknown as App;
const okFence: IndexWriteFence = { assertCurrent: async () => true };
const chunking = { enabled: true, chunkSize: 1200, overlap: 150 };
const body = (word: string) => `${word} world. A reasonably long note body used for chunking in the tests. `.repeat(40);
const chunksFor = (word: string) => chunkText("N.md", body(word), chunking);
const notesFor = (hash: string) => [{ path: "N.md", basename: "N", extension: "md", size: 1, mtime: 1, contentHash: hash, indexedAt: "t" }];
const rec = (id: string) => ({
  chunkId: id, path: "N.md", index: 0, textHash: `h${id}`, model: "m1", provider: "ollama", dimensions: 3,
  embedding: [0.1, 0.2, 0.3], createdAt: "2026-01-01T00:00:00Z",
});
const info = { provider: "ollama", model: "m1", dimensions: 3, inputVersion: 1, prefixMode: "none" as const };
const MUTATING = new Set(["write", "remove", "rename", "mkdir"]);

const saveV = (adapter: FakeAdapter, version: "old" | "new", fence: IndexWriteFence | undefined = okFence) =>
  saveTextIndex(app(adapter), notesFor(version), chunksFor(version), chunking, 0, undefined, undefined, undefined, fence);
const manifestOf = (adapter: FakeAdapter) => JSON.parse(adapter.getFile(text.manifest) ?? "null") as Record<string, unknown> | null;
const embeddingsOf = (adapter: FakeAdapter) => manifestOf(adapter)?.embeddings;
const residue = (adapter: FakeAdapter) => adapter.listFiles().filter((p) => p.startsWith(".lina/producer/") && (p.endsWith(".publish.tmp") || p.endsWith(".publish.backup")) && p.includes("text-"));
const pair = (adapter: FakeAdapter) => inspectCanonicalPair(adapter.getFile(embeddingFiles.canonicalEmbeddings), manifestOf(adapter));

async function createIndex(withEmbeddings = true) {
  const adapter = new FakeAdapter();
  expect(await saveV(adapter, "old")).toBe(true);
  if (withEmbeddings) expect((await publishCanonicalEmbeddings(app(adapter), [rec("a"), rec("b")], info)).success).toBe(true);
  return adapter;
}

describe("LINA-15H-D — shared manifest persistence", () => {
  describe("protocol and identity (C-03, C-11)", () => {
    it("uses deterministic staging/backup names, leaves no residue and never an in-place write", async () => {
      const adapter = await createIndex();
      adapter.writtenPaths = [];
      adapter.renamedTo = [];
      expect(await saveV(adapter, "new")).toBe(true);
      expect(adapter.writtenPaths).toEqual([text.notesTemporary, text.chunksTemporary, text.manifestTemporary]);
      expect(adapter.renamedTo).toEqual([
        text.notesBackup, text.notes, text.chunksBackup, text.chunks, text.manifestBackup, text.manifest,
      ]);
      expect(adapter.listFiles().filter((p) => p.includes(".tmp-") || p.includes(".bak-"))).toEqual([]);
      expect(residue(adapter)).toEqual([]);
    });

    it("preserves the embeddings identity and publicationId (E1 -> saveTextIndex -> E1)", async () => {
      const adapter = await createIndex();
      const before = manifestOf(adapter) as { embeddings: unknown; embeddingInput: unknown; embeddingsEnabled: boolean; generationId: string };
      expect(await saveV(adapter, "new")).toBe(true);
      const after = manifestOf(adapter) as typeof before;
      expect(after.embeddings).toEqual(before.embeddings);
      expect(after.embeddingInput).toEqual(before.embeddingInput);
      expect(after.embeddingsEnabled).toBe(true);
      expect(after.generationId).not.toBe(before.generationId);
      expect(pair(adapter)).toBe("consistent");
      expect((await readEmbeddingStatus(app(adapter)))?.canonicalPairState).toBe("consistent");
      expect((await readTextIndexStatus(app(adapter))).usability).toBe("ready");
    });

    it("recovers the identity from the deterministic backup when the manifest is absent", async () => {
      const adapter = await createIndex();
      const identity = embeddingsOf(adapter);
      adapter.setFile(text.manifestBackup, adapter.getFile(text.manifest)!);
      adapter.setFile(text.notesBackup, adapter.getFile(text.notes)!);
      adapter.setFile(text.chunksBackup, adapter.getFile(text.chunks)!);
      await adapter.remove(text.manifest);
      expect(await saveV(adapter, "new")).toBe(true);
      expect(embeddingsOf(adapter)).toEqual(identity);
      expect(pair(adapter)).toBe("consistent");
      expect(residue(adapter)).toEqual([]);
    });

    it("aborts instead of last-write-wins when the shared manifest embeddings section changes meanwhile", async () => {
      const adapter = await createIndex();
      const before = adapter.getFile(text.manifest)!;
      let tampered = false;
      adapter.setOptions({
        beforeOperation: (operation, path) => {
          if (tampered || operation !== "write" || path !== text.chunksTemporary) return;
          tampered = true;
          const concurrent = JSON.parse(before) as { embeddings: Record<string, unknown> };
          concurrent.embeddings.publicationId = "emb-concurrent";
          adapter.setFile(text.manifest, JSON.stringify(concurrent));
        },
      });
      expect(await saveV(adapter, "new")).toBe(false);
      expect((embeddingsOf(adapter) as { publicationId: string }).publicationId).toBe("emb-concurrent");
      expect(residue(adapter)).toEqual([]);
    });

    it("rolls back a failed publication without deleting the original when a backup move fails", async () => {
      const adapter = await createIndex();
      const before = { notes: adapter.getFile(text.notes), chunks: adapter.getFile(text.chunks), manifest: adapter.getFile(text.manifest) };
      adapter.setOptions({ shouldFail: (operation, path) => operation === "rename" && path === text.chunks });
      expect(await saveV(adapter, "new")).toBe(false);
      adapter.setOptions({ shouldFail: undefined });
      expect({ notes: adapter.getFile(text.notes), chunks: adapter.getFile(text.chunks), manifest: adapter.getFile(text.manifest) }).toEqual(before);
      expect(residue(adapter)).toEqual([]);
    });
  });

  describe("write fence (C-05)", () => {
    it("writes nothing when the fence is rejected before the publication", async () => {
      const adapter = await createIndex();
      const snapshot = Object.fromEntries(adapter.listFiles().map((p) => [p, adapter.getFile(p)]));
      adapter.writeCount = adapter.removeCount = adapter.renameCount = adapter.mkdirCount = 0;
      expect(await saveV(adapter, "new", { assertCurrent: async () => false })).toBe(false);
      expect(adapter.writeCount + adapter.removeCount + adapter.renameCount + adapter.mkdirCount).toBe(0);
      expect(Object.fromEntries(adapter.listFiles().map((p) => [p, adapter.getFile(p)]))).toEqual(snapshot);
    });

    it("never writes after the authority is lost between mutations and recovery restores a coherent index", async () => {
      let total = 0;
      {
        const adapter = await createIndex();
        let count = 0;
        const counting: IndexWriteFence = { assertCurrent: async () => { count++; return true; } };
        await saveV(adapter, "new", counting);
        total = count;
      }
      expect(total).toBeGreaterThan(8);
      for (let revokeAfter = 0; revokeAfter < total; revokeAfter++) {
        const adapter = await createIndex();
        const identity = embeddingsOf(adapter);
        let calls = 0;
        let rejected = false;
        let mutationsAfterRejection = 0;
        const fence: IndexWriteFence = { assertCurrent: async () => { const ok = ++calls <= revokeAfter; if (!ok) rejected = true; return ok; } };
        adapter.setOptions({ beforeOperation: (operation) => { if (rejected && MUTATING.has(operation)) mutationsAfterRejection++; } });
        const saved = await saveV(adapter, "new", fence);
        adapter.setOptions({ beforeOperation: undefined });
        // a revocation that only reaches the post-commit cleanup does not undo a committed publication
        if (!saved) expect(rejected, `revoked after ${revokeAfter}`).toBe(true);
        expect(mutationsAfterRejection, `no durable mutation after the rejection (revoked after ${revokeAfter})`).toBe(0);
        await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
        expect(embeddingsOf(adapter), `identity after revoke ${revokeAfter}`).toEqual(identity);
        expect(pair(adapter)).toBe("consistent");
        expect((await readTextIndexStatus(app(adapter))).isUsable).toBe(true);
      }
    });

    it("uses the ownership epoch: a transferred ownership rejects the captured fence", async () => {
      const adapter = await createIndex();
      const localId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
      const remoteId = "550e8400-e29b-41d4-a716-446655440000";
      await claimInitialOwnership(adapter, localId);
      const gate = new OwnershipGate(adapter, () => localId, () => "producer", true);
      const token = await gate.acquireFence({ autoClaimIfUnclaimed: false });
      expect(token).toBeDefined();
      const fence: IndexWriteFence = { assertCurrent: () => gate.assertFence(token!) };
      expect(await saveV(adapter, "new", fence)).toBe(true);
      await transferOwnership(adapter, remoteId, token!.epoch, "manual-transfer");
      const snapshot = adapter.getFile(text.manifest);
      expect(await saveV(adapter, "old", fence)).toBe(false);
      expect(adapter.getFile(text.manifest)).toBe(snapshot);
    });

    it.each([
      ["companion", "companion" as const, true],
      ["standby producer", "producer" as const, false],
      ["unassigned", undefined, true],
      ["unclaimed ownership", "producer" as const, undefined],
    ])("gives no fence (so no write) to a %s device", async (name, role, claimedByLocal) => {
      const adapter = new FakeAdapter();
      const localId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
      const remoteId = "550e8400-e29b-41d4-a716-446655440000";
      if (claimedByLocal !== undefined) await claimInitialOwnership(adapter, claimedByLocal ? localId : remoteId);
      const gate = new OwnershipGate(adapter, () => localId, () => role, true);
      expect(await gate.acquireFence({ autoClaimIfUnclaimed: false }), name).toBeUndefined();
      if (claimedByLocal === undefined) expect(adapter.hasFile(getOwnershipPath())).toBe(false);
    });

    it("every production caller of saveTextIndex passes the write fence and none relies on cached authority", () => {
      const source = readFileSync("main.ts", "utf8");
      const calls = [...source.matchAll(/saveTextIndex\(/g)].map((match) => {
        let depth = 0;
        let index = match.index! + "saveTextIndex".length;
        const start = index;
        for (; index < source.length; index++) {
          if (source[index] === "(") depth++;
          if (source[index] === ")" && --depth === 0) break;
        }
        return source.slice(start, index + 1);
      });
      expect(calls.length).toBe(3);
      for (const call of calls) expect(call).toMatch(/\b(writeFence|fence)\b/);
      expect(source).not.toMatch(/saveTextIndex[\s\S]{0,400}evaluateProvenance/);
    });
  });

  describe("crash matrix (C-03, C-08): no crash loses the embeddings identity and no recovery goes backwards", () => {
    it("recovers every crash point of saveTextIndex to a complete publication preserving E1", async () => {
      let total = 0;
      {
        const adapter = await createIndex();
        adapter.setOptions({ shouldFail: (operation) => { if (MUTATING.has(operation)) total++; return false; } });
        await saveV(adapter, "new");
      }
      expect(total).toBeGreaterThanOrEqual(12);
      const generationOf = (adapter: FakeAdapter) => manifestOf(adapter)?.generationId as string;
      const oldGeneration = generationOf(await createIndex());
      const rows: string[] = [];
      for (let n = 1; n <= total; n++) {
        const adapter = await createIndex();
        const identity = embeddingsOf(adapter);
        const before = generationOf(adapter);
        let count = 0;
        let crashed = false;
        adapter.setOptions({ shouldFail: (operation) => { if (crashed) return true; if (MUTATING.has(operation) && ++count === n) { crashed = true; return true; } return false; } });
        await saveV(adapter, "new");
        adapter.setOptions({ shouldFail: undefined });
        const disk = ["notes", "chunks", "manifest"].map((k) => adapter.hasFile(text[k as "notes"]) ? "Y" : "-").join("");
        const preText = (await readTextIndexStatus(app(adapter))).usability;

        // startup recovery (text first, then embeddings), exactly as production runs it
        const recovered = adapter.listFiles().length >= 0 && await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
        expect(recovered.warnings, `crash ${n}`).toEqual([]);
        const status = await readTextIndexStatus(app(adapter));
        expect(embeddingsOf(adapter), `identity after crash ${n}`).toEqual(identity);
        expect(pair(adapter), `pair after crash ${n}`).toBe("consistent");
        expect(status.isUsable, `text after crash ${n}`).toBe(true);
        const generation = generationOf(adapter);
        expect([before, "new"].includes(generation) || generation !== before, `generation ${n}`).toBe(true);
        expect(residue(adapter), `residue after crash ${n}`).toEqual([]);
        expect(adapter.listFiles().filter((p) => p.includes(".tmp-") || p.includes(".bak-"))).toEqual([]);
        rows.push(`${n}:${disk}/${preText}->${generation === before ? "old" : "new"}`);
      }
      expect(rows).toHaveLength(total);
      expect(oldGeneration).toBeTruthy();
    });

    it("a crash after the commit point (manifest published) rolls forward, never back to the older publication", async () => {
      const adapter = await createIndex();
      const before = manifestOf(adapter)?.generationId;
      let count = 0;
      let crashed = false;
      // fail on the first cleanup removal: everything is committed, only residue remains
      adapter.setOptions({ shouldFail: (operation, path) => { if (crashed) return true; if (operation === "remove" && path === text.notesBackup) { crashed = true; return true; } count++; return false; } });
      await saveV(adapter, "new");
      adapter.setOptions({ shouldFail: undefined });
      const committed = manifestOf(adapter)?.generationId;
      expect(committed).not.toBe(before);
      expect(residue(adapter).length).toBeGreaterThan(0);
      await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
      expect(manifestOf(adapter)?.generationId).toBe(committed);
      expect(residue(adapter)).toEqual([]);
      expect(count).toBeGreaterThan(0);
    });

    it("self-heals: the next saveTextIndex recovers an interrupted publication and keeps E1", async () => {
      let total = 0;
      {
        const adapter = await createIndex();
        adapter.setOptions({ shouldFail: (operation) => { if (MUTATING.has(operation)) total++; return false; } });
        await saveV(adapter, "new");
      }
      for (let n = 1; n <= total; n++) {
        const adapter = await createIndex();
        const identity = embeddingsOf(adapter);
        let count = 0;
        let crashed = false;
        adapter.setOptions({ shouldFail: (operation) => { if (crashed) return true; if (MUTATING.has(operation) && ++count === n) { crashed = true; return true; } return false; } });
        await saveV(adapter, "new");
        adapter.setOptions({ shouldFail: undefined });
        expect(await saveV(adapter, "new"), `retry after crash ${n}`).toBe(true);
        expect(embeddingsOf(adapter), `identity ${n}`).toEqual(identity);
        expect(pair(adapter)).toBe("consistent");
        expect((await readTextIndexStatus(app(adapter))).usability).toBe("ready");
        expect(residue(adapter)).toEqual([]);
      }
    });
  });

  describe("recovery evidence rules (C-08)", () => {
    async function withStaleBackups(): Promise<FakeAdapter> {
      const adapter = await createIndex();
      // backups of an OLD publication next to a newer, complete current one
      const old = new FakeAdapter();
      await saveV(old, "old");
      adapter.setFile(text.notesBackup, old.getFile(text.notes)!);
      adapter.setFile(text.chunksBackup, old.getFile(text.chunks)!);
      adapter.setFile(text.manifestBackup, old.getFile(text.manifest)!);
      expect(await saveV(adapter, "new", okFence)).toBe(true); // self-heal path leaves a complete current publication
      return adapter;
    }

    it("removes stale backups and keeps a newer current text publication", async () => {
      const adapter = await withStaleBackups();
      const current = manifestOf(adapter)?.generationId;
      const old = new FakeAdapter();
      await saveV(old, "old");
      adapter.setFile(text.notesBackup, old.getFile(text.notes)!);
      adapter.setFile(text.chunksBackup, old.getFile(text.chunks)!);
      adapter.setFile(text.manifestBackup, old.getFile(text.manifest)!);
      const result = await recoverTextIndexPublication(app(adapter));
      expect(result.warnings).toEqual([]);
      expect(manifestOf(adapter)?.generationId).toBe(current);
      expect(residue(adapter)).toEqual([]);
      expect(pair(adapter)).toBe("consistent");
    });

    it("does not restore embeddings published meanwhile over a stale text backup", async () => {
      const adapter = await createIndex();
      const old = new FakeAdapter();
      await saveV(old, "old");
      adapter.setFile(text.manifestBackup, old.getFile(text.manifest)!);
      adapter.setFile(text.notesBackup, old.getFile(text.notes)!);
      adapter.setFile(text.chunksBackup, old.getFile(text.chunks)!);
      await publishCanonicalEmbeddings(app(adapter), [rec("a"), rec("b"), rec("c")], info);
      const publicationId = (embeddingsOf(adapter) as { publicationId: string }).publicationId;
      await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
      expect((embeddingsOf(adapter) as { publicationId: string }).publicationId).toBe(publicationId);
      expect(pair(adapter)).toBe("consistent");
      expect(residue(adapter)).toEqual([]);
    });

    it("keeps backups and warns when a committed manifest sits next to an incomplete current triple", async () => {
      const adapter = await createIndex();
      const old = new FakeAdapter();
      await saveV(old, "old");
      adapter.setFile(text.manifestBackup, old.getFile(text.manifest)!);
      adapter.setFile(text.notesBackup, old.getFile(text.notes)!);
      await adapter.remove(text.chunks); // current triple incomplete, manifest present
      const result = await recoverTextIndexPublication(app(adapter));
      expect(result.warnings).toEqual(["text-backup-superseded"]);
      expect(adapter.hasFile(text.manifestBackup)).toBe(true);
    });

    it("refuses to restore a backup that is not a complete publication", async () => {
      const adapter = await createIndex();
      adapter.setFile(text.notesBackup, "[]");
      await adapter.remove(text.manifest);
      const result = await recoverTextIndexPublication(app(adapter));
      expect(result.warnings).toEqual(["text-backup-invalid"]);
      expect(adapter.hasFile(text.manifest)).toBe(false);
      expect(adapter.hasFile(text.notesBackup)).toBe(true);
    });

    it("does not make the embeddings recovery overwrite a newer text manifest with the older backup (probe Q4)", async () => {
      const adapter = await createIndex();
      const identity = embeddingsOf(adapter);
      let crashed = false;
      adapter.setOptions({ shouldFail: (operation, path, target) => { if (operation === "rename" && path === embeddingFiles.manifestPublishTemporary && target === embeddingFiles.canonicalManifest) crashed = true; return crashed; } });
      await publishCanonicalEmbeddings(app(adapter), [rec("a"), rec("b"), rec("c")], info);
      adapter.setOptions({ shouldFail: undefined });
      expect(adapter.hasFile(text.manifest)).toBe(false); // W2: manifest absent between the two renames
      // a text publication happens before the embeddings recovery had a chance to run
      expect(await saveV(adapter, "new")).toBe(true);
      const textGeneration = manifestOf(adapter)?.generationId;
      await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
      expect(manifestOf(adapter)?.generationId).toBe(textGeneration); // text not rolled back
      expect(embeddingsOf(adapter)).toEqual(identity); // identity preserved from the backup
      expect(pair(adapter)).toBe("consistent");
      expect((await readTextIndexStatus(app(adapter))).usability).toBe("ready");
    });

    it("never changes anything when the fence is rejected during recovery", async () => {
      const adapter = await createIndex();
      const old = new FakeAdapter();
      await saveV(old, "old");
      adapter.setFile(text.notesTemporary, "orphan");
      adapter.setFile(text.notesBackup, old.getFile(text.notes)!);
      adapter.setFile(text.chunksBackup, old.getFile(text.chunks)!);
      adapter.setFile(text.manifestBackup, old.getFile(text.manifest)!);
      const snapshot = Object.fromEntries(adapter.listFiles().map((p) => [p, adapter.getFile(p)]));
      const result = await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, { assertCurrent: async () => false });
      expect(result.warnings).toContain("ownership-fence-rejected");
      expect(Object.fromEntries(adapter.listFiles().map((p) => [p, adapter.getFile(p)]))).toEqual(snapshot);
    });
  });

  describe("orphans (C-11)", () => {
    it("removes only protocol-owned names and leaves unknown and legacy files untouched", async () => {
      const adapter = await createIndex();
      adapter.setFile(text.notesTemporary, "x");
      adapter.setFile(text.chunksTemporary, "x");
      adapter.setFile(text.manifestTemporary, "x");
      adapter.setFile(".lina/producer/staging/unrelated.tmp", "keep");
      adapter.setFile(".lina/producer/backups/manifest.json.bak-legacy", "keep");
      const result = await recoverTextIndexPublication(app(adapter));
      expect(result.changed).toBe(true);
      expect(residue(adapter)).toEqual([]);
      expect(adapter.getFile(".lina/producer/staging/unrelated.tmp")).toBe("keep");
      expect(adapter.getFile(".lina/producer/backups/manifest.json.bak-legacy")).toBe("keep");
      expect((await readTextIndexStatus(app(adapter))).usability).toBe("ready");
    });

    it("is idempotent and tolerant of absence", async () => {
      const adapter = new FakeAdapter();
      expect(await recoverTextIndexPublication(app(adapter))).toEqual({ warnings: [], changed: false });
      const complete = await createIndex();
      complete.setFile(text.notesTemporary, "x");
      await recoverTextIndexPublication(app(complete));
      const snapshot = Object.fromEntries(complete.listFiles().map((p) => [p, complete.getFile(p)]));
      expect(await recoverTextIndexPublication(app(complete))).toEqual({ warnings: [], changed: false });
      expect(Object.fromEntries(complete.listFiles().map((p) => [p, complete.getFile(p)]))).toEqual(snapshot);
    });
  });

  describe("concurrency with the 15H-C leases", () => {
    it("saveTextIndex under the canonical-maintenance lease excludes generation, batches, rebuild and recovery", async () => {
      const adapter = await createIndex();
      const coordinator = new IndexWriteCoordinator();
      const attempts: string[] = [];
      adapter.setOptions({
        beforeOperation: (operation, path) => {
          if (operation !== "write" || path !== text.manifestTemporary || attempts.length) return;
          attempts.push(
            coordinator.startEmbeddingGeneration().status,
            coordinator.startAutomaticBatch().status,
            coordinator.startTextRebuild().status,
            coordinator.startBinaryMaintenance().status,
            coordinator.startCanonicalMaintenance().status,
          );
        },
      });
      const outcome = await runCanonicalMaintenance(coordinator, async () => okFence, async (fence) => saveV(adapter, "new", fence));
      expect(outcome).toEqual({ status: "completed", value: true });
      expect(attempts).toEqual(["text-index-busy", "text-index-busy", "text-index-busy", "text-index-busy", "text-index-busy"]);
      expect(pair(adapter)).toBe("consistent");
    });
  });

  describe("lifecycle stays factual", () => {
    it("a recoverable text crash does not turn the embeddings pair into inconsistent after recovery", async () => {
      const adapter = await createIndex();
      let count = 0;
      let crashed = false;
      adapter.setOptions({ shouldFail: (operation) => { if (crashed) return true; if (MUTATING.has(operation) && ++count === 6) { crashed = true; return true; } return false; } });
      await saveV(adapter, "new");
      adapter.setOptions({ shouldFail: undefined });
      await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, okFence);
      expect((await readEmbeddingStatus(app(adapter)))?.canonicalPairState).toBe("consistent");
    });

    it("an inconsistent pair is not repaired by saveTextIndex (it only preserves what the manifest declares)", async () => {
      const adapter = await createIndex();
      adapter.setFile(embeddingFiles.canonicalEmbeddings, `${(adapter.getFile(embeddingFiles.canonicalEmbeddings) ?? "").split("\n")[0]}\n`);
      expect(pair(adapter)).toBe("inconsistent");
      expect(await saveV(adapter, "new")).toBe(true);
      expect(pair(adapter)).toBe("inconsistent");
    });
  });
});
