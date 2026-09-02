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
- [x] **Phase D2.4.1 — Internal Diagnostics Model Foundation:** Read-only snapshot model aggregating device identity, active producer ownership, and artifact provenance states.
- [x] **Phase D2.4.2 & D2.4.4 — Diagnostics UI & i18n Alignment:** Read-only status panel modal (`DeviceDiagnosticsModal`) with full internationalization (`pt-PT` / `en`) via `UiStrings`.
- [x] **Phase D2.5.1 — Manual Ownership Transfer Service Foundation:** Pure atomic service (`transferOwnershipToDevice`) enforcing monotonic epoch increments (+1), reason `"manual-transfer"`, and atomic temporary file staging.
- [x] **Phase D2.5.2 — Ownership Transfer Safety & Confirmation Layer:** Safety layer (`prepareOwnershipTransferPreview`, `confirmAndExecuteOwnershipTransfer`) providing zero-side-effect transfer previews, mandatory explicit confirmation, and stale-epoch race condition protection without automatic takeover or role mutations.
- [x] **Phase D2.5.3 — Diagnostics Integration for Ownership Transfer:** Pure read-only diagnostics integration (`DeviceDiagnosticsTransferSection`) reporting transfer readiness and eligibility reasons (`ready`, `already-active-producer`, `missing-ownership`, `companion-role`, `unassigned-role`) in `DeviceDiagnostics` and `DeviceDiagnosticsModal`.
- [x] **Phase D2.5.4 — UI Manual Ownership Transfer:** User-facing manual transfer workflow with explicit confirmation dialog (`OwnershipTransferConfirmationModal`), transparent state presentation, strict role isolation, and comprehensive error handling.
- [x] **Phase D2.5.5 — Ownership Transfer Audit Trail Foundation:** Append-only, immutable transition history in `.lina/ownership-history/` (`001.json`, `002.json`, ...) with atomic persistence and fault-tolerant chronological loading.
- [x] **Phase D2.5.6 — Ownership Recovery Diagnostics Foundation:** Observation-only detection of consistency states (`healthy`, `missing-manifest`, `missing-history`, `history-ahead-of-manifest`, `epoch-inconsistency`, `unknown`) with zero automatic recovery and zero disk writes.
- [x] **Phase D2.5.7 — Ownership Recovery Diagnostics UI Integration:** Presentation-only integration of recovery and consistency diagnostics into `DeviceDiagnostics` snapshot model and `DeviceDiagnosticsModal` in Portuguese and English (`UiStrings`) with zero recovery actions.
- [x] **Phase D2.5.8 — Ownership Architecture Hardening & Final Audit:** Validated end-to-end lifecycle, isolation (`Role != Ownership`), monotonic epoch fencing, append-only audit trail immutability, and state matrix. Ownership foundation fully hardened and ready for Companion Delta Search.

## Prepared For

- Phase 0.4.x — Companion Delta Search.
- Multi-device synchronization hardening (external sync engines remain responsible for file transport; Lina does not provide a cloud sync engine).

---

# 0.2.2 --- Release Stabilization & Embedding Policy Foundation

## Goal

Post-release reliability improvements and decoupled embedding update policy architecture.

- [x] **Phase 0.2.2.1 — Embedding Policy Foundation:**
  - [x] Create pure provider capability model (`EmbeddingProviderCapability` in `src/ai/providerCapabilities.ts`) distinguishing local vs external API cost profiles.
  - [x] Implement pure embedding policy decision engine (`evaluateEmbeddingUpdatePolicy` in `src/maintenance/embeddingPolicyEngine.ts`).
  - [x] Comprehensive unit tests with zero worker, scheduler, or UI mutations.
- [x] **Phase 0.2.2.2 — Embedding Status Transparency:**
  - [x] Create presentation-oriented status explanation layer (`explainEmbeddingStatus` in `src/maintenance/embeddingStatusExplanation.ts`).
  - [x] Provide transparent semantic search impact assessment, API credit cost disclosures, and Companion limitation explanations.
  - [x] Full i18n support in `src/i18n/strings.ts` (`pt-PT` and `en`) and comprehensive unit test suite.
- [x] **Phase 0.2.2.3 — Embedding Update Confirmation Flow:**
  - [x] Create pure confirmation preview model (`prepareEmbeddingUpdateConfirmation` in `src/maintenance/embeddingUpdateConfirmation.ts`).
  - [x] Create user-facing confirmation dialog (`EmbeddingUpdateConfirmationModal` in `src/maintenance/embeddingUpdateConfirmationModal.ts`) with external API credit cost warnings.
  - [x] Route manual execution paths (command palette and sidebar diagnostic actions) through explicit confirmation gating with fail-fast Companion defense.
  - [x] Comprehensive unit test suite and full i18n support.
- [x] **Phase 0.2.2.4 — Embedding Update Settings & Workflow Audit:**
  - [x] Complete architectural audit of all manual, automatic, and internal embedding generation workflows.
  - [x] Verified zero bypass paths, strict Companion read-only protection, and zero silent external API billing.
  - [x] User configuration model `EmbeddingUpdateSettings` (`embeddingUpdateMode`: `"manual"` | `"automatic-local-only"`).
  - [x] Runtime settings adapters, pure declarative blueprint/composition, and bilingual i18n support with zero side-effect execution.
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

- [x] **Phase 0.4.x — Companion Delta Search Foundation:**
  - [x] Companion capability detection model (`CompanionCapability`).
  - [x] Read-only artifact consumption state model (`CompanionArtifactConsumptionState`).
  - [x] Clear Producer/Companion responsibility split.
  - [x] Transport independence (Syncthing, Obsidian Sync, filesystem).
  - [x] Zero producer-side mutation guarantees.
- [x] **Phase 0.4.1 — Companion Delta Search Read-Only Query Layer:**
  - [x] Read-only Companion search execution layer (`src/companion/companionSearch.ts`).
  - [x] Automatic text/semantic query delegation.
  - [x] Non-blocking usability under stale, future, or unknown provenance.
  - [x] Resilient textual fallback when embeddings are missing or disabled.
- [x] **Phase 0.4.2.1 — Companion Search Diagnostics & Capability Exposure:**
  - [x] Diagnostics extension with `companionSearch` section (`src/device/deviceDiagnostics.ts`).
  - [x] Presentation in `DeviceDiagnosticsModal` with full `pt-PT` and `en` support.
  - [x] Strictly observation-only (`Diagnostics != Repair`).
- [x] **Phase 0.4.3 — Search Architecture Audit & Companion Integration Planning:**
  - [x] Comprehensive search lifecycle audit across UI, modals, engines, and companion layers.
  - [x] Target architecture definition: One Unified Search Engine with capability-aware behavior.
  - [x] Identified refactoring path (Keep core engines, adapt `LinaSearchView`, consolidate companion delegation).
- [x] **Phase 0.4.4 — Local Delta Search Foundation:**
  - [x] Detect recently created notes (`detectLocalDelta`).
  - [x] Detect recently modified notes (mtime/size/hash changes).
  - [x] Create temporary local search layer (`buildLocalDeltaSearchState`, `executeLocalDeltaSearch`).
  - [x] Combine persistent index and local delta results (`fuseSearchResults`, `executeCompanionSearchWithDelta`).

Rules:

- [x] Mobile never writes shared index.
- [x] Mobile never creates embeddings.
- [x] Mobile never modifies binary artifacts.
- [x] Delta results remain temporary.
- [x] Text and semantic results remain separated.

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