import { describe, expect, it } from "vitest";
import { resolveDeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import type { DeviceState } from "../../src/device/deviceState";
import type { OwnershipManifest } from "../../src/device/deviceOwnership";
import { adaptCurrentStateToLifecycleSnapshot } from "../../src/index/embeddingLifecycleAdapter";

const deviceId = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

const device = (role: "producer" | "companion"): DeviceState => ({
  schemaVersion: 2,
  deviceId,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  role,
});
const ownership = (active: string): OwnershipManifest => ({
  schemaVersion: 1,
  activeProducerId: active,
  epoch: 1,
  acquiredAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  reason: "initial",
});

const complete = {
  embeddingsEnabled: true,
  embeddings: { provider: "ollama", model: "nomic-embed-text", dimensions: 1024 },
  embeddingInput: { version: 1, prefixMode: "none" },
};
const legacy = { embeddingsEnabled: true, embeddings: { provider: "ollama", model: "nomic-embed-text" } };
const noInput = { embeddingsEnabled: true, embeddings: { provider: "ollama", model: "nomic-embed-text", dimensions: 1024 } };

describe("S3 — resolveDeviceRuntimeState without a lifecycle snapshot (LINA-15D-B)", () => {
  const roles = [
    ["producer", device("producer"), ownership(deviceId)],
    ["standby", device("producer"), ownership(other)],
    ["companion", device("companion"), ownership(other)],
  ] as const;

  for (const [label, state, own] of roles) {
    for (const [manifestLabel, manifest] of [["complete", complete], ["legacy (no dimensions/input)", legacy], ["no embeddingInput", noInput]] as const) {
      it(`${label} / ${manifestLabel} manifest: capability comes from facts, dimensions never invented`, () => {
        const runtime = resolveDeviceRuntimeState({
          deviceId,
          deviceState: state,
          ownership: own,
          embeddingsEnabled: true,
          textManifestRaw: { ...manifest, totalNotes: 1, totalChunks: 1 },
          semanticAvailability: { available: true, indexProvider: "ollama", indexModel: "nomic-embed-text", indexDimensions: manifestLabel === "complete" ? 1024 : undefined },
        });
        expect(runtime.embeddings.compatibility.dimensions).not.toBe(768);
        expect(runtime.embeddings.compatibility.dimensions).toBe(manifestLabel === "complete" ? 1024 : undefined);
        expect(runtime.embeddings.semanticAvailable).toBe(true);
        expect(runtime.embeddings.contractState).toBe("compatible");
      });
    }
  }

  it("an explicit lifecycle snapshot is preserved and used", () => {
    const snapshot = adaptCurrentStateToLifecycleSnapshot({
      upstreamTextIndex: "ready",
      canonicalExists: true,
      validForSearchCount: 0,
      publishedIdentity: { provider: "ollama", model: "m", dimensions: 8, inputVersion: 1, prefixMode: "none" },
    });
    const runtime = resolveDeviceRuntimeState({
      deviceId,
      deviceState: device("producer"),
      ownership: ownership(deviceId),
      embeddingsEnabled: true,
      textManifestRaw: { ...complete, totalNotes: 1, totalChunks: 1 },
      lifecycleSnapshot: snapshot,
    });
    expect(runtime.embeddings.semanticAvailable).toBe(false);
  });

  it("without any manifest or availability fact nothing is declared available", () => {
    const runtime = resolveDeviceRuntimeState({ deviceId, deviceState: device("producer"), ownership: ownership(deviceId), embeddingsEnabled: true });
    expect(runtime.embeddings.semanticAvailable).toBe(false);
    expect(runtime.embeddings.exists).toBe(false);
  });
});
