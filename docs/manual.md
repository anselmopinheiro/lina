# Lina — User Manual

Lina is a privacy-first note assistant and search engine for Obsidian, focused on local text search, semantic search, and optional AI-powered note analysis. Its core principle is simple: **help organize and connect notes without taking control away from the user.**

Local text search works immediately with no AI provider or API key. AI is optional. **Ollama**, **Mistral**, and **OpenRouter** support analysis and embeddings.

Lina is currently in **alpha (v0.1.19)**.

---

## Table of Contents

- [Module 1: Architecture & Core Concepts](#module-1-architecture--core-concepts)
- [Module 2: The Search Engine & Ranking](#module-2-the-search-engine--ranking)
- [Module 3: AI Note Analysis & Contextual Commands](#module-3-ai-note-analysis--contextual-commands)
- [Module 4: Settings & Provider Configuration](#module-4-settings--provider-configuration)
- [Module 5: Deep Dive: Embedding Lifecycle & Optimized Search Data](#module-5-deep-dive-embedding-lifecycle--optimized-search-data)
- [Module 6: Multi-Device Sync, Best Practices & Troubleshooting](#module-6-multi-device-sync-best-practices--troubleshooting)

---

## Module 1: Architecture & Core Concepts

### 1.1 What Lina Does
Lina allows you to:
- Build a local index of Markdown notes inside your vault.
- Perform fast **Text Search**, vector-based **Semantic Search**, or weighted **Hybrid Search**.
- Text search works immediately out-of-the-box without AI; semantic search is optional and powered by vector embeddings.
- Interactively analyze notes with AI using Retrieval-Augmented Generation (RAG).
- Execute contextual slash commands (`/ask`, `/tags`, `/yaml`) directly from the sidebar.
- Receive safe suggestions for tags and frontmatter/YAML fields with explicit confirmation.
- Run local analysis and embeddings via **Ollama**, remote analysis and embeddings via **Mistral**, or remote analysis and embeddings via **OpenRouter**.
- Maintain independent provider settings per device (desktop, laptop, mobile).
- Automatically manage required search artifacts without manual maintenance overhead.

### 1.2 Local Index Structure
To enable fast search across large vaults, Lina creates an internal operational index at:

```text
.lina/index/
├── manifest.json       # Index versioning and metadata
├── notes.json          # Indexed note registry and content hashes
└── chunks.jsonl        # Segmented text blocks used for search
```

> [!NOTE]
> **First Index Build:** When Lina is installed or enabled for the first time, it does not build the index automatically. You must trigger the initial build manually via the Lina side panel (**Rebuild Index** button) or command palette, or synchronize an existing valid `.lina/index/` directory from another device. Once a valid index exists (created locally or synchronized), Lina recognizes it and keeps it updated automatically as notes change.

### 1.3 Text Chunking & Exclusions
During indexing, Lina splits long Markdown notes into smaller text blocks (chunks) with controlled overlap. This improves search precision and allows Lina to send only relevant context to AI models.

**Exclusion Rules:**
- Path exclusions can be configured in settings to exclude private, archive, or temporary folders.
- Internal configuration folders (`.lina/` and `<configDir>` such as `.obsidian/`) are permanently excluded from indexing.
- Changes to exclusion rules take effect immediately at runtime, updating search results without requiring a vault restart or manual index rebuild.
- Renaming or moving notes updates the index automatically: moving a note into an excluded location removes it from search results, and moving it back into an eligible location restores it.

### 1.4 Device Capabilities: Desktop Producer & Mobile Companion
Lina introduces an explicit capability architecture to handle multi-device workflows seamlessly from a single plugin codebase:

* **Desktop Producer:** Desktop workstations act as the authoritative producers of search assets. They are responsible for:
  - Text index maintenance from vault file changes;
  - Embedding generation;
  - Canonical embedding publication;
  - Derived binary artifact creation;
  - Automatic repair of missing derived artifacts.
* **Mobile Companion:** Mobile devices (phones and tablets) act as streamlined consumers only:
  - Consumes synchronized search artifacts;
  - Performs fast local text, semantic, and hybrid search;
  - Does not generate embeddings;
  - Does not create binary artifacts.
* **Runtime Safeguards:** To prevent synchronization race conditions and conserve mobile battery and memory, Mobile Companion deactivates background vault watchers, startup diff reconciliations, and local generation pipelines. Mobile is not a limited version—it is a tailored responsibility model optimized for fast, reliable search consumption.

---

## Module 2: The Search Engine & Ranking

Lina provides three distinct search modes in its persistent sidebar panel:

### 2.1 Search Modes
1. **Hybrid Search (Recommended):** Combines textual and semantic similarity into a single ranked list. It ensures exact keyword matches appear alongside conceptual matches.
2. **Text Search:** Performs fast local exact, prefix, and substring matching against note titles, paths, and content. Works immediately without AI.
3. **Semantic Search:** Uses vector embeddings to find notes related by meaning, even if they use completely different vocabulary (e.g., searching "organizing lessons" finds notes about "pedagogical planning"). Optional, requires generated embeddings.

Short, non-empty notes remain text-searchable. When hybrid preprocessing removes all useful query terms, Lina retains a textual fallback rather than collapsing the request to an empty text search. Lina automatically manages all required internal artifacts to power these search modes.

### 2.2 Scoring & Indicators
Each result in the search view displays key indicators:
- **Relevance:** The overall combined ranking score.
- **Similarity:** The mathematical vector proximity (cosine distance) between your query and the match.
- **Result Source:** Explains why the note matched (`name`, `path`, `text`, `semantic`, or `hybrid`).

### 2.3 Adjusting Hybrid Weights
You can fine-tune the balance between text matching and semantic search in settings:
- **Default Weights:** `Text: 0.7`, `Semantic: 0.3`.
- **Higher Text Weight:** Prioritizes exact phrases and file titles.
- **Higher Semantic Weight:** Prioritizes conceptual relationships and meaning.

---

## Module 3: AI Note Analysis & Contextual Commands

### 3.1 Note Analysis Workflow
When you request AI Analysis for a note, Lina uses the configured provider and Retrieval-Augmented Generation (RAG):
1. Reads the active Markdown note.
2. Performs a hybrid search to find relevant context from related notes.
3. Packages the active note and retrieved excerpts into a prompt.
4. Sends the request to your configured Analysis AI model.
5. Displays a contextual response in the sidebar, with optional suggestions for tags and frontmatter/YAML fields.

> [!IMPORTANT]
> **Suggestion Mode:** Lina never modifies your notes automatically. Every AI suggestion requires explicit user confirmation before writing to disk.

### 3.2 Contextual Slash Commands
The sidebar search bar supports slash commands in English:

- **`/ask <prompt>`:** Asks the AI provider about the active context. Allows copying responses, inserting below a selection, replacing a selection, or appending to the note.
- **`/tags`:** Asks the AI provider to suggest tags for the context. Displays checkboxes to apply selected non-duplicate tags.
- **`/yaml`:** Asks the AI provider to suggest frontmatter fields. Displays checkboxes to safely insert new fields without overwriting existing data.

**Context Selection Priority:**
1. Active editor text selection.
2. Preserved text selection (captured before focus moved to panel).
3. Entire active note content.

> [!NOTE]
> For detailed rules and reserved commands, consult the dedicated [Commands Guide](commands.md).

---

## Module 4: Settings & Provider Configuration

### 4.1 Settings Organization (Basic, Advanced, and Recovery)

Lina’s settings are organized into three clear, accessible areas to separate routine configuration from technical tuning and diagnostic recovery:

#### Basic Settings
Contains everyday configuration options for using Lina:
- **Current device:** Configure a friendly name for the active device and view the local storage scope.
- **AI analysis:** Select the analysis provider, model (catalog or manual), Base URL, API key, timeout, and run connection tests.
- **Embeddings:** Configure semantic search embedding provider, model, API key, batch size, timeout, default language, and connection tests.
- **Inbox folder:** Specify the inbox folder path for batch analysis and note processing limits.
- **Index exclusions:** Configure folder exclusions, sensitive path terms, content keywords, and view configuration folder notes.
- **YAML / note properties:** Enable/disable frontmatter suggestions, configure allowed YAML property keys, and toggle tag inclusions.
- **Multilingual:** Select interface language and configure multilingual guidance.
- **Support:** Access the feedback form and support contact details.

#### Advanced Settings
Contains technical options and fine-tuning controls for experienced users:
- **Index options:** Manage startup synchronization checks, startup index updates, automatic file-change updates, and debug logging.
- **Hybrid search:** Adjust relative scoring weights between text search and semantic search.
- **Search storage:** Configure search storage preferences and background storage maintenance.

#### Maintenance & Recovery
Contains diagnostic inspections and recovery operations:
- **Search data validation:** Inspect search data status, record counts, and health.
- **Recovery actions:** Check, create/update, or remove search data with explicit confirmation modals and destructive action safeguards.

> [!NOTE]
> Reorganizing settings is purely visual. All existing configuration keys, provider setups, and user choices continue to work seamlessly without requiring any migration.

### 4.2 Independent Per-Device Settings
Lina stores settings in `data.json` using a per-device key structure (derived from system characteristics). This enables flexible multi-device setups:
- **Desktop:** High-performance local Ollama for analysis and embeddings.
- **Laptop / Mobile:** Remote Mistral or OpenRouter API, or text-only search mode.

### 4.3 Analysis AI vs. Embeddings Configuration
Lina allows **independent** provider and model configurations for **Analysis AI** (Chat/LLM) and **Vector Embeddings**:

- **Analysis Provider:** Powers note analysis, chat-based slash commands (`/ask`), and contextual suggestions (`/tags`, `/yaml`).
- **Embedding Provider:** Powers semantic indexing, vector generation, and semantic/hybrid search.

These configurations are completely decoupled. You can combine providers according to your requirements:
- *Example 1:* Analysis using **OpenRouter** (cloud LLM) with Embeddings using local **Ollama** (zero-cost local embeddings).
- *Example 2:* Analysis using **Mistral** with Embeddings using **OpenRouter**.
- *Example 3:* Full local operation using **Ollama** for both analysis and embeddings.

```text
[Analysis AI Provider] ──► Chat/LLM Model (e.g., Ollama gemma4:e2b, Mistral mistral-small-latest, or OpenRouter openai/gpt-4o-mini)
[Embeddings Provider]  ──► Vector Model   (e.g., Ollama nomic-embed-text-v2-moe, Mistral mistral-embed, or OpenRouter openai/text-embedding-3-small)
```

#### Provider Capabilities

| Provider | Analysis / Chat | Embeddings | Automatic embedding maintenance |
| :--- | :---: | :---: | :--- |
| **Ollama** | Supported | Supported | Supported on Desktop Producer |
| **Mistral** | Supported | Supported | Manual only |
| **OpenRouter** | Supported | Supported | Manual only |

> [!WARNING]
> External API usage may involve costs charged by the respective providers.

Changing an embedding provider keeps the provider, model, and Base URL coherent when Lina's known defaults are in use:

| Provider | Default embedding model | Default Base URL |
| :--- | :--- | :--- |
| Ollama | `nomic-embed-text-v2-moe` | `http://localhost:11434` |
| Mistral | `mistral-embed` | `https://api.mistral.ai/v1` |
| OpenRouter | `openai/text-embedding-3-small` | `https://openrouter.ai/api/v1` |

A genuine custom or proxy Base URL is preserved. Changing provider or model recalculates compatibility immediately without deleting canonical embeddings or checkpoints, contacting a provider, or starting unprompted generation.

### 4.4 Setting Up Ollama (Local AI)
1. Install and launch [Ollama](https://ollama.ai).
2. Pull your chosen models: `ollama pull nomic-embed-text-v2-moe` and `ollama pull gemma4:e2b`.
3. In Lina Settings, set Provider to `Ollama` and Base URL to `http://localhost:11434`.
4. Click **Test Connection** to verify API responsiveness.

### 4.5 Setting Up Mistral or OpenRouter (Remote AI)
1. In Lina Settings, choose your provider under **Analysis AI**, **Embeddings**, or both:
   - **Mistral:** Offers catalog models (`mistral-small-latest`, `mistral-large-latest` for analysis; `mistral-embed` for embeddings) or custom models.
   - **OpenRouter:** For Analysis AI, enter any compatible chat model identifier (e.g., `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.3-70b-instruct`). For Embeddings, select the default `openai/text-embedding-3-small` or enter a custom embedding model.
2. Provide your API key and click **Save**. Keys are stored securely per-device and never exposed in logs or diagnostics.
3. Click **Test Connection** to verify your API credentials and model availability.

#### Troubleshooting Remote API Connections:
- **Invalid API Key:** Verify that the full API key is entered and click **Save** before testing.
- **Provider Unavailable / Network Failures:** Check your internet connection and confirm the remote provider service is operational.
- **Rate Limits (HTTP 429):** The provider has temporarily throttled requests. Wait a brief moment before retrying or check your account rate tier.
- **Billing / Account Restrictions (HTTP 402):** Check your provider account dashboard to ensure active credits or billing are in place.

### 4.6 Version & Build Information
The top header of the Settings tab displays the active plugin version (`manifest.json`) alongside compile-time build metadata (`main.js` build timestamp). This information is purely informational and is strictly excluded from `LinaSettings` / `data.json` configuration storage.

---

## Module 5: Deep Dive: Embedding Lifecycle & Optimized Search Data

### 5.1 The Embedding Lifecycle
Lina processes notes into semantic search assets through a clear, staged lifecycle:

```text
Vault notes
    ↓
Text index
    ↓
Embedding generation
    ↓
Canonical embeddings publication
    ↓
Binary artifact generation
    ↓
Semantic runtime
    ↓
Semantic search
```

1. **Vault Notes:** Notes are written, edited, or moved in your Obsidian vault.
2. **Text Index:** Notes are chunked, hashed, and tracked in `.lina/index/`.
3. **Embedding Generation:** Vectors are computed for new or modified chunks via the configured provider (local Ollama or remote Mistral/OpenRouter).
4. **Canonical Embeddings Publication:** Validated embeddings are atomically published to the canonical store.
5. **Binary Artifact Generation:** Lina automatically derives optimized binary vector data for high-speed in-memory loading.
6. **Semantic Runtime:** The binary-first search runtime ingests vector data with minimal memory overhead.
7. **Semantic Search:** Semantic and hybrid queries return instantaneous, ranked note results.

> [!NOTE]
> Binary artifacts are derived data. Users do not manage them. Lina automatically prepares optimized semantic search data after embeddings exist or when existing installations need migration. On Desktop Producer, missing derived artifacts are repaired automatically.

### 5.2 Automatic & Manual Maintenance
- **Automatic Local Maintenance (Ollama on Desktop Producer):** Lina automatically maintains vector embeddings in the background after you finish editing notes (following a 30-second quiet period).
- **Remote Providers (Mistral, OpenRouter):** Embeddings for remote providers remain strictly manual-only to prevent unexpected third-party API billing. External API usage may involve costs charged by the respective providers.
- **Batch Size:** Configurable from 1 to 50 chunks per request for native batching with Mistral, OpenRouter, and modern Ollama (`/api/embed`).
- **Checkpointing:** Validated batches are appended to an internal checkpoint. If generation is interrupted or fails, subsequent runs resume from the last valid checkpoint without wasting provider requests.
- **Publication Safety:** Final publication validates embeddings against index manifests, performs atomic rollbacks if errors occur, and triggers downstream binary generation.

### 5.3 Status and Diagnostics
When search assets are fully prepared and synchronized, the normal user-facing state is:

```text
Embeddings: ready
Semantic: available
```

Lina communicates distinct states clearly in the side panel and settings:
- **Ready / Up to date:** Published embeddings match all current note chunks and active provider configuration.
- **Incremental update available:** Notes were added or modified; an update will process only new or changed chunks.
- **Full rebuild required:** The embedding provider or model configuration was changed; vector spaces cannot be mixed.
- **Provider-model mismatch / Incompatible:** Published embeddings belong to a different provider/model than currently selected. Switching back to the original provider/model immediately restores compatibility without regeneration.

### 5.4 Optimized Binary Semantic Runtime
Lina uses a binary-first runtime to accelerate search startup and minimize memory consumption:
- **Instant Loading:** Contiguous vector buffers allow near-instantaneous memory mapping on startup.
- **Memory Efficiency:** Reduces memory consumption significantly compared to text parsing, particularly beneficial on mobile devices.
- **Automatic Lifecycle:** Generated, updated, and repaired automatically on Desktop Producer; consumed transparently on Mobile Companion.

---

## Module 6: Multi-Device Sync, Best Practices & Troubleshooting

### 6.1 Syncthing & Multi-Device Setup ("Desktop Producer / Mobile Companion")
Lina's multi-device architecture is designed around the **Desktop Producer / Mobile Companion** model. Desktop builds and maintains the search assets in `.lina/index/`, while Mobile seamlessly consumes the synchronized artifacts for search without running local compilation loops.

When syncing vaults across devices via Syncthing, use the following recommended `.stignore` configuration:

```text
/<configDir>*
/.trash/
*.tmp
*.sync-conflict-*
```
*(where `<configDir>` is your vault's active config folder, default `.obsidian`)*

#### Sync Matrix Summary

| Component | Synced? | Behavior & Notes |
| :--- | :---: | :--- |
| **Markdown Notes** | ✅ Yes | Synced normally across devices. |
| **`.lina/index/`** | ✅ Yes | Synced so Mobile Companion reuses text index & embeddings built on Desktop Producer. |
| **`<configDir>/` (`data.json`)** | ❌ No | Excluded by `.stignore`. Each device retains its own settings. |
| **Plugin Folder** | ❌ No | Plugin must be installed on each device via Community Plugins. |

> [!TIP]
> Valid text indexes and vector files synchronized to `.lina/index/` are recognized immediately on startup or reload. Mobile Companion consumes the synchronized index for search without triggering local rebuilds or vault file watchers.

### 6.2 Troubleshooting Matrix

| Symptom / Status | Root Cause | Resolution |
| :--- | :--- | :--- |
| `no-safe-source` | Memory limit safeguard triggered on low-RAM mobile device. | Use text search mode or reduce index chunk size. |
| Provider Connection Failed | Ollama not running or incorrect Base URL / API key. | Check local service status (`http://localhost:11434`) or verify remote API credentials. |
| Incremental update available | Notes were added or modified since the last embedding generation. | Trigger an embedding update, or allow automatic Ollama maintenance on Desktop Producer to complete. |
| Full embedding rebuild required | Published provider/model differs from the configured identity. | Confirm the intended provider/model, then run the explicit full rebuild. Switching back restores compatibility without regeneration if published artifacts remain valid. |
| Semantic search unavailable | Embeddings have not been generated yet or provider is incompatible. | Generate embeddings on Desktop Producer, or align your configured provider/model with published embeddings. |

---

## Current Alpha Limitations

- Automatic embedding maintenance is currently enabled for the local Ollama provider on Desktop Producer; remote API providers (Mistral, OpenRouter) remain manual-only. External API usage may involve costs charged by the respective providers.
- Official supported AI providers are **Ollama** (local analysis and embeddings), **Mistral** (remote analysis and embeddings), and **OpenRouter** (remote analysis and embeddings).
- Mobile Companion remains strictly consumption-only for synchronized search assets.
- Document analysis for PDF, DOCX, and images is planned for future releases.
