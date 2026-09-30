# LINA-14F4-B4.1-IMPLEMENT-UI-ACTION-DERIVATION-001

## Problema
A UI de estado de embeddings decidia as ações de escrita com heurísticas próprias (`mode`, `updateAvailable`, `isReady`), uma segunda camada de decisão paralela ao Write Path.

## Alterações (`src/search/embeddingStatusViewModel.ts`)
- `buildActions` passa a chamar `deriveEmbeddingWritePathDecision(snapshot)` e apresenta a ação resultante (`generate` / `update` / `rebuild`).
- `mapDecisionToUiAction`: mapeamento de apresentação; `retry` mostra o botão do trabalho repetido (`initial-build`→gerar, `full-rebuild`→reconstruir, `incremental`/`publish-only`→atualizar), sem reconstruir estado.
- `disabled = !decision.canExecute`; `requiresFullRebuildConfirmation` só para `rebuild`.
- Mantidos: ramo de operação ativa (refresh + cancelar), `indexReady`, cabeçalhos, textos, tons, contagens e orientação.

## Regras removidas
`mode === "full-rebuild"` / `primary === "INCOMPATIBLE"` (ação), `isReady`, `mode !== "incremental"`, `updateRequired` como decisor, fallback a `summary.updatePlan.mode`, verificação paralela de `write.applicable`.

## Regra legada retida (equivalência)
Sem resumo calculado e com `embeddingsReady`, não se oferece `generate` (o snapshot sintético dá `INDEX_ONLY`). Coberta por teste; candidata a remoção quando esta via sintética desaparecer.

## Testes
`tests/search/embeddingStatusActionDerivation.test.ts` (10): READY, UPDATE_AVAILABLE, INDEX_ONLY, INCOMPATIBLE, ERROR, Companion, Standby, INDETERMINATE, guarda legada e invariante "a ação da UI nunca contradiz a decisão canónica". Suites existentes inalteradas e verdes.

## Impacto arquitetural
A UI passa a apresentar a decisão do Write Path; uma alteração de política deixa de exigir mudanças na UI. Sem alterações a textos, schemas, VectorContract ou formato dos embeddings.

## Seguimento (fora do âmbito)
O botão "cancelar" ainda não usa `decision.process.cancellable` (em `persisting` o manager devolve `non-cancellable` e o comando informa); alinhar é UX, fica para fase própria.
