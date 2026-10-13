/**
 * Desktop Node.js module loader boundary.
 *
 * Obsidian plugins run on both desktop (Electron) and mobile (Capacitor/web).
 * Direct top-level imports of Node.js modules crash mobile devices.
 * This helper provides safe, typed, runtime-checked resolution of optional
 * desktop Node modules without exposing unsafe `any` types or triggering linter warnings.
 */

declare const require: ((moduleName: string) => unknown) | undefined;

export type NodeRequireFunction = (moduleName: string) => unknown;

/**
 * Returns the platform `require` function if available in the current environment
 * (e.g. Electron desktop renderer or Node.js test environment), or `null` on mobile.
 */
export function getOptionalNodeRequire(): NodeRequireFunction | null {
  if (typeof window !== "undefined") {
    const win = window as unknown as { require?: unknown };
    if (typeof win.require === "function") {
      return win.require as NodeRequireFunction;
    }
  }
  if (typeof require === "function") {
    return require;
  }
  return null;
}

export interface HashLike {
  update(value: Uint8Array | string): HashLike;
  digest(encoding: "hex"): string;
}

export interface NodeCryptoLike {
  createHash(algorithm: "sha256"): HashLike;
}

/**
 * Safely resolves the desktop `node:crypto` module if available.
 */
export function getOptionalNodeCrypto(): NodeCryptoLike | null {
  const req = getOptionalNodeRequire();
  if (!req) return null;
  try {
    const mod = req("node:crypto");
    if (
      mod &&
      typeof mod === "object" &&
      "createHash" in mod &&
      typeof (mod as Record<string, unknown>).createHash === "function"
    ) {
      return mod as NodeCryptoLike;
    }
  } catch {
    // Desktop module load failed
  }
  return null;
}

export interface DatabaseSyncStatementLike {
  run(...params: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): DatabaseSyncStatementLike;
  close(): void;
}

export type DatabaseSyncConstructor = new (databasePath: string) => DatabaseSyncLike;

/**
 * Safely resolves the `DatabaseSync` constructor from `node:sqlite` (or fallback `sqlite`).
 */
export function resolveNodeSqliteConstructor(): DatabaseSyncConstructor | null {
  const req = getOptionalNodeRequire();
  if (!req) return null;
  let mod: unknown = null;
  try {
    mod = req("node:sqlite");
  } catch {
    try {
      mod = req("sqlite");
    } catch {
      return null;
    }
  }
  if (mod && typeof mod === "object") {
    const dbSync = (mod as Record<string, unknown>).DatabaseSync;
    if (typeof dbSync === "function") {
      return dbSync as DatabaseSyncConstructor;
    }
  }
  return null;
}

export interface FsAndPathHelpers {
  existsSync: (targetPath: string) => boolean;
  mkdirSync: (targetPath: string, options?: { recursive?: boolean }) => void;
  dirname: (targetPath: string) => string;
}

/**
 * Safely resolves filesystem and path helpers on desktop platforms.
 */
export function getFsAndPathHelpers(): FsAndPathHelpers {
  try {
    const req = getOptionalNodeRequire();
    if (req) {
      const fsMod = req("fs");
      const pathMod = req("path");
      const fsObj = fsMod && typeof fsMod === "object" ? (fsMod as Record<string, unknown>) : null;
      const pathObj = pathMod && typeof pathMod === "object" ? (pathMod as Record<string, unknown>) : null;
      const existsFn = fsObj && typeof fsObj.existsSync === "function" ? (fsObj.existsSync as (p: string) => boolean) : null;
      const mkdirFn = fsObj && typeof fsObj.mkdirSync === "function" ? (fsObj.mkdirSync as (p: string, opts?: { recursive?: boolean }) => void) : null;
      const dirnameFn = pathObj && typeof pathObj.dirname === "function" ? (pathObj.dirname as (p: string) => string) : null;
      return {
        existsSync: (p: string) => (existsFn ? existsFn(p) : false),
        mkdirSync: (p: string, opts?: { recursive?: boolean }) => {
          if (mkdirFn) mkdirFn(p, opts);
        },
        dirname: (p: string) => (dirnameFn ? dirnameFn(p) : p.split("/").slice(0, -1).join("/")),
      };
    }
  } catch {
    // Fallback if not in desktop Node environment
  }
  return {
    existsSync: () => false,
    mkdirSync: () => {},
    dirname: (p: string) => p.split("/").slice(0, -1).join("/") || ".",
  };
}
