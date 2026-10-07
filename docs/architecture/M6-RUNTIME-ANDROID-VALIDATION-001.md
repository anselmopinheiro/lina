# M6 — Validação Runtime Android

## Evidência

Classificação: `OBSIDIAN_RUNTIME`.

No Obsidian Android real, num dispositivo `companion`, com `CURRENT =
generation-000015`, a sequência foi validada:

```text
OFF -> LEGACY
ON  -> PUBLISHED
OFF -> LEGACY
```

Com o cutover ON, `consumerEligibility = eligible`, `sourceProvenance = MATCH`,
`producerProvenance = MATCH` e `fallbackActive = false`. Pesquisa semântica e
híbrida passaram. Não houve chamadas a provider, reembedding ou crash.

```text
ANDROID_RUNTIME = PASS
CUTOVER_ANDROID = READY_FOR_DEVICE_SCOPED_ENABLEMENT
```

iOS permanece fora de âmbito desta fase.
