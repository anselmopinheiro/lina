import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import { readEmbeddingStatus } from "../../src/index/embeddingGenerator";
import { EMBEDDING_PERSISTENCE_FILES as files, recoverEmbeddingPersistenceArtifacts, recoverCanonicalEmbeddingsAtStartup, inspectCanonicalPair } from "../../src/index/embeddingPersistence";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { IndexWriteCoordinator } from "../../src/index/indexWriteCoordinator";
import { OwnershipGate } from "../../src/device/ownershipGate";
import { claimInitialOwnership, getOwnershipPath } from "../../src/device/deviceOwnership";
import { buildEmbeddingWorkLifecycleSnapshot } from "../../src/index/embeddingWorkStatusController";
import { activeProducerRuntime } from "../helpers/producerRuntimeState";
import { deriveEmbeddingWritePathDecision, evaluateOperationStartGate } from "../../src/index/embeddingLifecycleWritePath";
import { evaluateSchedulerDecisionFromSnapshot } from "../../src/maintenance/embeddingScheduler";
import { ReconciliationWorker } from "../../src/maintenance/reconciliationWorker";
import { resolveDeviceCapabilities } from "../../src/capabilities/deviceCapabilities";
import { createVectorContract } from "../../src/index/vectorContract";

const record = { chunkId: "a", path: "a.md", index: 0, textHash: "hash", embeddingInputHash: "input", provider: "ollama", model: "nomic", dimensions: 2, embedding: [1, 2], createdAt: "2026-10-02" };
const jsonl = `${JSON.stringify(record)}\n`;
const manifest = JSON.stringify({ indexType: "text", embeddingsEnabled: true, embeddings: { provider: "ollama", model: "nomic", dimensions: 2, totalEmbeddings: 1, publicationId: "published" }, embeddingInput: { version: 1, prefixMode: "none" } });
function app(adapter: FakeAdapter): App { return { vault: { adapter } } as unknown as App; }

describe("15H-B characterization", () => {
  it.each([
    ["JSONL new / manifest old", `${jsonl}${JSON.stringify({ ...record, chunkId: "b" })}\n`, manifest],
    ["manifest new / JSONL old", jsonl, manifest.replace('"totalEmbeddings":1', '"totalEmbeddings":2')],
    ["truncated line", jsonl.slice(0, -10), manifest],
    ["truncated on line boundary", "", manifest],
  ])("rejects %s as a searchable publication", async (_name, content, metadata) => {
    const adapter = new FakeAdapter({ [files.canonicalEmbeddings]: content, [files.canonicalManifest]: metadata });
    const status = await readEmbeddingStatus(app(adapter), { currentChunks: [] });
    expect(status?.canonicalPairState).toBe("inconsistent");
    expect(status?.validForSearchCount).toBe(0);
  });

  it("revalidates ownership after the first recovery mutation", async () => {
    let authorized = true;
    const adapter = new FakeAdapter({ [files.checkpointTemporary]: "orphan", [files.checkpointMetadataTemporary]: "orphan" }, {
      beforeOperation: (operation) => { if (operation === "remove") authorized = false; },
    });
    await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, { assertCurrent: async () => authorized });
    expect(adapter.removeCount).toBe(1);
    expect(adapter.hasFile(files.checkpointMetadataTemporary)).toBe(true);
  });

  it.each([
    ["healthy", jsonl, manifest, "consistent"],
    ["missing manifest", jsonl, undefined, "inconsistent"],
    ["missing JSONL", undefined, manifest, "inconsistent"],
    ["absent", undefined, undefined, "absent"],
    ["text only", undefined, '{"indexType":"text","embeddingsEnabled":false}', "absent"],
    ["dimension mismatch", jsonl, manifest.replace('"dimensions":2', '"dimensions":3'), "inconsistent"],
    ["model mismatch", jsonl, manifest.replace('"model":"nomic"', '"model":"other"'), "inconsistent"],
    ["provider mismatch", jsonl, manifest.replace('"provider":"ollama"', '"provider":"mistral"'), "inconsistent"],
    ["duplicate", `${jsonl}${jsonl}`, manifest.replace('"totalEmbeddings":1', '"totalEmbeddings":2'), "inconsistent"],
    ["missing final newline for new publication", jsonl.trimEnd(), manifest, "inconsistent"],
    ["legacy without publication id", jsonl.trimEnd(), manifest.replace(',"publicationId":"published"', ''), "unverifiable-legacy"],
    ["missing count", jsonl, manifest.replace('"totalEmbeddings":1,', ''), "inconsistent"],
    ["invalid publication id", jsonl, manifest.replace('"publicationId":"published"', '"publicationId":7'), "inconsistent"],
  ])("classifies %s factually without mutations", async (_name, content, metadata, expected) => {
    const adapter = new FakeAdapter();
    if (content !== undefined) adapter.setFile(files.canonicalEmbeddings, content);
    if (metadata !== undefined) adapter.setFile(files.canonicalManifest, metadata);
    const status = await readEmbeddingStatus(app(adapter), { currentChunks: [] });
    expect(status?.canonicalPairState).toBe(expected);
    expect(adapter.writeCount + adapter.removeCount + adapter.renameCount).toBe(0);
  });

  it("distinguishes unreadable manifest from resource refusal without reading guarded JSONL", async () => {
    const adapter = new FakeAdapter({ [files.canonicalEmbeddings]: jsonl, [files.canonicalManifest]: "{" });
    expect((await readEmbeddingStatus(app(adapter), { currentChunks: [] }))?.canonicalPairState).toBe("unreadable");
    adapter.setFile(files.canonicalManifest, manifest);
    const originalStat = adapter.stat.bind(adapter);
    adapter.stat = async (path) => path === files.canonicalEmbeddings ? { type: "file", size: 60 * 1024 * 1024, mtime: 1 } : originalStat(path);
    adapter.readPaths = [];
    expect(await readEmbeddingStatus(app(adapter), { resourceProfile: "desktop", currentChunks: [] })).toMatchObject({ canonicalPairState: "resource-limit-exceeded", canonicalReadability: "resource-limit-exceeded" });
    expect(adapter.readPaths).not.toContain(files.canonicalEmbeddings);
  });

  it("keeps the read path closed during either order of partial synchronization, then converges", async () => {
    const second = `${JSON.stringify({ ...record, chunkId: "b" })}\n`;
    const nextManifest = manifest.replace('"totalEmbeddings":1', '"totalEmbeddings":2').replace('"published"', '"next"');
    expect(inspectCanonicalPair(jsonl + second, JSON.parse(manifest))).toBe("inconsistent");
    expect(inspectCanonicalPair(jsonl, JSON.parse(nextManifest))).toBe("inconsistent");
    expect(inspectCanonicalPair(jsonl + second, JSON.parse(nextManifest))).toBe("consistent");
  });

  it("validates both existing contract digests and their input identity", () => {
    const metadata = JSON.parse(manifest);
    const contract = createVectorContract({ provider: "ollama", model: "nomic", dimensions: 2, inputVersion: 1, prefixMode: "none", metric: "cosine" });
    metadata.vectorContract = contract;
    metadata.embeddings.vectorContract = contract;
    expect(inspectCanonicalPair(jsonl, metadata)).toBe("consistent");
    metadata.embeddings.vectorContract = { ...contract, contractId: "vc1:wrong" };
    expect(inspectCanonicalPair(jsonl, metadata)).toBe("inconsistent");
    metadata.embeddings.vectorContract = contract;
    metadata.embeddingInput.version = 2;
    expect(inspectCanonicalPair(jsonl, metadata)).toBe("inconsistent");
  });

  it("preserves a guarded canonical publication instead of replacing it with a readable backup", async () => {
    const adapter = new FakeAdapter({ [files.canonicalEmbeddings]: jsonl, [files.canonicalManifest]: manifest, [files.embeddingsPublishBackup]: jsonl, [files.manifestPublishBackup]: manifest });
    const originalStat = adapter.stat.bind(adapter);
    adapter.stat = async (path) => path === files.canonicalEmbeddings ? { type: "file", size: 60 * 1024 * 1024, mtime: 1 } : originalStat(path);
    const result = await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, { assertCurrent: async () => true });
    expect(result.warnings).toContain("canonical-resource-limit-exceeded");
    expect(adapter.readPaths).not.toContain(files.canonicalEmbeddings);
    expect(adapter.renameCount + adapter.removeCount + adapter.writeCount).toBe(0);
    expect(adapter.hasFile(files.embeddingsPublishBackup)).toBe(true);
  });

  it.each(["inconsistent", "unreadable", "resource-limit-exceeded"] as const)("projects %s into lifecycle and existing dispatch gates", (pairState) => {
    const identity = { provider: "ollama", model: "nomic", dimensions: 2, inputVersion: 1, prefixMode: "none" as const };
    const snapshot = buildEmbeddingWorkLifecycleSnapshot({
      exists: true, canonicalPairState: pairState,
      canonicalReadability: pairState === "resource-limit-exceeded" ? pairState : "readable",
      validForSearchCount: 1, publishedIdentity: identity,
      updatePlan: { mode: "incremental", targetIdentity: identity, totalChunks: 1, reusableCanonicalCount: 1, recoverableCheckpointCount: 0, toGenerateCount: 0, staleToReplaceCount: 0, missingCount: 0, obsoleteToDropCount: 0, requiresPublication: false, reasons: ["no-generation-needed"] },
    }, 1, activeProducerRuntime());
    expect(snapshot.info.canonicalPairState).toBe(pairState);
    expect(snapshot.primary).toBe(pairState === "unreadable" ? "INDETERMINATE" : "INCOMPATIBLE");
    expect(snapshot.read.semanticAvailable).toBe(false);
    expect(evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only").canDispatch).toBe(false);
    expect(evaluateOperationStartGate(deriveEmbeddingWritePathDecision(snapshot), "automatic").allowed).toBe(false);
  });

  const localId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
  const remoteId = "550e8400-e29b-41d4-a716-446655440000";
  function acquire(gate: OwnershipGate) {
    return async () => { const token = await gate.acquireFence({ autoClaimIfUnclaimed: false }); return token ? { assertCurrent: () => gate.assertFence(token) } : undefined; };
  }
  function crashAdapter() {
    return new FakeAdapter({
      [files.canonicalEmbeddings]: `${jsonl}${JSON.stringify({ ...record, chunkId: "b" })}\n`,
      [files.canonicalManifest]: manifest,
      [files.embeddingsPublishBackup]: jsonl,
      [files.manifestPublishBackup]: manifest,
    });
  }

  it("runs actual recovery in startup under a lease, restores the previous pair, and is idempotent", async () => {
    const adapter = crashAdapter();
    await claimInitialOwnership(adapter, localId);
    const gate = new OwnershipGate(adapter, () => localId, () => "producer", true);
    const coordinator = new IndexWriteCoordinator();
    adapter.setOptions({ beforeOperation: (operation) => { if (["rename", "remove", "write"].includes(operation)) expect(coordinator.getState().activeOperation).toBe("binary-maintenance"); } });
    const worker = new ReconciliationWorker({
      capabilities: resolveDeviceCapabilities({ isMobile: false }),
      canPublish: () => true,
      runStartupEmbeddingRecovery: async () => { await recoverCanonicalEmbeddingsAtStartup(app(adapter), coordinator, acquire(gate)); },
      runStartupReconciliation: async () => { expect(adapter.getFile(files.canonicalEmbeddings)).toBe(jsonl); },
      runStartupBinaryArtifactMigration: async () => { expect(inspectCanonicalPair(adapter.getFile(files.canonicalEmbeddings), JSON.parse(adapter.getFile(files.canonicalManifest)!))).toBe("consistent"); },
      runExclusionReconciliation: async () => {}, waitForAutomaticUpdates: async () => {},
    });
    worker.start();
    expect(await worker.runStartupReconciliation()).toBe(true);
    const state = adapter.listFiles();
    await worker.runStartupReconciliation();
    expect(adapter.listFiles()).toEqual(state);
    expect(coordinator.getState().activeOperation).toBeNull();
  });

  it.each(["companion", "standby", "unclaimed", "lost-before", "busy"])("startup recovery never writes for %s", async (scenario) => {
    const adapter = crashAdapter();
    if (scenario !== "unclaimed") await claimInitialOwnership(adapter, scenario === "standby" ? remoteId : localId);
    const gate = new OwnershipGate(adapter, () => localId, () => scenario === "companion" ? "companion" : "producer", true);
    const coordinator = new IndexWriteCoordinator();
    if (scenario === "busy") coordinator.startTextRebuild();
    const acquireFence = acquire(gate);
    const captured = await acquireFence();
    if (scenario === "lost-before") adapter.setFile(getOwnershipPath(), adapter.getFile(getOwnershipPath())!.replace(localId, remoteId));
    adapter.writeCount = 0; adapter.removeCount = 0; adapter.renameCount = 0;
    await recoverCanonicalEmbeddingsAtStartup(app(adapter), coordinator, scenario === "lost-before" ? async () => captured : acquireFence);
    expect(adapter.writeCount + adapter.removeCount + adapter.renameCount).toBe(0);
    expect(adapter.getFile(files.canonicalEmbeddings)).not.toBe(jsonl);
    if (scenario === "unclaimed") expect(adapter.hasFile(getOwnershipPath())).toBe(false);
  });

  it("retains complete backups when epoch changes between canonical promotions and resumes safely", async () => {
    const adapter = crashAdapter();
    await claimInitialOwnership(adapter, localId);
    const gate = new OwnershipGate(adapter, () => localId, () => "producer", true);
    const coordinator = new IndexWriteCoordinator();
    adapter.setOptions({ beforeOperation: (operation, path) => {
      if (operation === "rename" && path === files.embeddingsPublishTemporary) adapter.setFile(getOwnershipPath(), adapter.getFile(getOwnershipPath())!.replace('"epoch": 1', '"epoch": 2'));
    } });
    const result = await recoverCanonicalEmbeddingsAtStartup(app(adapter), coordinator, acquire(gate));
    expect(result.warnings).toContain("ownership-fence-rejected");
    expect(adapter.hasFile(files.embeddingsPublishBackup)).toBe(true);
    expect(adapter.hasFile(files.manifestPublishBackup)).toBe(true);
    adapter.setOptions({ beforeOperation: undefined });
    await recoverCanonicalEmbeddingsAtStartup(app(adapter), coordinator, acquire(gate));
    expect(inspectCanonicalPair(adapter.getFile(files.canonicalEmbeddings), JSON.parse(adapter.getFile(files.canonicalManifest)!))).toBe("consistent");
  });

  it("does not fabricate a first publication or delete inconsistent canonical files without a backup", async () => {
    const adapter = new FakeAdapter({ [files.canonicalEmbeddings]: jsonl, [files.manifestPublishTemporary]: manifest });
    await recoverEmbeddingPersistenceArtifacts(app(adapter), undefined, { assertCurrent: async () => true });
    expect(adapter.getFile(files.canonicalEmbeddings)).toBe(jsonl);
    expect(adapter.hasFile(files.canonicalManifest)).toBe(false);
    expect(adapter.hasFile(files.manifestPublishTemporary)).toBe(false);
  });
});
