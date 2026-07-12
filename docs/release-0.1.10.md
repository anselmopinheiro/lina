# Lina 0.1.10 — Index reliability improvements

## Summary

Lina 0.1.10 improves the reliability of the local text index and adds regression coverage for the critical indexing flows.

## Main improvements

- Reconciles text-index changes made while Obsidian was closed, including new, modified, removed, and renamed notes, once a valid index already exists.
- Reduces the risk of divergence between the active in-memory text index and the index persisted on disk after save failures.
- Handles rapid automatic updates across multiple notes with independent per-file debounce.
- Prevents recurring no-op startup batches from content-excluded notes that should never become active text-index candidates.
- Adds integrated regression tests for startup reconciliation, persistence failure handling, debounce behaviour, and automatic update flows.
- Improves automatic indexing diagnostics with clearer event counts, sampled paths, and skipped-candidate reasons.

## User impact

Search and index-backed workflows should behave more predictably after restarting Obsidian, syncing files, or editing several notes in quick succession. The first text-index creation is still manual, and automatic updates still require an existing valid index.

## Update notes

Update by replacing the plugin files with the release assets or through Obsidian's community plugin update flow when available. No manual migration is required.

## Limitations

Lina remains in alpha. Mobile validation is still incomplete, and semantic embeddings are still generated manually.
