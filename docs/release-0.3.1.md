# Lina 0.3.1 — Stability Update

## More Reliable Embedding Generation

Lina 0.3.1 brings targeted reliability improvements when creating and updating note embeddings. The local Producer operational workspace is now initialized more thoroughly, preventing missing-directory errors during checkpoint creation. Users setting up Lina for the first time or updating existing vaults will experience a smoother, failure-free indexing process.

## Improved Producer Storage Handling

Lina now manages all required operational folders automatically behind the scenes. Operational directories for staging, checkpoints, and rollback backups are guaranteed to exist before any intermediate files or state checkpoints are written. Users never need manual folder creation or filesystem troubleshooting to run indexing and embedding tasks.

## Compatibility

- Existing vaults remain fully compatible with no changes required.
- No user migration steps or configuration updates are needed.
- Upgrading to Lina 0.3.1 is a seamless, in-place update via Obsidian Community Plugins or by replacing release files.
