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
  readPaths: string[] = [];
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
    this.readPaths.push(file.path);
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
  plugin.exclusionPolicyReconciliationPromise = Promise.resolve();
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

async function readPersistedChunkPaths(plugin: TestableLinaPlugin): Promise<string[]> {
  const chunks = await readIndexedChunks(plugin.app as never);
  expect(chunks).not.toBeNull();
  return chunks!.map((chunk) => chunk.path).sort();
}

function debugEntries(message: string): Array<Record<string, unknown>> {
  return (console.debug as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((call) => call[1])
    .filter((entry): entry is Record<string, unknown> => {
      return typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).message === message;
    });
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

  it("loads a synchronized text index without local legacy indexData or a rebuild", async () => {
    const { adapter, vault, plugin } = createHarness();
    const content = "Synchronized note content that is available to text search on another device.";
    const file = makeFile("Synced.md", content, 100);
    vault.setMarkdownFiles([file]);
    vault.setContent(file.path, content);
    await seedIndex(plugin, [{ file, content }]);
    adapter.resetCounters();
    plugin.indexData = undefined;

    const status = await (plugin.getTextIndexStatus as () => Promise<{ usability: string; isUsable: boolean }>).call(plugin);
    const loaded = await (plugin.ensureTextIndexLoaded as (reason: string) => Promise<boolean>).call(plugin, "text-search");

    expect(status).toMatchObject({ usability: "ready", isUsable: true });
    expect(loaded).toBe(true);
    expect(plugin.indexedNotes.map((note: IndexedNote) => note.path)).toEqual(["Synced.md"]);
    expect(adapter.writeCount).toBe(0);
  });

  it("does not create a local legacy index on a consumer with updates disabled", async () => {
    const { adapter, vault, plugin } = createHarness();
    const content = "A valid synchronized index remains a consumer-side read-only publication.";
    const file = makeFile("Mobile.md", content, 100);
    vault.setMarkdownFiles([file]);
    vault.setContent(file.path, content);
    await seedIndex(plugin, [{ file, content }]);
    adapter.resetCounters();
    plugin.indexData = undefined;
    plugin.settings.updateIndexOnStartup = false;
    plugin.settings.checkSyncOnStartup = false;

    await (plugin.runStartupIndexAutomation as () => Promise<void>).call(plugin);

    expect((await (plugin.getTextIndexStatus as () => Promise<{ usability: string }>).call(plugin)).usability).toBe("ready");
    expect(adapter.writeCount).toBe(0);
    expect(plugin.indexData).toBeUndefined();
  });

  it("removes newly excluded folder entries and their chunks without a vault restart", async () => {
    const { vault, plugin } = createHarness();
    const privateContent = "Private note content that must leave the text index immediately.";
    const publicContent = "Public note content that must remain searchable.";
    const privateFile = makeFile("Private/Note.md", privateContent, 100);
    const publicFile = makeFile("Public/Note.md", publicContent, 100);
    vault.setMarkdownFiles([privateFile, publicFile]);
    vault.setContent(privateFile.path, privateContent);
    vault.setContent(publicFile.path, publicContent);
    await seedIndex(plugin, [{ file: privateFile, content: privateContent }, { file: publicFile, content: publicContent }]);

    plugin.settings.indexExcludedFolders = "Private/";
    await plugin.reconcileIndexExclusionsAfterSettingsChange();

    expect(await readPersistedPaths(plugin)).toEqual(["Public/Note.md"]);
    expect((await readIndexedChunks(plugin.app as never))?.map((chunk) => chunk.path)).toEqual(["Public/Note.md"]);
    expect(plugin.isIndexPathExcludedByUserRules("Private/Note.md")).toBe(true);
  });

  it("indexes notes made eligible by removing a folder exclusion without a rebuild", async () => {
    const { vault, plugin } = createHarness();
    const content = "Previously excluded note content that is eligible again.";
    const file = makeFile("Private/Note.md", content, 100);
    const existingContent = "An already indexed note keeps the text index ready.";
    const existingFile = makeFile("Public/Existing.md", existingContent, 100);
    vault.setMarkdownFiles([file, existingFile]);
    vault.setContent(file.path, content);
    vault.setContent(existingFile.path, existingContent);
    plugin.settings.indexExcludedFolders = "Private/";
    await seedIndex(plugin, [{ file: existingFile, content: existingContent }]);

    plugin.settings.indexExcludedFolders = "";
    await plugin.reconcileIndexExclusionsAfterSettingsChange();

    expect(await readPersistedPaths(plugin)).toEqual(["Private/Note.md", "Public/Existing.md"]);
    expect((await readIndexedChunks(plugin.app as never))?.map((chunk) => chunk.path).sort()).toEqual([
      "Private/Note.md",
      "Public/Existing.md",
    ]);
  });

  it("applies repeated exclusion changes using the latest saved policy", async () => {
    const { vault, plugin } = createHarness();
    const content = "A note that moves between eligible and excluded policies.";
    const file = makeFile("FolderA/Note.md", content, 100);
    vault.setMarkdownFiles([file]);
    vault.setContent(file.path, content);
    await seedIndex(plugin, [{ file, content }]);

    plugin.settings.indexExcludedFolders = "FolderA/";
    await plugin.reconcileIndexExclusionsAfterSettingsChange();
    expect(await readPersistedPaths(plugin)).toEqual([]);

    plugin.settings.indexExcludedFolders = "";
    await plugin.reconcileIndexExclusionsAfterSettingsChange();
    expect(await readPersistedPaths(plugin)).toEqual(["FolderA/Note.md"]);

    plugin.settings.indexExcludedFolders = "FolderA/";
    await plugin.reconcileIndexExclusionsAfterSettingsChange();
    expect(await readPersistedPaths(plugin)).toEqual([]);
  });

  it("keeps the latest exclusion policy when reconciliation requests arrive rapidly", async () => {
    const { vault, plugin } = createHarness();
    const content = "A note used to verify latest-policy-wins reconciliation.";
    const file = makeFile("FolderA/Note.md", content, 100);
    vault.setMarkdownFiles([file]);
    vault.setContent(file.path, content);
    await seedIndex(plugin, [{ file, content }]);

    plugin.settings.indexExcludedFolders = "FolderA/";
    const first = plugin.reconcileIndexExclusionsAfterSettingsChange();
    plugin.settings.indexExcludedFolders = "";
    const second = plugin.reconcileIndexExclusionsAfterSettingsChange();
    plugin.settings.indexExcludedFolders = "FolderA/";
    const third = plugin.reconcileIndexExclusionsAfterSettingsChange();
    await Promise.all([first, second, third]);

    expect(await readPersistedPaths(plugin)).toEqual([]);
  });

  it("reconciles path and content exclusion policy changes through the same runtime path", async () => {
    const { vault, plugin } = createHarness();
    const pathContent = "This indexed note is removed by a path term.";
    const contentRuleContent = "This indexed note contains confidential content.";
    const pathFile = makeFile("Secrets/Note.md", pathContent, 100);
    const contentFile = makeFile("Public/Confidential.md", contentRuleContent, 100);
    vault.setMarkdownFiles([pathFile, contentFile]);
    vault.setContent(pathFile.path, pathContent);
    vault.setContent(contentFile.path, contentRuleContent);
    await seedIndex(plugin, [{ file: pathFile, content: pathContent }, { file: contentFile, content: contentRuleContent }]);

    plugin.settings.indexExcludedPathContains = "secrets";
    await plugin.reconcileIndexExclusionsAfterSettingsChange();
    expect(await readPersistedPaths(plugin)).toEqual(["Public/Confidential.md"]);

    plugin.settings.indexExcludedContentContains = "confidential";
    await plugin.reconcileIndexExclusionsAfterSettingsChange();
    expect(await readPersistedPaths(plugin)).toEqual([]);
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

  it("does not queue a new startup candidate excluded by content rules", async () => {
    const { adapter, vault, plugin } = createHarness();
    plugin.settings.indexExcludedContentContains = "secret";
    plugin.settings.debugIndexUpdates = true;
    const existingContent = "Existing note content long enough for the text index.";
    const excludedContent = "This note contains a secret and must not be indexed.";
    const existingFile = makeFile("Existing.md", existingContent, 100);
    const excludedFile = makeFile("Excluded.md", excludedContent, 200);
    vault.setMarkdownFiles([existingFile, excludedFile]);
    vault.setContent(existingFile.path, existingContent);
    vault.setContent(excludedFile.path, excludedContent);
    await seedIndex(plugin, [{ file: existingFile, content: existingContent }]);
    adapter.resetCounters();

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual(["Existing.md"]);
    expect(adapter.writeCount).toBe(0);
    expect(vault.readPaths).toEqual(["Excluded.md"]);
    const queueLog = debugEntries("Startup reconciliation queue prepared").at(-1);
    expect(queueLog).toMatchObject({
      queueSize: 0,
      skippedCandidateCount: 1,
      skippedReasonCounts: { "content-excluded": 1 },
      omittedSkippedCandidates: 0,
    });
  });

  it("does not run a recurring no-op batch for a startup candidate excluded by content", async () => {
    const { adapter, vault, plugin } = createHarness();
    plugin.settings.indexExcludedContentContains = "secret";
    const existingContent = "Existing note content long enough for the text index.";
    const excludedContent = "This note contains a secret and must not be indexed.";
    const existingFile = makeFile("Existing.md", existingContent, 100);
    const excludedFile = makeFile("Excluded.md", excludedContent, 200);
    vault.setMarkdownFiles([existingFile, excludedFile]);
    vault.setContent(existingFile.path, existingContent);
    vault.setContent(excludedFile.path, excludedContent);
    await seedIndex(plugin, [{ file: existingFile, content: existingContent }]);

    adapter.resetCounters();
    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);
    expect(adapter.writeCount).toBe(0);
    expect(debugEntries("Batch started")).toHaveLength(0);

    adapter.resetCounters();
    vault.readPaths = [];
    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual(["Existing.md"]);
    expect(adapter.writeCount).toBe(0);
    expect(vault.readPaths).toEqual(["Excluded.md"]);
    expect(debugEntries("Batch started")).toHaveLength(0);
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

  it("removes an indexed note modified offline into content excluded by user rules", async () => {
    const { vault, plugin } = createHarness();
    plugin.settings.indexExcludedContentContains = "secret";
    const oldContent = "Visible note content long enough for the text index.";
    const excludedContent = "This modified note now contains a secret.";
    const indexedFile = makeFile("Changed.md", oldContent, 100);
    const vaultFile = makeFile("Changed.md", excludedContent, 200);
    vault.setMarkdownFiles([vaultFile]);
    vault.setContent(vaultFile.path, excludedContent);
    await seedIndex(plugin, [{ file: indexedFile, content: oldContent }]);

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual([]);
    expect((plugin.indexedNotes as IndexedNote[]).map((note) => note.path)).toEqual([]);
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

  it("processes create, modify, delete and offline rename without losing startup events", async () => {
    const { vault, plugin } = createHarness();
    const unchangedContent = "Unchanged note content long enough for the text index.";
    const oldModifiedContent = "Old modified note content long enough for the text index.";
    const newModifiedContent = "New modified note content long enough for the text index.";
    const deletedContent = "Deleted note content long enough for the text index.";
    const renamedContent = "Renamed note content long enough for the text index.";
    const createdContent = "Created note content long enough for the text index.";
    const unchangedFile = makeFile("Unchanged.md", unchangedContent, 100);
    const indexedModifiedFile = makeFile("Modified.md", oldModifiedContent, 100);
    const vaultModifiedFile = makeFile("Modified.md", newModifiedContent, 200);
    const deletedFile = makeFile("Deleted.md", deletedContent, 100);
    const oldRenamedFile = makeFile("Old name.md", renamedContent, 100);
    const newRenamedFile = makeFile("New name.md", renamedContent, 100);
    const createdFile = makeFile("Created.md", createdContent, 300);
    vault.setMarkdownFiles([unchangedFile, vaultModifiedFile, newRenamedFile, createdFile]);
    for (const [file, content] of [
      [unchangedFile, unchangedContent],
      [vaultModifiedFile, newModifiedContent],
      [newRenamedFile, renamedContent],
      [createdFile, createdContent],
    ] as Array<[TFile, string]>) {
      vault.setContent(file.path, content);
    }
    await seedIndex(plugin, [
      { file: unchangedFile, content: unchangedContent },
      { file: indexedModifiedFile, content: oldModifiedContent },
      { file: deletedFile, content: deletedContent },
      { file: oldRenamedFile, content: renamedContent },
    ]);

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual([
      "Created.md",
      "Modified.md",
      "New name.md",
      "Unchanged.md",
    ]);
    const notes = await readIndexedNotes(plugin.app as never);
    expect(notes?.find((note) => note.path === "Modified.md")?.contentHash).toBe(hashContent(newModifiedContent));
  });

  it("logs startup queue event counts and included paths for small batches", async () => {
    const { vault, plugin } = createHarness();
    plugin.settings.debugIndexUpdates = true;
    const modifiedOldContent = "Old modified note content long enough for the text index.";
    const modifiedNewContent = "New modified note content long enough for the text index.";
    const deletedContent = "Deleted note content long enough for the text index.";
    const newContent = "New note content long enough for the text index.";
    const modifiedIndexedFile = makeFile("Modified.md", modifiedOldContent, 100);
    const modifiedVaultFile = makeFile("Modified.md", modifiedNewContent, 200);
    const deletedFile = makeFile("Deleted.md", deletedContent, 100);
    const newFile = makeFile("New.md", newContent, 300);
    vault.setMarkdownFiles([modifiedVaultFile, newFile]);
    vault.setContent(modifiedVaultFile.path, modifiedNewContent);
    vault.setContent(newFile.path, newContent);
    await seedIndex(plugin, [
      { file: modifiedIndexedFile, content: modifiedOldContent },
      { file: deletedFile, content: deletedContent },
    ]);

    await (plugin.completeAutomaticUpdatesStartup as () => Promise<void>).call(plugin);

    const queueLog = debugEntries("Startup reconciliation queue prepared").at(-1);
    expect(queueLog).toMatchObject({
      queueSize: 3,
      eventCounts: { create: 1, modify: 1, delete: 1, rename: 0 },
      omittedPaths: 0,
    });
    expect(queueLog?.paths).toEqual(["Deleted.md", "New.md", "Modified.md"]);
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

  it("publishes a rename as one replacement without old notes or chunks", async () => {
    const { vault, plugin } = createHarness();
    const content = "Renamed content remains the same but its path identity must be replaced.";
    const oldFile = makeFile("Folder/Old.md", content, 100);
    const newFile = makeFile("Folder/New.md", content, 200);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, content);
    await seedIndex(plugin, [{ file: oldFile, content }]);

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "rename",
      file: newFile,
      path: newFile.path,
      oldPath: oldFile.path,
      receivedAt: "2026-08-14T00:00:00.000Z",
    }]);

    expect(await readPersistedPaths(plugin)).toEqual(["Folder/New.md"]);
    expect(await readPersistedChunkPaths(plugin)).toEqual(["Folder/New.md"]);
    expect((plugin.indexedChunks as Chunk[]).every((chunk) => chunk.chunkId.startsWith("Folder/New.md::"))).toBe(true);
    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({ status: "dirty", reason: "text-index-published" });
  });

  it("moves an indexed note between folders without leaving a duplicate", async () => {
    const { vault, plugin } = createHarness();
    const content = "Moving between folders is the same atomic path transition as renaming.";
    const oldFile = makeFile("FolderA/Note.md", content, 100);
    const newFile = makeFile("FolderB/Note.md", content, 200);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, content);
    await seedIndex(plugin, [{ file: oldFile, content }]);

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "rename",
      file: newFile,
      path: newFile.path,
      oldPath: oldFile.path,
      receivedAt: "2026-08-14T00:00:00.000Z",
    }]);

    expect(await readPersistedPaths(plugin)).toEqual(["FolderB/Note.md"]);
    expect(await readPersistedChunkPaths(plugin)).toEqual(["FolderB/Note.md"]);
  });

  it("removes the old publication when a move enters an excluded folder", async () => {
    const { vault, plugin } = createHarness();
    const content = "The moved note must not remain searchable after entering an excluded folder.";
    const oldFile = makeFile("Included/Note.md", content, 100);
    const newFile = makeFile("Excluded/Note.md", content, 200);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, content);
    await seedIndex(plugin, [{ file: oldFile, content }]);
    plugin.settings.indexExcludedFolders = "Excluded";
    plugin.automaticUpdatesReady = true;

    (plugin.handleVaultEvent as (changeType: string, file: TFile, oldPath: string) => void)
      .call(plugin, "rename", newFile, oldFile.path);
    await (plugin.flushPendingAutomaticUpdates as () => Promise<void>).call(plugin);

    expect(await readPersistedPaths(plugin)).toEqual([]);
    expect(await readPersistedChunkPaths(plugin)).toEqual([]);
  });

  it("indexes the destination when a move leaves an excluded folder", async () => {
    const { vault, plugin } = createHarness();
    const content = "The destination becomes eligible immediately after the move.";
    const oldFile = makeFile("Excluded/Note.md", content, 100);
    const newFile = makeFile("Included/Note.md", content, 200);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, content);
    await seedIndex(plugin, [{ file: oldFile, content }]);
    plugin.settings.indexExcludedFolders = "Excluded";

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "rename",
      file: newFile,
      path: newFile.path,
      oldPath: oldFile.path,
      receivedAt: "2026-08-14T00:00:00.000Z",
    }]);

    expect(await readPersistedPaths(plugin)).toEqual(["Included/Note.md"]);
    expect(await readPersistedChunkPaths(plugin)).toEqual(["Included/Note.md"]);
  });

  it("removes the old publication when a rename matches an excluded path term", async () => {
    const { vault, plugin } = createHarness();
    const content = "The new name must be rejected by the current path-term policy.";
    const oldFile = makeFile("Included/Note.md", content, 100);
    const newFile = makeFile("Included/private-note.md", content, 200);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, content);
    await seedIndex(plugin, [{ file: oldFile, content }]);
    plugin.settings.indexExcludedPathContains = "private";

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "rename",
      file: newFile,
      path: newFile.path,
      oldPath: oldFile.path,
      receivedAt: "2026-08-14T00:00:00.000Z",
    }]);

    expect(await readPersistedPaths(plugin)).toEqual([]);
    expect(await readPersistedChunkPaths(plugin)).toEqual([]);
  });

  it("removes the old publication when renamed content matches an exclusion rule", async () => {
    const { vault, plugin } = createHarness();
    const oldContent = "The previously indexed content is allowed.";
    const excludedContent = "This renamed content contains the private marker.";
    const oldFile = makeFile("Included/Note.md", oldContent, 100);
    const newFile = makeFile("Included/Renamed.md", excludedContent, 200);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, excludedContent);
    await seedIndex(plugin, [{ file: oldFile, content: oldContent }]);
    plugin.settings.indexExcludedContentContains = "private marker";

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "rename",
      file: newFile,
      path: newFile.path,
      oldPath: oldFile.path,
      receivedAt: "2026-08-14T00:00:00.000Z",
    }]);

    expect(await readPersistedPaths(plugin)).toEqual([]);
    expect(await readPersistedChunkPaths(plugin)).toEqual([]);
  });

  it("uses the final destination for rapid rename chains", async () => {
    const { vault, plugin } = createHarness();
    const content = "Rapid rename chains must end at the latest vault path.";
    const fileA = makeFile("A.md", content, 100);
    const fileB = makeFile("B.md", content, 200);
    const fileC = makeFile("C.md", content, 300);
    vault.setMarkdownFiles([fileC]);
    vault.setContent(fileB.path, content);
    vault.setContent(fileC.path, content);
    await seedIndex(plugin, [{ file: fileA, content }]);

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [
      { changeType: "rename", file: fileB, path: fileB.path, oldPath: fileA.path, receivedAt: "2026-08-14T00:00:00.000Z" },
      { changeType: "rename", file: fileC, path: fileC.path, oldPath: fileB.path, receivedAt: "2026-08-14T00:00:01.000Z" },
    ]);

    expect(await readPersistedPaths(plugin)).toEqual(["C.md"]);
    expect(await readPersistedChunkPaths(plugin)).toEqual(["C.md"]);
  });

  it("keeps the final content when a rename is followed by a modify", async () => {
    const { vault, plugin } = createHarness();
    const oldContent = "Original content before a rename and a subsequent final modification.";
    const finalContent = "Final content after the rename must win over the old publication.";
    const oldFile = makeFile("Old.md", oldContent, 100);
    const newFile = makeFile("New.md", finalContent, 300);
    vault.setMarkdownFiles([newFile]);
    vault.setContent(newFile.path, finalContent);
    await seedIndex(plugin, [{ file: oldFile, content: oldContent }]);

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [
      { changeType: "rename", file: newFile, path: newFile.path, oldPath: oldFile.path, receivedAt: "2026-08-14T00:00:00.000Z" },
      { changeType: "modify", file: newFile, path: newFile.path, receivedAt: "2026-08-14T00:00:01.000Z" },
    ]);

    const notes = await readIndexedNotes(plugin.app as never);
    expect(notes).toHaveLength(1);
    expect(notes?.[0]?.path).toBe("New.md");
    expect(notes?.[0]?.contentHash).toBe(hashContent(finalContent));
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

  it("logs no-op batch reasons with event counts and paths", async () => {
    const { vault, plugin } = createHarness();
    plugin.settings.debugIndexUpdates = true;
    const content = "Existing note content long enough for the text index.";
    const file = makeFile("Existing.md", content, 100);
    vault.setMarkdownFiles([file]);
    vault.setContent(file.path, content);
    await seedIndex(plugin, [{ file, content }]);
    plugin.indexedNotes = [noteFromFile(file, content)];
    plugin.indexedChunks = chunksForFile(file, content);
    plugin.textIndexLoaded = true;

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "modify",
      file,
      path: file.path,
      receivedAt: "2026-07-12T00:00:00.000Z",
    }]);

    const noChangeLog = debugEntries("automatic batch completed without changes").at(-1);
    expect(noChangeLog).toMatchObject({
      batchSize: 1,
      eventCounts: { create: 0, modify: 1, delete: 0, rename: 0 },
      paths: ["Existing.md"],
      omittedPaths: 0,
      skippedReasonCounts: { "content-unchanged": 1 },
    });
  });

  it("marks embedding work dirty after a successful automatic text index publication", async () => {
    const { vault, plugin } = createHarness();
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

    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({ status: "unknown", revision: 0 });

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "create",
      file: liveFile,
      path: liveFile.path,
      receivedAt: "2026-07-12T00:00:00.000Z",
    }]);

    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({
      status: "dirty",
      revision: 1,
      reason: "text-index-published",
    });
  });

  it("does not mark embedding work dirty after a failed automatic text index save", async () => {
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
    adapter.setOptions({ simulateWriteError: true });

    await (plugin.processAutomaticIndexUpdateBatch as (updates: unknown[]) => Promise<void>).call(plugin, [{
      changeType: "create",
      file: liveFile,
      path: liveFile.path,
      receivedAt: "2026-07-12T00:00:00.000Z",
    }]);

    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({
      status: "unknown",
      revision: 0,
    });
  });

  it("marks embedding work dirty with startup-reconciled reason after startup reconciliation publishes changes", async () => {
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

    expect(plugin.getEmbeddingWorkStatus()).toMatchObject({
      status: "dirty",
      revision: 1,
      reason: "startup-reconciled",
    });
  });
});
