/** Read-only contextual provenance policy for published generations. */
import type { PublishedGenerationRuntimeIndex } from "./publishedGenerationReader";

export type ConsumerProvenanceStatus = "MATCH" | "STALE" | "FUTURE" | "UNKNOWN" | "MISMATCH";
export type ConsumerStructuralStatus = "VALID" | "INVALID";
export type ConsumerSemanticStatus = "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";
export interface ConsumerSourceProvenance { readonly sourceTextGenerationId?: string; readonly sourceChunksDigest?: string; readonly sourcePublicationId?: string; readonly sourceRecordCount?: number; }
export interface ConsumerOwnershipProvenance { readonly activeProducerId?: string; readonly epoch?: number; }
export interface ConsumerPublishedGenerationEligibility { readonly structuralStatus: ConsumerStructuralStatus; readonly semanticStatus: ConsumerSemanticStatus; readonly sourceProvenanceStatus: ConsumerProvenanceStatus; readonly producerProvenanceStatus: ConsumerProvenanceStatus; readonly eligible: boolean; readonly reason?: string; }
export interface ConsumerPublishedGenerationEligibilityInput { readonly source?: ConsumerSourceProvenance; readonly ownership?: ConsumerOwnershipProvenance; readonly structuralStatus: ConsumerStructuralStatus; readonly semanticStatus: ConsumerSemanticStatus; }

function hasText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function hasRecordCount(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function hasCompleteSource(value: ConsumerSourceProvenance | PublishedGenerationRuntimeIndex): boolean {
  return hasText(value.sourceTextGenerationId) && hasText(value.sourceChunksDigest) && hasText(value.sourcePublicationId) && hasRecordCount(value.sourceRecordCount);
}
function hasCompleteOwnership(value: ConsumerOwnershipProvenance): boolean { return hasText(value.activeProducerId) && hasRecordCount(value.epoch); }
function hasCompleteProducer(index: PublishedGenerationRuntimeIndex): boolean { return hasText(index.producerDeviceId) && hasRecordCount(index.producerEpoch); }
function sourceStatus(index: PublishedGenerationRuntimeIndex, source?: ConsumerSourceProvenance): ConsumerProvenanceStatus {
  if (!source || !hasCompleteSource(index) || !hasCompleteSource(source)) return "UNKNOWN";
  if (source.sourceChunksDigest !== index.sourceChunksDigest || source.sourceRecordCount !== index.sourceRecordCount) return "MISMATCH";
  if (source.sourceTextGenerationId !== index.sourceTextGenerationId || source.sourcePublicationId !== index.sourcePublicationId) return "STALE";
  return "MATCH";
}
function producerStatus(index: PublishedGenerationRuntimeIndex, ownership?: ConsumerOwnershipProvenance): ConsumerProvenanceStatus {
  if (!ownership || !hasCompleteProducer(index) || !hasCompleteOwnership(ownership)) return "UNKNOWN";
  const producerEpoch = index.producerEpoch;
  const ownershipEpoch = ownership.epoch;
  if (!hasRecordCount(producerEpoch) || !hasRecordCount(ownershipEpoch)) return "UNKNOWN";
  if (ownership.activeProducerId !== index.producerDeviceId) return "MISMATCH";
  if (producerEpoch < ownershipEpoch) return "STALE";
  if (producerEpoch > ownershipEpoch) return "FUTURE";
  return "MATCH";
}

/** Fail closed: every required validation and provenance expectation must be explicit and complete. */
export function evaluatePublishedGenerationForConsumer(index: PublishedGenerationRuntimeIndex, input: ConsumerPublishedGenerationEligibilityInput): ConsumerPublishedGenerationEligibility {
  const sourceProvenanceStatus = sourceStatus(index, input.source);
  const producerProvenanceStatus = producerStatus(index, input.ownership);
  const eligible = input.structuralStatus === "VALID" && input.semanticStatus === "COMPATIBLE" && sourceProvenanceStatus === "MATCH" && producerProvenanceStatus === "MATCH";
  return { structuralStatus: input.structuralStatus, semanticStatus: input.semanticStatus, sourceProvenanceStatus, producerProvenanceStatus, eligible, reason: eligible ? undefined : `${input.structuralStatus}/${input.semanticStatus}/${sourceProvenanceStatus}/${producerProvenanceStatus}` };
}

/** Backwards-compatible exported name for the consumer gate. */
export const evaluateConsumerPublishedGenerationEligibility = evaluatePublishedGenerationForConsumer;
