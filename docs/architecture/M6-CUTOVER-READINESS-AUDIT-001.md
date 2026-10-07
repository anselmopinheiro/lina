# M6 — Auditoria de readiness do cutover (Companion → geração publicada v5)

Data: 2026-10-06. Auditoria apenas. Não implementei o cutover, não alterei a seleção de fonte, o legado, `CURRENT`, SQLite nem gerações, não apaguei nada, sem commit/push/reset/stash/clean.

## Veredicto: `BLOCKED`

**NO-GO para iniciar a implementação do M6 no estado atual.** O estado técnico dos dados é bom (v5 íntegra, G1/G2/G3/G6 satisfeitos, shadow L2 sem divergências), mas encontrei **quatro bloqueadores novos**, todos pequenos e corrigíveis, que não constam dos relatórios anteriores. Dois deles foram provados com experiências reais; um é leitura estática de código.

## Níveis de evidência

| Nível | Significado nesta auditoria |
| --- | --- |
| `OBSIDIAN_RUNTIME` | só o que foi relatado antes desta tarefa (shadow PASS no Producer desktop); **não reverificado por mim** |
| `NODE_HARNESS_REAL_VAULT` | código real do Lina executado em Node (esbuild) sobre os ficheiros reais do vault `zettel`, em leitura; é o que usei para reexecutar Reader e shadow |
| `UNIT_TEST` / `INTEGRATION_TEST` | suites existentes (56 testes de Reader/shadow/comparador reexecutados: verdes) |
| `STATIC` | leitura de código, sem execução |
| `NÃO_EXECUTADO` | Companion desktop, Android, iOS |

## Respostas

1. **Fonte autoritativa hoje:** o legado (`embeddings.jsonl`, com a cópia binária 3E opcional), via `RuntimeEmbeddingIndexCache`. Nenhum caminho de pesquisa lê `.lina/published`.
2. **Onde ocorrerá o cutover:** `LinaPlugin.getRuntimeEmbeddingIndex()` (`main.ts:1805`), ponto único por onde passam a sidebar, a pesquisa híbrida e o modal semântico.
3. **v5 atual elegível?** Sim, para os dados reais: `integrityValid` e `cutoverEligible = true` (ver tabela). **Mas** o Reader atribui `cutoverEligible = true` com base só em `formatVersion === 5` (ver B1/B3).
4. **Shadow M5 continua PASS?** Sim: reexecutado agora com o código atual (NODE_HARNESS_REAL_VAULT).
5. **G4 resolvido?** Sim para o Reader e o shadow (sem `node:*`, WebCrypto injetado, teste de dependências). Builder/Validator/Writer mantêm `node:crypto`, só no caminho Producer desktop.
6. **G5 resolvido?** **Não.** `publishedGenerationBuilder.ts:62` ainda ordena com `localeCompare`. Reader e comparador não dependem da ordem física; impacto limitado à reprodutibilidade do output do Producer (dívida).
7. **G7 bloqueia?** Não (dívida operacional), com ressalva para o mobile.
8. **G8 bloqueia?** Não. Confirmado: `companionSearch.ts`/`companionDeltaSearch.ts` não têm chamadores de produção; o cutover faz-se no caminho partilhado.
9. **G9 bloqueia?** Não o *início* da implementação com flag desligada; **bloqueia ligar o cutover** em qualquer dispositivo cuja validação seja `NÃO_EXECUTADO` (Companion desktop, Android, iOS).
10. **Companion estritamente read-only?** **Não, hoje não.** O Reader e o shadow são read-only, mas o plugin no seu conjunto não é (B2).
11. **Cache segura?** Não para o cutover: a identidade da cache desconhece geração publicada (ver secção 8). É requisito de desenho do M6, não um defeito atual.
12. **Rollback definido?** Sim, desenhado (secção 15); não implementado.
13. **Finding M3 bloqueia?** **Sim.** Mais grave do que o enunciado indica (B2).
14. **Consolidar worktree antes?** Sim, checkpoint técnico recomendado (B4).
15. **Bloqueador além de G1/G2/G3/G6?** Sim: B1, B2, B3, B4.
16. **GO/NO-GO:** NO-GO.

## Bloqueadores

### B1 — O Reader não impõe `embeddingInputHash` em v5 (provado)
`parseRecords` em `publishedGenerationReader.ts` só exige o hash para `formatVersion` 2, 3 e 4; v5 ficou de fora. Experiência (cópia da `generation-000015` no scratchpad, hashes recalculados, vault intocado):

| Variante | Resultado do Reader |
| --- | --- |
| v5 sem `embeddingInputHash` nos registos | `OK`, `cutoverEligible = true` |

O validator do lado Producer já exige o campo em v5, logo há assimetria Validator/Reader. Efeito no cutover: registos sem hash fariam o `calculateEmbeddingState` marcá-los `missing-input-hash` e a pesquisa semântica ficaria vazia, enquanto o Reader afirma "elegível". Os dados reais atuais não são afetados (2303/2303 com hash).

### B2 — O diagnóstico M3 corre em cada arranque, com role e flags forçados (STATIC)
`onload` chama `diagnoseM3Canonical()` e `diagnoseRuntimeSqlite()` em cada `layoutReady` (`main.ts:541-548`). `diagnoseM3Canonical` fixa `role = "producer"` (`:4600`) e `enabled: true` e todas as flags de SQLite a `true` (`:4616-4621`, `:4640-4655`), ignorando o papel real, o ownership e as settings. Em desktop, abre o SQLite, escreve o canónico e reprojeta o legado partilhado (`reprojectLegacyFromSqlite`). `performProducerSqliteCanonicalWrite` só valida a string de role que lhe é passada (`sqliteProducerCanonicalWriter.ts:75`) e não tem verificação de ownership nem de fence. `diagnoseRuntimeSqlite` escreve ainda `.lina/producer/sqlite-runtime-diagnostic.json` em qualquer dispositivo.

Consequência: um **Desktop Companion** com o plugin carregado executaria escritas de Producer em ficheiros partilhados, violando o contrato "Companion read-only" (que o enunciado declara bloqueante) e contornando o `OwnershipGate`. Também reescreve o legado, que é o alvo do rollback, a cada reload. O mobile fica de fora (`Platform.isDesktop`). **Não executei isto num Companion**; a conclusão vem do código.

### B3 — Sem política de provenance do lado do consumidor (provado)
Nada compara `producerDeviceId`/`producerEpoch` com o ownership, nem `sourcePublicationId`/`sourceTextGenerationId`/`sourceChunksDigest` com o índice atual. Experiências (mesma cópia):

| Variante | Reader |
| --- | --- |
| `producerDeviceId` ≠ produtor ativo | `OK`, `cutoverEligible = true` |
| `producerEpoch` = 99 (à frente do ownership) | `OK`, `cutoverEligible = true` |
| `sourcePublicationId` não coincide com o legado | `OK`, `cutoverEligible = true` |
| `formatVersion` 4 (legado) | `OK`, `cutoverEligible = false` (correto) |

Os dados reais passam todas as verificações cruzadas (ver tabela), mas o contrato de "elegível" no código é apenas a versão do formato. A política tem de respeitar D2.3.1 (proveniência `stale`/`future`/`unknown` continua utilizável) e distinguir "geração de outro texto" de "produtor/época desatualizados". Cenários 8 e 9 estão `NOT_TESTED`.

### B4 — Sem checkpoint Git
`master` @ `620a2c6` (commit M1). `git status`: 89 entradas (14 modificadas, 75 por rastrear), `main.js` (artefacto gerado, tracked) com +13 842 linhas de diff, `main.ts` +473, total +8 640 / −6 101 nas tracked. Misturam M2, M3/M3B, M4, M5A–D, G6, G1, G2, G3, scripts de prova e docs. Não é seguro nem auditável iniciar M6 sem checkpoint: sem ele não há como isolar o diff do M6 nem reverter por commit.

## Contrato v5 — `generation-000015` (NODE_HARNESS_REAL_VAULT)

| Verificação | Resultado |
| --- | --- |
| Reader | `OK`, `formatVersion = 5`, `cutoverEligible = true`, 2303 registos, `providerCalls = 0` |
| Integridade | manifesto válido; SHA-256 de records e vectors; offsets; `recordCount`; vectors finitos (todos pelo Reader) |
| G6 | `embeddingInputHash` em 2303/2303 |
| G1 | `vectorContractId` recomputa a partir de provider, model, dimensions, metric, prefixMode, inputVersion; coincide com `manifest.embeddings.vectorContract.contractId` do legado |
| G2 | `sourceTextGenerationId` = geração do manifesto de texto; `sourceChunksDigest` = digest recomputado de `chunks.jsonl`; `sourcePublicationId` = publicação do legado; `sourceRecordCount` = 2303 |
| G3 | `producerDeviceId` = `activeProducerId`; `producerEpoch` = `ownership.epoch` (3) |
| `CURRENT` | `generation-000015`, sem `CURRENT.tmp`, sem staging; 15 gerações finais |

## Shadow M5 — reexecução

Código atual, vault real, Reader real + auditor real + `RuntimeEmbeddingIndexCache` real (NODE_HARNESS_REAL_VAULT, não Obsidian):

| Campo | Valor |
| --- | --- |
| status / nível | `PASS` / L2 |
| geração | `generation-000015` (v5) |
| legado / publicado | 2303 / 2303 |
| divergências | 0 |
| `providerCalls` | 0 |

Nota: com `prefer-binary` o diagnóstico do legado devolveu `effectiveSource: jsonl` neste harness; **não avaliei se a 3E mascara ou não** o comportamento.

## Findings históricos

| ID | Estado | Detalhe |
| --- | --- | --- |
| G4 | RESOLVIDO (Reader/shadow) | sem `node:*`; WebCrypto injetado (`createWebCryptoEmbeddingDigest`); teste de dependências. Producer mantém `node:crypto` |
| G5 | **ABERTO, dívida** | `localeCompare` no Builder (`:62`); Reader/comparador usam ordenação por code unit ou por offset |
| G7 | ABERTO, dívida | sem deduplicação no serviço de publicação; 15 gerações, **147 MB** na pasta `published`; 9–12 (v2), 13 (v3), 14 (v4), 15 (v5) com os mesmos `vectorsSha256` e `recordsSha256`. O diagnóstico M3 repetido no arranque agrava isto. GC fora de âmbito. Sincronizar 147 MB para um mobile é custo real, não bloqueio funcional |
| G8 | CONFIRMADO | `companionSearch`/`companionDeltaSearch` sem chamadores fora de `src/companion`; cutover no `getRuntimeEmbeddingIndex`. Risco de cortar o caminho errado é baixo; falta alinhar também `semanticCapability`/lifecycle, que leem a identidade do legado |
| G9 | Desktop Producer shadow: `OBSIDIAN_RUNTIME` PASS (relatado); **Companion desktop, Android, iOS: `NÃO_EXECUTADO`** | |

## Seleção de fonte e fallback

| Opção | Avaliação |
| --- | --- |
| published-only | rejeitada para M6: remove o rollback e transforma cada atraso de sincronização numa indisponibilidade |
| published-first silencioso | rejeitada: mascara regressões e viola Zero Silent Fallback |
| **published com fallback explícito para o legado** | **recomendada** |

Regras propostas: (a) o fallback só se aplica a indisponibilidade (`NO_CURRENT`, `CURRENT_TMP_ONLY`, `TARGET_MISSING`, `TARGET_PARTIAL`, `CURRENT_CHANGED`, `RESOURCE_LIMIT`), com estado visível no diagnóstico e contador; (b) falhas de integridade ou de contrato (`HASH_MISMATCH`, `RECORDS_INVALID`, `VECTORS_INVALID`, `MANIFEST_INVALID`, contrato semântico ou provenance incompatíveis) bloqueiam a fonte publicada e são reportadas como erro, sem cair para outra geração publicada; (c) o legado só serve de fallback se o seu `vectorContractId` for igual ao do publicado, senão a pesquisa semântica fica indisponível (sem mistura de espaços); (d) `DOWNGRADE_REJECTED` mantém a geração em memória, sem fallback; (e) um modo estrito (published-only) para validação e testes.

## Flags

| Flag | Default | Estado |
| --- | --- | --- |
| `companionPublishedGenerationShadowEnabled` | `false` (por dispositivo) | existe |
| `producerImmutableGenerationPublicationEnabled` | `false` | existe |
| `producerSqliteCanonicalEnabled` | `false` | existe, **mas o diagnóstico M3 ignora-a** (B2) |
| flag de cutover | n/a | **não existe**; necessária, por dispositivo, default `false` |

Rollback: desligar a flag, invalidar a cache runtime e voltar ao legado; não toca em SQLite, gerações, embeddings nem providers.

## Cache runtime

`sameSourceIdentity` compara provider, model, dimensions, inputVersion, prefixMode, `updatedAt`, `publicationId`, `totalEmbeddings`, mtime e size do JSONL. Não inclui `generationId` nem `vectorContractId`; `storageFormat` só admite `jsonl-v1 | binary-v1`; não há invalidação por mudança de `CURRENT` (o shadow usa um pointer key próprio). Sem alterações, após o cutover uma geração antiga poderia continuar servida. O M6 tem de acrescentar à identidade o formato publicado, `generationId`, `vectorContractId` e os digests, e reler `CURRENT` (17 bytes) a cada `getOrLoad`. Mobile e desktop partilham a mesma semântica porque usam o mesmo `RuntimeEmbeddingIndexCache`. Estado: `NOT_TESTED` para publicado.

## `CURRENT` e monotonia

Reader: `NO_CURRENT`, `CURRENT_TMP_ONLY`, `CURRENT_MALFORMED`, `TARGET_MISSING`, `TARGET_PARTIAL`, `CURRENT_CHANGED` e `DOWNGRADE_REJECTED` tratados e testados. O recovery de apontadores é só do Producer. O cutover depende de `CURRENT` **mais** da validade do manifesto e, tal como está, não depende de mais metadados (daí B1 e B3). O `lastValidGenerationId` só vive em memória do shadow.

## Cobertura das falhas

| # | Falha | Estado |
| --- | --- | --- |
| 1 | `CURRENT` ausente | TESTED |
| 2 | malformado | TESTED |
| 3 | target inexistente | TESTED |
| 4 | target parcial | TESTED |
| 5 | hash mismatch | TESTED |
| 6 | vectors inválidos | TESTED |
| 7 | contrato semântico | PARTIALLY_TESTED (v3/v4 recomputado; comparador `CONTRACT_MISMATCH`; sem gate do consumidor) |
| 8 | provenance de origem | NOT_TESTED (aceite pelo Reader, provado) |
| 9 | provenance do produtor | NOT_TESTED (aceite pelo Reader, provado) |
| 10 | `CURRENT` muda durante a leitura | TESTED |
| 11 | downgrade | TESTED |
| 12 | cache obsoleta | NOT_TESTED (para publicado) |
| 13 | legado indisponível | PARTIALLY_TESTED (shadow reporta erro; sem seleção de fonte) |
| 14 | publicado indisponível | PARTIALLY_TESTED (shadow `READER_ERROR`) |
| 15 | publicado inválido, legado válido | PARTIALLY_TESTED (shadow preserva o legado; sem política) |

## Companion read-only

| Item | Estado |
| --- | --- |
| Reader: portas só `exists/read/readBinary/list`; não escreve `.lina/published` | provado (teste existente) |
| Shadow: não escreve, não repara `CURRENT`, não publica | provado por teste e código |
| Não abre SQLite Producer / não escreve ownership / não gera embeddings | **violado em desktop pelo diagnóstico de arranque (B2)**, STATIC |
| Não chama provider | `providerCalls = 0` em todos os caminhos auditados |

## Performance (desktop, Node; mobile não medido)

| Etapa | Legado JSONL (45 MB) | Publicado v5 |
| --- | --- | --- |
| Carga | 913–978 ms | 52 ms (leitura + 2× SHA-256 + validação + `Float32Array`) |
| Comparação L2 completa | n/a | 62–65 ms (shadow total) |
| Materialização de vetores | conversão `number[]` → `Float32Array` | vista direta, sem cópia |

Sem regressão evidente; ganho de cerca de 18× na carga.

## Finding M3 — impacto no cutover

- Afeta o Companion: sim (B2).
- Altera provenance G1/G2/G3: não diretamente (reprojeta a partir de SQLite com identidade fixa `inputVersion 1`/`prefixMode "none"`, o que está correto para o `mistral-embed` do vault, mas é um valor fixo e não derivado).
- Altera `CURRENT`: não por si; a publicação M4 só ocorre pelos caminhos de publicação.
- Publicação inesperada: não encontrei publicação no diagnóstico M3 (`immutablePublicationEnabled` não é passado); a duplicação de gerações vem dos diagnósticos M4/G6.
- Reescreve o legado a cada reload (muda mtime/size/`publicationId` e invalida a cache do legado).
- **Bloqueador do M6**, não dívida separada.

## Rollback

1. Flag de cutover por dispositivo, default `false`.
2. Desligar: `invalidate("manual")` e a seleção volta ao legado no próximo `getOrLoad`.
3. Condições: o legado e a 3E têm de continuar mantidos e válidos durante o M6 (o Producer projeta-os a partir do SQLite); nenhuma geração, SQLite ou embedding é tocado; sem provider.
4. Teste de rollback com ida e volta antes de qualquer ativação.

## Checklist GO / NO-GO

| Critério | Estado |
| --- | --- |
| v5 `CURRENT` íntegra | OK |
| `cutoverEligible` verdadeiro nos dados reais | OK |
| Shadow M5 L2 PASS atual | OK |
| Seleção de fonte desenhada | OK (secção própria) |
| Fallback/rollback definido | OK (desenho) |
| Invalidação de cache segura | **NÃO** (por implementar) |
| Companion read-only provado | **NÃO** (B2) |
| Reader impõe o contrato v5 | **NÃO** (B1) |
| Política de provenance do consumidor | **NÃO** (B3) |
| G4/G5/G7/G8/G9 classificados | OK |
| Falhas críticas cobertas | **NÃO** (8, 9, 12) |
| Git/worktree auditável | **NÃO** (B4) |

## O que falta resolver antes de reabrir o M6 (sem implementar aqui)

1. B1: fazer o Reader exigir `embeddingInputHash` em v5 (paridade com o Validator) + teste.
2. B2: o diagnóstico M3 e o `diagnoseRuntimeSqlite` não podem correr em arranque nem com role/flags forçados; têm de respeitar papel, ownership e flags.
3. B3: definir e testar a política de provenance e de origem do lado do consumidor.
4. B4: checkpoint técnico (um ou mais commits) antes do M6; decisão sobre o `main.js` gerado.
5. No M6: identidade de cache publicada, flag de cutover, seleção de fonte com fallback explícito e testes dos cenários 8, 9 e 12.

## Validações

`npm run typecheck`: PASS. `git diff --check`: PASS. 56 testes focados (Reader, shadow, comparador): PASS. Não executei a suite completa nem build, por não ser necessário. Scripts de análise ficaram no scratchpad (não versionados); as experiências negativas usaram uma cópia temporária, já removida.
