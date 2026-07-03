# Changelog

## 0.1.7

### Added
- Added the `/yaml` contextual command to suggest YAML/frontmatter fields from the selected text, preserved selection, or current note, then apply selected new fields with confirmation without duplicating or overwriting existing fields.
- Added the `/tags` contextual command to suggest tags from the selected text, preserved selection, or current note, then apply selected tags with confirmation without duplicating existing note tags.
- Added a safe `/ask` context summary in the side panel showing the source, note, size, exclusion recheck, and truncation state without previewing note content.
- Added confirmed `/ask` response application actions for inserting below the captured selection, replacing the selection, or inserting at the end of the active note with safety checks.
- Added the first contextual side-panel command, `/ask`, which sends the selected text or current note to the configured AI provider without modifying the note.
- Added folder-based batch note analysis with folder selection, optional subfolders, exclusion-aware counts, and remote-provider confirmation.
- Added a small action to copy AI analysis responses to the clipboard from the Lina side panel.

### Changed
- Preserved suggested metadata can now be selected and applied to the active note after switching notes.
- Clear note-specific AI analysis results when the active note changes, while keeping suggested metadata visible.
- Show the original candidate origin, score, and match reason below AI-suggested internal links.
- Made the related-note analysis prompt stricter so AI link suggestions favour useful candidates and can return no links when relevance is weak.
- Added origin, score, and reason details to related-note suggestions in the analysis preview.

### Fixed
- Blocked `/ask` from contacting AI providers when the final selected or note context matches user-configured excluded content terms.
- Fixed `/ask` selection handling so selected text can still be used after focusing the Lina input.
- Preserved Inbox/folder batch YAML/tag suggestions per note path when opening a result note, without aggregating metadata across notes.
- Preserved YAML/tag suggestions across both single-note analysis flows and kept Inbox/folder YAML/tags visible per result card without global aggregation.
- Restored preserved YAML and tag suggestions after switching notes from a single-note analysis, while keeping Inbox/folder batch suggestions scoped to their result cards.
- Limited preserved suggested metadata to single-note analysis so batch Inbox/folder suggestions stay scoped to their own result cards.
- Corrected Ollama text generation URL handling and 404 diagnostics for local analysis requests.
- Improved related-note candidates by softening folder ranking, filtering already linked notes, and deduplicating by path.
- Restored exact text search matches for short notes that do not produce chunks.
- Improved text and hybrid search ranking so full-word matches rank above prefix or substring matches, while partial matches remain available.

## Unreleased

### Added
- Added an internal model catalog for supported Ollama and Mistral chat and embedding models.
- Added automatic Base URL defaults for Ollama and Mistral settings.
- Added Mistral embeddings provider support.
- Added an embeddings connection test button that verifies the configured provider/model without reading notes or writing to the index.

### Changed
- Improved AI and embedding model settings with catalog-based model choices while keeping manual/custom model entry.
- Improved embeddings connection test diagnostics with safe provider, model, endpoint, HTTP status, and short API error details.
- Updated the user manual with contextual commands and privacy notes.
