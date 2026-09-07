# Lina

[![Version](https://img.shields.io/badge/version-0.3.0-orange.svg)](manifest.json)
[![Obsidian](https://img.shields.io/badge/Obsidian-v1.13.0%2B-purple.svg)](https://obsidian.md)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Desktop%20%7C%20Android-green.svg)](#mobile--multi-device-support)

> Privacy-first note assistant and search engine for Obsidian. Fast local text search out of the box, with optional semantic search and AI-powered note enrichment.

Current version: **0.3.0**.

[User Manual](docs/manual.md) | [Commands Guide](docs/commands.md) | [Changelog](CHANGELOG.md) | [Roadmap](docs/roadmap.md)

---

## What is Lina?

Lina helps you find, connect, and enrich your Markdown notes in Obsidian without taking control away from you. It operates across three distinct layers:

1. **Local Search (Works Immediately):**
   Lina reads your Markdown notes locally to build and maintain a fast search index. Text indexing and keyword search happen entirely on your device. No AI provider, API key or network connection is required for local search.
2. **Semantic Search (Optional):**
   Find notes by meaning and conceptual relationships even when using different phrasing. Semantic search is powered by vector embeddings and works alongside local text search in a single hybrid-ranked list.
3. **AI Note Assistance (Optional):**
   Analyze active notes and execute contextual slash commands (`/ask`, `/tags`, `/yaml`) directly from the sidebar. AI suggestions are only applied to your notes after your explicit review and confirmation.

---

## Quick Start

Get up and running in a few simple steps:

1. **Install:** Download `manifest.json`, `main.js`, and `styles.css` from the latest release and place them into `<Vault>/.obsidian/plugins/lina/` (or install via Obsidian Community Plugins once listed).
2. **Enable:** Turn on **Lina** under **Obsidian Settings > Community Plugins**.
3. **Create the Initial Index:** Open the Lina side panel in Obsidian's right sidebar and create the initial index when required. Once created, Lina maintains the text index automatically.
4. **Search Notes:** Type directly in the Lina sidebar to search your vault immediately with fast local text search.
5. **Enable Optional AI Features (Optional):** Open **Settings > Lina** to configure a supported AI provider for semantic search, note analysis, and slash commands.

---

## Features & Capabilities

### Search Modes & Resilience
- **Search Interface:** Features a clean search bar with a compact mode selector dropdown (`Text`, `Hybrid`, `Semantic`), an actions dropdown menu for secondary note analysis tools, a discrete "silent-success" operational status indicator, and direct access to device diagnostics.
- **Text Search:** Fast, local keyword search matching note titles, paths, and content. Works out of the box with zero external configuration.
- **Hybrid Search (Recommended with AI):** Blends local text matching with semantic similarity into a unified, ranked list when embeddings are available. If vector embeddings are unavailable or unconfigured on a Companion device, hybrid search automatically and gracefully degrades to local text search.
- **Semantic Search:** Meaning-based vector search that discovers conceptually related notes across your vault, governed by a canonical Vector Contract (`VectorContractV1`).
- **Defensive Content Boundaries:** Folder, path, and content exclusions are governed by a canonical policy (`.lina/exclusions.json`) and defensively evaluated at query time across all search modes.

### Contextual Slash Commands (`/ask`, `/tags`, `/yaml`)
Type a slash command into the sidebar search bar to interact with your active note context:
- `/ask <prompt>`: Ask questions about the current note or selected excerpt.
- `/tags`: Get smart tag suggestions with checkboxes to apply non-duplicate tags.
- `/yaml`: Suggest frontmatter properties safely without overwriting existing data.

> **Explicit Confirmation:** Lina never modifies your notes silently. Every AI suggestion requires explicit confirmation before changes are saved to disk.

---

## Supported AI Providers

Lina supports independent configuration for **AI Analysis** (chat and commands) and **Vector Embeddings** (semantic search). You can mix and match providers according to your workflow:

| Provider | Type | Analysis / Chat | Embeddings | Embedding Maintenance | API Costs |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Ollama** | Local | Supported | Supported | Automatic background maintenance (Desktop) | Local compute (free) |
| **Mistral** | Remote | Supported | Supported | Manual update only | Billed directly by provider |
| **OpenRouter** | Remote | Supported | Supported | Manual update only | Billed directly by provider |

- **Local AI (Ollama):** Operates entirely on your local machine with complete privacy and zero API billing.
- **Remote AI (Mistral, OpenRouter):** Requires an API key and internet connectivity. API keys are stored securely per device in `app.secretStorage` and never exposed in logs, manifests, or sync channels. Embedding updates on external providers always require explicit confirmation to prevent unintended API credit consumption.
- **API Cost Disclaimer:** Lina does not manage, bill, or resell API credits. External API usage is billed directly to your account by the respective provider according to their pricing.

---

## Embedding Lifecycle, Vector Contracts & Safeguards

Lina manages vector embeddings through a safe, transparent, and multi-layered lifecycle designed to protect user control, device resources, and external API budgets:

```
Embedding State Detection (Pure Observation)
          │
          ▼
Provider Capability & Policy Check (Local vs External Cost)
          │
          ▼
Status Transparency & Explanation (Human-readable impact & credit notices)
          │
          ▼
User Confirmation Flow (Explicit authorization dialog)
          │
          ▼
Embedding Update Settings (manual vs automatic-local-only)
          │
          ▼
Background Scheduler (30s quiet debounce / 300s max delay on Producer)
          │
          ▼
Backoff Protection (1m – 15m exponential cooldown on provider failures)
          │
          ▼
Single-Flight Execution Pipeline (MaintenanceEngine & EmbeddingWorker)
```

### Safety Principles & Invariants

- **Manual Confirmation for External Providers:** External cloud providers (Mistral, OpenRouter) incur per-token financial costs and are **never** updated automatically in the background. Every update for an external provider requires explicit user authorization via a confirmation modal displaying the exact number of chunks to process and a clear API credit notice.
- **Canonical Vector Contract & Inheritance:** The Active Producer defines the embedding provider and model, publishing the canonical `VectorContractV1` in `.lina/index/manifest.json`. Companion devices inherit provider and model directly from this contract; these fields are displayed as read-only/disabled. Companion devices retain independent configuration for local endpoints (e.g. LAN Ollama URL) and credentials (`SecretStorage`).
- **No Silent Fallback & Graceful Degradation:** If a published `VectorContract` is missing or unreachable on Companion, semantic search is safely suspended with an informative message, and hybrid search automatically degrades to fast local text search. Lina never performs silent fallbacks to legacy or incompatible embedding models in `data.json`.
- **Active Producer Responsibility:** Vector embeddings and search acceleration caches are generated and published exclusively on your designated Active Producer device.
- **Standby Producer Guard:** Standby Producers maintain their local configuration but cannot publish or overwrite canonical vault artifacts without holding active ownership.
- **Companion Consumption Model:** Companion devices (mobile or desktop) operate as lightweight, read-only consumers. They consume synchronized vector embeddings directly from `.lina/index/` and perform ephemeral local delta searches without generating canonical embeddings or consuming battery with heavy background tasks.
- **Exponential Backoff Resilience:** If local provider maintenance fails (e.g. Ollama service offline), Lina's scheduler applies exponential backoff (1m, 2m, 4m, 8m, up to 15m) to prevent tight retry loops or resource waste, while preserving pending work until service is restored or manually requested.

---

## Privacy & Data Boundaries

Lina is built around data ownership and transparent operation:

- **Local Vault Access:** Lina reads vault notes locally because building and updating a search index requires reading note content.
- **Zero Uploads for Indexing & Local Search:** Notes are **never** uploaded during indexing or normal local text search. All index operational data is stored locally within `.lina/index/`.
- **Canonical Exclusion Policy:** Exclusions are managed in a dedicated, versioned `.lina/exclusions.json` file on the Active Producer. Companion devices apply defensive filtering at query time across all search modes.
- **Zero-Sync Secret Storage:** API keys for external AI providers are stored strictly in Obsidian's local `app.secretStorage` (OS keychain/secure storage) outside the vault filesystem. Credentials are **never** written to `data.json`, `.lina/`, or sync channels, guaranteeing zero credential leakage across devices or remote git repositories.
- **On-Demand AI Communication:** External AI providers are contacted **only** when you explicitly enable, configure, and invoke an AI feature.
- **Minimal Context Transmission:** When using an external AI API, Lina sends only the specific text context required for that request (subject to your configured path and content exclusion filters).
- **External API Costs:** Costs are charged directly by the selected AI provider. These costs are not controlled, managed or paid by Lina.

---

## Settings Information Architecture

Lina structures its settings using Obsidian's native subpage navigation (`SettingDefinitionPage`), organized around a central settings hub:

```text
General / Interface (Root Hub Header)
├── Plugin identity & build version
└── Interface language selector & multilingual guidance

› 📱/🟢 Dispositivo e Produtor / Device & Producer (Native Page)
  ├── Device role badge, first-run chooser, active producer transfer, and role switching
  └── Friendly local device name

› 🤖 Assistente de IA e Análise / AI Assistant & Analysis (Native Page)
  ├── Complete provider setup: provider, model, base URL endpoint, API credentials
  ├── Connection test action & instant diagnostic feedback
  └── Analysis tuning: timeout, inbox folder, YAML allowed properties, and tag suggestions count

› 🔍 Pesquisa Semântica e Embeddings / Semantic Search & Embeddings (Native Page)
  ├── Complete semantic setup: enable toggle, provider, model, base URL, API credentials
  ├── Embedding update policy (manual vs automatic-local-only) & connection test
  └── Semantic tuning: batch size, timeout, language hint, and hybrid search balance weights

› 🛡️ Privacidade e Regras de Exclusão / Privacy & Exclusion Rules (Native Page)
  ├── Excluded folders & configuration notice
  └── Sensitive path pattern exclusions & content exclusion keyword terms

› ⚙️ Diagnóstico e Manutenção / Diagnostics & Advanced Maintenance (Native Page)
  ├── Automatic index maintenance on file changes & startup re-indexing
  ├── Startup sync verification check & debug update logging
  └── Search acceleration storage preference (prefer-binary vs jsonl), maintenance toggle,
      status inspector, and cache actions (check, create/update, remove)

Support & Contact (Root Hub Footer)
├── Support & feedback form link
└── Email support contact with one-click copy button
```

### Architectural & UX Rationale
- **Native Obsidian Pages:** Replaces vertical pseudo-accordions with native Obsidian subpages (`SettingDefinitionPage`), dramatically reducing scrolling on desktop and mobile.
- **Mobile-Optimized Navigation:** Each functional domain opens in a focused, full-width native view with a standard Obsidian back button.
- **Settings Search Preservation:** Full compatibility with Obsidian's native Settings Search (`searchQuery`), preserving instant discovery of all 50 settings across all subpages.
- **Domain Separation:** Clean, logical separation between general UI preferences, AI analysis, semantic search, privacy boundaries, and advanced maintenance.
- **Role-Based Adaptation & Embedding Inheritance:**
  - On **Companion** devices, embedding provider and model are strictly inherited from the Producer's canonical `VectorContract` and displayed as read-only/disabled. Endpoint and API credentials remain independently configurable for local network access. Without a valid contract, semantic search is unavailable and hybrid search degrades to text search (with zero silent fallback to legacy `data.json`).
  - Exclusion rules are locked to the Active Producer (`.lina/exclusions.json`) and displayed as read-only on Companion.
  - Heavy background index maintenance and embedding generation controls are gated to Active Producer devices.
  - **Standby Producers** maintain local settings but are prevented from publishing or overwriting canonical artifacts without an active lease.

### Settings Schema & Upgrade Hardening
- **Explicit Schema Versioning:** Settings stored in `.obsidian/plugins/lina/data.json` are versioned with `settingsSchemaVersion: 1`.
- **Startup Migrations:** Migrations execute automatically, sequentially, and idempotently during startup (`load → migrate → validate → persist-if-changed → runtime`), without requiring the user to open settings.
- **Future Schema Protection:** If a newer schema version is detected (`settingsSchemaVersion > 1`), Lina preserves data in memory without destructive downgrade or overwrite, aborting startup writes.
- **Strict Precedence Matrix:**
  - **Device role:** `.lina/devices/<deviceId>.json` > platform fallback > legacy `data.json`
  - **Active Producer:** `.lina/ownership.json` > no local authoritative fallback
  - **Embedding identity (Companion):** canonical `VectorContract` > no local fallback
  - **Exclusions:** `.lina/exclusions.json` > legacy `data.json` (only migration source if canonical file missing)
  - **Credentials:** `SecretStorage` > plaintext in `data.json` (migrated and purged)
  - **Freshness:** `.lina/producer-state.json` / manifests > local stale metadata

---

## Multi-Device Architecture: Producer & Companion Roles

Lina coordinates multi-device vaults seamlessly across Desktop and Mobile:

- **What is a Producer?** A device designated to build and maintain the shared text index, vector embeddings, and search acceleration caches.
- **What is a Companion?** A lightweight consumer (desktop or mobile) that uses synchronized search data for instant hybrid search and AI note assistance without background maintenance or battery drain.
- **How is the role chosen?** On first run, Lina recommends a role based on your device (Producer on desktop, Companion on mobile). The role is only persisted after your explicit confirmation in **Settings > Current Device**.
- **Can two desktops both be Producers?** Yes. You can configure multiple desktops as Producers. To prevent sync collisions, Lina uses single-active ownership: one machine is the **Active Producer** (authorized to publish), while other configured desktops operate safely as **Standby Producers**.
- **How do I change the Active Producer?** On your Standby Producer, open **Settings > Current Device** and click **Make this device the Active Producer** (or run `Lina: Transfer active producer ownership to this device` from the Command Palette). Once confirmed, publication authority safely transfers to that device via monotonic epoch fencing ($E \to E + 1$).
- **Producer State & Freshness:** The Active Producer publishes status in `.lina/producer-state.json`, enabling Companion devices to evaluate independent freshness dimensions for text indexing, embeddings, and producer activity (`fresh` < 24h, `aging` 24–48h, `stale` > 48h).
- **Generation Integrity:** Published artifacts feature cryptographic SHA-256 digests (`notesDigest`, `chunksDigest`) and transactional `manifest-last` writing. External sync conflict files (`*.sync-conflict-*`) are ignored.
- **Synchronization Boundaries & Guidance:**
  - `.lina/` contains vault-wide canonical artifacts, exclusion policies, and ownership manifests that should be synchronized across participating devices.
  - `.obsidian/plugins/lina/data.json` contains device-local installation configuration and preferences; syncing `data.json` across devices is **not recommended** in order to avoid multi-device write collisions.
  - Lina is provider-agnostic and functions correctly with Obsidian Sync, Syncthing, iCloud, Git, or manual transfers without relying on proprietary sync protocols. Lina does not resolve external sync engine file conflicts.


---

## Support & Feedback

If you experience issues, have questions, or wish to suggest improvements:

- [Support and feedback form](https://forms.gle/9TeD7hdb9AbjhNFt9)
- Email: [apinheiro@duck.com](mailto:apinheiro@duck.com?subject=Lina%20support%20request)

Contact details are used solely to respond to inquiries and are never shared with third parties.

---

## Development

Contributions and feedback are welcome:

```bash
# Install dependencies
npm ci

# Run development build
npm run dev

# Validate changes
npm run lint
npm test
npm run build
```

---

## License

[MIT License](LICENSE.md)
