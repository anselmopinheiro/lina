export type EmbeddingResourceProfile = "desktop" | "mobile";

export interface MobileBridgeReadGuard {
  maxFileBytes: number;
  estimatedBridgeAmplification: number;
  maxEstimatedBridgePeakBytes: number;
  fixedMarginBytes: number;
}

export const DESKTOP_BRIDGE_READ_GUARD: Readonly<MobileBridgeReadGuard> = Object.freeze({
  maxFileBytes: 96 * 1024 * 1024,
  estimatedBridgeAmplification: 3,
  maxEstimatedBridgePeakBytes: 192 * 1024 * 1024,
  fixedMarginBytes: 32 * 1024 * 1024,
});

// Capacitor can retain the native bytes, JSONObject/string representations,
// the bridge payload and the JavaScript string at the same time. Keep this
// limit deliberately below the generic JSONL runtime limit on mobile.
export const MOBILE_BRIDGE_READ_GUARD: Readonly<MobileBridgeReadGuard> = Object.freeze({
  maxFileBytes: 12 * 1024 * 1024,
  estimatedBridgeAmplification: 5,
  maxEstimatedBridgePeakBytes: 64 * 1024 * 1024,
  fixedMarginBytes: 8 * 1024 * 1024,
});

export function getEmbeddingBridgeReadGuard(profile: EmbeddingResourceProfile): Readonly<MobileBridgeReadGuard> {
  return profile === "mobile" ? MOBILE_BRIDGE_READ_GUARD : DESKTOP_BRIDGE_READ_GUARD;
}

export function estimateCapacitorBridgePeakBytes(
  fileBytes: number,
  guard: MobileBridgeReadGuard = MOBILE_BRIDGE_READ_GUARD,
): number {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 0
    || !Number.isSafeInteger(guard.estimatedBridgeAmplification) || guard.estimatedBridgeAmplification < 0
    || !Number.isSafeInteger(guard.fixedMarginBytes) || guard.fixedMarginBytes < 0) {
    throw new Error("mobile-bridge-read-size-invalid");
  }

  const amplified = fileBytes * guard.estimatedBridgeAmplification;
  if (!Number.isSafeInteger(amplified) || amplified > Number.MAX_SAFE_INTEGER - guard.fixedMarginBytes) {
    throw new Error("mobile-bridge-read-size-overflow");
  }
  return amplified + guard.fixedMarginBytes;
}

export interface EmbeddingBridgeReadDecision {
  allowed: boolean;
  code?: "mobile-bridge-read-limit-exceeded";
  estimatedPeakBytes: number;
}

export function evaluateEmbeddingBridgeRead(
  fileBytes: number | undefined,
  profile: EmbeddingResourceProfile,
): EmbeddingBridgeReadDecision {
  const guard = getEmbeddingBridgeReadGuard(profile);
  if (typeof fileBytes !== "number" || !Number.isSafeInteger(fileBytes) || fileBytes < 0) {
    return { allowed: false, code: "mobile-bridge-read-limit-exceeded", estimatedPeakBytes: Number.POSITIVE_INFINITY };
  }

  let estimatedPeakBytes: number;
  try {
    estimatedPeakBytes = estimateCapacitorBridgePeakBytes(fileBytes, guard);
  } catch {
    return { allowed: false, code: "mobile-bridge-read-limit-exceeded", estimatedPeakBytes: Number.POSITIVE_INFINITY };
  }

  const allowed = fileBytes <= guard.maxFileBytes && estimatedPeakBytes <= guard.maxEstimatedBridgePeakBytes;
  return allowed
    ? { allowed, estimatedPeakBytes }
    : { allowed, code: "mobile-bridge-read-limit-exceeded", estimatedPeakBytes };
}
