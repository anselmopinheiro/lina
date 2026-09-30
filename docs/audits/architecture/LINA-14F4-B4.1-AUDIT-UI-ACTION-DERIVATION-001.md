# LINA-14F4-B4.1-AUDIT-UI-ACTION-DERIVATION-001

**Fase:** LINA-14F.4-B4.1 — derivação de ações da UI a partir da decisão canónica
**Estado Git:** `master` (a prompt indica `main`; o branch oficial do repositório é `master`, conforme AGENTS.md).

## 1. Função atual
`buildActions()` em `src/search/embeddingStatusViewModel.ts`, consumida por `buildEmbeddingStatusViewModel()` (usado por `linaSearchView.ts` em resumo/detalhe de diagnóstico).

## 2. Flags e regras usadas (antes)
| Regra paralela | Origem |
|---|---|
| `mode === "full-rebuild" \|\| primary === "INCOMPATIBLE"` ⇒ rebuild | `write.work.mode` / `updatePlan.mode` (fallback ao resumo) |
| `isReady = read.semanticAvailable \|\| primary === "READY" \|\| (!summary && embeddingsReady)` | reconstrução de estado |
| `!isReady && mode !== "incremental"` ⇒ generate | heurística |
| `write.updateRequired` ⇒ update | flag |
| `!write.applicable` ⇒ sem ações | já canónico |

## 3. Diferenças face ao modelo canónico
`deriveEmbeddingWritePathDecision` já cobre: Companion/Standby/Unassigned/desativado (`none`), VERIFYING (`none`), INDETERMINATE, ERROR (`retry`), INCOMPATIBLE (`rebuild`), INDEX_ONLY (`generate`), trabalho pendente por modo. Divergências:
- `ERROR` não tinha tratamento próprio (caía nas heurísticas); canónico devolve `retry`, que o tipo de ação da UI não tem.
- `disabled` era sempre `false`; canónico expõe `canExecute`.
- Caso `!summary && embeddingsReady` (vetores declarados presentes sem detalhes): o snapshot sintético dá `INDEX_ONLY` ⇒ o canónico ofereceria `generate`, o legado não. Só existe na via sem `lifecycleSnapshot` explícito.

## 4. Testes existentes
`tests/search/embeddingStatusViewModel.test.ts` (inclui o caso acima) e `tests/search/embeddingStatusLifecycleSnapshot.test.ts` (cenários READY/UPDATE/INDEX_ONLY/INCOMPATIBLE/Companion/ERROR).

## 5. Plano
Substituir a cadeia de heurísticas por `deriveEmbeddingWritePathDecision(snapshot)` + mapeamento de apresentação; manter a guarda legada do caso 3 (equivalência); `retry` apresentado como o botão do trabalho que repete; sem alterar textos, layout, cancelamento nem cabeçalhos.
