import { describe, expect, it } from "vitest";
import { nextPublishedGenerationNumber, parsePublishedGenerationNumber } from "../../src/index/publishedGenerationPublicationService";

describe("M4 next generation ID", () => {
  it("normalizes basename, Unix and Windows paths", () => {
    expect(parsePublishedGenerationNumber("generation-000001")).toBe(1);
    expect(parsePublishedGenerationNumber(".lina/published/generations/generation-000123")).toBe(123);
    expect(parsePublishedGenerationNumber(".lina\\published\\generations\\generation-000003")).toBe(3);
  });
  it("ignores invalid folders and uses numeric filesystem maximum", () => {
    expect(nextPublishedGenerationNumber([".staging", "generation-invalid", "generation-000001", "C:\\x\\generation-000003"])).toBe(4);
    expect(nextPublishedGenerationNumber([])).toBe(1);
  });
});
