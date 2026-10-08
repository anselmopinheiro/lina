# Android Runtime Trace — TEST build

## Design

`RuntimeTraceService` is a single in-memory ring buffer of 300 events. It is
compiled as the active service only in the TEST profile; the DEV profile
resolves it to a no-op module. There is no automatic persistence to settings,
the vault, `.lina`, or `data.json`.

Each event has an ISO timestamp, category, event name, status, optional safe
metadata, and an optional sanitised error. Metadata accepts only scalar values,
blocks keys associated with credentials, queries, note content, and embeddings,
and error messages redact credential-like fragments.

## Instrumented execution points

The trace records embedding status, semantic capability, runtime-index source
selection/cache/binary probe, binary storage reads and validation, semantic
modal execution, and hybrid-search fallback/results. Instrumentation observes
existing paths and rethrows original errors; it does not select a source,
alter fallback, change ownership, CURRENT, SQLite, publication, or cache rules.

## TEST UI and procedure

The existing **Testes M6** panel shows the event count and last event in its
Runtime trace section. **Atualizar**, **Limpar trace**, and **Copiar log** are
available only there. Export includes Lina version, TEST build, device role,
resource profile, export timestamp, and safe event lines.

For Android: install `npm run build:test`, open Testes M6, clear the trace, run
semantic and hybrid searches, then copy the log. The first unexpected event is
the runtime divergence to investigate in a separate task. The same procedure
can be used on TEST Desktop to check that normal behaviour is unaffected.

## Coverage

Unit tests cover append/order, the bounded ring buffer, clear, safe export and
metadata sanitisation, no automatic persistence, and TEST-only build wiring.
Bundle validation verifies that DEV omits TEST UI labels while TEST retains
them.
