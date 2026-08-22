# Lina 0.2.1 — Simplified Settings, Local-First Search and Improved AI Transparency

Lina 0.2.1 introduces a simplified settings experience, formalizes the Desktop Producer and Mobile Companion multi-device architecture, expands AI provider support with OpenRouter, and establishes clearer privacy and API cost transparency.

---

## What's New in 0.2.1

### 1. Simplified Settings Experience
Lina's settings have been reorganized into three intuitive, functional areas to improve usability and discoverability:
- **Basic settings:** Everyday options for configuring active devices, AI analysis and embedding providers, inbox processing, folder and term exclusions, YAML properties, and interface language.
- **Advanced settings:** Technical controls for fine-tuning hybrid search scoring weights, index diagnostics, and search storage preferences.
- **Maintenance & recovery:** Diagnostic tools to inspect search data health, run validation checks, and execute recovery actions protected by confirmation safeguards.

> **Zero Migration Required:** All existing settings values, provider configurations, and search indexes remain 100% compatible. No manual migration or reconfiguration is needed.

### 2. Desktop Producer and Mobile Companion Architecture
Lina formalizes an explicit capability model tailored for multi-device Obsidian setups:
- **Desktop (Producer):** Acts as the authoritative manager of search assets. Responsible for creating and maintaining the text index, generating vector embeddings when configured, and preparing synchronized search data.
- **Mobile (Companion):** Functions as a streamlined consumer. Reads synchronized search data to deliver instant, local text, semantic, and hybrid search without draining battery or causing conflicting background maintenance operations on mobile devices.
- **Multi-Device Synchronization:** Vaults and the `.lina/index/` directory can be synchronized seamlessly across devices using user-selected tools such as Syncthing. *(Note: Lina does not provide a proprietary cloud sync service; synchronization is managed using your preferred file-sync solution).*

### 3. Local-First Search
- **Instant Keyword Search:** Text search works out of the box immediately after creating the initial index, without requiring any AI provider, account, API key, or network connection.
- **Local Indexing:** Text indexing and normal search occur 100% locally on your device.
- **Optional AI Enrichment:** Semantic vector search and AI assistance remain entirely optional features that can be enabled whenever desired.

### 4. Expanded AI Provider Support
Lina supports independent configuration for **AI Analysis** (chat and slash commands) and **Vector Embeddings** (semantic search):
- **Supported Providers:** **Ollama** (Local compute), **Mistral** (Remote cloud), and **OpenRouter** (Remote cloud).
- **OpenRouter AI Analysis:** You can now connect OpenRouter to power note analysis and contextual slash commands (`/ask`, `/tags`, `/yaml`) with your choice of model identifier (e.g., `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.3-70b-instruct`).
- **Flexible Mixing:** Combine providers freely—for instance, use local Ollama for zero-cost embeddings alongside OpenRouter or Mistral for note analysis.

### 5. Privacy & API Cost Transparency
- **Local Vault Access:** Lina accesses vault notes locally because indexing requires reading note content to enable search.
- **Zero Uploads for Indexing & Search:** Notes are **never** uploaded during indexing or normal local search. All index operational data stays strictly in `.lina/index/` on your device.
- **On-Demand Remote AI:** External AI providers are contacted **only** when you explicitly enable, configure, and invoke an AI command.
- **Cost Transparency:**
  > API usage may incur costs charged directly by the selected AI provider. These costs are not controlled, managed, or paid by Lina.

### 6. Support & Feedback
The Lina Settings header and documentation now include a support link for users who would like to support ongoing Lina development or share feedback:
- [Support and Feedback Form](https://forms.gle/9TeD7hdb9AbjhNFt9)
- Email: [apinheiro@duck.com](mailto:apinheiro@duck.com?subject=Lina%20support%20request)

---

## Installation & Upgrade

### Updating Existing Installations
1. Replace `manifest.json`, `main.js`, and `styles.css` in your vault's `.obsidian/plugins/lina/` directory with the new release assets (or update via Obsidian Community Plugins once listed).
2. Reload Obsidian or restart the plugin under **Settings > Community Plugins**.
3. All existing configuration, indexes, and settings will load seamlessly.

---

## Full Changelog
For a complete list of technical changes, fixes, and improvements, see [CHANGELOG.md](CHANGELOG.md).
