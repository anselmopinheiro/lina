# M6 — Reauditoria de readiness (pós B1–B4)

Data: 2026-10-07. Auditoria apenas. Não implementei M6, não criei flag de cutover, não alterei source selection nem a runtime cache, não fiz commit/push/reset/stash/clean/restore. O vault real foi só lido; as experiências negativas usaram uma cópia temporária (scratchpad), já removida.

## Veredicto: `READY_WITH_NON_BLOCKING_DEBT`

**GO para iniciar a implementação do M6**, com flag de cutover desligada por defeito, **condicionado a três itens de "passo zero" dentro do próprio M6** (secção 2). Nenhum deles bloqueia *começar*; os dois primeiros bloqueiam *ligar* o cutover num dispositivo.

Há dois findings novos que esta reauditoria encontrou e que as fases B1–B4 não cobriam (N1, N2). Não os classifiquei como bloqueadores de início porque (a) nenhum está ligado a um caminho de produção que o M6 vá usar sem os corrigir, e (b) a correção é pequena e localizada. Esta classificação é um juízo meu; se preferir ser mais conservador, N1 e N2 justificam um mini-B5 antes do M6 (ver secção 2).

## Níveis de evidência

| Nível | Significado |
| --- | --- |
| `STATIC` | leitura de código |
| `UNIT_TEST` / `INTEGRATION_TEST` | suites existentes, reexecutadas (65 testes focados verdes) |
| `NODE_HARNESS_REAL_VAULT` | código real do Lina em Node (esbuild) sobre os ficheiros reais do vault `zettel`, em leitura |
| `OBSIDIAN_RUNTIME` | não reexecutado nesta tarefa |
| `NÃO_EXECUTADO` | Companion desktop, Android, iOS |

## 1. Respostas diretas

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | B1 fechado? | **Sim** (PASS) |
| 2 | B2 fechado? | **Sim para o objetivo declarado (arranque)**; **parcial** quanto a "comandos explícitos protegidos" — ver N1 |
| 3 | B3 fechado? | **Sim como policy pura**, com uma falha de fail-open (N2) que tem de ser corrigida no M6 |
| 4 | B4 fechado? | **Sim** (PASS) |
| 5 | Geração atual continua válida? | **Sim**: `CURRENT = generation-000015`, v5, 2303 registos, Reader `OK` |
| 6 | Shadow M5 continua PASS? | **Sim**: L2, 2303/2303, 0 divergências, `providerCalls = 0` (NODE_HARNESS_REAL_VAULT) |
| 7 | Companion read-only suficientemente garantido para iniciar M6? | **Sim para o arranque**; **não totalmente** para comandos manuais (N1) |
| 8 | Git suficientemente limpo/auditável? | **Sim** |
| 9 | Algum bloqueador novo? | **Nenhum bloqueador de início**; dois findings novos (N1, N2), ambos a fechar dentro do M6 |
| 10 | G5 bloqueia? | Não (dívida) |
| 11 | G7 bloqueia? | Não (dívida operacional) |
| 12 | G9 bloqueia o início? | Não. **Bloqueia ligar o cutover** em Companion desktop/Android/iOS |
| 13 | `.lina-local/` bloqueia? | Não |
| 14 | Os restantes itens pertencem ao M6? | **Sim**, todos (secção 9) |
| 15 | Veredicto | `READY_WITH_NON_BLOCKING_DEBT` |

## 2. Itens de passo zero do M6 (novos findings)

### N1 — Os comandos explícitos de diagnóstico M3 não respeitam role/ownership/flags (STATIC)
O B2 removeu **apenas a chamada de arranque**. O corpo de `diagnoseM3Canonical()` (`main.ts:4582`) continua a fixar `role = "producer"` (`:4596`) e `enabled: true` com todas as flags SQLite a `true` (`:4614-4619`, `:4642-4654`), abre o SQLite, escreve o canónico e reprojeta o legado (`:4659`). `performProducerSqliteCanonicalWrite` só valida a string de role que lhe é passada (`sqliteProducerCanonicalWriter.ts:75`). O comando `diagnose-m3-canonical` está registado para todos os utilizadores (`main.ts:688`).

Consequência: um **Desktop Companion** que execute manualmente "Diagnose m3 canonical" faz escritas de Producer e reescreve o legado (que é o alvo do rollback do M6). Exige ação deliberada, só em desktop, e não ocorre no arranque. Por isso não bloqueia o *início*; **deve ser corrigido antes de o cutover poder ser ligado** e antes de uma release (guardar por `getDeviceRoleResolution()` + `OwnershipGate` + flags reais, ou retirar o comando do build de produção).
`diagnoseRuntimeSqlite` não abre SQLite (só testa `require("node:sqlite")`); escreve `.lina/producer/sqlite-runtime-diagnostic.json` apenas se `.lina/producer` já existir. Risco baixo.

### N2 — O gate de provenance do consumidor é fail-open com expectativas vazias ou parciais (provado)
`sourceStatus` só devolve `UNKNOWN` quando `source` é `undefined`; cada comparação é saltada se o campo esperado for `undefined`. Experiência real:

| Expectativa de origem | Resultado |
| --- | --- |
| `{}` | `MATCH` / `eligible = true` |
| só `sourceChunksDigest` correto | `MATCH` / `eligible = true` |

Se o M6 construir a expectativa a partir de um legado sem alguns campos (por exemplo sem `publicationId`), o gate declarará `MATCH` sem ter comparado nada. Isto viola Zero Silent Fallback. Correção esperada: exigir os quatro campos da origem para `MATCH`; ausência ⇒ `UNKNOWN`. Não existe teste para este caso (os 3 testes atuais cobrem match, mismatches objetivos e épocas).

Relacionado: o gate devolve `structuralStatus: "VALID"` e `semanticStatus: "COMPATIBLE"` **fixos**, e o Reader continua a marcar `cutoverEligible = true` apenas por `formatVersion === 5`. Um chamador futuro pode, portanto, ignorar o gate e usar `cutoverEligible`. Recomendação para o M6: um único ponto de seleção que só produza o índice publicado "autoritativo" depois de Reader `OK` + contrato semântico + gate `eligible`, sem expor `cutoverEligible` como critério de decisão.

### N3 — Lacunas de teste (não bloqueantes)
- B1: o teste comitado "rejects … without input hashes" cobre **só v2**; v3/v4/v5 estão cobertos por código e pela experiência real (abaixo), não por teste unitário.
- B2: não existe teste que prove que `onload` já não chama diagnósticos (nenhum teste executa `onload`; `vectorContractStartupOrder.test.ts` cobre `loadDataFromDisk`). A prova é `STATIC`.

## 3. B1 — Reader e `embeddingInputHash` — **PASS**

| Evidência | Resultado |
| --- | --- |
| STATIC | `publishedGenerationReader.ts:198`: `manifest.formatVersion >= 2` exige `embeddingInputHash` não vazio ⇒ cobre v2–v5; v1 não exige |
| STATIC | Validator `publishedGenerationValidator.ts:60` exige o mesmo para v2..v5 ⇒ alinhado |
| NODE_HARNESS_REAL_VAULT | cópia da `generation-000015` com hashes removidos dos registos ⇒ `RECORDS_INVALID` / `records-contract`, `cutoverEligible = false` (antes: `OK`/`true`) |
| UNIT_TEST | v1 legível sem hash (`it.each([1,2,3])`), v2 sem hash rejeitado; v4 legado `OK`, `cutoverEligible = false` |
| Dados reais | `embeddingInputHash` em 2303/2303 |

## 4. B2 — Companion e arranque — **PASS (arranque)**, parcial (comandos)

| Verificação | Evidência | Nível |
| --- | --- | --- |
| `diagnoseM3Canonical()` não corre no arranque | `runDiagnostics` é uma função vazia (`main.ts:542-543`); os únicos chamadores são o comando `:694` | STATIC |
| `diagnoseRuntimeSqlite()` não corre no arranque | único chamador é o comando `:639` | STATIC |
| Companion não abre SQLite Producer por estes diagnósticos | `new SqliteProducerLocalStore` só ocorre dentro de métodos `diagnose*` (`:4298`, `:4443`, `:4535`, `:4623`, `:4727`) | STATIC |
| Companion não reprojeta o legado no arranque | `reprojectLegacyFromSqlite` só em `diagnoseM2…` e `diagnoseM3Canonical` (comandos) | STATIC |
| Companion não escreve `.lina/producer` no arranque | as escritas estão dentro de `diagnose*`; `shadowWriteOptions` não é definido por nenhum chamador de produção ⇒ a publicação de embeddings não dispara shadow-write SQLite | STATIC |
| Reconciliação de arranque do Companion | `canReconcileStartupDiffs: isProducer` (`deviceCapabilities.ts:45`) ⇒ Companion salta-a | STATIC |
| Comandos explícitos protegidos por role/ownership/flags | **NÃO** para `diagnose-m3-canonical` (N1) | STATIC |
| Teste de integração do arranque | **não existe** | INTEGRATION_TEST: ausente |
| Obsidian | não executado | OBSIDIAN_RUNTIME: NÃO_EXECUTADO |

## 5. B3 — Consumer provenance gate — **PASS (policy), com N2**

Matriz verificada com o índice real e o manifesto/ownership reais (NODE_HARNESS_REAL_VAULT):

| Cenário | Origem | Produtor | `eligible` |
| --- | --- | --- | --- |
| dados reais | MATCH | MATCH | **true** |
| sem expectativa de origem | UNKNOWN | MATCH | false |
| sem ownership | MATCH | UNKNOWN | false |
| `sourceChunksDigest` diferente | **MISMATCH** | MATCH | false |
| `sourceRecordCount` diferente | **MISMATCH** | MATCH | false |
| `sourceTextGenerationId` diferente | STALE | MATCH | false |
| `sourcePublicationId` diferente | STALE | MATCH | false |
| `activeProducerId` diferente | MATCH | **MISMATCH** | false |
| época do ownership à frente (`index < ownership`) | MATCH | STALE | false |
| época do ownership atrás (`index > ownership`) | MATCH | FUTURE | false |
| ownership sem época | MATCH | UNKNOWN | false |

- Policy: só `MATCH/MATCH` é elegível para consumo **autoritativo**. `STALE/FUTURE/UNKNOWN` **não** são elegíveis, mas o gate **não** distingue "bloquear com erro" de "recorrer ao legado": devolve apenas `reason: "STATUS/STATUS"`. O M6 tem de definir esse tratamento (secção 10).
- Read-only: `consumerPublishedGenerationEligibility.ts` não importa adapters, não escreve, é função pura (STATIC).
- Não está ligado a nenhum caminho de produção (só testes) — correto para esta fase.
- "Chamador não pode ignorar" — **não garantido** (N2, parágrafo final).

## 6. B4 — Git — **PASS**

| Item | Valor |
| --- | --- |
| branch | `master` |
| HEAD | `7cfe7ef7fb3bf36d5b3f832fed4bcef2d9cc8724` (`chore: checkpoint pre-m6 published generation pipeline`) |
| `git status --short` | só `?? .lina-local/` |
| `git diff --check` | limpo |
| push | não efetuado (`origin/master..HEAD` = o checkpoint) |

M6 terá diff próprio e auditável sobre este commit.

## 7. Geração publicada atual — **válida**

| Verificação | Resultado |
| --- | --- |
| `CURRENT` (lido agora) | `generation-000015` (inalterado; 15 gerações finais) |
| Reader | `OK`, `formatVersion = 5`, 2303 registos, `providerCalls = 0`, ~59 ms |
| `cutoverEligible` (Reader) | `true` (critério só de formato; ver N2) |
| G6 | `embeddingInputHash` 2303/2303 |
| G1 | `vectorContractId` recomputa e coincide com `manifest.embeddings.vectorContract.contractId` do legado |
| G2 | `sourceTextGenerationId`, `sourceChunksDigest` (recomputado de `chunks.jsonl`), `sourcePublicationId` e `sourceRecordCount` coincidem com o legado |
| G3 | `producerDeviceId` = `activeProducerId`; `producerEpoch` = `ownership.epoch` |

## 8. Shadow M5 — **PASS, L2** (NODE_HARNESS_REAL_VAULT)

Código atual, Reader real + auditor real + `RuntimeEmbeddingIndexCache` real, sobre o vault real. É **L2** em Node, **não** prova em Obsidian/Companion.

| Preferência de leitura | status | legado / publicado | divergências | `providerCalls` | tempo shadow |
| --- | --- | --- | --- | --- | --- |
| `jsonl` | PASS | 2303 / 2303 | 0 | 0 | ~66 ms |
| `prefer-binary` | PASS | 2303 / 2303 | 0 | 0 | ~61 ms |

Nota: o diagnóstico do legado indicou `effectiveSource: binary` nas duas preferências neste harness (a cópia binária 3E está presente e válida); não afeta o resultado.

## 9. Findings históricos

| ID | Estado |
| --- | --- |
| G4 | Resolvido para Reader/shadow (sem `node:*`, WebCrypto injetado). Builder/Validator/Writer mantêm `node:crypto`, só no caminho Producer desktop |
| G5 | **Aberto, dívida não bloqueante** (`localeCompare` no Builder; Reader/comparador não dependem da ordem) |
| G7 | **Aberto, dívida operacional não bloqueante**: 15 gerações no vault; sem deduplicação nem GC; custo de sincronização, não defeito funcional. O M6 não deve apagar gerações |
| G8 | **Confirmado**: ponto de cutover = `LinaPlugin.getRuntimeEmbeddingIndex()` (`main.ts:1803`); `companionSearch`/`companionDeltaSearch` não têm chamadores de produção. Falta alinhar `semanticCapability`/lifecycle, que leem a identidade do legado |
| G9 | Desktop Producer: shadow `OBSIDIAN_RUNTIME` PASS (relatado anteriormente, não reverificado aqui). **Companion desktop: NÃO_EXECUTADO. Android: NÃO_EXECUTADO. iOS: NÃO_EXECUTADO.** Nenhuma plataforma foi marcada PASS sem execução real |

### Requisitos ainda do M6 (por implementar — legitimamente M6, não pré-requisitos)

1. flag de cutover por dispositivo, default `false`;
2. identidade da fonte publicada em `RuntimeEmbeddingIndexCache` (hoje `sameSourceIdentity` não inclui `generationId`/`vectorContractId`/digests; `storageFormat` só admite `jsonl-v1 | binary-v1`);
3. releitura/invalidação por `CURRENT`;
4. seleção de fonte publicada em `getRuntimeEmbeddingIndex()`;
5. fallback explícito para o legado;
6. rollback por flag;
7. cenário de falha 12 (cache publicada obsoleta);
8. `semanticCapability`/lifecycle alinhados com a fonte selecionada.

Nenhum precisa de ser resolvido *antes* de começar; só N1 e N2 (secção 2) têm de entrar no início do M6.

## 10. Policy de fallback — reconfirmada e coerente com B3

Desenho: **publicada autoritativa + fallback explícito para o legado apenas em falhas de disponibilidade.**

| Fallback permitido (disponibilidade) | Sem fallback silencioso (integridade/contrato) |
| --- | --- |
| `NO_CURRENT`, `CURRENT_TMP_ONLY`, `TARGET_MISSING`, `TARGET_PARTIAL`, `CURRENT_CHANGED`, `RESOURCE_LIMIT` | `HASH_MISMATCH`, `RECORDS_INVALID`, `VECTORS_INVALID`, `MANIFEST_INVALID`, contrato semântico incompatível, **provenance de origem `MISMATCH`**, **provenance do produtor `MISMATCH`** |

Coerência com B3: `MISMATCH` (origem ou produtor) ⇒ erro explícito, sem fallback. **Lacuna a decidir no M6**: a policy documentada não classifica `STALE`/`FUTURE`/`UNKNOWN`. O B3 só diz "não elegível"; sugiro tratá-los como **falha de disponibilidade com fallback explícito, visível e contado** (a geração pode estar apenas atrasada na sincronização), nunca como consumo autoritativo, e nunca silencioso. O legado só serve de fallback se o seu `vectorContractId` for igual ao do publicado, senão a pesquisa semântica fica indisponível. `DOWNGRADE_REJECTED` mantém a geração em memória, sem fallback.

## 11. Rollback — válido

`flag OFF → invalidar a cache runtime → o próximo getOrLoad devolve o legado`. Não apaga gerações, não altera SQLite, não chama providers, não reembeda. Pré-condição: o legado (e a 3E, se ativa) têm de continuar válidos durante o M6 — o que torna **N1** relevante, porque o comando M3 manual reescreve o legado. Exigir teste de ida e volta antes de qualquer ativação.

## 12. `.lina-local/`

| Pergunta | Resposta |
| --- | --- |
| É só runtime local? | Sim: `.lina-local/db/lina-producer.db` (~10 MB, base SQLite local do Producer) |
| Pode ser ignorado no M6? | Sim |
| `.gitignore` antes do M6 ou dívida separada? | **Dívida separada, pequena**; recomendo fazê-lo cedo (e já agora no primeiro commit do M6) para não ser comitado por engano com `git add -A` |
| Interfere com testes/build/release? | Não: `npm test` (181 ficheiros) e `build`/`release-check` passaram com ele presente; `release-check` valida só `manifest.json`, `main.js`, `styles.css` |

Não alterei o `.gitignore`.

## 13. Validações

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `git diff --check` | PASS |
| 5 ficheiros focados (Reader, gate, shadow audit, equivalência, `vectorContractStartupOrder`) | PASS — 65 testes |
| Harness `NODE_HARNESS_REAL_VAULT` | executado (Reader, G1/G2/G3/G6, gate, shadow ×2, experiências B1) |

Não repeti a suite completa nem o build: passaram no checkpoint B4 e nenhum ficheiro de produto foi alterado desde então.

## 14. Estado final

```text
B1 = PASS    B2 = PASS (arranque; N1 aberto)    B3 = PASS (policy; N2 aberto)    B4 = PASS
M6 = NOT_STARTED    CUTOVER = NOT_STARTED
verdict = READY_WITH_NON_BLOCKING_DEBT
```
