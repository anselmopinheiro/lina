# Lina — User Manual

Lina is a privacy-first note assistant and search engine for Obsidian, focused on local text search, semantic search, and optional AI-powered note analysis. Its core principle is simple: **help organize and connect notes without taking control away from the user.**

Local text search works immediately with no AI provider or API key. AI is optional. **Ollama**, **Mistral**, and **OpenRouter** support analysis and embeddings.

Current version: **0.3.0**.

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

Lina provides a clean, focused search experience in its persistent sidebar panel:

### 2.1 Search Interface & Modes

The Lina sidebar search panel includes:
- **Search Input:** Enter keywords or contextual slash commands (`/ask`, `/tags`, `/yaml`).
- **Search Mode Dropdown:** Switch seamlessly between search modes (`Text`, `Hybrid`, `Semantic`).
- **Actions Dropdown:** Access secondary AI note analysis actions without UI clutter (Analyse current note, Analyse with related notes, Analyse inbox, Analyse folder...).
- **Search Button:** Execute the query or trigger AI commands.
- **AI Response Area:** Contextual answers and suggestion cards appear when slash commands are invoked.
- **Results List:** Ranked results with match source explanations and relevance/similarity scores.
- **Compact Operational Status ("Silent Success"):** Displays a discreet status when the index and embeddings are healthy. If search data is degraded or syncing, a single high-priority guidance alert is presented.
- **Diagnostics Entry Point:** One-click status bar button to open `DeviceDiagnosticsModal` for technical telemetry, freshness details, and Producer-only maintenance.

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
You can fine-tune the balance between text matching and semantic search in **Pesquisa / Search** settings:
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

### 4.1 Settings Organization (Native Obsidian Pages Hub)

Lina organizes its complete 50-setting catalog using Obsidian's native pages architecture (`SettingDefinitionPage`), structured around a root navigation hub:

```text
› Geral / General (Native Page)
  ├── Plugin identity, build, interface language, and multilingual guidance
  └── Current device role and friendly local device name

› Pesquisa / Search (Native Page)
  ├── Semantic search availability, published/inherited vector identity, and language
  └── Hybrid result weighting

› 🤖 Assistente de IA e Análise / AI Assistant & Analysis (Native Page)
  ├── Provider, model, endpoint, secure API credentials, timeout, and connection test
  └── Inbox and its limit, plus YAML/tag behaviour

› Produtor / Producer (Native Page — conditional)
  ├── Embedding update policy, batch, exclusion rules, and index maintenance
  └── Binary maintenance/create/remove actions, subject to existing ownership guards

› Companion (Native Page — conditional)
  └── Companion-mode context and received exclusion-policy information; contract identity remains in Pesquisa / Search

› Sincronização / Synchronization (Native Page)
  └── Provider-neutral startup verification preference

› Diagnóstico / Diagnostics (Native Page)
  └── Current device identity, binary-index warning/status, verification, and binary-read preference

› Avançado / Advanced (Native Page)
  └── Debug and other future rare technical parameters without a functional home

Support & Contact (Root Hub Footer)
├── Feedback Form Link
└── Email Support Contact with One-Click Copy Button
```

#### Rationale & Mobile Usability
- **Subpage Navigation:** Replaced vertical pseudo-accordions with native Obsidian settings pages (`SettingDefinitionPage`), eliminating excessive vertical scrolling.
- **Mobile-First Experience:** On mobile, each domain opens in a dedicated full-screen page with Obsidian's standard back button for seamless navigation.
- **Settings Search Preservation:** Maintains 100% compatibility with Obsidian's native Settings Search (`searchQuery`), indexing all settings across all subpages.
- **Domain Cohesion:** Clearly isolates everyday general preferences, AI analysis, semantic search, privacy boundaries, and advanced diagnostic maintenance.

### 4.2 Role-Specific Behavior in Settings

Lina strictly adapts its settings presentation to the active device role:

- **Active Producer:**
  - Full administrative authority over shared vault artifacts.
  - Defines the embedding provider and model, publishing the canonical `VectorContractV1` in `.lina/index/manifest.json`.
  - Rebuilds and updates text indices, vector embeddings, and search acceleration caches (`.lina/index/`).
  - Manages vault-wide exclusion rules in `.lina/exclusions.json`.
- **Companion (Desktop / Mobile):**
  - Lightweight consumer mode designed for zero background battery or CPU drain.
  - **Inherits Embedding Provider & Model:** Companion devices do **not** select or alter the embedding provider or model. Values are inherited directly from the published `VectorContractV1` and displayed as read-only/disabled.
  - **Local Connectivity:** Companion devices maintain independent configuration for local endpoints (e.g. LAN Ollama Base URL) and local credentials stored securely in `app.secretStorage`.
  - **Graceful Search Degradation:** Without a valid published contract or when the inherited provider is unreachable, semantic search is safely unavailable, and hybrid search automatically degrades to fast local text search.
  - **Zero Silent Fallback:** Lina strictly prohibits silent fallback to legacy or conflicting provider/model settings in `data.json`.
  - **Exclusion Gating:** Exclusion rules (`.lina/exclusions.json`) are displayed in read-only mode with clear governance notices.
- **Standby Producer:**
  - Configured desktop operating in safe standby mode without publication authority.
  - Maintains its own local configuration and credentials.
  - Strictly prohibited from publishing or overwriting canonical vault artifacts without an active lease in `.lina/ownership.json`.
  - Can request and confirm promotion to Active Producer via **Settings > Geral / General** ("Make this device the Active Producer").

### 4.3 `data.json` Role, Schema Versioning & Upgrade Hardening

Lina persists legitimate user preferences in `.obsidian/plugins/lina/data.json` with rigorous upgrade hardening and explicit schema versioning:

```text
settingsSchemaVersion: 1
```

#### Lifecycle & Startup Migrations
Migrations execute sequentially and idempotently during startup (`loadDataFromDisk()`):

```text
load
→ migrate
→ validate
→ persist-if-changed
→ runtime
```

- **Startup Execution:** Migrations run automatically when the plugin loads on startup, completely eliminating any dependency on manually opening the Settings tab.
- **Strict Idempotency:** Running migrations multiple times on the same data produces `changed: false` with zero state drift.
- **Future Schema Protection:** If a newer schema version is detected (`settingsSchemaVersion > 1`), Lina preserves data in memory without destructive downgrade or overwrite, aborting startup writes.
- **Zero-Write Startup Discipline:** Fresh installations and clean restarts without migration changes perform zero disk writes to `data.json`.

#### Data Scope & Canonical Precedence
`data.json` stores local UI preferences (language, hybrid search weights, startup toggles) and device-local overrides (`deviceSettingsById[deviceId]`). However, **`data.json` has been formally demoted and holds zero operational authority** for multi-device coordination, device roles, exclusion policies, embedding contracts on Companion devices, or credentials.

##### Canonical Authorities vs `data.json`
- **Exclusion Policy (`.lina/exclusions.json`):** The sole authority for folder, path, and content exclusion rules. Mutations in Settings save directly to `.lina/exclusions.json` and bypass `data.json`.
- **Device Identity & Role (`.lina/devices/<deviceId>.json`):** The sole authority for device role (`producer`/`companion`) and human-readable device name.
- **Vector Embeddings Contract (`.lina/index/manifest.json`):** Canonical `VectorContractV1` published by the Active Producer defines coordinate dimensions, provider, model, and metric for semantic search across all devices.
- **Secrets & API Keys (`app.secretStorage`):** Obsidian's native OS-backed secret store is the sole authority for API keys. Credentials are never written to `data.json` in plaintext.

##### Canonical Precedence Matrix
Lina enforces the following canonical precedence matrix across all runtimes:

```text
Device role & identity:
.lina/devices/<deviceId>.json > platform fallback > legacy data.json

Active Producer lease:
.lina/ownership.json > sem fallback local autoritativo

Embedding identity no Companion:
VectorContract canónico > sem fallback local (zero silent fallback)

Exclusions:
.lina/exclusions.json > legacy data.json (apenas como fallback/migration source)

Credentials:
SecretStorage > plaintext legacy (migrado e removido de data.json)

Freshness:
.lina/producer-state.json / manifests > local stale metadata
```

##### Producer vs. Companion Boundaries
- **Active Producer:** The Active Producer defines canonical shared state (publishes `VectorContractV1` and updates `.lina/exclusions.json`). Local settings in `deviceSettingsById[deviceId]` represent the Producer's local configuration, which becomes vault-authoritative only upon publication to `.lina/index/manifest.json`.
- **Companion / Standby:** Companion devices consume published artifacts (`exclusions.json`, `VectorContractV1`). In Settings, Companion devices have embedding provider, model, and exclusion rules locked in read-only mode. If a published contract is missing, semantic search is safely suspended with zero silent fallback to legacy fields in `data.json`.

##### Backward Compatibility & Non-Breaking Fallback
- **Exclusion Fallback:** If `.lina/exclusions.json` is missing (e.g. pre-0.3.0 vault), Lina safely falls back to reading legacy `indexExcluded*` from `data.json` and uses them to seed the canonical policy upon first Producer run. If the canonical file exists, `data.json` exclusions are completely ignored.
- **Credential Migration:** Legacy plaintext keys (`aiApiKey`, `embeddingApiKey`, or in `deviceSettingsById`) are migrated to `SecretStorage` at startup and scrubbed from memory and disk so they are never written back.
- **Stopped Writes:** Deprecated root fields (`indexExcluded*`, `embeddingProvider`, `embeddingModel`, `aiApiKey`, `embeddingApiKey`) are never written with new operational values.

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
- Companion devices cannot alter the inherited embedding provider or model (dropdowns appear read-only and disabled).
- Companion devices configure their own local connection endpoint (e.g. LAN Ollama Base URL) and store credentials securely in `app.secretStorage`.
- If the published `VectorContract` is missing or the inherited embedding provider is unreachable on Companion:
  - Semantic search is gracefully suspended with an informative status message.
  - Hybrid search automatically degrades to fast local text search.
  - Zero silent fallback to legacy or conflicting embedding models in `data.json`.

#### Producer Configuration vs. Vector Contract vs. Producer State
Lina strictly separates three distinct operational concepts:

```text
1. Producer Configuration (Device-Local in data.json):
   - Scope: Defines how THIS device generates embeddings (target provider/model, baseUrl, batchSize, timeout).
   - Authority: Local device generation intent. Never directly dictates search coordinate space on other devices.

2. Published Vector Contract (Vault-Wide in .lina/index/manifest.json):
   - Scope: Canonical VectorContractV1 describing the exact coordinate space of published embeddings.
   - Authority: Sole authority for semantic search queries across all devices (Producer and Companion).

3. Producer State (Observational Telemetry in .lina/producer-state.json):
   - Scope: Records what happened (publication timestamps, activeProducerId, epoch, policy digests).
   - Authority: Health and freshness monitoring. Stores ZERO configuration fields.
```

##### Divergence & Incompatibility Protection
- **No Silent Contract Mutation:** Changing `embeddingsModel` or `embeddingsProvider` in Producer settings only modifies the Producer's local generation preference in `data.json`. It does **not** alter the published `VectorContractV1`.
- **Search Incompatibility Detection:** If the Producer's configured model diverges from the published Vector Contract, semantic search flags the incompatibility (`reasonCode: "incompatible"`) and halts queries to prevent corrupted similarity rankings.
- **Enforced Full Rebuild:** The embedding update planner detects the divergence (`model-changed`), marks existing vectors as obsolete, and forces `mode: "full-rebuild"`. Incremental generation with mixed models is strictly blocked. Only upon completing a full rebuild is a new `VectorContractV1` atomically published.

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

### 6.1 Multi-Device Sync Guidance ("Desktop Producer / Mobile Companion")
Lina's multi-device architecture is designed around the **Desktop Producer / Mobile Companion** model. Desktop builds and maintains the search assets in `.lina/index/`, while Mobile seamlessly consumes the synchronized artifacts for search without running local compilation loops.

#### Canonical Vault Data vs. Local Plugin Installation
Lina strictly distinguishes between shared vault data and device-local plugin files:
- **`.lina/` (Shared Canonical Vault Data):** Contains canonical search indices, vector embeddings, exclusion policies (`.lina/exclusions.json`), and ownership manifests (`.lina/ownership.json`). These files are designed to be synchronized across participating devices.
- **`.lina/producer/` (Producer Operational Area):** Contains checkpoints, staging candidates, rollback backups, and other operational data. It is never consumed by Companion and is not intended for synchronization; only validated artifacts in `.lina/index/` are published. It remains inside the vault today, so its exclusion currently depends on correct external synchronization policies rather than a guaranteed private-storage boundary.
- **Binary publication:** The binary manifest, metadata, and vector buffer are published only after validation. Their staging candidates and rollback backups remain under `.lina/producer/`, never in the Companion-facing index directory, and require the same external synchronization exclusion.
- **`.obsidian/plugins/lina/` (Local Device Configuration):** Contains the plugin code and `data.json`, which holds local device configuration and preferences. It is not shared configuration or a multi-device authority. **Syncing `.obsidian/plugins/lina/data.json` across devices is not recommended** to avoid whole-file write collisions.
- **Credentials:** API keys are never written to any file; they reside exclusively in the local host's `app.secretStorage` (OS keychain).

Lina is **synchronization-provider agnostic**, operating reliably across Obsidian Sync, Syncthing, iCloud, Git, or manual file sync without relying on proprietary transport mechanisms.

When syncing vaults across devices via file-synchronization tools such as Syncthing, use the following recommended `.stignore` configuration:

```text
/<configDir>*
/.trash/
/.lina/producer/
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
| **`<configDir>/` (`data.json`)** | Local only by Lina semantics | Local device configuration and preferences; it is not shared configuration. Physical non-synchronization depends on the user's sync policy when the config directory is included in the vault. |
| **API Keys / Credentials** | ❌ NEVER | Stored strictly in local `app.secretStorage` (OS keychain), never written to files or synced. |
| **Plugin Folder** | ❌ No | Plugin should be installed on each device independently via Community Plugins. |

> [!NOTE]
> `.stignore` is optional guidance for Syncthing users, not a Lina requirement or a portable privacy guarantee. Until a future device-local storage layer is validated, `.lina/producer/` remains an operational vault area that requires correct external exclusions.

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
