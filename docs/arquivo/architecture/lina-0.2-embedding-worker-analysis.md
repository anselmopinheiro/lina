# Lina 0.2 — Phase 1.7 EmbeddingWorker Architecture Analysis

**Author:** Senior Software Architect & Senior Systems Analyst  
**Date:** August 17, 2026  
**Status:** Pre-Migration Architectural Analysis (Phase 1.7 — Analysis Only)  
**Target Version:** Lina 0.2.x  
**Scope:** Embedding lifecycle, responsibility decomposition of embedding orchestration in `main.ts`, component inventory, API cost protection, publication consistency, target `EmbeddingWorker` architecture, multi-worker interaction model, and migration sequencing.

---

## 1. Executive Summary

Lina 0.2 has established a modular **Maintenance Engine** architecture on the **Desktop Producer**:
1. **`DeviceCapabilities`:** Role separation between Desktop Producer (authoritative maintainer) and Mobile Companion (read-only consumer).
2. **`MaintenanceEngine`:** Top-level supervisor and capability-gated execution boundary.
3. **Migrated Workers:** [`TextIndexWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/textIndexWorker.ts) (vault events & text index), [`ReconciliationWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/reconciliationWorker.ts) (startup & exclusion drift), and [`BinaryWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/binaryWorker.ts) (derived `Float32Array` binary vectors).

The next required architectural milestone is migrating embedding orchestration into an **`EmbeddingWorker`**:

```text
Current Architecture                          Target Architecture
────────────────────                          ───────────────────
LinaPlugin (main.ts)                          LinaPlugin (main.ts)
    │                                             │
    ▼                                             ▼
MaintenanceEngine                             MaintenanceEngine
    ├── TextIndexWorker                           ├── TextIndexWorker
    ├── ReconciliationWorker                      ├── ReconciliationWorker
    └── BinaryWorker                              ├── BinaryWorker
                                                  └── EmbeddingWorker (NEW)
```

### Strategic Challenge & Risk Profile
Embedding maintenance is the **highest-risk subsystem** in Lina because it involves:
- **External Network APIs & Financial Cost:** Remote providers (e.g., Mistral) charge per token. Uncontrolled loops, duplicate generation, or un-debounced triggers cause direct financial cost.
- **Long-Running Async Batches:** Large vaults (thousands of chunks) take significant time to process.
- **Incremental Checkpointing & Crash Recovery:** Interrupted runs must resume gracefully without re-generating valid vectors.
- **Strict Publication Consistency:** Canonical publication (`embeddings.jsonl`) must atomically update `manifest.json` with a unique `publicationId` and coordinate downstream compilation with `BinaryWorker`.

This document analyzes the current embedding lifecycle, evaluates API cost protections, defines the target `EmbeddingWorker` boundaries, and outlines a safe, regression-free migration strategy.

---

## 2. Current Embedding Architecture

### 2.1 Entry Points & Orchestration in `main.ts`

Currently, embedding generation is orchestrated directly inside [`LinaPlugin` in `main.ts`](file:///d:/_dev/obsidian/lina/main.ts#L842):

```text
[User / UI Trigger]
  ├─ Command: "Lina: Gerar embeddings locais"
  ├─ Sidebar View: Rebuild / Update button
  └─ Settings / Modal: EmbeddingProgressModal
        │
        ▼
LinaPlugin.requestEmbeddingIndexGeneration(origin, onProgress)  [main.ts:842]
        │
        ├─ 1. Capability Guard: Check getDeviceCapabilities().canGenerateEmbeddings
        ├─ 2. Concurrency Guard: Check textIndexRebuildProgress & embeddingOperationManager state
        ├─ 3. Lock Reservation: IndexWriteCoordinator.requestEmbeddingGenerationPreparation()
        │
        ▼
EmbeddingOperationManager.request(origin, async (operation) => { ... })  [main.ts:876]
        │
        ├─ 4. Phase: "preparing" -> Validate abortSignal
        ├─ 5. Phase: "waiting-for-text-index" -> Drain TextIndexWorker automatic update queue
        ├─ 6. Lock Activation: IndexWriteCoordinator.startEmbeddingGeneration() -> Token
        │
        ▼
LinaPlugin.runGenerateLocalEmbeddings(...)  [main.ts:1674]
        │
        ├─ 7. Ingestion: readIndexedChunks(app) -> filterChunksByUserContentRules()
        ├─ 8. Config: getEffectiveEmbeddingConfig() (provider, model, baseUrl, apiKey, batchSize)
        │
        ▼
generateEmbeddingsForChunks(app, safeChunks, options)  [embeddingGenerator.ts:1033]
        │
        ├─ 9. Planning: calculateEmbeddingUpdatePlan() [embeddingUpdatePlan.ts]
        ├─ 10. Probe: validateEmbeddingProviderCandidate() (1-3 sample chunks)
        ├─ 11. Batch Loop: processEmbeddingBatchSequentially() (batches of 1-50)
        ├─ 12. Checkpointing: writeEmbeddingCheckpoint() after each batch [embeddingPersistence.ts]
        ├─ 13. Canonical Publication: publishCanonicalEmbeddings() with atomic temp swap & rollback
        │
        ▼
[Post-Publication Coordination]  [main.ts:917-930, 1783-1792]
        ├─ 14. Lock Release: IndexWriteCoordinator.finish(generationToken)
        ├─ 15. Status Dirty: markEmbeddingWorkStatusDirty("embeddings-published")
        ├─ 16. Invalidate Search Cache: invalidateRuntimeEmbeddingIndex("canonical-published")
        ├─ 17. Unblock Text Updates: schedulePendingAutomaticUpdatesFlush()
        └─ 18. Downstream Trigger: MaintenanceEngine.maintainBinaryAfterPublication(publicationId)
```

### 2.2 Execution Phase Breakdown

1. **Gate & Reserve:** `LinaPlugin` verifies `canGenerateEmbeddings`, ensures the text index is not in a full rebuild, verifies that no other embedding operation is running, and marks `embeddingGenerationRequested = true` in `IndexWriteCoordinator`.
2. **Text Index Drain:** Awaits `MaintenanceEngine.drainTextIndexAutomaticUpdates(signal)` (`TextIndexWorker`), ensuring all pending note edits are chunked, hashed, and persisted before vector computation begins.
3. **Provider Validation Probe:** `embeddingGenerator.ts` tests up to 3 candidate chunks against the target provider (`Ollama` or `Mistral`). If validation fails (bad URL, wrong model, authentication failure, dimension mismatch), the operation fails fast before processing the full vault.
4. **Sequential Batching & Incremental Checkpoint:** Chunks are sliced into batches (`batchSize` 1–50). After each batch successfully returns vectors from the provider, `writeEmbeddingCheckpoint` appends records to `.lina/index/embeddings.checkpoint.jsonl` and updates `.lina/index/embeddings.checkpoint.meta.json`.
5. **Atomic Publication & Rollback:** Upon completing all batches, `publishCanonicalEmbeddings` writes to `.lina/index/embeddings.publish.tmp`, backs up the existing `embeddings.jsonl` to `.publish.backup`, swaps files atomically, updates `manifest.json` with a new `publicationId`, and deletes checkpoint files. If a write fails, it rolls back from backup.
6. **Downstream Handoff:** Releases the write lock and triggers `MaintenanceEngine.maintainBinaryAfterPublication(publicationId)` to allow `BinaryWorker` to compile the derived `Float32Array` buffer.

---

## 3. Existing Components Analysis

| Component | File Path | Current Responsibility | Target Responsibility | Architectural Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **`EmbeddingOperationManager`** | [`src/index/embeddingOperationManager.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingOperationManager.ts) | Manages single-flight execution, status (`idle`, `running`, `cancelling`, `completed`, `failed`), progress events, and cancellation tokens. | Internalized execution manager of `EmbeddingWorker`. | **Encapsulate within Worker:** `EmbeddingWorker` should wrap or inherit this state machine to manage active operation lifecycle and subscriptions. |
| **`EmbeddingWorkStatusController`** | [`src/index/embeddingWorkStatusController.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts) | Tracks embedding drift (`revision`), dirty flags, lazy status recalculation, and update previews. | Shared runtime status provider. | **Retain & Inject:** Keep as a decoupled controller; `EmbeddingWorker` and `MaintenanceEngine` notify it via dirty events (`markEmbeddingWorkStatusDirty`). |
| **`embeddingGenerator.ts`** | [`src/index/embeddingGenerator.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingGenerator.ts) | Pure execution engine: candidate validation, sequential batch loop, prefix building, and persistence dispatch. | Stateless execution engine. | **Retain as Functional Core:** Do not turn into a worker. `EmbeddingWorker` calls `generateEmbeddingsForChunks` via injected host ports. |
| **`embeddingUpdatePlan.ts`** | [`src/index/embeddingUpdatePlan.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingUpdatePlan.ts) | Pure diff planner: compares chunks vs canonical records vs checkpoints, categorizing records (reusable, stale, missing, obsolete). | Pure diff calculator. | **Retain as Independent Core:** Stateless functional module used by `embeddingGenerator.ts` and `EmbeddingWorkStatusController`. |
| **`embeddingPersistence.ts`** | [`src/index/embeddingPersistence.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts) | Low-level disk persistence: atomic file swapping, backup creation, rollback, and checkpoint recovery. | Persistence I/O layer. | **Retain as Independent Storage Layer:** Encapsulates all JSONL and manifest disk mutations. |
| **`IndexWriteCoordinator`** | [`src/index/indexWriteCoordinator.ts`](file:///d:/_dev/obsidian/lina/src/index/indexWriteCoordinator.ts) | Cross-subsystem mutex token coordinator between text rebuilds, automatic batches, embeddings, and binary copies. | Mutex coordination layer. | **Retain at Engine Boundary:** Coordinated by `MaintenanceEngine` to maintain single-flight writer locks. |
| **`BinaryEmbeddingCopyController`** | [`src/index/embeddingBinaryCopyController.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryCopyController.ts) | Compiles derived `Float32Array` binary vectors from canonical JSONL. | Worker-coordinated binary compiler. | **Already Migrated:** Coordinated exclusively by `BinaryWorker` post-publication. |

---

## 4. API Cost and Reliability Risks

### 4.1 Comparison: Current Protections vs. Target Protections

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       API COST PROTECTION MAP                                    │
├────────────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ CURRENT PROTECTIONS (Implemented)              │ TARGET PROTECTIONS (Required for Automation)    │
├────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ • Single-Flight Mutex: Only one embedding      │ • Exponential Backoff: Progressive delays on    │
│   operation can execute at a time.             │   transient provider errors (429 / 503).        │
│ • Incremental Diff Planning: Skips chunks      │ • Circuit Breaker: Halts automated retries      │
│   whose textHash, model, and prefix match.     │   after N consecutive authentication/fatal fails│
│ • Validation Probes: Tests 1–3 chunks before   │ • Quiet Period Debounce: 30–60s idle window     │
│   launching full generation pipeline.          │   before triggering background embedding runs.  │
│ • Incremental Checkpoints: Saves state per     │ • Daily/Session Budget Caps: Hard token limits  │
│   batch; crashes resume without full re-runs.  │   for remote paid API providers (Mistral).      │
│ • Manual Trigger Only: No background loop.     │ • Smart Batch Coalescing: Consolidates micro-   │
│                                                │   edits into optimal batch sizes (10–50).       │
└────────────────────────────────────────────────┴─────────────────────────────────────────────────┘
```

### 4.2 Detailed Risk Analysis

1. **Duplicate Requests & Unchanged Chunks:**  
   * *CURRENT:* `calculateEmbeddingUpdatePlan` accurately identifies `reusableCanonicalRecords` by checking `textHash`, `embeddingInputHash`, `model`, `provider`, `prefixMode`, and `inputVersion`. Unchanged chunks are reused without making API requests.  
   * *RISK:* If provider or model settings change without user awareness, an incremental update turns into a `full-rebuild`.  
   * *RECOMMENDATION:* Require explicit user confirmation for `full-rebuild` in interactive mode, and refuse autonomous full rebuilds on background triggers.
2. **Provider Failures, Rate Limits & Costs:**  
   * *CURRENT:* `embeddingGenerator.ts` categorizes errors (`rate-limit`, `authentication`, `connection`, `timeout`, `model-not-found`). In manual mode, errors stop the generation and display actionable toast/modal hints.  
   * *RISK:* In a future autonomous background scheduler, repeating failed requests (e.g., expired API key or invalid endpoint) could consume API quota, trigger rate bans, or flood logs.  
   * *TARGET SAFEGUARD:* The future `EmbeddingWorker` must maintain a failure circuit breaker: if a provider returns `authentication`, `authorization`, or `model-not-found`, background maintenance must be suspended until user intervention or settings update.
3. **Interrupted Operations & Checkpoint Resumption:**  
   * *CURRENT:* Checkpoint metadata (`embeddings.checkpoint.meta.json`) records `operationId`, `provider`, `model`, `dimension`, and `completedRecords`. On restart, `readRecoverableEmbeddingCheckpointRecords` loads completed records if the identity matches.  
   * *RISK:* If the user edits a note whose chunk was already stored in the checkpoint during an interrupted run, the checkpoint might contain stale vectors.  
   * *RECOMMENDATION:* `embeddingUpdatePlan.ts` already cross-references checkpoint records against current chunk hashes. The `EmbeddingWorker` must continue to pass current vault chunks through this planner.

---

## 5. Publication Consistency Analysis

### 5.1 The Four-Tier Consistency Contract

Lina maintains search integrity across four storage representations:

```text
Tier 1: Markdown Files (Vault source of truth)
              │
              ▼
Tier 2: Text Index (.lina/index/notes.json & chunks.jsonl)
              │
              ▼
Tier 3: Canonical Embeddings (.lina/index/embeddings.jsonl & manifest.json [publicationId])
              │
              ▼
Tier 4: Derived Binary Shadow Copy (.lina/index/embeddings.vectors.f32 & meta.jsonl)
```

### 5.2 Consistency Guarantees & Safeguards

1. **Source Drain Synchronization:**  
   * *CURRENT:* Before embedding generation starts, `main.ts` calls `drainAutomaticUpdatesBeforeEmbeddingGeneration(signal)`. This flushes and commits all pending text updates in `TextIndexWorker`.  
   * *GUARANTEE:* Vector generation always operates on an immutable, committed snapshot of `chunks.jsonl`.
2. **Atomic Publication with Rollback:**  
   * *CURRENT:* Canonical publication in `publishCanonicalEmbeddings` (`embeddingPersistence.ts`):
     1. Serializes new records to `embeddings.publish.tmp`.
     2. Backs up existing `embeddings.jsonl` to `embeddings.publish.backup` and `manifest.json` to `manifest.publish.backup`.
     3. Swaps `embeddings.publish.tmp` -> `embeddings.jsonl`.
     4. Updates `manifest.json` with new `publicationId`, `embeddingCount`, and `dimensions`.
     5. Deletes temporary and backup files.
     6. If any step fails, restores from `.backup` files and emits a rollback diagnostic.
3. **Downstream Binary Shadow Alignment:**  
   * *CURRENT:* `BinaryWorker` checks that `embeddings.binary.manifest.json.sourcePublicationId === manifest.json.publicationId`. If they do not match, the binary copy is classified as `outdated` and runtime search immediately falls back to `embeddings.jsonl`.
4. **Runtime Cache Invalidation:**  
   * *CURRENT:* Upon canonical publication or rollback, `invalidateRuntimeEmbeddingIndex` evicts the cached `RuntimeEmbeddingIndex` (`Float32Array`), forcing the next search query to lazily load the newly published vector dataset.

---

## 6. Target EmbeddingWorker Architecture

### 6.1 Responsibility Boundary

To avoid creating a monolithic worker, responsibilities must be cleanly partitioned between the coordinator (`MaintenanceEngine`), the worker (`EmbeddingWorker`), and the stateless functional core (`embeddingGenerator.ts`, `embeddingPersistence.ts`, `embeddingUpdatePlan.ts`):

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        MaintenanceEngine (Coordinator)                 │
├────────────────────────────────────────────────────────────────────────┤
│ • Capability validation: canRun("embeddings")                          │
│ • Cross-worker lifecycle supervision: start(), dispose()               │
│ • Lock coordination with IndexWriteCoordinator                         │
│ • High-level status aggregation: getState()                            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        EmbeddingWorker (Worker)                        │
├────────────────────────────────────────────────────────────────────────┤
│ • Single-flight operation lifecycle management                         │
│ • Operation state machine (idle, preparing, validating, etc.)          │
│ • AbortSignal & cooperative cancellation propagation                   │
│ • Coordination of pre-flight TextIndexWorker drain                     │
│ • Invocation of embeddingGenerator.ts via injected host ports          │
│ • Progress event broadcasting to UI & modals                           │
│ • Post-publication trigger of BinaryWorker & cache invalidation        │
│ • Circuit breaker & error category tracking                            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌─────────────────┐        ┌─────────────────┐        ┌──────────────────┐
│ embeddingGen.ts │        │  updatePlan.ts  │        │ persistence.ts   │
│ (Batch Loop)    │        │  (Diff Planner) │        │ (Atomic Disk I/O)│
└─────────────────┘        └─────────────────┘        └──────────────────┘
```

### 6.2 Proposed `EmbeddingWorker` Interface

```typescript
export type EmbeddingWorkerStatus =
  | "idle"
  | "preparing"
  | "waiting-for-text-index"
  | "validating"
  | "generating"
  | "persisting"
  | "cancelling"
  | "error";

export interface EmbeddingWorkerState {
  readonly status: EmbeddingWorkerStatus;
  readonly activeOperationId: string | null;
  readonly origin: EmbeddingOperationOrigin | null;
  readonly progress: EmbeddingProgress | null;
  readonly lastError: string | null;
  readonly lastFailureCategory?: EmbeddingErrorCategory;
  readonly circuitBreakerTripped: boolean;
}

export interface EmbeddingWorkerOptions {
  readonly capabilities: DeviceCapabilities;
  readonly getEffectiveConfig: () => EffectiveEmbeddingConfig;
  readonly getSafeChunks: () => Promise<Chunk[] | null>;
  readonly drainTextIndex: (signal?: AbortSignal) => Promise<boolean>;
  readonly reserveWriteLock: () => IndexWriteCoordinatorResult;
  readonly activateWriteLock: () => IndexWriteCoordinatorResult;
  readonly releaseWriteLock: (token?: IndexWriteCoordinatorToken) => void;
  readonly onPublicationCompleted: (publicationId: string) => void;
  readonly onPublicationRollback: () => void;
  readonly onWorkStatusDirty: (reason: EmbeddingWorkInvalidationReason) => void;
}

export class EmbeddingWorker {
  // Encapsulates request, cancel, progress broadcasting, and execution loop
  request(origin: EmbeddingOperationOrigin, onProgress?: (msg: string) => void): Promise<LinaActionResult>;
  cancelActiveOperation(): boolean;
  getState(): EmbeddingWorkerState;
  subscribe(listener: (state: EmbeddingWorkerState) => void): () => void;
  start(): void;
  stop(): void;
  dispose(): void;
}
```

---

## 7. Interaction With Existing Workers

The future multi-worker pipeline establishes an explicit, unidirectional data flow:

```mermaid
flowchart TD
    subgraph Maintenance Pipeline
        V[Vault File Events] -->|Events| TW[TextIndexWorker]
        TW -->|1. Commits| Chunks[(chunks.jsonl<br/>notes.json<br/>manifest.json)]
        
        RW[ReconciliationWorker] -.->|Reconciles drift| TW
        
        Chunks -->|2. Drains & Reads| EW[EmbeddingWorker]
        EW -->|3. Validates & Batches| AI[AI Provider<br/>Ollama / Mistral]
        AI -->|4. Checkpoints & Publishes| Canonical[(embeddings.jsonl<br/>manifest.json + publicationId)]
        
        Canonical -->|5. Signals publicationId| BW[BinaryWorker]
        BW -->|6. Compiles Float32Array| Binary[(embeddings.vectors.f32<br/>embeddings.meta.jsonl)]
    end

    subgraph Query Engine (Read-Only)
        Chunks & Canonical & Binary -->|Zero-Lock Reads| Search[Text, Semantic & Hybrid Search]
    end
```

### Dependency Rules:
1. **`TextIndexWorker` precedes `EmbeddingWorker`:** `EmbeddingWorker` never generates vectors against uncommitted text changes. It always signals `drainTextIndex` first.
2. **`EmbeddingWorker` precedes `BinaryWorker`:** `BinaryWorker` never compiles binary sets during active canonical generation. It triggers only after canonical publication is confirmed with an active `publicationId`.
3. **`ReconciliationWorker` acts on Text Index:** Startup and exclusion reconciliation feed changes into `TextIndexWorker`, which in turn marks embeddings dirty for `EmbeddingWorker`.
4. **Search is completely decoupled:** Neither `TextIndexWorker`, `EmbeddingWorker`, nor `BinaryWorker` acquire locks on read-only search operations.

---

## 8. Mobile Companion Protection

### CURRENT & TARGET Invariants for Mobile
1. **Zero Provider Maintenance Requests on Mobile:**  
   `DeviceCapabilities.canGenerateEmbeddings === false` on Mobile Companion. `MaintenanceEngine.canRun("embeddings")` immediately evaluates to `false`, blocking any execution of `EmbeddingWorker`.
2. **No Background Worker Lifecycle:**  
   `MaintenanceEngine.start()` on mobile starts zero write workers (`TextIndexWorker`, `ReconciliationWorker`, and `EmbeddingWorker` remain stopped).
3. **Synchronized Artifact Ingestion Only:**  
   Mobile Companion reads pre-computed `embeddings.jsonl` or `embeddings.vectors.f32` produced by Desktop Producer and synchronized via tools like Syncthing.
4. **Memory Guard Defense:**  
   [`embeddingResourceGuard.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingResourceGuard.ts) enforces mobile vector file limits (16MB) and peak memory allocation limits (64MB), safely falling back to text search (`no-safe-source`) if desktop-generated vector files exceed mobile device memory safety budgets.

---

## 9. Migration Strategy

To guarantee zero regressions and protect users from API costs or data loss, the migration must follow an incremental 4-step sequence:

```text
Phase A: Worker Shell & State Machine
  └─ Implement EmbeddingWorker in src/maintenance/embeddingWorker.ts
  └─ Wrap EmbeddingOperationManager and state subscriptions
  └─ Implement capability checking and mock execution ports
  └─ Unit test all states (idle, preparing, cancelling, error)

Phase B: Engine Integration & Capability Wiring
  └─ Add embeddingWorker option to MaintenanceEngineOptions
  └─ Wire start(), stop(), and dispose() lifecycle in MaintenanceEngine
  └─ Add getEmbeddingWorker() and delegate canRun("embeddings")
  └─ Unit test MaintenanceEngine with mock EmbeddingWorker

Phase C: Execution Flow Delegation (Cutover)
  └─ Move runGenerateLocalEmbeddings orchestration into EmbeddingWorker
  └─ Wire TextIndexWorker.drain, IndexWriteCoordinator locks, and BinaryWorker triggers
  └─ Route LinaPlugin.requestEmbeddingIndexGeneration to MaintenanceEngine.getEmbeddingWorker()
  └─ Verify all 58 test files and 753 unit tests pass green

Phase D: Cleanup & Documentation
  └─ Remove obsolete orchestration boilerplate from main.ts
  └─ Update architecture documentation and CHANGELOG
```

---

## 10. Testing Strategy

The migration must be validated against a comprehensive test matrix:

1. **Worker Lifecycle & State Tests (`tests/maintenance/embeddingWorker.test.ts`):**
   - Initial state is `idle`.
   - Rejects execution when `canGenerateEmbeddings === false`.
   - Correctly transitions through `preparing` -> `waiting-for-text-index` -> `validating` -> `generating` -> `persisting` -> `idle`.
   - Correctly handles cooperative cancellation via `AbortSignal` at each phase.
   - Emits progress events to registered subscribers.
2. **Coordination & Locking Tests (`tests/maintenance/maintenanceEngine.test.ts`):**
   - Verifies `MaintenanceEngine.runEmbeddingTask` interacts properly with `IndexWriteCoordinator`.
   - Confirms text rebuild blocks embedding generation, and in-flight embedding generation blocks automatic text flushes.
   - Verifies `TextIndexWorker.drain` is invoked before generation begins.
   - Verifies `BinaryWorker.maintainAfterPublication` is called upon successful publication.
3. **API Error & Circuit Breaker Tests:**
   - Verifies fatal provider errors (`authentication`, `model-not-found`) halt generation and set `lastFailureCategory`.
   - Verifies input-specific rejections allow skipping/subdivision without halting entire batch.
   - Verifies checkpoint write errors abort cleanly without corrupting canonical index.
4. **Full Regression Suite:**
   - Ensure all existing tests in `embeddingGenerator.test.ts`, `embeddingPersistence.test.ts`, `embeddingProviderValidation.test.ts`, and `deviceCapabilitiesEnforcement.test.ts` remain 100% green.

---

## 11. What Should NOT Change Yet

To keep the migration strictly focused and low-risk, the following subsystems must remain untouched during the worker migration:

- ❌ **Do NOT implement an autonomous background scheduler yet:** Background timers, idle detection, and auto-triggers belong in a subsequent phase after `EmbeddingWorker` is stabilized.
- ❌ **Do NOT rewrite `embeddingGenerator.ts`:** The core batching, candidate validation, and provider calling logic is robust and must remain a stateless functional module.
- ❌ **Do NOT modify disk storage schemas:** `.lina/index/embeddings.jsonl`, `embeddings.checkpoint.jsonl`, `manifest.json`, and `.vectors.f32` formats must remain identical.
- ❌ **Do NOT change search execution:** `RuntimeEmbeddingIndexCache`, `SemanticSearch`, and `HybridSearch` remain independent read-only modules.
- ❌ **Do NOT alter Settings UI / Declarative Composition:** Settings definitions and action buttons continue to interact via the same public plugin ports.
