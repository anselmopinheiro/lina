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
3. **Create the Initial Index:** Open the Lina side panel in Obsidian's right sidebar and create the initial index when required (click **Rebuild Index** or run the rebuild command). Once created, Lina maintains the text index automatically.
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
- **Remote AI (Mistral, OpenRouter):** Requires an API key and internet connectivity. API keys are stored securely per device and never exposed in logs or diagnostics.

---

## Privacy & Data Transparency

Lina is built around data ownership and transparent operation:

- **Local Vault Access:** Lina reads vault notes locally because building and updating a search index requires reading note content.
- **Zero Uploads for Indexing & Local Search:** Notes are **never** uploaded during indexing or normal local text search. All index operational data is stored locally within `.lina/index/`.
- **On-Demand AI Communication:** External AI providers are contacted **only** when you explicitly enable, configure, and invoke an AI feature.
- **Minimal Context Transmission:** When using an external AI API, Lina sends only the specific text context required for that request (subject to your configured path and content exclusion filters).
- **External API Costs:** Costs are charged directly by the selected AI provider. These costs are not controlled, managed or paid by Lina.

---

## Settings Organization

Lina organizes configuration into three clear areas:

- **Basic settings:** Everyday options including active device name, AI analysis provider, embedding provider, inbox folder, folder and term exclusions, YAML properties, and interface language.
- **Advanced settings:** Technical controls for hybrid search scoring weights, index diagnostics, and search storage preferences.
- **Maintenance & recovery:** Tools to inspect search data health, run validation checks, and execute recovery actions protected by confirmation safeguards.

---

## Mobile & Multi-Device Support

Lina supports both Desktop and Mobile (Android) environments:

- **Desktop:** Builds and maintains the text index and vector embeddings.
- **Mobile:** Consumes synchronized index data for instant search without running battery-intensive indexing on mobile devices.
- **Multi-Device Sync (Syncthing):** Sync your vault and the `.lina/index/` directory to mobile for a seamless cross-device workflow. See the [User Manual](docs/manual.md#module-6-multi-device-sync-best-practices--troubleshooting) for recommended setup details.

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
