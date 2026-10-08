# Chunk, embedding and binary coherence audit

## Result

**ROOT CAUSE:** A — a text/chunk publication occurred after the canonical
embedding publication without a new embedding projection. The Android reader
correctly rejected the resulting mismatch.

**FIRST DIVERGENCE POINT:** `saveTextIndex()` published the new
`chunks.jsonl` and a new text `manifest.json` generation on 2026-10-08, while
preserving the older `embeddings` manifest section from 2026-10-07. The binary
copy remains a valid derivative of that older embedding publication.

**DIVERGENT CHUNK:**

| Field | Current chunk | Canonical embedding / binary metadata |
| --- | --- | --- |
| `chunkId` | `90_Desenvolvimento/PLUGIN_LINA/Lina novo caminho.md::0` | same |
| `textHash` | `5d5c5ece` | `658b5db0` |
| `embeddingInputHash` | not stored on chunk | `6b9ae07c` |
| Note mtime | 2026-10-08T07:31:57Z | embedding publication predates it |

The current physical snapshot has equal line counts, but it is still
semantically incoherent because the record identity includes `textHash` and
`embeddingInputHash`. The earlier Android trace additionally observed a
transient 2563/2564 count mismatch. That historical state is no longer present
on disk, so its exact removed/filtered chunk cannot be identified from the
current snapshot; the hash mismatch above is directly reproducible evidence of
the same failure class.

## Physical artefact audit

Evidence level: **STATIC** plus direct read-only filesystem inspection on
2026-10-08. Counts are newline-record counts.

| Vault / artefact | Count | publicationId / generation | Timestamp |
| --- | ---: | --- | --- |
| `zettel` chunks / embeddings / metadata / binary | 2303 / 2303 / 2303 / 2303 | `emb-mux84uhk-lcotea5p8g` | chunks 2026-10-05; embeddings 2026-10-06; binary 2026-10-07 |
| `anselmo` chunks | 2564 | text `gen-muz7xlk2-7yfwefmt` | 2026-10-08T07:32:01Z |
| `anselmo` embeddings | 2564 | `emb-muykaj07-i6yxwpjw49` | 2026-10-07T20:30:13Z |
| `anselmo` metadata / binary manifest | 2564 / 2564 | `derived-emb-muykaj07-i6yxwpjw49` | 2026-10-07T20:48:41Z |
| `anselmo` text manifest | 2564 chunks, 1221 notes | preserves `emb-muykaj07-i6yxwpjw49` | 2026-10-08T07:32:01Z |

The manifest's `sourceTotalChunks` remains 2564, so count alone cannot prove
coherence. The changed content hash proves that it is stale.

## Writer and publication audit

`saveTextIndex()` atomically stages and promotes `notes.json`, `chunks.jsonl`,
then `manifest.json` (the text logical commit). It deliberately preserves the
existing embeddings section. Therefore it **can** publish chunks without
republishing embeddings in the same cycle.

`publishCanonicalEmbeddings()` atomically stages the canonical JSONL and its
manifest, with the embedding manifest as its commit point. It does not publish
the text snapshot as part of the same generation.

`BinaryEmbeddingCopyController` only builds after validating a canonical
embedding pair and records `sourcePublicationId`; `BinaryEmbeddingPublisher`
stages vectors, metadata and binary manifest. The binary was valid for the
older embedding publication, not stale relative to that publication.

There is no single generation/CURRENT marker spanning text chunks, canonical
embeddings and binary derivative in `.lina/index`. These files can synchronize
at different times. The runtime's `binaryMetadataMatchesCurrentChunks()` is the
correct final gate: it blocks mixed or stale snapshots rather than accepting a
count match. It does not retry or automatically converge; a Companion is
read-only and must wait for coherent producer artefacts to synchronize.

## Classification

| Question | Finding |
| --- | --- |
| Canonical source count | Published canonical JSONL: 2564. SQLite producer count: **NÃO EXECUTADO**; no producer database inspection was performed. |
| Binary count | 2564 |
| Runtime chunk count | Historical Android trace: 2563; current on-disk `chunks.jsonl`: 2564 |
| Reembedding required? | **YES for changed content.** The old vector has a different `embeddingInputHash`; it cannot be reused safely. |
| Publication atomic across all artefacts? | **NO.** Text, canonical embeddings and binary each have separate atomic protocols. |
| Can sync observe mixed snapshots? | **YES.** There is no cross-family generation gate; runtime blocks it. |
| Did the reader mask mismatch? | **NO.** It correctly blocked semantic search and used textual fallback. |

The cutover value `false` and legacy source selection in the trace are expected
for the reported device configuration and were not changed. The trace's
`resourceProfile=default` at `readEmbeddingStatus` reflects omitted caller
options; that function resolves the runtime capability profile internally. It
is a trace-label inconsistency, not evidence that mobile limits were bypassed.

## Recommended follow-up

Do not relax `chunkMatch`, use `min(count)`, or regenerate indiscriminately.
The producer must generate a new canonical embedding publication for changed
chunks (only the changed chunk needs a provider call), then derive/publish the
binary from that new publication and allow the complete artefact set to sync.

A later implementation should add a coherent cross-family publication or
explicit convergence protocol, with tests for removal, edit/hash mismatch,
mixed-sync block, post-convergence recovery, zero provider calls for pure
removal/reprojection, Companion read-only operation, and Desktop regression.
That work is intentionally outside this audit.

## Runtime evidence

| Environment | Result |
| --- | --- |
| Android Companion | **FAIL/BLOCKED** in supplied runtime trace; reader safety is PASS. |
| Desktop regression | **NÃO EXECUTADO** for this audit. |
| Unit/integration implementation tests | **NÃO EXECUTADO**; this task made no behavioral change. |
