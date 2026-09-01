# Lina Roadmap --- After 0.2.1

## Vision

Lina evolves as a local-first intelligence layer for Obsidian, keeping
search, indexing, embeddings and AI features simple, transparent and
predictable.

Principles:

- Protect user data and vault content.
- Keep behavior predictable and controllable.
- Align progressively with Obsidian community expectations.

---

# Storage, Identity & Ownership Foundation (Completed)

## Goal

Establish a robust, secure, and unsynchronized identity, state, secret storage, active producer ownership, artifact provenance, and provenance validation foundation across multi-device vaults.

## Completed Foundation Phases

- [x] **Phase A — Persistent Device Identity:** Platform-independent UUID v4 generated via `crypto.randomUUID()` and persisted in Obsidian's official `app.loadLocalStorage` / `app.saveLocalStorage` (`"lina_device_id"`).
- [x] **Phase B — Device-Scoped State:** State isolated in dedicated, single-writer files at `.lina/devices/<deviceId>.json`, eliminating sync write collisions in `data.json`.
- [x] **Phase C — Secret Storage Migration:** Plaintext API keys migrated to Obsidian's official `app.secretStorage` (`"lina-analysis-api-key"`, `"lina-embeddings-api-key"`) and purged from `data.json`.
- [x] **Phase D1 & D1.1 — Device Role Model & Neutral Initial Role:** Operational roles (`"producer"` / `"companion"`) persisted per-device in `.lina/devices/<deviceId>.json` with unassigned first-run state.
- [x] **Phase D2.1 — Ownership Manifest Service:** Single-active-producer manifest at `.lina/ownership.json` with monotonic epoch fencing and atomic persistence.
- [x] **Phase D2.2 — Worker Ownership Gating:** Ownership gating across text indexing, vector embeddings, checkpoints, binary derivation, and startup reconciliation workers.
- [x] **Phase D2.3 — Artifact Provenance Tracking:** Immutable provenance metadata (`producerDeviceId`, `producerEpoch`, `generatedAt`) attached to text, embedding, checkpoint, and binary manifests.
- [x] **Phase D2.3.1 — Artifact Provenance Validation:** Pure non-blocking evaluation of artifact provenance against vault ownership (`valid`, `stale`, `unknown`, `future`) with zero automatic repair.

## Prepared For

- Phase D2.4 — Diagnostics & Manual Ownership Transfer UI.
- Phase 0.4.x — Companion Delta Search.
- Multi-device synchronization hardening (external sync engines remain responsible for file transport; Lina does not provide a cloud sync engine).

---

# 0.2.2 --- Release Stabilization

## Goal

Post-release reliability improvements.

- [ ] Improve deterministic production builds.
- [ ] Improve release validation.
- [ ] Improve CI/CD reliability.
- [ ] Fix minor UX issues.

---

# 0.3.x --- Producer State and Sync Resilience

## Goal

Create an explicit state model for Desktop Producer artifacts.

## Producer State

- [ ] Create versioned `producer-state.json`.
- [ ] Store producer identity.
- [ ] Store last successful index update.
- [ ] Store last successful embeddings update.
- [ ] Store last successful maintenance completion.

## Freshness

- [ ] Expose artifact freshness.
- [ ] Define Fresh, Aging and Stale states.

## Synchronization

- [ ] Detect incomplete synchronization.
- [ ] Detect temporary sync conflicts.
- [ ] Protect against partially synchronized artifacts.
- [ ] Improve Syncthing compatibility.
- [ ] Add multi-device tests.

Rules:

- Desktop remains the only Producer.
- Mobile remains consumer only.
- Lina does not provide cloud synchronization.

---

# 0.4.x --- Companion Delta Search

## Goal

Allow Mobile Companion devices to find recent notes before Producer
updates persistent artifacts.

- [ ] Detect recently created notes.
- [ ] Detect recently modified notes.
- [ ] Create temporary local search layer.
- [ ] Combine persistent index and local delta results.

Rules:

- [ ] Mobile never writes shared index.
- [ ] Mobile never creates embeddings.
- [ ] Mobile never modifies binary artifacts.
- [ ] Delta results remain temporary.
- [ ] Text and semantic results remain separated.

---

# 0.5.x --- First Run Experience

## Goal

Reduce initial user friction.

- [ ] Explain Producer / Companion model.
- [ ] Guide initial index creation.
- [ ] Guide AI configuration.
- [ ] Improve empty states.
- [ ] Add optional provider validation feedback.

---

# 0.6.x --- Search Experience and Provenance

## Goal

Improve daily search usability.

- [ ] Clear search action.
- [ ] Folder search.
- [ ] Better result context.
- [ ] Embedding provenance:
  - [ ] Provider.
  - [ ] Model.
  - [ ] Creation date.
  - [ ] Producer information.
  - [ ] Validity state.

---

# 0.7.x --- Contextual AI Actions

## Goal

Provide AI actions over selected text.

- [ ] Summarize.
- [ ] Explain.
- [ ] Improve writing.
- [ ] Correct.
- [ ] Rewrite.
- [ ] Create bullet points.
- [ ] Translate.

Reuse existing AI execution paths.

---

# 0.8.x --- Privacy Controls and Intelligent Commands

## Goal

Improve user control over AI usage.

- [ ] Define protected content markers.
- [ ] Keep protected content searchable locally.
- [ ] Prevent protected content from being sent to AI providers.
- [ ] Add `/contact` structured note assistance.

---

# 0.9.x --- Intelligent Note Formatting

## Goal

Transform notes while preserving original information.

- [ ] Meeting notes.
- [ ] Academic notes.
- [ ] Zettelkasten-compatible structures.
- [ ] Reversible transformations.

---

# 1.0.x --- Architecture Review and Beta Readiness

Review:

- [ ] Architecture.
- [ ] Security.
- [ ] Privacy.
- [ ] Data integrity.
- [ ] Performance.
- [ ] Desktop/Mobile behavior.
- [ ] Tests.
- [ ] Build and release process.
- [ ] Documentation.

---

# Future --- PDF, Images and OCR

Deferred:

- [ ] OCR processing.
- [ ] Semantic search over extracted content.
- [ ] Image processing.

---

# Future Tooling Improvement

- [ ] Make production builds deterministic by excluding or normalizing
  development timestamps.

---

# Roadmap Policy

This roadmap represents current direction and may change according to
bugs, feedback, Obsidian changes and technical constraints.