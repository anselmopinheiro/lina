import { shouldExcludeContent, shouldExcludePath } from "../index/indexExclusions";
import type { ExclusionPolicyRules } from "../index/exclusionPolicy";

export type AiPrivacyPolicyStatus = "loaded" | "missing" | "invalid";

export type AiPrivacyGateReason =
  | "policy-unavailable"
  | "path-excluded"
  | "content-excluded";

export type AiPrivacyGateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: AiPrivacyGateReason };

export interface AiPrivacyGateInput {
  readonly policyStatus: AiPrivacyPolicyStatus;
  readonly rules: ExclusionPolicyRules;
  readonly path: string;
  readonly content: string;
  readonly configDir?: string;
}

/**
 * The sole boundary decision for sending vault content to a text AI provider.
 * It deliberately reuses the canonical exclusion matchers, without coupling AI
 * delivery to index maintenance or creating a second exclusion policy.
 */
export function evaluateAiPrivacyGate(input: AiPrivacyGateInput): AiPrivacyGateDecision {
  if (input.policyStatus !== "loaded") {
    return { allowed: false, reason: "policy-unavailable" };
  }

  const pathDecision = shouldExcludePath(input.path, {
    excludedFolders: [...input.rules.excludedFolders],
    excludedPathContains: [...input.rules.excludedPathContains],
  }, input.configDir);
  if (pathDecision.excluded) {
    return { allowed: false, reason: "path-excluded" };
  }

  if (
    input.rules.excludedContentContains.length > 0
    && shouldExcludeContent(input.content, [...input.rules.excludedContentContains]).excluded
  ) {
    return { allowed: false, reason: "content-excluded" };
  }

  return { allowed: true };
}
