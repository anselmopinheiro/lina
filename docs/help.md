# Lina — Help

Practical guidance for using Lina **0.3.2 (Alpha)**. For concepts see the [Glossary](GLOSSARIO.md); for the full reference see the [User Manual](manual.md); for slash commands see the [Commands Guide](commands.md).

> Lina is in Alpha: it is usable, but under active development. Behaviour and internal formats may still evolve. Keep backups of your vault.

---

## How Lina works in one minute

- Lina builds a local **search index** of your Markdown notes. This works with no AI provider and no network.
- Optionally, **embeddings** add meaning-based (semantic) search.
- Optionally, an **AI provider** helps with analysis, `/ask`, `/tags` and `/yaml`.
- With more than one device, one device is the **Producer** (prepares the search data) and the others are **Companions** (use the synchronised data).

## Producer setup

1. Install Lina on the device that will prepare the search data (usually your desktop).
2. In **Settings > Lina > General**, choose the **Producer** role and confirm.
3. Open the Lina side panel and let the initial index finish.
4. Optional: in **Search**, enable semantic search and configure the embeddings provider; then generate embeddings (see [Embeddings](#embeddings-and-costs)).
5. Synchronise the vault, including the whole `.lina` folder, to your other devices.

## Companion setup

1. Make sure the Producer has finished its initial preparation and that the vault, including `.lina`, has synchronised to this device.
2. Install Lina on the Companion device and choose the **Companion** role in **Settings > Lina > General**.
3. Open the Lina side panel. Search uses the synchronised data; no index is built on the Companion.

A Companion cannot replace the Producer: it needs the artefacts the Producer produces. The order is functional; the physical installation order does not matter.

## Initial indexes

- The first text index is created from the Lina side panel on the Producer, when required. After that, Lina keeps it up to date automatically (if enabled in the Producer settings).
- Embeddings are never generated for the whole vault silently at startup.

## Synchronisation

- Lina does not depend on a specific sync application.
- **The whole `.lina` folder, with all files and subfolders, must be synchronised** between the Producer and every Companion. Do not exclude `.lina` or any part of it.
- Keep each device's plugin installed locally (Community Plugins); do not synchronise the plugin folder.
- API keys are stored on each device and are never written to `.lina`.
- If your sync tool creates conflict files, Lina ignores them and reads the canonical files only.

## Search types

| Type | What it does | Needs embeddings |
| :--- | :--- | :---: |
| **Text** | Keyword search over titles, paths and content. Works immediately. | No |
| **Semantic** | Finds notes by meaning, even with different words. | Yes |
| **Hybrid** | Combines text and semantic ranking into one list (recommended when embeddings are available). | Optional; falls back to text |

If semantic data is unavailable on a device, hybrid search continues with text search.

`/ask`, `/tags` and `/yaml` are **not** search modes. They act on your active note or selection (see [AI analysis](#ai-analysis)).

## Embeddings and costs

- Embeddings power semantic and hybrid search.
- Generating or updating them is an explicit action by default (update mode *manual*). On a Desktop Producer using Ollama on this computer you may choose *automatic (local only)*.
- **Local provider (Ollama on this computer):** no API cost; uses your computer's time and resources.
- **Remote provider (Mistral, OpenRouter):** may generate costs billed directly by the provider, and the text of your notes is processed by that provider. Lina asks for confirmation before updating embeddings with a remote provider.
- Generation can take time on large vaults. You can cancel it from the panel.

## AI analysis

- AI features run only when you start them: note analysis, folder or Inbox analysis, `/ask`, `/tags`, `/yaml`.
- Lina never changes a note without your explicit confirmation.
- `/tags` and `/yaml` suggest tags and frontmatter for the active note, starting from the vocabulary already used by related notes in your vault.
- With a remote provider, the context you send leaves your device; choose a local provider if that matters to you.

## AI privacy and exclusions

Lina distinguishes two things:

1. **Local indexing** — reading notes on your device to build the search index.
2. **Sending content to an AI provider** — only when you start an AI action.

Before any content is sent to an AI provider, Lina applies your exclusion rules:

- **Excluded folders** — notes inside these folders are not sent.
- **Excluded path terms** — notes whose path contains one of these terms are not sent.
- **Excluded content terms** — content containing one of these terms is not sent.

If the exclusion policy cannot be validated (missing or invalid), the request is blocked and nothing is sent.

The same rules decide which notes are indexed and appear in search results.

### Where exclusions are changed

- **Producer:** edit them in **Settings > Lina > Privacy & Exclusions**.
- **Companion:** the same page shows the effective rules **read-only**, in a single column, with a notice that they are managed by the Producer. Change them on the Producer; they reach the Companion through synchronisation.

## Producer status and warnings

| Message | Meaning | What to check |
| :--- | :--- | :--- |
| No Producer activity for more than 48 h | The synchronised Producer state has not been updated for 48 hours. | Is the Producer device running Lina and publishing? Has `.lina` synchronised (including `producer-state.json`)? |
| Producer activity ageing (more than 24 h) | Same, at the early warning threshold. | Same as above. |
| Update required / outdated embeddings | Notes changed after the last embeddings were generated. | On the Producer, update embeddings. |
| Semantic search unavailable on this device | Embeddings are missing or incompatible with this device's configuration. | Generate embeddings on the Producer, and check the provider and model. |

This warning is shown only on devices other than the active Producer. On a Companion it refreshes when the synchronised Producer state changes: Lina checks that file about every 30 seconds while the panel is visible and when the panel becomes active, and also when you reopen or refresh the panel.

## Troubleshooting

### The Companion shows no results or no semantic search
- Confirm the Producer finished its initial index.
- Confirm the whole `.lina` folder synchronised to the Companion.
- Open the diagnostics from the panel to see the state of the index and embeddings.

### "No Producer activity" appears but the Producer is working
- Check that the Producer is on a recent Lina version and has published after the change.
- Check that `.lina/producer-state.json` has synchronised to the Companion.
- Reopen or refresh the Lina panel on the Companion.

### AI action blocked
- The note or context matched an exclusion rule, or the exclusion policy could not be validated. On a Companion, check that `.lina/exclusions.json` has synchronised.

### Provider connection failed
- Local: check that Ollama is running and that the Base URL is correct.
- Remote: check the API key, the model name and your connection. Use the connection test in Settings.

### I changed provider or model and semantic search stopped
- Embeddings are tied to the provider and model that created them. Restore the previous provider/model, or run a confirmed rebuild on the Producer.

## Where to ask for help

- [Support and feedback form](https://forms.gle/9TeD7hdb9AbjhNFt9)
- Email: apinheiro@duck.com
