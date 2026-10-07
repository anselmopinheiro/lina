/** M4C orchestration boundary: canonical SQLite snapshot -> immutable projection. */
import { buildImmutableGeneration } from "./publishedGenerationBuilder";
import { publishImmutableGeneration, recoverPublishedGenerationPointer, type CurrentRecoveryResult, type GenerationPublishResult, type PublishedGenerationFileAdapter } from "./publishedGenerationWriter";
import { SqliteProducerLocalStore } from "./sqliteProducerLocalStore";
import type { EmbeddingSourceProvenance } from "./producerLocalStoreTypes";
import type { PublishedProducerProvenance } from "./publishedGenerationBuilder";

export interface ImmutablePublicationOptions {
  readonly enabled?: boolean;
  readonly canonicalEnabled?: boolean;
  readonly deviceRole?: string;
  readonly adapter: PublishedGenerationFileAdapter;
  readonly sourceProvenance?: EmbeddingSourceProvenance;
  readonly producerProvenance?: PublishedProducerProvenance;
  readonly assertFence?: () => Promise<boolean>;
}
export interface ImmutablePublicationResult {
  readonly attempted: boolean;
  readonly providerCalls: 0;
  readonly result?: GenerationPublishResult;
  readonly error?: string;
  readonly recovery?: CurrentRecoveryResult;
  readonly discovery?: { folders: readonly string[]; normalizedNames: readonly string[]; parsedNumbers: readonly number[]; maxExistingGeneration: number | null; candidateGenerationId: string | null };
}

export function parsePublishedGenerationNumber(folderPath: string): number | null {
  const basename = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const match = /^generation-(\d+)$/.exec(basename);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function nextPublishedGenerationNumber(folders: readonly string[]): number {
  const values = folders.map(parsePublishedGenerationNumber).filter((value): value is number => value !== null);
  return values.length === 0 ? 1 : Math.max(...values) + 1;
}

/** No legacy reads, providers, or embedding generation occur in this service. */
export async function publishSqliteCanonicalGeneration(store: SqliteProducerLocalStore, options: ImmutablePublicationOptions): Promise<ImmutablePublicationResult> {
  if (!options.enabled || !options.canonicalEnabled || options.deviceRole !== "producer") return { attempted: false, providerCalls: 0 };
  try {
    if (!options.producerProvenance || !await (options.assertFence?.() ?? Promise.resolve(false))) return { attempted: true, providerCalls: 0, error: "OWNERSHIP_FENCE_REJECTED" };
    const recovery = await recoverPublishedGenerationPointer(options.adapter);
    if (!recovery.success) return { attempted: true, providerCalls: 0, error: recovery.error, recovery };
    if (!store.isOpen) store.open();
    const records = store.getAllRecords();
    const spaceIds = [...new Set(records.map((record) => record.spaceId))];
    if (spaceIds.length === 0) return { attempted: true, providerCalls: 0, error: "EMPTY_CANONICAL_SNAPSHOT", recovery };
    if (spaceIds.length !== 1) return { attempted: true, providerCalls: 0, error: `MULTIPLE_EMBEDDING_SPACES:${spaceIds.join(",")}`, recovery };
    let space = store.getSpace(spaceIds[0]);
    if (!space) return { attempted: true, providerCalls: 0, error: `SQLITE_SPACE_MISSING:${spaceIds[0]}`, recovery };
    if (options.sourceProvenance) {
      space = { ...space, sourceProvenance: options.sourceProvenance, updatedAt: new Date().toISOString() };
      store.upsertEmbeddingSpace(space);
    }
    const listing = await options.adapter.list(".lina/published/generations").catch(() => ({ files: [], folders: [] }));
    const normalizedNames = listing.folders.map((folder) => folder.split(/[\\/]/).filter(Boolean).pop() ?? "");
    const parsedNumbers = listing.folders.map(parsePublishedGenerationNumber).filter((value): value is number => value !== null);
    const next = nextPublishedGenerationNumber(listing.folders);
    const discovery = { folders: listing.folders, normalizedNames, parsedNumbers, maxExistingGeneration: parsedNumbers.length ? Math.max(...parsedNumbers) : null, candidateGenerationId: `generation-${next.toString().padStart(6, "0")}` };
    if (!await (options.assertFence?.() ?? Promise.resolve(false))) return { attempted: true, providerCalls: 0, error: "OWNERSHIP_FENCE_REJECTED", discovery, recovery };
    const built = buildImmutableGeneration(space, records, next, new Date().toISOString(), options.producerProvenance);
    return { attempted: true, providerCalls: 0, result: await publishImmutableGeneration(options.adapter, built, { assertFence: options.assertFence }), discovery, recovery };
  } catch (error) { return { attempted: true, providerCalls: 0, error: error instanceof Error ? error.message : String(error) }; }
}
