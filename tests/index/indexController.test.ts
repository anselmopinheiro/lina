import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import LinaPlugin from "../../main.ts";
import { chunkText, Chunk } from "../../src/index/chunker";
import { hashContent } from "../../src/index/noteHasher";
import { IndexedNote, readIndexedChunks, readIndexedNotes, saveTextIndex } from "../../src/index/indexStore";
import { FakeAdapter } from "../helpers/fakeAdapter";

type TestableLinaPlugin = LinaPlugin & Record<string, unknown>;

class ControllerVault {
  adapter: FakeAdapter;
  configDir = ".obsidian";
  private listedFiles: TFile[] = [];
  private contents = new Map<string, string>();

  constructor(adapter: FakeAdapter) {
    this.adapter = adapter;
  }

  setMarkdownFiles(files: TFile[]): void {
    this.listedFiles = files;
  }

  setContent(path: string, content: string): void {
    this.contents.set(path, content);
  }

  getMarkdownFiles(): TFile[] {
    return this.listedFiles;
  }

  async read(file: TFile): Promise<string> {
    const content = this.contents.get(file.path);
    if (content === undefined) {
      throw new Error(`Missing fake content for ${file.path}`);
    }
    return content;
  }
}

function asApp(vault: ControllerVault): { vault: ControllerVault } {
  return { vault };
}

function makeFile(path: string, content: string, mtime: number): TFile {
  const file = new TFile(path, content);
  file.stat = { size: content.length, mtime };
  return file;
}

function noteFromFile(file: TFile, content: string): IndexedNote {
  return {
    path: file.path,
    basename: file.basename,
    extension: file.extension,
    size: file.stat.size,
    mtime: file.stat.mtime,
    contentHash: hashContent(content),
    indexedAt: "2026-07-12T00:00:00.000Z",
  };
}

function chunksForFile(file: TFile, content: string): Chunk[] {
  return chunkText(file.path, content, { chunkSize: 1200, overlap: 150 });
}

function createHarness(): {
  adapter: FakeAdapter;
  vault: ControllerVault;
  plugin: TestableLinaPlugin;
} {
  const adapter = new FakeAdapter();
  const vault = new ControllerVault(adapter);
  const plugin = Object.create(LinaPlugin.prototype) as TestableLinaPlugin;

  plugin.app = asApp(vault);
  plugin.manifest = { id: "lina" };
  plugin.settings = {
    autoUpdateIndexOnFileChanges: true,
    debugIndexUpdates: false,
    indexExcludedFolders: "",
    indexExcludedPathContains: "",
    indexExcludedContentContains: "",
  };
  plugin.indexedNotes = [];
  plugin.indexedChunks = [];
  plugin.textIndexLoaded = false;
  plugin.textIndexLoadPromise = null;
  plugin.textIndexRebuildProgress = { status: "idle", total: 0, processed: 0, skipped: 0, errors: 0 };
  plugin.textIndexRebuildListeners = new Set();
  plugin.activeAutomaticIndexUpdates = 0;
  plugin.automaticUpdatesReady = false;
  plugin.automaticUpdateInProgress = false;
  plugin.automaticUpdatePromise = null;
  plugin.automaticUpdatePending = false;
  plugin.startupReconciliationNeeded = false;
  plugin.startupReconciliationInProgress = false;
  plugin.startupIgnoredEventCount = 0;
  plugin.pendingAutomaticUpdates = new Map();
  plugin.pendingAutomaticUpdatesFlushTimer = null;
  plugin.indexDiagnostic = {
    autoUpdateEnabled: false,
    debugEnabled: false,
    pendingDebounces: new Set<string>(),
    recentEvents: [],
  };

  return { adapter, vault, plugin };
}

async function seedIndex(
  plugin: TestableLinaPlugin,
  files: Array<{ file: TFile; content: string }>
): Promise<void> {
  const notes = files.map(({ file, content }) => noteFromFile(file, content));
  const chunks = files.flatMap(({ file, content }) => chunksForFile(file, content));
  const saved = await saveTextIndex(
    plugin.app as never,
    notes,
    chunks,
    { enabled: true, chunkSize: 1200, overlap: 150 }
  );
  expect(saved).toBe(true);
}

async function readPersistedPaths(plugin: TestableLinaPlugin): Promise<string[]> {
  const notes = await readIndexedNotes(plugin.app as never);
  expect(notes).not.toBeNull();
  return notes!.map((note) => note.path).sort();
}

describe("text index controller integration", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("startup reconciliation keeps the index unchanged when there are no differences", async () => {
    const { adapter, vault, plugin } = createHarness();
    const content = "Existing note content long enough for the text index.";
    const file = makeFile("Existing.md", content, 100);
    vault.setMarkdownFiles([file]);
    vault.setContent(file.path, content);
    await seedIndex(plugin, [{ file, content }]);
    adapter.resetCounters();

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual(["Existing.md"]);
    expect(adapter.writeCount).toBe(0);
    expect(plugin.automaticUpdatesReady).toBe(true);
  });

  it("startup reconciliation persists notes created while the plugin was closed", async () => {
    const { vault, plugin } = createHarness();
    const existingContent = "Existing note content long enough for the text index.";
    const newContent = "New note content long enough for startup reconciliation.";
    const existingFile = makeFile("Existing.md", existingContent, 100);
    const newFile = makeFile("New.md", newContent, 200);
    vault.setMarkdownFiles([existingFile, newFile]);
    vault.setContent(existingFile.path, existingContent);
    vault.setContent(newFile.path, newContent);
    await seedIndex(plugin, [{ file: existingFile, content: existingContent }]);

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual(["Existing.md", "New.md"]);
    expect((plugin.indexedNotes as IndexedNote[]).some((note) => note.path === "New.md")).toBe(true);
  });

  it("startup reconciliation persists notes modified while the plugin was closed", async () => {
    const { vault, plugin } = createHarness();
    const oldContent = "Old note content long enough for the text index.";
    const newContent = "New note content long enough for startup reconciliation.";
    const indexedFile = makeFile("Changed.md", oldContent, 100);
    const vaultFile = makeFile("Changed.md", newContent, 200);
    vault.setMarkdownFiles([vaultFile]);
    vault.setContent(vaultFile.path, newContent);
    await seedIndex(plugin, [{ file: indexedFile, content: oldContent }]);

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    const notes = await readIndexedNotes(plugin.app as never);
    expect(notes?.find((note) => note.path === "Changed.md")?.contentHash).toBe(hashContent(newContent));
    expect(plugin.indexedNotes).toEqual(notes);
  });

  it("startup reconciliation removes notes deleted while the plugin was closed", async () => {
    const { vault, plugin } = createHarness();
    const keptContent = "Kept note content long enough for the text index.";
    const deletedContent = "Deleted note content long enough for the text index.";
    const keptFile = makeFile("Kept.md", keptContent, 100);
    const deletedFile = makeFile("Deleted.md", deletedContent, 200);
    vault.setMarkdownFiles([keptFile]);
    vault.setContent(keptFile.path, keptContent);
    await seedIndex(plugin, [
      { file: keptFile, content: keptContent },
      { file: deletedFile, content: deletedContent },
    ]);

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual(["Kept.md"]);
  });

  it("startup reconciliation persists offline rename as delete plus create", async () => {
    const { vault, plugin } = createHarness();
    const content = "Renamed note content long enough for the text index.";
    const oldFile = makeFile("Old.md", content, 100);
    const newFile = makeFile("New.md", content, 100);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, content);
    await seedIndex(plugin, [{ file: oldFile, content }]);

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual(["New.md"]);
  });

  it("queues live events received while startup reconciliation is in progress", async () => {
    const { vault, plugin } = createHarness();
    const existingContent = "Existing note content long enough for the text index.";
    const startupContent = "Startup-created note content long enough for the index.";
    const liveContent = "Live-created note content long enough for the index.";
    const existingFile = makeFile("Existing.md", existingContent, 100);
    const startupFile = makeFile("Startup.md", startupContent, 200);
    const liveFile = makeFile("Live.md", liveContent, 300);
    vault.setMarkdownFiles([existingFile, startupFile]);
    vault.setContent(existingFile.path, existingContent);
    vault.setContent(startupFile.path, startupContent);
    vault.setContent(liveFile.path, liveContent);
    await seedIndex(plugin, [{ file: existingFile, content: existingContent }]);

    plugin.startupReconciliationInProgress = true;
    (plugin.queueOrRunAutomaticIndexUpdate as (changeType: string, file: TFile, path: string) => void)
      .call(plugin, "create", liveFile, liveFile.path);
    await (plugin.reconcileTextIndexAtStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual(["Existing.md", "Live.md", "Startup.md"]);
  });

  it("processes a live create event through queue, batch, persistence and memory activation", async () => {
    const { vault, plugin } = createHarness();
    const existingContent = "Existing note content long enough for the text index.";
    const liveContent = "Live note content long enough for the automatic batch.";
    const existingFile = makeFile("Existing.md", existingContent, 100);
    const liveFile = makeFile("Live.md", liveContent, 200);
    vault.setMarkdownFiles([existingFile, liveFile]);
    vault.setContent(existingFile.path, existingContent);
    vault.setContent(liveFile.path, liveContent);
    await seedIndex(plugin, [{ file: existingFile, content: existingContent }]);
    plugin.automaticUpdatesReady = true;

    (plugin.handleVaultEvent as (changeType: string, file: TFile) => void).call(plugin, "create", liveFile);
    expect((plugin.pendingAutomaticUpdates as Map<string, unknown>).size).toBe(1);

    await (plugin.flushPendingAutomaticUpdates as () => Promise<void>).call(plugin);

    expect((plugin.pendingAutomaticUpdates as Map<string, unknown>).size).toBe(0);
    expect(await readPersistedPaths(plugin)).toEqual(["Existing.md", "Live.md"]);
    expect((plugin.indexedNotes as IndexedNote[]).map((note) => note.path).sort()).toEqual(["Existing.md", "Live.md"]);
  });

  it("keeps the active memory state after an automatic batch save failure", async () => {
    const { adapter, vault, plugin } = createHarness();
    const existingContent = "Existing note content long enough for the text index.";
    const liveContent = "Live note content long enough for the automatic batch.";
    const existingFile = makeFile("Existing.md", existingContent, 100);
    const liveFile = makeFile("Live.md", liveContent, 200);
    vault.setMarkdownFiles([existingFile, liveFile]);
    vault.setContent(existingFile.path, existingContent);
    vault.setContent(liveFile.path, liveContent);
    await seedIndex(plugin, [{ file: existingFile, content: existingContent }]);
    plugin.indexedNotes = [noteFromFile(existingFile, existingContent)];
    plugin.indexedChunks = chunksForFile(existingFile, existingContent);
    plugin.textIndexLoaded = true;
    plugin.automaticUpdatesReady = true;
    adapter.setOptions({ simulateWriteError: true });

    (plugin.handleVaultEvent as (changeType: string, file: TFile) => void).call(plugin, "create", liveFile);
    await (plugin.flushPendingAutomaticUpdates as () => Promise<void>).call(plugin);

    expect((plugin.indexedNotes as IndexedNote[]).map((note) => note.path)).toEqual(["Existing.md"]);
    expect(await readPersistedPaths(plugin)).toEqual(["Existing.md"]);
    expect(plugin.automaticUpdateInProgress).toBe(false);
  });
});
