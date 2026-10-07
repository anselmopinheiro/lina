# M6 Android Test Controls

## Objective

This document records the diagnostic-only Settings controls introduced for M6
published-generation cutover testing on Android. They make it possible to turn
the existing consumer selector on and inspect its decision without adding a
producer capability to a Companion device.

## Scope

The controls live in the dedicated **Testes M6** sidebar panel. They were
removed from Settings so the test surface has one location on desktop and
mobile.

- **Use published generation on this device** persists
  `companionPublishedGenerationCutoverEnabled` for the active `deviceId`.
- **Update status** reads the current diagnostics without changing vault
  content, ownership, `CURRENT`, the published generation, or SQLite state.
- **Invalidate search cache** calls the existing runtime cache invalidation API
  with the `manual` reason and then refreshes Settings. It does not create,
  regenerate, publish, repair, or delete embeddings.

The panel reports the role and device identity, active producer and epoch,
`CURRENT`, selected source, published generation, fallback state and reason,
consumer eligibility, structural and semantic result, source and producer
provenance, and the runtime cache generation/storage format when a published
generation is selected.

## Persistence boundary

The switch is stored in the existing
`settings.deviceSettingsById[deviceId]` entry through the standard Settings
save path. It therefore has effect only when that exact `deviceId` is active.
The plugin data file may itself be synchronized by an Obsidian vault; a copied
entry remains inert on a different device because the selector reads only the
active device entry. The UI intentionally describes this as associated with the
current `deviceId`, rather than claiming that the data file cannot synchronize.

## Safety and mobile boundary

The panel is consumer diagnostics. It does not grant Producer ownership,
write `CURRENT`, change published content, make provider calls, or alter the
canonical producer lifecycle. They use the same Settings definitions on mobile
and desktop and require no Android-only code path.

## Validation

The settings runtime adapter tests verify that enabling the switch changes only
the active device entry, preserves other device entries, saves through the
normal snapshot path, and triggers no effects. Composition tests retain a
single bound definition for the switch and a read-only diagnostic renderer.
