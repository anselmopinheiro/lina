import { normalizePath } from "obsidian";

export type AutomaticUpdateChangeType = "create" | "modify" | "delete" | "rename";

export interface AutomaticUpdateEvent {
  changeType: AutomaticUpdateChangeType;
  path: string;
  oldPath?: string;
}

export interface AutomaticUpdatePathFilterOptions {
  configDir?: string;
  pluginId?: string;
}

export interface StartupReconciliationNoteState {
  path: string;
  size: number;
  mtime: number;
}

export interface StartupReconciliationPlan {
  events: AutomaticUpdateEvent[];
  newCount: number;
  modifiedCount: number;
  deletedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeAutomaticUpdatePath(path: unknown): string | null {
  if (typeof path !== "string") {
    return null;
  }

  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return normalizePath(trimmed).replace(/^\/+/, "");
}

export function getVaultEventPath(file: unknown): string | null {
  if (!isRecord(file)) {
    return null;
  }

  return normalizeAutomaticUpdatePath(file.path);
}

export function getVaultRenameOldPath(oldPath: unknown): string | undefined {
  return normalizeAutomaticUpdatePath(oldPath) ?? undefined;
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function isPathInPrefix(path: string, prefix: string): boolean {
  const normalizedPath = normalizeAutomaticUpdatePath(path)?.toLowerCase() ?? "";
  const normalizedPrefix = normalizeAutomaticUpdatePath(prefix)?.toLowerCase() ?? "";
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

export function getInternalAutomaticUpdateIgnoreReason(
  path: string,
  options: AutomaticUpdatePathFilterOptions
): string | null {
  const normalizedPath = normalizeAutomaticUpdatePath(path)?.toLowerCase();
  if (!normalizedPath) {
    return "missing-path";
  }

  if (
    normalizedPath.includes(".tmp-") ||
    normalizedPath.includes(".bak-") ||
    normalizedPath.endsWith(".tmp")
  ) {
    return "temporary-file";
  }

  const configDir = options.configDir || ".obsidian";
  const pluginId = options.pluginId;
  const internalPrefixes = [
    ".lina",
    ".obsidian",
    configDir,
    ...(pluginId ? [`${configDir}/plugins/${pluginId}`, `.obsidian/plugins/${pluginId}`] : []),
  ];

  if (internalPrefixes.some((prefix) => isPathInPrefix(normalizedPath, prefix))) {
    return "internal-path";
  }

  return null;
}

export function coalesceAutomaticUpdateEvent<TEvent extends AutomaticUpdateEvent>(
  pending: Map<string, TEvent>,
  next: TEvent
): void {
  const key = next.oldPath ?? next.path;
  const existing = pending.get(key);

  if (!existing) {
    pending.set(key, next);
    return;
  }

  if (existing.changeType === "create" && next.changeType === "modify") {
    pending.set(key, { ...next, changeType: "create" });
    return;
  }

  if (next.changeType === "delete") {
    pending.set(key, next);
    return;
  }

  if (next.changeType === "rename") {
    pending.set(key, {
      ...next,
      oldPath: existing.oldPath ?? existing.path,
    });
    return;
  }

  pending.set(key, next);
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function buildStartupReconciliationPlan(
  vaultNotes: StartupReconciliationNoteState[],
  indexedNotes: StartupReconciliationNoteState[]
): StartupReconciliationPlan {
  const vaultByPath = new Map(vaultNotes.map((note) => [note.path, note]));
  const indexedByPath = new Map(indexedNotes.map((note) => [note.path, note]));
  const newPaths: string[] = [];
  const modifiedPaths: string[] = [];
  const deletedPaths: string[] = [];

  for (const [path, vaultNote] of vaultByPath) {
    const indexedNote = indexedByPath.get(path);
    if (!indexedNote) {
      newPaths.push(path);
      continue;
    }

    if (indexedNote.mtime !== vaultNote.mtime || indexedNote.size !== vaultNote.size) {
      modifiedPaths.push(path);
    }
  }

  for (const path of indexedByPath.keys()) {
    if (!vaultByPath.has(path)) {
      deletedPaths.push(path);
    }
  }

  newPaths.sort(comparePaths);
  modifiedPaths.sort(comparePaths);
  deletedPaths.sort(comparePaths);

  return {
    events: [
      ...deletedPaths.map((path): AutomaticUpdateEvent => ({ changeType: "delete", path })),
      ...newPaths.map((path): AutomaticUpdateEvent => ({ changeType: "create", path })),
      ...modifiedPaths.map((path): AutomaticUpdateEvent => ({ changeType: "modify", path })),
    ],
    newCount: newPaths.length,
    modifiedCount: modifiedPaths.length,
    deletedCount: deletedPaths.length,
  };
}
