/** Read-only contextual provenance policy for published generations. */
import type { PublishedGenerationRuntimeIndex } from "./publishedGenerationReader";

export type ConsumerProvenanceStatus = "MATCH" | "STALE" | "FUTURE" | "UNKNOWN" | "MISMATCH";
export interface ConsumerSourceProvenance { readonly sourceTextGenerationId?: string; readonly sourceChunksDigest?: string; readonly sourcePublicationId?: string; readonly sourceRecordCount?: number; }
export interface ConsumerOwnershipProvenance { readonly activeProducerId?: string; readonly epoch?: number; }
export interface ConsumerPublishedGenerationEligibility { readonly structuralStatus: "VALID" | "INVALID"; readonly semanticStatus: "COMPATIBLE"; readonly sourceProvenanceStatus: ConsumerProvenanceStatus; readonly producerProvenanceStatus: ConsumerProvenanceStatus; readonly eligible: boolean; readonly reason?: string; }

function sourceStatus(index: PublishedGenerationRuntimeIndex, source?: ConsumerSourceProvenance): ConsumerProvenanceStatus {
  if (!source || !index.sourceTextGenerationId || !index.sourceChunksDigest || !index.sourcePublicationId || index.sourceRecordCount === undefined) return "UNKNOWN";
  if (source.sourceChunksDigest !== undefined && source.sourceChunksDigest !== index.sourceChunksDigest) return "MISMATCH";
  if (source.sourceRecordCount !== undefined && source.sourceRecordCount !== index.sourceRecordCount) return "MISMATCH";
  if (source.sourceTextGenerationId !== undefined && source.sourceTextGenerationId !== index.sourceTextGenerationId) return "STALE";
  if (source.sourcePublicationId !== undefined && source.sourcePublicationId !== index.sourcePublicationId) return "STALE";
  return "MATCH";
}
function producerStatus(index: PublishedGenerationRuntimeIndex, ownership?: ConsumerOwnershipProvenance): ConsumerProvenanceStatus {
  if (!ownership || !index.producerDeviceId || index.producerEpoch === undefined || !ownership.activeProducerId || ownership.epoch === undefined) return "UNKNOWN";
  if (ownership.activeProducerId !== index.producerDeviceId) return "MISMATCH";
  if (index.producerEpoch < ownership.epoch) return "STALE";
  if (index.producerEpoch > ownership.epoch) return "FUTURE";
  return "MATCH";
}
export function evaluateConsumerPublishedGenerationEligibility(index: PublishedGenerationRuntimeIndex, input: { readonly source?: ConsumerSourceProvenance; readonly ownership?: ConsumerOwnershipProvenance }): ConsumerPublishedGenerationEligibility {
  const sourceProvenanceStatus = sourceStatus(index, input.source); const producerProvenanceStatus = producerStatus(index, input.ownership);
  const eligible = sourceProvenanceStatus === "MATCH" && producerProvenanceStatus === "MATCH";
  return { structuralStatus: "VALID", semanticStatus: "COMPATIBLE", sourceProvenanceStatus, producerProvenanceStatus, eligible, reason: eligible ? undefined : `${sourceProvenanceStatus}/${producerProvenanceStatus}` };
}
