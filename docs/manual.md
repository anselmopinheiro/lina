# Lina — Introduction Manual

Lina is an Obsidian assistant focused on local search, semantic search and optional AI-powered note analysis.

Its main goal is to help users find, relate and improve Markdown notes without automatically changing their files.

Lina is currently in alpha.

## 1. What Lina does

Lina can:

* create a local index of Markdown notes;
* search notes by name, path or content;
* perform textual, semantic or hybrid search;
* analyse the current note with AI;
* use contextual commands from the side panel;
* suggest YAML/frontmatter, tags, links, tasks and folder organisation;
* use local AI models through Ollama;
* configure different providers per device.

By default, Lina works locally and does not make network calls.

## 2. Local index

To search notes efficiently, Lina creates a local index inside the vault:

```text
.lina/index/
```

This index may include files such as:

```text
manifest.json
notes.json
chunks.jsonl
```

The index contains operational data required for search. It is not a full copy of the vault, but it may contain processed excerpts from notes so that textual and semantic search can work.

The `.lina/` folder is used by Lina to store local operational data.

When Lina is installed or enabled for the first time, it does not automatically build the full text index. To start using Lina search, create the index manually from the Lina side panel or by using the rebuild index command.

Automatic index updates only run after a valid index already exists. If the index is missing, incomplete, or corrupted, Lina will not create a partial index automatically. Rebuild the index manually in that case.

Manual text index rebuilds run cooperatively in small background batches. Progress and a cancel action are available in the Lina side panel. Cancelling or a fatal error does not replace the previous valid index.

This behaviour is intentional and helps keep Obsidian responsive in large vaults, on mobile devices, or in vaults synced with OneDrive or similar services.

The first index creation is always manual; after that, Lina can keep the index updated automatically.

## 3. Text blocks

During indexing, Lina splits notes into smaller text blocks.

This makes it possible to:

* search inside long notes;
* show relevant excerpts;
* find specific parts of a note;
* send only limited context to AI analysis when applicable.

Instead of treating each note as one large text, Lina works with smaller chunks. This improves search precision and avoids processing more content than necessary.

## 4. What embeddings are

Embeddings are numerical representations of text.

In simple terms, an embedding transforms a sentence, paragraph or text block into a mathematical representation of its meaning.

For example, these expressions use different words but have a related meaning:

```text
organise old notes
classify notes
structure information in the vault
```

In traditional text search, results depend heavily on exact words. With embeddings, Lina can find related notes by meaning, even when they use different words.

## 5. What embeddings are used for in Lina

In Lina, embeddings are used for semantic search.

Semantic search helps find notes by meaning, not only by exact word matching.

Example:

```text
Search: ideas for organising lessons
```

Textual search may find notes containing the exact words “ideas”, “organising” or “lessons”.

Semantic search may also find notes about:

* planning;
* content structure;
* learning activities;
* pedagogical organisation;
* work sequences.

This makes search more flexible, especially in larger vaults.

## 6. Text search

Text search looks for direct matches in the local index.

It can find results by:

* note name;
* note path;
* note content.

It is useful when the user knows the exact word, expression, file or folder they want to find.

Example:

```text
micro:bit
```

Text search usually works well when notes use the same terms as the search query.

## 7. Semantic search

Semantic search looks for notes related by meaning.

It is useful when the user does not know the exact words used in a note.

Example:

```text
activities for teaching programming
```

Even if a note does not contain that exact phrase, it may appear in the results if it is related to programming, algorithms, computational thinking or digital activities.

Semantic search requires embeddings.

At the current stage of Lina, embedding generation is manual.

## 8. Hybrid search

Hybrid search combines:

* text search;
* semantic search.

It is the recommended mode for most use cases.

Text search helps find exact matches.
Semantic search helps find meaning-based relationships.

Lina combines both scores into a single ranked list of results.

Default weights:

```text
text: 0.7
semantic: 0.3
```

These values can be adjusted in the settings.

A higher text weight favours results with exact or close word matches.

A higher semantic weight favours results related by meaning.

## 9. Relevance, similarity and result source

Lina may show different indicators in search results.

### Relevance

Relevance represents the overall strength of a result in the combined search ranking.

In hybrid search, relevance is calculated from both textual and semantic scores.

### Similarity

Similarity represents the semantic proximity between the search query and the matched content.

A higher similarity means the meaning of the found text block is closer to the search query.

### Result source

The result source explains why a note appeared in the results.

It may be related to:

* note name;
* file path;
* textual content;
* semantic match;
* hybrid match.

This helps users understand whether a result appeared because of exact words, meaning, or both.

## 10. What AI Analysis is

AI Analysis is the process of analysing the current note with the help of an AI model.

In Lina, this can use a local model through Ollama.

AI Analysis may suggest:

* YAML/frontmatter;
* tags;
* links to related notes;
* tasks;
* a possible folder;
* structural improvements;
* summary or contextual analysis.

The goal is not to replace the user, but to provide useful suggestions for improving note organisation.

By default, Lina works in suggestion mode. This means the analysis does not automatically modify the note.

## 11. How contextual analysis works

When Lina analyses a note, it can use context from related notes.

This context is retrieved through hybrid search.

General process:

1. Lina reads the current note.
2. Lina searches for related notes through hybrid search.
3. Lina selects relevant excerpts as context.
4. Lina sends the current note and selected context to the configured AI model.
5. Lina shows suggestions to the user.

Lina does not automatically read the entire vault for each analysis. It uses retrieved context from search.

## 12. Ollama

Ollama allows AI models to run locally on a computer.

When Lina uses Ollama:

* processing is local;
* notes are not sent to external services;
* Ollama must be installed and running;
* the required models must be available in Ollama.

Ollama is especially useful on computers with enough resources to run local models.

On mobile devices, local Ollama is usually not the main scenario.

## 13. Remote providers

Lina is designed to support different AI providers.

Examples of planned or configurable providers include:

* Ollama;
* Mistral;
* OpenAI;
* OpenRouter;
* Anthropic;
* Gemini.

Functional status may vary depending on the provider.

When a remote provider is used, the content required for the operation may be sent to that external service.

This should only happen when the user:

1. explicitly configures a remote provider;
2. provides the required data, such as an API key;
3. runs an action that uses that provider.

Before using remote providers, users should review the privacy policy of the selected service.

## 14. Main settings

Lina settings are organised to support different behaviour per device.

This is useful when the same vault is synced across multiple devices.

For example:

* main computer with local Ollama;
* weaker laptop with a remote provider;
* smartphone with a remote provider;
* tablet used only for search.

## 15. Analysis AI

The Analysis AI section defines the provider used for note analysis.

This configuration controls the AI used when the user asks Lina to analyse a note.

Common fields:

### Provider

Defines the AI service or system used for analysis.

Example:

```text
Ollama
```

### Model

Defines the chat or analysis model.

Example:

```text
gemma4:e2b
```

### Base URL

Defines the service address.

For local Ollama, this is usually similar to:

```text
http://localhost:11434
```

### API key

Access key used by remote providers.

For local Ollama, this is usually not required.

### Batch size

Defines the maximum number of chunks sent in one native embedding request, from 1 to 50. Lina processes batches sequentially and continues to report progress per chunk.

Mistral and modern Ollama `/api/embed` can process multiple inputs in one request. If Lina detects that Ollama requires the legacy `/api/embeddings` endpoint, it automatically uses an effective batch size of one and does not send unsupported arrays.

Larger batches can reduce the number of provider requests, but they may use more memory and produce larger payloads. Cancellation is checked before the next batch starts; a request already in progress may still need to finish or reach its timeout.

### Timeout

Maximum time Lina waits for an AI response.

A higher timeout may be useful for slower local models.
A lower timeout avoids waiting too long for a response.

## 16. Embeddings

The Embeddings section defines the provider and model used to generate embeddings.

This configuration is independent from Analysis AI.

This means the user can use:

* one model for embeddings;
* another model for note analysis.

Common fields:

### Provider

Defines where embeddings are generated.

Example:

```text
Ollama
```

### Model

Defines the model used to generate embeddings.

Example:

```text
nomic-embed-text
```

### Base URL

Service address used to generate embeddings.

For local Ollama:

```text
http://localhost:11434
```

### API key

Access key for remote providers.

For local Ollama, this is usually not required.

### Timeout

Maximum time Lina waits for embedding generation.

## 17. Hybrid search weights

Lina allows users to adjust hybrid search weights.

These weights define the relative importance of textual search and semantic search.

Example:

```text
Textual weight: 0.7
Semantic weight: 0.3
```

When textual search gives better results, it may be useful to increase the textual weight.

When semantic search finds better relationships between notes, it may be useful to increase the semantic weight.

In general:

```text
More text weight = more precision through exact words.
More semantic weight = more discovery through meaning.
```

## 18. Exclusions

Lina allows path-based exclusions.

Exclusions prevent specific folders or files from being included in the index.

This can be useful for excluding:

* temporary folders;
* private notes;
* technical files;
* content that should not appear in search;
* content that should not be used as AI context.

Some folders are permanently excluded, such as:

```text
.lina/
.obsidian/
```

These exclusions prevent Lina from indexing its own operational data or Obsidian internal configuration.

## 19. Sensitive data

Users should avoid storing passwords, tokens, API keys or sensitive data in notes that may be indexed or analysed.

When exclusions or sensitive-term filters are changed, it is recommended to rebuild the index.

This ensures that previously indexed data is replaced by an updated version of the index.

## 20. Lina side panel

The Lina side panel is available in Obsidian’s sidebar.

It is the main place for using search and checking plugin status.

In the side panel, users can:

* search notes;
* choose the search mode;
* view results;
* open matched notes;
* check index status;
* check embedding status;
* access search and analysis-related actions.

### Normal search

Typing ordinary text in the Lina input runs the normal search flow.

Example:

```text
meeting notes
```

The selected search mode controls how Lina searches:

* Hybrid combines text and semantic search;
* Text uses only the local text index;
* Semantic uses generated embeddings.

### Contextual input

The Lina input also supports contextual commands.

Contextual commands start with `/` and are written in English. They do not run accidental search.

When a contextual command needs note content, Lina chooses context in this order:

1. selected text in the active Markdown editor;
2. the last valid selection captured from the same active note, if focusing the side panel cleared the selection;
3. the current note content, if there is no valid selection.

The side panel shows safe context metadata, such as source, note name and approximate size. It does not show a preview of the selected or note content just to explain the context.

### Slash commands

Implemented contextual commands:

```text
/ask <prompt>
/tags
/yaml
```

Slash commands are in English even when the interface or notes use another language.

### `/ask <prompt>`

`/ask` sends the selected text, preserved selection or current note content to the configured Analysis AI provider with the user's prompt.

Example:

```text
/ask explain this excerpt
```

The response appears in the Lina side panel and can be copied.

If the context came from a valid captured selection, Lina can insert the response below that selection or replace it. Lina can also insert the response at the end of the active note.

No `/ask` response is applied automatically. Every write to the note requires explicit confirmation.

### `/tags`

`/tags` asks the configured Analysis AI provider to suggest only tags for the selected text, preserved selection or current note.

Suggested tags are shown with checkboxes.

Only selected tags can be applied. Tags that already exist in the note are not duplicated.

No tags are applied automatically. Applying selected tags requires explicit confirmation.

### `/yaml`

`/yaml` asks the configured Analysis AI provider to suggest only YAML/frontmatter fields for the selected text, preserved selection or current note.

Suggested fields are shown with checkboxes using the same YAML/frontmatter application flow used by note analysis.

Only selected new fields can be applied. Existing fields are not duplicated or overwritten by the command.

No YAML/frontmatter fields are applied automatically. Applying selected fields requires explicit confirmation.

### Privacy and content exclusions for contextual commands

Before Lina contacts an AI provider for a contextual command, it rechecks the final selected text, preserved selection or note content against the configured content exclusions.

If the context matches excluded content terms, Lina blocks the AI request before building the prompt.

Applying AI output is also guarded:

* Lina checks that the active note is still the note that provided the context;
* `/ask` selection-based actions check that the captured selection still matches the note content;
* Lina checks the current note content against configured exclusions before writing;
* Lina asks for confirmation before modifying the note.

## 21. Side panel modes

The side panel can use different search modes.

### Hybrid

Combines textual and semantic search.

This is the recommended mode for general use.

### Text

Uses only textual search.

Useful for finding words, names, files, exact expressions or paths.

### Semantic

Uses only semantic search.

Useful for finding notes related by meaning.

Requires generated embeddings.

## 22. Results in the side panel

Search results in the side panel may include:

* note name;
* path;
* relevant excerpt;
* result source;
* text score;
* semantic similarity;
* combined score.

Clicking a result opens the corresponding note in Obsidian.

## 23. Index status

The side panel may show information about the index.

This helps users understand whether Lina has enough data to perform searches.

Index status may indicate, for example:

* whether an index exists;
* how many notes were indexed;
* whether chunks are available;
* whether the index should be rebuilt.

When the vault changes, the index may need to be updated or rebuilt.

## 24. Embedding status

Embedding status indicates whether semantic search is ready to use.

Semantic search depends on available embeddings.

If embeddings have not been generated yet, Lina can still use text search.

In hybrid search, if embeddings are unavailable, Lina can fall back to text search.

## 25. Recommended basic workflow

A simple workflow for getting started with Lina:

1. Install and enable the plugin.
2. Check the basic settings.
3. Create the text index manually.
4. Test text search.
5. Configure embeddings.
6. Generate embeddings.
7. Test semantic search.
8. Use hybrid search as the main search mode.
9. Configure Analysis AI.
10. Test the AI provider connection.
11. Analyse a note.
12. Review suggestions before applying any change.

## 26. Recommended workflow with Ollama

To use local AI with Ollama:

1. Install Ollama on the computer.
2. Download the required models.
3. Make sure Ollama is running.
4. Set the Analysis AI provider to Ollama.
5. Select the analysis model.
6. Set the Embeddings provider to Ollama.
7. Select the embedding model.
8. Test the connection.
9. Generate embeddings.
10. Use analysis and hybrid search.

Example models:

```text
Embeddings: nomic-embed-text
Analysis AI: gemma4:e2b
```

## 27. Privacy

Lina was designed with local control in mind.

By default, Lina:

* reads Markdown files from the vault;
* creates local data in `.lina/`;
* does not use `localStorage`;
* does not use `sessionStorage`;
* does not make network calls;
* does not automatically modify notes.

Content should only be sent to external services when the user explicitly configures a remote provider and runs an action that uses it.

## 28. Syncing

If the vault is inside a synced folder, such as OneDrive, Google Drive, Dropbox or another similar service, the `.lina/` folder may also be synced.

This can have advantages and disadvantages.

Advantages:

* the index may follow the vault;
* some operational data may be available on other devices.

Disadvantages:

* operational files may use storage space;
* sync conflicts may occur;
* indexed data may pass through the sync service.

Each user should decide whether to sync `.lina/` or exclude that folder from syncing.

## 28.1. Using Lina with Syncthing between PC and mobile

Syncthing synchronises the vault folder directly between devices. This section explains how Lina behaves in that setup and what to expect.

### What to sync and what to exclude

In the recommended "PC producer / mobile consumer" pattern, the goal is to generate the text index and embeddings on a PC and let the mobile device consume them. The following Syncthing ignore file (`.stignore`) achieves this:

```text
/.obsidian*
/.trash/
*.tmp
*.sync-conflict-*
```

With this configuration:

| Item | Synced? | Reason |
|---|---|---|
| Markdown notes | Yes | Inside the vault folder. |
| `.lina/` (index + embeddings) | Yes | Inside the vault folder. Needed by mobile to consume the index. |
| `.obsidian/` (including `data.json`) | **No** | Excluded by `/.obsidian*`. Each device has its own Obsidian configuration and plugin settings. |
| Plugin folder `.obsidian/plugins/lina/` | **No** | Excluded because `.obsidian/` is excluded. |
| Device-specific Lina settings | **No** | Stored in `data.json` inside `.obsidian/`, which is excluded. |

### Plugin installation per device

Because `.obsidian/` is excluded from Syncthing, the Lina plugin must be installed separately on each device:

* on the PC: install via Community Plugins or manual copy;
* on mobile: install via Community Plugins;
* do not rely on Syncthing to distribute plugin files.

In the recommended setup, each device keeps its own `data.json` with its own Lina settings (provider, model, API keys, timeout) because `.obsidian/` is excluded from Syncthing. These settings are not shared in this setup.

### Text index and Syncthing

The text index is stored in `.lina/index/` inside the vault. It contains:

* `manifest.json` — index metadata;
* `notes.json` — indexed note list with content hashes;
* `chunks.jsonl` — text chunks used for search.

Because `.lina/` is not excluded from sync, the text index is available on all devices after sync completes. The receiving device does not need to rebuild the index from scratch.

The index is validated when loaded. If it is incomplete, corrupted or from an incompatible version, Lina falls back to requiring a manual rebuild on that device.

### Embeddings and Syncthing

Embeddings are stored in `.lina/index/embeddings.jsonl`. This file is synced when generated on the PC, so the mobile device may reuse existing embedding vectors.

Lina checks each embedding record before reusing it. The provider, model and chunk content hash must match. If the mobile device uses a different embedding provider or model, the synced embeddings are ignored and new ones are generated as needed.

The query embedding (the vector for the search text itself) is always generated on the device where the search is executed. This is not stored in the index and does not depend on sync.

### First use on a new device

When Lina is installed on a new device connected to the same Syncthing vault:

1. Install the Lina plugin via Community Plugins (not through Syncthing).
2. Configure the AI provider and embedding provider for the new device in Lina settings. Each device has its own settings because `.obsidian/` is excluded from sync.
3. If the text index was already synced via `.lina/`, Lina may detect it and offer automatic updates. If not, rebuild the index manually from the Lina panel.
4. Generate embeddings on the new device if semantic search is needed and the synced embeddings are not compatible with the local provider/model.

### Sync conflicts

Syncthing may create conflict files when the same file is modified on two devices before sync completes. Lina's index files (`.lina/index/*`) are binary or structured text files that can produce conflicts. The `.stignore` pattern `*.sync-conflict-*` helps prevent these from being propagated.

If a conflict file still appears inside `.lina/index/`, Lina ignores it. The plugin reads only the expected file names (`manifest.json`, `notes.json`, `chunks.jsonl`, `embeddings.jsonl`). Conflict copies with modified names are not read.

If the main index file itself is affected by a conflict, Lina may detect the index as invalid and require a manual rebuild.

To reduce the risk of index conflicts:

* let sync finish before using Lina on a different device;
* avoid rebuilding the index on multiple devices at the same time;
* if conflicts appear in `.lina/index/`, delete the conflict copies and rebuild the index on one device.

### Settings per device

Lina identifies each device using browser characteristics (user agent, language, hardware concurrency, touch support). This identifier is used to store device-specific settings in `data.json`.

When configuring Lina on a new device:

* open Lina settings;
* configure the AI analysis provider and model for that device;
* configure the embedding provider and model for that device;
* set API keys if using remote providers.

In the recommended setup, these settings stay on the device and are not shared because `.obsidian/` is excluded from Syncthing.

### Recommended setup

1. Configure Syncthing to exclude `/.obsidian*`, `/.trash/`, `*.tmp` and `*.sync-conflict-*` via `.stignore`.
2. Install Lina on the primary device (e.g. PC with Ollama) via Community Plugins.
3. Build the text index and generate embeddings on that device.
4. Let Syncthing sync the vault, including `.lina/`.
5. Install Lina on the secondary device (e.g. mobile) via Community Plugins.
6. Configure its own provider settings (remote provider recommended for mobile).
7. If the text index was synced, Lina may use it. If not, rebuild the index manually.
8. Generate embeddings on the secondary device if semantic search is needed and the synced embeddings are not compatible.
9. Text search works immediately after the index is available. Semantic search requires compatible embeddings.

### What to expect on mobile

On mobile devices:

* Ollama is not typically available. Use a remote provider for AI analysis and embeddings, or use text-only search.
* Text search works after the index is synced or rebuilt.
* Semantic search requires compatible embeddings. Generate them using a remote provider (Mistral, OpenAI, etc.) or skip semantic search and use text or hybrid mode (which falls back to text-only when embeddings are missing).
* The Lina panel shows the index and embedding status, so it is clear what is available.

### Summary

| Aspect | Behaviour |
|---|---|
| Text index | Synced via `.lina/index/`. Validated on load. |
| Embeddings | Synced via `.lina/index/embeddings.jsonl`. Reused only if provider, model and content hash match. |
| Query embedding | Generated locally on each device during search. |
| Plugin installation | Per device via Community Plugins. Not synced. |
| Settings (`data.json`) | Per device. Not synced because `.obsidian/` is excluded. |
| First index | Manual on the first device. Reused by other devices after sync. |
| Embeddings generation | Per device if the synced embeddings are not compatible. |
| Conflicts | Possible in `.lina/index/`. Delete conflict copies and rebuild if needed. |

## 29. Good practices

General recommendations:

* start by testing Lina in a small vault or test folder;
* check exclusions before indexing the full vault;
* do not store passwords or tokens in indexed notes;
* rebuild the index after changing important exclusions;
* validate search results before relying on them fully;
* review the context summary before using contextual AI commands;
* always review AI suggestions before applying changes;
* use Ollama when the goal is to keep everything local;
* use remote providers only when needed and with awareness of privacy implications.

## 30. Current limitations

Lina is in alpha.

Current limitations include:

* embeddings are still generated manually;
* some mobile workflows are still being validated;
* AI analysis uses context retrieved through hybrid search;
* text search is not a full replacement for Obsidian’s native search;
* remote providers are still evolving;
* PDF, DOCX, image and OCR analysis are planned for future development.

## 31. Quick summary

Lina helps users find and improve notes inside Obsidian.

Text search finds words and paths.
Semantic search finds meaning.
Hybrid search combines both.
Embeddings enable meaning-based search.
AI Analysis suggests improvements for the current note.
The side panel is the main search and status interface.
Contextual commands let users ask about, tag or suggest YAML for the selected text or current note.
Ollama allows local AI usage.
Remote providers can be used, but require privacy awareness.

Lina’s core principle is simple:

```text
Help organise and understand notes without taking control away from the user.
```
