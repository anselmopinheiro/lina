# Changelog

## Unreleased

### Added
- Added a small action to copy AI analysis responses to the clipboard from the Lina side panel.

### Changed
- Preserved suggested metadata can now be selected and applied to the active note after switching notes.
- Clear note-specific AI analysis results when the active note changes, while keeping suggested metadata visible.
- Show the original candidate origin, score, and match reason below AI-suggested internal links.
- Made the related-note analysis prompt stricter so AI link suggestions favour useful candidates and can return no links when relevance is weak.
- Added origin, score, and reason details to related-note suggestions in the analysis preview.

### Fixed
- Corrected Ollama text generation URL handling and 404 diagnostics for local analysis requests.
- Improved related-note candidates by softening folder ranking, filtering already linked notes, and deduplicating by path.
- Restored exact text search matches for short notes that do not produce chunks.
- Improved text and hybrid search ranking so full-word matches rank above prefix or substring matches, while partial matches remain available.
