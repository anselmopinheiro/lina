import {
  buildDeviceDiagnostics,
  readDeviceDiagnostics,
  type BuildDeviceDiagnosticsInput,
  type ReadDeviceDiagnosticsOptions,
} from "../../src/device/deviceDiagnostics";
import { resolveDeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { loadDeviceState } from "../../src/device/deviceState";
import { loadOwnership } from "../../src/device/deviceOwnership";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";
import type { EmbeddingLifecycleSnapshot } from "../../src/index/embeddingLifecycleModel";
import type { SemanticCompatibility } from "../../src/search/hybridSearch";

type Manifest = Record<string, unknown> | null | undefined;

/**
 * Test-side snapshot for a declared manifest scenario: the identity is the one the test manifest
 * publishes (explicit fixture facts, not a production fallback — LINA-15D-B / S4).
 */
export function snapshotForManifest(
  runtime: ReturnType<typeof resolveDeviceRuntimeState>,
  textManifestRaw: unknown,
  semanticAvailability?: SemanticCompatibility,
  semanticCapability?: { semanticAvailable: boolean }
): EmbeddingLifecycleSnapshot {
  const manifest = (textManifestRaw ?? null) as Manifest;
  const embeddings = manifest && typeof manifest === "object" ? (manifest.embeddings as Record<string, unknown> | undefined) : undefined;
  const input = manifest && typeof manifest === "object" ? (manifest.embeddingInput as Record<string, unknown> | undefined) : undefined;
  const identity = embeddings && typeof embeddings.provider === "string" && typeof embeddings.model === "string"
    ? {
      provider: embeddings.provider,
      model: embeddings.model,
      dimensions: typeof embeddings.dimensions === "number" ? embeddings.dimensions : undefined,
      inputVersion: typeof input?.version === "number" ? input.version : 1,
      prefixMode: (input?.prefixMode as "none" | "nomic-search-query-document" | undefined) ?? "none",
    }
    : undefined;
  return adaptCurrentStateToLifecycleSnapshot({
    deviceRuntimeState: runtime,
    upstreamTextIndex: manifest ? "ready" : "missing",
    canonicalExists: Boolean(embeddings),
    validForSearchCount: semanticAvailability?.available || (embeddings && identity && semanticCapability?.semanticAvailable !== false) ? 1 : 0,
    publishedIdentity: identity,
    targetIdentity: identity,
  });
}

export function buildDiagnosticsWithSnapshot(
  input: Omit<BuildDeviceDiagnosticsInput, "lifecycleSnapshot"> & { lifecycleSnapshot?: EmbeddingLifecycleSnapshot }
) {
  const runtime = resolveDeviceRuntimeState({
    deviceId: input.deviceId,
    deviceState: input.deviceState ?? undefined,
    ownership: input.ownership ?? undefined,
    roleResolution: input.roleResolution,
    isMobile: input.isMobile,
    legacyRoleFallbackAllowed: input.legacyRoleFallbackAllowed,
    textManifestRaw: input.textManifestRaw,
    binaryManifestRaw: input.binaryManifestRaw,
    semanticAvailability: input.semanticAvailability,
    semanticCapability: input.semanticCapability,
  });
  return buildDeviceDiagnostics({
    ...input,
    lifecycleSnapshot: input.lifecycleSnapshot ?? snapshotForManifest(runtime, input.textManifestRaw, input.semanticAvailability, input.semanticCapability),
  });
}

export async function readDiagnosticsWithSnapshot(
  adapter: Parameters<typeof readDeviceDiagnostics>[0],
  deviceId: string,
  options: Omit<ReadDeviceDiagnosticsOptions, "lifecycleSnapshot"> & { lifecycleSnapshot?: EmbeddingLifecycleSnapshot } = {}
) {
  if (options.lifecycleSnapshot) {
    return readDeviceDiagnostics(adapter, deviceId, { ...options, lifecycleSnapshot: options.lifecycleSnapshot });
  }
  let manifest: unknown = null;
  try {
    if (await adapter.exists(".lina/index/manifest.json")) {
      manifest = JSON.parse(await adapter.read(".lina/index/manifest.json"));
    }
  } catch {
    manifest = null;
  }
  const deviceState = await loadDeviceState(adapter, deviceId.trim()).catch(() => null);
  const ownership = await loadOwnership(adapter).catch(() => null);
  const runtime = resolveDeviceRuntimeState({
    deviceId: deviceId.trim(),
    deviceState: deviceState ?? undefined,
    ownership: ownership ?? undefined,
    roleResolution: options.roleResolution,
    isMobile: options.isMobile,
    legacyRoleFallbackAllowed: options.legacyRoleFallbackAllowed,
    textManifestRaw: manifest,
    semanticAvailability: options.semanticAvailability,
  });
  return readDeviceDiagnostics(adapter, deviceId, {
    ...options,
    lifecycleSnapshot: snapshotForManifest(runtime, manifest, options.semanticAvailability, options.semanticCapability),
  });
}
