import { describe, expect, it } from "vitest";
import {
  createArtifactProvenance,
  ArtifactProvenance,
} from "../../src/device/artifactProvenance";
import {
  evaluateArtifactProvenance,
  formatArtifactProvenanceDiagnostic,
} from "../../src/device/artifactProvenanceValidation";
import { OwnershipManifest } from "../../src/device/deviceOwnership";
import { OwnershipGate } from "../../src/device/ownershipGate";

class MemoryAdapter {
  private readonly files = new Map<string, string>();
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Not found: ${path}`);
    return value;
  }
  async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value !== undefined) {
      this.files.set(to, value);
      this.files.delete(from);
    }
  }
  async mkdir(): Promise<void> {}
}

describe("artifactProvenanceValidation (pure module)", () => {
  const producerA = "d35767c1-4c36-4cb7-a31b-c90cb307d565";
  const producerB = "c4b12a87-6e42-4f38-9cb5-9c9823e4210a";
  const validTimestamp = "2026-09-01T12:00:00.000Z";

  const activeOwnership: OwnershipManifest = {
    schemaVersion: 1,
    activeProducerId: producerA,
    epoch: 5,
    acquiredAt: validTimestamp,
    updatedAt: validTimestamp,
    reason: "initial",
  };

  describe("Matching provenance (valid)", () => {
    it("evaluates to 'valid' when epoch and producerId match current active ownership", () => {
      const prov = createArtifactProvenance(producerA, 5, validTimestamp);
      const result = evaluateArtifactProvenance(prov, activeOwnership, producerA);

      expect(result.status).toBe("valid");
      expect(result.reason).toBe("epoch-and-producer-match");
      expect(result.isProducedByCurrentOwner).toBe(true);
      expect(result.isProducedByLocalDevice).toBe(true);
      expect(result.ownershipEpoch).toBe(5);
      expect(result.activeProducerId).toBe(producerA);
      expect(result.artifactProvenance).toEqual(prov);
    });

    it("marks isProducedByLocalDevice as false if produced by another node which is the active owner", () => {
      const prov = createArtifactProvenance(producerA, 5, validTimestamp);
      const result = evaluateArtifactProvenance(prov, activeOwnership, producerB);

      expect(result.status).toBe("valid");
      expect(result.isProducedByCurrentOwner).toBe(true);
      expect(result.isProducedByLocalDevice).toBe(false);
    });
  });

  describe("Older artifact (stale epoch)", () => {
    it("evaluates to 'stale' when artifact epoch is lower than current ownership epoch", () => {
      const prov = createArtifactProvenance(producerA, 3, validTimestamp);
      const result = evaluateArtifactProvenance(prov, activeOwnership, producerA);

      expect(result.status).toBe("stale");
      expect(result.reason).toBe("epoch-behind-ownership");
      expect(result.isProducedByCurrentOwner).toBe(false);
      expect(result.isProducedByLocalDevice).toBe(true);
    });
  });

  describe("Producer mismatch at same epoch (stale)", () => {
    it("evaluates to 'stale' when epoch matches but producerDeviceId differs from active owner", () => {
      const prov = createArtifactProvenance(producerB, 5, validTimestamp);
      const result = evaluateArtifactProvenance(prov, activeOwnership, producerB);

      expect(result.status).toBe("stale");
      expect(result.reason).toBe("producer-mismatch");
      expect(result.isProducedByCurrentOwner).toBe(false);
      expect(result.isProducedByLocalDevice).toBe(true);
    });
  });

  describe("Future artifact (future epoch)", () => {
    it("evaluates to 'future' when artifact epoch is higher than local ownership epoch", () => {
      const prov = createArtifactProvenance(producerB, 7, validTimestamp);
      const result = evaluateArtifactProvenance(prov, activeOwnership, producerA);

      expect(result.status).toBe("future");
      expect(result.reason).toBe("epoch-ahead-of-ownership");
      expect(result.isProducedByCurrentOwner).toBe(false);
      expect(result.isProducedByLocalDevice).toBe(false);
    });
  });

  describe("Missing provenance (unknown)", () => {
    it("evaluates to 'unknown' with reason 'provenance-missing' when provenance is undefined", () => {
      const result = evaluateArtifactProvenance(undefined, activeOwnership);

      expect(result.status).toBe("unknown");
      expect(result.reason).toBe("provenance-missing");
      expect(result.isProducedByCurrentOwner).toBe(false);
      expect(result.isProducedByLocalDevice).toBe(false);
    });

    it("extracts provenance safely from a manifest wrapper", () => {
      const manifest = {
        version: 1,
        indexType: "text",
        provenance: createArtifactProvenance(producerA, 5, validTimestamp),
      };

      const result = evaluateArtifactProvenance(manifest, activeOwnership, producerA);
      expect(result.status).toBe("valid");
      expect(result.isProducedByCurrentOwner).toBe(true);
    });

    it("evaluates manifest without provenance as 'unknown'", () => {
      const manifest = { version: 1, indexType: "text" };
      const result = evaluateArtifactProvenance(manifest, activeOwnership);

      expect(result.status).toBe("unknown");
      expect(result.reason).toBe("provenance-missing");
    });
  });

  describe("Malformed provenance (unknown)", () => {
    it("evaluates to 'unknown' with reason 'provenance-invalid' for invalid provenance data", () => {
      const malformed = {
        producerDeviceId: "invalid-uuid",
        producerEpoch: -1,
      };

      const result = evaluateArtifactProvenance(malformed, activeOwnership);
      expect(result.status).toBe("unknown");
      expect(result.reason).toBe("provenance-invalid");
    });

    it("evaluates to 'unknown' with reason 'provenance-invalid' for malformed manifest provenance", () => {
      const manifest = {
        version: 1,
        provenance: { producerDeviceId: "not-a-uuid" },
      };

      const result = evaluateArtifactProvenance(manifest, activeOwnership);
      expect(result.status).toBe("unknown");
      expect(result.reason).toBe("provenance-invalid");
    });
  });

  describe("Missing ownership manifest (unknown)", () => {
    it("evaluates to 'unknown' with reason 'ownership-unavailable' when ownership is absent", () => {
      const prov = createArtifactProvenance(producerA, 1, validTimestamp);
      const result = evaluateArtifactProvenance(prov, undefined, producerA);

      expect(result.status).toBe("unknown");
      expect(result.reason).toBe("ownership-unavailable");
      expect(result.artifactProvenance).toEqual(prov);
      expect(result.ownershipEpoch).toBeUndefined();
      expect(result.isProducedByCurrentOwner).toBe(false);
    });

    it("evaluates to 'unknown' with reason 'ownership-unavailable' when ownership epoch is invalid", () => {
      const prov = createArtifactProvenance(producerA, 1, validTimestamp);
      const result = evaluateArtifactProvenance(prov, { epoch: 0, activeProducerId: producerA });

      expect(result.status).toBe("unknown");
      expect(result.reason).toBe("ownership-unavailable");
    });
  });

  describe("formatArtifactProvenanceDiagnostic", () => {
    it("formats valid result diagnostic", () => {
      const prov = createArtifactProvenance(producerA, 2, validTimestamp);
      const valid = evaluateArtifactProvenance(prov, { epoch: 2, activeProducerId: producerA }, producerA);
      expect(formatArtifactProvenanceDiagnostic(valid)).toContain("Válido");
    });

    it("formats stale epoch diagnostic", () => {
      const prov = createArtifactProvenance(producerA, 1, validTimestamp);
      const stale = evaluateArtifactProvenance(prov, { epoch: 3, activeProducerId: producerA });
      expect(formatArtifactProvenanceDiagnostic(stale)).toContain("Desatualizado");
      expect(formatArtifactProvenanceDiagnostic(stale)).toContain("Epoch 1 vs Epoch atual 3");
    });

    it("formats producer mismatch diagnostic", () => {
      const prov = createArtifactProvenance(producerB, 3, validTimestamp);
      const mismatch = evaluateArtifactProvenance(prov, { epoch: 3, activeProducerId: producerA });
      expect(formatArtifactProvenanceDiagnostic(mismatch)).toContain("produtor divergente");
    });

    it("formats future epoch diagnostic", () => {
      const prov = createArtifactProvenance(producerA, 5, validTimestamp);
      const future = evaluateArtifactProvenance(prov, { epoch: 2, activeProducerId: producerA });
      expect(formatArtifactProvenanceDiagnostic(future)).toContain("Futuro");
      expect(formatArtifactProvenanceDiagnostic(future)).toContain("Epoch 5 à frente do Epoch local 2");
    });

    it("formats legacy unknown diagnostic", () => {
      const unknown = evaluateArtifactProvenance(undefined, { epoch: 2, activeProducerId: producerA });
      expect(formatArtifactProvenanceDiagnostic(unknown)).toContain("Sem metadados de proveniência");
    });
  });

  describe("OwnershipGate integration", () => {
    it("validates artifact provenance against cached decision", async () => {
      const adapter = new MemoryAdapter();
      const gate = new OwnershipGate(adapter as any, () => producerA, () => "producer", true);

      await gate.evaluate();
      const decision = gate.getLastDecision();
      expect(decision?.authorized).toBe(true);

      const prov = createArtifactProvenance(producerA, 1, validTimestamp);
      const val = gate.validateArtifact(prov);
      expect(val.status).toBe("valid");
      expect(val.isProducedByCurrentOwner).toBe(true);
      expect(val.isProducedByLocalDevice).toBe(true);
    });

    it("validates artifact asynchronously evaluating if not yet cached", async () => {
      const adapter = new MemoryAdapter();
      const gate = new OwnershipGate(adapter as any, () => producerA, () => "producer", true);

      const prov = createArtifactProvenance(producerA, 1, validTimestamp);
      const val = await gate.validateArtifactAsync(prov);
      expect(val.status).toBe("valid");
      expect(val.isProducedByCurrentOwner).toBe(true);
    });
  });
});
