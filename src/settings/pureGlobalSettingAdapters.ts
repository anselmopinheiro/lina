export type PureGlobalSettingEffect = {
  type: "update-vault-event-listeners";
};

export const MAX_SUGGESTED_TAGS_MIN = 1;
export const MAX_SUGGESTED_TAGS_MAX = 20;
export const MAX_SUGGESTED_TAGS_FALLBACK = 8;
export const MAX_INBOX_NOTES_MIN = 1;
export const MAX_INBOX_NOTES_MAX = 20;
export const MAX_INBOX_NOTES_FALLBACK = 10;

export function normalizePureMaxSuggestedTags(value: number | string | undefined): number {
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(value ?? "", 10);
  const normalized = Number.isNaN(parsed) ? MAX_SUGGESTED_TAGS_FALLBACK : parsed;
  return Math.min(MAX_SUGGESTED_TAGS_MAX, Math.max(MAX_SUGGESTED_TAGS_MIN, normalized));
}

export function normalizePureInboxMaxNotes(value: number | string | undefined): number {
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(value ?? "", 10);
  const normalized = Number.isNaN(parsed) ? MAX_INBOX_NOTES_FALLBACK : parsed;
  return Math.min(MAX_INBOX_NOTES_MAX, Math.max(MAX_INBOX_NOTES_MIN, normalized));
}

export function normalizePureHybridSearchWeight(
  value: number | string | undefined,
  fallback: number,
): number {
  const parsed = typeof value === "number"
    ? value
    : Number.parseFloat(value ?? "");
  const normalized = Number.isNaN(parsed) ? fallback : parsed;
  return Math.min(1, Math.max(0, normalized));
}

export function createPureAutoUpdateIndexAdapter() {
  return {
    key: "autoUpdateIndexOnFileChanges" as const,
    defaultValue: false,
    controlType: "toggle" as const,
    declaredEffects: [{ type: "update-vault-event-listeners" } satisfies PureGlobalSettingEffect],
    requiresFutureUpdate: false,
  };
}

export function createPureMaxSuggestedTagsAdapter(value: number | undefined) {
  return {
    key: "maxSuggestedTags" as const,
    controlType: "dropdown" as const,
    value: normalizePureMaxSuggestedTags(value),
    min: MAX_SUGGESTED_TAGS_MIN,
    max: MAX_SUGGESTED_TAGS_MAX,
    fallback: MAX_SUGGESTED_TAGS_FALLBACK,
    options: Array.from(
      { length: MAX_SUGGESTED_TAGS_MAX - MAX_SUGGESTED_TAGS_MIN + 1 },
      (_, index) => MAX_SUGGESTED_TAGS_MIN + index,
    ),
    declaredEffects: [] satisfies PureGlobalSettingEffect[],
    requiresFutureUpdate: false,
  };
}
