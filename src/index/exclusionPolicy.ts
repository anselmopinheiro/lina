/**
 * Canonical Exclusion Policy Contract and Core Types (LINA-03-001)
 *
 * Defines the versioned contract, semantic normalization, deterministic hashing,
 * monotonic revision management, and integrity validation for `.lina/exclusions.json`.
 */

import { normalizePath } from "obsidian";
import {
  ArtifactProvenance,
  isValidArtifactProvenance,
} from "../device/artifactProvenance";
import {
  parseContentExclusionTerms,
  parseMultilineSetting,
  shouldExcludeContent,
  shouldExcludePath,
} from "./indexExclusions";

export const EXCLUSION_POLICY_SCHEMA_VERSION = 1;
export const EXCLUSION_POLICY_FILE_PATH = ".lina/exclusions.json";
export const POLICY_HASH_PREFIX = "sha256:";

/**
 * Normalized and immutable exclusion rules.
 */
export interface ExclusionPolicyRules {
  readonly excludedFolders: readonly string[];
  readonly excludedPathContains: readonly string[];
  readonly excludedContentContains: readonly string[];
}

/**
 * Flexible input format for specifying exclusion rules before normalization.
 */
export interface ExclusionPolicyRulesInput {
  readonly excludedFolders?: readonly string[];
  readonly excludedPathContains?: readonly string[];
  readonly excludedContentContains?: readonly string[];
}

/**
 * Canonical Exclusion Policy V1 contract stored at `.lina/exclusions.json`.
 */
export interface ExclusionPolicyV1 {
  readonly schemaVersion: 1;
  readonly policyRevision: number;
  readonly policyHash: string;
  readonly provenance: ArtifactProvenance;
  readonly updatedAt: string;
  readonly rules: ExclusionPolicyRules;
}

export type ExclusionPolicyInvalidReason =
  | "invalid-json"
  | "unsupported-schema"
  | "invalid-revision"
  | "invalid-hash-format"
  | "hash-mismatch"
  | "invalid-provenance"
  | "invalid-timestamp"
  | "invalid-rules";

export type ExclusionPolicyLoadResult =
  | { readonly status: "loaded"; readonly policy: ExclusionPolicyV1 }
  | { readonly status: "missing" }
  | {
      readonly status: "invalid";
      readonly reason: ExclusionPolicyInvalidReason;
      readonly error?: string;
    };

export interface LegacyExclusionSettingsInput {
  readonly indexExcludedFolders?: string;
  readonly indexExcludedPathContains?: string;
  readonly indexExcludedContentContains?: string;
}

/**
 * Computes the normalized canonical vault file path for the exclusion policy.
 */
export function getExclusionPolicyPath(): string {
  return normalizePath(EXCLUSION_POLICY_FILE_PATH);
}

// ---------------------------------------------------------------------------
// Pure Semantic Normalization
// ---------------------------------------------------------------------------

function normalizeFolderEntry(folder: string): string | null {
  const trimmed = folder.trim().replace(/\\/g, "/").toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function normalizeTermEntry(term: string): string | null {
  const trimmed = term.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function deduplicateAndSort(entries: readonly string[]): readonly string[] {
  const unique = new Set(entries);
  return Object.freeze(Array.from(unique).sort((a, b) => a.localeCompare(b)));
}

/**
 * Normalizes exclusion rules according to current Lina search semantics:
 * - Trims whitespace
 * - Discards empty entries
 * - Normalizes backslashes to slashes
 * - Lowercases entries (matching engine is case-insensitive)
 * - Deduplicates entries
 * - Deterministically sorts entries
 */
export function normalizeExclusionRules(
  input?: ExclusionPolicyRulesInput
): ExclusionPolicyRules {
  const rawFolders = input?.excludedFolders ?? [];
  const rawPathContains = input?.excludedPathContains ?? [];
  const rawContentContains = input?.excludedContentContains ?? [];

  const folders: string[] = [];
  for (const entry of rawFolders) {
    if (typeof entry === "string") {
      const normalized = normalizeFolderEntry(entry);
      if (normalized !== null) {
        folders.push(normalized);
      }
    }
  }

  const pathContains: string[] = [];
  for (const entry of rawPathContains) {
    if (typeof entry === "string") {
      const normalized = normalizeTermEntry(entry);
      if (normalized !== null) {
        pathContains.push(normalized);
      }
    }
  }

  const contentContains: string[] = [];
  for (const entry of rawContentContains) {
    if (typeof entry === "string") {
      const normalized = normalizeTermEntry(entry);
      if (normalized !== null) {
        contentContains.push(normalized);
      }
    }
  }

  return Object.freeze({
    excludedFolders: deduplicateAndSort(folders),
    excludedPathContains: deduplicateAndSort(pathContains),
    excludedContentContains: deduplicateAndSort(contentContains),
  });
}

/**
 * Empty exclusion rules representing safe degraded fallback when canonical policy is invalid.
 * Does not define user rules, leaving only mandatory internal folders (.lina/, configDir) protected.
 */
export const EMPTY_EXCLUSION_POLICY_RULES: ExclusionPolicyRules = normalizeExclusionRules({});

// ---------------------------------------------------------------------------
// Deterministic Synchronous SHA-256 & policyHash
// ---------------------------------------------------------------------------

const SHA256_INITIAL: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

const SHA256_ROUND_CONSTANTS: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Compact, zero-dependency synchronous SHA-256 digest calculation.
 */
export function sha256Hex(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const upper = Math.floor(bitLength / 0x100000000);
  const lower = bitLength >>> 0;
  padded[paddedLength - 8] = (upper >>> 24) & 0xff;
  padded[paddedLength - 7] = (upper >>> 16) & 0xff;
  padded[paddedLength - 6] = (upper >>> 8) & 0xff;
  padded[paddedLength - 5] = upper & 0xff;
  padded[paddedLength - 4] = (lower >>> 24) & 0xff;
  padded[paddedLength - 3] = (lower >>> 16) & 0xff;
  padded[paddedLength - 2] = (lower >>> 8) & 0xff;
  padded[paddedLength - 1] = lower & 0xff;

  const hash = SHA256_INITIAL.slice();
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        ((padded[wordOffset] << 24) |
          (padded[wordOffset + 1] << 16) |
          (padded[wordOffset + 2] << 8) |
          padded[wordOffset + 3]) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      words[index] =
        (words[index - 16] +
          (rightRotate(a, 7) ^ rightRotate(a, 18) ^ (a >>> 3)) +
          words[index - 7] +
          (rightRotate(b, 17) ^ rightRotate(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 =
        rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h +
          sigma1 +
          choice +
          SHA256_ROUND_CONSTANTS[index] +
          words[index]) >>>
        0;
      const sigma0 =
        rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((val) => val.toString(16).padStart(8, "0")).join("");
}

/**
 * Builds the canonical serialized payload for computing policyHash.
 *
 * Excludes metadata (policyRevision, updatedAt, provenance) so that hash
 * represents purely the semantic exclusion rules.
 */
export function canonicalizeRulesForHash(
  rules: ExclusionPolicyRulesInput
): string {
  const normalized = normalizeExclusionRules(rules);
  return JSON.stringify({
    schemaVersion: EXCLUSION_POLICY_SCHEMA_VERSION,
    rules: {
      excludedContentContains: normalized.excludedContentContains,
      excludedFolders: normalized.excludedFolders,
      excludedPathContains: normalized.excludedPathContains,
    },
  });
}

/**
 * Computes deterministic SHA-256 fingerprint representing exclusion policy semantics.
 * Format: `sha256:<64-character hex>`.
 */
export function computePolicyHash(rules: ExclusionPolicyRulesInput): string {
  const canonicalString = canonicalizeRulesForHash(rules);
  return `${POLICY_HASH_PREFIX}${sha256Hex(canonicalString)}`;
}

/**
 * Validates whether a string matches the required `sha256:<hex>` format.
 */
export function isValidPolicyHash(hash: unknown): hash is string {
  if (typeof hash !== "string") {
    return false;
  }
  if (!hash.startsWith(POLICY_HASH_PREFIX)) {
    return false;
  }
  const hexPart = hash.slice(POLICY_HASH_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(hexPart);
}

// ---------------------------------------------------------------------------
// Validation & Schema Checking
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isValidRulesRecord(
  rules: unknown
): rules is ExclusionPolicyRules {
  if (!isRecord(rules)) {
    return false;
  }
  return (
    isStringArray(rules.excludedFolders) &&
    isStringArray(rules.excludedPathContains) &&
    isStringArray(rules.excludedContentContains)
  );
}

/**
 * Type guard for the structural shape of `ExclusionPolicyV1`.
 */
export function isExclusionPolicy(value: unknown): value is ExclusionPolicyV1 {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== EXCLUSION_POLICY_SCHEMA_VERSION) {
    return false;
  }

  if (
    typeof value.policyRevision !== "number" ||
    !Number.isInteger(value.policyRevision) ||
    value.policyRevision < 1
  ) {
    return false;
  }

  if (!isValidPolicyHash(value.policyHash)) {
    return false;
  }

  if (
    typeof value.updatedAt !== "string" ||
    value.updatedAt.trim().length === 0 ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    return false;
  }

  if (!isValidArtifactProvenance(value.provenance)) {
    return false;
  }

  if (!isValidRulesRecord(value.rules)) {
    return false;
  }

  return true;
}

/**
 * Validates structural conformance and semantic integrity (hash verification).
 */
export function validatePolicyIntegrity(value: unknown): {
  valid: boolean;
  reason?: ExclusionPolicyInvalidReason;
  error?: string;
} {
  if (!isRecord(value)) {
    return {
      valid: false,
      reason: "invalid-json",
      error: "Value is not an object",
    };
  }

  if (value.schemaVersion !== EXCLUSION_POLICY_SCHEMA_VERSION) {
    return {
      valid: false,
      reason: "unsupported-schema",
      error: `Unsupported schemaVersion: ${String(value.schemaVersion)}`,
    };
  }

  if (
    typeof value.policyRevision !== "number" ||
    !Number.isInteger(value.policyRevision) ||
    value.policyRevision < 1
  ) {
    return {
      valid: false,
      reason: "invalid-revision",
      error: `Invalid policyRevision: ${String(value.policyRevision)}`,
    };
  }

  if (!isValidPolicyHash(value.policyHash)) {
    return {
      valid: false,
      reason: "invalid-hash-format",
      error: `Invalid policyHash format: ${String(value.policyHash)}`,
    };
  }

  if (
    typeof value.updatedAt !== "string" ||
    value.updatedAt.trim().length === 0 ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    return {
      valid: false,
      reason: "invalid-timestamp",
      error: `Invalid updatedAt timestamp: ${String(value.updatedAt)}`,
    };
  }

  if (!isValidArtifactProvenance(value.provenance)) {
    return {
      valid: false,
      reason: "invalid-provenance",
      error: "Invalid artifact provenance",
    };
  }

  if (!isValidRulesRecord(value.rules)) {
    return {
      valid: false,
      reason: "invalid-rules",
      error: "Invalid rules: arrays must contain strings",
    };
  }

  const expectedHash = computePolicyHash(value.rules);
  if (expectedHash !== value.policyHash) {
    return {
      valid: false,
      reason: "hash-mismatch",
      error: `Hash mismatch: expected "${expectedHash}", found "${String(value.policyHash)}"`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Policy Creation and Evolution
// ---------------------------------------------------------------------------

/**
 * Creates an initial ExclusionPolicyV1 record with `policyRevision = 1`.
 */
export function createInitialExclusionPolicy(
  rulesInput: ExclusionPolicyRulesInput,
  provenance: ArtifactProvenance,
  now?: string
): ExclusionPolicyV1 {
  const normalizedRules = normalizeExclusionRules(rulesInput);
  const hash = computePolicyHash(normalizedRules);
  const timestamp = now ?? new Date().toISOString();

  return Object.freeze({
    schemaVersion: EXCLUSION_POLICY_SCHEMA_VERSION,
    policyRevision: 1,
    policyHash: hash,
    provenance,
    updatedAt: timestamp,
    rules: normalizedRules,
  });
}

/**
 * Evolves an existing policy with updated rules.
 * Monotonic revision rule:
 * - If new rules are semantically identical (same policyHash), policyRevision does NOT increment.
 * - If new rules are semantically different, policyRevision increments (currentRevision + 1).
 */
export function evolveExclusionPolicy(
  currentPolicy: ExclusionPolicyV1,
  newRulesInput: ExclusionPolicyRulesInput,
  provenance: ArtifactProvenance,
  now?: string
): ExclusionPolicyV1 {
  const normalizedRules = normalizeExclusionRules(newRulesInput);
  const newHash = computePolicyHash(normalizedRules);
  const timestamp = now ?? new Date().toISOString();

  const isSemanticChange = newHash !== currentPolicy.policyHash;
  const nextRevision = isSemanticChange
    ? currentPolicy.policyRevision + 1
    : currentPolicy.policyRevision;

  return Object.freeze({
    schemaVersion: EXCLUSION_POLICY_SCHEMA_VERSION,
    policyRevision: nextRevision,
    policyHash: newHash,
    provenance,
    updatedAt: timestamp,
    rules: normalizedRules,
  });
}

// ---------------------------------------------------------------------------
// Legacy Settings Conversion (Pure Helper for Future LINA-03-002)
// ---------------------------------------------------------------------------

/**
 * Pure converter from legacy LinaSettings exclusion string values to normalized ExclusionPolicyRules.
 *
 * Preserves exact current parsing behavior of multiline and comma/semicolon strings.
 * Does NOT alter settings, touch data.json, or write to .lina/exclusions.json.
 */
export function convertLegacySettingsToExclusionRules(
  legacy: LegacyExclusionSettingsInput
): ExclusionPolicyRules {
  const folders =
    typeof legacy.indexExcludedFolders === "string"
      ? parseMultilineSetting(legacy.indexExcludedFolders)
      : [];
  const pathContains =
    typeof legacy.indexExcludedPathContains === "string"
      ? parseMultilineSetting(legacy.indexExcludedPathContains)
      : [];
  const contentContains =
    typeof legacy.indexExcludedContentContains === "string"
      ? parseContentExclusionTerms(legacy.indexExcludedContentContains)
      : [];

  return normalizeExclusionRules({
    excludedFolders: folders,
    excludedPathContains: pathContains,
    excludedContentContains: contentContains,
  });
}

// ---------------------------------------------------------------------------
// Manifest Policy Provenance & Compatibility Evaluation (LINA-03-003)
// ---------------------------------------------------------------------------

export type ExclusionPolicyCompatibilityReason =
  | "legacy-manifest"
  | "policy-unavailable"
  | "invalid-manifest-policy";

export type ExclusionPolicyCompatibility =
  | {
      readonly status: "compatible";
      readonly activeHash: string;
      readonly artifactHash: string;
      readonly activeRevision?: number;
      readonly artifactRevision?: number;
    }
  | {
      readonly status: "mismatch";
      readonly activeHash: string;
      readonly artifactHash: string;
      readonly activeRevision?: number;
      readonly artifactRevision?: number;
    }
  | {
      readonly status: "unknown";
      readonly reason: ExclusionPolicyCompatibilityReason;
    };

export interface ManifestPolicyIdentity {
  readonly exclusionPolicyRevision?: number;
  readonly exclusionPolicyHash?: string;
}

/**
 * Pure, deterministic evaluator for comparing active exclusion policy against
 * text index manifest provenance.
 *
 * Rules:
 * - compatible: manifest.exclusionPolicyHash === activePolicy.policyHash (hashes match)
 * - mismatch: both hashes known, valid, and different
 * - unknown:
 *   - legacy-manifest: manifest has no exclusionPolicyHash
 *   - policy-unavailable: active policy is missing, null, undefined or has an invalid hash
 *   - invalid-manifest-policy: manifest has an invalid hash format or invalid revision
 *
 * Semantic identity is determined strictly by policyHash, never solely by revision.
 */
export function evaluateExclusionPolicyCompatibility(
  activePolicy:
    | ExclusionPolicyV1
    | { readonly policyHash?: string; readonly policyRevision?: number; readonly [key: string]: unknown }
    | string
    | null
    | undefined,
  manifest: ManifestPolicyIdentity | null | undefined
): ExclusionPolicyCompatibility {
  let activeHash: string | undefined;
  let activeRevision: number | undefined;

  if (typeof activePolicy === "string") {
    activeHash = activePolicy;
  } else if (activePolicy && typeof activePolicy === "object") {
    if (typeof activePolicy.policyHash === "string") {
      activeHash = activePolicy.policyHash;
    }
    if (typeof activePolicy.policyRevision === "number") {
      activeRevision = activePolicy.policyRevision;
    }
  }

  if (!activeHash || !isValidPolicyHash(activeHash)) {
    return { status: "unknown", reason: "policy-unavailable" };
  }

  if (!manifest || typeof manifest !== "object") {
    return { status: "unknown", reason: "legacy-manifest" };
  }

  const artifactHash =
    typeof manifest.exclusionPolicyHash === "string"
      ? manifest.exclusionPolicyHash
      : undefined;
  const artifactRevision =
    typeof manifest.exclusionPolicyRevision === "number"
      ? manifest.exclusionPolicyRevision
      : undefined;

  if (artifactHash === undefined || artifactHash.trim().length === 0) {
    return { status: "unknown", reason: "legacy-manifest" };
  }

  if (!isValidPolicyHash(artifactHash)) {
    return { status: "unknown", reason: "invalid-manifest-policy" };
  }

  if (
    artifactRevision !== undefined &&
    (!Number.isInteger(artifactRevision) || artifactRevision < 1)
  ) {
    return { status: "unknown", reason: "invalid-manifest-policy" };
  }

  if (artifactHash === activeHash) {
    return {
      status: "compatible",
      activeHash,
      artifactHash,
      activeRevision,
      artifactRevision,
    };
  }

  return {
    status: "mismatch",
    activeHash,
    artifactHash,
    activeRevision,
    artifactRevision,
  };
}

// ---------------------------------------------------------------------------
// Defensive In-Memory Filtering (LINA-03-004)
// ---------------------------------------------------------------------------

export interface FilterableIndexedNote {
  readonly path: string;
}

export interface FilterableChunk {
  readonly chunkId: string;
  readonly path: string;
  readonly text: string;
}

export interface FilterableEmbeddingRecord {
  readonly chunkId: string;
  readonly path: string;
}

export interface FilteredIndexedDataset<N extends FilterableIndexedNote, C extends FilterableChunk> {
  readonly notes: N[];
  readonly chunks: C[];
  readonly excludedPaths: ReadonlySet<string>;
}

/**
 * Resolves active exclusion rules defensively from any supported policy input.
 *
 * Rules:
 * - If policy status is "invalid", returns EMPTY_EXCLUSION_POLICY_RULES (strict non-legacy fallback;
 *   preserves LINA-03-002-FIX-001: no legacy fallback, only mandatory built-in exclusions).
 * - If policy is ExclusionPolicyV1, extracts policy.rules.
 * - If policy is already ExclusionPolicyRules, normalizes and returns it.
 * - If null/undefined, returns EMPTY_EXCLUSION_POLICY_RULES.
 */
export function resolveDefensiveExclusionRules(
  policyInput:
    | ExclusionPolicyV1
    | ExclusionPolicyRules
    | { readonly status: "invalid" | "missing" | "loaded"; readonly policy?: ExclusionPolicyV1 }
    | null
    | undefined
): ExclusionPolicyRules {
  if (!policyInput) {
    return EMPTY_EXCLUSION_POLICY_RULES;
  }
  if ("status" in policyInput) {
    if (policyInput.status === "invalid") {
      return EMPTY_EXCLUSION_POLICY_RULES;
    }
    if (policyInput.status === "loaded" && policyInput.policy) {
      return policyInput.policy.rules;
    }
    return EMPTY_EXCLUSION_POLICY_RULES;
  }
  if ("rules" in policyInput && policyInput.rules) {
    return policyInput.rules;
  }
  if ("excludedFolders" in policyInput && "excludedPathContains" in policyInput) {
    return policyInput;
  }
  return EMPTY_EXCLUSION_POLICY_RULES;
}

/**
 * Pure, deterministic in-memory filter that screens indexed notes and chunks
 * against the active canonical exclusion policy.
 *
 * Invariants:
 * 1. Any note whose path matches path exclusion rules is excluded.
 * 2. Any chunk whose text matches content exclusion rules is excluded.
 * 3. Any note having at least one chunk excluded by content terms is excluded entirely.
 * 4. Any chunk belonging to an excluded note is dropped.
 * 5. Neither notes nor chunks ever expose content excluded by the active policy.
 */
export function filterIndexedDatasetByPolicy<N extends FilterableIndexedNote, C extends FilterableChunk>(
  notes: readonly N[],
  chunks: readonly C[],
  policyInput:
    | ExclusionPolicyV1
    | ExclusionPolicyRules
    | { readonly status: "invalid" | "missing" | "loaded"; readonly policy?: ExclusionPolicyV1 }
    | null
    | undefined,
  obsidianConfigDir?: string
): FilteredIndexedDataset<N, C> {
  const rules = resolveDefensiveExclusionRules(policyInput);
  const excludedPaths = new Set<string>();

  const pathExclusionConfig = {
    excludedFolders: rules.excludedFolders as string[],
    excludedPathContains: rules.excludedPathContains as string[],
  };
  const contentTerms = rules.excludedContentContains as string[];

  // 1. Identify notes excluded by path
  for (const note of notes) {
    if (shouldExcludePath(note.path, pathExclusionConfig, obsidianConfigDir).excluded) {
      excludedPaths.add(note.path);
    }
  }

  // 2. Identify chunks excluded by path or content
  for (const chunk of chunks) {
    if (excludedPaths.has(chunk.path)) {
      continue;
    }
    if (shouldExcludePath(chunk.path, pathExclusionConfig, obsidianConfigDir).excluded) {
      excludedPaths.add(chunk.path);
      continue;
    }
    if (contentTerms.length > 0 && shouldExcludeContent(chunk.text, contentTerms).excluded) {
      // If a chunk has forbidden content, the entire note and all its chunks are excluded
      excludedPaths.add(chunk.path);
    }
  }

  // 3. Filter notes and chunks
  const safeNotes = notes.filter((note) => !excludedPaths.has(note.path));
  const safeChunks = chunks.filter((chunk) => !excludedPaths.has(chunk.path));

  return {
    notes: safeNotes,
    chunks: safeChunks,
    excludedPaths,
  };
}

/**
 * Defensively filters embedding records against safe chunks and excluded paths.
 *
 * An embedding record is only kept if:
 * - Its path is NOT in excludedPaths; AND
 * - Its chunkId is present in safeChunkIds (or safeChunks).
 */
export function filterEmbeddingRecordsByPolicy<E extends FilterableEmbeddingRecord, C extends FilterableChunk>(
  records: readonly E[],
  safeChunks: readonly C[],
  excludedPaths: ReadonlySet<string>
): E[] {
  const safeChunkIds = new Set(safeChunks.map((c) => c.chunkId));
  return records.filter(
    (record) => !excludedPaths.has(record.path) && safeChunkIds.has(record.chunkId)
  );
}
