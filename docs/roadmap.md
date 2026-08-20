# Lina Roadmap

## Vision

Lina aims to evolve into an intelligent layer for Obsidian, reducing manual configuration while making search, indexing, embeddings, and AI features simpler and more transparent.

Development follows three core principles:

* protect the user's data and vault;
* keep behavior predictable, transparent, and controllable;
* progressively align Lina with the technical practices and expectations of the Obsidian community.

This roadmap describes the current direction of the project. Version numbers below represent development series rather than rigid release commitments. Intermediate releases may be published whenever needed for fixes, stabilization, or smaller improvements.

---

# 0.1.x — Stabilization, Technical Quality, and Integrity

## Goal

Consolidate Lina's current foundation before introducing deeper automation.

This series focuses on known bugs, data integrity, code quality, and issues identified by development tooling and Obsidian-specific rules and practices.

**Current status:** incremental text-index updates, rename and move integrity, and recognition of synchronized indexes are implemented. This series now focuses on continuous stabilization, data integrity, and technical quality.

## Technical quality and Obsidian compliance

Priorities include:

* fix current ESLint errors;
* review and address relevant warnings from Obsidian-specific lint rules;
* review unsafe types, casts, and error-prone type handling;
* verify correct plugin lifecycle and resource cleanup;
* keep lint, typecheck, tests, build, release checks, and CI healthy;
* avoid cosmetic refactors or abstractions without a concrete benefit.

The goal is not to artificially reach “zero warnings”. Relevant issues should be fixed, while justified exceptions may remain documented.

## Search and exclusions

Improve runtime reconciliation when exclusion settings change.

When a folder or rule becomes excluded, Lina should update its state without requiring an Obsidian or vault restart.

This includes:

* removing affected notes from the index;
* invalidating related chunks;
* invalidating or removing associated embeddings when applicable;
* updating derived artifacts when required.

When an exclusion is removed, Lina should detect content that becomes eligible again and process it automatically.

## Note rename and move integrity

Text-index integrity for rename and move operations is implemented across Lina's internal data.

Lina now:

* remove references to the old path;
* update the index with the new path;
* invalidate obsolete chunks;
* update embeddings when required;
* remove orphaned references;
* prevent search results that point to files that no longer exist.

## Synchronized indexes across devices

Lina recognizes and uses existing indexes synchronized across devices, particularly on Mobile.

Lina distinguishes between:

* an index that does not exist;
* an index created or received from another device;

* an index that does not exist;
* an index created or received from another device;
* an existing but outdated index.

This supports synchronized artifacts, including workflows using tools such as Syncthing, without unnecessary rebuilds.

---

# 0.2.x — Automation Engine & Maintenance Architecture Foundation

## Goal

Establish a robust architectural foundation with an explicit **Device Capabilities Model** (Desktop Producer / Mobile Companion) and a modular **Maintenance Engine** worker architecture, building toward autonomous, reliable maintenance of embeddings and derived search artifacts.

## Device Capabilities & Role Enforcement (Implemented)

Lina introduces a centralized `DeviceCapabilities` model to cleanly define and enforce platform responsibilities across a single plugin codebase:

* **Desktop Producer:** Watches vault file changes, maintains the primary text index, performs startup diff reconciliations, generates vector embeddings, and creates and automatically repairs derived binary search artifacts.
* **Mobile Companion:** Consumes synchronized `.lina/index/` search artifacts, executes fast local text search, runs semantic/hybrid vector search within strict mobile memory limits, and accesses optional AI features.
* **Runtime Enforcement:** Automatically deactivates vault event watchers, startup diff reconciliations, and manual generation pipelines on Mobile Companion devices, eliminating multi-device synchronization race conditions.

## Maintenance Engine & Worker Architecture (Implemented)

Producer maintenance flows are orchestrated through a centralized `MaintenanceEngine` supervising specialized worker modules:

* **Text Index Maintenance (`TextIndexWorker`):** Coordinates vault event ingestion (`create`, `modify`, `delete`, `rename`), path-scoped debouncing (2000ms delay), batch queueing, coalescing, and scheduled flushes (1000ms timer) on Desktop Producer. Incremental updates are preferred over full rebuilds.
* **Vault Drift & Policy Reconciliation (`ReconciliationWorker`):** Coordinates startup diff reconciliation (after a 5-second grace period) and dynamic exclusion policy updates behind injected host ports.
* **Binary Artifact Management (`BinaryWorker`):** Coordinates validation, compilation, teardown, post-publication updates, and automatic repair of derived binary vector artifacts (`Float32Array`).
* **Embedding Execution Orchestration (`EmbeddingWorker`):** Coordinates single-flight embedding execution, text-index draining, mutex lock scoping, canonical publication, error propagation, and downstream binary handoff via injected dependency ports for both manual and automatic maintenance.
* **Embedding Scheduling (`EmbeddingScheduler`):** Implements transient state tracking, 30-second quiet-period debounce, dirty coalescing, manual preemption, and automatic dispatch for local Ollama on Desktop Producer.

## Phase 2.2 — Controlled Local-Provider (Ollama) Automation (Implemented)

Automatic embedding generation is enabled by default for local Ollama on Desktop Producer. 30 seconds after editing ceases (backed by a 300-second maximum-delay timer), if fresh work is derived, `EmbeddingScheduler` dispatches generation to `EmbeddingWorker`. Canonical publication releases locks, triggers downstream binary compilation, and recalculates derived status for UI subscribers without requiring manual refresh. Mistral and OpenRouter remain manual-only.

## Phase 2.2D — OpenRouter Embeddings Capability Alignment (Implemented)

Implemented manual batch embeddings support for OpenRouter using its OpenAI-compatible endpoint (`https://openrouter.ai/api/v1/embeddings`), configured `openai/text-embedding-3-small` as default embedding model, domain-filtered provider selections in Settings UI (Analysis AI: Ollama, Mistral; Embeddings: Ollama, Mistral, OpenRouter), and added robust HTTP error categorization with Bearer API key sanitization.

## Phase 2.2E1–E3 — Provider Coherence & Identity Diagnosis (Implemented)

Embedding provider changes now keep provider, model, and Base URL coherent, immediately invalidate local derived compatibility, and never delete canonical embeddings or start generation. Published identity is read from the manifest before detailed JSONL inspection, so provider/model mismatches require a full rebuild even when the resource guard blocks the detailed file. Status and semantic availability distinguish `missing`, `empty`, `readable`, and `unreadable` data and preserve an indeterminate/details-unavailable state when readiness cannot be proven.

## Future: Phase 2.3 — Remote Provider Cost Safeguards & Circuit Breakers

Introduce remote-provider safeguards for Mistral and OpenRouter to prevent unintended API billing. Exact policy values remain subject to approval.

## Future: Phase 2.4 — Opt-In Remote Provider Automation

Add explicit user opt-in for automatic background generation using paid remote providers (Mistral and OpenRouter).

## Future: Phase 2.5 — Multi-Device Sync & Recovery Hardening

Enhance zero-diff detection for incoming Syncthing/Obsidian Sync updates and resume interrupted operations cleanly from checkpoints.

## Future: Phase 2.6 — Settings UI Simplification

Transition technical maintenance controls to an Advanced/Developer section once background automation is fully proven.

---

# 0.3.x — Advanced Multi-Device Synchronization & Companion Optimization

## Goal

Enhance synchronization resilience and companion query performance across distributed multi-device workflows.

## Synchronization Resilience

Improve integration with external synchronization workflows (e.g., Syncthing, Obsidian Sync):

* introduce composite multi-artifact generation markers;
* provide non-intrusive status badges when synchronization is in progress;
* ensure seamless fallback during mid-sync queries.

## Mobile Companion Query Optimization

* optimize zero-copy `Float32Array` ingestion for low-memory devices;
* expand local-first query routing for mobile companion environments.

---

# 0.4.x — Configuration Simplification

## Goal

Turn technical configuration into a simpler and more understandable user experience.

## First-run onboarding

Introduce onboarding that can guide the user through:

* choosing the device role;
* choosing an AI provider;
* configuring credentials;
* automatically preparing required structures.

## Simplified settings

Separate normal configuration from advanced maintenance options.

Normal settings should focus on:

* Lina status;
* provider;
* model;
* synchronization.

Advanced settings may expose:

* index controls;
* embeddings;
* binary artifacts;
* diagnostics;
* maintenance actions.

---

# 0.5.x — Search and Context

## Goal

Improve search usability and make Lina's context more understandable.

Planned areas include:

* a clear-search button;
* preserving the last analysis when switching notes;
* clearly identifying which note an analysis belongs to;
* displaying embedding provenance;
* searching folder names;
* visually distinguishing notes from folders;
* consistently respecting exclusion rules.

Embedding provenance may include:

* model;
* provider;
* device of origin;
* creation date;
* current validity state.

---

# 0.6.x — Contextual AI Actions

## Goal

Provide quick actions for selected text without multiplying redundant commands.

Lina should be able to use selected text as context for actions such as:

* summarize;
* explain;
* improve writing;
* correct;
* rewrite;
* create bullet points;
* translate.

These actions should reuse `/ask` as the main execution path whenever practical.

Custom user-defined Actions are also planned.

---

# 0.7.x — Lina Commands

## Goal

Add useful commands without duplicating existing functionality.

## Existing commands

* `/ask`
* `/tags`
* `/yaml`

## Planned commands

### `/secret`

Allow content to remain available for local search while preventing it from being sent to external AI providers.

### `/contact`

Help transform contact notes into a more structured Obsidian format while preserving the original information.

---

# 0.8.x — Intelligent Note Formatting

## Goal

Transform loosely structured notes into useful formats without losing information.

Potential use cases include:

* contacts;
* academic notes;
* meeting information;
* structures compatible with organizational methods such as Zettelkasten.

Transformations should be predictable and preserve original content whenever possible.

---

# Architecture Review and Beta Readiness

After the main functional phases have been implemented and stabilized, Lina will undergo a broader architecture and readiness review.

The review is expected to cover:

* architecture;
* security;
* privacy;
* vault data integrity;
* performance;
* Desktop/Mobile behavior;
* plugin lifecycle;
* Obsidian APIs;
* dependencies;
* tests;
* build and release process;
* documentation;
* relevant Obsidian community submission requirements and guidelines.

Moving to Beta will depend on the actual state of the project rather than on a specific version number.

Expected readiness criteria include:

* no known critical bugs;
* no known technical blockers;
* predictable index and embedding behavior;
* stable synchronization;
* healthy lint, typecheck, tests, build, and CI;
* appropriate protection of user data;
* a sufficiently clear experience for third-party users;
* no significant blockers identified by the architecture review.

---

# 0.10.x — PDF, Images and OCR

Future AI-powered capabilities:

- [ ] AI-powered OCR processing for PDFs and images
- [ ] Semantic search across PDF documents and image content

These features will depend on AI providers with the required processing capabilities.

---

# AI Providers

The current roadmap considers support for:

* Ollama;
* Mistral;
* OpenRouter.

Use of external services should always be clear to the user, especially when vault content may leave the device.

External AI APIs may incur charges billed by their respective providers; Lina does not control or absorb those charges.

---

# Roadmap Policy

This document reflects Lina's current direction, not a fixed promise of release dates or exact version assignments.

Priorities, ordering, and grouping may change in response to:

* discovered bugs;
* user feedback;
* changes in Obsidian;
* community requirements;
* technical constraints;
* lessons learned during development.

A release may happen at any point within a version series when it provides a useful and stable improvement.
