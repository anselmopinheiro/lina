# Lina (ALPHA)

AI-powered note assistant for Obsidian. Local indexing, semantic search, optional AI analysis. Focus on local control, privacy, gradual evolution.

## Current status

Active development. Features below are implemented and functional. Planned features are in the roadmap.

Version: 0.1.10 (alpha)

User manual: [docs/manual.md](docs/manual.md)

## Implemented features

### Local text index
- Creates a text index in .lina/index/. Generates manifest.json, notes.json, chunks.jsonl.
- Splits notes into chunks with controlled overlap. Configurable path exclusions.
- Permanent exclusion of .lina/ and Obsidian's config dir.

## Indexing behavior

When Lina is installed or enabled for the first time, it does not automatically build the full text index.

To start using Lina search, create the index manually from the Lina panel or by using the rebuild index command.

Automatic index updates only run after a valid index already exists. If the index is missing, incomplete, or corrupted, Lina will not create a partial index automatically. In that case, rebuild the index manually.

The full text index is loaded only when it is needed for search or a real automatic update. Automatic updates validate and coalesce vault events to avoid repeated reads, and Lina's own internal files under `.lina/` do not trigger recursive reindexing.

Manual text index rebuilds run in small background batches. The Lina panel shows progress and offers a cancel action; cancelling or a fatal error preserves the previous valid index.

This behaviour is intentional and helps keep Obsidian responsive in large vaults, on mobile devices, or in vaults synced with OneDrive or similar services.

The first index creation is always manual; after that, Lina can keep the index updated automatically.

### Index reliability

Lina now keeps the text index more reliable across common vault workflows. When Obsidian opens, Lina reconciles changes made while the app was closed, so new, changed, removed, or renamed notes are reflected after startup once a valid index exists.

Automatic indexing also reduces the risk of differences between the active in-memory index and the index saved on disk, and rapid edits across multiple notes are handled independently so one note update does not cancel another. The critical indexing flows are covered by additional regression tests.

### Text search
- Local search across the text index (by name, path or content).
- Ranking prioritises full-word matches, then prefix matches, then partial substring matches.
- Results show: note name, path, match origin, text score, highlighted excerpt.
- Dedup limit per note. Opens note on click.

### Hybrid search
- Combines text search + semantic search in a single ranked list.
- Default weights: 0.7 text, 0.3 semantic.
- Falls back to text-only when embeddings are unavailable.

### Lateral view (Lina panel)
- Persistent search panel in Obsidian's right sidebar.
- Modes: Hybrid, Text, Semantic. Shows index and embedding status.
- Clickable results open notes directly.
- Plain input runs search. Slash commands are in English and reserved for contextual actions; `/ask` asks the configured AI provider about the selected text or, if focus clears it, the last valid selection captured from the same note. `/tags` suggests tags only, and `/yaml` suggests YAML/frontmatter only, using the same safe context flow. If there is no selection, contextual commands use the current note and show safe context metadata in the panel.

### Note analysis with AI (Ollama)
- Analyses the current note using a local Ollama model.
- Analyses with related-note context via hybrid search.
- Analyses Markdown notes from a selected folder, with optional subfolders and exclusion-aware counts before running.
- Shows candidate origin, score, and a short match reason for related notes and AI-suggested internal links.
- Chooses internal links conservatively from the allowed related-note candidates.
- Copies AI analysis responses from the side panel as readable Markdown/plain text.
- `/ask` shows the context source, note name, context size, and AI response in the side panel with a copy action. The response can be inserted below the captured selection, replace that selection, or be inserted at the end of the note only after explicit confirmation and safety checks.
- `/tags` suggests only tags from the selected text, preserved selection, or current note; selected tags can be applied to the active note with confirmation and existing note tags are not duplicated.
- `/yaml` suggests only YAML/frontmatter fields from the selected text, preserved selection, or current note; selected new fields can be applied to the active note with confirmation, without duplicating or overwriting existing fields.
- Clears single-note AI analysis when the active note changes, while keeping that note's suggested metadata visible and selectable for the active note.
- Preserves Inbox/folder batch YAML and tags per result note when opening that note, without aggregating metadata across notes.
- Suggests YAML, tags, folder, links, and tasks.
- Suggestion mode by default. Multi-language. Error handling.

### Ollama and Mistral integration
- Connection test, embedding test, controlled response test (60s timeout).
- Batch embedding generation (manual command). Embedding status check.
- Embeddings can be generated locally via Ollama or remotely via Mistral.
- The embeddings update button uses the configured embeddings provider.
- Embedding updates are incremental: existing vectors are reused when the provider, model, and chunk content are unchanged.
- Before a long embedding generation starts, Lina validates the configured provider with up to three real index chunks and stops quickly when the provider, model, connection, timeout or vector response is invalid.
- Persistent embedding generation reports real progress in the Lina panel and can be cancelled. Cancelling prevents new chunks from starting, while a provider request already in progress may take a few moments to finish. If final publication has already started, Lina finishes that critical write and reports the operation according to what was actually saved.
- The configured embedding batch size (1–50) is used for sequential native batching with Mistral and modern Ollama. Legacy Ollama `/api/embeddings` remains one input per request. Progress is still counted per chunk, and cancellation is checked before every batch or controlled subdivision.
- Valid results from completed batches are saved to an internal checkpoint. After cancellation or a provider failure, a later manual generation can reuse only records whose chunk, content hash, provider, model, dimensions, input format and recalculated embedding input hash still match.
- Semantic search reads only the canonical `embeddings.jsonl`; it never reads partial checkpoint data. Final publication validates both embeddings and manifest candidates and uses backups plus rollback to preserve the last coherent canonical index.
- Checkpoint, temporary and backup files under `.lina/index/` are Lina internal files and should not be edited manually. A checkpoint preserves unfinished work; it does not replace the canonical publication backup.
- The embedding lifecycle is centralised and single-flight, coordinated with text-index writers, and covered by integrated success, cancellation/resume, provider-failure/resume and search regression tests.
- Larger batches reduce request count but may use more memory and create larger provider payloads.
- Changing the embedding provider or model may require regenerating all embeddings.
- It is recommended to test the embeddings connection before generating or rebuilding embeddings.
- With remote providers like Mistral, incremental updates reduce API calls.

### Diagnostics
- Commands for text index and embedding status.
- General Lina status modal.

### Per-device configuration
- Uses per-device structure, not flat syncable fields.
- Two blocks: Analysis AI and Embeddings. Each has provider, model, base URL, API key, timeout.

## Privacy and network

- Lina reads Markdown files from the vault for indexing and search.
- Local data stored in .lina/ inside the vault.
- **By default, no network calls.**
- Content sent to external services only if user explicitly configures a remote provider AND triggers an action.
- Contextual commands such as `/ask`, `/tags`, and `/yaml` send only the selected text, a valid preserved selection from the same active note, or current note content after explicit user action. Lina rechecks the final context against configured content exclusions immediately before contacting the AI provider. Applying an `/ask` response, selected `/tags` suggestions, or selected `/yaml` fields also requires confirmation and is blocked if the active note changed or the current note content matches configured exclusions.
- Local providers (Ollama) process entirely locally.
- Remote providers may receive excerpts needed for the configured service. Review their privacy policies.
- .lina/ data may synchronise if within a synced folder.

## Local data and storage

- No localStorage or sessionStorage.
- Settings use Obsidian's loadData/saveData APIs.
- Per-device settings use dedicated structure. .lina/ is for index and operational data only.
- Index path: .lina/index/.

## Providers and models

- Embedding model and chat model configured separately.
- AI analysis and Embeddings settings show known model choices for supported Ollama and Mistral models, while still allowing manual/custom model names.
- Base URL is filled automatically when choosing Ollama or Mistral, unless the current value is a custom URL.
- Default Base URLs: Ollama `http://localhost:11434`; Mistral `https://api.mistral.ai/v1`.
- Embeddings settings include a connection test button. The test sends only the fixed phrase `Lina embedding test`, does not read vault notes, does not save embeddings, and does not rebuild the index.
- Changing the embedding model may require rebuilding semantic embeddings.
- Embeddings can be generated locally via Ollama or remotely via Mistral.
- The embeddings update button uses the configured embeddings provider.
- Embedding updates are incremental: existing vectors are reused when the provider, model, and chunk content are unchanged.
- Embedding generation progress comes from the central operation state; the same cancellation action is available from the command palette and the Lina panel.
- Embedding batch size controls the maximum number of chunks sent in one native provider request. Batches never run in parallel; legacy Ollama always uses an effective size of one.
- Changing the embedding provider or model may require regenerating all embeddings.
- It is recommended to test the embeddings connection before generating or rebuilding embeddings.
- With remote providers like Mistral, incremental updates reduce API calls.
- Ollama: fully functional for embeddings, chat, analysis.
- Mistral: functional for chat/analysis and embeddings. Mistral embeddings use the Mistral API and require an API key.
- OpenAI, OpenRouter, Anthropic, Gemini: defined as options; integration planned.
- Provider, model, base URL, API key, timeout configurable per device.
- Default embedding model: nomic-embed-text. Recommended local embedding model: nomic-embed-text-v2-moe. Recommended chat: gemma4:e2b.

## Syncthing and multi-device usage

Text index and embeddings are stored in `.lina/index/` inside the vault and can be synchronised across devices.

For a detailed guide on setting up Lina with Syncthing, including the recommended `.stignore` configuration, plugin installation per device, and the "PC producer / mobile consumer" pattern, see the [Syncthing section in the manual](docs/manual.md#281-using-lina-with-syncthing-between-pc-and-mobile).

## Desktop and mobile

- isDesktopOnly: false. Works on desktop and mobile.
- Local Ollama is a desktop scenario. Remote providers may be used on mobile.
- Mobile not fully validated yet.

## Current limitations

- Alpha stage. Embeddings generated manually only.
- Mobile not validated for all features.
- AI analysis uses hybrid search context, not automatic index reading.
- Exclusions are path-based. Text search is not a full Obsidian search replacement.
- OpenAI, OpenRouter, Anthropic, Gemini defined but not functionally implemented for analysis.

## Roadmap

### Short: stabilise hybrid search, validate mobile, improve docs.

### Medium: YAML, tag, link, folder suggestions. Remote provider integration. Full mobile validation.

### Future: PDF/DOCX/image analysis, community release.

## Installation

### Community Plugins: search "Lina" when approved.

### Manual: copy manifest.json, main.js, styles.css to <Vault>/.obsidian/plugins/lina/. Enable in Community Plugins.

## Development

```
npm ci
npm run build
```
Files: manifest.json, main.js, styles.css.
Commands: dev, build, typecheck, release-check, release:bump.

## License

MIT
