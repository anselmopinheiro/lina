# Lina Architecture — Maintenance Engine & Worker Architecture

**Status:** Current Architecture Specification (Lina 0.2)
**Scope:** MaintenanceEngine coordinator, specialized worker architecture (`TextIndexWorker`, `ReconciliationWorker`, `BinaryWorker`, `EmbeddingWorker`, `EmbeddingScheduler`), Desktop Producer execution, capability gating, and component boundaries.

---

## 1. Overview & Architectural Role

Lina 0.2 establishes a unified **Maintenance Engine** architecture running on the **Desktop Producer**. 

Previously, maintenance tasks—vault event debouncing, batch queue flushing, startup reconciliation, exclusion policy updates, embedding generation, and binary compilation—were directly orchestrated across `main.ts` and disparate controller objects.

The Maintenance Engine introduces a clean coordination layer:
- **Centralized Coordination Boundary:** A single `MaintenanceEngine` coordinator owns the lifecycle (`start`, `dispose`), state tracking (`idle`, `indexing`, `reconciling`, `compiling-binary`, `error`), operation gating, and public worker/scheduler operational APIs.
- **Specialized Worker & Policy Architecture:** Distinct worker modules encapsulate the scheduling, lifecycle, and event handling for specific maintenance domains.
- **Decoupled Scheduling vs. Execution:** Responsibility is strictly split between determining *when* work is eligible ([`EmbeddingScheduler`](#35-embeddingscheduler-ollama-automatic-policy)) and *how* generation executes ([`EmbeddingWorker`](#34-embeddingworker)).
- **Decoupled Status Derivation:** Compatibility and work status are derived from local manifests and artifacts independently of provider execution. Refreshing status never by itself calls a provider or starts generation.
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
        ┌───────────────────┬───────────────┼───────────────┬───────────────────┐
        ▼                   ▼               ▼               ▼                   ▼
┌───────────────┐   ┌───────────────┐┌──────────────┐┌───────────────┐   ┌───────────────┐
│TextIndexWorker│   │ReconciliationW││ BinaryWorker ││EmbeddingWorker│   │EmbeddingSched.│
│               │   │               ││              ││               │   │ (Ollama Auto) │
│• Vault Events │   │• Startup Recon││• Binary Check││• Single-Flight│   │• Quiet Timer  │
│• Debouncing   │   │• Policy Recon ││• Compile F32 ││• Text Drain   │   │• Coalescing   │
│• Batch Queue  │   │• Queue Wait   ││• Post-Publish││• Lock Scoping │   │• Fresh Diff   │
│• Flush Timing │   │• Drift Sync   ││• Teardown    ││• Binary Handoff│  │• Auto Dispatch│
└───────────────┘   └───────────────┘└──────────────┘└───────────────┘   └───────────────┘
```

---

## 2. MaintenanceEngine Coordinator

The [`MaintenanceEngine`](file:///d:/_dev/obsidian/lina/src/maintenance/maintenanceEngine.ts) class serves as the top-level supervisor for producer-side maintenance.

### 2.1 Responsibilities
1. **Capability Validation:** Validates incoming operations against resolved `DeviceCapabilities` via `canRun(operation)`. Operations for which the current device lacks capabilities are safely rejected or no-oped.
2. **Lifecycle Supervision:** Manages startup (`start()`) and teardown (`dispose()`) across all registered workers and schedulers.
3. **State & Task Tracking:** Exposes a unified `MaintenanceEngineState` indicating current status (`idle`, `indexing`, `reconciling`, `compiling-binary`, `error`), active task name, and the last observed error message.
4. **Guarded Worker Gateways:** Exposes typed operational APIs for text indexing, reconciliation, binary maintenance, embedding execution, and scheduling policy.

### 2.2 Operation Matrix & Capability Guarding

| Operation Key | Required Capability | Gated Worker / Subsystem | Behavior on Mobile Companion |
| :--- | :--- | :--- | :--- |
| `vault-events` | `canWatchVaultEvents` & `canMaintainTextIndex` | `TextIndexWorker` (vault event listeners) | Listeners not attached; zero watcher overhead. |
| `text-index` | `canMaintainTextIndex` | `TextIndexWorker` (automatic batch flushing & rebuild) | Rejected; index writes prohibited. |
| `startup-reconciliation` | `canReconcileStartupDiffs` | `ReconciliationWorker` (startup & exclusion scans) | No-op; startup scans disabled. |
| `binary-copy` | `canMaintainBinaryCopy` | `BinaryWorker` (create, update, remove, post-publish) | Read-only check allowed; writes/compilation blocked. |
| `embeddings` | `canGenerateEmbeddings` | `EmbeddingWorker` & `EmbeddingScheduler` | Blocked; mobile consumes synchronized vectors only. |

### 2.3 Public Embedding Operations & Scheduling API

The `MaintenanceEngine` exposes the operational surface of `EmbeddingWorker` and `EmbeddingScheduler` to host callers (`main.ts`, UI commands, search sidebar):
- `requestEmbeddingGeneration(origin, onProgress)`: Preempts any pending automatic scheduler timers and initiates single-flight embedding generation with capability checks, text-index draining, mutex coordination, and binary compilation handoff.
- `getEmbeddingOperationState()`: Returns the detailed operation phase and progress state from `EmbeddingWorker`.
- `onEmbeddingOperationStateChange(listener)`: Subscribes reactive UI views to operation phase transitions.
- `cancelEmbeddingGeneration()`: Gracefully requests cancellation of active generation runs.
- `getEmbeddingWorker()` / `getEmbeddingState()`: Exposes worker reference and high-level worker status (`idle`, `running`, `error`).
- `getEmbeddingScheduler()` / `getEmbeddingSchedulerState()`: Exposes scheduler reference and transient scheduling status (`disabled`, `clean`, `dirty`, `scheduled`, `paused`).
- `markEmbeddingSchedulerDirty()`: Informs the scheduler that text or vault changes have occurred.
- `preemptEmbeddingSchedulerForManual()`: Clears scheduled countdown timers when a manual execution is requested.

---

## 3. Specialized Worker & Policy Architecture

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
* **Compilation & Updates:** Coordinates `createOrUpdate()` to compile canonical JSONL embeddings into contiguous binary files when requested or automatically downstream from publication.
* **Automatic Repair:** Automatically detects and repairs missing or incomplete derived binary search data on Desktop Producer.
* **Artifact Removal:** Safely coordinates `remove()` with proper runtime index invalidation.
* **Post-Publication Maintenance:** Coordinates `maintainAfterPublication(publicationId)` triggered downstream after canonical publication lock release.
* **Component Delegation:** Coordinates calls to `BinaryEmbeddingCopyController` and `embeddingBinaryStorage.ts` while tracking worker status (`compiling-binary`).

### 3.4 EmbeddingWorker
The [`EmbeddingWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingWorker.ts) is the authoritative owner of producer-side embedding maintenance and execution.

* **Execution Orchestration:** Coordinates the complete manual embedding generation workflow using injected dependency ports ([`EmbeddingWorkerOptions`](embedding-worker.md#4-dependency-ports-and-architectural-invariants)).
* **Single-Flight & Mutex Scoping:** Owns the single-flight operation state machine, reserves preparation locks, and holds exclusive generation writer tokens only during vector computation.
* **Text Index Draining:** Automatically awaits pending batches in `TextIndexWorker` before starting vector computations.
* **Publication & Binary Handoff:** Finalizes canonical publications and triggers downstream `BinaryWorker` compilation after the canonical writer lock is released.
* **Decoupled Architecture:** Coordinates existing, proven modules ([`embeddingGenerator.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingGenerator.ts), [`embeddingUpdatePlan.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingUpdatePlan.ts), [`embeddingPersistence.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts)) without owning or duplicating mathematical algorithms or storage formats.

### 3.5 EmbeddingScheduler (Ollama Automatic Policy)
The [`EmbeddingScheduler`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingScheduler.ts) encapsulates the timing and policy for automatic embedding maintenance.

* **Responsibility Boundary:** Determines **when** embedding maintenance is eligible; it owns zero execution, provider calls, lock acquisitions, or publications.
* **Transient State Model:** Exposes `EmbeddingSchedulerState` (`disabled`, `clean`, `dirty`, `scheduled`, `paused`) and readiness tracking.
* **Quiet-Period & Coalescing Policy:** Implements a 30-second quiet-period debounce timer that resets on successive dirty signals, backed by a 300-second bounded maximum delay timer.
* **Fresh Canonical Update-Plan Check:** Validates derived embedding work (`hasEmbeddingWork`) against index artifacts before dispatching, preventing redundant background runs.
* **Controlled Local Dispatch (Ollama):** Dispatches automatic maintenance via `MaintenanceEngine.requestEmbeddingGeneration("automatic")` to `EmbeddingWorker` exclusively for the local Ollama provider on Desktop Producer.
* **Remote Provider Safeguard:** Mistral and OpenRouter remain strictly manual-only; remote automation is not dispatched.
* **Manual Preemption:** Clears pending timers immediately when manual execution is triggered (`preemptForManual()`).
* **Capability Gating:** Deactivated on Mobile Companion devices (`canScheduleEmbeddings === false`).
* **Post-Publication Status Convergence:** Following successful canonical publication, derived embedding status is automatically recalculated for UI subscribers without requiring manual refresh.

---

## 4. Key Architectural Invariants & Rules

To ensure long-term stability and prevent regressions during ongoing refactoring, the Maintenance Engine enforces the following invariants:

1. **Workers Coordinate Existing Components:**  
   Workers own lifecycle, scheduling, queueing, and error handling. They do **not** re-implement low-level indexing, chunking (`chunker.ts`), hashing (`noteHasher.ts`), storage (`indexStore.ts`), or binary serialization (`embeddingBinaryStorage.ts`).
2. **Storage Formats Remain Unchanged:**  
   All on-disk artifact formats (`.lina/index/manifest.json`, `notes.json`, `chunks.jsonl`, `embeddings.jsonl`, `embeddings.vectors.f32`) remain strictly identical. No database format or schema migrations are introduced by worker migrations.
3. **Search Remains Completely Independent:**
   Query execution (`TextSearchEngine`, `SemanticSearch`, `HybridSearch`) remains fully decoupled from the Maintenance Engine. Search is read-only, operates directly against in-memory/on-disk data, and never acquires maintenance locks or depends on worker lifecycles.
4. **Execution vs. Scheduling Separation:**
   `EmbeddingWorker` is the sole execution owner for both manual and automatic runs, managing mutex locks and single-flight execution. `EmbeddingScheduler` owns the timing policy and dispatches to `MaintenanceEngine.requestEmbeddingGeneration("automatic")`.
5. **Canonical Publication Precedes Binary Handoff:**
   Canonical `embeddings.jsonl` publication commits and releases its lock before `BinaryWorker` begins compilation, ensuring binary failures never impact canonical vector integrity.
6. **Mobile Companion Does Not Execute Producer Maintenance:**
   Mobile devices operate as read-only companions. All write operations, event watchers, diff reconciliations, schedulers, and compilation workers are inactive on mobile devices.
7. **Identity Diagnosis Precedes Detailed Inspection:**
   Published embedding provider/model identity is available from the manifest even when the resource guard prevents full JSONL inspection. Incompatible identity yields a full-rebuild plan; compatible but unreadable details remain indeterminate.
8. **Bounded Local Persistence Retry:**
   Atomic embedding/checkpoint renames retry only short-lived Windows `EBUSY`/`EPERM` failures within a bounded local policy. Provider generation is not repeated, file formats remain unchanged, and retry exhaustion is reported as a filesystem persistence failure.

---

## 5. Current State vs. Target Architecture

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CURRENT IMPLEMENTATION                                      │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ • MaintenanceEngine coordinates TextIndexWorker, ReconciliationWorker, BinaryWorker,              │
│   EmbeddingWorker, and EmbeddingScheduler (Ollama automatic policy) on Desktop Producer.          │
│ • TextIndexWorker handles vault events, debouncing, queueing, and flush coordination.             │
│ • ReconciliationWorker handles startup and exclusion drift reconciliation.                       │
│ • BinaryWorker handles binary validation, compilation, removal, and post-publication maintenance. │
│ • EmbeddingWorker owns single-flight execution, text drain, lock scoping, & binary handoff.       │
│ • EmbeddingScheduler provides quiet-period debounce, coalescing, and automatic Ollama dispatch.   │
│ • Mistral and OpenRouter remain strictly manual-only.                                             │
│ • DeviceCapabilities strictly gates producer maintenance away from Mobile Companion.              │
│ • Canonical storage schemas and search engines remain independent and intact.                     │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         TARGET EVOLUTION                                          │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ • Phase 2.3: Remote provider cost safeguards, per-run batch caps, and circuit breakers.           │
│ • Phase 2.4: Opt-in automatic maintenance for remote providers (Mistral, OpenRouter).            │
│ • Phase 2.5: Multi-device sync zero-diff detection and checkpoint resumption hardening.          │
│ • Phase 2.6: Settings UI simplification (transitioning technical tools to advanced view).         │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Dimension | CURRENT State (Lina 0.2 Maintenance & Ollama Automation) | TARGET State (Lina 0.2 Autonomous Maintenance) |
| :--- | :--- | :--- |
| **Coordination Boundary** | `MaintenanceEngine` supervises `TextIndexWorker`, `ReconciliationWorker`, `BinaryWorker`, `EmbeddingWorker`, and `EmbeddingScheduler`. | `MaintenanceEngine` supervises all workers with complete multi-provider background automation. |
| **Text Indexing** | Coordinated by `TextIndexWorker` with debounced vault listeners. | Autonomous text indexing with sharded chunk storage for very large vaults. |
| **Reconciliation** | Coordinated by `ReconciliationWorker` at startup (5s grace) and on exclusion change. | Periodic background health checks and autonomous self-healing reconciliation. |
| **Binary Artifacts** | Coordinated by `BinaryWorker` (manual actions + post-publication trigger). | Fully autonomous compilation integrated with background embedding scheduler. |
| **Embedding Generation** | Coordinated by `EmbeddingWorker` (manual triggers + automatic Ollama scheduler on Desktop Producer); remote providers remain manual. | Fully autonomous background embedding scheduler with remote opt-in caps and safeguards. |
| **Mobile Companion** | Read-only consumption; producer maintenance workers and schedulers inactive. | Read-only consumption preserved; optional lightweight sync status indicators. |
