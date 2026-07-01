# Lina (ALPHA)

AI-powered note assistant for Obsidian. Local indexing, semantic search, optional AI analysis. Focus on local control, privacy, gradual evolution.

## Current status

Active development. Features below are implemented and functional. Planned features are in the roadmap.

Version: 0.1.X (alpha)

## Implemented features

### Local text index
- Creates a text index in .lina/index/. Generates manifest.json, notes.json, chunks.jsonl.
- Splits notes into chunks with controlled overlap. Configurable path exclusions.
- Permanent exclusion of .lina/ and Obsidian's config dir.

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

### Note analysis with AI (Ollama)
- Analyses the current note using a local Ollama model.
- Analyses with related-note context via hybrid search.
- Analyses Markdown notes from a selected folder, with optional subfolders and exclusion-aware counts before running.
- Shows candidate origin, score, and a short match reason for related notes and AI-suggested internal links.
- Chooses internal links conservatively from the allowed related-note candidates.
- Copies AI analysis responses from the side panel as readable Markdown/plain text.
- Clears note-specific AI analysis when the active note changes, while keeping suggested metadata visible and selectable for the active note.
- Suggests YAML, tags, folder, links, and tasks.
- Suggestion mode by default. Multi-language. Error handling.

### Ollama integration
- Connection test, embedding test, controlled response test (60s timeout).
- Batch embedding generation (manual command). Embedding status check.

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
- Ollama: fully functional for embeddings, chat, analysis.
- Mistral: defined in settings; check code for implementation status.
- OpenAI, OpenRouter, Anthropic, Gemini: defined as options; integration planned.
- Provider, model, base URL, API key, timeout configurable per device.
- Default embedding model: nomic-embed-text. Recommended chat: gemma4:e2b.

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
