import { describe, expect, it } from "vitest";
import { chunkText } from "../../src/index/chunker";

describe("text chunker short-note fallback", () => {
  it("keeps empty and whitespace-only notes without chunks", () => {
    expect(chunkText("Empty.md", "")).toEqual([]);
    expect(chunkText("Whitespace.md", " \n\t ")).toEqual([]);
  });

  it("emits one normalized searchable chunk for a short non-empty note", () => {
    const chunks = chunkText("Short.md", "mafarrrico\n\num dó li tá");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkId: "Short.md::0",
      path: "Short.md",
      chunkIndex: 0,
      text: "mafarrrico um dó li tá",
    });
  });

  it("keeps normal-length chunking unchanged without a duplicate fallback", () => {
    const content = "Normal note content long enough to produce the existing regular chunk without any fallback duplicate.";
    const chunks = chunkText("Normal.md", content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkId: "Normal.md::0",
      text: content,
    });
  });

  it("keeps long-note splitting behavior without fallback duplicates", () => {
    const content = Array.from({ length: 80 }, () => "searchable").join(" ");
    const chunks = chunkText("Long.md", content, { chunkSize: 100, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((chunk) => chunk.chunkId)).size).toBe(chunks.length);
  });
});
