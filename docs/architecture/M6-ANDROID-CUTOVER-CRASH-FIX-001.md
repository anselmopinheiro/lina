# M6 Android Cutover Crash Fix

## Incident state

The reported Android runtime sequence was `OFF → LEGACY`, followed by a crash
when the M6 cutover switch was enabled for a format-v5 generation with 2,303
records. The subsequent real-device proof confirmed `OFF → LEGACY`, `ON →
PUBLISHED`, `OFF → LEGACY`, semantic and hybrid search, with no crash.

## Root cause and fix

The published selector loaded the legacy runtime index before it read the
published generation. For 2,303 × 1,024 float32 vectors, one vector buffer is
about 9,433,088 bytes (9.0 MiB); retaining legacy and published materializations
could double that vector memory before records and intermediate buffers. Reader,
crypto, filesystem, and published-cache failures could also escape the selector.

The ON path now reads the published generation first and does not materialize
the legacy runtime cache merely to evaluate M6. It uses the already-effective
vector contract and a lightweight canonical manifest read for eligibility.
Published reader, WebCrypto, filesystem, provenance, and materialization errors
are caught and exposed as `PUBLISHED_BLOCKED`; they do not invoke a provider,
generate embeddings, mutate ownership, `CURRENT`, generations, SQLite, or the
cutover flag. OFF still selects legacy normally.

The Settings panel never calls the selector: toggling only persists the active
device entry and invalidates the runtime cache. The M6 panel refreshes only
light diagnostics. This prevents toggle/panel refresh from eagerly loading the
published vector buffer.

## Runtime result

`ANDROID_CRASH_FIX = PASS`. The real Android Companion proof confirmed source
`PUBLISHED`, eligible consumer and matching source/producer provenance with
`fallbackActive = false`; semantic and hybrid searches passed with zero provider
calls and zero reembedding. The toggle returned safely to `LEGACY` on OFF.
