/**
 * In-memory fake adapter that mimics the Obsidian DataAdapter interface
 * used by indexStore for reading/writing index files.
 *
 * Does not touch the real filesystem.
 * Supports error simulation, operation counting, and race-condition scenarios.
 */

export type FileEntry = { type: "file"; size: number; mtime: number; content: string };

export interface FakeAdapterOptions {
  /** If true, read operations throw an error */
  simulateReadError?: boolean;
  /** If true, write operations throw an error */
  simulateWriteError?: boolean;
  /** If true, stat returns null for every path */
  simulateMissingAll?: boolean;
  /** Delay in ms before each operation resolves (default 0) */
  operationDelayMs?: number;
}

export class FakeAdapter {
  private files: Map<string, FileEntry> = new Map();
  private folders: Set<string> = new Set();
  private options: FakeAdapterOptions = {};

  // Operation call counters for verification
  public statCount = 0;
  public readCount = 0;
  public writeCount = 0;
  public mkdirCount = 0;
  public existsCount = 0;
  public removeCount = 0;
  public renameCount = 0;

  // Track temp/backup files written for verifying atomicity
  public writtenPaths: string[] = [];
  public removedPaths: string[] = [];
  public renamedFrom: string[] = [];
  public renamedTo: string[] = [];

  constructor(initialFiles?: Record<string, string>, options?: FakeAdapterOptions) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(this.normalizePath(path), {
          type: "file",
          size: content.length,
          mtime: Date.now(),
          content,
        });
      }
    }
    if (options) {
      this.options = options;
    }
    // Ensure .lina/ and .lina/index/ exist as folders by default
    this.folders.add(".lina");
    this.folders.add(".lina/index");
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/");
  }

  private delay(): Promise<void> {
    const delayMs = this.options.operationDelayMs ?? 0;
    if (delayMs > 0) {
      return new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return Promise.resolve();
  }

  private failRead(): boolean {
    return this.options.simulateReadError ?? false;
  }

  private failWrite(): boolean {
    return this.options.simulateWriteError ?? false;
  }

  setOptions(options: Partial<FakeAdapterOptions>): void {
    Object.assign(this.options, options);
  }

  /** Directly set file content (bypasses operation counting) */
  setFile(path: string, content: string): void {
    this.files.set(this.normalizePath(path), {
      type: "file",
      size: content.length,
      mtime: Date.now(),
      content,
    });
    // Ensure parent folders exist
    const parts = this.normalizePath(path).split("/");
    if (parts.length > 1) {
      let folder = parts[0];
      this.folders.add(folder);
      for (let i = 1; i < parts.length - 1; i++) {
        folder = `${folder}/${parts[i]}`;
        this.folders.add(folder);
      }
    }
  }

  /** Get raw file content for verification */
  getFile(path: string): string | undefined {
    return this.files.get(this.normalizePath(path))?.content;
  }

  /** Check if a path exists as a file */
  hasFile(path: string): boolean {
    return this.files.has(this.normalizePath(path));
  }

  /** Check if a path exists as a folder */
  hasFolder(path: string): boolean {
    return this.folders.has(this.normalizePath(path));
  }

  /** List all files currently stored */
  listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  /** List all temporary (.tmp-) files */
  listTempFiles(): string[] {
    return this.listFiles().filter((p) => p.includes(".tmp-"));
  }

  /** List all backup (.bak-) files */
  listBackupFiles(): string[] {
    return this.listFiles().filter((p) => p.includes(".bak-"));
  }

  /** Clear all stored data and reset counters */
  clear(): void {
    this.files.clear();
    this.folders.clear();
    this.folders.add(".lina");
    this.folders.add(".lina/index");
    this.resetCounters();
  }

  resetCounters(): void {
    this.statCount = 0;
    this.readCount = 0;
    this.writeCount = 0;
    this.mkdirCount = 0;
    this.existsCount = 0;
    this.removeCount = 0;
    this.renameCount = 0;
    this.writtenPaths = [];
    this.removedPaths = [];
    this.renamedFrom = [];
    this.renamedTo = [];
  }

  // ----- Obsidian DataAdapter-like interface -----

  async stat(path: string): Promise<{ type: string; size: number; mtime: number } | null> {
    this.statCount++;
    await this.delay();
    if (this.options.simulateMissingAll) return null;

    const normalized = this.normalizePath(path);
    if (this.files.has(normalized)) {
      const entry = this.files.get(normalized)!;
      return { type: "file", size: entry.size, mtime: entry.mtime };
    }
    if (this.folders.has(normalized)) {
      return { type: "folder", size: 0, mtime: 0 };
    }
    return null;
  }

  async read(path: string): Promise<string> {
    this.readCount++;
    await this.delay();
    if (this.failRead()) {
      throw new Error(`FakeAdapter: simulated read error for ${path}`);
    }

    const normalized = this.normalizePath(path);
    const entry = this.files.get(normalized);
    if (!entry) {
      throw new Error(`FakeAdapter: file not found: ${path}`);
    }
    return entry.content;
  }

  async write(path: string, content: string): Promise<void> {
    this.writeCount++;
    this.writtenPaths.push(this.normalizePath(path));
    await this.delay();
    if (this.failWrite()) {
      throw new Error(`FakeAdapter: simulated write error for ${path}`);
    }

    const normalized = this.normalizePath(path);
    this.files.set(normalized, {
      type: "file",
      size: content.length,
      mtime: Date.now(),
      content,
    });
  }

  async exists(path: string): Promise<boolean> {
    this.existsCount++;
    await this.delay();
    const normalized = this.normalizePath(path);
    return this.files.has(normalized) || this.folders.has(normalized);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCount++;
    await this.delay();
    this.folders.add(this.normalizePath(path));
  }

  async remove(path: string): Promise<void> {
    this.removeCount++;
    this.removedPaths.push(this.normalizePath(path));
    await this.delay();
    const normalized = this.normalizePath(path);
    this.files.delete(normalized);
    this.folders.delete(normalized);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.renameCount++;
    this.renamedFrom.push(this.normalizePath(oldPath));
    this.renamedTo.push(this.normalizePath(newPath));
    await this.delay();
    const normalizedOld = this.normalizePath(oldPath);
    const normalizedNew = this.normalizePath(newPath);

    if (this.files.has(normalizedOld)) {
      const entry = this.files.get(normalizedOld)!;
      this.files.delete(normalizedOld);
      this.files.set(normalizedNew, entry);
    } else if (this.folders.has(normalizedOld)) {
      this.folders.delete(normalizedOld);
      this.folders.add(normalizedNew);
    }
  }
}