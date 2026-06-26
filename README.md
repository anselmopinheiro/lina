# Lina

Lina is an AI-powered note assistant that enhances knowledge management through semantic search, smart organisation, and connected thinking.

It helps you move from isolated notes to a structured knowledge system by surfacing relevant content, linking ideas, and supporting writing workflows.

---

## Installation

### Manual installation

1. Download the latest release from the GitHub repository
2. Extract the files if necessary
3. Copy the folder into your Obsidian vault plugins directory:

```
VaultFolder/.obsidian/plugins/lina/
```

4. Restart Obsidian
5. Enable Lina in Community Plugins

---

### Community Plugins (when approved)

1. Open Obsidian Settings
2. Go to Community Plugins
3. Search for “Lina”
4. Install and enable it

---

## Usage

After enabling Lina:

### 1. Open the plugin

- Access Lina from the left ribbon or command palette

### 2. Search your notes

- Use semantic search to find ideas based on meaning, not just keywords

### 3. Explore linked ideas

- Lina suggests related notes automatically

### 4. Use AI assistance

- Summarise notes
- Generate connections
- Explore related concepts

---

## Features

- Semantic search across your notes
- Smart organisation and tagging suggestions
- Linked notes and automatic relationship discovery
- AI-assisted writing and summarisation
- Fast and lightweight integration with Obsidian

---

## Vision

Lina acts as a personal knowledge assistant that grows with your notes, helping you think more clearly and organise information more effectively.

---

## Status

Early alpha release. Features are actively evolving.

Feedback and contributions are welcome.

---

## Privacy and Vault Access

Lina scans Markdown files in the vault to build a local search index. This is required for search, semantic search and hybrid search.

- **Local index**: stored in the vault under `.lina/`.
- **Exclusions**: the user can configure folder and path exclusions in the plugin settings.
- **No external data sharing**: Lina does not send note contents to external AI providers unless the user explicitly configures a remote provider and triggers an action that uses it.
- **Local providers**: when using a local provider like Ollama, all processing stays on the user's machine, subject to the user's own Ollama setup.
- **Remote providers**: providers such as Mistral, OpenRouter, OpenAI, Anthropic or Gemini, when configured and explicitly triggered by the user, may receive only the content needed for the user-triggered action.
- **API keys**: API keys for remote providers are stored locally in `.lina/data/store.json` inside the vault.
- **No tracking**: Lina does not collect telemetry, analytics, or any usage data.
- **No network requests**: Lina makes no network requests unless the user configures a remote AI provider and triggers an action.
