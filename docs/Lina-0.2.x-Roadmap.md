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

#### Phase 4 — Automatic Embedding Maintenance (Status: Completed)

-   **Missing Embedding Detection:** Automatically identifies chunks and notes lacking vector embeddings.
-   **Outdated Embedding Detection:** Detects note content edits via hash diffs and triggers incremental updates.
-   **Incompatible Embedding Detection:** Detects changes in provider, model, dimensions, or prefix mode and enforces clean rebuilds without mixing incompatible vector spaces.
-   **Safe Background Generation:** Governed by single-flight locks, 30-second quiet-period debounce, text-index drain coordination, and cooperative cancellation.
-   **Provider-Aware Automation Policies & Cost Protection:** Automatic background maintenance is enabled exclusively for local Ollama on Desktop Producer; remote providers (Mistral, OpenRouter) remain strictly manual-only to prevent unexpected API costs.
-   **Recovery & Checkpoint Resumption:** Resumes interrupted operations seamlessly from disk checkpoints, with atomic publication, rollback on error, and automatic self-healing of derived binary artifacts.
-   **Binary Artifact Handoff:** Canonical embedding publication automatically triggers downstream compilation of memory-mapped `Float32Array` vectors without manual intervention.

#### Provider Capabilities

| Provider | Analysis / Chat | Embeddings | Automatic embedding maintenance |
| :--- | :---: | :---: | :--- |
| **Ollama** | Supported | Supported | Supported on Desktop Producer |
| **Mistral** | Supported | Supported | Manual only |
| **OpenRouter** | Supported | Supported | Manual only |

-   Phase 2.2D (Implemented): OpenRouter AI analysis and embeddings capability alignment, OpenAI-compatible chat and batch embeddings clients, independent settings provider configuration, and `openai/text-embedding-3-small` default embedding model.
-   Phase 2.2E1–E3 (Implemented): Coherent provider/model/Base URL transitions, immediate derived-state invalidation, manifest-level published identity diagnosis, resource-guard-safe readability states (`missing`, `empty`, `readable`, `unreadable`), and consistent sidebar/semantic availability reporting.

Future Automation Phases:

-   Phase 2.3: Remote provider safeguards and circuit breakers for Mistral and OpenRouter.
-   Phase 2.4: Explicit opt-in remote automatic embedding maintenance for Mistral and OpenRouter.
-   Phase 2.5: Multi-device sync zero-diff detection (Syncthing/Obsidian Sync) and checkpoint resumption hardening.
-   Phase 2.6: Settings UI simplification (transitioning technical maintenance tools to advanced view).

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

Settings simplification happens after the architecture is stable.

Technical maintenance actions remain available as advanced tools.

## Roadmap Policy

Phases describe architectural goals and do not directly represent
release numbers.
