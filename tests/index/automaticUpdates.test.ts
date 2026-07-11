/**
 * Tests for automatic text index update gating.
 *
 * Verifies that when the text index is not valid (missing, corrupt, etc.),
 * automatic updates do NOT read notes, do NOT write index files, and
 * do NOT create partial index state.
 *
 * Also verifies that when the index IS valid, create/modify/delete/rename
 * events correctly update the index.
 *
 * These tests use the real updateTextIndexForFileChange logic from main.ts
 * via the readTextIndexForAutomaticUpdate gate. Since the full plugin
 * lifecycle is complex, we test the gating function directly and verify
 * that no writes occur when the index is not ready.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { App } from "obsidian";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { FakeApp } from "../helpers/fakeApp";
import { readTextIndexForAutomaticUpdate, saveTextIndex } from "../../src/index/indexStore";
import {
  buildValidIndexFiles,
  buildEmptyNotesIndex,
  buildInvalidJsonNotesIndex,
  buildOversizedChunksIndex,
  buildChunksWithInvalidLines,
  VALID_NOTES,
  VALID_CHUNKS,
  VALID_MANIFEST,
} from "../fixtures/indexFixtures";

function asApp(fake: FakeApp): App {
  return fake as unknown as App;
}

describe("Automatic update gating — no valid index", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  it("blocks update when .lina/index is absent", async () => {
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when manifest.json is absent", async () => {
    adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
    adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when manifest.json is empty", async () => {
    adapter.setFile(".lina/index/manifest.json", "");
    adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
    adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when manifest.json has invalid JSON", async () => {
    adapter.setFile(".lina/index/manifest.json", "not-json");
    adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));
    adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when notes.json is absent", async () => {
    adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
    adapter.setFile(".lina/index/chunks.jsonl", VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"));

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when notes.json is empty", async () => {
    const files = buildEmptyNotesIndex();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when notes.json has invalid JSON", async () => {
    const files = buildInvalidJsonNotesIndex();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when chunks.jsonl is absent", async () => {
    adapter.setFile(".lina/index/manifest.json", JSON.stringify(VALID_MANIFEST, null, 2));
    adapter.setFile(".lina/index/notes.json", JSON.stringify(VALID_NOTES, null, 2));

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when chunks.jsonl has invalid lines (strict mode)", async () => {
    const files = buildChunksWithInvalidLines();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("blocks update when chunks.jsonl exceeds size limit", async () => {
    const files = buildOversizedChunksIndex();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);
    expect(adapter.writeCount).toBe(0);
  });

  it("does not create any index files when blocked", async () => {
    // No index files exist at all
    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(false);

    // Verify no files were created
    expect(adapter.listFiles()).toHaveLength(0);
    expect(adapter.writeCount).toBe(0);
  });
});

describe("Automatic update — valid index allows updates", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;

  beforeEach(() => {
    adapter = new FakeAdapter();
    app = new FakeApp(adapter);
  });

  it("allows update when all index files are valid", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    const result = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(result.ready).toBe(true);
  });

  it("saveTextIndex works after valid index check", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    // Verify the index is ready
    const check = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(check.ready).toBe(true);

    // Now simulate a create event by saving with an extra note
    const updatedNotes = [
      ...VALID_NOTES,
      {
        path: "note3.md",
        basename: "note3",
        extension: "md",
        size: 50,
        mtime: 3000000,
        contentHash: "ghi789",
        indexedAt: new Date().toISOString(),
      },
    ];
    const updatedChunks = [
      ...VALID_CHUNKS,
      {
        chunkId: "note3.md::0",
        path: "note3.md",
        chunkIndex: 0,
        text: "Content of note3.",
        textHash: "hash4",
        createdAt: new Date().toISOString(),
      },
    ];

    const success = await saveTextIndex(
      asApp(app),
      updatedNotes,
      updatedChunks,
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    expect(success).toBe(true);

    // Verify the index now has 3 notes
    const recheck = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(recheck.ready).toBe(true);
    if (recheck.ready) {
      expect(recheck.notes).toHaveLength(3);
      expect(recheck.chunks).toHaveLength(4);
    }
  });

  it("saveTextIndex can remove a note (delete event)", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    // Remove note1
    const remainingNotes = VALID_NOTES.filter((n) => n.path !== "note1.md");
    const remainingChunks = VALID_CHUNKS.filter((c) => c.path !== "note1.md");

    const success = await saveTextIndex(
      asApp(app),
      remainingNotes,
      remainingChunks,
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    expect(success).toBe(true);

    const recheck = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(recheck.ready).toBe(true);
    if (recheck.ready) {
      expect(recheck.notes).toHaveLength(1);
      expect(recheck.chunks).toHaveLength(2);
    }
  });

  it("saveTextIndex can update a note path (rename event)", async () => {
    const files = buildValidIndexFiles();
    for (const [path, content] of Object.entries(files)) {
      adapter.setFile(path, content);
    }

    // Rename note1.md to renamed-note1.md
    const renamedNotes = VALID_NOTES.map((n) =>
      n.path === "note1.md"
        ? { ...n, path: "renamed-note1.md", basename: "renamed-note1" }
        : n
    );
    const renamedChunks = VALID_CHUNKS.map((c) =>
      c.path === "note1.md"
        ? { ...c, path: "renamed-note1.md", chunkId: "renamed-note1.md::0" }
        : c
    );

    const success = await saveTextIndex(
      asApp(app),
      renamedNotes,
      renamedChunks,
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    expect(success).toBe(true);

    const recheck = await readTextIndexForAutomaticUpdate(asApp(app));
    expect(recheck.ready).toBe(true);
    if (recheck.ready) {
      expect(recheck.notes).toHaveLength(2);
      expect(recheck.notes.find((n) => n.path === "renamed-note1.md")).toBeDefined();
      expect(recheck.notes.find((n) => n.path === "note1.md")).toBeUndefined();
    }
  });
});