# LINA-15H-A — AUDITORIA DA PERSISTÊNCIA DOS EMBEDDINGS

> **Fase:** LINA-15H-A (apenas auditoria; sem alteração de código, testes, schemas, `data.json` ou embeddings)
> **Data:** 2026-10-02 · **Branch:** `master` · **Base:** `b67d956` (LINA-15D-B)
> **Prompt-mestra:** `PROMPT-MESTRA-LINA-004` não existe no repositório (registado em 15D-A); prevalecem `AGENTS.md` e `docs/`.
> **Legenda de evidência:** **FACTO** (confirmado em código ou probe) · **INFERÊNCIA** · **RISCO** · **DÍVIDA** · **RECOMENDAÇÃO**.
> **Probes:** `p1`, `p1b`, `p2` (scratchpad da sessão, **fora do repositório**), compilados contra o código de produção real com `FakeAdapter` em memória; sem providers, sem embeddings reais, sem vault do utilizador.

---

## 1. Objetivo

Determinar se os artefactos persistidos pelo subsistema de embeddings são escritos, publicados, lidos, recuperados e sincronizados de forma consistente, atómica e segura; e responder a F-08, F-09 e F-10 da auditoria global pós-LINA-14, validando-os contra o código atual (não contra as auditorias).

## 2. Metodologia

Leitura integral de `embeddingPersistence.ts`; leitura dirigida de `indexStore.saveTextIndex`, `embeddingGenerator` (leitores/estado), `embeddingBinaryStorage` (publisher/recovery), `runtimeEmbeddingIndex` (leitor de pesquisa), `ownershipGate` (fencing), `main.ts` (chamadores de purge/publicação/reconciliação), `maintenanceEngine`/`reconciliationWorker`/`binaryWorker`; mapeamento de testes; 3 probes de crash/truncagem/janela.

## 3. Inventário de artefactos

| Artefacto | Localização | Escritor | Leitor | Autoridade | Atomicidade | Identidade | Recuperação | Sincroniza? |
|---|---|---|---|---|---|---|---|---|
| **`embeddings.jsonl`** (canónico) | `.lina/index/` | `publishCanonicalEmbeddings`, `purgeOrphanEmbeddingRecords` | estado (`readEmbeddingStatus`), pesquisa (`RuntimeEmbeddingIndexCache`), Companion | Producer ativo | staging + backup + rename (ver §6) | **sem identidade própria**; ligado ao manifesto só por contagem/dimensões/provider/modelo | só no início de uma geração | Sim (previsto) |
| **`manifest.json`** (partilhado: índice textual **e** identidade dos embeddings) | `.lina/index/` | `saveTextIndex`, `publishCanonicalEmbeddings`, purge (ramo "tudo purgado") | tudo | Producer ativo | staging + backup + rename; **ramo purge: escrita in-place** | `embeddings{provider,model,dimensions,totalEmbeddings,publicationId,vectorContract,provenance}` + `embeddingInput{version,prefixMode}` | idem | Sim |
| `notes.json`, `chunks.jsonl` | `.lina/index/` | `saveTextIndex` | pesquisa, plano, estado | Producer ativo | idem (3 ficheiros) | `generationId` + digests no manifesto | `readTextIndexStatus` valida | Sim |
| Binário derivado (`embeddings.binary.manifest.json`, `embeddings.meta.jsonl`, `embeddings.vectors.f32`) | `.lina/index/` | `BinaryEmbeddingPublisher` | runtime (dual-read) | Producer ativo (`BinaryWorker.canPublish`) | staging + backup + rename; **digests sha256** | `sourcePublicationId` = `publicationId` do JSONL | `recoverBinaryEmbeddingPublication` (**sem chamador em produção**) | Sim (previsto) |
| Checkpoint (`embeddings.checkpoint.jsonl`, `.meta.json`) | `.lina/producer/checkpoints/` | `writeEmbeddingCheckpoint` | geração (reutilização), estado | Producer | staging + backup + rename | provider/model/dimension/inputFormatVersion no sidecar | `recoverEmbeddingPersistenceArtifacts` | **Não** (README: operacional) |
| Staging/backups (`*.publish.tmp`, `*.publish.backup`, `*.checkpoint.*`) | `.lina/producer/staging|backups/` | os escritores acima | só recuperação | Producer | n/a | nomes determinísticos | limpeza conhecida | **Não previsto**, mas depende da exclusão do utilizador (README) |
| `ownership.json`, `ownership-history/*` | `.lina/` | `deviceOwnership*` | gate, diagnóstico | n/a | tmp+backup+rename; histórico append-only | `{activeProducerId, epoch}` | diagnóstico read-only | Sim |
| `devices/<id>.json`, `producer-state.json` | `.lina/` | `deviceState`, `producerState` | por dispositivo / observacional | por dispositivo | tmp+backup+rename | n/a | n/a | por dispositivo |

**FACTO:** não existe `vault.modify/create/delete` nos caminhos de embeddings. Não há caches persistentes além dos listados; o índice runtime (`Float32Array`) é só memória.

## 4. Fluxo de escrita (geração → staging)

**FACTO** (`generateEmbeddingsForChunks`, `main.ts`): `acquireFence()` → `recoverEmbeddingPersistenceArtifacts(fence)` → validação do provider (≤3 chunks) → lotes sequenciais → checkpoint por lote (`writeEmbeddingCheckpoint`: `.tmp` validado por releitura → backup do anterior → rename → sidecar → validação do par; `assertWriteFence` antes de escrever e antes de cada rename) → `onPersisting` (ponto de não retorno) → `publishCanonicalEmbeddings`.

## 5. Fluxo de publicação (ordem exata)

`publishCanonicalEmbeddings` (`embeddingPersistence.ts:839-982`), **FACTO**:

1. `assertWriteFence`; leitura do manifesto atual (tem de existir e ser objeto);
2. serializa e **valida o candidato em memória** (contagem, dimensões, duplicados, identidade provider/modelo dos registos, contrato vetorial);
3. `write embeddings.publish.tmp` → relê e revalida; `write manifest.publish.tmp` → relê e valida o **par** candidato;
4. apaga backups antigos; `assertWriteFence`; `rename embeddings.jsonl → backups/embeddings.publish.backup`; `assertWriteFence`; **`rename embeddings.publish.tmp → embeddings.jsonl`**;
5. relê/valida o canónico novo; `assertWriteFence`; **`rename manifest.json → backups/manifest.publish.backup`**; `assertWriteFence`; **`rename manifest.publish.tmp → manifest.json`**;
6. `validateCanonicalFiles` (par); limpa backups e checkpoint.

`buildManifestCandidate` regenera `publicationId` (marcador de commit para a cópia binária), `vectorContract`, `embeddingInput`. **Não há `fsync`/flush** (a API `DataAdapter` não o oferece) — a durabilidade depende do SO (DÍVIDA/INFORMATIVO).

## 6. Atomicidade — demonstração

**FACTO:** cada ficheiro é substituído por rename; **o par `(embeddings.jsonl, manifest.json)` não é substituível atomicamente** (dois renames em sequência com um backup pelo meio). Janelas reais, demonstradas por probe (crash simulado = todas as operações seguintes falham, sem rollback possível):

| Janela | Estado em disco (probe) | Observação dos leitores sem recuperação |
|---|---|---|
| **W1** após `rename(embeddings.tmp→canónico)`, antes de `rename(manifest→backup)` (**p1b**) | `embeddings.jsonl` **novo** (3 registos, modelo `m2`) + `manifest.json` **antigo** (modelo `m1`, 2 registos) | `readEmbeddingStatus`: `readability=readable`, `published=m1`, **sem sinalização de par inconsistente**; contadores `validForSearch=0` (os registos `m2` não casam com a identidade publicada `m1`) |
| **W2** após `rename(manifest→backup)`, antes de `rename(tmp→manifest)` (**p1**) | `embeddings.jsonl` novo + **`manifest.json` ausente** | `published={}`; **o manifesto do índice textual também desaparece** ⇒ índice textual "missing" enquanto durar a janela |

**Recuperação (p1/p1b):** só ao iniciar a próxima geração, `recoverEmbeddingPersistenceArtifacts` restaura o par **antigo** (`m1`, 2 registos), sem avisos — consistente, mas descarta a geração nova (o checkpoint, por só ser apagado após sucesso, permite reaproveitar o trabalho).

**Rollback em falha (não crash):** FACTO — `catch` remove o publicado e devolve os backups; coberto por testes (§13).

**Binário novo/JSONL antigo e JSONL novo/binário antigo:** **FACTO** — o binário só é lido se `sourcePublicationId === publicationId` do manifesto canónico (`runtimeEmbeddingIndex.ts:211-213,459`) e os digests validam o conjunto (`validateSet`); qualquer das combinações cai para JSONL (se seguro). **Não existe janela em que o binário seja aceite com JSONL diferente**. O binário publica por ordem vetores → metadados → manifesto (marcador de commit).

## 7. Crash recovery (F-09)

| # | Cenário | Estado em disco | Arranque | Lifecycle | Ação |
|---|---|---|---|---|---|
| 1 | crash durante geração | checkpoint válido + canónico antigo | nada corre (sem recovery no arranque) | canónico antigo intacto; checkpoint reutilizável | nova geração reutiliza |
| 2 | durante staging | `*.tmp` parcial | tmp ignorado pelos leitores | inalterado | limpeza só na próxima geração |
| 3 | após JSONL, antes do manifesto | **W1** | **nenhum recovery** | par inconsistente tratado como registos "não válidos"; sem sinal explícito de inconsistência | recovery só em nova geração |
| 4 | após binário | binário completo ou parcial | `recoverBinaryEmbeddingPublication` **não é chamada** | dual-read rejeita por digest/`sourcePublicationId` ⇒ JSONL | — |
| 5 | antes da identidade (manifesto) | **W1/W2** | idem | idem | idem |
| 6 | depois da identidade | par novo + backups por limpar | backups órfãos até próxima geração | consistente | limpeza futura |
| 7 | fecho durante rename | W1/W2 conforme o rename | idem | idem | idem |
| 8 | purge/rebuild interrompido | ver §11 | idem | `exists=false` com identidade no manifesto (p2/P3) | — |
| 9 | perda de ownership | fence recusa o próximo passo; estado parcial possível entre dois passos | recovery com fence recusa em standby (`ownership-fence-rejected`) | — | outro produtor recupera |
| 10 | `.tmp`/órfãos | ficheiros em `.lina/producer/*` | nunca limpos no arranque | ignorados | limpeza em geração/recovery |

**Interpretação de dados parciais como válidos?** **FACTO:** (i) **JSONL truncado em fronteira de linha** é lido como `readable` com menos registos que `manifest.totalEmbeddings` (p2: manifesto 3, ficheiro 2, `readability=readable`); (ii) truncado a meio de linha é detetado como registo inválido (`invalidRecordCount=1`). **INFERÊNCIA (mitigação):** a validade de pesquisa é decidida por registo (`textHash`/`embeddingInputHash` contra `chunks.jsonl`, identidade publicada), pelo que vetores truncados dão *menos cobertura*, não vetores errados — mas sem aviso de corrupção.

## 8. Ownership / fencing (LINA-15A)

| Caminho de escrita | Fence `{deviceId, epoch}` | Antes de |
|---|---|---|
| `writeEmbeddingCheckpoint` | **sim** | escrita e cada rename |
| `publishCanonicalEmbeddings` | **sim** | início, cada backup, cada rename |
| `recoverEmbeddingPersistenceArtifacts` | **sim** (início) | recovery mutável |
| `purgeOrphanEmbeddingRecords` | **sim** (republicação via publish; ramo "tudo purgado" antes do `remove` e do `write`) | purge |
| `saveTextIndex` (escreve `manifest.json`/notes/chunks) | **não** — só gates de montante (`canPublish`) | — |
| `BinaryEmbeddingPublisher` | **não** — só `BinaryWorker.canPublish` | — |
| `loadEmbeddingCheckpoint` (apaga checkpoint inválido), `removeEmbeddingCheckpoint` | **não** (chamados após recovery já com fence) | — |

**FACTO:** o parâmetro `fence` é opcional em todas as APIs; `main.ts` só o passa se `acquireFence` existir (`hasFenceSupport`) — o `OwnershipGate` real tem-no sempre (caminho sem fence só para *test doubles*). **RISCO inerente:** TOCTOU — a verificação lê `ownership.json` e o rename ocorre depois; não há exclusão mútua cross-device (sem locking no sistema de ficheiros partilhado).

## 9. Producer / Companion

**FACTO:** `src/companion/**` não escreve; `acquireFence()` devolve `undefined` para não-Producer/standby (`ownershipGate.ts:210`), pelo que purge e geração retornam sem escrever; `ReconciliationWorker`/`TextIndexWorker`/`BinaryWorker` verificam `canPublish`. Um "Desktop Companion" tem capacidades de plataforma `canMaintainTextIndex`, mas é travado pelo gate (F-22 da auditoria global). **Companion não pode executar recovery local** (`recoverEmbeddingPersistenceArtifacts` exige fence). Escreve apenas `.lina/devices/<id>.json` (por dispositivo). **Conclusão:** a persistência não cria segunda autoridade; a autoridade é `ownership.json`.

## 10. Sincronização (agnóstica ao mecanismo)

- **FACTO:** o contrato público (README/manual) é: sincroniza-se `.lina/index/` (+ ownership/devices); **`.lina/producer/` não é para sincronizar**, mas como está dentro do vault a exclusão depende do utilizador. Sem exclusão, `*.tmp` e backups (incluindo um **`manifest.publish.backup` antigo**) podem propagar-se; **nenhum leitor os consome** (só a recuperação do Producer).
- **RISCO (P-03):** o par `embeddings.jsonl`/`manifest.json` sincroniza como dois ficheiros independentes: qualquer ordem de chegada produz uma janela W1/W2 **no dispositivo recetor**, e uma resolução de conflito que escolha versões diferentes de cada ficheiro dá um par inconsistente. O JSONL **não transporta `publicationId`**: a ligação ao manifesto é só por contagem + dimensões + provider/modelo (e por `textHash` por registo). Um par com mesmo modelo/dimensões e *mesma contagem* mas gerações diferentes não é detetado ao nível do par (detetado, sim, por registo desatualizado).
- **FACTO:** `manifest.json` é simultaneamente marcador do índice textual e da identidade de embeddings — a janela W2 e a janela de `saveTextIndex` (p2/P4: durante `saveTextIndex`, `manifest.json` **e** `chunks.jsonl` estão ausentes) expõem "índice textual ausente" a quem ler/sincronizar nesse instante.

## 11. Leitura e validação

| Leitor | Estrutura | Identidade | Tamanho | Truncagem | Contagem vs manifesto | Notas |
|---|---|---|---|---|---|---|
| `validateCanonicalFiles` (publicação/recovery) | sim | sim | n/a | sim (`requireTrailingNewline` só no checkpoint) | **sim** (`totalEmbeddings`, dimensões, duplicados, contrato) | **só usado em publicação/recovery, não em leitura** |
| `readCanonicalEmbeddingFileState` (estado) | `JSON.parse` por linha, **linhas inválidas viram `undefined` sem falhar** | via `calculateEmbeddingState` | `evaluateEmbeddingBridgeRead` (`resource-limit-exceeded`, 15C) | **não** | **não** | distingue `missing/empty/readable/unreadable/resource-limit` |
| `RuntimeEmbeddingIndexCache` (pesquisa) | `parseJsonlRecords` (linha inválida ⇒ `null`) | manifesto `embeddingInput.version === 1` **fixo** | guardas de pico | **não** (sem `\n` final não é erro) | **não** | binário: digests sha256 + `sourcePublicationId` |
| `readTextIndexStatus` | completo (digests, contagens) | `generationId` | limites | sim | **sim** | modelo a seguir |

Distinções do modelo canónico (ausência/vazio/ilegível/limite de recursos): **convergem** com a 15C/15D no estado de embeddings; **corrompido-por-truncagem** e **par inconsistente** não têm categoria própria.

## 12. Purge, rebuild e limpeza (F-08)

**FACTO (`purgeOrphanEmbeddingRecords`):** com registos remanescentes republica via `publishCanonicalEmbeddings` (fenced, atómico). **Ramo "tudo purgado":** `remove embeddings.jsonl` e depois `adapter.write(manifest.json)` **in-place** (sem staging nem backup). Probe p2/P3 (crash após o `remove`): `embeddings.jsonl` ausente, **`manifest.embeddingsEnabled=true` com secção `embeddings` intacta** ⇒ estado `exists=false` com identidade publicada; fail-closed para pesquisa, mas inconsistente, e uma escrita in-place interrompida a meio deixaria o **manifesto partilhado** truncado (RISCO).

**Coordenação (FACTO por leitura de código):** `reconcileIndexExclusionsInRuntime` (zero-update e pós-batch) chama `saveTextIndex` e `purgeOrphanEmbeddingRecords` **sem** `IndexWriteCoordinator`; o `ReconciliationWorker` só espera pelas atualizações automáticas de texto e **não** pela geração de embeddings. **INFERÊNCIA/RISCO:** purge/`saveTextIndex` podem sobrepor-se a uma geração em curso; ambos usam os mesmos nomes de staging (`embeddings.publish.tmp`, `manifest.publish.tmp`) e `saveTextIndex` faz *read-modify-write* do `manifest.json` (preserva `embeddings` lida no início): uma publicação de embeddings entre a leitura e a publicação do manifesto de texto seria perdida (par inconsistente). **Não reproduzido** (exige concorrência real); classificado como risco.

**Rebuild textual:** `rebuildTextIndex` usa o coordenador (exclusivo com geração) — conforme AGENTS. **Limpeza:** `cleanupPaths` só remove nomes conhecidos; nunca corre sem fence (recovery) — conforme; **não** corre no arranque.

## 13. Testes existentes

| Categoria | Cobertura |
|---|---|
| Atomicidade/ordem | `embeddingPersistence.test.ts` (67): ordem JSONL→sidecar, backup antes de substituir, manifesto depois dos embeddings, retry de rename transitório |
| Rollback | falha de candidato, de rename, de validação do manifesto, de limpeza (aviso) |
| Crash recovery | restaura backup válido; primeira publicação interrompida (2 testes); idempotência; não remove ficheiros desconhecidos; restaura checkpoint |
| Corrupção/truncagem | checkpoint truncado, sidecar órfão/inválido; **JSONL canónico sem `\n` final aceite** |
| Ownership/fence | 2 testes (checkpoint e publicação com fence revogado); `ownershipGate.test.ts` (fence/epoch) |
| Purge | `artifactInvalidationAndDefensiveFiltering` (purge de órfãos; binário desatualizado) |
| Binário | `embeddingBinaryStorage.test.ts` (19), `embeddingBinaryCopyController.test.ts` (12) incl. recuperação (backup/temporário) |
| Coordenador | geração/rollback mantêm o coordenador adquirido |

**Lacunas:** (a) nenhum teste de **crash entre os dois renames do par** (W1/W2) nem do estado observado pelos leitores; (b) **sem teste de truncagem em fronteira de linha** nem de contagem-vs-manifesto na leitura; (c) **sem teste do ramo purge "tudo purgado"** interrompido; (d) **sem teste de concorrência** purge/`saveTextIndex` × geração; (e) `saveTextIndex` sem teste de janela/fence; (f) **sem teste de `recoverBinaryEmbeddingPublication` integrada no arranque** (não existe chamada); (g) sem teste de conflito/sincronização de par; (h) sem teste do arranque com órfãos `*.tmp`.

## 14. Matriz de risco

| Cenário | Integridade | Recuperação | Lifecycle | Risco |
|---|---|---|---|---|
| escrita incompleta (tmp) | canónico intacto | limpeza só na próxima geração | inalterado | **LOW** |
| JSONL novo / binário antigo | binário rejeitado (`publicationId`) | JSONL | `read.source=jsonl` | **LOW** |
| binário novo / JSONL antigo | binário rejeitado | JSONL | idem | **LOW** |
| identidade publicada prematuramente | não existe (manifesto é o último rename) mas **par W1** inconsistente | só na próxima geração; sem sinal de inconsistência | registos "não válidos" ⇒ `INCOMPATIBLE`/rebuild | **MEDIUM** |
| crash entre renames (W1/W2) | par inconsistente / `manifest.json` ausente | recovery restaura **antigo** (perde geração nova) | W2: `NO_TEXT_INDEX` transitório | **MEDIUM** |
| ownership perdido | fence trava passos seguintes; parcial possível | outro produtor recupera | `ownership-lost` | **MEDIUM** (TOCTOU inerente) |
| `.tmp` órfão | sem efeito em leitores | manual/geração | n/a | **LOW** |
| conflito de sincronização | par possivelmente inconsistente; sem `publicationId` no JSONL | nenhuma automática | por registo | **MEDIUM** |
| purge interrompido | embeddings removido + manifesto a declarar embeddings; escrita in-place do manifesto partilhado | nenhuma | `exists=false`+identidade | **MEDIUM** |
| rebuild interrompido | coberto pelo protocolo do índice textual | recovery de texto | — | **LOW** |

## 15. Compatibilidade

**FACTO:** manifestos sem `publicationId` ⇒ cópia binária desativada (`legacy-manifest`) e cache sem marcador; sem `embeddingInput` ⇒ `parseManifestEmbeddingInfo` devolve `null` (sem índice runtime; o plano trata como identidade incompleta ⇒ rebuild, 15B); **`embeddingInput.version` ≠ 1 é rejeitado pelo leitor runtime** (hard-coded) — um futuro `EMBEDDING_INPUT_VERSION` ≠ 1 exige migration/atualização do leitor. Checkpoint `schemaVersion=1`, ownership `schemaVersion=1`. Campos adicionais no manifesto são preservados (`...currentManifest`). **Exige migration futura:** bump de `inputVersion`; marcador de par no JSONL (se adotado). **Só compatibilidade de leitura:** manifestos legados, ausência de `provenance`/`vectorContract`.

## 16. Findings

| ID | Sev. | Tipo | Descrição |
|---|---|---|---|
| **P-01** | MEDIUM | RISCO | Par canónico `(embeddings.jsonl, manifest.json)` sem substituição atómica; janelas W1/W2 demonstradas (p1/p1b); em W2 o manifesto do índice textual desaparece. |
| **P-02** | MEDIUM | DÍVIDA (F-09) | Recovery só no início de uma geração; nunca no arranque; backups/tmp órfãos persistem; `recoverBinaryEmbeddingPublication` sem chamador. |
| **P-03** | MEDIUM | DÍVIDA (F-10) | Leitores não validam contagem/truncagem/par; JSONL sem `publicationId`; truncagem em fronteira de linha aceite (p2). |
| **P-04** | MEDIUM | DÍVIDA (F-08) | Purge/reconciliação fora do coordenador; ramo "tudo purgado" não atómico (p2/P3) com escrita in-place do manifesto partilhado. |
| **P-05** | MEDIUM | RISCO (inferência) | `saveTextIndex` faz *read-modify-write* do manifesto partilhado, sem fence, e sem exclusão em relação à reconciliação; risco de *lost update* da secção `embeddings`. |
| **P-06** | LOW | DÍVIDA | Publisher binário sem fence (só `canPublish` de montante). |
| **P-07** | LOW | RISCO | Fence opcional nas APIs; TOCTOU inerente sem lock cross-device. |
| **P-08** | LOW | INFORMATIVO | Sem `fsync`/flush (limite da API `DataAdapter`); durabilidade delegada ao SO. |
| **P-09** | LOW | DÍVIDA | Leitor runtime exige `embeddingInput.version === 1`. |
| **P-10** | INFO | DÍVIDA | Exclusão sync de `.lina/producer/` depende do utilizador. |
| **Riscos 15D-B** | — | — | `dimensions ?? 0` em `EmbeddingIndexStatus` (visível nos probes como `dimensions:0` em estado de erro; o controller já ignora `0`); evidência booleana em `DeviceRuntimeState` (não afeta persistência); `INDETERMINATE` pré-refresh (não persiste nada). |

## 17. Respostas obrigatórias

1. **Artefacto canónico:** `embeddings.jsonl` + `manifest.json` (identidade/commit). O binário é derivado.
2. **Ordem das escritas:** §5 (JSONL antes do manifesto; manifesto por último).
3. **Atomicidade real:** por ficheiro (tmp+validação+rename+backup); **não** para o par.
4. **Se o processo morrer a meio:** W1/W2 (§6); recovery só na próxima geração; restaura o par antigo.
5. **Identidade publicada para artefactos inconsistentes:** **sim, transitoriamente** (W1: manifesto antigo + JSONL novo; leitores tratam registos como não válidos, sem sinal de inconsistência).
6. **Todo o caminho de escrita fenced:** **não** — `saveTextIndex` e o publisher binário só têm gate de montante; fence opcional.
7. **Companion escreve?** Embeddings: não. Apenas o seu `.lina/devices/<id>.json`.
8. **Sincronizáveis:** `.lina/index/*`, `ownership*`, `devices/*`; `.lina/producer/*` não previsto (exclusão por conta do utilizador).
9. **`.tmp`/órfãos:** ignorados pelos leitores; limpos só em recovery/geração com fence.
10. **F-08:** **parcialmente resolvido** (fence adicionado na 15A; coordenador e atomicidade do ramo final em dívida — P-04). **F-09:** **em dívida** (P-01/P-02). **F-10:** **em dívida** (P-03).

**A persistência não é declarada "segura"**: é *fail-closed e recuperável* na maioria dos cenários, mas com janelas de inconsistência de par e sem deteção explícita de truncagem/par.

## 18. Recomendações e fases seguintes

- **LINA-15H-B (P-02, P-03, F-09/F-10):** recovery no arranque do Producer (com fence) e **validação de par/contagem/truncagem na leitura** (categoria canónica "par inconsistente/truncado" ⇒ `INCOMPATIBLE`/rebuild, nunca `readable`); considerar `publicationId`/digest do JSONL no manifesto (exige decisão de schema).
- **LINA-15H-C (P-04, F-08):** purge sob coordenador e com publicação atómica no ramo "tudo purgado".
- **LINA-15H-D (P-05, P-01 parte W2):** `saveTextIndex` com fence e exclusão face à reconciliação; avaliar separar o marcador do índice textual da identidade de embeddings (migration).
- **LINA-15H-E (P-06):** fence no publisher binário e chamada de `recoverBinaryEmbeddingPublication` sob fence.
- Testes primeiro (lacunas a–h §13). Nenhuma fase altera `data.json`.

## 19. Garantias desta fase

Nenhum ficheiro de produção, teste, schema ou `data.json` alterado; nenhum embedding gerado; nenhuma chamada externa; probes fora do repositório; sem commit nem push.
