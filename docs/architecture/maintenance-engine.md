# Lina Architecture — Maintenance Engine & Worker Architecture

**Status:** Current Architecture Specification (Lina 0.2 Foundation)  
**Scope:** MaintenanceEngine coordinator, specialized worker architecture (`TextIndexWorker`, `ReconciliationWorker`, `BinaryWorker`), Desktop Producer execution, capability gating, and component boundaries.

---

## 1. Overview & Architectural Role

Lina 0.2 establishes a unified **Maintenance Engine** architecture running on the **Desktop Producer**. 

Previously, maintenance tasks—vault event debouncing, batch queue flushing, startup reconciliation, exclusion policy updates, embedding generation, and binary compilation—were directly orchestrated across `main.ts` and disparate controller objects.

The Maintenance Engine introduces a clean coordination layer:
- **Centralized Coordination Boundary:** A single `MaintenanceEngine` coordinator owns the lifecycle (`start`, `dispose`), state tracking (`idle`, `indexing`, `reconciling`, `compiling-binary`, `error`), and operation gating.
- **Specialized Worker Architecture:** Distinct worker modules encapsulate the scheduling, lifecycle, and event handling for specific maintenance domains.
- **Port-Based Component Reuse:** Workers coordinate existing, proven functional modules (such as index storage, chunkers, hashers, and coordinators) without altering storage schemas, on-disk formats, or search execution.

```text
                               ┌─────────────────────────┐
                               │       LinaPlugin        │
                               └────────────┬────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │    MaintenanceEngine    │
                               │   (Desktop Producer)    │
                               └────────────┬────────────┘
                                            │
        ┌───────────────────┬───────────────┴───────────────┬───────────────────┐
        ▼                   ▼                               ▼                   ▼
┌───────────────┐   ┌───────────────┐               ┌───────────────┐   ┌───────────────┐
│TextIndexWorker│   │ReconciliationW│               │ BinaryWorker  │   │EmbeddingWorker│
│               │   │               │               │               │   │ (Foundation)  │
│• Vault Events │   │• Startup Recon│               │• Binary Check │   │• Lifecycle    │
│• Debouncing   │   │• Policy Recon │               │• Compile F32  │   │• State Model  │
│• Batch Queue  │   │• Queue Wait   │               │• Post-Publish │   │• Cap Gating   │
└───────────────┘   └───────────────┘               └───────────────┘   └───────────────┘
```

---

## 2. MaintenanceEngine Coordinator

The [`MaintenanceEngine`](file:///d:/_dev/obsidian/lina/src/maintenance/maintenanceEngine.ts) class serves as the top-level supervisor for producer-side maintenance.

### 2.1 Responsibilities
1. **Capability Validation:** Validates incoming operations against resolved `DeviceCapabilities` via `canRun(operation)`. Operations for which the current device lacks capabilities are safely rejected or no-oped.
2. **Lifecycle Supervision:** Manages startup (`start()`) and teardown (`dispose()`) across all registered workers.
3. **State & Task Tracking:** Exposes a unified `MaintenanceEngineState` indicating current status (`idle`, `indexing`, `reconciling`, `compiling-binary`, `error`), active task name, and the last observed error message.
4. **Single Execution Gateway:** Provides guarded execution helpers (`runTextIndexTask`, `runReconciliationTask`, `runBinaryTask`) that manage status transitions and error handling consistently.

### 2.2 Operation Matrix & Capability Guarding

| Operation Key | Required Capability | Gated Worker / Subsystem | Behavior on Mobile Companion |
| :--- | :--- | :--- | :--- |
| `vault-events` | `canWatchVaultEvents` & `canMaintainTextIndex` | `TextIndexWorker` (vault event listeners) | Listeners not attached; zero watcher overhead. |
| `text-index` | `canMaintainTextIndex` | `TextIndexWorker` (automatic batch flushing & rebuild) | Rejected; index writes prohibited. |
| `startup-reconciliation` | `canReconcileStartupDiffs` | `ReconciliationWorker` (startup & exclusion scans) | No-op; startup scans disabled. |
| `binary-copy` | `canMaintainBinaryCopy` | `BinaryWorker` (create, update, remove, post-publish) | Read-only check allowed; writes/compilation blocked. |
| `embeddings` | `canGenerateEmbeddings` | `EmbeddingWorker` (foundation lifecycle active; execution upstream) | Blocked; mobile consumes synchronized vectors only. |

---

## 3. Specialized Worker Architecture

### 3.1 TextIndexWorker
The [`TextIndexWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/textIndexWorker.ts) coordinates vault event ingestion and text index synchronization.

* **Vault Event Handling:** Listens to Obsidian vault events (`create`, `modify`, `delete`, `rename`). Modify events are routed through a path-scoped debouncer (2000ms delay) to prevent thrashing during active editing.
* **Batch Coalescing & Queueing:** Coalesces rapid sequential changes per note into a pending updates queue (`Map<string, TextIndexAutomaticUpdate>`).
* **Flush Scheduling:** Schedules periodic flushes (1000ms timer) once the indexing subsystem is marked ready.
* **Drain Coordination:** Provides `drainAutomaticUpdatesBeforeEmbeddingGeneration(signal)` to ensure all pending text changes are fully indexed and committed before an embedding operation proceeds.
* **Component Delegation:** Delegates actual text chunking, hashing, and candidate activation to the host's `runAutomaticBatch` handler and `IndexWriteCoordinator`.

### 3.2 ReconciliationWorker
The [`ReconciliationWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/reconciliationWorker.ts) coordinates integrity verification and drift reconciliation between vault Markdown files and the indexed note registry.

* **Startup Reconciliation:** Coordinates the post-startup reconciliation routine (executed after a 5-second grace period) to detect notes added, modified, or deleted while Obsidian was closed.
* **Exclusion Policy Reconciliation:** Coordinates dynamic index purging and restoration when path or term exclusion settings are modified by the user.
* **Sequential Execution:** Chains exclusion updates behind in-flight automatic update batches (`waitForAutomaticUpdates`) to guarantee deterministic index states.
* **Component Delegation:** Invokes host-provided reconciliation algorithms via injected ports while managing worker lifecycle and state transitions.

### 3.3 BinaryWorker
The [`BinaryWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/binaryWorker.ts) manages the derived binary vector artifact (`Float32Array` buffers) used for hardware-accelerated vector loading.

* **Integrity Validation:** Provides `check()` to verify the presence, readability, and publication ID alignment of `embeddings.vectors.f32`, `embeddings.meta.jsonl`, and `embeddings.binary.manifest.json`.
* **Compilation & Updates:** Coordinates `createOrUpdate()` to compile canonical JSONL embeddings into contiguous binary files when requested.
* **Artifact Removal:** Safely coordinates `remove()` with proper runtime index invalidation.
* **Component Delegation:** Coordinates calls to `BinaryEmbeddingCopyController` and `embeddingBinaryStorage.ts` while tracking worker status (`compiling-binary`).

### 3.4 EmbeddingWorker (Foundation Only)
The [`EmbeddingWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingWorker.ts) introduces the lifecycle and state boundary for producer-side embedding maintenance.

* **Architectural Foundation:** Establishes the worker lifecycle (`start()`, `stop()`, `dispose()`), capability gating (`canGenerateEmbeddings`), and state model (`idle`, `running`, `error`).
* **Execution Boundary:** Concrete embedding generation, batch looping, and checkpointing currently remain in existing upstream modules ([`LinaPlugin`](file:///d:/_dev/obsidian/lina/main.ts#L842), [`embeddingGenerator.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingGenerator.ts), [`EmbeddingOperationManager.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingOperationManager.ts)).
* **Target Destination:** Full execution flow migration and autonomous background scheduling will be introduced in subsequent phases.

For full details on the worker contract and lifecycle, see the [EmbeddingWorker Architecture Specification](embedding-worker.md).

---

## 4. Key Architectural Invariants & Rules

To ensure long-term stability and prevent regressions during ongoing refactoring, the Maintenance Engine enforces the following invariants:

1. **Workers Coordinate Existing Components:**  
   Workers own lifecycle, scheduling, queueing, and error handling. They do **not** re-implement low-level indexing, chunking (`chunker.ts`), hashing (`noteHasher.ts`), storage (`indexStore.ts`), or binary serialization (`embeddingBinaryStorage.ts`).
2. **Storage Formats Remain Unchanged:**  
   All on-disk artifact formats (`.lina/index/manifest.json`, `notes.json`, `chunks.jsonl`, `embeddings.jsonl`, `embeddings.vectors.f32`) remain strictly identical. No database format or schema migrations are introduced by worker migrations.
3. **Search Remains Completely Independent:**  
   Query execution (`TextSearchEngine`, `SemanticSearch`, `HybridSearch`) remains fully decoupled from the Maintenance Engine. Search is read-only, operates directly against in-memory/on-disk data, and never acquires maintenance locks or depends on worker lifecycles.
4. **EmbeddingWorker Foundation Active (Execution Migration Future):**
   The lifecycle and capability boundary of `EmbeddingWorker` is integrated into `MaintenanceEngine`, but the concrete embedding generation loop (`EmbeddingOperationManager`, `embeddingGenerator.ts`) currently remains coordinated at the plugin level. Execution migration is planned as a future step.
5. **Mobile Companion Does Not Execute Producer Maintenance:**  
   Mobile devices operate as read-only companions. All write operations, event watchers, diff reconciliations, and compilation workers are inactive on mobile devices.

---

## 5. Current State vs. Target Architecture

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CURRENT IMPLEMENTATION                                      │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ • MaintenanceEngine foundation active on Desktop Producer.                                        │
│ • TextIndexWorker handles vault events, debouncing, queueing, and flush coordination.             │
│ • ReconciliationWorker handles startup and exclusion drift reconciliation.                       │
│ • BinaryWorker handles binary validation, compilation, removal, and post-publication maintenance. │
│ • DeviceCapabilities strictly gates producer maintenance away from Mobile Companion.              │
│ • Canonical storage schemas and search engines remain independent and intact.                     │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         TARGET EVOLUTION                                          │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ • EmbeddingWorker migration: Encapsulate embedding diff planning, batching, and checkpoints.     │
│ • Background Scheduler: Autonomous embedding generation during system idle periods.              │
│ • Automated Recovery: Self-healing integrity verification on detected index or vector drift.      │
│ • Sharded Chunk Storage: Partitioned chunk files to optimize large-scale vault operations.        │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Dimension | CURRENT State (Lina 0.2 Maintenance Foundation) | TARGET State (Lina 0.2 Autonomous Maintenance) |
| :--- | :--- | :--- |
| **Coordination Boundary** | `MaintenanceEngine` supervises `TextIndexWorker`, `ReconciliationWorker`, `BinaryWorker`, and `EmbeddingWorker` (foundation). | `MaintenanceEngine` supervises all workers including migrated `EmbeddingWorker` and `SchedulerWorker`. |
| **Text Indexing** | Coordinated by `TextIndexWorker` with debounced vault listeners. | Autonomous text indexing with sharded chunk storage for very large vaults. |
| **Reconciliation** | Coordinated by `ReconciliationWorker` at startup (5s grace) and on exclusion change. | Periodic background health checks and autonomous self-healing reconciliation. |
| **Binary Artifacts** | Coordinated by `BinaryWorker` (manual actions + post-publication trigger). | Fully autonomous compilation integrated with background embedding scheduler. |
| **Embedding Generation** | `EmbeddingWorker` foundation active; generation execution currently upstream via `EmbeddingOperationManager`. | Full `EmbeddingWorker` execution migration with conservative autonomous background scheduler. |
| **Mobile Companion** | Read-only consumption; producer maintenance workers inactive. | Read-only consumption preserved; optional lightweight sync status indicators. |
