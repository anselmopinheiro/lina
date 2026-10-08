import { BINARY_EMBEDDING_FILES, BinaryEmbeddingDataAdapter, BinaryEmbeddingDigest, BinaryEmbeddingPublisher, readBinaryEmbeddingStorage, recoverBinaryEmbeddingPublication, getEmbeddingBinaryResourceLimits } from "./embeddingBinaryStorage";
import { getDeviceCapabilities } from "../capabilities/deviceCapabilities";
import { CanonicalPairState, EmbeddingRecord, EmbeddingWriteFence, inspectCanonicalPair } from "./embeddingPersistence";
import { evaluateEmbeddingBridgeRead } from "./embeddingResourceGuard";
import { EmbeddingSpaceIdentity } from "./embeddingUpdatePlan";
import { IndexWriteCoordinator, IndexWriteCoordinatorToken } from "./indexWriteCoordinator";
import { ArtifactProvenance, isValidArtifactProvenance } from "../device/artifactProvenance";

export type BinaryEmbeddingCopyStatus = "disabled" | "absent" | "checking" | "valid" | "outdated" | "incomplete" | "invalid" | "unsupported" | "error";
export interface BinaryEmbeddingCopySummary { status: BinaryEmbeddingCopyStatus; format?: "binary-v1"; sourcePublicationId?: string; binaryGenerationId?: string; recordCount?: number; dimensions?: number; byteLength?: number; updatedAt?: string; reason?: string; reasonCode?: "legacy-manifest"; }
export type BinaryEmbeddingMaintenancePhase = "idle" | "queued" | "reading-jsonl" | "building" | "digesting" | "publishing" | "validating" | "completed" | "failed" | "cancelled" | "superseded" | "disposed";
export interface BinaryEmbeddingMaintenanceState { phase: BinaryEmbeddingMaintenancePhase; summary?: BinaryEmbeddingCopySummary; expectedPublicationId?: string; }

interface CanonicalEmbeddingManifest { publicationId?: string; totalEmbeddings?: number; provider: string; model: string; dimensions: number; inputVersion: number; prefixMode: "none" | "nomic-search-query-document"; provenance?: ArtifactProvenance; raw: unknown; }
interface PendingMaintenance { expectedPublicationId: string; resolve: (summary: BinaryEmbeddingCopySummary) => void; promise: Promise<BinaryEmbeddingCopySummary>; }
const canonicalManifest = ".lina/index/manifest.json";
const canonicalJsonl = ".lina/index/embeddings.jsonl";

class SupersededMaintenanceError extends Error {}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function sanitize(reason: unknown): string { return reason instanceof Error ? "Não foi possível validar a cópia binária." : "Cópia binária indisponível."; }

/** Owns only the derived binary artefact. JSONL and checkpoint are never written here. */
export class BinaryEmbeddingCopyController {
  private checking: Promise<BinaryEmbeddingCopySummary> | null = null;
  private readonly pending = new Map<string, PendingMaintenance>();
  private activeMaintenance: PendingMaintenance | null = null;
  private maintenanceRunner: Promise<void> | null = null;
  private disposed = false;
  private running = false;
  private state: BinaryEmbeddingMaintenanceState = { phase: "idle" };

  constructor(
    private readonly adapter: BinaryEmbeddingDataAdapter,
    private readonly digest: BinaryEmbeddingDigest,
    private readonly coordinator?: IndexWriteCoordinator,
    private readonly onState?: (state: BinaryEmbeddingMaintenanceState) => void,
    private readonly acquireFence?: () => Promise<EmbeddingWriteFence | undefined>,
  ) {}

  dispose(): void {
    this.disposed = true; this.checking = null;
    for (const item of this.pending.values()) item.resolve({ status: "error", reason: "Operação terminada." });
    this.pending.clear(); this.setState({ phase: "disposed" });
  }
  getState(): BinaryEmbeddingMaintenanceState { return { ...this.state }; }
  private setState(state: BinaryEmbeddingMaintenanceState): void { this.state = state; this.onState?.(this.getState()); }

  async check(enabled: boolean): Promise<BinaryEmbeddingCopySummary> {
    if (!enabled) return { status: "disabled" };
    if (this.checking) return this.checking;
    this.checking = this.checkInternal();
    try { return await this.checking; } finally { this.checking = null; }
  }

  private async checkInternal(): Promise<BinaryEmbeddingCopySummary> {
    const exists = await Promise.all([this.adapter.exists(BINARY_EMBEDDING_FILES.manifest), this.adapter.exists(BINARY_EMBEDDING_FILES.metadata), this.adapter.exists(BINARY_EMBEDDING_FILES.vectors)]);
    if (!exists.some(Boolean)) return { status: "absent" };
    if (!exists.every(Boolean)) return { status: "incomplete" };
    let canonical: CanonicalEmbeddingManifest;
    try { canonical = await this.readCanonicalManifest(); } catch { return { status: "unsupported", reason: "Manifesto JSONL inválido ou incompatível." }; }
    if (!canonical.publicationId) return { status: "unsupported", reasonCode: "legacy-manifest", reason: "Índice JSONL sem identificador compatível." };
    try {
      const runtime = await readBinaryEmbeddingStorage(this.adapter, this.digest);
      if (this.disposed) return { status: "error", reason: "Operação terminada." };
      if (runtime.sourceIdentity.publicationId !== canonical.publicationId) return { status: "outdated", sourcePublicationId: runtime.sourceIdentity.publicationId };
      const pairState = await this.readCanonicalPairState(canonical);
      if (pairState === "inconsistent") return { status: "invalid", reason: "A cópia binária não corresponde à publicação canónica." };
      if (runtime.count !== canonical.totalEmbeddings || runtime.dimensions !== canonical.dimensions || runtime.provider !== canonical.provider || runtime.model !== canonical.model || runtime.sourceIdentity.inputVersion !== canonical.inputVersion || runtime.sourceIdentity.prefixMode !== canonical.prefixMode) return { status: "invalid", reason: "A cópia binária não corresponde à publicação canónica." };
      return { status: "valid", format: "binary-v1", sourcePublicationId: canonical.publicationId, binaryGenerationId: runtime.sourceIdentity.binaryGenerationId, recordCount: runtime.count, dimensions: runtime.dimensions, byteLength: runtime.vectors.byteLength, updatedAt: runtime.sourceIdentity.updatedAt };
    } catch (error) { return { status: "invalid", reason: sanitize(error) }; }
  }

  async createOrUpdate(): Promise<BinaryEmbeddingCopySummary> { return this.runWrite(false); }

  async recover(): Promise<void> {
    if (this.disposed || this.running) return;
    const fence = await this.acquireFence?.();
    if (this.acquireFence && (!fence || !await fence.assertCurrent())) return;
    const lease = this.coordinator?.startBinaryMaintenance();
    if (lease && lease.status !== "accepted") return;
    this.running = true;
    try {
      let canonical: CanonicalEmbeddingManifest;
      try { canonical = await this.readCanonicalManifest(); } catch { return; }
      if (await this.readCanonicalPairState(canonical) !== "consistent") return;
      await this.recoverDerived(canonical, this.fencedAdapter(fence));
    } finally {
      this.running = false;
      if (lease?.status === "accepted") this.coordinator?.finish(lease.token);
    }
  }

  /** Queues exactly one derived maintenance per canonical publication id. */
  maintainAfterCanonicalPublication(expectedPublicationId: string): Promise<BinaryEmbeddingCopySummary> {
    if (this.disposed) return Promise.resolve({ status: "error", reason: "Operação terminada." });
    if (this.activeMaintenance?.expectedPublicationId === expectedPublicationId) return this.activeMaintenance.promise;
    const duplicate = this.pending.get(expectedPublicationId);
    if (duplicate) return duplicate.promise;
    // A newer publication replaces queued (not yet transactional) work only.
    for (const [publicationId, item] of this.pending) {
      this.pending.delete(publicationId);
      item.resolve({ status: "outdated", reason: "Manutenção substituída por uma publicação JSONL mais recente." });
      this.setState({ phase: "superseded", expectedPublicationId: publicationId, summary: { status: "outdated" } });
    }
    let resolve!: (summary: BinaryEmbeddingCopySummary) => void;
    const promise = new Promise<BinaryEmbeddingCopySummary>((done) => { resolve = done; });
    this.pending.set(expectedPublicationId, { expectedPublicationId, resolve, promise });
    this.setState({ phase: "queued", expectedPublicationId });
    // Defer one microtask so duplicate callbacks and a newer publication in
    // the same completion turn can coalesce before any lease is acquired.
    if (!this.maintenanceRunner) this.maintenanceRunner = Promise.resolve().then(() => this.runMaintenanceQueue());
    return promise;
  }

  private async runMaintenanceQueue(): Promise<void> {
    try {
      while (!this.disposed && this.pending.size > 0) {
        const nextItem = this.pending.values().next();
        if (nextItem.done) return;
        const item = nextItem.value;
        this.pending.delete(item.expectedPublicationId);
        this.activeMaintenance = item;
        try { item.resolve(await this.runWrite(true, item.expectedPublicationId)); }
        finally { if (this.activeMaintenance === item) this.activeMaintenance = null; }
      }
    } finally {
      this.maintenanceRunner = null;
      if (!this.disposed && this.pending.size > 0) this.maintenanceRunner = this.runMaintenanceQueue();
    }
  }

  private async assertExpectedPublication(expectedPublicationId: string | undefined): Promise<CanonicalEmbeddingManifest> {
    const manifest = await this.readCanonicalManifest();
    if (expectedPublicationId && manifest.publicationId !== expectedPublicationId) throw new SupersededMaintenanceError("canonical publication changed");
    return manifest;
  }

  private async runWrite(automatic: boolean, expectedPublicationId?: string): Promise<BinaryEmbeddingCopySummary> {
    if (this.disposed) return { status: "error", reason: "Operação terminada." };
    if (this.running) return { status: "error", reason: "Operação já em curso." };
    this.running = true;
    let token: IndexWriteCoordinatorToken | undefined;
    try {
      const fence = await this.acquireFence?.();
      if (this.acquireFence && (!fence || !await fence.assertCurrent())) throw new Error("ownership-fence-rejected");
      // Validate the canonical commit marker before taking the write lease or
      // touching the potentially large JSONL payload.
      const manifest = await this.assertExpectedPublication(expectedPublicationId);
      if (this.disposed) return { status: "error", reason: "Operação terminada." };
      if (!manifest.publicationId) {
        const summary = { status: "unsupported" as const, reasonCode: "legacy-manifest" as const, reason: "Reconstrua ou atualize os embeddings para gerar uma publicação JSONL compatível antes de criar a cópia binária." };
        this.setState({ phase: "completed", expectedPublicationId, summary });
        return summary;
      }
      const sourcePublicationId = expectedPublicationId ?? manifest.publicationId;
      this.setState({ phase: "queued", expectedPublicationId: sourcePublicationId });
      const acquired = this.coordinator?.startBinaryMaintenance();
      if (acquired && acquired.status !== "accepted") {
        const summary = { status: "error" as const, reason: "Outra escrita do índice está em curso." };
        this.setState({ phase: "idle", expectedPublicationId: sourcePublicationId, summary });
        return summary;
      }
      token = acquired?.token;
      if (this.disposed) return { status: "error", reason: "Operação terminada." };
      this.setState({ phase: "reading-jsonl", expectedPublicationId: sourcePublicationId });
      const stat = await this.adapter.stat(canonicalJsonl);
      if (!stat || !evaluateEmbeddingBridgeRead(stat.size, getDeviceCapabilities().resourceProfile).allowed) {
        const summary: BinaryEmbeddingCopySummary = { status: "unsupported", reason: "Não foi possível validar o par canónico dentro do limite de recursos." };
        this.setState({ phase: "failed", expectedPublicationId: sourcePublicationId, summary });
        return summary;
      }
      const text = await this.adapter.read(canonicalJsonl);
      const currentManifest = await this.assertExpectedPublication(sourcePublicationId);
      if (inspectCanonicalPair(text, currentManifest.raw) !== "consistent") {
        const summary: BinaryEmbeddingCopySummary = { status: "invalid", reason: "Par canónico de embeddings inconsistente." };
        this.setState({ phase: "failed", expectedPublicationId: sourcePublicationId, summary });
        return summary;
      }
      const records = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as EmbeddingRecord);
      if (!records.length) return { status: "invalid", reason: "Índice JSONL inválido." };
      if (this.disposed) return { status: "error", reason: "Operação terminada." };
      await this.assertExpectedPublication(sourcePublicationId);
      await this.recoverDerived(currentManifest, this.fencedAdapter(fence));
      const identity: EmbeddingSpaceIdentity = { provider: manifest.provider, model: manifest.model, dimensions: manifest.dimensions, inputVersion: manifest.inputVersion, prefixMode: manifest.prefixMode };
      this.setState({ phase: "building", expectedPublicationId: sourcePublicationId });
      this.setState({ phase: "digesting", expectedPublicationId: sourcePublicationId });
      this.setState({ phase: "publishing", expectedPublicationId: sourcePublicationId });
      await new BinaryEmbeddingPublisher(this.fencedAdapter(fence), this.digest, {
        onStage: async (stage) => {
          if (this.disposed) throw new Error("disposed");
          if (fence && !await fence.assertCurrent()) throw new Error("ownership-fence-rejected");
          // The manifest is the commit marker: verify immediately before it.
          if (stage === "canonical-metadata") {
            const current = await this.assertExpectedPublication(sourcePublicationId);
            if (await this.readCanonicalPairState(current) !== "consistent") throw new Error("canonical-pair-inconsistent");
          }
        },
      }).publish(records, {
        format: "binary-v1",
        identity,
        recordCount: records.length,
        dimensions: manifest.dimensions,
        generationId: `derived-${sourcePublicationId}`,
        sourcePublicationId,
        ...(manifest.provenance ? { provenance: manifest.provenance } : {}),
      });
      if (this.disposed) return { status: "error", reason: "Operação terminada." };
      this.setState({ phase: "validating", expectedPublicationId: sourcePublicationId });
      const summary = await this.check(true);
      if (summary.status !== "valid" || summary.sourcePublicationId !== sourcePublicationId) throw new SupersededMaintenanceError("binary validation no longer matches canonical publication");
      this.setState({ phase: "completed", expectedPublicationId: sourcePublicationId, summary });
      return summary;
    } catch (error) {
      let superseded = error instanceof SupersededMaintenanceError;
      // The transactional publisher correctly wraps stage errors. Re-read the
      // canonical commit marker so a wrapped supersession is not misreported
      // as a derived failure.
      if (!superseded && expectedPublicationId && !this.disposed) {
        try { await this.assertExpectedPublication(expectedPublicationId); }
        catch (checkError) { superseded = checkError instanceof SupersededMaintenanceError; }
      }
      if (superseded) {
        const summary = { status: "outdated" as const, reason: "A publicação JSONL mudou durante a manutenção binária." };
        this.setState({ phase: "superseded", expectedPublicationId, summary });
        return summary;
      }
      const summary = { status: "error" as const, reason: automatic ? "Não foi possível manter a cópia binária." : "Não foi possível criar a cópia binária." };
      this.setState({ phase: this.disposed ? "disposed" : "failed", expectedPublicationId, summary });
      return summary;
    } finally {
      this.running = false;
      if (token) this.coordinator?.finish(token);
    }
  }

  async remove(): Promise<void> {
    if (this.running || this.disposed) return;
    const acquired = this.coordinator?.startBinaryMaintenance();
    if (acquired && acquired.status !== "accepted") throw new Error("index-write-busy");
    this.running = true; this.setState({ phase: "publishing" });
    try {
      const fence = await this.acquireFence?.();
      if (this.acquireFence && (!fence || !await fence.assertCurrent())) throw new Error("ownership-fence-rejected");
      const adapter = this.fencedAdapter(fence);
      for (const path of Object.values(BINARY_EMBEDDING_FILES)) if (await adapter.exists(path)) await adapter.remove(path);
      this.setState({ phase: "completed", summary: { status: "absent" } });
    } finally {
      this.running = false;
      if (acquired?.status === "accepted") this.coordinator?.finish(acquired.token);
    }
  }

  private async readCanonicalManifest(): Promise<CanonicalEmbeddingManifest> {
    const value: unknown = JSON.parse(await this.adapter.read(canonicalManifest));
    if (!isRecord(value) || !isRecord(value.embeddings) || !isRecord(value.embeddingInput)) throw new Error("invalid");
    const embeddings = value.embeddings;
    const input = value.embeddingInput;
    if (typeof embeddings.provider !== "string" || typeof embeddings.model !== "string" || typeof embeddings.dimensions !== "number" || !Number.isInteger(embeddings.dimensions) || typeof input.version !== "number" || !Number.isInteger(input.version) || (input.prefixMode !== "none" && input.prefixMode !== "nomic-search-query-document")) throw new Error("invalid");
    const provenance = isValidArtifactProvenance(embeddings.provenance) ? embeddings.provenance : undefined;
    return {
      raw: value,
      totalEmbeddings: typeof embeddings.totalEmbeddings === "number" ? embeddings.totalEmbeddings : undefined,
      publicationId: typeof embeddings.publicationId === "string" ? embeddings.publicationId : undefined,
      provider: embeddings.provider,
      model: embeddings.model,
      dimensions: embeddings.dimensions,
      inputVersion: input.version,
      prefixMode: input.prefixMode,
      ...(provenance ? { provenance } : {}),
    };
  }

  private async readCanonicalPairState(manifest: CanonicalEmbeddingManifest): Promise<CanonicalPairState> {
    const stat = await this.adapter.stat(canonicalJsonl);
    if (!stat || stat.type !== "file") return "inconsistent";
    // A resource refusal is not corruption. Do not bypass the bridge to prove correspondence.
    if (!evaluateEmbeddingBridgeRead(stat.size, getDeviceCapabilities().resourceProfile).allowed) return "resource-limit-exceeded";
    return inspectCanonicalPair(await this.adapter.read(canonicalJsonl), manifest.raw);
  }

  private async recoverDerived(canonical: CanonicalEmbeddingManifest, adapter: BinaryEmbeddingDataAdapter): Promise<void> {
    const recovered = await recoverBinaryEmbeddingPublication(adapter, this.digest, false, (manifest) =>
      manifest.sourcePublicationId === canonical.publicationId && manifest.recordCount === canonical.totalEmbeddings &&
      manifest.dimensions === canonical.dimensions && manifest.provider === canonical.provider && manifest.model === canonical.model &&
      manifest.inputFormatVersion === String(canonical.inputVersion) && manifest.prefixMode === canonical.prefixMode,
    { limits: getEmbeddingBinaryResourceLimits(getDeviceCapabilities().resourceProfile) });
    if (recovered === "none") {
      // Only the derivative is discarded, after a coherent canonical source was proved.
      for (const path of [BINARY_EMBEDDING_FILES.manifest, BINARY_EMBEDDING_FILES.metadata, BINARY_EMBEDDING_FILES.vectors]) {
        if (await adapter.exists(path)) await adapter.remove(path);
      }
    }
  }

  private fencedAdapter(fence?: EmbeddingWriteFence): BinaryEmbeddingDataAdapter {
    return new Proxy(this.adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        if (["write", "writeBinary", "remove", "rename", "mkdir"].includes(String(key))) return async (...args: unknown[]) => {
          if (fence && !await fence.assertCurrent()) throw new Error("ownership-fence-rejected");
          return Reflect.apply(value, target, args) as unknown;
        };
        return value.bind(target) as unknown;
      },
    });
  }
}
