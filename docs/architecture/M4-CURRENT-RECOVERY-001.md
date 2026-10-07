# M4 — Recovery crash-tolerant de `CURRENT`

## Contrato

`CURRENT` é o único artefacto mutável da publicação. As gerações em
`.lina/published/generations/` são imutáveis: o Writer só as move de staging
para o diretório final depois de reler e validar manifesto, records e vectors.
Por isso uma geração final validada, superior a `CURRENT`, é tratada como uma
publicação promovida cujo apontador pode ser reparado, nunca como lixo a apagar.

`recoverPublishedGenerationPointer()` é a implementação única de recovery. É
executada antes de calcular o próximo ID no serviço M4 e antes da publicação no
Writer. Não abre SQLite, não gera embeddings e não chama providers.

| Estado observado | Resultado |
| --- | --- |
| `CURRENT` válido, sem tmp | `NO_OP` |
| `CURRENT` ausente, tmp válido | promove tmp para `CURRENT` |
| `CURRENT` válido, tmp válido superior | completa a atualização interrompida |
| tmp inválido | `CURRENT_RECOVERY_INVALID_TMP_TARGET`, sem promoção |
| `CURRENT` inválido | `CURRENT_INVALID_TARGET`, sem aceitação silenciosa |
| finais válidos superiores, sem tmp | seleciona apenas o ID válido mais alto |

A substituição mantém a semântica necessária ao `DataAdapter`: escreve
`CURRENT.tmp`, valida o target antes de o usar, remove `CURRENT` apenas quando
necessário e renomeia tmp. Um crash entre remoção e rename deixa tmp preservado;
o arranque/diagnóstico seguinte recupera-o sem modificar gerações finais.

## Evidência estática do vault de testes

Em 2026-10-05, a leitura sem escrita do vault de testes encontrou
`CURRENT = generation-000001` e as gerações finais `000001`–`000004`. Todas
passaram as verificações equivalentes ao validator: ID interno, contagem,
comprimento de vectors, hashes SHA-256 de records/vectors e contratos de offset.
As gerações 000002–000004 são, portanto, promoted-not-current recuperáveis.

## Prova runtime controlada (2026-10-05) — `PASS`

Vault de testes `zettel`, Obsidian fechado antes da preparação. Simulada a
janela de crash tocando apenas nos apontadores: `CURRENT` removido e
`CURRENT.tmp = generation-000006`.

**Run 1 — `recoveryResult` (avaliado antes da publicação)**

| Campo | Valor |
| --- | --- |
| `currentBeforeRecovery` | ausente |
| `currentTmpBeforeRecovery` | `generation-000006` |
| gerações finais válidas | 000001–000006 |
| `recoveryAction` | `RECOVERED_TMP` |
| `currentAfterRecovery` | `generation-000006` |
| `CURRENT.tmp` depois | ausente |
| `providerCalls` | 0 |

**Run 1 — `publicationResult`:** o comando de diagnóstico publicou depois
`generation-000007` (`CURRENT` → 000007). É publicação normal, separada do recovery.

**Run 2 — idempotência:** sem alterar estado, `recoveryAction = NO_OP`,
`currentAfterRecovery = generation-000007`, `providerCalls = 0`; a publicação
seguinte criou `generation-000008`.

**Imutabilidade:** SHA-256 de manifest/records/vectors das gerações 1–6 após o
run 1, e 1–7 após o run 2, idênticos à baseline. O recovery só repara apontadores.

**Limitação:** não há comando de recovery isolado; o recovery foi observado no
relatório do diagnóstico, capturado antes da publicação.

Validação complementar: suite completa 174 ficheiros / 2292 testes, typecheck e
`git diff --check` verdes.
