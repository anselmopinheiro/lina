import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import type { Chunk } from "../../src/index/chunker";
import {
  IndexedNote,
  persistAndActivateTextIndexCandidate,
  readIndexedChunks,
  readIndexedNotes,
  saveTextIndex,
} from "../../src/index/indexStore";
import { buildValidIndexFiles, VALID_CHUNKS, VALID_NOTES } from "../fixtures/indexFixtures";
import { FakeAdapter } from "../helpers/fakeAdapter";
import { FakeApp } from "../helpers/fakeApp";

interface ActiveMemoryState {
  notes: IndexedNote[];
  chunks: Chunk[];
  loaded: boolean;
}

const CANDIDATE_NOTE: IndexedNote = {
  path: "candidate.md",
  basename: "candidate",
  extension: "md",
  size: 120,
  mtime: 3000000,
  contentHash: "candidate-hash",
  indexedAt: "2026-07-12T00:00:00.000Z",
};

const CANDIDATE_CHUNK: Chunk = {
  chunkId: "candidate.md::0",
  path: "candidate.md",
  chunkIndex: 0,
  text: "Candidate content long enough to remain in the text index.",
  textHash: "candidate-chunk-hash",
  createdAt: "2026-07-12T00:00:00.000Z",
};

function asApp(fake: FakeApp): App {
  return fake as unknown as App;
}

describe("text index persistence before memory activation", () => {
  let adapter: FakeAdapter;
  let app: FakeApp;
  let initialNotes: IndexedNote[];
  let initialChunks: Chunk[];
  let candidateNotes: IndexedNote[];
  let candidateChunks: Chunk[];
  let active: ActiveMemoryState;

  beforeEach(() => {
    adapter = new FakeAdapter(buildValidIndexFiles());
    app = new FakeApp(adapter);
    initialNotes = [...VALID_NOTES];
    initialChunks = [...VALID_CHUNKS];
    candidateNotes = [...VALID_NOTES, CANDIDATE_NOTE];
    candidateChunks = [...VALID_CHUNKS, CANDIDATE_CHUNK];
    active = { notes: initialNotes, chunks: initialChunks, loaded: true };
  });

  async function persistCandidate(): Promise<boolean> {
    return persistAndActivateTextIndexCandidate(
      () => saveTextIndex(
        asApp(app),
        candidateNotes,
        candidateChunks,
        { enabled: true, chunkSize: 1200, overlap: 150 }
      ),
      () => {
        active = { notes: candidateNotes, chunks: candidateChunks, loaded: true };
      }
    );
  }

  it("activates the candidate after saveTextIndex succeeds", async () => {
    expect(await persistCandidate()).toBe(true);
    expect(active.notes).toBe(candidateNotes);
    expect(active.chunks).toBe(candidateChunks);
    expect(await readIndexedNotes(asApp(app))).toEqual(candidateNotes);
    expect(await readIndexedChunks(asApp(app))).toEqual(candidateChunks);
  });

  it("returns failure when saveTextIndex fails", async () => {
    adapter.setOptions({ simulateWriteError: true });

    expect(await persistCandidate()).toBe(false);
  });

  it("keeps the last confirmed memory state after save failure", async () => {
    adapter.setOptions({ simulateWriteError: true });

    await persistCandidate();

    expect(active.notes).toBe(initialNotes);
    expect(active.chunks).toBe(initialChunks);
    expect(active.loaded).toBe(true);
  });

  it("keeps the last persisted index on disk after save failure", async () => {
    adapter.setOptions({ simulateWriteError: true });

    await persistCandidate();

    expect(await readIndexedNotes(asApp(app))).toEqual(VALID_NOTES);
    expect(await readIndexedChunks(asApp(app))).toEqual(VALID_CHUNKS);
  });

  it("accepts a later automatic candidate after a previous save error", async () => {
    adapter.setOptions({ simulateWriteError: true });
    expect(await persistCandidate()).toBe(false);

    adapter.setOptions({ simulateWriteError: false });
    expect(await persistCandidate()).toBe(true);
    expect(active.notes).toBe(candidateNotes);
    expect(await readIndexedNotes(asApp(app))).toEqual(candidateNotes);
  });

  it("allows the unchanged manual rebuild persistence flow after an automatic save error", async () => {
    adapter.setOptions({ simulateWriteError: true });
    expect(await persistCandidate()).toBe(false);

    adapter.setOptions({ simulateWriteError: false });
    const rebuildNotes = [CANDIDATE_NOTE];
    const rebuildChunks = [CANDIDATE_CHUNK];
    const rebuildSaved = await saveTextIndex(
      asApp(app),
      rebuildNotes,
      rebuildChunks,
      { enabled: true, chunkSize: 1200, overlap: 150 }
    );
    if (rebuildSaved) {
      active = { notes: rebuildNotes, chunks: rebuildChunks, loaded: true };
    }

    expect(rebuildSaved).toBe(true);
    expect(active.notes).toBe(rebuildNotes);
    expect(await readIndexedNotes(asApp(app))).toEqual(rebuildNotes);
  });

  it("recovers the last persisted state on a new plugin opening after failure", async () => {
    adapter.setOptions({ simulateWriteError: true });
    expect(await persistCandidate()).toBe(false);

    const reopenedApp = new FakeApp(adapter);
    const reopenedNotes = await readIndexedNotes(asApp(reopenedApp));
    const reopenedChunks = await readIndexedChunks(asApp(reopenedApp));

    expect(reopenedNotes).toEqual(VALID_NOTES);
    expect(reopenedChunks).toEqual(VALID_CHUNKS);
  });
});
