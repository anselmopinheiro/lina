import { describe, it, expect, vi } from "vitest";
import {
  evaluateCompanionConsumptionState,
  readCompanionConsumptionState,
} from "../../src/companion/companionConsumptionState";
import { OwnershipManifest, OwnershipDataAdapter } from "../../src/device/deviceOwnership";
import { BINARY_EMBEDDING_FILES } from "../../src/index/embeddingBinaryStorage";

const MOCK_PRODUCER_ID = "550e8400-e29b-41d4-a716-446655440001";
const MOCK_COMPANION_ID = "550e8400-e29b-41d4-a716-446655440002";

function createMockOwnership(
  activeProducerId = MOCK_PRODUCER_ID,
  epoch = 3
): OwnershipManifest {
  return {
    schemaVersion: 1,
    activeProducerId,
    epoch,
    acquiredAt: "2026-08-31T10:00:00.000Z",
    updatedAt: "2026-08-31T10:00:00.000Z",
    reason: "manual-transfer",
  };
}

function createMockTextManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    indexType: "text",
    embeddingsEnabled: true,
    totalNotes: 42,
    totalChunks: 150,
    updatedAt: "2026-08-31T10:05:00.000Z",
    provenance: {
      producerDeviceId: MOCK_PRODUCER_ID,
      producerEpoch: 3,
      generatedAt: "2026-08-31T10:05:00.000Z",
    },
    embeddings: {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      recordCount: 150,
    },
    ...overrides,
  };
}

function createMockBinaryManifest(overrides: Record<string, unknown> = {}) {
  return {
    generationId: "gen-12345",
    sourcePublicationId: "pub-12345",
    recordCount: 150,
    dimensions: 768,
    provider: "ollama",
    model: "nomic-embed-text",
    createdAt: "2026-08-31T10:06:00.000Z",
    ...overrides,
  };
}

describe("CompanionConsumptionState (Phase 0.4.x Foundation)", () => {
  describe("evaluateCompanionConsumptionState", () => {
    it("evaluates fully synchronized valid artifacts in full consumption mode", () => {
      const ownership = createMockOwnership(MOCK_PRODUCER_ID, 3);
      const textManifest = createMockTextManifest();
      const binaryManifest = createMockBinaryManifest();

      const state = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership,
        textManifestRaw: textManifest,
        binaryManifestRaw: binaryManifest,
        timestamp: "2026-08-31T12:00:00.000Z",
      });

      expect(state.schemaVersion).toBe(1);
      expect(state.deviceId).toBe(MOCK_COMPANION_ID);
      expect(state.role).toBe("companion");
      expect(state.isCompanion).toBe(true);
      expect(state.lastKnownProducerEpoch).toBe(3);
      expect(state.activeProducerId).toBe(MOCK_PRODUCER_ID);
      expect(state.availableIndexVersion).toBe(1);
      expect(state.totalNotes).toBe(42);
      expect(state.totalChunks).toBe(150);

      // Embedding state
      expect(state.embeddingState.available).toBe(true);
      expect(state.embeddingState.provider).toBe("ollama");
      expect(state.embeddingState.model).toBe("nomic-embed-text");
      expect(state.embeddingState.dimensions).toBe(768);
      expect(state.embeddingState.recordCount).toBe(150);
      expect(state.embeddingState.hasBinaryAcceleration).toBe(true);

      // Provenance & Freshness
      expect(state.provenanceValidity).toBe("valid");
      expect(state.artifactFreshness).toBe("fresh");
      expect(state.artifactAvailability.textIndex).toBe("available");
      expect(state.artifactAvailability.embeddings).toBe("available");
      expect(state.artifactAvailability.binaryCopy).toBe("available");

      // Usability
      expect(state.canConsume).toBe(true);
      expect(state.consumptionMode).toBe("full");
    });

    it("evaluates text-only index when embeddings are disabled", () => {
      const ownership = createMockOwnership(MOCK_PRODUCER_ID, 2);
      const textManifest = createMockTextManifest({
        embeddingsEnabled: false,
        embeddings: undefined,
        provenance: {
          producerDeviceId: MOCK_PRODUCER_ID,
          producerEpoch: 2,
          generatedAt: "2026-08-31T09:00:00.000Z",
        },
      });

      const state = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership,
        textManifestRaw: textManifest,
        binaryManifestRaw: null,
      });

      expect(state.totalNotes).toBe(42);
      expect(state.embeddingState.available).toBe(false);
      expect(state.embeddingState.hasBinaryAcceleration).toBe(false);
      expect(state.provenanceValidity).toBe("valid");
      expect(state.artifactFreshness).toBe("fresh");
      expect(state.artifactAvailability.textIndex).toBe("available");
      expect(state.artifactAvailability.embeddings).toBe("missing");
      expect(state.artifactAvailability.binaryCopy).toBe("missing");
      expect(state.canConsume).toBe(true);
      expect(state.consumptionMode).toBe("text-only");
    });

    it("handles stale artifact provenance safely with non-blocking usability", () => {
      // Ownership is at epoch 5, but artifact was published at epoch 3
      const ownership = createMockOwnership(MOCK_PRODUCER_ID, 5);
      const textManifest = createMockTextManifest({
        provenance: {
          producerDeviceId: MOCK_PRODUCER_ID,
          producerEpoch: 3,
          generatedAt: "2026-08-31T08:00:00.000Z",
        },
      });

      const state = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership,
        textManifestRaw: textManifest,
      });

      expect(state.provenanceValidity).toBe("stale");
      expect(state.artifactFreshness).toBe("stale");
      // Core invariant: Stale artifacts remain 100% usable for search on Companion!
      expect(state.canConsume).toBe(true);
      expect(state.consumptionMode).toBe("full");
    });

    it("handles out-of-order sync / future artifact provenance safely", () => {
      // Artifact is at epoch 4, but local ownership manifest is only at epoch 2
      const ownership = createMockOwnership(MOCK_PRODUCER_ID, 2);
      const textManifest = createMockTextManifest({
        provenance: {
          producerDeviceId: MOCK_PRODUCER_ID,
          producerEpoch: 4,
          generatedAt: "2026-08-31T11:00:00.000Z",
        },
      });

      const state = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership,
        textManifestRaw: textManifest,
      });

      expect(state.provenanceValidity).toBe("future");
      expect(state.artifactFreshness).toBe("unknown");
      expect(state.canConsume).toBe(true);
      expect(state.consumptionMode).toBe("full");
    });

    it("handles legacy artifacts without provenance metadata", () => {
      const ownership = createMockOwnership(MOCK_PRODUCER_ID, 1);
      const textManifest = createMockTextManifest({
        provenance: undefined,
      });

      const state = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership,
        textManifestRaw: textManifest,
      });

      expect(state.provenanceValidity).toBe("unknown");
      expect(state.artifactFreshness).toBe("unknown");
      expect(state.canConsume).toBe(true);
      expect(state.consumptionMode).toBe("full");
    });

    it("handles missing text index manifest", () => {
      const ownership = createMockOwnership(MOCK_PRODUCER_ID, 1);

      const state = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership,
        textManifestRaw: null,
      });

      expect(state.artifactAvailability.textIndex).toBe("missing");
      expect(state.artifactFreshness).toBe("missing");
      expect(state.canConsume).toBe(false);
      expect(state.consumptionMode).toBe("unavailable");
    });

    it("handles invalid/corrupt text index manifest", () => {
      const ownership = createMockOwnership(MOCK_PRODUCER_ID, 1);

      const state = evaluateCompanionConsumptionState({
        deviceId: MOCK_COMPANION_ID,
        role: "companion",
        ownership,
        textManifestRaw: { invalidKey: "corrupt" },
      });

      expect(state.artifactAvailability.textIndex).toBe("invalid");
      expect(state.artifactFreshness).toBe("stale");
      expect(state.canConsume).toBe(false);
      expect(state.consumptionMode).toBe("degraded");
    });
  });

  describe("readCompanionConsumptionState", () => {
    function createMockAdapter(files: Record<string, string>): OwnershipDataAdapter {
      return {
        exists: vi.fn(async (path: string) => path in files),
        read: vi.fn(async (path: string) => {
          if (path in files) return files[path];
          throw new Error(`File not found: ${path}`);
        }),
        write: vi.fn(async () => {}),
        rename: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        stat: vi.fn(async (path: string) =>
          path in files ? { type: "file", size: files[path].length, mtime: Date.now() } : null
        ),
      };
    }

    it("loads complete companion state from mock vault filesystem", async () => {
      const ownershipJson = JSON.stringify(createMockOwnership(MOCK_PRODUCER_ID, 3));
      const textManifestJson = JSON.stringify(createMockTextManifest());
      const binaryManifestJson = JSON.stringify(createMockBinaryManifest());

      const adapter = createMockAdapter({
        ".lina/ownership.json": ownershipJson,
        ".lina/index/manifest.json": textManifestJson,
        [BINARY_EMBEDDING_FILES.manifest]: binaryManifestJson,
      });

      const state = await readCompanionConsumptionState(
        adapter,
        MOCK_COMPANION_ID,
        "companion"
      );

      expect(state.isCompanion).toBe(true);
      expect(state.lastKnownProducerEpoch).toBe(3);
      expect(state.activeProducerId).toBe(MOCK_PRODUCER_ID);
      expect(state.totalNotes).toBe(42);
      expect(state.totalChunks).toBe(150);
      expect(state.embeddingState.available).toBe(true);
      expect(state.embeddingState.hasBinaryAcceleration).toBe(true);
      expect(state.provenanceValidity).toBe("valid");
      expect(state.artifactFreshness).toBe("fresh");
      expect(state.canConsume).toBe(true);
      expect(state.consumptionMode).toBe("full");
    });

    it("handles missing files gracefully during read", async () => {
      const adapter = createMockAdapter({});

      const state = await readCompanionConsumptionState(
        adapter,
        MOCK_COMPANION_ID,
        "companion"
      );

      expect(state.isCompanion).toBe(true);
      expect(state.artifactAvailability.textIndex).toBe("missing");
      expect(state.artifactAvailability.embeddings).toBe("missing");
      expect(state.artifactAvailability.binaryCopy).toBe("missing");
      expect(state.canConsume).toBe(false);
      expect(state.consumptionMode).toBe("unavailable");
    });

    it("handles corrupt JSON in files without crashing", async () => {
      const adapter = createMockAdapter({
        ".lina/ownership.json": "{ corrupt-json",
        ".lina/index/manifest.json": "{ not-valid-json",
      });

      const state = await readCompanionConsumptionState(
        adapter,
        MOCK_COMPANION_ID,
        "companion"
      );

      expect(state.artifactAvailability.textIndex).toBe("missing");
      expect(state.canConsume).toBe(false);
      expect(state.consumptionMode).toBe("unavailable");
    });

    it("guarantees ZERO producer-side mutations during companion read", async () => {
      const adapter = createMockAdapter({
        ".lina/ownership.json": JSON.stringify(createMockOwnership()),
        ".lina/index/manifest.json": JSON.stringify(createMockTextManifest()),
      });

      await readCompanionConsumptionState(adapter, MOCK_COMPANION_ID, "companion");

      // Verify that readCompanionConsumptionState never writes or deletes anything
      expect(adapter.write).not.toHaveBeenCalled();
      expect(adapter.rename).not.toHaveBeenCalled();
      expect(adapter.remove).not.toHaveBeenCalled();
    });
  });
});
