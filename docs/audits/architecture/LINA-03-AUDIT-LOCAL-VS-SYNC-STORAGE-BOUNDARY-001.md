# LINA-03 — Audit of the local versus synchronized storage boundary

**Audit type:** architectural analysis only  
**Version in scope:** Lina 0.3.0  
**Date:** 2026-09-27  
**Scope decision:** no production code, schema, migration, or commit was made.

## 1. Current state

The audit was performed on `master`. The working tree already contains the
uncommitted implementation and documentation from
`LINA-03-IMPLEMENT-SYNC-ARTIFACT-BOUNDARY-001`; those changes were inspected
but not modified by this audit.

The implementation has established a logical split:

```text
.lina/index/                    canonical Companion-facing artifacts
.lina/producer/checkpoints/     resumable embedding work
.lina/producer/staging/         text and embedding candidates
.lina/producer/backups/         transactional rollback copies
```

This is an improvement over putting all temporary embedding work directly in
`.lina/index/`. It is not a physical local-versus-synchronized boundary:
`.lina/producer/` remains inside the vault and is synchronized by Syncthing
unless every participating user configures an external ignore rule.

There is also an incomplete application of the logical split. Binary embedding
publication still defines `*.publish.tmp` and `*.publish.backup` paths under
`.lina/index/` in `src/index/embeddingBinaryStorage.ts`. Thus the published
directory is not yet guaranteed to contain only final artifacts. In addition,
`src/device/deviceDiagnostics.ts` still checks the old
`.lina/index/embeddings.checkpoint.meta.json` path rather than the Producer
checkpoint path.

## 2. Inventory and classification

| Data | Current location | User / owner | Producer | Companion | Should synchronize | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| Text index (`notes.json`, `chunks.jsonl`, `manifest.json`) | `.lina/index/` | Active Producer publishes | Writes | Exact-file reader | Yes | Shared contract / published artifact |
| Canonical embeddings (`embeddings.jsonl`) | `.lina/index/` | Active Producer publishes | Writes | Reads | Yes | Shared contract / published artifact |
| Derived binary trio (`embeddings.binary.manifest.json`, `embeddings.meta.jsonl`, `embeddings.vectors.f32`) | `.lina/index/` | Active Producer publishes | Writes | Reads when valid | Yes | Shared published artifact |
| Vector Contract | `manifest.json` | Active Producer defines at publication | Writes | Inherits read-only | Yes | Shared contract |
| Exclusion policy | `.lina/exclusions.json` | Active Producer | Writes | Reads / defensively applies | Yes | Shared contract |
| Ownership + history | `.lina/ownership.json`, `.lina/ownership-history/` | Coordinated vault authority | Writes when authorized | Reads | Yes | Shared operational state |
| Producer state | `.lina/producer-state.json` | Active Producer telemetry | Writes | Reads diagnostics/freshness | Yes | Shared operational state |
| Device role/name state | `.lina/devices/<deviceId>.json` | Each device writes only its own file | Reads/writes own | Reads own / diagnostics | Yes, with single-writer rule | Device-scoped state stored in vault |
| Producer configuration | plugin `data.json`, `deviceSettingsById` | Local installation | Uses | Local endpoint settings only | No | Device-local state |
| Device UUID | Obsidian `app.loadLocalStorage` | Local application | Uses | Uses | No | Device-local state |
| API credentials | `app.secretStorage` / OS keychain | Local OS account | Uses | Uses | Never | Secrets |
| Embedding checkpoints | `.lina/producer/checkpoints/` | Active Producer | Writes/recovers | Does not read | No | Producer-private data |
| Text/embedding staging | `.lina/producer/staging/` | Active Producer transaction | Writes | Does not read | No | Producer-private data |
| Text/embedding backups | `.lina/producer/backups/` | Active Producer transaction | Writes/restores | Does not read | No | Producer-private data |
| Binary staging/backups | currently `.lina/index/` | Active Producer transaction | Writes/restores | Does not read | No | Producer-private data, currently misplaced |

## 3. Problems

1. **The privacy guarantee relies on external configuration.** The documented
   Syncthing rule `/.lina/producer/` is necessary, but it is not installed or
   enforced by Lina. A new vault, a different sync provider, a missed rule, or
   an incorrectly scoped rule exposes operational files again.
2. **The current vault tree is mixed by definition.** A folder may be
   semantically private while residing in a synchronizer's root. This makes
   safety depend on convention instead of placement.
3. **Binary publication reopens the original defect.** Its candidates and
   backups remain under the published tree and can be observed by Syncthing.
4. **Diagnostics are stale.** The checkpoint metadata probe targets the
   pre-boundary path, so it can report an incorrect state after the new path is
   used.
5. **Existing vault residues remain.** The previous implementation deliberately
   does not auto-delete old index-local checkpoints/backups. This avoids unsafe
   data loss, but external synchronization remains able to see them until the
   user resolves them.

## 4. Alternatives

### Option A — Mixed vault `.lina/` with sync filters

Keep canonical artifacts in `.lina/index/` and Producer work in
`.lina/producer/`, relying on Syncthing ignores.

**Strengths:** small change; visible/recoverable workspace; works with the
existing vault adapter and current transactional paths.

**Risks:** no provider-independent enforcement; users must maintain rules on
all devices; Git, cloud drives, Obsidian Sync, and manual copies require their
own exclusions; accidental Producer-work propagation remains possible. It is
an operational convention, not a security or storage boundary.

### Option B — Public vault contracts plus AppData/private runtime workspace

Keep only synchronized contracts and final artifacts in `Vault/.lina/`. Store
checkpoints, staging, backups, caches, local provider configuration, and other
operational state in a device-local AppData/runtime location outside the vault.
Secrets remain in `app.secretStorage`.

**Strengths:** physically prevents normal vault synchronization from carrying
operational files; removes per-provider ignore setup; gives Companion a clear
read-only artifact surface; simplifies support and Producer/Companion mental
models.

**Trade-offs:** requires an explicit, mobile-compatible local-storage port;
checkpoint recovery is local to the original Producer; a Producer transfer
cannot inherit incomplete work and must safely restart/replan. That is
appropriate because ownership transfer already fences the prior Producer and
incomplete vectors must never become a shared contract.

### Option C — Hybrid, recommended transition

Adopt Option B for all mutable work data while retaining the present canonical
vault surface. Treat the published directory as a strict allow-list, rather
than treating `.lina/` as a namespace with subdirectory exceptions:

```text
Vault/.lina/
  index/              final, validated text/vector/binary artifacts only
  exclusions.json     shared policy
  ownership*.json     shared authority/audit
  producer-state.json shared observational telemetry
  devices/            device-scoped, single-writer state

Device-local Lina runtime/AppData/
  checkpoints/
  staging/
  backups/
  derived caches/
  local operational diagnostics/

OS SecretStorage/
  credentials
```

The physical local runtime needs an implementation audit for supported Obsidian
desktop and mobile APIs before adoption. It must not use the vault config
directory as a disguised local store, since that directory may itself be
synchronized.

## 5. Recommendation

Choose **Option C**. In the short term, complete the logical boundary by moving
binary staging/backups out of `.lina/index/` and correcting stale diagnostics;
continue documenting sync ignores as a mitigation. In the next architecture
phase, introduce an injected device-local runtime-storage port and move all
Producer work there. Do not change Vector Contract, Producer State, Ownership,
Exclusion Policy, or settings schemas as part of this decision.

## 6. Producer, Companion, migration, and user impact

**Producer:** retains local crash recovery and rollback. After physical
separation, a device replacement or ownership transfer abandons unfinished
work rather than synchronizing it; the new active Producer validates published
state and generates only what is required. This is safer than sharing partial
state across an ownership boundary.

**Companion:** consumes an unambiguous immutable/public surface. It does not
need a new protocol, and its exact-path readers already align with the proposed
allow-list.

**Migration:** no automatic deletion should occur. A future migration should
first preserve legacy checkpoint/backup files, classify them as recoverable
local work, and offer an explicit user-confirmed cleanup only after the local
runtime store is usable. Existing canonical `.lina/index/` artifacts must stay
in place for backward compatibility.

**User impact:** Option A requires setting and maintaining exclusions. Option C
removes that routine configuration for Producer work, prevents Syncthing
temporary artifacts from appearing for private files, and makes failure
recovery local to the device that performed the work.

## 7. Stop-condition answer

**The synchronized vault should carry only final published index/binary
artifacts, shared Vector Contract and exclusion policy, ownership/audit and
producer-state telemetry, and single-writer device state. Checkpoints,
staging, backups, derived local caches, local plugin settings, device identity,
and all credentials should remain exclusively on the device; credentials belong
only in OS-backed SecretStorage.**
