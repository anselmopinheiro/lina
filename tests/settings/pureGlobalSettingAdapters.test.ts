import { describe, expect, it } from "vitest";
import {
  MAX_SUGGESTED_TAGS_FALLBACK,
  MAX_SUGGESTED_TAGS_MAX,
  MAX_SUGGESTED_TAGS_MIN,
  createPureAutoUpdateIndexAdapter,
  createPureMaxSuggestedTagsAdapter,
  normalizePureMaxSuggestedTags,
} from "../../src/settings/pureGlobalSettingAdapters";

describe("pure deferred global setting adapters", () => {
  it("models automatic index updates with its existing default and only required effect", () => {
    const adapter = createPureAutoUpdateIndexAdapter();

    expect(adapter).toEqual({
      key: "autoUpdateIndexOnFileChanges",
      defaultValue: false,
      controlType: "toggle",
      declaredEffects: [{ type: "update-vault-event-listeners" }],
      requiresFutureUpdate: false,
    });
  });

  it("preserves the current suggested-tag bounds, fallback, and dropdown values", () => {
    const adapter = createPureMaxSuggestedTagsAdapter(undefined);

    expect(adapter).toMatchObject({
      key: "maxSuggestedTags",
      controlType: "dropdown",
      value: MAX_SUGGESTED_TAGS_FALLBACK,
      min: MAX_SUGGESTED_TAGS_MIN,
      max: MAX_SUGGESTED_TAGS_MAX,
      fallback: MAX_SUGGESTED_TAGS_FALLBACK,
      declaredEffects: [],
      requiresFutureUpdate: false,
    });
    expect(adapter.options).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it.each([
    [1, 1],
    [20, 20],
    [0, 1],
    [21, 20],
    ["invalid", 8],
    ["12", 12],
  ])("normalizes %p to %p", (value, expected) => {
    expect(normalizePureMaxSuggestedTags(value)).toBe(expected);
  });
});
