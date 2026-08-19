# Lina — User Manual

Lina is a privacy-first note assistant and search engine for Obsidian, focused on local text search, semantic search, and optional AI-powered note analysis. Its core principle is simple: **help organize and connect notes without taking control away from the user.**

Local text search works immediately with no AI provider or API key. AI is optional and enables semantic search and contextual analysis through **Ollama**, **Mistral**, or **OpenRouter**.

Lina is currently in **alpha (v0.1.17)**.

---

## Table of Contents

- [Module 1: Architecture & Core Concepts](#module-1-architecture--core-concepts)
- [Module 2: The Search Engine & Ranking](#module-2-the-search-engine--ranking)
- [Module 3: AI Note Analysis & Contextual Commands](#module-3-ai-note-analysis--contextual-commands)
- [Module 4: Provider Configuration & Setup](#module-4-provider-configuration--setup)
- [Module 5: Deep Dive: Embedding Lifecycle & Binary Storage](#module-5-deep-dive-embedding-lifecycle--binary-storage)
- [Module 6: Multi-Device Sync, Best Practices & Troubleshooting](#module-6-multi-device-sync-best-practices--troubleshooting)

---

## Module 1: Architecture & Core Concepts

### 1.1 What Lina Does
Lina allows you to:
- Build a local index of Markdown notes inside your vault.
- Perform fast **Text Search**, vector-based **Semantic Search**, or weighted **Hybrid Search**.
- Interactively analyze notes with AI using Retrieval-Augmented Generation (RAG).
- Execute contextual slash commands (`/ask`, `/tags`, `/yaml`) directly from the sidebar.
- Receive safe suggestions for tags and frontmatter/YAML fields.
- Run local AI models via **Ollama** or remote models via **Mistral** and **OpenRouter**.
- Maintain independent provider settings per device (desktop, laptop, mobile).

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
Lina 0.2 introduces an explicit capability architecture to handle multi-device workflows seamlessly from a single plugin codebase:

* **Desktop Producer:** Desktop workstations act as the authoritative producers of search assets, orchestrated by the [`MaintenanceEngine`](architecture/maintenance-engine.md). They watch vault file changes and maintain the text index (`TextIndexWorker`), reconcile startup and exclusion drift (`ReconciliationWorker`), compile derived binary vector copies (`BinaryWorker`), and maintain vector embeddings automatically for local Ollama (`EmbeddingScheduler` and `EmbeddingWorker`).
* **Mobile Companion:** Mobile devices (phones and tablets) act as streamlined consumers. They ingest synchronized `.lina/index/` files, execute fast in-memory text search, perform vector similarity search within mobile memory budgets, and run AI note analysis.
* **Runtime Enforcement:** To prevent split-brain synchronization conflicts and conserve mobile battery/memory, Mobile Companion deactivates background vault watchers, startup diff reconciliations, and manual generation pipelines. Mobile is not a limited version—it is a tailored responsibility model optimized for fast, reliable search consumption.

For technical details on the coordinator and workers, see the [Maintenance Engine Architecture](architecture/maintenance-engine.md), [EmbeddingWorker](architecture/embedding-worker.md), and [Device Capabilities](architecture/device-capabilities.md) specifications.

---

## Module 2: The Search Engine & Ranking

Lina provides three distinct search modes in its persistent sidebar panel:

### 2.1 Search Modes
1. **Hybrid Search (Recommended):** Combines textual and semantic similarity into a single ranked list. It ensures exact keyword matches appear alongside conceptual matches.
2. **Text Search:** Performs local exact, prefix, and substring matching against note titles, paths, and content.
3. **Semantic Search:** Uses vector embeddings to find notes related by meaning, even if they use completely different vocabulary (e.g., searching "organizing lessons" finds notes about "pedagogical planning").

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

## Module 4: Provider Configuration & Setup

### 4.1 Independent Per-Device Settings
Lina stores settings in `data.json` using a per-device key structure (derived from system characteristics). This enables flexible multi-device setups:
- **Desktop:** High-performance local Ollama for analysis and embeddings.
- **Laptop / Mobile:** Remote Mistral or OpenRouter API, or text-only search mode.

### 4.2 Analysis AI vs. Embeddings Configuration
You can configure **different** providers and models for AI Analysis and Vector Embeddings:

```text
[Analysis AI Provider] ──► Chat/LLM Model (e.g., Ollama gemma4:e2b or Mistral mistral-small-latest)
[Embeddings Provider]  ──► Vector Model   (e.g., Ollama nomic-embed-text-v2-moe, Mistral mistral-embed, or OpenRouter openai/text-embedding-3-small)
```

> **Model Selection Controls & Provider Filtering:**
> - **Domain-Specific Filtering:** Lina only lists providers implemented for each domain (Analysis AI: Ollama, Mistral; Embeddings: Ollama, Mistral, OpenRouter).
> - **Ollama & Mistral:** Select a known model from the dropdown catalog or select **Manual/custom model...** to enter a custom model identifier.
> - **OpenRouter:** Embedding models are entered via a direct text input field (defaulting to `openai/text-embedding-3-small`; any embedding-capable model ID can be used).

### 4.3 Setting Up Ollama (Local AI)
1. Install and launch [Ollama](https://ollama.ai).
2. Pull your chosen models: `ollama pull nomic-embed-text-v2-moe` and `ollama pull gemma4:e2b`.
3. In Lina Settings, set Provider to `Ollama` and Base URL to `http://localhost:11434`.
4. Click **Test Connection** to verify API responsiveness.

### 4.4 Setting Up Mistral or OpenRouter (Remote AI)
1. In Lina Settings, configure your preferred provider (Mistral or OpenRouter).
2. Provide your API key and click **Save**. Keys are stored securely per-device.
3. Click **Test Connection** to verify your API credentials and model availability.

> [!WARNING]
> Use of remote provider APIs may incur costs charged by the respective provider.

### 4.5 Development Build Information
In development builds, the bottom of the Settings tab displays a **Development build** item showing compile-time bundle metadata (`main.js` and build timestamp). This information is purely informational and is strictly excluded from `LinaSettings` / `data.json` configuration storage.

---

## Module 5: Deep Dive: Embedding Lifecycle & Binary Storage

### 5.1 Automatic & Manual Maintenance
- **Automatic Local Maintenance (Ollama on Desktop Producer):** Lina automatically maintains vector embeddings in the background after you finish editing notes (following a 30-second quiet period).
- **Remote Providers (Mistral, OpenRouter):** Embeddings for remote providers remain strictly manual-only to prevent unexpected third-party API billing. Use of remote provider APIs may incur costs charged by the respective provider.
- **Batch Size:** Configurable from 1 to 50 chunks per request for native batching with Mistral, OpenRouter, and modern Ollama (`/api/embed`).
- **Checkpointing:** Validated batches are appended to an internal checkpoint (`embeddings.checkpoint.*`). If generation is interrupted or fails, subsequent automatic or manual runs resume from the last valid checkpoint without wasting provider requests.
- **Publication Safety & Automatic Status Convergence:** Final publication validates embeddings against index manifests, creates backups, performs atomic rollbacks if errors occur, and triggers downstream binary compilation. The status system automatically recalculates derived state from disk artifacts upon publication without requiring manual "Refresh embedding status" interaction.

### 5.2 Embedding Update Planner
When an embedding update is initiated (manually or automatically via scheduler), Lina's central planner evaluates current chunks and target configurations to choose one of three modes:
1. **Initial Build:** Executed when no canonical embedding index exists.
2. **Incremental Update:** Executed when the provider, model, dimensions, and prefix modes match the target identity. Only missing or modified chunks are generated.
3. **Full Rebuild:** Executed when provider or model settings change. Requires explicit user confirmation.

### 5.3 Derived Vector States
Canonical embedding status is categorized into four states:
- **Valid:** Record matches target chunk content and provider identity.
- **Missing:** Current chunk has no corresponding embedding vector.
- **Stale:** Content hash or input version changed since generation.
- **Obsolete:** Note/chunk was deleted from the vault.

### 5.4 Experimental Binary Embedding Storage
To optimize mobile load times and reduce memory parsing overhead, Lina offers an opt-in binary shadow set:
```text
.lina/index/
├── embeddings.jsonl             # Canonical JSONL source of truth
├── embeddings.binary.manifest.json # Binary copy metadata & source publication ID
├── embeddings.meta.jsonl        # Binary index chunk mapping
└── embeddings.vectors.f32       # Float32Array raw binary vector storage
```

- Enabled via `maintainBinaryEmbeddingCopy` (default off).
- Active preference: `embeddingStorageReadPreference` (`prefer-binary` vs `jsonl`).
- Binary files are used only when all 3 files exist, are valid, and match the canonical `publicationId`. If unsafe or invalid, Lina safely falls back to JSONL or text-only search (`no-safe-source`).

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
| Binary fallback to JSONL | Binary shadow set missing, invalid, or `publicationId` mismatched. | Re-publish canonical embeddings on desktop with binary maintenance enabled. |
| Provider Connection Failed | Ollama not running or incorrect Base URL / API key. | Check local service status (`http://localhost:11434`) or verify remote API credentials. |
| Stale Embeddings Warning | Model or provider settings changed in settings tab. | Run a manual embedding update/rebuild to align vector space identities. |

---

## Current Alpha Limitations

- Automatic embedding maintenance is currently enabled for the local Ollama provider on Desktop Producer; remote API providers (Mistral, OpenRouter) remain manual-only. Use of remote provider APIs may incur costs charged by the respective provider.
- Official supported AI providers are **Ollama** (local), **Mistral** (remote), and **OpenRouter** (remote; embeddings currently supported, chat/analysis planned).
- Mobile Companion remains strictly consumption-only for synchronized search assets.
- Document analysis for PDF, DOCX, and images is planned for future releases.
