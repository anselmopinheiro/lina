/**
 * Producer Local Store Path Resolver (Phase M0)
 *
 * Implements deterministic, cross-platform path resolution and strict vault boundary
 * validation for the Producer's private local SQLite storage outside the Obsidian Vault.
 *
 * Invariants:
 * 1. Read/Resolve Only: Does not create directories or open database files during resolution.
 * 2. Cross-Platform: Handles Windows, macOS, and Linux OS conventions with injected environment support.
 * 3. Strict Vault Separation: Rejects or flags paths residing inside the Vault hierarchy.
 * 4. Obsidian Linter Conformance: Pure TypeScript implementation without top-level Node.js module imports.
 */

import {
  PRODUCER_STORE_DEFAULT_DB_NAME,
  type ProducerLocalStorePathResolution,
  type ProducerLocalStorePathResolver,
  type VaultPathSeparationResult,
} from "./producerLocalStoreTypes";

export type SupportedStorePlatform = "win32" | "darwin" | "linux" | "other";

export interface PathEnvironmentContext {
  readonly platform?: SupportedStorePlatform;
  readonly env?: Record<string, string | undefined>;
  readonly homedir?: string;
}

interface RuntimeProcessRef {
  readonly platform?: string;
  readonly env?: Record<string, string | undefined>;
}

function getRuntimeProcess(): RuntimeProcessRef | undefined {
  if (typeof window !== "undefined") {
    const win = window as unknown as { process?: RuntimeProcessRef };
    if (win.process && typeof win.process === "object") {
      return win.process;
    }
  }
  return undefined;
}

function getRuntimePlatform(): SupportedStorePlatform {
  const proc = getRuntimeProcess();
  const plat = proc?.platform;
  if (plat === "win32" || plat === "darwin" || plat === "linux") {
    return plat;
  }
  return "other";
}

function getRuntimeEnv(): Record<string, string | undefined> {
  const proc = getRuntimeProcess();
  return proc?.env ?? {};
}

function getRuntimeHomedir(): string {
  const env = getRuntimeEnv();
  const platform = getRuntimePlatform();
  if (platform === "win32") {
    if (env.USERPROFILE) return env.USERPROFILE;
    if (env.HOMEDRIVE && env.HOMEPATH) return `${env.HOMEDRIVE}${env.HOMEPATH}`;
  }
  return env.HOME ?? "";
}

/**
 * Normalizes slashes and resolves relative segments (`.` and `..`) purely.
 */
export function canonicalizePath(rawPath: string): string {
  if (!rawPath || rawPath.trim().length === 0) {
    return "";
  }

  let normalized = rawPath.trim().replace(/\\/g, "/");

  // Preserve Windows drive prefix if present (e.g. "C:")
  let drivePrefix = "";
  const driveMatch = normalized.match(/^([a-zA-Z]:)(\/|$)/);
  if (driveMatch && driveMatch[1]) {
    drivePrefix = driveMatch[1].toUpperCase();
    normalized = normalized.slice(driveMatch[1].length);
  }

  const isAbsolute = normalized.startsWith("/");
  const segments = normalized.split("/").filter((s) => s.length > 0 && s !== ".");
  const resolvedSegments: string[] = [];

  for (const segment of segments) {
    if (segment === "..") {
      if (resolvedSegments.length > 0 && resolvedSegments[resolvedSegments.length - 1] !== "..") {
        resolvedSegments.pop();
      } else if (!isAbsolute && !drivePrefix) {
        resolvedSegments.push("..");
      }
    } else {
      resolvedSegments.push(segment);
    }
  }

  const joined = resolvedSegments.join("/");
  if (drivePrefix) {
    return joined.length > 0 ? `${drivePrefix}/${joined}` : `${drivePrefix}/`;
  }
  if (isAbsolute) {
    return `/${joined}`;
  }
  return joined.length > 0 ? joined : ".";
}

/**
 * Joins path segments using forward slashes.
 */
export function joinPaths(...parts: string[]): string {
  const filtered = parts.filter((p) => typeof p === "string" && p.trim().length > 0);
  if (filtered.length === 0) {
    return "";
  }
  const raw = filtered.join("/");
  return canonicalizePath(raw);
}

/**
 * Computes a relative path from source to target.
 */
export function computeRelativePath(fromPath: string, toPath: string): string {
  const from = canonicalizePath(fromPath).split("/").filter(Boolean);
  const to = canonicalizePath(toPath).split("/").filter(Boolean);

  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common++;
  }

  const up = from.length - common;
  const down = to.slice(common);
  const resultParts: string[] = [];

  for (let i = 0; i < up; i++) {
    resultParts.push("..");
  }
  resultParts.push(...down);

  return resultParts.length > 0 ? resultParts.join("/") : ".";
}

/**
 * Evaluates whether a target path resides inside (is a descendant of or identical to) the vault base path.
 * Respects platform-specific case-insensitivity on Windows and macOS.
 */
export function checkPathSeparationFromVault(
  vaultBasePath: string,
  targetPath: string,
  platform: SupportedStorePlatform = getRuntimePlatform()
): VaultPathSeparationResult {
  const canonicalVault = canonicalizePath(vaultBasePath);
  const canonicalTarget = canonicalizePath(targetPath);

  const isCaseInsensitive = platform === "win32" || platform === "darwin";
  const normVault = isCaseInsensitive ? canonicalVault.toLowerCase() : canonicalVault;
  const normTarget = isCaseInsensitive ? canonicalTarget.toLowerCase() : canonicalTarget;

  const isInside =
    normVault === normTarget ||
    normTarget.startsWith(`${normVault}/`);

  return {
    insideVault: isInside,
    canonicalVaultPath: canonicalVault,
    canonicalTargetPath: canonicalTarget,
    relativePath: computeRelativePath(canonicalVault, canonicalTarget),
  };
}

/**
 * Resolves the OS-standard default local storage directory for Lina private data.
 */
export function resolveDefaultStoreDirectory(context?: PathEnvironmentContext): string {
  const platform = context?.platform ?? getRuntimePlatform();
  const env = context?.env ?? getRuntimeEnv();
  const homedir = context?.homedir ?? getRuntimeHomedir();

  if (platform === "win32") {
    // LOCALAPPDATA (non-roaming): %APPDATA% is the Roaming profile, which can be
    // synchronized across machines and would violate "DB/WAL/SHM never synchronized".
    const localAppData = env.LOCALAPPDATA || (homedir ? joinPaths(homedir, "AppData/Local") : "");
    if (localAppData) {
      return joinPaths(localAppData, "lina/db");
    }
  } else if (platform === "darwin") {
    if (homedir) {
      return joinPaths(homedir, "Library/Application Support/lina/db");
    }
  } else {
    // Linux / BSD / Unix standard (XDG State Home)
    const xdgState = env.XDG_STATE_HOME;
    if (xdgState) {
      return joinPaths(xdgState, "lina/db");
    }
    if (homedir) {
      return joinPaths(homedir, ".local/state/lina/db");
    }
  }

  // Fallback
  return homedir ? joinPaths(homedir, ".lina/db") : canonicalizePath(".lina-local/db");
}

/**
 * Default implementation of `ProducerLocalStorePathResolver`.
 */
export class DefaultProducerLocalStorePathResolver implements ProducerLocalStorePathResolver {
  private readonly vaultBasePath: string;
  private readonly context?: PathEnvironmentContext;

  constructor(vaultBasePath: string, context?: PathEnvironmentContext) {
    this.vaultBasePath = vaultBasePath;
    this.context = context;
  }

  public resolveStorePath(customPath?: string): ProducerLocalStorePathResolution {
    const isCustom = typeof customPath === "string" && customPath.trim().length > 0;
    let storeDirectory: string;
    let databasePath: string;

    if (isCustom && customPath) {
      const trimmed = customPath.trim();
      const canonical = canonicalizePath(trimmed);
      if (canonical.toLowerCase().endsWith(".db")) {
        databasePath = canonical;
        const lastSlash = canonical.lastIndexOf("/");
        storeDirectory = lastSlash > 0 ? canonical.slice(0, lastSlash) : (canonical.startsWith("/") ? "/" : ".");
      } else {
        storeDirectory = canonical;
        databasePath = joinPaths(canonical, PRODUCER_STORE_DEFAULT_DB_NAME);
      }
    } else {
      storeDirectory = resolveDefaultStoreDirectory(this.context);
      databasePath = joinPaths(storeDirectory, PRODUCER_STORE_DEFAULT_DB_NAME);
    }

    const separation = this.isPathInsideVault(databasePath);

    return {
      storeDirectory: canonicalizePath(storeDirectory),
      databasePath: canonicalizePath(databasePath),
      isCustomPath: isCustom,
      separation,
    };
  }

  public isPathInsideVault(targetPath: string): VaultPathSeparationResult {
    const platform = this.context?.platform ?? getRuntimePlatform();
    return checkPathSeparationFromVault(this.vaultBasePath, targetPath, platform);
  }
}
