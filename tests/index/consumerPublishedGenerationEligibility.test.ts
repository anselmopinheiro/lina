import { describe, expect, it } from "vitest";
import { evaluateConsumerPublishedGenerationEligibility } from "../../src/index/consumerPublishedGenerationEligibility";
const index: any = { sourceTextGenerationId: "text", sourceChunksDigest: "digest", sourcePublicationId: "pub", sourceRecordCount: 2, producerDeviceId: "dev-a", producerEpoch: 3 };
const good = { source: { sourceTextGenerationId: "text", sourceChunksDigest: "digest", sourcePublicationId: "pub", sourceRecordCount: 2 }, ownership: { activeProducerId: "dev-a", epoch: 3 } };
describe("M6 consumer provenance gate", () => {
  it("accepts matching read-only provenance", () => expect(evaluateConsumerPublishedGenerationEligibility(index, good)).toMatchObject({ eligible: true, sourceProvenanceStatus: "MATCH", producerProvenanceStatus: "MATCH" }));
  it("blocks objective source mismatches", () => expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, source: { ...good.source, sourceChunksDigest: "other" } })).toMatchObject({ eligible: false, sourceProvenanceStatus: "MISMATCH" }));
  it("classifies producer epochs and ownership absence", () => { expect(evaluateConsumerPublishedGenerationEligibility(index, { ...good, ownership: { activeProducerId: "dev-a", epoch: 4 } }).producerProvenanceStatus).toBe("STALE"); expect(evaluateConsumerPublishedGenerationEligibility(index, {}).producerProvenanceStatus).toBe("UNKNOWN"); });
});
