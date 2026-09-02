/**
 * Embedding Status Explanation Model (Phase 0.2.2.2)
 *
 * Transforms technical state and policy decisions into human-readable,
 * transparent status information.
 *
 * Architectural Invariant: Pure presentation transformation with zero execution logic,
 * zero provider calls, and zero filesystem side effects.
 */

import type { DeviceRole } from "../device/deviceRole";
import type { EmbeddingProviderCapability } from "../ai/providerCapabilities";
import type { EmbeddingPolicyDecision } from "./embeddingPolicyEngine";
import type { UiStrings } from "../i18n/strings";

export type EmbeddingExplanationStatus =
  | "ready"
  | "needs-update"
  | "up-to-date"
  | "blocked"
  | "unknown";

export type SemanticSearchImpact =
  | "complete"
  | "partial"
  | "unavailable";

export type RecommendedEmbeddingAction =
  | "update"
  | "review-policy"
  | "none";

export interface EmbeddingStatusExplanation {
  readonly status: EmbeddingExplanationStatus;
  readonly title: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly semanticSearchImpact: SemanticSearchImpact;
  readonly providerDescription?: string;
  readonly mayConsumeCredits: boolean;
  readonly recommendedAction?: RecommendedEmbeddingAction;
}

export interface EmbeddingExplanationStateInput {
  readonly totalChunks?: number;
  readonly validCount?: number;
  readonly missingCount?: number;
  readonly staleCount?: number;
  readonly obsoleteCount?: number;
  readonly toGenerateCount?: number;
}

export interface ExplainEmbeddingStatusOptions {
  readonly state?: EmbeddingExplanationStateInput;
  readonly providerCapability: EmbeddingProviderCapability;
  readonly policyDecision: EmbeddingPolicyDecision;
  readonly deviceRole: DeviceRole;
  readonly modelName?: string;
  readonly strings: UiStrings;
}

function formatProviderDescription(capability: EmbeddingProviderCapability, modelName?: string): string {
  const modelPart = modelName && modelName.trim().length > 0 ? ` (${modelName.trim()})` : "";
  return `${capability.providerId}${modelPart}`;
}

/**
 * Transforms technical embedding metrics and policy evaluation into structured,
 * human-readable explanation data.
 */
export function explainEmbeddingStatus(
  options: ExplainEmbeddingStatusOptions,
): EmbeddingStatusExplanation {
  const { state, providerCapability, policyDecision, deviceRole, modelName, strings } = options;

  const validCount = Math.max(0, state?.validCount ?? 0);
  const missingCount = Math.max(0, state?.missingCount ?? 0);
  const staleCount = Math.max(0, state?.staleCount ?? 0);
  const obsoleteCount = Math.max(0, state?.obsoleteCount ?? 0);
  const totalChunks = Math.max(0, state?.totalChunks ?? (validCount + missingCount + staleCount));

  const providerDescription = formatProviderDescription(providerCapability, modelName);

  // 1. Companion Device Handling
  if (deviceRole === "companion" || policyDecision.reason === "companion-device-not-allowed") {
    const hasUnsyncedEmbeddings = missingCount > 0 || staleCount > 0 || (totalChunks > 0 && validCount === 0);
    const semanticSearchImpact: SemanticSearchImpact = !hasUnsyncedEmbeddings
      ? "complete"
      : validCount > 0
      ? "partial"
      : "unavailable";

    const details: string[] = [strings.embeddingExplanationDetailCompanion];
    if (validCount > 0 && totalChunks > 0) {
      details.push(
        strings.embeddingExplanationDetailValid
          .replace("{count}", String(validCount))
          .replace("{total}", String(totalChunks)),
      );
    }
    if (missingCount > 0) {
      details.push(strings.embeddingExplanationDetailMissing.replace("{count}", String(missingCount)));
    }
    if (staleCount > 0) {
      details.push(strings.embeddingExplanationDetailOutdated.replace("{count}", String(staleCount)));
    }

    return {
      status: hasUnsyncedEmbeddings ? "blocked" : "ready",
      title: hasUnsyncedEmbeddings
        ? strings.embeddingExplanationTitleBlocked
        : strings.embeddingExplanationTitleUpToDate,
      summary: hasUnsyncedEmbeddings
        ? strings.embeddingExplanationSummaryCompanionBlocked
        : strings.embeddingExplanationSummaryUpToDate,
      details,
      semanticSearchImpact,
      providerDescription,
      mayConsumeCredits: false,
      recommendedAction: "none",
    };
  }

  // 2. Up-to-date State
  if (policyDecision.reason === "no-update-required") {
    const details: string[] = [];
    if (totalChunks > 0) {
      details.push(
        strings.embeddingExplanationDetailValid
          .replace("{count}", String(validCount > 0 ? validCount : totalChunks))
          .replace("{total}", String(totalChunks)),
      );
    }
    details.push(
      providerCapability.hasExternalCost
        ? strings.embeddingExplanationCostWarning
        : strings.embeddingExplanationNoExternalCost,
    );

    return {
      status: "up-to-date",
      title: strings.embeddingExplanationTitleUpToDate,
      summary: strings.embeddingExplanationSummaryUpToDate,
      details,
      semanticSearchImpact: "complete",
      providerDescription,
      mayConsumeCredits: false,
      recommendedAction: "none",
    };
  }

  // 3. External Provider Blocked under Automatic Policy
  if (policyDecision.reason === "external-provider-blocked") {
    const semanticSearchImpact: SemanticSearchImpact = validCount > 0 ? "partial" : "unavailable";
    const details: string[] = [];
    if (missingCount > 0) {
      details.push(strings.embeddingExplanationDetailMissing.replace("{count}", String(missingCount)));
    }
    if (staleCount > 0) {
      details.push(strings.embeddingExplanationDetailOutdated.replace("{count}", String(staleCount)));
    }
    if (obsoleteCount > 0) {
      details.push(strings.embeddingExplanationDetailObsolete.replace("{count}", String(obsoleteCount)));
    }
    details.push(strings.embeddingExplanationCostWarning);

    return {
      status: "blocked",
      title: strings.embeddingExplanationTitleBlocked,
      summary: strings.embeddingExplanationSummaryExternalBlocked,
      details,
      semanticSearchImpact,
      providerDescription,
      mayConsumeCredits: true,
      recommendedAction: "review-policy",
    };
  }

  // 4. Needs Update (Local auto-approved or manual confirmation required)
  const semanticSearchImpact: SemanticSearchImpact = validCount > 0 ? "partial" : "unavailable";
  const details: string[] = [];

  if (missingCount > 0) {
    details.push(strings.embeddingExplanationDetailMissing.replace("{count}", String(missingCount)));
  }
  if (staleCount > 0) {
    details.push(strings.embeddingExplanationDetailOutdated.replace("{count}", String(staleCount)));
  }
  if (obsoleteCount > 0) {
    details.push(strings.embeddingExplanationDetailObsolete.replace("{count}", String(obsoleteCount)));
  }
  if (validCount > 0 && totalChunks > 0) {
    details.push(
      strings.embeddingExplanationDetailValid
        .replace("{count}", String(validCount))
        .replace("{total}", String(totalChunks)),
    );
  }

  details.push(
    providerCapability.hasExternalCost
      ? strings.embeddingExplanationCostWarning
      : strings.embeddingExplanationNoExternalCost,
  );

  if (policyDecision.requiresConfirmation) {
    details.push(strings.embeddingExplanationDetailManualPolicy);
  } else if (policyDecision.reason === "local-provider-auto-approved") {
    details.push(strings.embeddingExplanationDetailAutoLocalPolicy);
  }

  return {
    status: "needs-update",
    title: strings.embeddingExplanationTitleNeedsUpdate,
    summary: strings.embeddingExplanationSummaryNeedsUpdate,
    details,
    semanticSearchImpact,
    providerDescription,
    mayConsumeCredits: providerCapability.hasExternalCost,
    recommendedAction: "update",
  };
}
