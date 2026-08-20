# Lina (ALPHA)

[![Version](https://img.shields.io/badge/version-0.1.19--alpha-orange.svg)](manifest.json)
[![Obsidian](https://img.shields.io/badge/Obsidian-v1.13.0%2B-purple.svg)](https://obsidian.md)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Desktop%20%7C%20Android-green.svg)](#mobile--multi-device-syncthing)

> AI-powered note assistant and hybrid search engine for Obsidian. Features local indexing, semantic search, contextual slash commands, and privacy-first AI analysis.

Current development version: **0.1.19**.

[User Manual](docs/manual.md) | [Commands Guide](docs/commands.md) | [Changelog](CHANGELOG.md) | [Roadmap](docs/roadmap.md)

---

## Overview & Key Features

Lina helps you find, connect, and enrich Markdown notes in Obsidian without taking control away from you.

> **Start locally:** Text search works immediately without any AI provider or API key. Semantic search is optional and powered by local or remote AI embeddings.

- 🔍 **Hybrid Search:** Combines fast local text indexing with semantic vector embeddings into a single ranked list. Text search works out-of-the-box; semantic search seamlessly enhances results when embeddings are generated.
- ⚡ **Contextual Slash Commands:** Execute `/ask` (AI note query), `/tags` (smart tag suggestions), and `/yaml` (frontmatter generation) directly from the sidebar input.
- 🔒 **Privacy First:** All indexing data is stored locally in `.lina/index/`. Zero network requests by default. Remote AI providers are contacted only when explicitly configured and triggered.
- 🛡️ **Explicit Confirmation:** AI responses, tag additions, and YAML fields are applied to active notes only after your explicit confirmation.
- 📱 **Mobile & Multi-Device Sync:** Streamlined search on mobile devices (validated on Android) with automated search artifact management and multi-device sync support (e.g., Syncthing).

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
> When installed for the first time, Lina does not auto-build the full index. Open the Lina side panel and click **Rebuild Index** (or run the rebuild index command). Once a valid text index exists, Lina keeps it updated automatically in the background. For vector embeddings, local Ollama on Desktop Producer automatically maintains embeddings in the background after editing ceases; remote providers (Mistral, OpenRouter) remain manual-only.

---

## Features & Side Panel

The Lina panel lives in Obsidian's right sidebar. It serves as your search interface and AI assistant hub.

### Search Modes
- **Hybrid (Recommended):** Combines text (default weight `0.7`) and semantic similarity (default weight `0.3`) into a single ranked result list.
- **Text:** Fast local search by note title, path, or content. Works immediately without any AI configuration. Supports exact, prefix, and substring matching.
- **Semantic:** Meaning-based search powered by vector embeddings. Optional, requires generated embeddings.

Short, non-empty notes remain eligible for text search. If hybrid-query preprocessing removes every useful term, Lina preserves a textual fallback instead of silently issuing an empty text search.

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

Lina allows **independent** provider and model configurations for **Analysis AI** (Chat/LLM) and **Embeddings**:

- **Analysis Provider:** Powers AI note analysis, chat-based slash commands (`/ask`), and contextual suggestions (`/tags`, `/yaml`).
- **Embedding Provider:** Powers semantic indexing, vector generation, and semantic/hybrid search.

These configurations are completely decoupled. You can combine providers according to your workflow (e.g., Analysis with OpenRouter and Embeddings with local Ollama, or Analysis with Mistral and Embeddings with OpenRouter).

| Provider | Analysis / Chat | Embeddings | Automatic embedding maintenance |
| :--- | :---: | :---: | :--- |
| **Ollama** | Supported | Supported | Supported on Desktop Producer |
| **Mistral** | Supported | Supported | Manual only |
| **OpenRouter** | Supported | Supported | Manual only |

> [!NOTE]
> - **Local AI (Ollama):** Operates on your local machine using local compute with zero API billing. Automatic embedding maintenance is active on Desktop Producer.
> - **Remote AI Providers (Mistral, OpenRouter):** External API usage may involve costs charged by the respective providers. Automatic embedding maintenance for remote providers remains manual-only.

### Configuration Details
- **Base URLs:** Automatically populated for Ollama (`http://localhost:11434`), Mistral (`https://api.mistral.ai/v1`), and OpenRouter (`https://openrouter.ai/api/v1`), and fully customizable.
- **Model Selection:**
  - **Analysis AI:** Select known catalog models (Ollama: `gemma4:e2b`; Mistral: `mistral-small-latest`, `mistral-large-latest`) or enter any custom model identifier. For OpenRouter, enter any compatible model ID (e.g., `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.3-70b-instruct`).
  - **Embeddings:** Select known catalog models (Ollama: `nomic-embed-text-v2-moe`; Mistral: `mistral-embed`; OpenRouter: `openai/text-embedding-3-small`) or enter a custom embedding model.
- **Coherent Provider Changes:** Changing a provider updates the provider, model, and Base URL together when standard defaults are in use, while preserving genuine custom endpoints. Switching provider or model updates compatibility state immediately without deleting existing embeddings or initiating unprompted generation.
- **API Keys:** Per-device configuration. Keys start empty, are stored securely per device, and require explicit save or clear actions.
- **Batch Size:** Configurable (1–50) for native embedding batching with Mistral, OpenRouter, and modern Ollama (`/api/embed`).

---

## Mobile & Multi-Device (Syncthing)

### Desktop Producer & Mobile Companion Architecture
- `isDesktopOnly: false`. Manually validated on Desktop (Windows) and Android (Samsung Galaxy S23 Ultra, One UI 8.5, 8 GB RAM).
- **Desktop Producer:** Responsible for text indexing, embedding generation, canonical embedding publication, derived binary artifact creation, and automatic repair of missing derived artifacts.
- **Mobile Companion:** Consumer only. Consumes synchronized artifacts and performs search without generating embeddings or creating binary artifacts locally.
- **Memory Safeguards:** Memory-aware protections prevent dangerous allocations on mobile (16MB vector limit / 64MB peak memory). If memory limits are exceeded, Lina falls back safely to text search.

### Recommended Syncthing Workflow ("Desktop Producer / Mobile Companion")
1. **Desktop Producer:** Build the text index and generate embeddings on desktop. Lina automatically creates and maintains optimized search data.
2. **Sync Vault:** Sync the `.lina/index/` directory to your mobile device via Syncthing.
3. **Mobile Companion:** Mobile loads the pre-built synchronized index for instant search and AI note features without battery-draining indexing overhead.

For full `.stignore` rules and step-by-step instructions, see the [Syncthing Guide in the User Manual](docs/manual.md#module-6-multi-device-sync-best-practices--troubleshooting).

---

## Optimized Semantic Search Data

Lina automatically prepares and manages optimized semantic search data once vector embeddings are generated or when existing installations need migration:
- **Automatic Preparation:** Optimized search data is generated downstream after canonical embeddings are published.
- **Derived Data:** Binary artifacts are derived data; users do not manage, compile, or edit them manually.
- **Self-Healing on Desktop:** If optimized search artifacts are ever missing on a Desktop Producer, Lina repairs them automatically.
- **Standard User State:** When embeddings and search data are ready, Lina reports:
  ```text
  Embeddings: ready
  Semantic: available
  ```

---

## Privacy & Local Data Storage

- **Data Path:** Local index operational data is stored strictly in `.lina/index/`.
- **No Web Storage:** Lina does not use `localStorage` or `sessionStorage`. Settings use Obsidian's `loadData`/`saveData` APIs.
- **Network Boundaries:** Zero network traffic by default. External APIs are called only when you explicitly configure a remote provider and run an action.

---

## Support and feedback

If you experience difficulties, find a bug, or have a suggestion, you can contact us through:

- [Support and feedback form](https://forms.gle/9TeD7hdb9AbjhNFt9)
- Email: [apinheiro@duck.com](mailto:apinheiro@duck.com?subject=Lina%20support%20request)

Contact details are only used to respond to the matter submitted and are not shared with third parties.

---

## Development

Contributions are welcome. Lina uses automated validation to keep changes reliable.

```bash
# Install dependencies
npm ci

# Run the development build
npm run dev

# Validate a change
npm run lint
npm test
npm run build
```

Before preparing a release, run:

```bash
npm run release:validate
```

The same checks run in CI before release publishing.

---

## License

[MIT License](LICENSE.md)
