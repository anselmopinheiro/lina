import { describe, expect, it } from "vitest";
import {
  ArtifactProvenance,
  compareProvenanceEpoch,
  createArtifactProvenance,
  extractArtifactProvenance,
  isValidArtifactProvenance,
} from "../../src/device/artifactProvenance";

describe("artifactProvenance (pure module)", () => {
  const validDeviceId = "d35767c1-4c36-4cb7-a31b-c90cb307d565";
  const validTimestamp = "2026-09-01T12:00:00.000Z";

  describe("isValidArtifactProvenance", () => {
    it("returns true for a well-formed provenance record", () => {
      const record: ArtifactProvenance = {
        producerDeviceId: validDeviceId,
        producerEpoch: 1,
        generatedAt: validTimestamp,
      };
      expect(isValidArtifactProvenance(record)).toBe(true);
    });

    it("returns true for higher epoch numbers", () => {
      expect(
        isValidArtifactProvenance({
          producerDeviceId: validDeviceId,
          producerEpoch: 42,
          generatedAt: new Date().toISOString(),
        })
      ).toBe(true);
    });

    it("returns false for non-object values", () => {
      expect(isValidArtifactProvenance(null)).toBe(false);
      expect(isValidArtifactProvenance(undefined)).toBe(false);
      expect(isValidArtifactProvenance("string")).toBe(false);
      expect(isValidArtifactProvenance(123)).toBe(false);
      expect(isValidArtifactProvenance([])).toBe(false);
    });

    it("returns false for invalid producerDeviceId", () => {
      expect(
        isValidArtifactProvenance({
          producerDeviceId: "not-a-uuid",
          producerEpoch: 1,
          generatedAt: validTimestamp,
        })
      ).toBe(false);

      expect(
        isValidArtifactProvenance({
          producerDeviceId: "",
          producerEpoch: 1,
          generatedAt: validTimestamp,
        })
      ).toBe(false);
    });

    it("returns false for invalid producerEpoch", () => {
      expect(
        isValidArtifactProvenance({
          producerDeviceId: validDeviceId,
          producerEpoch: 0,
          generatedAt: validTimestamp,
        })
      ).toBe(false);

      expect(
        isValidArtifactProvenance({
          producerDeviceId: validDeviceId,
          producerEpoch: -1,
          generatedAt: validTimestamp,
        })
      ).toBe(false);

      expect(
        isValidArtifactProvenance({
          producerDeviceId: validDeviceId,
          producerEpoch: 1.5,
          generatedAt: validTimestamp,
        })
      ).toBe(false);
    });

    it("returns false for invalid generatedAt timestamp", () => {
      expect(
        isValidArtifactProvenance({
          producerDeviceId: validDeviceId,
          producerEpoch: 1,
          generatedAt: "invalid-date",
        })
      ).toBe(false);

      expect(
        isValidArtifactProvenance({
          producerDeviceId: validDeviceId,
          producerEpoch: 1,
          generatedAt: "",
        })
      ).toBe(false);
    });
  });

  describe("createArtifactProvenance", () => {
    it("creates a valid record with explicit timestamp", () => {
      const record = createArtifactProvenance(validDeviceId, 5, validTimestamp);
      expect(record).toEqual({
        producerDeviceId: validDeviceId,
        producerEpoch: 5,
        generatedAt: validTimestamp,
      });
    });

    it("creates a valid record with default ISO timestamp", () => {
      const before = Date.now();
      const record = createArtifactProvenance(validDeviceId, 1);
      const after = Date.now();

      expect(record.producerDeviceId).toBe(validDeviceId);
      expect(record.producerEpoch).toBe(1);
      const parsedTime = Date.parse(record.generatedAt);
      expect(parsedTime).toBeGreaterThanOrEqual(before);
      expect(parsedTime).toBeLessThanOrEqual(after);
    });

    it("throws when producerDeviceId is invalid", () => {
      expect(() => createArtifactProvenance("invalid", 1)).toThrow(
        /Cannot create artifact provenance with invalid producerDeviceId/
      );
    });

    it("throws when producerEpoch is invalid", () => {
      expect(() => createArtifactProvenance(validDeviceId, 0)).toThrow(
        /Cannot create artifact provenance with invalid producerEpoch/
      );
    });

    it("throws when generatedAt is an unparseable timestamp", () => {
      expect(() => createArtifactProvenance(validDeviceId, 1, "bad-time")).toThrow(
        /Cannot create artifact provenance with invalid generatedAt/
      );
    });
  });

  describe("extractArtifactProvenance", () => {
    it("extracts provenance from a manifest object containing valid provenance", () => {
      const manifest = {
        version: 1,
        indexType: "text",
        provenance: {
          producerDeviceId: validDeviceId,
          producerEpoch: 3,
          generatedAt: validTimestamp,
        },
      };

      const extracted = extractArtifactProvenance(manifest);
      expect(extracted).toEqual({
        producerDeviceId: validDeviceId,
        producerEpoch: 3,
        generatedAt: validTimestamp,
      });
    });

    it("returns undefined for manifests without provenance", () => {
      expect(extractArtifactProvenance({ version: 1, indexType: "text" })).toBeUndefined();
      expect(extractArtifactProvenance(null)).toBeUndefined();
      expect(extractArtifactProvenance(undefined)).toBeUndefined();
    });

    it("returns undefined for manifests with invalid provenance shape", () => {
      expect(
        extractArtifactProvenance({
          version: 1,
          provenance: { producerDeviceId: "bad-id" },
        })
      ).toBeUndefined();
    });
  });

  describe("compareProvenanceEpoch", () => {
    it("returns 'unknown' when provenance is undefined", () => {
      expect(compareProvenanceEpoch(undefined, 1)).toBe("unknown");
    });

    it("returns 'unknown' when active epoch is invalid", () => {
      const provenance = createArtifactProvenance(validDeviceId, 1, validTimestamp);
      expect(compareProvenanceEpoch(provenance, 0)).toBe("unknown");
      expect(compareProvenanceEpoch(provenance, -1)).toBe("unknown");
    });

    it("returns 'match' when artifact epoch matches active epoch", () => {
      const provenance = createArtifactProvenance(validDeviceId, 3, validTimestamp);
      expect(compareProvenanceEpoch(provenance, 3)).toBe("match");
    });

    it("returns 'stale' when artifact epoch is older than active epoch", () => {
      const provenance = createArtifactProvenance(validDeviceId, 2, validTimestamp);
      expect(compareProvenanceEpoch(provenance, 5)).toBe("stale");
    });

    it("returns 'newer' when artifact epoch is greater than active epoch", () => {
      const provenance = createArtifactProvenance(validDeviceId, 7, validTimestamp);
      expect(compareProvenanceEpoch(provenance, 3)).toBe("newer");
    });
  });
});
