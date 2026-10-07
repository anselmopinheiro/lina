# M6 — Cutover controlado do runtime para geração publicada

O selector foi integrado exclusivamente em `LinaPlugin.getRuntimeEmbeddingIndex()`. A flag `companionPublishedGenerationCutoverEnabled` é local por dispositivo e tem default efetivo `false`.

Com a flag desligada, o runtime mantém o índice legado. Com a flag ligada, o selector lê a geração apontada por `CURRENT`, aplica Reader v5, contrato semântico, provenance da fonte canónica, ownership e `evaluatePublishedGenerationForConsumer`. Só uma decisão integralmente elegível seleciona `PUBLISHED`.

Indisponibilidade do artefacto publicado produz `LEGACY_FALLBACK` observável. Integridade, incompatibilidade semântica e provenance `MISMATCH` produzem `PUBLISHED_BLOCKED`, sem fallback automático. A cache publicada é read-only e tem identidade por geração, contrato e provenance; cada chamada relê a geração antes de reutilizar a cache.

O cutover é device-scoped e reversível ao desligar a flag. Não altera SQLite, ownership, `CURRENT`, gerações, embeddings ou chama providers.

## Validação Runtime
- **Producer Desktop Runtime:** `PASS` (validado no vault `zettel` com `generation-000015`, 2303 registos, `providerCalls = 0`, `reembedding = 0`).
- **Companion Desktop Runtime:** `PASS`.
- **Android Companion Runtime:** `PASS` (`OFF → LEGACY`, `ON → PUBLISHED`, `OFF → LEGACY`; pesquisa semântica e híbrida aprovadas; sem crash, provider calls ou reembedding).
- **iOS Runtime:** `OUT_OF_SCOPE`.

```text
M6_RUNTIME_VALIDATED_PLATFORMS = Desktop Producer + Desktop Companion + Android Companion
M6 = CLOSED_WITH_NON_BLOCKING_DEBT
```

Findings residuais: `G5` (`localeCompare` no Builder), `G7` (deduplicação/GC de
generations) e a persistência física de `deviceSettingsById` em `data.json` são
`NON_BLOCKING_DEBT`. iOS é `OUT_OF_SCOPE`. O painel **Testes M6** permanece uma
UI técnica temporária de diagnóstico.

Artefactos de evidência:
- `docs/architecture/evidence/M6-CUTOVER-IMPLEMENTATION-001.json`
- `docs/architecture/evidence/M6-RUNTIME-DESKTOP-VALIDATION-001.json`
- `docs/architecture/evidence/M6-RUNTIME-COMPANION-DESKTOP-VALIDATION-001.json` (pré-condição Companion não disponível)
- `docs/architecture/evidence/M6-RUNTIME-ANDROID-VALIDATION-001.json`
