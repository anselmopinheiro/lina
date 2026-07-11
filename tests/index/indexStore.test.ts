/**
 * Tests for defensive reading of the text index files.
 *
 * Covers the regressions fixed in version 0.1.9:
 * - notes.json empty, truncated, invalid JSON
 * - chunks.jsonl oversized, invalid lines, chunk limit
 * - All edge cases return safe results without throwing
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { App } from "obsidian";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { FakeApp } from "../helpers/fakeApp";
import {
  readIndexedNotes,
  readIndexedChunks,
  readTextIndexForAutomaticUpdate,
  readTextIndexStatus,
  saveTextIndex,
} from "../../src/index/indexStore";
import {
  buildValidIndexFiles,
  buildEmptyNotesIndex,
  buildTruncatedNotesIndex,
  buildInvalidJsonNotesIndex,
  buildChunksWithInvalidLines,
  buildOversizedChunksIndex,
  buildManyChunksIndex,
  VALID_NOTES,
  VALID_CHUNKS,
  VALID_MANIFEST,
} from "../fixtures/indexFixtures";

/** Cast a FakeApp to the Obsidian App type for use with indexStore functions */
function asApp(fake: FakeApp): App {
  return fake as unknown as App;
}

describe("readIndexedNotes (defensive reading)", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  it("loads valid notes.json correctly", async () => {
    adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
    adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
    adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

    const notes = await readIndexedNotes(asApp(app));
    expect(notes).not.toBeNull();
    expect(notes).toHaveLength(2);
    expect(notes![0].path).toBe("note1.md");
    expect(notes![1].path).toBe("sub/note2.md");
  });

  it("returns null when notes.json is missing", async () => {
    const notes = await readIndexedNotes(asApp(app));
    expect(notes).toBeNull();
  });

  it("returns null when notes.json is empty (zero size)", async () => {
    adapter.setFile(".lina/index/notes.json", "");
    const notes = await readIndexedNotes(asApp(app));
    expect(notes).toBeNull();
  });

  it("returns null when notes.json has only whitespace", async () => {
    adapter.setFile(".lina/index/notes.json", "   \n  \n  ");
    const notes = await readIndexedNotes(asApp(app));
    expect(notes).toBeNull();
  });

  it("returns null when notes.json contains invalid JSON", async () => {
    adapter.setFile(".lina/index/notes.json", "this is not json");
    const notes = await readIndexedNotes(asApp(app));
    expect(notes).toBeNull();
  });

  it("returns null when notes.json is truncated (partial JSON)", async () => {
    adapter.setFile(".lina/index/notes.json", '{"path": "truncated"');
    const notes = await readIndexedNotes(asApp(app));
    expect(notes).toBeNull();
  });

  it("returns null when notes.json is not an array", async () => {
    adapter.setFile(".lina/index/notes.json", JSON.stringify({ not: "an array" }));
    const notes = await readIndexedNotes(asApp(app));
    expect(notes).toBeNull();
  });

  it("does not throw on any invalid state", async () => {
    await expect(readIndexedNotes(asApp(app))).resolves.not.toThrow();
    adapter.setFile(".lina/index/notes.json", "");
    await expect(readIndexedNotes(asApp(app))).resolves.not.toThrow();
    adapter.setFile(".lina/index/notes.json", "{{{");
    await expect(readIndexedNotes(asApp(app))).resolves.not.toThrow();
  });
});

describe("readIndexedChunks (defensive reading)", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  it("loads valid chunks.jsonl correctly", async () => {
    adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));
    const chunks = await readIndexedChunks(asApp(app));
    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(3);
  });

  it("returns null when chunks.jsonl is missing", async () => {
    const chunks = await readIndexedChunks(asApp(app));
    expect(chunks).toBeNull();
  });

  it("ignores invalid lines in chunks.jsonl", async () => {
    const validLines = VALID_CHUNKS.map((c) => JSON.stringify(c));
    const content = [validLines[0], "not-json", validLines[1], "", validLines[2]].join("\n");
    adapter.setFile(".lina/index/chunks.jsonl", content);

    const chunks = await readIndexedChunks(asApp(app));
    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(3);
  });

  it("returns empty array when all lines are invalid", async () => {
    adapter.setFile(".lina/index/chunks.jsonl", "not-json\nalso-not-json\n");
    const chunks = await readIndexedChunks(asApp(app));
    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(0);
  });

  it("does not load chunks.jsonl when file exceeds size limit", async () => {
    const largeContent = "x".repeat(51 * 1024 * 1024);
    adapter.setFile(".lina/index/chunks.jsonl", largeContent);
    const chunks = await readIndexedChunks(asApp(app));
    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(0);
  });

  it("respects the maximum chunk loading limit", async () => {
    const chunkCount = 150_000;
    const files = buildManyChunksIndex(chunkCount);
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const chunks = await readIndexedChunks(asApp(app));
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBeLessThanOrEqual(100_000);
  });

  it("does not throw on any invalid state", async () => {
    await expect(readIndexedChunks(asApp(app))).resolves.not.toThrow();
    adapter.setFile(".lina/index/chunks.jsonl", "");
    await expect(readIndexedChunks(asApp(app))).resolves.not.toThrow();
    adapter.setFile(".lina/index/chunks.jsonl", "{{{");
    await expect(readIndexedChunks(asApp(app))).resolves.not.toThrow();
  });
});

describe("readTextIndexForAutomaticUpdate (gating)", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  it("returns ready=true when all index files are valid", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(true);
    if (result.ready) {
      expect(result.notes).toHaveLength(2);
      expect(result.chunks).toHaveLength(3);
    }
  });

  it("returns ready=false when manifest is missing", async () => {
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when manifest is empty", async () => {
    adapter.setFile(".lina/index/manifest.json", "");
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when manifest has invalid JSON", async () => {
    adapter.setFile(".lina/index/manifest.json", "not-json");
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when manifest has wrong indexType", async () => {
    adapter.setFile(
      ".lina/index/manifest.json",
      JSON.stringify({ ...VALID_MANIFEST, indexType: "embedding" }, null, 2)
    );
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when notes.json is missing", async () => {
    adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when notes.json is empty", async () => {
    const files = buildEmptyNotesIndex();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when notes.json has invalid JSON", async () => {
    const files = buildInvalidJsonNotesIndex();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when chunks.jsonl is missing", async () => {
    adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
    adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when chunks.jsonl has invalid lines (strict mode)", async () => {
    const files = buildChunksWithInvalidLines();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("returns ready=false when chunks.jsonl exceeds size limit", async () => {
    const files = buildOversizedChunksIndex();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
  });

  it("does not throw on any invalid state", async () => {
    await expect(readTextIndexForAutomaticUpdate(asApp(app))).resolves.not.toThrow();
    adapter.setFile(".lina/index/manifest.json", "");
    await expect(readTextIndexForAutomaticUpdate(asApp(app))).resolves.not.toThrow();
    adapter.setFile(".lina/index/manifest.json", "{{{");
    await expect(readTextIndexForAutomaticUpdate(asApp(app))).resolves.not.toThrow();
  });
});

describe("readTextIndexStatus", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  it("returns exists=false when no index", async () => {
    const status = await readTextIndexStatus(asApp(app));
    expect(status.exists).toBe(false);
  });

  it("returns exists=true with correct counts for valid index", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }
    const status = await readTextIndexStatus(asApp(app));
    expect(status.exists).toBe(true);
    expect(status.totalNotes).toBe(2);
    expect(status.totalChunks).toBe(3);
  });

  it("does not read notes.json or chunks.jsonl when checking status", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const status = await readTextIndexStatus(asApp(app));

    expect(status.exists).toBe(true);
    expect(adapter.readPaths).toEqual([".lina/index/manifest.json"]);
  });

  it("does not throw when manifest is missing", async () => {
    await expect(readTextIndexStatus(asApp(app))).resolves.not.toThrow();
  });
});

describe("saveTextIndex (atomic write)", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  it("saves index files successfully", async () => {
    const result = await saveTextIndex(
      asApp(app),
      VALID_NOTES,
      VALID_CHUNKS,
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    expect(result).toBe(true);
    expect(adapter.hasFile(".lina/index/manifest.json")).toBe(true);
    expect(adapter.hasFile(".lina/index/notes.json")).toBe(true);
    expect(adapter.hasFile(".lina/index/chunks.jsonl")).toBe(true);
  });

  it("does not leave temporary files after successful save", async () => {
    await saveTextIndex(
      asApp(app),
      VALID_NOTES,
      VALID_CHUNKS,
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    expect(adapter.listTempFiles()).toHaveLength(0);
    expect(adapter.listBackupFiles()).toHaveLength(0);
  });

  it("preserves previous index when write fails", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    adapter.setOptions({ simulateWriteError: true });

    const result = await saveTextIndex(
      asApp(app),
      [],
      [],
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    expect(result).toBe(false);

    const notes = await readIndexedNotes(asApp(app));
    expect(notes).not.toBeNull();
    expect(notes).toHaveLength(2);
  });

  it("does not leave temporary files after failed write", async () => {
    adapter.setOptions({ simulateWriteError: true });

    await saveTextIndex(
      asApp(app),
      VALID_NOTES,
      VALID_CHUNKS,
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    expect(adapter.listTempFiles()).toHaveLength(0);
  });
});
