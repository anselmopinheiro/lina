# M6 Tests Sidebar Panel

## Contract

`M6TestsPanelView` is a separate technical view with stable view type
`lina-m6-tests-panel`. The command **Abrir painel Testes M6** opens or reveals
the existing leaf, preventing duplicate panels.

## Scope

The view displays the device role and identity, active producer ownership,
`CURRENT`, published generation manifest fields, runtime source and fallback,
consumer eligibility, provenance, and runtime cache identity. It also exposes
the existing per-device cutover switch and cache invalidation action.

The Settings controls for M6 were removed. The switch is still stored in
`settings.deviceSettingsById[deviceId].companionPublishedGenerationCutoverEnabled`.
Its effective scope is the active `deviceId`; a synchronized plugin data file
may carry another device's inert entry.

## Safety and mobile

Refresh is read-only. Cache invalidation delegates only to the canonical
runtime cache invalidator. The panel does not create embeddings, publish,
repair, change ownership, modify `CURRENT`, access SQLite, or delete
generations. Its single-column CSS wraps long values and uses ordinary buttons,
so it does not depend on desktop-only APIs or hover interactions.
