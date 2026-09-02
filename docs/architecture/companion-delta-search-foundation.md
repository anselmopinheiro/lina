# Lina Architecture — Companion Delta Search Foundation (Phase 0.4.x)

**Status:** Implemented (Phase 0.4.x Foundation)  
**Scope:** Companion capability detection model, read-only artifact consumption state model, Producer/Companion responsibility split, zero-mutation invariants, and synchronization independence.

---

## 1. Overview & Architectural Invariants

Lina's multi-device architecture distinguishes between the authoritative **Producer** and lightweight **Companion** installations while preserving a strict separation of concerns:

$$\text{Role} \neq \text{Ownership}$$

* **Producer:** Authoritative maintainer responsible for vault watching, text indexing, embedding generation, canonical artifact publication, and derived binary vector compilation.
* **Companion:** Consumer client that reads synchronized artifacts (`.lina/index/*`), performs fast in-memory text and vector search, executes AI note enrichment (`/ask`, `/tags`, `/yaml`), and maintains ephemeral local search capabilities without running expensive background rebuilds or embedding pipelines.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRODUCER / COMPANION SPLIT                         │
├──────────────────────────────────────┬──────────────────────────────────────┤
│         Desktop Producer             │           Mobile Companion           │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Full textual indexing              │ • Pure read-only consumption         │
│ • Incremental & batch embeddings     │ • Ingests synchronized .lina/index/* │
│ • Derived binary compilation         │ • Fast local textual & vector search │
│ • Canonical atomic publication       │ • AI analysis & slash commands       │
│ • Monotonic epoch fencing            │ • Zero background indexing/writes    │
│ • Holds active ownership lease       │ • Zero local embedding generation    │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 2. Synchronization Independence

Lina does **not** provide a built-in cloud sync engine or transport mechanism:
- File transport is delegated to external systems (Obsidian Sync, Syncthing, iCloud Drive, Dropbox, OneDrive, Git).
- Lina's consumption architecture is **transport-agnostic** and operates reliably under asynchronous, partial, or out-of-order file arrivals.

---

## 3. Companion Capability Detection Model

The `CompanionCapability` model ([`src/companion/companionCapability.ts`](file:///d:/_dev/obsidian/lina/src/companion/companionCapability.ts)) defines the operational capability profile of a Companion device:

```typescript
export interface CompanionCapability {
  readonly role?: DeviceRole;
  readonly isCompanion: boolean;
  readonly isProducer: boolean;
  readonly canConsumeArtifacts: boolean;
  readonly canPerformDeltaSearch: boolean;
  readonly canGenerateEmbeddings: boolean; // Strictly false on Companion
  readonly canMaintainSharedIndex: boolean; // Strictly false on Companion
  readonly canMaintainBinaryCopy: boolean;  // Strictly false on Companion
  readonly resourceProfile: DeviceResourceProfile;
}
```

### Capability Invariants:
1. **Explicit Role Precedence:** If `role = "companion"` is configured in `.lina/devices/<deviceId>.json`, the installation acts as a Companion regardless of host hardware.
2. **Neutral Mobile Default:** If `role` is unassigned on a mobile device, it defaults to Companion behavior to protect battery and memory budgets.
3. **Strict Write Protection:** Companion capability explicitly sets `canGenerateEmbeddings = false`, `canMaintainSharedIndex = false`, and `canMaintainBinaryCopy = false`.

---

## 4. Artifact Consumption State Model

The `CompanionArtifactConsumptionState` model ([`src/companion/companionConsumptionState.ts`](file:///d:/_dev/obsidian/lina/src/companion/companionConsumptionState.ts)) provides a structured, read-only snapshot describing available shared search assets from the Companion perspective:

```typescript
export interface CompanionArtifactConsumptionState {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly deviceId: string;
  readonly role?: DeviceRole;
  readonly isCompanion: boolean;
  readonly lastKnownProducerEpoch?: number;
  readonly activeProducerId?: string;
  readonly availableIndexVersion?: number;
  readonly totalNotes?: number;
  readonly totalChunks?: number;
  readonly embeddingState: CompanionEmbeddingState;
  readonly provenanceValidity: ArtifactProvenanceStatus; // "valid" | "stale" | "unknown" | "future"
  readonly provenanceReason?: string;
  readonly artifactFreshness: ArtifactFreshness;           // "fresh" | "stale" | "unknown" | "missing"
  readonly artifactAvailability: CompanionArtifactAvailability;
  readonly canConsume: boolean;
  readonly consumptionMode: CompanionConsumptionMode;     // "full" | "text-only" | "degraded" | "unavailable"
}
```

### Consumption Modes:
* **`"full"`:** Valid text index and vector embeddings (with or without binary acceleration) are available for hybrid/semantic search.
* **`"text-only"`:** Text index is available, but vector embeddings are absent or disabled; textual search remains fully functional.
* **`"degraded"`:** Text index manifest is partially malformed or undergoing external synchronization; fallback textual scanning is used.
* **`"unavailable"`:** No index manifest exists in `.lina/index/manifest.json`.

### Non-Blocking Usability Invariant:
Artifacts with `"stale"`, `"unknown"`, or `"future"` provenance (e.g. created under a prior epoch or arriving before the ownership manifest during sync) remain **100% usable for local search**. Lina never blocks search queries or triggers destructive auto-repairs upon encountering stale provenance.

---

## 5. Zero Producer-Side Mutation Guarantee

All Companion consumption operations (`readCompanionConsumptionState`) are strictly read-only:
- Zero writes to `.lina/index/*`;
- Zero mutations to `.lina/ownership.json`;
- Zero temporary file staging;
- Zero directory creations.

This ensures zero write contention or sync conflicts across multi-device vaults.

---

## 6. Companion Read-Only Query Layer (Phase 0.4.1)

The query layer ([`src/companion/companionSearch.ts`](file:///d:/_dev/obsidian/lina/src/companion/companionSearch.ts)) provides a clean, safe search interface that delegates queries to existing search engines while enforcing read-only constraints:

```text
User Query
     │
     ▼
Companion Query Layer (`executeCompanionSearch`)
     │
     ▼
Consumption State Validation (`canConsume`, `consumptionMode`)
     │
     ▼
Existing Search Engines (`searchTextIndex`, `searchSemanticIndex`, `searchRuntimeSemanticIndex`)
     │
     ▼
Results & Provenance Metadata (`CompanionSearchResult`)
```

### Search Functions:
- **`executeCompanionTextSearch`:** Executes fast in-memory keyword, prefix, and fuzzy matching over synchronized notes and chunks.
- **`executeCompanionSemanticSearch`:** Executes vector cosine similarity search using precomputed query embeddings against fast binary runtime indices or JSONL embedding records.
- **`executeCompanionSearch`:** Unified entry point with automatic mode selection (`"auto"`, `"text"`, `"semantic"`), falling back gracefully to text search when embeddings are unavailable.

### Safety Invariants:
1. **Zero Index Mutation:** Search never invokes maintenance workers or attempts to rebuild `.lina/index/*`.
2. **Missing Embedding Resilience:** Absence of vector embeddings never breaks textual search.
3. **Stale/Unknown Usability:** Stale or legacy provenance metadata never blocks query execution.

---

## 7. Companion Search Diagnostics & Capability Exposure (Phase 0.4.2.1)

The device diagnostics subsystem (`src/device/deviceDiagnostics.ts`) and modal UI (`DeviceDiagnosticsModal`) expose the operational status and search availability of the Companion without introducing active workers or mutation triggers:

```typescript
export interface DeviceDiagnosticsCompanionSearchSection {
  readonly supported: boolean;
  readonly available: boolean;
  readonly mode: "full" | "text-only" | "degraded" | "unavailable";
  readonly isCompanionRole: boolean;
  readonly textIndexAvailable: boolean;
  readonly embeddingsAvailable: boolean;
  readonly reason?: string;
}
```

### Observation-Only Principles:
1. **`Diagnostics != Repair`:** Reporting search availability does not trigger automatic index rebuilds, embedding requests, or state reconciliation.
2. **Modal UI Presentation:** `DeviceDiagnosticsModal` presents a dedicated `"Companion Search (Read-Only Mode)"` section with colored status badges, mode labels, and artifact availability summaries in Portuguese (`pt-PT`) and English (`en`).
3. **Zero Mutation Guarantee:** Loading and rendering diagnostics performs zero disk writes, zero directory creations, zero file renames, and zero ownership mutations.

---

## 8. Search Architecture Audit & Companion Integration Plan (Phase 0.4.3)

### Core Architectural Finding: Unified Search Engine vs. Separate Pipelines
Lina has a mature, highly optimized search core composed of `searchTextIndex`, `searchRuntimeSemanticIndex`, and `runHybridSearch`. To avoid architectural fragmentation, duplicate maintenance overhead, and UI inconsistency, Lina maintains **One Unified Search Architecture** that dynamically adapts to device capabilities:

```text
                Lina Search Entry Point
                (LinaSearchView / Modals)
                         │
                         ▼
             Device Capability Detection
             (Producer vs Companion Role)
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
       Producer Mode           Companion Mode
       (Authoritative)      (Consumer / Read-Only)
             │                       │
             │             Consumption State Validation
             │             (canConsume, artifactFreshness)
             │                       │
             └───────────┬───────────┘
                         ▼
            Core Search Engine Execution
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
   Text Search    Semantic Search    Hybrid Search
  (searchTextIndex) (searchRuntime)  (runHybridSearch)
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
            Group & Format Results
             (groupResultsByNote)
                         │
                         ▼
               Unified Search View
```

### Refactoring Strategy:
1. **Keep:** Core search modules (`src/search/textSearch.ts`, `src/search/semanticSearch.ts`, `src/search/hybridSearch.ts`, `src/search/runtimeEmbeddingIndex.ts`) remain the single source of truth for text ranking, vector similarity, and fusion.
2. **Adapt:** `src/search/linaSearchView.ts` becomes capability-aware, adjusting maintenance controls, background triggers, and diagnostics display without altering the core query experience.
3. **Consolidate:** `src/companion/companionSearch.ts` serves as the capability-checked delegation interface, standardizing query inputs and consumption state validation.
4. **No UI Duplication:** Companion devices use the standard `pesquisar` command and `LinaSearchView` ribbon icon, ensuring a seamless user experience across desktop and mobile.

---

## 9. Local Delta Search Foundation (Phase 0.4.4)

The local delta layer ([`src/companion/companionDeltaSearch.ts`](file:///d:/_dev/obsidian/lina/src/companion/companionDeltaSearch.ts)) enables Companion devices to search recent unindexed note creations and modifications on-the-fly without modifying persistent index files or generating local embeddings.

```text
User Query
      │
      ▼
Unified Search Flow
      │
      ├────────────────────────┐
      ▼                        ▼
Published Index           Local Delta
(`searchTextIndex`)    (`detectLocalDelta` → `chunkText` → `searchTextIndex`)
      │                        │
      └───────────┬────────────┘
                  ▼
            Result Fusion
         (`fuseSearchResults`)
                  │
                  ▼
           Unified UI View
(Tags: "index" vs "local-delta", isTemporary: true)
```

### Key Capabilities:
1. **Delta Detection (`detectLocalDelta`):** Compares live vault notes against `IndexedNote[]` to detect created notes, modified notes (via `mtime`, `size`, `contentHash`), and deleted paths.
2. **Ephemeral Chunking (`buildLocalDeltaSearchState`):** Chunks unindexed content on-the-fly in memory into temporary `IndexedNote` and `Chunk[]` structures.
3. **Delta Search Execution (`executeLocalDeltaSearch`):** Reuses the existing `searchTextIndex` algorithm directly without duplicating search code.
4. **Result Fusion & Precedence (`fuseSearchResults`):**
   - Delta search hits override stale index hits for modified notes;
   - Deleted notes are suppressed from published index hits;
   - Each item is clearly tagged with `source: "index" | "local-delta"`, `isTemporary: boolean`, and `deltaType: "created" | "modified"`.

### Safety & Isolation Guarantees:
- **Zero Disk Writes:** Never writes to `.lina/index/notes.json` or `.lina/index/chunks.jsonl`.
- **Text-Only Delta Search:** Never generates vector embeddings locally on Companion.
- **Zero Worker Invocations:** Does not trigger background maintenance workers or ownership modifications.




