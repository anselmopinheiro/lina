# ANDROID-SEMANTIC-CAPABILITY-DIVERGENCE-AUDIT-001

Evidência: STATIC (leitura de código) + UNIT/INTEGRATION_TEST. Nada foi executado em Android real (NÃO_EXECUTADO).

## ROOT CAUSE
No Companion Android o `embeddings.jsonl` (≈45 MB) excede o teto de leitura mobile (≈11,20 MB, `evaluateEmbeddingBridgeRead`).
O runtime de pesquisa só consegue usar a cópia binária, mas **dois caminhos de estado ignoram a cópia binária** e concluem "sem vetores":

1. `readEmbeddingStatus()` (`src/index/embeddingGenerator.ts`) devolvia, no ramo `resource-limit-exceeded`,
   `validForSearchCount: 0` fixo. Esse status alimenta o resumo de trabalho → `EmbeddingLifecycleSnapshot`
   (`adaptCurrentStateToLifecycleSnapshot`) → `read.semanticAvailable = canonicalExists && validForSearchCount > 0 && compatible` = **false**
   → `primary = INDEX_ONLY` → `evaluateSemanticCapabilityFromSnapshot` cai em "Embeddings não encontrados." (`semanticCapability.ts:137`).
   É esta fonte que a Sidebar ("Pesquisa semântica indisponível neste dispositivo", "Embeddings: Não gerado") e o painel de diagnóstico consomem.
2. `getSemanticSearchAvailability()` (`src/search/hybridSearch.ts`), chamado por `main.getDeviceDiagnostics()` e por `linaSearchView` **sem `currentChunks`**,
   sondava a cópia binária com `getOrLoad([])`. `binaryMetadataMatchesCurrentChunks()` exige `records.length === chunks.length`, logo uma cópia válida
   era rejeitada como `binary-invalid` → `no-safe-source` (JSONL acima do teto) → `semanticAvailability.available = false` → "Apenas Texto".

## FIRST DIVERGENCE POINT
`readEmbeddingStatus()` ramo `resource-limit-exceeded` (validForSearchCount = 0 incondicional), seguido do probe com lista de chunks vazia.

## DIAGNOSTIC SOURCE OF TRUTH (cartões de artefactos "Válido")
`readDeviceDiagnostics` lê diretamente `manifest.json` e `embeddings.binary.manifest.json` e valida só proveniência/ownership
(`evaluateArtifactProvenance`). Não carrega vetores nem consulta o resumo de trabalho.

## RUNTIME SOURCE OF TRUTH
Capability/Sidebar: `EmbeddingLifecycleSnapshot` (derivado de `readEmbeddingStatus` + `readEmbeddingUpdatePreview`) e `getSemanticSearchAvailability`.
Pesquisa real: `LinaPlugin.getRuntimeEmbeddingIndex(chunks)` → `RuntimeEmbeddingIndexCache.getOrLoad(chunks)` (binário com chunks reais) — este caminho **não** estava avariado; apenas o gating/estado.

## Tabela de fontes
| Aspeto | Diagnóstico | Semantic capability / runtime |
|---|---|---|
| manifest path | `.lina/index/manifest.json` | idem |
| binary manifest | `.lina/index/embeddings.binary.manifest.json` (lido) | só via `getOrLoad` (probe com `[]` → rejeitado) |
| vectors path | não lido | `embeddings.vectors.f32` (nomes atuais; não há `vectors.bin` no caminho legacy) |
| publicationId | comparado em proveniência | comparado em `getOrLoad`; **ignorado** em `readEmbeddingStatus` |
| provider/model/dim | do manifest | do manifest (status) |
| record count | `recordCount` do binário | status: 0 (bug) |
| ownership / provenance | avaliados | não entram na capability |
| device role | Companion | Companion (`write.applicable=false`) — **não** é a causa |
| source selection | n/a | `getRuntimeEmbeddingIndex`: LEGACY quando cutover desligado; PUBLISHED quando ligado — independente deste bug |
| cache/session | n/a | `getSemanticSearchAvailability` cria cache descartável por chamada; resumo do controller é lazy |

## Outras perguntas do prompt
- Nomes de ficheiro: o runtime usa `embeddings.binary.manifest.json`/`embeddings.vectors.f32`/`embeddings.meta.jsonl` (ok). Sem referência a `vectors.bin` fora do reader publicado (generations).
- Papel: nenhuma condição `!isProducer ⇒ indisponível` na leitura; o Companion só perde as ações de escrita (correto).
- Sessão/sync: "Estado detalhado ainda não calculado" é o resumo lazy do controller; é recalculado por `refresh()`/invalidações (`markDirty`, `invalidateRuntimeEmbeddingIndex`). Não há handler dedicado para chegada de ficheiros por sync a meio da sessão (já registado como follow-up da LINA-A2). Não é a causa principal aqui, mas explica por que o estado só se corrige após refresh/reinício.
- Build DEV/TEST: sem divergência de core encontrada neste fluxo.
- Legacy vs published: com cutover desligado o runtime usa o caminho legacy (JSONL/3E + cópia binária); diagnóstico e capability não dependem de `CURRENT`.

## RECOMMENDED FIX / RISK
Ver `ANDROID-SEMANTIC-CAPABILITY-DIVERGENCE-IMPL-001.md`. Risco baixo: só altera o ramo já limitado por recursos; Desktop/Producer continuam a ler JSONL.
