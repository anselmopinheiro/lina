/**
 * Mock for the 'obsidian' module so that vitest can resolve it at runtime.
 * The real obsidian module is types-only — it only provides TypeScript types,
 * not JavaScript runtime code.
 *
 * This mock provides the minimal runtime implementations needed by the
 * modules under test (indexStore.ts, etc.).
 */

// normalizePath: simple path normalizer used by indexStore and chunker
export function normalizePath(path: string): string {
  if (!path) return path;
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

// TFile class stub — only used for instanceof checks in createTextIndex
export class TFile {
  path: string;
  basename: string;
  extension: string;
  stat: { size: number; mtime: number };

  constructor(path: string, content?: string) {
    this.path = path;
    const parts = path.split("/").pop() ?? path;
    const dot = parts.lastIndexOf(".");
    this.basename = dot > 0 ? parts.substring(0, dot) : parts;
    this.extension = dot > 0 ? parts.substring(dot + 1) : "";
    this.stat = {
      size: content?.length ?? 0,
      mtime: Date.now(),
    };
  }
}

export class Vault {
  adapter: unknown;
  configDir: string;

  constructor() {
    this.configDir = ".obsidian";
  }

  getMarkdownFiles(): TFile[] {
    return [];
  }

  getAbstractFileByPath(_path: string): TFile | null {
    return null;
  }

  read(_file: TFile): Promise<string> {
    return Promise.resolve("");
  }
}

export class App {
  vault: Vault;

  constructor() {
    this.vault = new Vault();
  }
}

export class Notice {
  constructor(_message: string) {}
  // No-op
}