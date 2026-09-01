# Lina 0.2.x --- Automation Engine and Architecture Foundation

## Objective

Lina 0.2.x evolves the existing search foundation into an automatic and
reliable maintenance architecture.

## Architectural Direction

### DeviceCapabilities Foundation (Enforced)

Lina 0.2 introduces an explicit `DeviceCapabilities` model to govern multi-device responsibilities cleanly within a single plugin codebase:

#### Desktop Producer
Desktop maintains:
-   Text index through debounced vault watchers.
-   Embeddings diff planning and batch generation.
-   Canonical embedding publication.
-   Derived binary vector artifacts and automatic repair of missing derived artifacts.
-   Startup vault diff reconciliation.

#### Mobile Companion
Mobile operates as a streamlined consumer:
-   Consumes synchronized `.lina/index/` search artifacts without running local compilation loops.
-   Performs fast local textual search.
-   Executes semantic and hybrid vector search over synchronized vector sets within strict mobile memory budgets.
-   Provides full access to AI note analysis and contextual slash commands.
-   Runtime enforcement deactivates vault write listeners, startup diff reconciliations, and manual generation pipelines on Mobile Companion, eliminating synchronization conflicts.

Mobile autonomous maintenance remains a future capability but is not part of the 0.2 baseline. Future background automation builds directly on top of this established capability foundation.

## Core Engines

### Maintenance Engine

Implemented Architecture (Desktop Producer):

-   `MaintenanceEngine`: Central coordination and capability validation boundary.
-   `TextIndexWorker`: Vault event ingestion, debouncing, batch queueing, and text index updates.
-   `ReconciliationWorker`: Startup vault drift reconciliation and dynamic exclusion policy updates.
-   `BinaryWorker`: Derived binary vector artifact validation, compilation, removal, post-publication derivation, and automatic self-healing.
-   `EmbeddingWorker`: Single-flight embedding execution orchestration, text-index draining, lock scoping, cancellation, and downstream binary handoff via injected dependency ports.
-   `EmbeddingScheduler`: Transient state model, 30-second quiet-period debounce, 300-second bounded maximum delay, dirty coalescing, manual preemption, and automatic scheduling for local Ollama on Desktop Producer.

#### Validated Architecture Phases

-   **Phase 1 — Capability Model and Device Roles (Completed):** Centralized `DeviceCapabilities` enforcing Desktop Producer and Mobile Companion roles across all runtime entry points.
-   **Phase 2 — Maintenance Engine (Completed):** Modular coordinator supervising specialized workers with isolated scheduling and execution boundaries.
-   **Phase 3 — Automatic Index Maintenance (Completed):** Debounced vault event ingestion and incremental text index maintenance on Desktop Producer.
-   **Phase 3.5 — OpenRouter AI Analysis Provider (Completed):** OpenAI-compatible chat and batch embeddings support with independent provider configuration in Settings UI.
-   **Phase 4 — Automatic Embedding Maintenance (Completed):** Outdated/missing/incompatible embedding detection, 30-second quiet-period debounce, and safe background generation for local Ollama on Desktop Producer.
-   **Phase 5 — Binary Artifact Automation (Completed):** Automated compilation, atomic publication, and startup self-healing of memory-mapped `Float32Array` vectors (`embeddings.vectors.f32`).
-   **Phase 6 — Search State Consistency (Completed):** Coherent provider transitions, published identity verification via manifest, and defensive resource-guarded loading.
-   **Phase 7 — Internal Reconciliation (Completed with future hardening items):** Startup vault drift reconciliation, runtime exclusion reconciliation, missing/outdated artifact detection, and orphan embedding purging on Desktop Producer.
-   **Phase 8 — Mobile Companion Consolidation (Completed with future synchronization hardening):** Pure read-only consumption of synchronized search artifacts on Mobile Companion, with complete deactivation of background maintenance, embedding generation, and binary compilation.
-   **Phase 9.2.1 — Settings Group Simplification (Completed):** Reorganized settings UI into three structured areas (**Basic settings**, **Advanced settings**, and **Maintenance & recovery**) to improve information hierarchy and usability while preserving all existing functionality:
    -   *Basic settings:* Current device, AI analysis, Embeddings, Inbox folder, Index, Exclusions, YAML / note properties, Multilingual, and Support.
    -   *Advanced settings:* Index diagnostics, Hybrid search, and Search storage.
    -   *Maintenance & recovery:* Search data.
    No functionality was removed, no migration is required, existing settings values continue to work, and existing providers, embeddings, indexing, search, maintenance, and recovery workflows remain unchanged.
-   **Phase 10 — Storage, Identity & Ownership Foundation (Completed):** Established clean storage partitioning, multi-device roles, active producer ownership, immutable provenance, and validation:
    -   *Phase A (Persistent Device Identity):* Stable UUID v4 generated via `crypto.randomUUID()` and stored in `app.loadLocalStorage` / `app.saveLocalStorage`.
    -   *Phase B (Device-Scoped State):* Dedicated per-device state files at `.lina/devices/<deviceId>.json` preventing sync collisions in `data.json`.
    -   *Phase C (Secret Storage Migration):* API keys migrated to Obsidian's native `app.secretStorage` and purged from `data.json`.
    -   *Phase D1 & D1.1 (Device Role Model & Neutral Role):* Operational roles (`"producer"` / `"companion"`) stored in per-device state with unassigned first-run behavior.
    -   *Phase D2.1 (Ownership Manifest Service):* Shared `.lina/ownership.json` manifest with single active producer and monotonic epoch fencing.
    -   *Phase D2.2 (Worker Ownership Gating):* Single-active-producer write authorization checks across all index and embedding workers.
    -   *Phase D2.3 (Artifact Provenance Tracking):* Immutable `producerDeviceId`, `producerEpoch`, and `generatedAt` stamped into shared manifests with 100% backward compatibility.
    -   *Phase D2.3.1 (Artifact Provenance Validation Audit):* Pure evaluation model (`valid`, `stale`, `unknown`, `future`) with non-blocking usability and zero automatic repair.
    -   *Phase D2.4.1 (Internal Diagnostics Model Foundation):* Pure read-only diagnostics model aggregating device identity, active producer ownership, and multi-artifact provenance states.
    -   *Phase D2.4.2 (Diagnostics UI / Status Panel):* Read-only status panel modal (`DeviceDiagnosticsModal`) triggered by command `"mostrar-diagnostico-dispositivo"`.

#### Provider Capabilities

| Provider | Analysis / Chat | Embeddings | Automatic embedding maintenance |
| :--- | :---: | :---: | :--- |
| **Ollama** | Supported | Supported | Supported on Desktop Producer |
| **Mistral** | Supported | Supported | Manual only |
| **OpenRouter** | Supported | Supported | Manual only |

Future Automation Phases:

-   Phase 2.3: Remote provider safeguards and circuit breakers for Mistral and OpenRouter.
-   Phase 2.4: Explicit opt-in remote automatic embedding maintenance for Mistral and OpenRouter.
-   Phase 2.5: Multi-device synchronization hardening, conflict markers, and richer sync status.

### Query Engine

Provides:

-   Text search.
-   Semantic search.
-   Hybrid search.

### AI Engine

Provides:

-   Provider communication.
-   Query embeddings.
-   AI analysis.

## Main Objectives

-   Remove manual maintenance during normal usage.
-   Preserve data integrity.
-   Improve synchronization safety.
-   Reduce unnecessary API usage.
-   Maintain diagnostic and recovery tools.

## Settings Strategy

Settings are organized into three structured areas for usability and clear information hierarchy:
- **Basic settings:** Normal user-facing configuration (**Current device**, **AI analysis**, **Embeddings**, **Inbox folder**, **Index**, **Exclusions**, **YAML / note properties**, **Multilingual**, and **Support**).
- **Advanced settings:** Technical options for experienced users (**Index diagnostics**, **Hybrid search**, and **Search storage**).
- **Maintenance & recovery:** Recovery and diagnostic operations (**Search data** with confirmation safeguards and destructive action protections).

The Settings reorganization is a presentation and usability improvement. No functionality was removed, no migration is required, existing settings values continue to work, and existing providers, embeddings, indexing, search, maintenance, and recovery workflows remain unchanged.

## Roadmap Policy

Phases describe architectural goals and do not directly represent
release numbers.
