# LINA-03 — Implement local/synchronized storage boundary

**Version:** Lina 0.3.0  
**Date:** 2026-09-27

## Initial state and corrected findings

The work began on `master` with the preceding Producer-workspace implementation already uncommitted.
Text-index and JSONL embedding work artifacts had been moved, but binary publication still used temporary and backup files in `.lina/index/`; Device Diagnostics still read the old public checkpoint path.

`src/index/embeddingBinaryStorage.ts` now keeps only the final binary manifest, metadata, and vector buffer in `.lina/index/`. Candidates use `.lina/producer/staging/` and rollback copies use `.lina/producer/backups/`. The existing validate → rename → manifest-last → validate → cleanup flow, write exclusion, rollback, and recovery rules are unchanged.

`src/device/deviceDiagnostics.ts` now reads checkpoint metadata through `EMBEDDING_PERSISTENCE_FILES.checkpointMetadata` at `.lina/producer/checkpoints/`; it never reads the obsolete `.lina/index/embeddings.checkpoint.meta.json` location.

## Storage boundary

```text
.lina/index/                       synchronized publication only
  notes.json, chunks.jsonl, embeddings.jsonl, manifest.json
  embeddings.binary.manifest.json
  embeddings.meta.jsonl
  embeddings.vectors.f32

.lina/producer/                    Producer-private operational workspace
  checkpoints/
  staging/
  backups/
```

Companion readers continue to use only exact canonical files in `.lina/index/` and never depend on checkpoint, staging, or backup paths.

## Compatibility and impact

No existing vault data is deleted or migrated automatically. Legacy index-local checkpoints, temporaries, and backups remain untouched by the new private-path recovery code, preventing destructive cleanup of prior-version data. New text, JSONL embedding, and binary transactions no longer create operational files in `.lina/index/`.

The Producer retains validation, atomic promotion, rollback, and recovery. The Companion retains the same read-only canonical artifact contract. The documented Syncthing exclusion `/.lina/producer/` remains required while the workspace is inside the vault; a physical device-local runtime store remains future work.

## Documentation, tests, and validation

`README.md`, `docs/manual.md`, `docs/roadmap.md`, and `CHANGELOG.md` document the binary publication boundary.

Coverage proves that only final binary artifacts use `.lina/index/`, binary recovery does not delete legacy index-local residue, and diagnostics reads the private checkpoint metadata path rather than the obsolete public path.

- Focused validation passed: 2 files / 34 tests.
- Full validation passed: 121 files / 1,658 tests; `npm run typecheck`;
  `npm run lint:obsidian:strict`; `git diff --check`; and `npm run build`.
- Vector Contract, Producer State, Ownership, Exclusion Policy, settings schema, and version 0.3.0 are unchanged.

## Commit

Created after final validation; see the repository log for the commit identity.
