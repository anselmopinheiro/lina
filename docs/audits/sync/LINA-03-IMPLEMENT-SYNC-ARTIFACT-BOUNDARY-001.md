# LINA-03 — Implement Producer/private sync artifact boundary

**Version:** Lina 0.3.0  
**Date:** 2026-09-27

## Initial state

The working branch was `master`; the repository already contained the prior
audit report as an untracked documentation artifact. Before this change,
embedding checkpoints, staging candidates, and backups were all named within
`.lina/index/`. The text-index transaction also staged and backed up files in
that published directory.

## Changes

The persistence path inventory in `src/index/embeddingPersistence.ts` now
uses the following boundary:

```text
.lina/
├── index/                         # synchronized, canonical publication
│   ├── notes.json
│   ├── chunks.jsonl
│   ├── embeddings.jsonl
│   └── manifest.json
└── producer/                      # private operational workspace
    ├── checkpoints/
    │   ├── embeddings.checkpoint.jsonl
    │   └── embeddings.checkpoint.meta.json
    ├── staging/
    │   ├── embeddings.checkpoint.tmp
    │   ├── embeddings.checkpoint.meta.tmp
    │   ├── embeddings.publish.tmp
    │   └── manifest.publish.tmp
    └── backups/
        ├── embeddings.checkpoint.backup
        ├── embeddings.checkpoint.meta.backup
        ├── embeddings.publish.backup
        └── manifest.publish.backup
```

`writeEmbeddingCheckpoint()` and `publishCanonicalEmbeddings()` create the
required private directories before writing. Candidate validation, bounded
rename retries, rollback, recovery, and canonical post-publication validation
are unchanged; only operational paths changed. The final promotions still
rename validated candidates into `.lina/index/`.

`saveTextIndex()` now writes its candidate files to
`.lina/producer/staging/` and moves prior files to
`.lina/producer/backups/`, preserving manifest-last publication and existing
rollback behavior. It leaves no staging or backup artifact in `.lina/index/`.

## Producer impact

The Active Producer retains resumable checkpoints and rollback safety, but
their files are now clearly separated from Companion-facing data. A failure
during generation leaves a private checkpoint; a failure during publication
uses private backups to restore the previously published canonical pair.

## Companion impact

Companion readers continue to address only exact canonical files in
`.lina/index/`. They neither read nor need `.lina/producer/`, so no new
Companion protocol, Vector Contract, Producer State, Ownership, Exclusion
Policy, settings schema, or version change was introduced.

## Compatibility and synchronization

Existing canonical vault artifacts retain their paths and remain readable.
This implementation does not automatically delete existing old checkpoint or
backup files from `.lina/index/`; users may remove them only after confirming
they are not needed for recovery. New operations do not create them there.

Because `.lina/producer/` is inside the vault, synchronization tools must
exclude it. The manual now adds `/.lina/producer/` to the recommended
Syncthing `.stignore` alongside `*.tmp`. With that rule in place, Syncthing
synchronizes canonical publication artifacts and does not follow Producer
operational artifacts.

## Tests and validation

- Added a persistence-path test proving only canonical embedding files live
  under `.lina/index/`.
- Added a text-index transaction test proving writes use Producer staging and
  backups use the Producer backup directory.
- Focused boundary tests passed: 2 files, 110 tests; the affected regression
  set also passed: 5 files, 107 tests.
- Full validation passed: 121 test files, 1,655 tests; `npm run typecheck`;
  `npm run lint:obsidian:strict`; `git diff --check`; and `npm run build`.
- The initial sandbox test/build attempts could not start esbuild (`spawn
  EPERM`); successful Vitest and build validation ran outside that sandbox.

## Completion condition

**With `/.lina/producer/` excluded in the synchronizer, Syncthing follows
only published `.lina/index/` artifacts and never Producer-private operational
files.**
