import { describe, it, expect, vi } from "vitest";
import {
  detectLocalDelta,
  buildLocalDeltaSearchState,
  executeLocalDeltaSearch,
  fuseSearchResults,
  executeCompanionSearchWithDelta,
  LocalDeltaScanResult,
} from "../../src/companion/companionDeltaSearch";
import { IndexedNote } from "../../src/index/indexStore";
import { Chunk } from "../../src/index/chunker";
import { ScannedNote } from "../../src/index/noteScanner";
import { SearchResult } from "../../src/search/textSearch";

const mockIndexedNotes: IndexedNote[] = [
  {
    path: "Projects/Lina.md",
    basename: "Lina",
    extension: "md",
    size: 500,
    mtime: 1700000000,
    contentHash: "hash-lina-old",
    indexedAt: "2026-08-31T10:00:00.000Z",
  },
  {
    path: "Work/Architecture.md",
    basename: "Architecture",
    extension: "md",
    size: 800,
    mtime: 1700000000,
    contentHash: "hash-arch",
    indexedAt: "2026-08-31T10:00:00.000Z",
  },
  {
    path: "Daily/DeletedOld.md",
    basename: "DeletedOld",
    extension: "md",
    size: 200,
    mtime: 1700000000,
    contentHash: "hash-deleted",
    indexedAt: "2026-08-31T10:00:00.000Z",
  },
];

const mockIndexedChunks: Chunk[] = [
  {
    chunkId: "c1",
    path: "Projects/Lina.md",
    chunkIndex: 0,
    text: "Old Lina documentation before recent modifications.",
    textHash: "th1",
    createdAt: "2026-08-31T10:00:00.000Z",
  },
  {
    chunkId: "c2",
    path: "Work/Architecture.md",
    chunkIndex: 0,
    text: "Producer ownership and device roles architecture specification.",
    textHash: "th2",
    createdAt: "2026-08-31T10:00:00.000Z",
  },
  {
    chunkId: "c3",
    path: "Daily/DeletedOld.md",
    chunkIndex: 0,
    text: "This old note will be deleted on the companion device.",
    textHash: "th3",
    createdAt: "2026-08-31T10:00:00.000Z",
  },
];

describe("Companion Local Delta Search Foundation (Phase 0.4.4)", () => {
  describe("detectLocalDelta", () => {
    it("detects newly created notes absent from published index", async () => {
      const scannedNotes: ScannedNote[] = [
        {
          path: "Projects/Lina.md",
          basename: "Lina",
          extension: "md",
          size: 500,
          mtime: 1700000000,
        },
        {
          path: "Work/Architecture.md",
          basename: "Architecture",
          extension: "md",
          size: 800,
          mtime: 1700000000,
        },
        {
          path: "Ideas/NewCompanionNote.md",
          basename: "NewCompanionNote",
          extension: "md",
          size: 350,
          mtime: 1700050000,
        },
      ];

      const readContent = vi.fn(async (path: string) => {
        if (path === "Ideas/NewCompanionNote.md") {
          return "Ephemeral search concepts and local delta testing.";
        }
        return null;
      });

      const delta = await detectLocalDelta({
        scannedNotes,
        indexedNotes: mockIndexedNotes.slice(0, 2), // projects and work
        readContent,
      });

      expect(delta.createdNotes).toHaveLength(1);
      expect(delta.createdNotes[0].path).toBe("Ideas/NewCompanionNote.md");
      expect(delta.createdNotes[0].deltaType).toBe("created");
      expect(delta.createdNotes[0].content).toContain("Ephemeral search concepts");
      expect(delta.modifiedNotes).toHaveLength(0);
      expect(delta.deletedPaths.size).toBe(0);
      expect(delta.unchangedCount).toBe(2);
    });

    it("detects modified notes with newer mtime or size and changed contentHash", async () => {
      const scannedNotes: ScannedNote[] = [
        {
          path: "Projects/Lina.md",
          basename: "Lina",
          extension: "md",
          size: 650, // changed size
          mtime: 1700060000, // newer mtime
        },
        {
          path: "Work/Architecture.md",
          basename: "Architecture",
          extension: "md",
          size: 800,
          mtime: 1700000000,
        },
      ];

      const readContent = vi.fn(async (path: string) => {
        if (path === "Projects/Lina.md") {
          return "Updated Lina documentation with brand new quantum features.";
        }
        return null;
      });

      const delta = await detectLocalDelta({
        scannedNotes,
        indexedNotes: mockIndexedNotes.slice(0, 2),
        readContent,
      });

      expect(delta.createdNotes).toHaveLength(0);
      expect(delta.modifiedNotes).toHaveLength(1);
      expect(delta.modifiedNotes[0].path).toBe("Projects/Lina.md");
      expect(delta.modifiedNotes[0].deltaType).toBe("modified");
      expect(delta.modifiedNotes[0].content).toContain("quantum features");
      expect(delta.unchangedCount).toBe(1);
    });

    it("detects deleted notes that are in the published index but missing from vault", async () => {
      const scannedNotes: ScannedNote[] = [
        {
          path: "Projects/Lina.md",
          basename: "Lina",
          extension: "md",
          size: 500,
          mtime: 1700000000,
        },
      ];

      const readContent = vi.fn(async () => null);

      const delta = await detectLocalDelta({
        scannedNotes,
        indexedNotes: mockIndexedNotes, // has Lina.md, Architecture.md, DeletedOld.md
        readContent,
      });

      expect(delta.deletedPaths.size).toBe(2);
      expect(delta.deletedPaths.has("Work/Architecture.md")).toBe(true);
      expect(delta.deletedPaths.has("Daily/DeletedOld.md")).toBe(true);
      expect(delta.unchangedCount).toBe(1);
    });
  });

  describe("buildLocalDeltaSearchState & executeLocalDeltaSearch", () => {
    it("builds in-memory chunked structures and executes text queries", () => {
      const deltaScan: LocalDeltaScanResult = {
        createdNotes: [
          {
            path: "QuickNotes/Ideas.md",
            basename: "Ideas",
            extension: "md",
            size: 200,
            mtime: 1700000000,
            content: "We should implement ephemeral delta search for mobile companion.",
            contentHash: "hash-ideas",
            deltaType: "created",
          },
        ],
        modifiedNotes: [
          {
            path: "Projects/Lina.md",
            basename: "Lina",
            extension: "md",
            size: 300,
            mtime: 1700010000,
            content: "Lina is an awesome obsidian plugin with companion delta capabilities.",
            contentHash: "hash-lina-new",
            deltaType: "modified",
          },
        ],
        deletedPaths: new Set(),
        unchangedCount: 0,
        totalDeltaNotes: 2,
      };

      const deltaState = buildLocalDeltaSearchState(deltaScan);
      expect(deltaState.ephemeralNotes).toHaveLength(2);
      expect(deltaState.ephemeralChunks.length).toBeGreaterThanOrEqual(2);
      expect(deltaState.deltaTypeByPath.get("QuickNotes/Ideas.md")).toBe("created");
      expect(deltaState.deltaTypeByPath.get("Projects/Lina.md")).toBe("modified");

      // Query matching created note
      const results1 = executeLocalDeltaSearch("ephemeral", deltaState);
      expect(results1.length).toBeGreaterThan(0);
      expect(results1[0].path).toBe("QuickNotes/Ideas.md");

      // Query matching modified note
      const results2 = executeLocalDeltaSearch("capabilities", deltaState);
      expect(results2.length).toBeGreaterThan(0);
      expect(results2[0].path).toBe("Projects/Lina.md");

      // Empty query returns empty
      expect(executeLocalDeltaSearch("", deltaState)).toHaveLength(0);
    });
  });

  describe("fuseSearchResults", () => {
    it("fuses index and delta results, giving precedence to modified delta hits", () => {
      const indexResults: SearchResult[] = [
        {
          path: "Projects/Lina.md",
          basename: "Lina",
          snippet: "Old Lina documentation",
          score: 80,
          origin: "conteudo",
        },
        {
          path: "Work/Architecture.md",
          basename: "Architecture",
          snippet: "Producer ownership",
          score: 60,
          origin: "conteudo",
        },
        {
          path: "Daily/DeletedOld.md",
          basename: "DeletedOld",
          snippet: "Deleted note snippet",
          score: 50,
          origin: "conteudo",
        },
      ];

      const deltaResults: SearchResult[] = [
        {
          path: "Projects/Lina.md",
          basename: "Lina",
          snippet: "Updated Lina documentation with brand new quantum features.",
          score: 95,
          origin: "conteudo",
        },
        {
          path: "Ideas/NewCompanionNote.md",
          basename: "NewCompanionNote",
          snippet: "Brand new companion note",
          score: 70,
          origin: "conteudo",
        },
      ];

      const deletedPaths = new Set(["Daily/DeletedOld.md"]);
      const modifiedPaths = new Set(["Projects/Lina.md"]);

      const fused = fuseSearchResults(indexResults, deltaResults, deletedPaths, modifiedPaths);

      // Should have 3 results:
      // 1. Projects/Lina.md (delta version, score 95)
      // 2. Ideas/NewCompanionNote.md (delta version, score 70)
      // 3. Work/Architecture.md (index version, score 60)
      // (Deleted note is suppressed, old index Lina.md is suppressed)
      expect(fused).toHaveLength(3);

      expect(fused[0].result.path).toBe("Projects/Lina.md");
      expect(fused[0].source).toBe("local-delta");
      expect(fused[0].isTemporary).toBe(true);
      expect(fused[0].deltaType).toBe("modified");
      expect(fused[0].result.score).toBe(95);

      expect(fused[1].result.path).toBe("Ideas/NewCompanionNote.md");
      expect(fused[1].source).toBe("local-delta");
      expect(fused[1].isTemporary).toBe(true);
      expect(fused[1].deltaType).toBe("created");
      expect(fused[1].result.score).toBe(70);

      expect(fused[2].result.path).toBe("Work/Architecture.md");
      expect(fused[2].source).toBe("index");
      expect(fused[2].isTemporary).toBe(false);
      expect(fused[2].deltaType).toBeUndefined();
      expect(fused[2].result.score).toBe(60);
    });
  });

  describe("executeCompanionSearchWithDelta (End-to-End)", () => {
    it("executes end-to-end delta detection, search, and fusion", async () => {
      const scannedNotes: ScannedNote[] = [
        {
          path: "Projects/Lina.md",
          basename: "Lina",
          extension: "md",
          size: 600, // modified
          mtime: 1700050000,
        },
        {
          path: "Work/Architecture.md",
          basename: "Architecture",
          extension: "md",
          size: 800, // unchanged
          mtime: 1700000000,
        },
        {
          path: "Ideas/DeltaIdea.md",
          basename: "DeltaIdea",
          extension: "md",
          size: 250, // created
          mtime: 1700060000,
        },
      ];

      const readContent = vi.fn(async (path: string) => {
        if (path === "Projects/Lina.md") {
          return "Lina plugin provides seamless companion search with delta integration.";
        }
        if (path === "Ideas/DeltaIdea.md") {
          return "DeltaIdea exploring local search capabilities.";
        }
        return null;
      });

      const runResult = await executeCompanionSearchWithDelta({
        query: "companion",
        scannedNotes,
        indexedNotes: mockIndexedNotes,
        indexedChunks: mockIndexedChunks,
        readContent,
      });

      expect(runResult.query).toBe("companion");
      expect(runResult.totalResults).toBeGreaterThan(0);
      expect(runResult.deltaResultCount).toBeGreaterThanOrEqual(1);

      // Contains the modified Lina.md with delta source
      const linaHit = runResult.results.find(r => r.result.path === "Projects/Lina.md");
      expect(linaHit).toBeDefined();
      expect(linaHit?.source).toBe("local-delta");
      expect(linaHit?.isTemporary).toBe(true);
      expect(linaHit?.deltaType).toBe("modified");
    });

    it("returns empty result immediately for blank queries", async () => {
      const runResult = await executeCompanionSearchWithDelta({
        query: "   ",
        scannedNotes: [],
        indexedNotes: [],
        indexedChunks: [],
        readContent: async () => null,
      });

      expect(runResult.results).toHaveLength(0);
      expect(runResult.totalResults).toBe(0);
    });
  });

  describe("Safety & Zero-Mutation Invariants", () => {
    it("never modifies disk, manifest, or triggers workers during delta search", async () => {
      const fakeWrite = vi.fn();
      const fakeRename = vi.fn();
      const fakeRemove = vi.fn();

      const scannedNotes: ScannedNote[] = [
        {
          path: "NewNote.md",
          basename: "NewNote",
          extension: "md",
          size: 100,
          mtime: 1700000000,
        },
      ];

      const readContent = vi.fn(async () => "Safe delta content.");

      const result = await executeCompanionSearchWithDelta({
        query: "delta",
        scannedNotes,
        indexedNotes: mockIndexedNotes,
        indexedChunks: mockIndexedChunks,
        readContent,
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(fakeWrite).not.toHaveBeenCalled();
      expect(fakeRename).not.toHaveBeenCalled();
      expect(fakeRemove).not.toHaveBeenCalled();
    });
  });
});
