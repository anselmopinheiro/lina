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
-   Derived binary vector artifacts.
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

Implemented Foundation (Desktop Producer):

-   `MaintenanceEngine`: Central coordination and capability validation boundary.
-   `TextIndexWorker`: Vault event ingestion, debouncing, batch queueing, and text index updates.
-   `ReconciliationWorker`: Startup vault drift reconciliation and dynamic exclusion policy updates.
-   `BinaryWorker`: Derived binary vector artifact validation, compilation, removal, and post-publication sync.
-   `EmbeddingWorker`: Single-flight embedding execution orchestration, text-index draining, lock scoping, cancellation, and downstream binary handoff via injected dependency ports.
-   `EmbeddingScheduler`: Transient state model, 30-second quiet-period debounce, dirty coalescing, and manual preemption foundation (automatic embedding execution remains disabled).

Future Automation Phases:

-   Phase 2.2: Controlled local-provider (Ollama) automatic embedding execution on Desktop Producer.
-   Phase 2.3: Remote provider cost safeguards, pre-flight estimation, per-run batch caps (e.g., 50 chunks), and circuit breakers.
-   Phase 2.4: Opt-in automatic maintenance for remote providers (Mistral, OpenRouter) with user confirmation.
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
