/**
 * Pure Canonical Embedding Lifecycle Model (Phase LINA-14A)
 *
 * Implements the pure, deterministic foundation for the unified embedding lifecycle:
 * - Identity comparison and compatibility evaluation;
 * - Pure work classification (none | indeterminate | pending);
 * - Pure lifecycle snapshot resolution across the 12 canonical primary states;
 * - Invariant verification (I1 to I15).
 *
 * This module is completely free of side effects, filesystem access, and Obsidian runtime dependencies.
 */

// ---------------------------------------------------------------------------
// 1. Identity & Compatibility Types
// ---------------------------------------------------------------------------

export interface EmbeddingIdentitySummary {
  readonly provider?: string;
  readonly model?: string;
  readonly dimensions?: number;
  readonly inputVersion?: number;
  readonly prefixMode?: string;
  readonly contractId?: string;
}

export type IdentityMismatchReason =
  | "provider-mismatch"
  | "model-mismatch"
  | "dimensions-mismatch"
  | "input-version-mismatch"
  | "prefix-mode-mismatch"
  | "incomplete-identity";

export interface IdentityComparisonResult {
  readonly compatible: boolean;
  readonly reasons: readonly IdentityMismatchReason[];
  readonly published?: EmbeddingIdentitySummary;
  readonly target?: EmbeddingIdentitySummary;
}

// ---------------------------------------------------------------------------
// 2. Work Assessment Types
// ---------------------------------------------------------------------------

export type EmbeddingWorkKind = "none" | "indeterminate" | "pending";
export type EmbeddingWorkExecutionMode = "initial-build" | "incremental" | "full-rebuild" | "publish-only";
export type EmbeddingWorkSeverity = "none" | "info" | "action" | "blocking";
export type EmbeddingWorkCost = "none" | "local" | "external";

export interface EmbeddingWorkCounts {
  readonly totalChunks: number;
  readonly toGenerate: number;
  readonly staleToReplace: number;
  readonly missing: number;
  readonly obsoleteToDrop: number;
  readonly reusableCanonical: number;
  readonly recoverableCheckpoint: number;
}

export interface EmbeddingWorkAssessment {
  readonly kind: EmbeddingWorkKind;
  readonly mode?: EmbeddingWorkExecutionMode;
  readonly updateRequired: boolean;
  readonly severity: EmbeddingWorkSeverity;
  readonly cost: EmbeddingWorkCost;
  readonly reasons: readonly string[];
  readonly counts?: EmbeddingWorkCounts;
}

// ---------------------------------------------------------------------------
// 3. Lifecycle State & Snapshot Types
// ---------------------------------------------------------------------------

export type EmbeddingLifecycleStatus =
  | "NO_TEXT_INDEX"
  | "DISABLED"
  | "INDEX_ONLY"
  | "VERIFYING"
  | "READY"
  | "UPDATE_AVAILABLE"
  | "INCOMPATIBLE"
  | "INDETERMINATE"
  | "UPDATING"
  | "CANCELLING"
  | "ERROR"
  | "STANDBY";

export type ProcessPhase =
  | "idle"
  | "checking"
  | "preparing"
  | "generating"
  | "persisting"
  | "finalizing"
  | "cancelling";

export interface EmbeddingLifecycleSnapshot {
  readonly revision: number;
  readonly computedAt: number;

  readonly read: {
    readonly semanticAvailable: boolean;
    readonly effectiveMode: "full" | "text-only" | "unavailable";
    readonly compatibility: {
      readonly status: "compatible" | "incompatible" | "unknown" | "none";
      readonly reasons: readonly IdentityMismatchReason[];
      readonly published?: EmbeddingIdentitySummary;
      readonly device?: EmbeddingIdentitySummary;
    };
    readonly source: "jsonl" | "binary" | "none";
    readonly reasonCode?: string;
  };

  readonly write: {
    readonly work: EmbeddingWorkAssessment;
    readonly updateRequired: boolean;
    readonly reason?: string;
    readonly severity: EmbeddingWorkSeverity;
    readonly cost: EmbeddingWorkCost;
    readonly applicable: boolean;
  };

  readonly process: {
    readonly phase: ProcessPhase;
    readonly progress?: {
      readonly processed: number;
      readonly total: number;
      readonly reused?: number;
      readonly failed?: number;
    };
    readonly origin?: "command" | "sidebar" | "automatic" | "internal";
    readonly cancellable: boolean;
  };

  readonly history: {
    readonly lastSuccess?: {
      readonly at: string;
      readonly publicationId?: string;
      readonly generated?: number;
      readonly reused?: number;
    };
    readonly lastFailure?: {
      readonly at?: string;
      readonly category: string;
      readonly message?: string;
    };
    readonly lastOperation?: {
      readonly kind: "completed" | "failed" | "cancelled";
      readonly at?: string;
      readonly message?: string;
    };
  };

  readonly capability: {
    readonly canRequestUpdate: boolean;
    readonly blockedReason?:
      | "companion"
      | "standby"
      | "unassigned"
      | "embeddings-disabled"
      | "text-index-not-ready"
      | "operation-active"
      | "policy-blocked"
      | "ownership-lost";
    readonly requiresConfirmation: boolean;
    readonly trigger: {
      readonly mode: "manual" | "automatic-local";
      readonly scheduledAt?: number;
      readonly backoffUntil?: number;
    };
  };

  readonly upstream: {
    readonly textIndex: "ready" | "stale" | "missing" | "invalid";
  };

  readonly info: {
    readonly embeddingsPublishedAt?: string;
    readonly provenance?: "valid" | "stale" | "future" | "unknown";
  };

  readonly primary: EmbeddingLifecycleStatus;
}

// ---------------------------------------------------------------------------
// 4. Input Types for Pure Functions
// ---------------------------------------------------------------------------

export interface ClassifyEmbeddingWorkInput {
  readonly publishedIdentity?: EmbeddingIdentitySummary | null;
  readonly targetIdentity?: EmbeddingIdentitySummary | null;
  readonly canonicalExists: boolean;
  readonly canonicalReadability?: "missing" | "empty" | "readable" | "unreadable";
  readonly totalChunks: number;
  readonly validForSearchCount?: number;
  readonly reusableCanonicalCount?: number;
  readonly recoverableCheckpointCount?: number;
  readonly toGenerateCount?: number;
  readonly staleToReplaceCount?: number;
  readonly missingCount?: number;
  readonly obsoleteToDropCount?: number;
  readonly requiresPublication?: boolean;
  readonly isExternalProvider?: boolean;
}

export interface ResolveEmbeddingLifecycleInput {
  readonly revision: number;
  readonly computedAt?: number;

  readonly deviceRole: "producer" | "companion" | "unassigned";
  readonly isActiveProducer: boolean;
  readonly embeddingsEnabled: boolean;

  readonly upstreamTextIndex: "ready" | "stale" | "missing" | "invalid";

  readonly publishedIdentity?: EmbeddingIdentitySummary | null;
  readonly deviceIdentity?: EmbeddingIdentitySummary | null;
  readonly targetIdentity?: EmbeddingIdentitySummary | null;

  readonly canonicalExists: boolean;
  readonly validForSearchCount: number;
  readonly activeSource?: "jsonl" | "binary" | "none";

  readonly workAssessment?: EmbeddingWorkAssessment;
  readonly factsChecking?: boolean;

  readonly operationState?: {
    readonly status: "idle" | "running" | "cancelling" | "failed" | "cancelled" | "completed";
    readonly phase?: "idle" | "preparing" | "waiting-for-text-index" | "validating" | "generating" | "persisting" | "finalizing" | "completed" | "failed" | "cancelled";
    readonly processedChunks?: number;
    readonly totalChunks?: number;
    readonly reusedChunks?: number;
    readonly failedChunks?: number;
    readonly error?: string;
    readonly message?: string;
    readonly origin?: "command" | "sidebar" | "automatic" | "internal";
  };

  readonly history?: {
    readonly lastSuccess?: {
      readonly at: string;
      readonly publicationId?: string;
      readonly generated?: number;
      readonly reused?: number;
    };
    readonly lastFailure?: {
      readonly at?: string;
      readonly category: string;
      readonly message?: string;
    };
    readonly lastOperation?: {
      readonly kind: "completed" | "failed" | "cancelled";
      readonly at?: string;
      readonly message?: string;
    };
  };

  readonly provenance?: "valid" | "stale" | "future" | "unknown";
  readonly requiresConfirmation?: boolean;
  readonly triggerMode?: "manual" | "automatic-local";
  readonly scheduledAt?: number;
  readonly backoffUntil?: number;
}

// ---------------------------------------------------------------------------
// 5. Helper Functions
// ---------------------------------------------------------------------------

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasCompleteIdentity(identity?: EmbeddingIdentitySummary | null): boolean {
  if (!identity) return false;
  return (
    normalizeString(identity.provider).length > 0 &&
    normalizeString(identity.model).length > 0 &&
    Number.isInteger(identity.dimensions) &&
    (identity.dimensions as number) > 0 &&
    Number.isInteger(identity.inputVersion) &&
    (identity.inputVersion as number) > 0 &&
    normalizeString(identity.prefixMode).length > 0
  );
}

// ---------------------------------------------------------------------------
// 6. Pure Functions
// ---------------------------------------------------------------------------

/**
 * Compares two embedding identities (e.g. published vs target, or published vs device contract).
 *
 * If both identities carry a valid `contractId`, equality of contractId is the canonical shortcut.
 * Otherwise, performs a field-by-field comparison of provider, model, dimensions, inputVersion, and prefixMode.
 */
export function compareEmbeddingIdentity(
  published?: EmbeddingIdentitySummary | null,
  target?: EmbeddingIdentitySummary | null
): IdentityComparisonResult {
  const publishedSummary: EmbeddingIdentitySummary | undefined = published ?? undefined;
  const targetSummary: EmbeddingIdentitySummary | undefined = target ?? undefined;

  if (!published || !target) {
    return {
      compatible: false,
      reasons: ["incomplete-identity"],
      published: publishedSummary,
      target: targetSummary,
    };
  }

  // If both carry identical contractId, they are guaranteed compatible.
  if (
    typeof published.contractId === "string" &&
    typeof target.contractId === "string" &&
    published.contractId.length > 0 &&
    published.contractId === target.contractId
  ) {
    return {
      compatible: true,
      reasons: [],
      published: publishedSummary,
      target: targetSummary,
    };
  }

  const reasons: IdentityMismatchReason[] = [];

  const pubComplete = hasCompleteIdentity(published);
  const targetComplete = hasCompleteIdentity(target);

  if (!pubComplete || !targetComplete) {
    reasons.push("incomplete-identity");
  }

  if (normalizeString(published.provider) !== normalizeString(target.provider)) {
    reasons.push("provider-mismatch");
  }

  if (normalizeString(published.model) !== normalizeString(target.model)) {
    reasons.push("model-mismatch");
  }

  if (
    published.dimensions !== undefined &&
    target.dimensions !== undefined &&
    published.dimensions !== target.dimensions
  ) {
    reasons.push("dimensions-mismatch");
  }

  if (
    published.inputVersion !== undefined &&
    target.inputVersion !== undefined &&
    published.inputVersion !== target.inputVersion
  ) {
    reasons.push("input-version-mismatch");
  }

  if (
    published.prefixMode !== undefined &&
    target.prefixMode !== undefined &&
    normalizeString(published.prefixMode) !== normalizeString(target.prefixMode)
  ) {
    reasons.push("prefix-mode-mismatch");
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    published: publishedSummary,
    target: targetSummary,
  };
}

/**
 * Purely classifies the embedding work required based on factual planning inputs.
 */
export function classifyEmbeddingWork(input: ClassifyEmbeddingWorkInput): EmbeddingWorkAssessment {
  const {
    publishedIdentity,
    targetIdentity,
    canonicalExists,
    canonicalReadability = "readable",
    totalChunks,
    reusableCanonicalCount = 0,
    recoverableCheckpointCount = 0,
    toGenerateCount = 0,
    staleToReplaceCount = 0,
    missingCount = 0,
    obsoleteToDropCount = 0,
    requiresPublication = false,
    isExternalProvider = false,
  } = input;

  const cost: EmbeddingWorkCost = isExternalProvider ? "external" : "local";
  const counts: EmbeddingWorkCounts = {
    totalChunks,
    toGenerate: toGenerateCount,
    staleToReplace: staleToReplaceCount,
    missing: missingCount,
    obsoleteToDrop: obsoleteToDropCount,
    reusableCanonical: reusableCanonicalCount,
    recoverableCheckpoint: recoverableCheckpointCount,
  };

  // 1. Canonical unreadable / indeterminate
  if (canonicalReadability === "unreadable") {
    return {
      kind: "indeterminate",
      updateRequired: false,
      severity: "none",
      cost: "none",
      reasons: ["canonical-unreadable"],
      counts,
    };
  }

  // 2. Canonical does not exist or is empty
  if (!canonicalExists || canonicalReadability === "missing" || canonicalReadability === "empty") {
    if (totalChunks === 0) {
      return {
        kind: "none",
        updateRequired: false,
        severity: "none",
        cost: "none",
        reasons: ["no-chunks-no-embeddings"],
        counts,
      };
    }
    return {
      kind: "pending",
      mode: "initial-build",
      updateRequired: true,
      severity: "action",
      cost,
      reasons: ["canonical-missing-or-empty"],
      counts,
    };
  }

  // 3. Identity Incompatibility (Target Identity vs Published Identity)
  if (publishedIdentity && targetIdentity) {
    const identityCheck = compareEmbeddingIdentity(publishedIdentity, targetIdentity);
    if (!identityCheck.compatible) {
      return {
        kind: "pending",
        mode: "full-rebuild",
        updateRequired: true,
        severity: "blocking",
        cost,
        reasons: identityCheck.reasons,
        counts,
      };
    }
  }

  // 4. Generation Needed (Missing, Stale, or Generation Required)
  const needsGeneration = toGenerateCount > 0 || staleToReplaceCount > 0 || missingCount > 0;
  if (needsGeneration) {
    return {
      kind: "pending",
      mode: "incremental",
      updateRequired: true,
      severity: "action",
      cost,
      reasons: ["chunks-need-generation"],
      counts,
    };
  }

  // 5. Publication-Only / Cleanup Needed (Obsolete chunks, duplicate/invalid records, or checkpoint covers all)
  const needsCleanupOrPublish = requiresPublication || obsoleteToDropCount > 0;
  if (needsCleanupOrPublish) {
    return {
      kind: "pending",
      mode: "publish-only",
      updateRequired: true,
      severity: "info",
      cost: "none",
      reasons: obsoleteToDropCount > 0 ? ["obsolete-chunks-to-drop"] : ["publication-needed"],
      counts,
    };
  }

  // 6. Up to date (Zero work needed)
  return {
    kind: "none",
    updateRequired: false,
    severity: "none",
    cost: "none",
    reasons: ["up-to-date"],
    counts,
  };
}

/**
 * Pure resolver for the complete EmbeddingLifecycleSnapshot and single primary status.
 */
export function resolveEmbeddingLifecycle(
  input: ResolveEmbeddingLifecycleInput
): EmbeddingLifecycleSnapshot {
  const {
    revision,
    computedAt = Date.now(),
    deviceRole,
    isActiveProducer,
    embeddingsEnabled,
    upstreamTextIndex,
    publishedIdentity,
    deviceIdentity,
    canonicalExists,
    validForSearchCount,
    activeSource = "none",
    workAssessment,
    factsChecking = false,
    operationState,
    history,
    provenance = "unknown",
    requiresConfirmation = false,
    triggerMode = "manual",
    scheduledAt,
    backoffUntil,
  } = input;

  const isCompanion = deviceRole === "companion";
  const isStandby = deviceRole === "producer" && !isActiveProducer;
  const isUnassigned = deviceRole === "unassigned";

  // 1. Evaluate Read Compatibility
  const identityComparison = compareEmbeddingIdentity(publishedIdentity, deviceIdentity);
  const readCompatible = identityComparison.compatible;
  const semanticAvailable = embeddingsEnabled && canonicalExists && validForSearchCount > 0 && readCompatible;

  const effectiveMode: "full" | "text-only" | "unavailable" =
    upstreamTextIndex === "missing" || upstreamTextIndex === "invalid"
      ? "unavailable"
      : semanticAvailable
      ? "full"
      : "text-only";

  const readRegion: EmbeddingLifecycleSnapshot["read"] = {
    semanticAvailable,
    effectiveMode,
    compatibility: {
      status: !publishedIdentity && !deviceIdentity
        ? "none"
        : readCompatible
        ? "compatible"
        : "incompatible",
      reasons: identityComparison.reasons,
      published: publishedIdentity ?? undefined,
      device: deviceIdentity ?? undefined,
    },
    source: activeSource,
  };

  // 2. Evaluate Write Region
  const defaultWork: EmbeddingWorkAssessment = {
    kind: "none",
    updateRequired: false,
    severity: "none",
    cost: "none",
    reasons: ["no-work-assessed"],
  };

  const effectiveWork = isCompanion
    ? { ...defaultWork, reasons: ["companion-role-write-not-applicable"] }
    : workAssessment ?? defaultWork;

  const writeApplicable = !isCompanion && !isStandby && !isUnassigned && embeddingsEnabled;

  const writeRegion: EmbeddingLifecycleSnapshot["write"] = {
    work: effectiveWork,
    updateRequired: writeApplicable ? effectiveWork.updateRequired : false,
    reason: effectiveWork.reasons[0],
    severity: writeApplicable ? effectiveWork.severity : "none",
    cost: writeApplicable ? effectiveWork.cost : "none",
    applicable: writeApplicable,
  };

  // 3. Evaluate Process Region
  let processPhase: ProcessPhase = "idle";
  let cancellable = false;

  if (operationState?.status === "running") {
    if (
      operationState.phase === "preparing" ||
      operationState.phase === "waiting-for-text-index" ||
      operationState.phase === "validating"
    ) {
      processPhase = "preparing";
      cancellable = true;
    } else if (operationState.phase === "generating") {
      processPhase = "generating";
      cancellable = true;
    } else if (operationState.phase === "persisting") {
      processPhase = "persisting";
      cancellable = false; // Point of no return
    } else if (operationState.phase === "finalizing") {
      processPhase = "finalizing";
      cancellable = false;
    } else {
      processPhase = "generating";
      cancellable = true;
    }
  } else if (operationState?.status === "cancelling") {
    processPhase = "cancelling";
    cancellable = false;
  } else if (factsChecking) {
    processPhase = "checking";
    cancellable = false;
  }

  const processRegion: EmbeddingLifecycleSnapshot["process"] = {
    phase: processPhase,
    progress:
      operationState?.processedChunks !== undefined && operationState?.totalChunks !== undefined
        ? {
            processed: operationState.processedChunks,
            total: operationState.totalChunks,
            reused: operationState.reusedChunks,
            failed: operationState.failedChunks,
          }
        : undefined,
    origin: operationState?.origin,
    cancellable,
  };

  // 4. Capability Region
  let blockedReason: EmbeddingLifecycleSnapshot["capability"]["blockedReason"] | undefined;
  if (isCompanion) {
    blockedReason = "companion";
  } else if (isStandby) {
    blockedReason = "standby";
  } else if (isUnassigned) {
    blockedReason = "unassigned";
  } else if (!embeddingsEnabled) {
    blockedReason = "embeddings-disabled";
  } else if (upstreamTextIndex === "missing" || upstreamTextIndex === "invalid") {
    blockedReason = "text-index-not-ready";
  } else if (processPhase !== "idle" && processPhase !== "checking") {
    blockedReason = "operation-active";
  }

  const canRequestUpdate =
    blockedReason === undefined &&
    writeApplicable &&
    processPhase === "idle" &&
    upstreamTextIndex === "ready";

  const capabilityRegion: EmbeddingLifecycleSnapshot["capability"] = {
    canRequestUpdate,
    blockedReason,
    requiresConfirmation,
    trigger: {
      mode: triggerMode,
      scheduledAt,
      backoffUntil,
    },
  };

  // 5. History Region
  const historyRegion: EmbeddingLifecycleSnapshot["history"] = {
    lastSuccess: history?.lastSuccess,
    lastFailure: history?.lastFailure,
    lastOperation: history?.lastOperation ?? (
      operationState?.status === "failed"
        ? { kind: "failed", message: operationState.error || operationState.message }
        : operationState?.status === "cancelled"
        ? { kind: "cancelled", message: operationState.message }
        : undefined
    ),
  };

  // 6. Upstream & Info Regions
  const upstreamRegion: EmbeddingLifecycleSnapshot["upstream"] = {
    textIndex: upstreamTextIndex,
  };

  const infoRegion: EmbeddingLifecycleSnapshot["info"] = {
    embeddingsPublishedAt: history?.lastSuccess?.at,
    provenance,
  };

  // 7. Resolve Primary Status (Strict 12-state resolution matrix)
  let primary: EmbeddingLifecycleStatus;

  // Active Process Precedence
  if (processPhase === "cancelling") {
    primary = "CANCELLING";
  } else if (
    processPhase === "preparing" ||
    processPhase === "generating" ||
    processPhase === "persisting" ||
    processPhase === "finalizing"
  ) {
    primary = "UPDATING";
  } else if (operationState?.status === "failed") {
    primary = "ERROR";
  } else if (factsChecking || processPhase === "checking") {
    primary = "VERIFYING";
  } else if (upstreamTextIndex === "missing" || upstreamTextIndex === "invalid") {
    primary = "NO_TEXT_INDEX";
  } else if (!embeddingsEnabled) {
    primary = "DISABLED";
  } else if (isStandby) {
    primary = "STANDBY";
  } else if (effectiveWork.kind === "indeterminate") {
    primary = "INDETERMINATE";
  } else if (!canonicalExists || validForSearchCount === 0) {
    if (!readCompatible && publishedIdentity && deviceIdentity) {
      primary = "INCOMPATIBLE";
    } else {
      primary = "INDEX_ONLY";
    }
  } else if (!readCompatible) {
    primary = "INCOMPATIBLE";
  } else if (effectiveWork.kind === "pending" && writeApplicable) {
    primary = "UPDATE_AVAILABLE";
  } else {
    primary = "READY";
  }

  return {
    revision,
    computedAt,
    read: readRegion,
    write: writeRegion,
    process: processRegion,
    history: historyRegion,
    capability: capabilityRegion,
    upstream: upstreamRegion,
    info: infoRegion,
    primary,
  };
}

// ---------------------------------------------------------------------------
// 7. Invariants Verification Helper (I1 - I15)
// ---------------------------------------------------------------------------

export interface InvariantsValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

/**
 * Validates the core architectural invariants on an EmbeddingLifecycleSnapshot.
 */
export function validateLifecycleInvariants(
  snapshot: EmbeddingLifecycleSnapshot
): InvariantsValidationResult {
  const violations: string[] = [];

  // I1: primary=READY => write.work=none && read.semanticAvailable
  if (snapshot.primary === "READY") {
    if (snapshot.write.applicable && snapshot.write.work.kind !== "none") {
      violations.push("I1 violation: primary is READY but write work is not none");
    }
    if (!snapshot.read.semanticAvailable) {
      violations.push("I1 violation: primary is READY but read.semanticAvailable is false");
    }
  }

  // I2: primary=UPDATE_AVAILABLE => work=pending && read.semanticAvailable
  if (snapshot.primary === "UPDATE_AVAILABLE") {
    if (snapshot.write.work.kind !== "pending") {
      violations.push("I2 violation: primary is UPDATE_AVAILABLE but write work is not pending");
    }
    if (!snapshot.read.semanticAvailable) {
      violations.push("I2 violation: primary is UPDATE_AVAILABLE but read.semanticAvailable is false");
    }
  }

  // I3: primary=INCOMPATIBLE => read.effectiveMode != full
  if (snapshot.primary === "INCOMPATIBLE" && snapshot.read.effectiveMode === "full") {
    violations.push("I3 violation: primary is INCOMPATIBLE but read.effectiveMode is full");
  }

  // I4: primary=INDEX_ONLY => read.semanticAvailable = false
  if (snapshot.primary === "INDEX_ONLY" && snapshot.read.semanticAvailable) {
    violations.push("I4 violation: primary is INDEX_ONLY but read.semanticAvailable is true");
  }

  // I6: primary=UPDATING => capability.canRequestUpdate=false
  if (snapshot.primary === "UPDATING" && snapshot.capability.canRequestUpdate) {
    violations.push("I6 violation: primary is UPDATING but capability.canRequestUpdate is true");
  }

  // I7: process.phase=persisting => cancellable=false (point of no return)
  if (snapshot.process.phase === "persisting" && snapshot.process.cancellable) {
    violations.push("I7 violation: process.phase is persisting but cancellable is true");
  }

  // I9: write.applicable=false => capability.canRequestUpdate=false
  if (!snapshot.write.applicable && snapshot.capability.canRequestUpdate) {
    violations.push("I9 violation: write is not applicable but capability.canRequestUpdate is true");
  }

  // I11: work=indeterminate => primary != READY
  if (snapshot.write.work.kind === "indeterminate" && snapshot.primary === "READY") {
    violations.push("I11 violation: work is indeterminate but primary is READY");
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
