# Changelog

## Unreleased

### Changed
- Documented the post-C3B formal rerun: the resolved C3B findings stay closed, `PARITY-ROLLBACK` now also covers the synchronous persisted controls `check-sync-on-startup` and `device-name`, `PARITY-EFFECT-ORDER` now covers `embeddings-model` and `binary-preference`, the candidate remains detached, the 12 groups / 47 IDs / 47 real definitions / 0 missing baseline is preserved, the full suite still passes with 634 tests, C3 remains blocked, and the next step is C3C before any C4 work.
- Added the 9N-C3B reconciliation for save rollback and provider effect materialization: the imperative UI and the detached candidate now both roll back `embeddings-enabled` on save failure without later effects, materialize `analysis-provider` and `embeddings-provider` as a single logical mutation with preserved custom URLs/models and one serialized save, and run effects only after confirmed persistence; `mark-embeddings-dirty` now waits for a successful save, the candidate remains detached, the C3 findings are resolved, and the next step is a formal C3 rerun before C4.
- Added the blocked 9N-C3 parity-capture coverage for controls/persistence/effects: `device-name` was confirmed equivalent (`trim`, local/device persistence, one save, other-device preservation), while `embeddings-enabled` remains a `PARITY-ROLLBACK` finding and `analysis-provider` remains split between `PARITY-MUTATION` and `PARITY-SAVE-COUNT`; the phase introduced no production changes, kept the candidate detached, left `getSettingDefinitions()` disabled, and keeps the next allowed step at 9N-C3A rather than C4.
- Resolved the 9N-C2B settings parity findings: added the `device-description` descriptor to the declarative candidate, aligned `support-description` in the imperative UI, kept analysis and embeddings credential fields empty until explicitly saved or cleared (with destructive clear confirmation and no pre-filled secrets), expanded binary status diagnostics to show configured preference/effective source/fallback, and advanced the canonical settings inventory to 47 structural IDs / 47 real definitions; validation passed on the focused settings suite (24 files / 180 tests) and the full suite (48 files / 622 tests).
- Added internal 9N-C1 parity-harness instrumentation for the real imperative settings `display()` path, using test spies/mocks over `Setting` to produce a deterministic, serialisable and secret-safe manifest (including only observable metadata) without real side effects (`saveSettings`, `saveData`, binary actions, network, filesystem, vault I/O, or real persistence); a negative guard asserts the imperative path does not import `declarativeSettingsCandidateComposition`. The declarative candidate remains detached, with no formal parity claim or mapping of the 46 candidate IDs. Validation passed for the harness (1 file / 2 tests), settings tests (22 files / 174 tests), and full suite (46 files / 616 tests); 9N-C2 will perform the formal structure/content comparison.
- Added the official Obsidian linting workflow for local validation and community-review compliance.
- Improved compatibility of Lina interface components with Obsidian UI helpers.
- Prepared the main declarative settings infrastructure and added declarative preparation for the two previously omitted active controls (`autoUpdateIndexOnFileChanges` and `maxSuggestedTags`), bringing the structural blueprint inventory to 46 elements (`complete: true`). Declarative settings remain disconnected from the active tab, `display()` remains active, `getSettingDefinitions()` remains disabled, and cutover is still blocked until production adapters, per-instance lifecycle validation, parity harness, and manual validation are completed.
- Prepared typed async actions for connection tests (analysis, embeddings) and binary-copy operations (verify, create/update, remove), with accessible feedback states, typed state machines, and concurrency protection. Destructive binary-copy removal requires explicit injected confirmation.
- Prepared a detached runtime adapter layer for global and local settings persistence/effects with injected host ports, envelope-safe updates (`{ settings, index }`), serialized writes, in-memory rollback on save failure, typed closed effects, and no active integration in the current imperative settings tab.
- Prepared a detached per-instance lifecycle/state controller for declarative settings runtime flows, including monotonic-generation stale-result neutralization, per-domain pending guards, idempotent cleanup/dispose handling, coalesced updates with injectable scheduler, and no active integration in the imperative settings tab.
- Hardened the credential handling layer with a pure model and typed ports: credential fields always start empty, saved credentials are never pre-filled, save and clear are explicit operations with confirmation required for destructive clear, and no secret value enters descriptors, state, feedback, logs, or snapshots. Secret resolution is limited to the injected runtime bridge boundary that calls executors, legacy precedence/fallback behavior is preserved, clearing the primary credential recalculates effective availability (with neutral feedback when fallback credentials remain available), and the existing per-device credential format is preserved with no schema migration, no `secretStorage`, and no cutover to active declarative settings UI.
- Prepared a detached binding between connection-test actions (analysis and embeddings) and the per-instance lifecycle controller, with independent tokens and pending guards per domain, stale-result neutralisation, safe public feedback limited to provider, model and base URL, and injected save/clear credential ports; no active integration in `display()`, `hide()`, or `getSettingDefinitions()`.
- Prepared a detached binding between the binary embedding copy runtime and the per-instance lifecycle controller, with a single `binary` domain for mutual exclusion between check, create/update and remove operations, a safe serialisable public snapshot, `legacy-manifest` guard on create/update, injected destructive confirmation for remove, stale-result neutralisation, and no filesystem, vault I/O, network or concrete executors inside the binding; no active integration in `display()`, `hide()`, or `getSettingDefinitions()`.
- Prepared a detached declarative candidate composition with 12 groups and 46 items derived from the canonical blueprint, with per-instance adapter runtime, lifecycle controller and bindings, a safe serialisable `getDiagnosticSnapshot()`, and idempotent `dispose()`; no active integration in `display()`, `hide()`, or `getSettingDefinitions()`, and no authorisation for cutover or removal of the imperative implementation.
- Advanced the detached candidate composition from structural metadata to 36 real definitions bound to existing controls, renderers and adapters (read/write/save/effects routed through injected ports); 10 items remain explicitly marked `MISSING_REAL_BINDING` (analysis and embeddings credentials, connection tests, test feedback, binary status and actions); no active integration, no cutover, and `display()`, `hide()`, `src/settings.ts` and `main.ts` are unchanged.
- Added a detached candidate factory for connection-credential renderers/actions that reuses injected `ConnectionCredentialBindings` only (no parallel lifecycle/runtime/binding), keeps credential drafts local to renderers, registers cleanup by stable `owner/id`, exposes safe feedback/diagnostic output, and remains disconnected from active composition wiring and cutover.
- Advanced the detached candidate composition from 36 to 42 real definitions: bound analysis-credential, test-analysis-connection, analysis-test-feedback, embeddings-credential, test-embeddings-connection, and embeddings-test-feedback to existing controls, renderers and adapters; the composition reuses the factory B2D3B1 and per-instance `ConnectionCredentialBindings` without parallel runtime; 4 items remain explicitly marked `MISSING_REAL_BINDING` (binary-status, check-binary-copy, create-or-update-binary-copy, remove-binary-copy); selective per-domain invalidation and safe feedback remain in place; no active integration in `display()`, `hide()`, `src/settings.ts` or `main.ts`, and no cutover.
- Added a detached candidate factory for binary status/action renderers (`src/settings/declarativeSettingsBinaryRenderers.ts`) that reuses injected `DeclarativeSettingsBinaryBindings` only (no parallel runtime, binding, or lifecycle), exposes safe status renderer and check/create-update/remove action renderers, translates only the safe public snapshot of the binding, includes pending, safe feedback, and `legacy-manifest` guard on create/update, delegates confirmation, pending, tokens and invalidation to the existing binding/lifecycle, exposes serialisable diagnostic output and idempotent `dispose()`, preserves the composition and `src/settings.ts` unchanged, keeps the four binary IDs unbound, and maintains the 42 real definitions / 4 `MISSING_REAL_BINDING` count; no active integration, no cutover.
- Completed binary candidate wiring in the detached declarative composition by binding the remaining four binary IDs (`binary-status`, `check-binary-copy`, `create-or-update-binary-copy`, `remove-binary-copy`), advancing from 42 to 46 real definitions and reducing `MISSING_REAL_BINDING` from 4 to 0; wiring reuses the existing B2D3C1 binary factory and injected `DeclarativeSettingsBinaryBindings` flow, preserves safe status/feedback, `legacy-manifest`, destructive confirmation, pending and exclusivity semantics, introduces no parallel runtime and no direct I/O, does not introduce `binary-action-feedback`, and remains disconnected from active integration/cutover (`getSettingDefinitions()` still inactive); next step is final 46/46 candidate audit before parity harness.
- Completed the final B2D4 audit and approved the detached declarative composition for parity harness work: composition confirmed at 12 groups / 46 structural IDs / 46 real definitions / 0 `MISSING_REAL_BINDING`, with audited wiring and per-composition ownership, validated persistence/effects flow (single save queue, rollback on save failure, effects after successful save), credential safety, binary-domain exclusivity and safeguards (`legacy-manifest`, destructive confirmation, inert remove-cancel, no extra post-create/update check), lifecycle/dispose coherence, and serialisable safe diagnostics; focused tests stayed green (10 files / 82 tests) and full suite stayed green (45 files / 614 tests); candidate remains detached with no active integration/cutover (`src/settings.ts`, `main.ts`, `getSettingDefinitions()` unchanged), and the next phase is 9N-C1 imperative-UI instrumentation for parity harness.

### Fixed
- Resolved the remaining type-safety errors reported by the Obsidian lint configuration.
- Fixed configuration-folder references for vaults that do not use the default `.obsidian` directory.

## 0.1.13

### Changed
- Improved compatibility with recommended Obsidian development practices and UI patterns.
- Updated applicable interface components to use Obsidian UI helpers while preserving their existing appearance and behaviour.
- Improved support for multi-window and popout workflows.
- Raised the minimum supported Obsidian version to 1.13.0.
- Prepared the command palette for a future, more streamlined experience centred on the Lina side panel.

### Fixed
- Replaced a deprecated settings button API with its supported replacement.
- Internal compatibility improvements without changes to search, indexes, embeddings, AI providers, or stored data formats.

## 0.1.12

### Changed
- Improved compatibility with vaults that use a custom Obsidian configuration folder.
- Improved asynchronous operation handling for a more reliable experience.
- Removed obsolete code and unused dependencies.

### Fixed
- Improved multi-window compatibility and alignment with recommended Obsidian ecosystem practices.

## 0.1.11

### Added
- Added per-device experimental settings to maintain a derived binary embedding copy and prefer it for reads when it exactly matches the current canonical JSONL publication. JSONL and checkpoints remain canonical, and invalid or outdated binary copies fall back to JSONL.
- Added runtime diagnostics showing the configured embedding read preference, the effective source used by the last semantic or hybrid search, and structured JSONL fallback reasons.
- Added a runtime embedding index that stores loaded vectors in a reusable `Float32Array` resident in memory, reducing memory overhead compared to per-search JSONL parsing and conversion.
- Added `RuntimeEmbeddingIndexCache` for lazy, single-flight loading of the runtime embedding index on first semantic or hybrid search.
- Added `searchRuntimeSemanticIndex()` as a new function that uses the contiguous `Float32Array` resident index directly for cosine similarity, avoiding per-record `number[]` access.
- The runtime embedding index is reused across successive semantic and hybrid searches while the published embedding identity and text state remain valid.
- The runtime embedding index is invalidated on canonical publication, rollback, recovery, text-index changes or unload; no polling or automatic reloading.
- External changes to `embeddings.jsonl` or `manifest.json` (e.g. via Syncthing) are detected conservatively: the cache is reloaded when the source identity differs on the next `getOrLoad()` call.
- The cache does not persist between app restarts; the first search after restart loads and converts the JSONL from disk.
- Added optional experimental maintenance of a derived binary embedding copy (`embeddings.binary.manifest.json`, `embeddings.meta.jsonl`, `embeddings.vectors.f32`) that is created or updated only after successful canonical JSONL publication.
- Added a per-device read preference between canonical JSONL and the binary copy; the binary copy is accepted only when its full trio is valid and its `sourcePublicationId` exactly matches the current canonical JSONL publication.
- Added transactional binary publication with temporary validation, canonical backup preservation, ordered writes and explicit rollback on critical failure.
- Added `sha256` checksums for binary metadata and vectors, plus conservative memory profiles with distinct peak-read limits for desktop and mobile.
- Added runtime diagnostics for embedding reads that report the configured preference, the effective source used by the last search, the fallback or read reason, load duration, record or dimension summary, and cache-hit state.
- Added validation that accepts the binary copy only when it exactly matches the current canonical JSONL publication, with separate conservative memory profiles and peak-read limits for desktop and mobile, structured no-safe-source handling, safe cancellation, retry lifecycle and protection against late publications.

### Changed
- Added a deterministic derived embedding-state calculator that distinguishes `missing`, `valid`, `stale` and `obsolete` records without a new persistent sidecar.
- Semantic search now uses only canonically valid records with a strict published vector-space identity; equal dimensions alone no longer imply compatibility.
- Incremental generation now distinguishes `validForSearch` from `reusableForNextGeneration`, so changing the next local provider/model does not mark the published index stale.
- Embedding diagnostics now report reusable checkpoint work and global operation activity without presenting checkpoints as pending or searchable.
- Centralised persistent embedding generation through a single plugin-owned operation manager shared by commands and the sidebar.
- Coordinated persistent embedding generation with text-index rebuilds and automatic text-index batches so writers no longer publish the index concurrently.
- Persistent embedding generation now validates the configured provider with up to three real eligible chunks before starting the full run and fails fast on global provider/configuration errors.
- Persistent embedding generation now reports central real progress and supports cooperative cancellation from the command palette and Lina sidebar.
- Embedding cancellation now keeps a documented persisting point of no return so completed publications are reported as completed, not cancelled.
- Persistent embedding generation now uses the configured batch size for sequential native Mistral and modern Ollama requests, while keeping legacy Ollama generation individual.
- Input-specific batch failures are isolated by deterministic sequential subdivision; global errors and unsafe batch responses still fail fast.
- Embedding progress remains chunk-based and cancellation prevents the next batch or subdivision request from starting.
- Completed embedding batches are now saved in a validated recoverable checkpoint, allowing compatible work to be reused after cancellation or provider failure.
- Final embedding publication now validates embeddings and manifest candidates, preserves the previous canonical pair as backups, and rolls back on critical publication failures.
- Recovery handles only known embedding temporary and backup files; semantic search continues to read only canonical `embeddings.jsonl`.
- Closed the first embedding robustness phase with an integrated lifecycle review covering central ownership, writer coordination, validation, batching, cancellation, resumable checkpoints, canonical publication, rollback and search regressions.
- Canonical incremental reuse now recalculates the embedding input hash instead of accepting any non-empty legacy value.
- Embedding request timeouts are now cleared after Mistral and Ollama requests settle, and disposed operation managers ignore late terminal completions.
- The progress modal no longer presents a cancelling operation as completed merely because processed chunks reached 100%.
- Manual embedding generation now uses a deterministic update plan that explicitly chooses initial build, incremental update or full rebuild before publishing.
- Changing provider, model, dimensions, input format or prefix mode now forces a full rebuild plan; old canonical vectors are not mixed into the next published index.
- Compatible checkpoints can complete a manual generation without provider calls, and obsolete canonical records are removed during the next safe publication.
- Added a lazy read-only runtime controller for embedding work status after text-index or embedding publications.
- Text-index rebuilds, automatic batches, startup reconciliation, embedding publication/checkpoint changes and embedding provider/model setting changes now mark embedding work status dirty without generating embeddings.
- The Lina sidebar can subscribe to the runtime embedding work status and refresh the summary only while visible, avoiding repeated full embedding parsing on passive mobile consumers.
- The Lina sidebar now shows a compact embedding diagnostic with valid-for-search, missing, stale, obsolete and recoverable-checkpoint counts.
- The embedding diagnostic now reports the central planner's next manual action and asks for explicit confirmation before full rebuilds.

### Fixed
- Preserved the published embedding identity when text-index updates or note renames save the shared manifest.
- Prevented a single note rename from marking the complete embedding publication as undefined or globally outdated.
- Prevented Android crashes caused by opening the Lina panel and reading the complete embedding JSONL through the Capacitor filesystem bridge.
- Made the sidebar use small manifest-derived state instead of loading the complete embedding corpus.
- Rejected unsafe mobile reads before entering the native bridge.
- Prevented unsafe JSONL fallback when no embedding source fits the active memory profile.
- Preserved text search through `no-safe-source`.
- Strengthened sidebar lifecycle handling against late callbacks and repeated open/close cycles.

### Tests
- Added runtime embedding index cache regressions for lazy loading, single-flight, Float32 contiguity, invalidation, external source detection, stale-load discard, and hybrid fallback behaviour.
- Added derived-state regressions for corruption, duplicates, legacy input hashes, identity changes, rebuilds, checkpoint diagnostics and semantic filtering.
- Added embedding update-plan regressions for mode choice, incremental reuse, full rebuilds, checkpoints, no-op plans and cleanup publication.
- Added embedding work-status controller regressions for initial state, dirty revisions, lazy subscribers, single-flight refresh, late-result protection, deferred refresh and work-available detection.
- Added integration regressions for embedding work-status invalidation after automatic text-index publication, failed saves and startup reconciliation.
- Added sidebar diagnostic view-model regressions for incremental updates, full rebuild confirmation, checkpoint reporting and active operation controls.
- Added regression coverage for embedding single-flight, shared state subscriptions, and unload/dispose behaviour.
- Added coordination coverage for rebuild-vs-embeddings exclusion, automatic-update draining, queued events during generation, and pending-batch resumption after success or failure.
- Added provider validation and fail-fast coverage for Ollama fallback, Mistral authentication/rate-limit responses, timeouts, invalid vectors and partial input-specific failures.
- Added cancellation and progress coverage for validation, generation, coordinator release and pending text-update resumption.
- Added coverage for cancellation during persisting, unload/late callbacks and the passive embedding progress modal.
- Added batching coverage for size normalization, deterministic partial batches, provider response ordering, legacy Ollama, request counts, fail-fast, subdivision, progress and cancellation.
- Added 59 persistence tests for checkpoint validation, partial compatibility, resume, canonical publication, rollback, orphan recovery, coordination and cancellation.
- Added integrated success, cancellation/resume, provider-failure/resume and text/semantic/hybrid search coverage, plus focused regressions for input compatibility, timer cleanup and terminal UI state.
- Added mobile resource-guard regressions for pre-bridge size rejection and safe-source fallback handling.
- Added sidebar lifecycle regressions for passive loading, late callbacks and repeated open/close cycles.
- Added embedding identity regressions for text-index updates and note renames.

## 0.1.10

### Added
- Added an internal model catalog for supported Ollama and Mistral chat and embedding models.
- Added automatic Base URL defaults for Ollama and Mistral settings.
- Added Mistral embeddings provider support.
- Added an embeddings connection test button that verifies the configured provider/model without reading notes or writing to the index.

### Changed
- Text index rebuilds now run in cooperative background batches with progress, cancellation, concurrency protection, and safe publication that preserves the previous index on cancellation or failure.
- Improved AI and embedding model settings with catalog-based model choices while keeping manual/custom model entry.
- Improved embeddings connection test diagnostics with safe provider, model, endpoint, HTTP status, and short API error details.
- Improved embeddings update UI and diagnostics for local and remote embedding providers.
- Updated embedding generation button labels and messages to avoid "local" terminology when the provider can be remote.
- Embedding generation errors now include safe provider/model/diagnostics without exposing keys or note content.
- Improved embedding updates to reuse existing vectors when provider, model, and chunk content are unchanged.
- Embedding generation now preserves partial progress on errors and handles rate limits (429) gracefully.
- Updated the user manual with contextual commands and privacy notes.

### Fixed
- Reconciled the existing text index deterministically during startup by comparing Vault metadata with `notes.json` and processing only new, modified, or deleted notes through the existing automatic-update batch.
- Prevented memory/disk divergence after automatic text-index persistence failures by activating candidate notes and chunks only after a successful save.
- Changed automatic text-index `modify` debouncing to run independently per note path so rapid edits to different files are all queued.
- Prevented recurring no-op startup batches caused by new notes that are excluded by configured content rules before they ever enter the persisted text index.
- Hardened automatic text index updates by validating vault event paths, ignoring internal Lina/Obsidian writes, compacting startup events, coalescing file changes, and processing updates in single-flight mode.
- Avoided loading the full text index during Obsidian startup to prevent startup freezes with large `chunks.jsonl` files.
- Prevented duplicate index status details and actions after a text index rebuild.
- Required a valid complete text index before automatic file-change updates to prevent partial index creation from vault events.
- Handled empty, truncated, or invalid text index `notes.json` files safely during automatic index status checks and file-change updates.
- Guarded text index chunk loading against oversized or partially corrupted `chunks.jsonl` files to avoid Obsidian renderer crashes.
- Improved startup reconciliation and automatic batch diagnostics with per-type counts, sampled paths, omitted-path counts, and explicit reasons for skipped candidates.

### Tests
- Added integrated regression coverage for startup reconciliation, persistence failures, debounce behaviour, and automatic update controller flows.

## 0.1.7

### Added
- Added the `/yaml` contextual command to suggest YAML/frontmatter fields from the selected text, preserved selection, or current note, then apply selected new fields with confirmation without duplicating or overwriting existing fields.
- Added the `/tags` contextual command to suggest tags from the selected text, preserved selection, or current note, then apply selected tags with confirmation without duplicating existing note tags.
- Added a safe `/ask` context summary in the side panel showing the source, note, size, exclusion recheck, and truncation state without previewing note content.
- Added confirmed `/ask` response application actions for inserting below the captured selection, replacing the selection, or inserting at the end of the active note with safety checks.
- Added the first contextual side-panel command, `/ask`, which sends the selected text or current note to the configured AI provider without modifying the note.
- Added folder-based batch note analysis with folder selection, optional subfolders, exclusion-aware counts, and remote-provider confirmation.
- Added a small action to copy AI analysis responses to the clipboard from the Lina side panel.

### Changed
- Preserved suggested metadata can now be selected and applied to the active note after switching notes.
- Clear note-specific AI analysis results when the active note changes, while keeping suggested metadata visible.
- Show the original candidate origin, score, and match reason below AI-suggested internal links.
- Made the related-note analysis prompt stricter so AI link suggestions favour useful candidates and can return no links when relevance is weak.
- Added origin, score, and reason details to related-note suggestions in the analysis preview.

### Fixed
- Blocked `/ask` from contacting AI providers when the final selected or note context matches user-configured excluded content terms.
- Fixed `/ask` selection handling so selected text can still be used after focusing the Lina input.
- Preserved Inbox/folder batch YAML/tag suggestions per note path when opening a result note, without aggregating metadata across notes.
- Preserved YAML/tag suggestions across both single-note analysis flows and kept Inbox/folder YAML/tags visible per result card without global aggregation.
- Restored preserved YAML and tag suggestions after switching notes from a single-note analysis, while keeping Inbox/folder batch suggestions scoped to their result cards.
- Limited preserved suggested metadata to single-note analysis so batch Inbox/folder suggestions stay scoped to their own result cards.
- Corrected Ollama text generation URL handling and 404 diagnostics for local analysis requests.
- Improved related-note candidates by softening folder ranking, filtering already linked notes, and deduplicating by path.
- Restored exact text search matches for short notes that do not produce chunks.
- Improved text and hybrid search ranking so full-word matches rank above prefix or substring matches, while partial matches remain available.
