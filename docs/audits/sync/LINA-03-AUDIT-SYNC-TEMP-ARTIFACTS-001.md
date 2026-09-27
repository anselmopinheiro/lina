# LINA-03 — Audit of synchronized temporary embedding artifacts

**Audit type:** technical, read-only audit  
**Version in scope:** Lina 0.3.0  
**Date:** 2026-09-27  
**Decision:** no production code, schema, migration, or version was changed.

## 1. Current state

The repository was clean at the start of the audit (`git status --short` had
no output) and the checked-out branch was `master`. The ten most recent
commits include `2a9771e chore: synchronize app version to 0.3.0` and the
current `cf8702a fix: establish producer settings boundary and contract
separation`.

`src/index/embeddingPersistence.ts` defines every embedding persistence path.
All of them currently live under `.lina/index/`. The generator invokes
`recoverEmbeddingPersistenceArtifacts()` before loading or creating a
checkpoint, then writes checkpoints batch by batch and publishes only a fully
validated canonical pair.

The observed names
`.syncthing.embeddings.checkpoint.backup.tmp` and
`.syncthing.embeddings.checkpoint.meta.backup.tmp` are **not Lina path
names**. Lina creates `embeddings.checkpoint.backup` and
`embeddings.checkpoint.meta.backup`; the `.syncthing.` prefix and final `.tmp`
are Syncthing's own temporary receive/write form for those Lina files. Their
presence therefore proves that Syncthing could observe a Lina backup in the
synchronized directory. It does not prove that Lina directly wrote a
`.syncthing.*` file.

## 2. Artifacts found and classification

| Artifact | Location | Creator | Producer | Synchronize | Decision |
| --- | --- | --- | --- | --- | --- |
| `embeddings.jsonl` | `.lina/index/` | `publishCanonicalEmbeddings()` | Active Producer | Yes | **A — public synchronized** canonical vector records. |
| `manifest.json` | `.lina/index/` | text-index writer; updated by `publishCanonicalEmbeddings()` | Active Producer | Yes | **A — public synchronized** canonical manifest and Vector Contract. |
| `embeddings.checkpoint.jsonl` | `.lina/index/` | `writeEmbeddingCheckpoint()` | Active Producer | No | **B — private Producer** recoverable, incomplete generation state. |
| `embeddings.checkpoint.meta.json` | `.lina/index/` | `writeEmbeddingCheckpoint()` | Active Producer | No | **B — private Producer** metadata paired with the checkpoint. |
| `embeddings.checkpoint.tmp` | `.lina/index/` | `writeEmbeddingCheckpoint()` | Active Producer | No | **C — transient temporary** candidate checkpoint. |
| `embeddings.checkpoint.meta.tmp` | `.lina/index/` | `writeEmbeddingCheckpoint()` | Active Producer | No | **C — transient temporary** candidate metadata. |
| `embeddings.checkpoint.backup` | `.lina/index/` | `writeEmbeddingCheckpoint()` | Active Producer | No | **C while normal; D after failed cleanup/rollback.** Previous checkpoint retained only for atomic replacement. |
| `embeddings.checkpoint.meta.backup` | `.lina/index/` | `writeEmbeddingCheckpoint()` | Active Producer | No | **C while normal; D after failed cleanup/rollback.** Paired previous metadata. |
| `embeddings.publish.tmp` | `.lina/index/` | `publishCanonicalEmbeddings()` | Active Producer | No | **C — transient** canonical embeddings candidate. |
| `manifest.publish.tmp` | `.lina/index/` | `publishCanonicalEmbeddings()` | Active Producer | No | **C — transient** canonical manifest candidate. |
| `embeddings.publish.backup` | `.lina/index/` | `publishCanonicalEmbeddings()` | Active Producer | No | **C while normal; D after interrupted publication.** Rollback source for canonical embeddings. |
| `manifest.publish.backup` | `.lina/index/` | `publishCanonicalEmbeddings()` | Active Producer | No | **C while normal; D after interrupted publication.** Rollback source for the manifest. |
| `.syncthing.embeddings.checkpoint.backup.tmp` and metadata counterpart | `.lina/index/` on a syncing device | Syncthing, while receiving Lina's backup | Not a Lina Producer artifact | No | **C — external sync temporary.** Symptom of the boundary leak, not a Lina-created filename. |

## 3. Creation and cleanup flow

### Checkpoint publication

`writeEmbeddingCheckpoint()` serializes and validates its JSONL and metadata
candidates, writes `*.checkpoint.tmp` and `*.checkpoint.meta.tmp`, moves the
old canonical checkpoint pair to `*.backup`, promotes both temporary files,
validates the resulting pair, then removes the backups. On an exception it
removes promoted files where necessary, restores the backups, and attempts to
remove both temporary files.

Checkpoint records intentionally survive a cancelled or failed generation so a
later Producer run can resume without repeating provider requests. On a fully
successful canonical publication, `publishCanonicalEmbeddings()` removes the
checkpoint and its metadata.

### Canonical publication

`publishCanonicalEmbeddings()` validates records and a manifest candidate,
writes `embeddings.publish.tmp` and `manifest.publish.tmp`, moves old
canonical files to `*.publish.backup`, promotes the candidates, validates the
published pair, then removes publication backups and checkpoint files. It
rolls back to the backup files on failure.

### Recovery

At the start of `generateEmbeddingsForChunks()`,
`recoverEmbeddingPersistenceArtifacts()` removes known `*.tmp` files,
removes backups when the canonical pair is valid, or restores a validated
backup when it is not. It deliberately handles only its known paths; unknown
temporary files are retained. Rename retries are limited to Windows `EBUSY` /
`EPERM` errors (25, 75, and 150 ms), which reduces lock-related residue but
does not create a storage boundary.

The persistence test suite explicitly covers cleanup after success, rollback,
recovery of known backups, and retaining an unknown `.lina/index/unknown.tmp`.

## 4. Risks

1. **Sync observation window:** the atomic sequence is local to a filesystem;
   a file synchronizer can observe a checkpoint, backup, or candidate between
   renames and propagate or materialize it remotely.
2. **Companion contract leak:** a Companion needs only canonical, validated
   artifacts. Checkpoints and backups have no Companion read contract and may
   represent incomplete work or a rollback state.
3. **Residue after interruption:** recovery is robust for known names, but a
   crash, failed cleanup, or sync race can leave `*.backup` or `*.tmp` visible
   until the next Producer recovery. Syncthing's `.syncthing.*.tmp` files can
   remain independently of Lina's cleanup.
4. **Current documentation is too broad for this distinction:**
   `docs/manual.md` says `.lina/index/` is synchronized and recommends
   `*.tmp` in `.stignore`. That ignores names ending in `.tmp`, including the
   observed Syncthing temporary, but does not exclude Lina's `*.backup` files
   or the persistent checkpoints. It is mitigation, not a Producer/Companion
   storage boundary.

## 5. Producer and Companion impact

**Producer:** checkpoints are legitimate private recovery state. Their
location in `.lina/index/` makes an otherwise correct transactional design
externally visible to synchronization tools. Backups and candidates are valid
only during a Producer transaction or recovery.

**Companion:** the Companion is designed as a read-only consumer of
synchronized canonical artifacts. It has no legitimate need to consume,
restore, or retain checkpoint, backup, publication-candidate, or Syncthing
temporary files. Their arrival increases sync churn and can expose an
intermediate generation to the Companion's vault tree, even if current readers
correctly target exact canonical filenames.

## 6. Recommendation

Do not treat `.lina/index/` as both a published Companion namespace and the
Producer's working directory. A future, separately approved change should
provide a distinct Producer-private workspace, for example `.lina/work/`, or
an equivalent device-local location outside the synchronized vault. Checkpoints,
temporary candidates, and rollback backups should live there. Only validated
canonical artifacts should be promoted into `.lina/index/`.

Until that architectural separation exists, provide an explicit sync-exclusion
policy for all known work artifacts, not only `*.tmp`. At minimum it must cover
checkpoint files, checkpoint backups, publication candidates, publication
backups, and the synchronizer's own temporary naming convention. This is an
operational mitigation; it cannot make a shared work/publication directory a
correct ownership boundary.

No changes are proposed here to the Vector Contract, Producer State schema,
Ownership schema, Exclusion Policy schema, or the 0.3.0 version.

## 7. Stop-condition answer

**No. Files temporary to embedding generation must not exist inside Lina's
synchronized tree.** Canonical, validated publication artifacts belong in
`.lina/index/`; Producer checkpoints, backups, staging files, and Syncthing's
temporary receive files do not.
