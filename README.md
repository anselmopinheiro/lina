# Lina

[![Version](https://img.shields.io/badge/version-0.2.1-orange.svg)](manifest.json)
[![Obsidian](https://img.shields.io/badge/Obsidian-v1.13.0%2B-purple.svg)](https://obsidian.md)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Desktop%20%7C%20Android-green.svg)](#mobile--multi-device-support)

> Privacy-first note assistant and search engine for Obsidian. Fast local text search out of the box, with optional semantic search and AI-powered note enrichment.

Current version: **0.2.1**.

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

### Search Modes
- **Text Search:** Fast, local keyword search matching note titles, paths, and content. Works out of the box with zero external configuration.
- **Hybrid Search (Recommended with AI):** Blends local text matching with semantic similarity into a unified, ranked list when embeddings are available.
- **Semantic Search:** Meaning-based vector search that discovers conceptually related notes across your vault.

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
| **Ollama** | Local | Supported | Supported | Automatic background maintenance (Desktop) | Local compute |
| **Mistral** | Remote | Supported | Supported | Manual update only | Billed directly by provider |
| **OpenRouter** | Remote | Supported | Supported | Manual update only | Billed directly by provider |

- **Local AI (Ollama):** Operates entirely on your local machine with complete privacy and zero API billing.
- **Remote AI (Mistral, OpenRouter):** Requires an API key and internet connectivity. API keys are stored securely per device and never exposed in logs or diagnostics. Embedding updates on external providers always require explicit confirmation to prevent unintended API credit consumption.

---

## Embedding Lifecycle & Safeguards

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
- **API Cost Awareness:** Lina calculates and explains the real-world impact of missing or outdated embeddings before asking for confirmation, ensuring complete visibility over potential third-party charges.
- **Active Producer Responsibility:** Vector embeddings are generated and maintained exclusively on your designated Active Producer device.
- **Companion Consumption Model:** Companion devices (mobile or desktop) operate as lightweight, read-only consumers. They consume synchronized vector embeddings directly from `.lina/index/` and perform ephemeral local delta searches without generating embeddings or consuming battery with heavy background tasks.
- **Exponential Backoff Resilience:** If local provider maintenance fails (e.g. Ollama service offline), Lina's scheduler applies exponential backoff (1m, 2m, 4m, 8m, up to 15m) to prevent tight retry loops or resource waste, while preserving pending work until service is restored or manually requested.

---

## Privacy & Data Transparency

Lina is built around data ownership and transparent operation:

- **Local Vault Access:** Lina reads vault notes locally because building and updating a search index requires reading note content.
- **Zero Uploads for Indexing & Local Search:** Notes are **never** uploaded during indexing or normal local text search. All index operational data is stored locally within `.lina/index/`.
- **Zero-Sync Secret Storage:** API keys for external AI providers are stored strictly in Obsidian's local `app.secretStorage` (OS keychain/secure storage) outside the vault filesystem. Credentials are **never** written to `data.json`, `.lina/`, or sync channels, guaranteeing zero credential leakage across devices or remote git repositories.
- **On-Demand AI Communication:** External AI providers are contacted **only** when you explicitly enable, configure, and invoke an AI feature.
- **Minimal Context Transmission:** When using an external AI API, Lina sends only the specific text context required for that request (subject to your configured path and content exclusion filters).
- **External API Costs:** Costs are charged directly by the selected AI provider. These costs are not controlled, managed or paid by Lina.

---

## Settings Information Architecture

Lina organizes configuration by **user intent and functionality** across three progressive levels:

- **Basic settings:** Everyday essentials and complete provider setup. Users can select and fully configure an AI Analysis provider (provider, model, base URL, credentials, connection test) and Semantic Search (enable toggle, provider, model, base URL, credentials, update policy, connection test) entirely within Basic settings without opening Advanced. Also includes prominent device role status (`⚪ Unconfigured`, `🟡 Temporary`, `🟢 Desktop Producer`, `🔵 Desktop Companion`, or `🔵 Mobile Companion`), device name, inbox folder, index auto-updates, excluded folders, YAML frontmatter toggles, and interface language.
- **Advanced settings:** Specialized technical fine-tuning rather than basic setup. Groups connection timeouts, batch processing sizes (note passages per batch), startup reindexing, hybrid search scoring weights, advanced YAML properties, and path/content exclusion filters.
- **Diagnostics & maintenance:** Health and performance inspection tools, including startup synchronization checks, debug logging, and fast search cache management (status check, creation, and removal).

On **Companion** devices, settings automatically adapt: misleading background generation controls are safely gated and accompanied by clear Companion mode notices.

---

---

## Multi-Device Architecture: Producer & Companion Roles

Lina coordinates multi-device vaults seamlessly across Desktop and Mobile:

- **What is a Producer?** A device designated to build and maintain the shared text index, vector embeddings, and search acceleration caches.
- **What is a Companion?** A lightweight consumer (desktop or mobile) that uses synchronized search data for instant hybrid search and AI note assistance without background maintenance or battery drain.
- **How is the role chosen?** On first run, Lina recommends a role based on your device (Producer on desktop, Companion on mobile). The role is only persisted after your explicit confirmation in **Settings > Current Device**.
- **Can two desktops both be Producers?** Yes. You can configure multiple desktops as Producers. To prevent sync collisions, Lina uses single-active ownership: one machine is the **Active Producer** (authorized to publish), while other configured desktops operate safely as **Standby Producers**.
- **How do I change the Active Producer?** On your Standby Producer, open **Settings > Current Device** and click **Make this device the Active Producer** (or run `Lina: Transfer active producer ownership to this device` from the Command Palette). Once confirmed, publication authority safely transfers to that device.
- **Can a desktop become a Companion?** Yes. On any assigned desktop, click **Change device role…** in Settings to switch between Producer and Companion.
- **Multi-Device Sync (Syncthing / Obsidian Sync):** Sync your vault and the `.lina/index/` directory across devices for a seamless workflow. See the [User Manual](docs/manual.md#module-6-multi-device-sync-best-practices--troubleshooting) for setup tips.


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
