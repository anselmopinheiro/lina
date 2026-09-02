import { describe, expect, it, vi } from "vitest";
import {
  buildDeviceDiagnostics,
  readDeviceDiagnostics,
} from "../../src/device/deviceDiagnostics";
import { DeviceState } from "../../src/device/deviceState";
import { OwnershipManifest } from "../../src/device/deviceOwnership";
import { createArtifactProvenance } from "../../src/device/artifactProvenance";
import { BINARY_EMBEDDING_FILES } from "../../src/index/embeddingBinaryStorage";

class MemoryAdapter {
  readonly files = new Map<string, string>();
  readonly writeSpy = vi.fn();
  readonly renameSpy = vi.fn();
  readonly removeSpy = vi.fn();

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    for (const k of this.files.keys()) {
      if (k.startsWith(path + "/")) return true;
    }
    return false;
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Not found: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.writeSpy(path, content);
    this.files.set(path, content);
  }

  async rename(from: string, to: string): Promise<void> {
    this.renameSpy(from, to);
    const value = this.files.get(from);
    if (value !== undefined) {
      this.files.set(to, value);
      this.files.delete(from);
    }
  }

  async remove(path: string): Promise<void> {
    this.removeSpy(path);
    this.files.delete(path);
  }
}

describe("deviceDiagnostics", () => {
  const deviceIdA = "d35767c1-4c36-4cb7-a31b-c90cb307d565";
  const deviceIdB = "c4b12a87-6e42-4f38-9cb5-9c9823e4210a";
  const timestamp = "2026-09-01T12:00:00.000Z";

  describe("buildDeviceDiagnostics (pure builder)", () => {
    it("reports device information and unassigned role accurately", () => {
      const deviceState: DeviceState = {
        schemaVersion: 2,
        deviceId: deviceIdA,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const diagnostics = buildDeviceDiagnostics({
        deviceId: deviceIdA,
        deviceState,
        timestamp,
      });

      expect(diagnostics.device.id).toBe(deviceIdA);
      expect(diagnostics.device.name).toBeUndefined();
      expect(diagnostics.device.role).toBeUndefined();
      expect(diagnostics.device.isConfigured).toBe(false);
      expect(diagnostics.ownership.isUnassigned).toBe(true);
      expect(diagnostics.ownership.isUnclaimed).toBe(true);
      expect(diagnostics.ownership.isActiveProducer).toBe(false);
    });

    it("identifies active producer when deviceId matches active ownership manifest", () => {
      const deviceState: DeviceState = {
        schemaVersion: 2,
        deviceId: deviceIdA,
        deviceName: "Workstation",
        role: "producer",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const ownership: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: deviceIdA,
        epoch: 3,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reason: "initial",
      };

      const diagnostics = buildDeviceDiagnostics({
        deviceId: deviceIdA,
        deviceState,
        ownership,
        timestamp,
      });

      expect(diagnostics.device.name).toBe("Workstation");
      expect(diagnostics.device.role).toBe("producer");
      expect(diagnostics.device.isConfigured).toBe(true);
      expect(diagnostics.ownership.isActiveProducer).toBe(true);
      expect(diagnostics.ownership.isStandbyProducer).toBe(false);
      expect(diagnostics.ownership.epoch).toBe(3);
      expect(diagnostics.ownership.isUnclaimed).toBe(false);
    });

    it("identifies standby producer when another node is active producer", () => {
      const deviceState: DeviceState = {
        schemaVersion: 2,
        deviceId: deviceIdB,
        deviceName: "Laptop",
        role: "producer",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const ownership: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: deviceIdA,
        epoch: 3,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reason: "initial",
      };

      const diagnostics = buildDeviceDiagnostics({
        deviceId: deviceIdB,
        deviceState,
        ownership,
        timestamp,
      });

      expect(diagnostics.device.role).toBe("producer");
      expect(diagnostics.ownership.isActiveProducer).toBe(false);
      expect(diagnostics.ownership.isStandbyProducer).toBe(true);
      expect(diagnostics.ownership.isCompanion).toBe(false);
    });

    it("identifies companion role correctly", () => {
      const deviceState: DeviceState = {
        schemaVersion: 2,
        deviceId: deviceIdB,
        role: "companion",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const diagnostics = buildDeviceDiagnostics({
        deviceId: deviceIdB,
        deviceState,
        timestamp,
      });

      expect(diagnostics.device.role).toBe("companion");
      expect(diagnostics.ownership.isCompanion).toBe(true);
      expect(diagnostics.ownership.isActiveProducer).toBe(false);
      expect(diagnostics.ownership.isStandbyProducer).toBe(false);
    });

    it("evaluates artifact provenance states across text, embeddings, binary, and checkpoints", () => {
      const ownership: OwnershipManifest = {
        schemaVersion: 1,
        activeProducerId: deviceIdA,
        epoch: 2,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reason: "initial",
      };

      const textManifestRaw = {
        version: 1,
        indexType: "text",
        totalNotes: 42,
        totalChunks: 120,
        updatedAt: timestamp,
        provenance: createArtifactProvenance(deviceIdA, 2, timestamp),
        embeddingsEnabled: true,
        embeddings: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          provenance: createArtifactProvenance(deviceIdA, 1, timestamp), // stale epoch 1
        },
      };

      const binaryManifestRaw = {
        format: "lina-embeddings-binary",
        version: 1,
        generationId: "gen-1",
        recordCount: 120,
        dimensions: 768,
        createdAt: timestamp,
        provenance: createArtifactProvenance(deviceIdA, 4, timestamp), // future epoch 4
      };

      const checkpointMetaRaw = {
        schemaVersion: 1,
        operationId: "op-1",
        completedRecords: 60,
        dimension: 768,
        provenance: createArtifactProvenance(deviceIdA, 2, timestamp), // valid epoch 2
      };

      const diagnostics = buildDeviceDiagnostics({
        deviceId: deviceIdA,
        ownership,
        textManifestRaw,
        binaryManifestRaw,
        checkpointMetaRaw,
        timestamp,
      });

      // Text Index: Valid (epoch 2)
      expect(diagnostics.artifacts.index.exists).toBe(true);
      expect(diagnostics.artifacts.index.status).toBe("valid");
      expect(diagnostics.artifacts.index.totalNotes).toBe(42);
      expect(diagnostics.artifacts.index.totalChunks).toBe(120);

      // Embeddings: Stale (epoch 1 vs active 2)
      expect(diagnostics.artifacts.embeddings.exists).toBe(true);
      expect(diagnostics.artifacts.embeddings.status).toBe("stale");
      expect(diagnostics.artifacts.embeddings.model).toBe("nomic-embed-text");
      expect(diagnostics.artifacts.embeddings.dimensions).toBe(768);

      // Binary: Future (epoch 4 vs active 2)
      expect(diagnostics.artifacts.binary.exists).toBe(true);
      expect(diagnostics.artifacts.binary.status).toBe("future");
      expect(diagnostics.artifacts.binary.recordCount).toBe(120);

      // Checkpoint: Valid (epoch 2)
      expect(diagnostics.artifacts.checkpoint?.exists).toBe(true);
      expect(diagnostics.artifacts.checkpoint?.status).toBe("valid");
      expect(diagnostics.artifacts.checkpoint?.completedRecords).toBe(60);
    });

    it("handles missing artifacts gracefully with 'unknown' status and exists: false", () => {
      const diagnostics = buildDeviceDiagnostics({
        deviceId: deviceIdA,
        timestamp,
      });

      expect(diagnostics.artifacts.index.exists).toBe(false);
      expect(diagnostics.artifacts.index.status).toBe("unknown");
      expect(diagnostics.artifacts.embeddings.exists).toBe(false);
      expect(diagnostics.artifacts.embeddings.status).toBe("unknown");
      expect(diagnostics.artifacts.binary.exists).toBe(false);
      expect(diagnostics.artifacts.binary.status).toBe("unknown");
      expect(diagnostics.artifacts.checkpoint).toBeUndefined();
    });

    describe("ownership transfer readiness (Phase D2.5.3)", () => {
      it("reports already-active-producer when local device holds active ownership", () => {
        const deviceState: DeviceState = {
          schemaVersion: 2,
          deviceId: deviceIdA,
          role: "producer",
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const ownership: OwnershipManifest = {
          schemaVersion: 1,
          activeProducerId: deviceIdA,
          epoch: 5,
          acquiredAt: timestamp,
          updatedAt: timestamp,
          reason: "initial",
        };

        const diagnostics = buildDeviceDiagnostics({
          deviceId: deviceIdA,
          deviceState,
          ownership,
          timestamp,
        });

        expect(diagnostics.transfer.ownershipExists).toBe(true);
        expect(diagnostics.transfer.activeProducerId).toBe(deviceIdA);
        expect(diagnostics.transfer.currentEpoch).toBe(5);
        expect(diagnostics.transfer.localDeviceId).toBe(deviceIdA);
        expect(diagnostics.transfer.isLocalActiveProducer).toBe(true);
        expect(diagnostics.transfer.canTransferOwnership).toBe(false);
        expect(diagnostics.transfer.eligibilityReason).toBe("already-active-producer");
      });

      it("reports ready for transfer when local device is a standby producer", () => {
        const deviceState: DeviceState = {
          schemaVersion: 2,
          deviceId: deviceIdB,
          role: "producer",
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const ownership: OwnershipManifest = {
          schemaVersion: 1,
          activeProducerId: deviceIdA,
          epoch: 3,
          acquiredAt: timestamp,
          updatedAt: timestamp,
          reason: "manual-transfer",
        };

        const diagnostics = buildDeviceDiagnostics({
          deviceId: deviceIdB,
          deviceState,
          ownership,
          timestamp,
        });

        expect(diagnostics.transfer.ownershipExists).toBe(true);
        expect(diagnostics.transfer.activeProducerId).toBe(deviceIdA);
        expect(diagnostics.transfer.currentEpoch).toBe(3);
        expect(diagnostics.transfer.localDeviceId).toBe(deviceIdB);
        expect(diagnostics.transfer.isLocalActiveProducer).toBe(false);
        expect(diagnostics.transfer.canTransferOwnership).toBe(true);
        expect(diagnostics.transfer.eligibilityReason).toBe("ready");
      });

      it("reports companion-role when local device is configured as companion", () => {
        const deviceState: DeviceState = {
          schemaVersion: 2,
          deviceId: deviceIdB,
          role: "companion",
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const ownership: OwnershipManifest = {
          schemaVersion: 1,
          activeProducerId: deviceIdA,
          epoch: 2,
          acquiredAt: timestamp,
          updatedAt: timestamp,
          reason: "initial",
        };

        const diagnostics = buildDeviceDiagnostics({
          deviceId: deviceIdB,
          deviceState,
          ownership,
          timestamp,
        });

        expect(diagnostics.transfer.ownershipExists).toBe(true);
        expect(diagnostics.transfer.isLocalActiveProducer).toBe(false);
        expect(diagnostics.transfer.canTransferOwnership).toBe(false);
        expect(diagnostics.transfer.eligibilityReason).toBe("companion-role");
      });

      it("reports unassigned-role when local device has no configured role", () => {
        const ownership: OwnershipManifest = {
          schemaVersion: 1,
          activeProducerId: deviceIdA,
          epoch: 1,
          acquiredAt: timestamp,
          updatedAt: timestamp,
          reason: "initial",
        };

        const diagnostics = buildDeviceDiagnostics({
          deviceId: deviceIdB,
          ownership,
          timestamp,
        });

        expect(diagnostics.transfer.ownershipExists).toBe(true);
        expect(diagnostics.transfer.isLocalActiveProducer).toBe(false);
        expect(diagnostics.transfer.canTransferOwnership).toBe(false);
        expect(diagnostics.transfer.eligibilityReason).toBe("unassigned-role");
      });

      it("reports missing-ownership when no ownership manifest exists in vault", () => {
        const deviceState: DeviceState = {
          schemaVersion: 2,
          deviceId: deviceIdA,
          role: "producer",
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const diagnostics = buildDeviceDiagnostics({
          deviceId: deviceIdA,
          deviceState,
          ownership: null,
          timestamp,
        });

        expect(diagnostics.transfer.ownershipExists).toBe(false);
        expect(diagnostics.transfer.activeProducerId).toBeUndefined();
        expect(diagnostics.transfer.currentEpoch).toBeUndefined();
        expect(diagnostics.transfer.isLocalActiveProducer).toBe(false);
        expect(diagnostics.transfer.canTransferOwnership).toBe(false);
        expect(diagnostics.transfer.eligibilityReason).toBe("missing-ownership");
      });
    });
  });

  describe("readDeviceDiagnostics (read-only adapter integration)", () => {
    it("reads vault files and produces diagnostic snapshot without performing any write or remove operations", async () => {
      const adapter = new MemoryAdapter();

      // Populate mock vault files
      adapter.files.set(
        `.lina/devices/${deviceIdA}.json`,
        JSON.stringify({
          schemaVersion: 2,
          deviceId: deviceIdA,
          deviceName: "MacBook Pro",
          role: "producer",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      );

      adapter.files.set(
        ".lina/ownership.json",
        JSON.stringify({
          schemaVersion: 1,
          activeProducerId: deviceIdA,
          epoch: 1,
          acquiredAt: timestamp,
          updatedAt: timestamp,
          reason: "initial",
        })
      );

      adapter.files.set(
        ".lina/index/manifest.json",
        JSON.stringify({
          version: 1,
          indexType: "text",
          totalNotes: 10,
          totalChunks: 25,
          updatedAt: timestamp,
          provenance: createArtifactProvenance(deviceIdA, 1, timestamp),
        })
      );

      adapter.files.set(
        BINARY_EMBEDDING_FILES.manifest,
        JSON.stringify({
          format: "lina-embeddings-binary",
          version: 1,
          generationId: "g1",
          recordCount: 25,
          dimensions: 384,
          createdAt: timestamp,
          provenance: createArtifactProvenance(deviceIdA, 1, timestamp),
        })
      );

      const diagnostics = await readDeviceDiagnostics(adapter as any, deviceIdA);

      // Verify diagnostics content
      expect(diagnostics.device.name).toBe("MacBook Pro");
      expect(diagnostics.device.role).toBe("producer");
      expect(diagnostics.ownership.isActiveProducer).toBe(true);
      expect(diagnostics.artifacts.index.status).toBe("valid");
      expect(diagnostics.artifacts.index.totalNotes).toBe(10);
      expect(diagnostics.artifacts.binary.status).toBe("valid");

      // Verify read-only guarantees (ZERO writes, ZERO renames, ZERO removals)
      expect(adapter.writeSpy).not.toHaveBeenCalled();
      expect(adapter.renameSpy).not.toHaveBeenCalled();
      expect(adapter.removeSpy).not.toHaveBeenCalled();
    });

    it("handles corrupted or unreadable JSON files defensively without throwing errors", async () => {
      const adapter = new MemoryAdapter();

      // Corrupted JSON files
      adapter.files.set(`.lina/devices/${deviceIdA}.json`, "{ invalid json syntax");
      adapter.files.set(".lina/ownership.json", "corrupted ownership content");
      adapter.files.set(".lina/index/manifest.json", "corrupted text manifest");

      const diagnostics = await readDeviceDiagnostics(adapter as any, deviceIdA);

      expect(diagnostics.device.id).toBe(deviceIdA);
      expect(diagnostics.device.name).toBeUndefined();
      expect(diagnostics.ownership.isUnclaimed).toBe(true);
      expect(diagnostics.artifacts.index.exists).toBe(false);
      expect(diagnostics.artifacts.index.status).toBe("unknown");

      // Verify read-only guarantees
      expect(adapter.writeSpy).not.toHaveBeenCalled();
      expect(adapter.renameSpy).not.toHaveBeenCalled();
      expect(adapter.removeSpy).not.toHaveBeenCalled();
    });

    it("reads audit history and evaluates recovery consistency state", async () => {
      const adapter = new MemoryAdapter();

      // Healthy ownership & audit history
      adapter.files.set(
        ".lina/ownership.json",
        JSON.stringify({
          schemaVersion: 1,
          activeProducerId: deviceIdA,
          epoch: 2,
          acquiredAt: timestamp,
          updatedAt: timestamp,
          reason: "manual-transfer",
        })
      );

      // We add list support to MemoryAdapter or sequential files
      (adapter as any).list = async (path: string) => {
        const prefix = path === "" ? "" : path + "/";
        const files: string[] = [];
        for (const k of adapter.files.keys()) {
          if (k.startsWith(prefix)) files.push(k);
        }
        return { files, folders: [] };
      };

      adapter.files.set(
        ".lina/ownership-history/001.json",
        JSON.stringify({
          schemaVersion: 1,
          eventId: "e1",
          newProducerId: deviceIdB,
          newEpoch: 1,
          reason: "initial",
          executedAt: timestamp,
        })
      );

      adapter.files.set(
        ".lina/ownership-history/002.json",
        JSON.stringify({
          schemaVersion: 1,
          eventId: "e2",
          previousProducerId: deviceIdB,
          newProducerId: deviceIdA,
          previousEpoch: 1,
          newEpoch: 2,
          reason: "manual-transfer",
          executedAt: timestamp,
        })
      );

      const diagnostics = await readDeviceDiagnostics(adapter as any, deviceIdA);

      expect(diagnostics.recovery).toBeDefined();
      expect(diagnostics.recovery.status).toBe("healthy");
      expect(diagnostics.recovery.hasManifest).toBe(true);
      expect(diagnostics.recovery.hasHistory).toBe(true);
      expect(diagnostics.recovery.currentEpoch).toBe(2);
      expect(diagnostics.recovery.latestAuditEpoch).toBe(2);
      expect(diagnostics.recovery.totalAuditEvents).toBe(2);
      expect(diagnostics.recovery.warnings).toHaveLength(0);

      // Non-mutation verification
      expect(adapter.writeSpy).not.toHaveBeenCalled();
      expect(adapter.renameSpy).not.toHaveBeenCalled();
      expect(adapter.removeSpy).not.toHaveBeenCalled();
    });
  });
});
