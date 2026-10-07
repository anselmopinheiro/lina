import type { BuiltGeneration } from "./publishedGenerationBuilder";
import { validatePublishedGenerationFiles, type PublishedGenerationValidationResult } from "./publishedGenerationValidator";

export interface PublishedGenerationFileAdapter { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; readBinary(path: string): Promise<ArrayBuffer>; write(path: string, value: string): Promise<void>; writeBinary(path: string, value: ArrayBuffer): Promise<void>; mkdir(path: string): Promise<void>; rename(from: string, to: string): Promise<void>; remove(path: string): Promise<void>; list(path: string): Promise<{ files: string[]; folders: string[] }>; }
export interface GenerationPublishResult { readonly success: boolean; readonly generationId?: string; readonly validation?: PublishedGenerationValidationResult; readonly error?: string; }
export type PublishedGenerationFailurePoint = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7";
export interface GenerationPublishOptions { readonly testFailurePoint?: PublishedGenerationFailurePoint; readonly assertFence?: () => Promise<boolean>; }
export interface CurrentRecoveryResult {
  readonly success: boolean;
  readonly action: "NO_OP" | "RECOVERED_TMP" | "RECOVERED_INTERRUPTED_UPDATE" | "RECOVERED_PROMOTED_NOT_CURRENT" | "RECOVERED_MISSING_CURRENT" | "CURRENT_RECOVERY_INVALID_TMP_TARGET" | "CURRENT_RECOVERY_TMP_NOT_NEWER" | "CURRENT_INVALID_TARGET";
  readonly currentBefore?: string;
  readonly currentTmpBefore?: string;
  readonly finalGenerationsBefore: readonly string[];
  readonly validFinalGenerations: readonly string[];
  readonly currentAfter?: string;
  readonly providerCalls: 0;
  readonly error?: string;
}
const root = ".lina/published";
const parse = (id: string): number => Number(id.slice("generation-".length));
const generationsRoot = `${root}/generations`;
const currentPath = `${root}/CURRENT`;
const currentTmpPath = `${root}/CURRENT.tmp`;
const generationName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? "";
const isGenerationId = (id: string): boolean => /^generation-\d{6,}$/.test(id);

/** Obsidian's DataAdapter.rename rejects an existing destination ("Destination file already exists!"), so CURRENT is removed first. */
async function replaceCurrent(adapter: PublishedGenerationFileAdapter, tmp: string, currentPath: string): Promise<void> {
  if (await adapter.exists(currentPath)) await adapter.remove(currentPath);
  await adapter.rename(tmp, currentPath);
  if (!await adapter.exists(currentPath)) throw new Error("CURRENT_REPLACEMENT_FAILED");
}

async function readPointer(adapter: PublishedGenerationFileAdapter, path: string): Promise<string | undefined> {
  return await adapter.exists(path) ? (await adapter.read(path)).trim() : undefined;
}

async function validateFinalGeneration(adapter: PublishedGenerationFileAdapter, generationId: string): Promise<boolean> {
  if (!isGenerationId(generationId)) return false;
  const finalPath = `${generationsRoot}/${generationId}`;
  try {
    const validation = validatePublishedGenerationFiles({
      manifest: await adapter.read(`${finalPath}/manifest.json`),
      records: await adapter.read(`${finalPath}/records.json`),
      vectors: new Uint8Array(await adapter.readBinary(`${finalPath}/vectors.bin`)),
    });
    return validation.integrityValid;
  } catch { return false; }
}

/**
 * Repairs only the mutable CURRENT pointer. A final generation is considered
 * recoverable because publishImmutableGeneration promotes it only after the
 * staging artefacts have been read back and validated successfully.
 */
export async function recoverPublishedGenerationPointer(adapter: PublishedGenerationFileAdapter): Promise<CurrentRecoveryResult> {
  const listing = await adapter.list(generationsRoot).catch(() => ({ files: [], folders: [] }));
  const finalGenerationsBefore = [...new Set(listing.folders.map(generationName).filter(isGenerationId))].sort((left, right) => parse(left) - parse(right));
  const validFinalGenerations: string[] = [];
  for (const generationId of finalGenerationsBefore) if (await validateFinalGeneration(adapter, generationId)) validFinalGenerations.push(generationId);
  const currentBefore = await readPointer(adapter, currentPath);
  const currentTmpBefore = await readPointer(adapter, currentTmpPath);
  const resultBase = { currentBefore, currentTmpBefore, finalGenerationsBefore, validFinalGenerations, providerCalls: 0 as const };
  const validFinals = new Set(validFinalGenerations);

  if (currentBefore && !validFinals.has(currentBefore)) return { success: false, action: "CURRENT_INVALID_TARGET", ...resultBase, error: "CURRENT_INVALID_TARGET" };
  if (currentTmpBefore && !validFinals.has(currentTmpBefore)) return { success: false, action: "CURRENT_RECOVERY_INVALID_TMP_TARGET", ...resultBase, currentAfter: currentBefore, error: "CURRENT_RECOVERY_INVALID_TMP_TARGET" };

  const promote = async (target: string, action: CurrentRecoveryResult["action"]): Promise<CurrentRecoveryResult> => {
    if (!currentTmpBefore || currentTmpBefore !== target) await adapter.write(currentTmpPath, target);
    await replaceCurrent(adapter, currentTmpPath, currentPath);
    const currentAfter = await readPointer(adapter, currentPath);
    if (currentAfter !== target) return { success: false, action, ...resultBase, currentAfter, error: "CURRENT_REPLACEMENT_FAILED" };
    return { success: true, action, ...resultBase, currentAfter };
  };

  if (currentTmpBefore) {
    if (!currentBefore) return promote(currentTmpBefore, "RECOVERED_TMP");
    if (parse(currentTmpBefore) > parse(currentBefore)) return promote(currentTmpBefore, "RECOVERED_INTERRUPTED_UPDATE");
    return { success: true, action: "CURRENT_RECOVERY_TMP_NOT_NEWER", ...resultBase, currentAfter: currentBefore };
  }

  const highestValid = validFinalGenerations.at(-1);
  if (!currentBefore && highestValid) return promote(highestValid, "RECOVERED_MISSING_CURRENT");
  if (currentBefore && highestValid && parse(highestValid) > parse(currentBefore)) return promote(highestValid, "RECOVERED_PROMOTED_NOT_CURRENT");
  return { success: true, action: "NO_OP", ...resultBase, currentAfter: currentBefore };
}

/** Stages, validates, promotes by directory rename, then replaces CURRENT via tmp rename. */
export async function publishImmutableGeneration(adapter: PublishedGenerationFileAdapter, generation: BuiltGeneration, options: GenerationPublishOptions = {}): Promise<GenerationPublishResult> {
  const generations = generationsRoot; const stagingRoot = `${root}/.staging`; const finalPath = `${generations}/${generation.manifest.generationId}`; const staging = `${stagingRoot}/${generation.manifest.generationId}-staging`;
  try {
    await adapter.mkdir(root); await adapter.mkdir(generations); await adapter.mkdir(stagingRoot);
    const recovery = await recoverPublishedGenerationPointer(adapter);
    if (!recovery.success) return { success: false, error: recovery.error };
    const current = await adapter.exists(currentPath) ? (await adapter.read(currentPath)).trim() : "";
    if (await adapter.exists(finalPath)) {
      const validation = validatePublishedGenerationFiles({
        manifest: await adapter.read(`${finalPath}/manifest.json`),
        records: await adapter.read(`${finalPath}/records.json`),
        vectors: new Uint8Array(await adapter.readBinary(`${finalPath}/vectors.bin`)),
      });
      if (!validation.valid) return { success: false, validation, error: "PROMOTED_GENERATION_INVALID" };
      if (current && parse(generation.manifest.generationId) > parse(current)) {
        await adapter.write(currentTmpPath, generation.manifest.generationId);
        await replaceCurrent(adapter, currentTmpPath, currentPath);
      }
      if (current && parse(generation.manifest.generationId) < parse(current)) return { success: false, validation, error: "ANTI_DOWNGRADE" };
      return { success: true, generationId: generation.manifest.generationId, validation };
    }
    if (current && parse(generation.manifest.generationId) <= parse(current)) return { success: false, error: "ANTI_DOWNGRADE" };
    if (await adapter.exists(staging)) await adapter.remove(staging);
    await adapter.mkdir(staging);
    if (options.testFailurePoint === "F1") throw new Error("Injected failure F1");
    await adapter.writeBinary(`${staging}/vectors.bin`, generation.vectors.buffer.slice(generation.vectors.byteOffset, generation.vectors.byteOffset + generation.vectors.byteLength));
    if (options.testFailurePoint === "F2") throw new Error("Injected failure F2");
    await adapter.write(`${staging}/records.json`, generation.recordsJson);
    if (options.testFailurePoint === "F3") throw new Error("Injected failure F3");
    await adapter.write(`${staging}/manifest.json`, JSON.stringify(generation.manifest));
    if (options.testFailurePoint === "F4") throw new Error("Injected failure F4");
    const validation = validatePublishedGenerationFiles({ manifest: await adapter.read(`${staging}/manifest.json`), records: await adapter.read(`${staging}/records.json`), vectors: new Uint8Array(await adapter.readBinary(`${staging}/vectors.bin`)) });
    if (!validation.valid) return { success: false, validation, error: "STAGING_INVALID" };
    if (options.testFailurePoint === "F5") throw new Error("Injected failure F5");
    if (options.assertFence && !await options.assertFence()) return { success: false, error: "OWNERSHIP_FENCE_REJECTED" };
    await adapter.rename(staging, finalPath);
    if (options.testFailurePoint === "F6") throw new Error("Injected failure F6");
    if (options.assertFence && !await options.assertFence()) return { success: false, error: "OWNERSHIP_FENCE_REJECTED" };
    await adapter.write(currentTmpPath, generation.manifest.generationId);
    if (options.testFailurePoint === "F7") throw new Error("Injected failure F7");
    await replaceCurrent(adapter, currentTmpPath, currentPath);
    return { success: true, generationId: generation.manifest.generationId, validation };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
