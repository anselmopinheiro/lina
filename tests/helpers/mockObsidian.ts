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

export class TFolder {
  path: string;
  name: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
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

export class Plugin {
  app: App;
  manifest: { id: string };

  constructor(app?: App, manifest?: { id?: string }) {
    this.app = app ?? new App();
    this.manifest = { id: manifest?.id ?? "lina" };
  }

  addCommand(_command: unknown): void {}
  addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {}
  addSettingTab(_tab: unknown): void {}
  registerEvent(_eventRef: unknown): void {}
  registerView(_type: string, _creator: unknown): void {}
  loadData(): Promise<unknown> {
    return Promise.resolve(undefined);
  }
  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: { empty: () => void };

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = { empty: () => {} };
  }

  display(): void {}
}

export class Setting {
  constructor(_containerEl?: unknown) {}
  setName(_name: string): this { return this; }
  setDesc(_desc: string): this { return this; }
  addText(_callback: (component: unknown) => void): this { return this; }
  addTextArea(_callback: (component: unknown) => void): this { return this; }
  addDropdown(_callback: (component: unknown) => void): this { return this; }
  addToggle(_callback: (component: unknown) => void): this { return this; }
  addButton(_callback: (component: unknown) => void): this { return this; }
  addSlider(_callback: (component: unknown) => void): this { return this; }
}

export class Modal {
  app: App;
  contentEl: { empty: () => void };

  constructor(app: App) {
    this.app = app;
    this.contentEl = { empty: () => {} };
  }

  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class WorkspaceLeaf {}

export class ItemView {
  app: App;
  leaf: WorkspaceLeaf;
  containerEl: { children: unknown[] };

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = new App();
    this.containerEl = { children: [] };
  }

  getViewType(): string { return ""; }
  getDisplayText(): string { return ""; }
  onOpen(): Promise<void> { return Promise.resolve(); }
  onClose(): Promise<void> { return Promise.resolve(); }
}

export class MarkdownView {}

export class Notice {
  constructor(_message: string) {}
  // No-op
}

export async function requestUrl(_request: unknown): Promise<unknown> {
  return {};
}
