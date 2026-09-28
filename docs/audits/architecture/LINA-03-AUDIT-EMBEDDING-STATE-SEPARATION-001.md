# LINA-03 — Audit of embedding state separation

**Audit type:** architectural analysis only  
**Version:** Lina 0.3.0  
**Date:** 2026-09-27

## Current state

The repository is clean on `master` at `95821e2 fix: isolate producer operational artifacts`. Lina 0.3.0 separates local intent, the published contract/facts, recoverable Producer work, and shared observational telemetry.

## Classification matrix

| Information | Current location | Writer | Reader | Synchronize | Source of truth |
| --- | --- | --- | --- | --- | --- |
| Provider, model, Base URL, batch size, timeout, enabled preference | local plugin `data.json`, scoped by `deviceSettingsById` | local settings UI | local Producer runtime | No | Local Producer configuration |
| Actual provider/model/dimensions/metric/input version/prefix mode | `.lina/index/manifest.json` `VectorContractV1` | Active Producer after publication | Producer and Companion | Yes | Published Vector Contract |
| Published enabled flag, count, publication ID, source generation | `.lina/index/manifest.json` | Active Producer | search, Companion, diagnostics | Yes | Published manifest |
| Embedding vectors and derived binary trio | canonical `.lina/index/` files | Active Producer | Producer and Companion | Yes | Artifacts validated against manifest |
| Rebuild mode, reasons, reusable/missing records | `embeddingUpdatePlan` / `embeddingState` calculation | pure planner | Producer status/UI | No | Derived, not persisted authority |
| Checkpoint records and metadata | `.lina/producer/checkpoints/` | Active Producer | Active Producer and local diagnostics | No | Recoverable private operation state |
| Staging and rollback backups | `.lina/producer/staging/`, `.lina/producer/backups/` | Producer transaction | recovery only | No | Transient private operation state |
| Last successful publications and identifiers | `.lina/producer-state.json` | Active Producer | diagnostics/freshness UI | Yes | Observational telemetry only |

## Duplications and boundaries

Provider/model/dimensions occur in records, the published manifest, binary manifest, and checkpoint metadata. This is validation/provenance repetition: the manifest Vector Contract is authoritative for published search; binary artifacts are validated against it; checkpoints are private and reusable only when compatible.

Publication and contract IDs repeat in the published manifest, binary manifest, and producer state. The manifest commits the published generation; producer state reports it and never authorizes publication. `embeddingsEnabled` is both a local intent and a published fact, but the local preference cannot silently mutate the contract and a Companion has no local fallback.

## Required answers

1. The local Active Producer configuration selects the target model for the next generation. After publication, the manifest Vector Contract is authoritative for the model actually used by published vectors.
2. The manifest plus exact canonical files is authoritative for current published artifact state. A missing or invalid JSONL file with a manifest claim fails safe.
3. `calculateEmbeddingUpdatePlan` and `calculateEmbeddingState` decide whether rebuild is required from chunks, canonical records, published identity, and compatible checkpoint records. The result is derived rather than persisted state.
4. Companion requires published artifact/contract state and compatibility only. Producer state may supply freshness diagnostics but must not gate or redefine the contract.

## Scenario validation

For model A to model B, the local setting changes intent; the planner detects `model-changed` and forces a full rebuild. The old published contract remains authoritative until successful atomic publication of the new one.

If a manifest remains while embeddings disappear, readers detect the incomplete pair and semantic search fails safe or uses its allowed text fallback. Neither a checkpoint nor a local setting repairs the published claim.

When a Producer is offline, valid synchronized artifacts remain searchable. Producer-state timestamps can become stale and inform diagnostics, but do not invalidate a coherent publication.

## Option assessment and recommendation

**Option A, keep the distributed design, is approved.** Every persisted location has a distinct authority and rebuild is correctly a pure derived calculation.

**Option B, `.lina/embedding-state.json`, is rejected.** It would duplicate published manifest facts, private checkpoints, planner output, or producer telemetry and create reconciliation/authority ambiguity without a new consumer requirement.

Do not create `embedding-state.json`. Future state must fit one of: local intent, published contract/artifact fact, private operation state, or observational telemetry. Any later migration must preserve the manifest as contract authority and never promote private checkpoints to synchronized authority.

## Documentation impact

README, manual, and roadmap are directionally correct. A future documentation-only clarification could name planner and runtime status as derived views, not a fifth persisted authority. This audit changed no production code, schemas, migrations, or documentation outside this report.

## Stop-condition conclusion

**The embedding state is in the correct locations and has no duplicated authority: local configuration chooses the next Producer generation, the published manifest/Vector Contract defines published vectors, the planner derives rebuild need, checkpoints hold only private resumable work, and producer-state is observational.**
