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
- **Semantic Search:** Meaning-based vector search that discovers conceptually related notes across your vault.
- **Content Boundaries:** Folder, path, and content exclusions are respected across all search modes.

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

## Semantic Search Across Devices

Lina keeps semantic search practical and predictable across desktop and Android:

- **Producer prepares search data:** The active Producer handles the heavier work of generating embeddings and publishing search artefacts for the vault.
- **Companion consumes published data:** Companion devices use the synchronised search data without performing heavy background generation or taking ownership of the Producer configuration.
- **Safe fallback:** If semantic search is not available on a Companion, hybrid search continues with local text search instead of producing misleading results.
- **Clear cost control:** Cloud embedding updates always require confirmation, so external provider costs remain under your control.

---

## Privacy & Data Boundaries

Lina is built around data ownership and transparent operation:

- **Local Vault Access:** Lina reads vault notes locally because building and updating a search index requires reading note content.
- **Producer Operational Area:** `.lina/producer/` is operational data for the Producer and is not intended for synchronisation. Because it remains inside the vault, exclude it through your sync provider when appropriate; Lina does not promise absolute private isolation for this area.
- **Local Device Configuration:** `data.json` contains local configuration and preferences for this installation. It is not shared configuration or a multi-device authority; avoid synchronising it between devices.
- **Local Secret Storage:** API keys for external AI providers are stored securely on the current device and are not written to `data.json` or sync channels.
- **On-Demand AI Communication:** External AI providers are contacted **only** when you explicitly enable, configure, and invoke an AI feature.
- **Minimal Context Transmission:** When using an external AI API, Lina sends only the specific text context required for that request (subject to your configured path and content exclusion filters).
- **External API Costs:** Costs are charged directly by the selected AI provider. These costs are not controlled, managed or paid by Lina.

---

## Settings Information Architecture

Lina organizes settings by what you want to do, using Obsidian's native page navigation:

```text
› Geral / General (Native Page)
  ├── Plugin information, language, and multilingual guidance
  └── Device role, role actions, and friendly local device name

› Pesquisa / Search (Native Page)
  ├── Semantic search enablement and inherited/published vector identity
  └── Search language and hybrid ranking weights

› 🤖 Assistente de IA e Análise / AI Assistant & Analysis (Native Page)
  ├── Provider, model, endpoint, credentials, timeout, and connection test
  └── Inbox and its limit, plus YAML/tag behaviour

› Produtor / Producer (Native Page — conditional)
  ├── Embedding update, exclusions, index maintenance, and publication-related actions
  └── Visible only when this device has the Producer role

› Companion (Native Page — conditional)
  └── Received-policy context; contract and connectivity remain visible in their relevant pages

› Sincronização / Synchronization (Native Page)
  └── Provider-neutral local verification preference

› Diagnóstico / Diagnostics (Native Page)
  └── Current device identity, binary-index warning/status, verification, and binary-read preference

› Avançado / Advanced (Native Page)
  └── Debug and other future rare technical parameters without a functional home

Support & Contact (Root Hub Footer)
├── Support & feedback form link
└── Email support contact with one-click copy button
```

### Settings Experience

- **Focused pages:** Each area opens in a focused view, reducing scrolling on desktop and mobile.
- **Mobile-Optimized Navigation:** Each functional domain opens in a focused, full-width native view with a standard Obsidian back button.
- **Searchable settings:** Obsidian Settings Search can still find controls across all pages.
- **Role-aware controls:** Producer-only maintenance stays with Producer devices, while Companion shows the information it needs without taking over Producer configuration.

---

## Multi-Device Architecture: Producer & Companion Roles

Lina coordinates multi-device vaults seamlessly across Desktop and Mobile:

- **Producer:** A desktop device responsible for the heavier work: building search data, generating embeddings, and publishing the artefacts used by the vault.
- **Companion:** A desktop or mobile device that consumes published search data and uses the existing embedding setup without becoming its source of configuration.
- **Choosing a role:** On first run, Lina suggests a role for the device. The choice is only saved after your confirmation in **Settings > Geral / General**.
- **Multiple desktops:** You can configure more than one Producer. Lina keeps publication controlled so that only the active Producer publishes shared search data at a time.
- **Changing the active Producer:** In **Settings > Geral / General**, use the existing role action or the Command Palette to request the transfer. Lina asks for confirmation before applying it.
- **Synchronisation guidance:** Synchronise the published Lina search data between participating devices. Keep `data.json` local to each installation and configure your sync provider to exclude the Producer operational area when appropriate.


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
