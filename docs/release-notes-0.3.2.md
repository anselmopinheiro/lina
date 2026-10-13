# Lina 0.3.2 Alpha — Release notes

0.3.2 is a consolidation release: it makes the Producer + Companion model more robust and coherent. Lina remains in Alpha; keep backups of your vault.

## What changes for you

- **AI requests are checked against your exclusions before anything is sent.** Excluded folders, path terms and content terms are applied in one central step for note analysis, `/ask`, `/tags`, `/yaml`, folder and Inbox analysis. If the exclusion policy cannot be validated, the request is blocked and nothing is sent.
- **Companions show the effective exclusions (read-only).** Change them on the Producer.
- **`/tags` and `/yaml` use the same suggestion engine as the note analysis.** Suggestions start from the vocabulary already used by related notes and use the AI only for what that does not cover. Nothing is written without your confirmation.
- **More reliable Producer status on Companions.** The Producer now records its publication activity after incremental updates, and a Companion refreshes when the synchronised Producer state changes (checked about every 30 seconds while the panel is visible), so an outdated "no Producer activity" warning no longer lingers.
- **More robust embeddings and index persistence**, including crash-safe publication and recovery of interrupted publications on the Producer.
- Refinements to the search and analysis panel and to semantic search stability.

## Reminder

Synchronise the **whole `.lina` folder** (all files and subfolders) between the Producer and your Companions, with any synchronisation application you prefer. Set up the Producer first and let its initial preparation finish.

See the [Help](help.md), the [Glossary](GLOSSARIO.md) and the [Changelog](../CHANGELOG.md).
