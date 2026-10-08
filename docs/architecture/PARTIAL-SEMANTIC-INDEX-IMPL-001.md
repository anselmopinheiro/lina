# Partial semantic index implementation

## Classifier and safety contract

`classifyBinaryRecords()` is the single pure classifier for a loaded binary
runtime index and current chunks. It validates `vectorOrdinal → metadata →
chunkId → path/index → textHash → embeddingInputHash`; ambiguous current IDs or
vector mappings are unavailable. Digest, manifest, publication, provider,
model and dimension validation remains in the existing binary reader/runtime
source checks before classification.

It reports complete, partial or unavailable with total, valid, stale, missing
and orphan counts. Orphans do not make coverage partial when every current
chunk has a valid vector; they remain reported. Zero valid records or ambiguous
mapping is unavailable.

## Runtime behaviour

`compactBinaryRuntimeIndex()` copies only valid vectors and metadata into a
compact runtime index. Searches retain the existing scoring algorithm and never
depend on current-chunk position. Partial indexes therefore search valid records
and hybrid search remains semantic-plus-textual; unavailable remains
textual-only.

The runtime diagnostic retains availability and real valid/stale/missing/orphan
counts. TEST trace records `semantic-index-classification` and
`runtime-index:partial-ready` without per-record logging.

No persisted format, manifest schema, SQLite schema, ownership, CURRENT,
legacy or M6 contract changed. The Companion remains read-only and has no
provider calls. The existing 32-bit `hashContent` remains known debt.

## Validation

Production coverage exercises stale, missing, orphan, rename/rechunk,
ambiguous mapping, global identity blockers, complete coverage and compact
semantic search. Android and Desktop interactive runtime validation remain
**NÃO EXECUTADO**.
