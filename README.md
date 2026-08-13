# Lina (ALPHA)

[![Version](https://img.shields.io/badge/version-0.1.15--alpha-orange.svg)](manifest.json)
[![Obsidian](https://img.shields.io/badge/Obsidian-v1.13.0%2B-purple.svg)](https://obsidian.md)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Desktop%20%7C%20Android-green.svg)](#mobile--multi-device-syncthing)

> AI-powered note assistant and hybrid search engine for Obsidian. Features local indexing, semantic search, contextual slash commands, and privacy-first AI analysis.

[User Manual](docs/manual.md) | [Commands Guide](docs/commands.md) | [Changelog](CHANGELOG.md)

---

## Overview & Key Features

Lina helps you find, connect, and enrich Markdown notes in Obsidian without taking control away from you.

- 🔍 **Hybrid Search:** Combines fast local text indexing with semantic vector embeddings into a single ranked list.
- ⚡ **Contextual Slash Commands:** Execute `/ask` (AI note query), `/tags` (smart tag suggestions), and `/yaml` (frontmatter generation) directly from the sidebar input.
- 🔒 **Privacy First:** All indexing data is stored locally in `.lina/index/`. Zero network requests by default. Remote AI providers are contacted only when explicitly configured and triggered.
- 🛡️ **Explicit Confirmation:** AI responses, tag additions, and YAML fields are applied to active notes only after your explicit confirmation.
- 📱 **Mobile & Sync Friendly:** Memory-aware safeguards for mobile devices (validated on Android) with opt-in binary shadow sets and Syncthing support.

---

## Quickstart & Installation

### Option 1: Manual Installation
1. Download `manifest.json`, `main.js`, and `styles.css` from the latest release.
2. Create the directory `<Vault>/<configDir>/plugins/lina/` (where `<configDir>` is your vault's Obsidian config directory, default `.obsidian`).
3. Copy the downloaded files into that folder.
4. Enable **Lina** under **Obsidian Settings > Community Plugins**.

### Option 2: Community Plugins
Search for **Lina** in Obsidian Community Plugins once officially listed.

> **First-Time Indexing Note:**  
> When installed for the first time, Lina does not auto-build the full index. Open the Lina side panel and click **Rebuild Index** (or run the rebuild index command). Once a valid index exists, Lina keeps it updated automatically in the background.

---

## Features & Side Panel

The Lina panel lives in Obsidian's right sidebar. It serves as your search interface and AI assistant hub.

### Search Modes
- **Hybrid (Recommended):** Combines text (default weight `0.7`) and semantic similarity (default weight `0.3`).
- **Text:** Fast local search by note title, path, or content. Supports exact, prefix, and substring matching.
- **Semantic:** Meaning-based search powered by vector embeddings. Requires generated embeddings.

### Contextual Slash Commands (`/ask`, `/tags`, `/yaml`)
Type a slash command in the sidebar input to interact with your notes using AI:

- `/ask <prompt>`: Queries the configured AI provider about the active note context. Insert responses below selection, replace selection, or append to note after confirmation.
- `/tags`: Asks AI to suggest tags for the context. Displays checkboxes to apply non-duplicate tags with confirmation.
- `/yaml`: Asks AI to suggest frontmatter fields. Displays checkboxes to safely apply new fields without overwriting existing data.

**Context Selection Order:**
1. Selected text in active Markdown editor.
2. Preserved selection captured from the active note (if focus shifted to panel).
3. Active note content.

> [!NOTE]
> All slash commands recheck context against configured path and term exclusions before contacting an AI provider.

---

## AI Providers & Model Configuration

Lina allows separate provider and model configurations for **Analysis AI** (Chat/LLM) and **Embeddings**.

| Provider | Type | Embeddings | Chat / Analysis | Recommended / Default Models |
| :--- | :--- | :---: | :---: | :--- |
| **Ollama** | Local | ✅ | ✅ | Embeddings: `nomic-embed-text-v2-moe`<br>Chat: `gemma4:e2b` |
| **Mistral** | Remote (API) | ✅ | ✅ | Embeddings: `mistral-embed`<br>Chat: `mistral-small-latest` |
| **OpenRouter** | Remote (API) | ❌ | ✅ | Chat: Configurable model |

### Configuration Details
- **Base URLs:** Automatically populated for Ollama (`http://localhost:11434`), Mistral (`https://api.mistral.ai/v1`), and OpenRouter (`https://openrouter.ai/api/v1`), customizable.
- **Model Selection:** For Ollama and Mistral, select a catalog model from the dropdown or select `Manual/custom model...` to reveal a text field for custom model identifiers. OpenRouter uses a permanent free-text input field.
- **API Keys:** Per-device structure. Keys start empty and require explicit save or clear actions.
- **Batch Size:** Configurable (1–50) for native batching with Mistral and modern Ollama (`/api/embed`). Legacy Ollama endpoint fallback processes 1 item per request.

---

## Mobile & Multi-Device (Syncthing)

### Desktop & Mobile Support
- `isDesktopOnly: false`. Manually validated on Desktop (Windows) and Android (Samsung Galaxy S23 Ultra, One UI 8.5, 8 GB RAM).
- On mobile devices, local Ollama is usually unavailable. Remote providers (or text-only search) are recommended.
- Memory safeguards prevent dangerous allocations. If embeddings exceed safe memory budgets, Lina reports `no-safe-source` and falls back to text search.

### Recommended Syncthing Workflow ("PC Producer / Mobile Consumer")
1. **PC Producer:** Generate the text index and canonical `embeddings.jsonl` on desktop. Optionally maintain the experimental binary shadow copy (`embeddings.vectors.f32`).
2. **Sync Vault:** Sync the `.lina/index/` directory to your mobile device via Syncthing.
3. **Mobile Consumer:** Mobile syncs the pre-built index and validates the publication id, using the safe index for search without high-memory rebuilding overhead.

For full `.stignore` rules and step-by-step instructions, see the [Syncthing Guide in the User Manual](docs/manual.md#module-6-multi-device-sync-best-practices--troubleshooting).

---

## Experimental Binary Embedding Storage

An opt-in derived shadow copy (`embeddings.binary.manifest.json`, `embeddings.meta.jsonl`, `embeddings.vectors.f32`) is available for advanced users:
- **Canonical Source:** `.lina/index/embeddings.jsonl` remains the source of truth.
- **Preference:** `maintainBinaryEmbeddingCopy` (default off) and `embeddingStorageReadPreference` (`prefer-binary`).
- **Safety:** Binary is accepted only when all three files are valid and match the canonical `publicationId`. Falls back safely to JSONL or text search.

---

## Privacy & Local Data Storage

- **Data Path:** Local index operational data is stored strictly in `.lina/index/`.
- **No Web Storage:** Lina does not use `localStorage` or `sessionStorage`. Settings use Obsidian's `loadData`/`saveData` APIs.
- **Network Boundaries:** Zero network traffic by default. External APIs are called only when you explicitly configure a remote provider and run an action.

---

## Development

```bash
# Install dependencies
npm ci

# Build plugin bundle
npm run build

# Run official Obsidian linters
npm run lint:obsidian
npm run lint:obsidian:strict
```

Key build artifacts: `manifest.json`, `main.js`, `styles.css`.

---

## License

[MIT License](LICENSE.md)
