# Lina — User Manual

Lina is a privacy-first note assistant and search engine for Obsidian, focused on local text search, semantic search, and optional AI-powered note analysis. Its core principle is simple: **help organize and connect notes without taking control away from the user.**

Local text search works immediately with no AI provider or API key. AI is optional. **Ollama**, **Mistral**, and **OpenRouter** support analysis and embeddings.

Current version: **0.2.4** (with 0.3.x multi-device architecture).

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

### 1.2 Local Storage & Index Structure
Lina organizes operational data in `.lina/` inside your vault:

```text
.lina/
├── exclusions.json         # Canonical Exclusion Policy (Active Producer managed)
├── ownership.json          # Single-Active-Producer authority & epoch fencing
├── ownership-history/      # Append-only ownership transition audit log
├── producer-state.json     # Producer publication state & freshness metadata
├── devices/<deviceId>.json # Device-scoped local configuration & assigned role
└── index/
    ├── manifest.json       # Index version, generation digests, & Vector Contract
    ├── notes.json          # Indexed note registry and content hashes
    ├── chunks.jsonl        # Segmented text blocks used for search
    ├── embeddings.jsonl    # Canonical embedding vectors (if enabled)
    └── embeddings.vectors.f32 # Memory-mapped binary acceleration vector buffer
```

> [!NOTE]
> **First Index Build:** When Lina is installed or enabled for the first time on an Active Producer, trigger the initial build via the Lina side panel (**Rebuild Index** button) or command palette. Once created, Lina maintains the text index automatically. Companion devices consume the synchronized `.lina/index/` directory without running local background builders.

### 1.3 Text Chunking & Canonical Exclusion Policy
During indexing, Lina splits long Markdown notes into smaller text blocks (chunks) with controlled overlap. This improves search precision and ensures only relevant context is sent to AI models.

**Exclusion Rules & Canonical Policy:**
- **Canonical Policy (`.lina/exclusions.json`):** Folder paths, path substrings/tokens, and content keywords are governed by a canonical policy file managed strictly by the Active Producer.
- **Companion Read-Only & Defensive Filtering:** Companion devices view exclusions in read-only mode and defensively apply policy rules at query time across all search modes (text, semantic, hybrid, and delta search).
- **Internal Configuration Folders:** `.lina/` and `<configDir>` (such as `.obsidian/`) are permanently excluded from indexing.
- **Safe Note Purging:** When exclusions are updated, newly excluded notes are purged from the text index and embedding storage without altering or deleting original user markdown files.

### 1.4 Device Capabilities: Desktop Producer & Mobile Companion
Lina coordinates multi-device workflows seamlessly from a single plugin codebase:

* **Desktop Producer:** Workstations designated as Producers:
  - **Active Producer:** The sole machine holding publishing authority (`.lina/ownership.json`). Maintains text index from vault changes, plans and generates embeddings, compiles fast search caches, and publishes canonical shared artifacts (`.lina/index/*`, `.lina/exclusions.json`, `.lina/producer-state.json`).
  - **Standby Producer:** A configured Producer machine operating safely without publication authority. Can be promoted to Active Producer at any time with monotonic epoch fencing ($E \to E + 1$).
* **Mobile Companion:** Mobile devices (phones and tablets) and lightweight desktop consumers:
  - Consume synchronized search artifacts directly;
  - Inherit the published Vector Contract (`VectorContractV1`) from the Producer;
  - Perform fast local text, semantic, and hybrid search;
  - Perform ephemeral in-memory local delta searches for newly edited notes without modifying vault index files;
  - Do not generate canonical embeddings or publish shared artifacts.
* **Runtime Safeguards:** Mobile Companion deactivates background vault file watchers, startup diff reconciliations, and local generation pipelines, conserving battery and preventing sync collisions.

---

## Module 2: The Search Engine & Ranking

## Module 2: The Search Engine & Ranking

Lina provides a clean, focused search experience in its persistent sidebar panel:

### 2.1 Search Interface & Modes

The Lina sidebar search panel includes:
- **Search Input:** Enter keywords or contextual slash commands (`/ask`, `/tags`, `/yaml`).
- **Search Mode Dropdown:** Switch seamlessly between search modes (`Text`, `Hybrid`, `Semantic`).
- **Actions Dropdown:** Access secondary operations without UI clutter (Index Status, Open Diagnostics, quick AI tools).
- **Search Button:** Execute the query or trigger AI commands.
- **AI Response Area:** Contextual answers and suggestion cards appear when slash commands are invoked.
- **Results List:** Ranked results with match source explanations and relevance/similarity scores.
- **Compact Operational Status ("Silent Success"):** Displays a discreet status when the index and embeddings are healthy. If search data is degraded or syncing, a single high-priority guidance alert is presented.
- **Diagnostics Entry Point:** One-click access to the comprehensive `DeviceDiagnosticsModal`.

#### Search Modes
1. **Hybrid Search (Recommended with AI):** Combines textual and semantic similarity into a single ranked list. It ensures exact keyword matches appear alongside conceptual matches. If embeddings are unconfigured or unavailable on a Companion device, hybrid search automatically and gracefully falls back to local text search.
2. **Text Search:** Performs fast local exact, prefix, and substring matching against note titles, paths, and content. Works immediately out of the box without AI or network connections.
3. **Semantic Search:** Uses vector embeddings to find notes related by meaning, even if they use completely different vocabulary (e.g., searching "organizing lessons" finds notes about "pedagogical planning"). Optional, requires generated embeddings governed by the canonical Vector Contract (`VectorContractV1`).

Short, non-empty notes remain text-searchable. When hybrid preprocessing removes all useful query terms, Lina retains a textual fallback rather than collapsing the request to an empty text search. Lina automatically manages all required internal artifacts to power these search modes.

### 2.2 Scoring & Indicators
Each result in the search view displays key indicators:
- **Relevance:** The overall combined ranking score.
- **Similarity:** The mathematical vector proximity (cosine distance) between your query and the match.
- **Result Source:** Explains why the note matched (`name`, `path`, `text`, `semantic`, or `hybrid`).

### 2.3 Adjusting Hybrid Weights
You can fine-tune the balance between text matching and semantic search in settings under **3. Semantic Search & Embeddings**:
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

### 4.1 Settings Organization (5 Operational Accordions)

Lina organizes its complete 50-setting catalog using progressive disclosure across **5 operational collapsible accordion groups**, framed by an uncollapsed header for interface language and a dedicated support footer:

#### General / Interface (Header, Non-Collapsible)
- **Plugin Identity:** Displays plugin version (`manifest.json`) and development build timestamp.
- **Interface Language:** Select the active language (`pt-PT` / `en`) with instant UI adaptation.
- **Multilingual Guidance:** Explanatory notice regarding language support.

#### 1. Device & Producer (Operational Accordion 1, Expanded by Default)
- **Current Device Role Badge:** Shows active role status (`🟢 Desktop Producer`, `🔵 Desktop Companion`, `🔵 Mobile Companion`, `⚪ Unconfigured Device`, or `🟡 Temporary role`).
- **Role Actions:** First-run role confirmation chooser, "Make this device the Active Producer" promotion, and "Change device role…" modal.
- **Device Name:** Friendly local device name used for disambiguation in multi-device vaults.

#### 2. AI Assistant & Analysis (Operational Accordion 2)
- **Complete Provider Setup:** Analysis provider (Ollama, Mistral, OpenRouter), chat model (catalog or custom), Base URL endpoint, and API key credential.
- **Connection Testing:** "Test Connection" button with real-time feedback.
- **Workspace & Analysis Tuning:** Request timeout, inbox folder path, batch analysis limits, YAML allowed properties, and tag suggestions count.

#### 3. Semantic Search & Embeddings (Operational Accordion 3)
- **Complete Semantic Setup:** Semantic search toggle, embedding provider, vector model, Base URL endpoint, and API key credential.
- **Embedding Policy & Connection Test:** Update policy (`manual` vs `automatic-local-only`) and embeddings connection test.
- **Semantic Tuning:** Batch processing size, timeout, default language hint, and hybrid search balance weights.

#### 4. Privacy & Exclusion Rules (Operational Accordion 4)
- **Folder Exclusions:** Multi-line list of folders ignored during text indexing and vector generation.
- **Sensitive Path Terms & Content Terms:** Strict keyword exclusions preventing sensitive notes from being indexed or transmitted to AI providers.
- **Producer Gating:** On Companion devices, exclusion rules are displayed in read-only mode, managed exclusively by the Active Producer.

#### 5. Diagnostics & Advanced Maintenance (Operational Accordion 5, Collapsed by Default)
- **Index Lifecycle Automation:** Automatic updates on file changes, startup re-indexing, startup synchronization check, and debug update logging.
- **Search Acceleration Cache:** Preference selection (`prefer-binary` vs `jsonl`), background maintenance toggle, live cache status inspector, and cache actions (Check, Create/Update, Remove with confirmation).

#### Support & Contact (Footer, Non-Collapsible)
- **Feedback Form:** Direct link to the external support & feedback form.
- **Email Support:** Support email contact with a convenient one-click copy button.

### 4.2 Role-Specific Behavior in Settings

Lina strictly adapts its settings presentation to the active device role:

- **Active Producer:** Full administrative authority over shared vault artifacts. Can configure embedding providers and models, update exclusion rules (`.lina/exclusions.json`), and run search acceleration cache maintenance.
- **Companion (Desktop / Mobile):** Lightweight consumer mode. Inherits embedding provider and model configuration directly from the published manifest (`VectorContractV1`). Can configure device-local endpoints (e.g. LAN Ollama Base URL) and local credentials. Exclusion rules and heavy background generation controls are safely read-only.
- **Standby Producer:** Configured desktop operating in safe standby mode without publication authority. Cannot publish index or embedding updates while another Active Producer is authorized. Promoted via the "Make this device the Active Producer" button.

### 4.3 Independent Per-Device Settings
Lina stores settings in `data.json` using a per-device key structure (derived from system characteristics). This enables flexible multi-device setups:
- **Desktop:** High-performance local Ollama for analysis and embeddings.
- **Laptop / Mobile:** Remote Mistral or OpenRouter API, or text-only search mode.

### 4.4 Analysis AI vs. Embeddings Configuration & Vector Contract Inheritance
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

#### Vector Contract Inheritance on Companion Devices
On **Companion** devices, embedding provider and model settings are **inherited directly from the Producer's published manifest** (`VectorContractV1`). This prevents incompatible vector spaces across devices:
- Companion devices cannot alter the inherited embedding provider or model.
- Companion devices configure their own local connection endpoint (e.g. LAN Ollama Base URL) and store credentials securely in `app.secretStorage`.
- If the inherited embedding model is unreachable on Companion, semantic search is safely suspended while local text search remains fully available.

#### Provider Capabilities

| Provider | Analysis / Chat | Embeddings | Automatic embedding maintenance | API Cost Profile |
| :--- | :---: | :---: | :--- | :--- |
| **Ollama** | Supported | Supported | Supported on Desktop Producer | Local compute (free) |
| **Mistral** | Supported | Supported | Manual only | Billed directly by provider |
| **OpenRouter** | Supported | Supported | Manual only | Billed directly by provider |

> [!WARNING]
> External API usage may involve costs charged directly by the respective providers. Lina does not manage or bill for API usage.

Changing an embedding provider on the Active Producer updates the vector contract coherently when Lina's known defaults are in use:

| Provider | Default embedding model | Default Base URL |
| :--- | :--- | :--- |
| Ollama | `nomic-embed-text-v2-moe` | `http://localhost:11434` |
| Mistral | `mistral-embed` | `https://api.mistral.ai/v1` |
| OpenRouter | `openai/text-embedding-3-small` | `https://openrouter.ai/api/v1` |

A genuine custom or proxy Base URL is preserved. Changing provider or model recalculates compatibility immediately without deleting canonical embeddings or checkpoints, contacting a provider, or starting unprompted generation.

### 4.5 Setting Up Ollama (Local AI)
1. Install and launch [Ollama](https://ollama.ai).
2. Pull your chosen models: `ollama pull nomic-embed-text-v2-moe` and `ollama pull gemma4:e2b`.
3. In Lina Settings, set Provider to `Ollama` and Base URL to `http://localhost:11434`.
4. Click **Test Connection** to verify API responsiveness.

### 4.6 Setting Up Mistral or OpenRouter (Remote AI)
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

### 4.7 Version & Build Information
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
| **`.lina/exclusions.json`** | ✅ Yes | Canonical Exclusion Policy managed by Active Producer; consumed read-only on Companion. |
| **`.lina/ownership.json`** | ✅ Yes | Coordinated Single-Active-Producer authority manifest with monotonic epoch fencing. |
| **`.lina/producer-state.json`** | ✅ Yes | Observational publication state and multi-dimensional freshness metadata. |
| **`.lina/index/`** | ✅ Yes | Synced so Companion reuses text index & embeddings built on Active Producer. |
| **`.lina/devices/<deviceId>.json`** | ✅ Yes (Safe) | Isolated single-writer device state files (Device X writes only to `dev-X.json`). |
| **`<configDir>/` (`data.json`)** | ❌ No | Excluded by `.stignore`. Non-sensitive global preferences. |
| **API Keys / Credentials** | ❌ NEVER | Stored strictly in local `app.secretStorage` (OS keychain), never written to files or synced. |
| **Plugin Folder** | ❌ No | Plugin must be installed on each device via Community Plugins. |

> [!TIP]
> Valid text indexes and vector files synchronized to `.lina/index/` are recognized immediately on startup or reload. Mobile Companion consumes the synchronized index for search without triggering local rebuilds or vault file watchers. Lina ignores external sync conflict files (`*.sync-conflict-*`) automatically.

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
