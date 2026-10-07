# G6 — Auditoria de `CURRENT_INVALID_TARGET`

Data: 2026-10-06. Fase exclusivamente de diagnóstico. Não corrigi nada, não repeti o backfill, não alterei SQLite, legado, 3E, gerações nem `CURRENT`, não chamei providers, sem commit nem push.

## Resultado

Atualização posterior à auditoria (2026-10-06): correção de código v2 implementada, com v1 íntegra aceite como legado não elegível para cutover. Gates automatizados verdes (178 ficheiros / 2353 testes). Runtime confirmou publicação 000009 v2 e shadow L2 PASS; o diagnóstico final publicou 000010, mas recusou a etapa binária devido à cache de ownership contaminada por erro do harness. Execução interrompida, sem reparação. O diagnóstico original abaixo permanece registo histórico; ver `G6-PUBLISHED-FORMAT-V2-001.md`. G6 não é declarada PASS.

**`READY_FOR_FIX`** — classificação **`FORMAT_COMPATIBILITY_GAP`** (não é corrupção de dados).

## Respostas

1. **`CURRENT` aponta para quê?** `generation-000008` (conteúdo exato `generation-000008`, sem `CURRENT.tmp`, sem staging residual).
2. **Está corrompida?** Não. Manifesto, `recordsSha256`, `vectorsSha256`, offsets e contagem passam todos; o único erro é a regra nova abaixo.
3. **É pré-G6?** Sim. As 8 gerações (000001–000008, criadas a 2026-10-05, 13:07Z–18:17Z) são anteriores ao backfill (2026-10-06) e a nenhuma foi criada depois do código G6.
4. **O que a torna inválida?** `publishedGenerationValidator.ts:31` passou a emitir `MISSING_INPUT_HASH` quando algum registo de `records.json` não tem `embeddingInputHash`. Executei o validator real sobre as 8 gerações: **todas** falham com exatamente esse erro e **nenhum outro**.
5. **É compatibilidade de formato?** Sim. `PUBLISHED_GENERATION_FORMAT_VERSION` continua `1`; o Builder, o Validator e o Reader só aceitam `formatVersion === 1`. O mesmo número designa agora dois contratos diferentes.
6. **Publicar nova geração pós-G6?** Sim, mas **não é suficiente sozinha** (ver deadlock abaixo).
7. **`formatVersion` novo?** Sim, recomendado (`formatVersion: 2`).
8. **O backfill é idempotente?** Sim (prova read-only abaixo).
9. **Provider/re-embedding?** Não. `providerCalls = 0` em tudo.

## Estado real do filesystem (vault `zettel`)

| Item | Valor |
| --- | --- |
| `CURRENT` | `generation-000008` |
| `CURRENT.tmp` | ausente |
| Gerações finais | 000001 … 000008 (maior ID = 000008 = alvo de `CURRENT`) |
| `.staging` | vazio |

| Geração | `formatVersion` | `recordCount` | com `embeddingInputHash` | sem | manifesto/hashes/offsets | validator |
| --- | --- | --- | --- | --- | --- | --- |
| 000001 | 1 | 2299 | 0 | 2299 | válidos | `MISSING_INPUT_HASH` |
| 000002–000008 | 1 | 2303 | 0 | 2303 | válidos | `MISSING_INPUT_HASH` |

Chaves de cada registo em `records.json`: `index, offsetBytes, chunkId, notePath, chunkIndex, textHash, vectorContractId` (sem `embeddingInputHash`).

## Hipótese principal — confirmada

> `CURRENT` aponta para uma geração pré-G6 cujos `records.json` não têm `embeddingInputHash`, e o validator pós-G6 exige esse campo.

Confirmada. `FORMAT_COMPATIBILITY_GAP`.

## Contrato pré-G6 vs pós-G6

| Componente | Antes | Agora |
| --- | --- | --- |
| Builder | registos sem o campo | `embeddingInputHash` copiado do registo SQLite (`publishedGenerationBuilder.ts:41`), opcional no tipo |
| Validator | sem regra | `MISSING_INPUT_HASH` se algum registo não o tiver (`:31`) |
| Reader (M5A) | — | exige string não vazia por registo (`:121`) → `RECORDS_INVALID` (`records-contract`) |
| `formatVersion` | 1 | **1** (inalterado) |
| Compatibilidade backward | n/a | **inexistente**: nenhum ramo aceita v1 sem o campo |

Respostas diretas: a G6 **não** alterou `formatVersion`; a presença **passou a ser obrigatória** (Validator e Reader); as gerações existentes foram produzidas **antes**; continuam válidas **estruturalmente** pelo contrato antigo; o validator atual **não** aceita o formato antigo; **não** há compatibilidade explícita.

## Consequências verificadas no código

**Deadlock de publicação.** `recoverPublishedGenerationPointer` valida cada geração com o validator atual. Como todas falham, `validFinalGenerations` fica vazio e, com `CURRENT` definido, devolve `CURRENT_INVALID_TARGET` (`publishedGenerationWriter.ts:66`). Esse recovery corre **antes** de qualquer publicação em `publishSqliteCanonicalGeneration` (`publishedGenerationPublicationService.ts:38`) e em `publishImmutableGeneration` (`:94`), ambos com retorno antecipado em falha. Logo **não é possível publicar a geração 000009 pós-G6** enquanto as antigas forem tratadas como inválidas: a estratégia B isolada fica bloqueada.

**Recovery/startup.** O recovery só é chamado nos caminhos de publicação (`sqliteProducerCanonicalWriter.ts:221`, `main.ts` diagnósticos); não existe chamada no arranque, portanto o startup não falha. Mas cada escrita canónica tenta publicar, falha com `CURRENT_INVALID_TARGET` e fica sem M4, enquanto SQLite e legado seguem sem impacto.

**Perda de apontabilidade.** Uma geração validamente publicada deixa de ser apontável: nem sequer `CURRENT.tmp` apontando para ela seria promovido (`CURRENT_RECOVERY_INVALID_TMP_TARGET`).

**Shadow M5.** O Reader devolve `RECORDS_INVALID` para `CURRENT`; a comparação shadow com M4 pré-G6 deixa de ser possível.

## Backfill G6 e idempotência

O diagnóstico `diagnose-g6-embedding-input-hash-backfill` **não é read-only** (reprojeta o legado, publica M4 e atualiza a cópia binária), por isso não o reexecutei. Prova alternativa, read-only, sobre uma cópia do SQLite v2 do vault:

| Verificação | Resultado |
| --- | --- |
| SQLite v2, coluna `embedding_input_hash` | 2303 / 2303 preenchidas |
| `planEmbeddingInputHashBackfill` real sobre a cópia | `ALREADY_PRESENT = 2303`, `BACKFILLED_VERIFIED = 0`, restantes 0 |
| Hash guardado vs recalculado de `chunks.jsonl` | 2303 iguais, 0 diferentes |
| `providerCalls` | 0 |

Separação pedida: `backfillStatus = PASS` (2303 `BACKFILLED_VERIFIED` na 1.ª execução, depois idempotente); `publishedGenerationStatus = FAIL` (`CURRENT_INVALID_TARGET`). O JSON do vault marca `status: FAIL` global só por causa deste último.

## Estratégia recomendada: **C + B, com A limitada**

1. **C — `formatVersion: 2` explícito.** v2 exige `embeddingInputHash` em todos os registos; v1 deixa de poder ser confundida com v2.
2. **A (limitada) — v1 como legado read-only.** O Validator e o Reader passam a distinguir dois resultados: *integridade válida* e *elegível para cutover*. Uma v1 com integridade válida é apontável (mantém `CURRENT`, desbloqueia o recovery e a monotonia) mas marcada `cutoverEligible = false`; o shadow pode lê-la mas reporta-a como legado. Nunca se enfraquece a regra para v2.
3. **B — publicar `generation-000009` (v2)** a partir do SQLite v2 já corrigido, `providerCalls = 0`. `CURRENT` avança com a monotonia existente; v1 ficam imutáveis (sem edição, sem apagar, sem repontar manualmente).

Porque não só A: mantém o formato ambíguo. Porque não só B: o deadlock acima impede a publicação. Porque não enfraquecer o validator globalmente: proibido e esconderia perda de dados em gerações novas.

Política durante a migração: `CURRENT` válido ⇔ integridade válida (v1 ou v2); cutover só com v2 apontada por `CURRENT`; recovery nunca escolhe uma geração com integridade inválida; um `CURRENT` que aponte para integridade inválida continua a bloquear.

## Fora de âmbito (não tocado)

G1, G2, G3, cutover, GC das gerações 1–8, a alteração do comando de diagnóstico G6 (que mistura backfill, reprojeção, publicação e 3E) e qualquer correção de código.

## Validações

`npm run typecheck` e `git diff --check` — ver secção final do relatório. Scripts de análise ficaram no scratchpad (não versionados).
