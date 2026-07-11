/**
 * Shared fixture data for index tests.
 */

import { IndexedNote, TextIndexManifest } from "../../src/index/indexStore";
import { Chunk } from "../../src/index/chunker";

export const VALID_MANIFEST: TextIndexManifest = {
  version: 1,
  indexType: "text",
  embeddingsEnabled: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
  totalNotes: 2,
  totalChunks: 3,
  excludedNotes: 0,
  chunking: { enabled: true, chunkSize: 1200, overlap: 150 },
  exclusions: {
    enabled: true,
    alwaysExcludedFolders: [".lina", ".obsidian"],
    excludedFoldersCount: 0,
    excludedPathContainsCount: 0,
  },
};

export const VALID_NOTES: IndexedNote[] = [
  {
    path: "note1.md",
    basename: "note1",
    extension: "md",
    size: 100,
    mtime: 1000000,
    contentHash: "abc123",
    indexedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    path: "sub/note2.md",
    basename: "note2",
    extension: "md",
    size: 200,
    mtime: 2000000,
    contentHash: "def456",
    indexedAt: "2026-01-01T00:00:00.000Z",
  },
];

export const VALID_CHUNKS: Chunk[] = [
  {
    chunkId: "note1.md::0",
    path: "note1.md",
    chunkIndex: 0,
    text: "This is the content of note1.",
    textHash: "hash1",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    chunkId: "sub/note2.md::0",
    path: "sub/note2.md",
    chunkIndex: 0,
    text: "This is the content of note2.",
    textHash: "hash2",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    chunkId: "sub/note2.md::1",
    path: "sub/note2.md",
    chunkIndex: 1,
    text: "More content from note2.",
    textHash: "hash3",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function buildValidIndexFiles(): Record<string, string> {
  return {
    ".lina/index/manifest.json": JSON.stringify(VALID_MANIFEST, null, 2),
    ".lina/index/notes.json": JSON.stringify(VALID_NOTES, null, 2),
    ".lina/index/chunks.jsonl": VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"),
  };
}

export function buildEmptyNotesIndex(): Record<string, string> {
  return {
    ".lina/index/manifest.json": JSON.stringify(VALID_MANIFEST, null, 2),
    ".lina/index/notes.json": "",
    ".lina/index/chunks.jsonl": VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"),
  };
}

export function buildTruncatedNotesIndex(): Record<string, string> {
  return {
    ".lina/index/manifest.json": JSON.stringify(VALID_MANIFEST, null, 2),
    ".lina/index/notes.json": '{"path": "truncated"', // invalid JSON
    ".lina/index/chunks.jsonl": VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"),
  };
}

export function buildInvalidJsonNotesIndex(): Record<string, string> {
  return {
    ".lina/index/manifest.json": JSON.stringify(VALID_MANIFEST, null, 2),
    ".lina/index/notes.json": "this is not json at all",
    ".lina/index/chunks.jsonl": VALID_CHUNKS.map((c) => JSON.stringify(c)).join("\n"),
  };
}

export function buildChunksWithInvalidLines(): Record<string, string> {
  const validLines = VALID_CHUNKS.map((c) => JSON.stringify(c));
  return {
    ".lina/index/manifest.json": JSON.stringify(VALID_MANIFEST, null, 2),
    ".lina/index/notes.json": JSON.stringify(VALID_NOTES, null, 2),
    ".lina/index/chunks.jsonl": [validLines[0], "not-json", validLines[1], "", validLines[2]].join("\n"),
  };
}

export function buildOversizedChunksIndex(): Record<string, string> {
  // Create a chunks.jsonl that exceeds 50MB limit
  const largeContent = "x".repeat(51 * 1024 * 1024);
  return {
    ".lina/index/manifest.json": JSON.stringify(VALID_MANIFEST, null, 2),
    ".lina/index/notes.json": JSON.stringify(VALID_NOTES, null, 2),
    ".lina/index/chunks.jsonl": largeContent,
  };
}

export function buildManyChunksIndex(chunkCount: number): Record<string, string> {
  const chunks: Chunk[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push({
      chunkId: `note${i}.md::0`,
      path: `note${i}.md`,
      chunkIndex: 0,
      text: `Content of note ${i}.`,
      textHash: `hash${i}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  return {
    ".lina/index/manifest.json": JSON.stringify({ ...VALID_MANIFEST, totalNotes: chunkCount, totalChunks: chunkCount }, null, 2),
    ".lina/index/notes.json": JSON.stringify(
      chunks.map((c, i) => ({
        path: c.path,
        basename: `note${i}`,
        extension: "md",
        size: 100,
        mtime: 1000000 + i,
        contentHash: `hash${i}`,
        indexedAt: "2026-01-01T00:00:00.000Z",
      })),
      null,
      2
    ),
    ".lina/index/chunks.jsonl": chunks.map((c) => JSON.stringify(c)).join("\n"),
  };
}