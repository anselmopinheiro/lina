# Search query normalization

Lina uses `normalizeSearchQuery()` as the canonical v1 representation for search queries. It applies Unicode **NFC**, trims outer whitespace, collapses internal whitespace to one space, and lowercases the result. NFC was selected to equate canonically equivalent Unicode sequences without compatibility transformations or linguistic changes.

Textual search normalizes through this helper before tokenization, matching and ranking. Semantic search normalizes before its query embedding is generated. Hybrid search normalizes once at its boundary and shares that value with its textual and semantic branches. No query-result or query-embedding cache is currently implemented; any future cache must key by this normalized value.

The UI retains its raw input. Empty normalized queries retain the existing no-search behavior and are never sent to an embedding provider. Normalization does not remove accents, punctuation, stopwords, or apply stemming or lemmatization. Existing textual accent-insensitive matching remains a separate matching behavior.
