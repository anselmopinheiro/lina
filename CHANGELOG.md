# Changelog

## Unreleased

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

### Tests
- Added derived-state regressions for corruption, duplicates, legacy input hashes, identity changes, rebuilds, checkpoint diagnostics and semantic filtering.
- Added regression coverage for embedding single-flight, shared state subscriptions, and unload/dispose behaviour.
- Added coordination coverage for rebuild-vs-embeddings exclusion, automatic-update draining, queued events during generation, and pending-batch resumption after success or failure.
- Added provider validation and fail-fast coverage for Ollama fallback, Mistral authentication/rate-limit responses, timeouts, invalid vectors and partial input-specific failures.
- Added cancellation and progress coverage for validation, generation, coordinator release and pending text-update resumption.
- Added coverage for cancellation during persisting, unload/late callbacks and the passive embedding progress modal.
- Added batching coverage for size normalization, deterministic partial batches, provider response ordering, legacy Ollama, request counts, fail-fast, subdivision, progress and cancellation.
- Added 59 persistence tests for checkpoint validation, partial compatibility, resume, canonical publication, rollback, orphan recovery, coordination and cancellation.
- Added integrated success, cancellation/resume, provider-failure/resume and text/semantic/hybrid search coverage, plus focused regressions for input compatibility, timer cleanup and terminal UI state.

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
