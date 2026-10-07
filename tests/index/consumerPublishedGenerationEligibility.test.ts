import { describe, expect, it } from "vitest";
import { evaluateConsumerPublishedGenerationEligibility } from "../../src/index/consumerPublishedGenerationEligibility";
const index: any = { sourceTextGenerationId: "text", sourceChunksDigest: "digest", sourcePublicationId: "pub", sourceRecordCount: 2, producerDeviceId: "dev-a", producerEpoch: 3 };
const good = { source: { sourceTextGenerationId: "text", sourceChunksDigest: "digest", sourcePublicationId: "pub", sourceRecordCount: 2 }, ownership: { activeProducerId: "dev-a", epoch: 3 }, structuralStatus: "VALID" as const, semanticStatus: "COMPATIBLE" as const };
describe("M6 consumer provenance gate", () => {
  it("accepts matching read-only provenance", () => expect(evaluateConsumerPublishedGenerationEligibility(index, good)).toMatchObject({ eligible: true, sourceProvenanceStatus: "MATCH", producerProvenanceStatus: "MATCH" }));
  it("blocks objective source mismatches", () => expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, source: { ...good.source, sourceChunksDigest: "other" } })).toMatchObject({ eligible: false, sourceProvenanceStatus: "MISMATCH" }));
  it("classifies producer epochs and ownership absence", () => { expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, ownership: { activeProducerId: "dev-a", epoch: 4 } }).producerProvenanceStatus).toBe("STALE"); expect(evaluateConsumerPublishedGenerationEligibility(index, { structuralStatus: "VALID", semanticStatus: "COMPATIBLE" }).producerProvenanceStatus).toBe("UNKNOWN"); });
  it("fails closed when source or ownership expectations are absent or partial", () => {
    expect(evaluateConsumerPublishedGenerationEligibility(index, { structuralStatus: "VALID", semanticStatus: "COMPATIBLE" })).toMatchObject({ eligible: false, sourceProvenanceStatus: "UNKNOWN", producerProvenanceStatus: "UNKNOWN" });
    expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, source: { sourceTextGenerationId: "text" } })).toMatchObject({ eligible: false, sourceProvenanceStatus: "UNKNOWN" });
    expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, source: { sourceTextGenerationId: "text", sourceChunksDigest: "digest" } })).toMatchObject({ eligible: false, sourceProvenanceStatus: "UNKNOWN" });
    expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, source: { sourceTextGenerationId: "text", sourceChunksDigest: "digest", sourcePublicationId: "pub" } })).toMatchObject({ eligible: false, sourceProvenanceStatus: "UNKNOWN" });
    expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, ownership: { activeProducerId: "dev-a" } })).toMatchObject({ eligible: false, producerProvenanceStatus: "UNKNOWN" });
    expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, ownership: { epoch: 3 } })).toMatchObject({ eligible: false, producerProvenanceStatus: "UNKNOWN" });
  });
  it("blocks invalid structural and incompatible semantic results", () => {
    expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, structuralStatus: "INVALID" })).toMatchObject({ eligible: false, structuralStatus: "INVALID" });
    expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, semanticStatus: "INCOMPATIBLE" })).toMatchObject({ eligible: false, semanticStatus: "INCOMPATIBLE" });
  });
});
