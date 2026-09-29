/**
 * Sidebar Status & UX View Model (Phase 0.3.x — LINA-03-UX)
 *
 * Provides a pure, decoupled view model computing the human-readable operational
 * status for the Lina sidebar panel.
 *
 * Core Responsibilities:
 * 1. Device Role Presentation: Active Producer vs Standby Producer vs Companion.
 * 2. Freshness Status: Text Index & Embeddings with human-friendly relative time.
 * 3. Search Availability: Real operational capabilities (textual, semantic, hybrid).
 * 4. Maintenance Gating: Distinguishes writable Producer actions from read-only Companion/Standby.
 * 5. Prioritized Degraded Alerts: Shows at most one prioritized banner, avoiding "Christmas tree UI".
 */

import { DeviceRole } from "../device/deviceRole";
import { type DeviceRuntimeEmbeddingsState } from "../device/deviceRuntimeState";
import { OwnershipManifest } from "../device/deviceOwnership";
import { CompanionArtifactConsumptionState } from "../companion/companionConsumptionState";
import { FreshnessStatus, DEFAULT_AGING_THRESHOLD_MS, DEFAULT_STALE_THRESHOLD_MS } from "../device/producerState";
import { UiStrings } from "../i18n/strings";

export type SidebarSearchMode = "hibrida" | "textual" | "semantica";

export type SidebarRoleKey = "active-producer" | "standby-producer" | "companion";

export interface SidebarRoleInfo {
  readonly roleKey: SidebarRoleKey;
  readonly title: string;
  readonly description: string;
  readonly tone: "neutral" | "accent" | "muted";
}

export type SidebarFreshnessStatus = "fresh" | "aging" | "stale" | "unknown" | "missing" | "disabled";

export interface SidebarFreshnessItem {
  readonly status: SidebarFreshnessStatus;
  readonly label: string;
  readonly humanText: string;
  readonly updatedAt?: string | null;
}

export interface SidebarFreshnessInfo {
  readonly textIndex: SidebarFreshnessItem;
  readonly embeddings: SidebarFreshnessItem;
}

export interface SidebarSearchAvailabilityInfo {
  readonly textAvailable: boolean;
  readonly semanticAvailable: boolean;
  readonly hybridMode: "full" | "text-only" | "unavailable";
  readonly currentModeHeadline: string;
  readonly secondaryReason?: string;
  readonly tone: "neutral" | "success" | "warning" | "error";
}

export interface SidebarDegradedAlert {
  readonly kind:
    | "generation-integrity"
    | "policy-mismatch"
    | "vector-mismatch"
    | "producer-stale"
    | "producer-aging"
    | "semantic-unavailable"
    | "stale-artifacts";
  readonly level: "info" | "warning" | "error";
  readonly message: string;
  readonly detail?: string;
}

export interface SidebarMaintenanceGatingInfo {
  readonly canExecuteMaintenance: boolean;
  readonly isCompanion: boolean;
  readonly isStandby: boolean;
  readonly gatingNotice?: string;
}

export interface SidebarStatusViewModel {
  readonly role: SidebarRoleInfo;
  readonly freshness: SidebarFreshnessInfo;
  readonly searchAvailability: SidebarSearchAvailabilityInfo;
  readonly degradedAlert?: SidebarDegradedAlert;
  readonly maintenance: SidebarMaintenanceGatingInfo;
}

export interface BuildSidebarStatusViewModelInput {
  readonly deviceId: string;
  readonly deviceRole?: DeviceRole;
  readonly ownership?: OwnershipManifest | null;
  readonly isAuthorizedProducer?: boolean;
  readonly isStandbyProducer?: boolean;

  // Text index status
  readonly textIndexReady: boolean;
  readonly textIndexUsability?: "ready" | "usable" | "stale" | "invalid" | "missing";
  readonly textIndexUpdatedAt?: string | null;
  readonly textIndexFreshness?: FreshnessStatus;

  // Embeddings status
  readonly embeddingsEnabled?: boolean;
  readonly embeddingsReady?: boolean;
  readonly embeddingsUpdatedAt?: string | null;
  readonly embeddingsFreshness?: FreshnessStatus;
  readonly embeddingsChecking?: boolean;
  readonly embeddingsWorkAvailable?: boolean;

  // Companion / Sync state if evaluated
  readonly companionState?: CompanionArtifactConsumptionState | null;

  // Canonical Runtime Embeddings State
  readonly runtimeEmbeddings?: DeviceRuntimeEmbeddingsState;

  // Semantic availability
  readonly semanticAvailable: boolean;
  readonly semanticReason?: string;
  readonly semanticReasonCode?: string;
  readonly semanticPreparing?: boolean;

  // Current UI state
  readonly currentSearchMode: SidebarSearchMode;
  readonly strings: UiStrings;
  readonly currentTime?: number | string | Date;
}

function resolveNowMs(currentTime?: number | string | Date): number {
  if (currentTime instanceof Date) return currentTime.getTime();
  if (typeof currentTime === "number") return currentTime;
  if (typeof currentTime === "string") {
    const parsed = Date.parse(currentTime);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Formats an ISO 8601 date string into a relative human-readable string (e.g. "há 2 h" / "2 h ago").
 */
export function formatRelativeTime(
  isoDate: string | null | undefined,
  nowMs: number,
  strings: UiStrings
): string {
  if (!isoDate || typeof isoDate !== "string" || isoDate.trim().length === 0) {
    return "";
  }
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    return "";
  }

  const diffMs = Math.max(0, nowMs - parsed);
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 1) {
    return strings.sidebarFreshnessJustNow;
  }
  if (diffMinutes < 60) {
    return `${strings.sidebarFreshnessAgoPrefix}${diffMinutes} ${strings.sidebarFreshnessMinutes}${strings.sidebarFreshnessAgoSuffix}`.trim();
  }
  if (diffHours < 24) {
    return `${strings.sidebarFreshnessAgoPrefix}${diffHours} ${strings.sidebarFreshnessHours}${strings.sidebarFreshnessAgoSuffix}`.trim();
  }
  const dayUnit = diffDays === 1 ? strings.sidebarFreshnessDay : strings.sidebarFreshnessDays;
  return `${strings.sidebarFreshnessAgoPrefix}${diffDays} ${dayUnit}${strings.sidebarFreshnessAgoSuffix}`.trim();
}

function computeFreshnessFromTimestamp(
  isoDate: string | null | undefined,
  nowMs: number,
  agingThresholdMs = DEFAULT_AGING_THRESHOLD_MS,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS
): SidebarFreshnessStatus {
  if (!isoDate || typeof isoDate !== "string" || isoDate.trim().length === 0) {
    return "unknown";
  }
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    return "unknown";
  }

  const diffMs = Math.max(0, nowMs - parsed);
  if (diffMs <= agingThresholdMs) {
    return "fresh";
  }
  if (diffMs <= staleThresholdMs) {
    return "aging";
  }
  return "stale";
}

function formatFreshnessHumanText(
  status: SidebarFreshnessStatus,
  relativeTime: string,
  strings: UiStrings,
  isChecking = false,
  staleLabel?: string
): string {
  if (status === "disabled") {
    return strings.sidebarFreshnessDisabled;
  }
  if (status === "missing") {
    return strings.sidebarFreshnessMissing;
  }
  if (status === "fresh") {
    return relativeTime ? `${strings.sidebarFreshnessFresh} (${relativeTime})` : strings.sidebarFreshnessFresh;
  }
  if (status === "aging") {
    return relativeTime ? `${strings.sidebarFreshnessAging} (${relativeTime})` : strings.sidebarFreshnessAging;
  }
  if (status === "stale") {
    const label = staleLabel ?? strings.sidebarFreshnessStale;
    return relativeTime ? `${label} (${relativeTime})` : label;
  }
  if (isChecking) {
    return strings.sidebarFreshnessChecking;
  }
  return strings.sidebarFreshnessUnknown;
}

/**
 * Builds the pure `SidebarStatusViewModel` from plugin runtime and sync state.
 */
export function buildSidebarStatusViewModel(
  input: BuildSidebarStatusViewModelInput
): SidebarStatusViewModel {
  const {
    deviceId,
    deviceRole,
    ownership,
    isAuthorizedProducer,
    isStandbyProducer,
    textIndexReady,
    textIndexUsability,
    textIndexUpdatedAt,
    textIndexFreshness,
    embeddingsEnabled = true,
    embeddingsReady = false,
    embeddingsUpdatedAt,
    embeddingsFreshness,
    embeddingsChecking = false,
    embeddingsWorkAvailable,
    companionState,
    runtimeEmbeddings,
    semanticAvailable = runtimeEmbeddings?.semanticAvailable ?? input.semanticAvailable,
    semanticReason = runtimeEmbeddings?.reason ?? input.semanticReason,
    semanticPreparing = false,
    currentSearchMode,
    strings,
  } = input;

  const nowMs = resolveNowMs(input.currentTime);

  // 1. Resolve Device Role
  let roleKey: SidebarRoleKey;
  if (isAuthorizedProducer !== undefined) {
    if (isAuthorizedProducer) {
      roleKey = "active-producer";
    } else if (isStandbyProducer || deviceRole === "producer") {
      roleKey = "standby-producer";
    } else {
      roleKey = "companion";
    }
  } else {
    const isConfiguredProducer = deviceRole === "producer";
    const activeProducerId = ownership?.activeProducerId;
    if (isConfiguredProducer && activeProducerId === deviceId) {
      roleKey = "active-producer";
    } else if (isConfiguredProducer) {
      roleKey = "standby-producer";
    } else {
      roleKey = "companion";
    }
  }

  let roleInfo: SidebarRoleInfo;
  switch (roleKey) {
    case "active-producer":
      roleInfo = {
        roleKey,
        title: strings.sidebarRoleActiveProducerTitle,
        description: strings.sidebarRoleActiveProducerDesc,
        tone: "accent",
      };
      break;
    case "standby-producer":
      roleInfo = {
        roleKey,
        title: strings.sidebarRoleStandbyProducerTitle,
        description: strings.sidebarRoleStandbyProducerDesc,
        tone: "neutral",
      };
      break;
    case "companion":
    default:
      roleInfo = {
        roleKey: "companion",
        title: strings.sidebarRoleCompanionTitle,
        description: strings.sidebarRoleCompanionDesc,
        tone: "muted",
      };
      break;
  }

  // 2. Resolve Freshness for Text Index and Embeddings
  const effectiveTextUpdated = textIndexUpdatedAt
    ?? companionState?.producerState?.textIndex.lastSuccessfulPublicationAt
    ?? (companionState?.producerState?.updatedAt);

  let textStatus: SidebarFreshnessStatus;
  if (textIndexUsability === "missing" || (!textIndexReady && !effectiveTextUpdated && !companionState?.totalNotes)) {
    textStatus = "missing";
  } else if (textIndexFreshness) {
    textStatus = textIndexFreshness;
  } else if (companionState?.textIndexFreshness) {
    textStatus = companionState.textIndexFreshness;
  } else if (effectiveTextUpdated) {
    textStatus = computeFreshnessFromTimestamp(effectiveTextUpdated, nowMs);
  } else {
    textStatus = textIndexReady ? "fresh" : "unknown";
  }

  const textRelative = formatRelativeTime(effectiveTextUpdated, nowMs, strings);
  const textFreshnessItem: SidebarFreshnessItem = {
    status: textStatus,
    label: strings.sidebarFreshnessTextIndexLabel,
    humanText: formatFreshnessHumanText(textStatus, textRelative, strings),
    updatedAt: effectiveTextUpdated,
  };

  const effectiveEmbeddingsUpdated = embeddingsUpdatedAt
    ?? companionState?.producerState?.embeddings.lastSuccessfulPublicationAt;

  const isCheckingFromRuntime = runtimeEmbeddings?.runtimeState === "checking";
  const isEmbeddingsChecking = Boolean(embeddingsChecking || isCheckingFromRuntime || semanticPreparing);

  // Canonical Priority Rule (LINA-08 / LINA-09):
  // 1. DeviceRuntimeState.embeddings.semanticAvailable > runtime readiness > work-status transitório > heartbeat/freshness secundário
  // 2. Chronological age (manifest.embeddings.updatedAt) is purely informative metadata; it NEVER drives functional stale status.
  // 3. Work availability (drift in notes/chunks or vector contract) is the sole canonical source for update requirement.
  const isOperational = runtimeEmbeddings
    ? Boolean(runtimeEmbeddings.semanticAvailable)
    : Boolean(semanticAvailable && embeddingsReady);

  let embeddingsStatus: SidebarFreshnessStatus;
  if (!embeddingsEnabled) {
    embeddingsStatus = "disabled";
  } else if (isOperational) {
    if (embeddingsWorkAvailable === true) {
      embeddingsStatus = "stale";
    } else {
      embeddingsStatus = "fresh";
    }
  } else if (isEmbeddingsChecking) {
    embeddingsStatus = "unknown";
  } else if (runtimeEmbeddings?.contractState === "mismatch") {
    embeddingsStatus = "stale";
  } else if (!embeddingsReady && !effectiveEmbeddingsUpdated && !companionState?.embeddingState.available && !runtimeEmbeddings?.exists) {
    embeddingsStatus = "missing";
  } else if (embeddingsWorkAvailable === true) {
    embeddingsStatus = "stale";
  } else if (embeddingsFreshness && embeddingsFreshness !== "unknown") {
    embeddingsStatus = embeddingsFreshness;
  } else if (companionState?.embeddingFreshness && companionState.embeddingFreshness !== "unknown") {
    embeddingsStatus = companionState.embeddingFreshness;
  } else if (runtimeEmbeddings) {
    embeddingsStatus = !runtimeEmbeddings.exists ? "missing" : "unknown";
  } else {
    embeddingsStatus = embeddingsReady ? "fresh" : "unknown";
  }

  const effectiveChecking = isEmbeddingsChecking && !isOperational;
  const embeddingsRelative = formatRelativeTime(effectiveEmbeddingsUpdated, nowMs, strings);
  const embeddingsFreshnessItem: SidebarFreshnessItem = {
    status: embeddingsStatus,
    label: strings.sidebarFreshnessEmbeddingsLabel,
    humanText: formatFreshnessHumanText(
      embeddingsStatus,
      embeddingsRelative,
      strings,
      effectiveChecking,
      strings.sidebarFreshnessUpdateRequired
    ),
    updatedAt: effectiveEmbeddingsUpdated,
  };

  const freshness: SidebarFreshnessInfo = {
    textIndex: textFreshnessItem,
    embeddings: embeddingsFreshnessItem,
  };

  // 3. Search Availability
  const textAvailable = textIndexReady
    || textIndexUsability === "ready"
    || textIndexUsability === "usable"
    || (companionState?.canConsume === true && companionState.artifactAvailability.textIndex === "available");

  const hybridMode: "full" | "text-only" | "unavailable" = !textAvailable
    ? "unavailable"
    : (runtimeEmbeddings?.effectiveMode ?? (semanticAvailable ? "full" : "text-only"));

  let currentModeHeadline: string;
  let searchTone: "neutral" | "success" | "warning" | "error" = "neutral";

  if (currentSearchMode === "textual") {
    currentModeHeadline = textAvailable
      ? strings.sidebarSearchTextAvailable
      : strings.sidebarSearchTextUnavailable;
    searchTone = textAvailable ? "success" : "warning";
  } else if (currentSearchMode === "semantica") {
    currentModeHeadline = semanticPreparing
      ? strings.semanticPreparing
      : semanticAvailable
        ? strings.sidebarSearchSemanticAvailable
        : strings.sidebarSearchSemanticUnavailable;
    searchTone = semanticAvailable ? "success" : (semanticPreparing ? "neutral" : "warning");
  } else {
    // "hibrida"
    if (semanticPreparing) {
      currentModeHeadline = `${strings.sidebarSearchHybridFull} · ${strings.semanticPreparing}`;
      searchTone = "neutral";
    } else if (semanticAvailable) {
      currentModeHeadline = strings.sidebarSearchHybridFull;
      searchTone = "success";
    } else if (textAvailable) {
      currentModeHeadline = strings.sidebarSearchHybridTextOnly;
      searchTone = "neutral";
    } else {
      currentModeHeadline = strings.sidebarSearchTextUnavailable;
      searchTone = "warning";
    }
  }

  const searchAvailability: SidebarSearchAvailabilityInfo = {
    textAvailable,
    semanticAvailable,
    hybridMode,
    currentModeHeadline,
    secondaryReason: semanticReason,
    tone: searchTone,
  };

  // 4. Prioritized Degraded Alerts (Strict Single Winner)
  let degradedAlert: SidebarDegradedAlert | undefined;

  // Priority 1: Generation integrity / digest mismatch (critical sync/integrity)
  if (
    companionState?.generationIntegrity === "digest-mismatch" ||
    companionState?.generationIntegrity === "count-mismatch"
  ) {
    degradedAlert = {
      kind: "generation-integrity",
      level: "error",
      message: strings.sidebarDegradedGenerationIntegrity,
    };
  }
  // Priority 2: Policy mismatch
  else if (companionState?.policyCompatibility && companionState.policyCompatibility.status === "mismatch") {
    degradedAlert = {
      kind: "policy-mismatch",
      level: "warning",
      message: strings.sidebarDegradedPolicyMismatch,
    };
  }
  // Priority 3: Vector contract mismatch
  else if (
    (companionState?.vectorContractCompatibility && companionState.vectorContractCompatibility.status === "mismatch") ||
    runtimeEmbeddings?.contractState === "mismatch"
  ) {
    degradedAlert = {
      kind: "vector-mismatch",
      level: "warning",
      message: strings.sidebarDegradedVectorMismatch,
    };
  }
  // Priority 4: Producer State Stale (> 48h)
  else if (companionState?.producerFreshness === "stale") {
    degradedAlert = {
      kind: "producer-stale",
      level: "warning",
      message: strings.sidebarDegradedProducerStale,
    };
  }
  // Priority 5: Semantic search unavailable when user has selected semantic or hybrid mode
  else if (
    !semanticAvailable &&
    !semanticPreparing &&
    !embeddingsChecking &&
    (currentSearchMode === "semantica" || currentSearchMode === "hibrida")
  ) {
    degradedAlert = {
      kind: "semantic-unavailable",
      level: "warning",
      message: strings.sidebarSearchSemanticUnavailableOnDevice,
      detail: semanticReason ?? strings.sidebarSearchModelUnavailableLocally,
    };
  }
  // Priority 6: Producer State Aging (> 24h)
  else if (companionState?.producerFreshness === "aging") {
    degradedAlert = {
      kind: "producer-aging",
      level: "info",
      message: strings.sidebarDegradedProducerAging,
    };
  }

  // 5. Maintenance Gating
  const canExecuteMaintenance = roleKey === "active-producer";
  const gatingNotice = roleKey === "companion"
    ? strings.sidebarMaintenanceManagedByActiveProducer
    : roleKey === "standby-producer"
      ? strings.sidebarMaintenanceStandbyNotice
      : undefined;

  const maintenance: SidebarMaintenanceGatingInfo = {
    canExecuteMaintenance,
    isCompanion: roleKey === "companion",
    isStandby: roleKey === "standby-producer",
    gatingNotice,
  };

  return {
    role: roleInfo,
    freshness,
    searchAvailability,
    degradedAlert,
    maintenance,
  };
}
