# LINA-15H-C — AUDITORIA DA PUBLICAÇÃO ATÓMICA, PURGE E COORDENAÇÃO DAS MUTAÇÕES

> **Fase:** LINA-15H-C-A (apenas auditoria; sem alteração de código, testes, schemas, `data.json` ou embeddings)
> **Data:** 2026-10-02 · **Branch:** `master` · **Base:** `57ec4f0` (LINA-15H-B)
> **Prompt-mestra:** `PROMPT-MESTRA-LINA-004` não existe no repositório (registado em 15D-A); prevalecem `AGENTS.md`, `docs/INDEX.md` e a documentação das LINA-14 e 15A–15H-B.
> **Legenda:** **FACTO** (código ou probe) · **INFERÊNCIA** · **HIPÓTESE** · **RECOMENDAÇÃO**.
> **Probes:** `q1`–`q5` (scratchpad da sessão, **fora do repositório**), compilados contra o código de produção real com `FakeAdapter` em memória. Sem providers, sem embeddings reais, sem vault do utilizador. Uma "falha na operação N" significa que a N-ésima operação mutável (`write`/`remove`/`rename`/`mkdir`) e todas as seguintes falham, o que simula morte do processo; depois corre-se o recovery de arranque da 15H-B com fence válida.

---

## 1. Objetivo

Determinar se a **própria publicação** (e o purge/rebuild que a rodeiam) pode criar estados inconsistentes que depois obrigam ao recovery da 15H-B; se as mutações são coordenadas entre si, suficientemente atómicas dentro dos limites reais do `DataAdapter` e protegidas pelo fencing `{deviceId, epoch}` da 15A; e qual é a alteração mínima que fecha F-08.

## 2. Metodologia

Leitura integral do protocolo de publicação (`publishCanonicalEmbeddings`), do purge (`purgeOrphanEmbeddingRecords`), do recovery (`recoverEmbeddingPersistenceArtifacts`, `recoverCanonicalEmbeddingsAtStartup`), do publisher/controller binário, de `saveTextIndex`, do `IndexWriteCoordinator`, do `OwnershipGate`, e de todos os chamadores em `main.ts` (reconciliação de exclusões, lotes automáticos, rebuild, geração, `onunload`). As conclusões das auditorias 15H-A/15H-B **não** foram assumidas: cada afirmação relevante foi revalidada contra o código pós-15H-B. Cinco probes:

| Probe | Demonstra |
|---|---|
| `q1` | crash em `saveTextIndex`; purge sobre par truncado; crash no ramo "tudo purgado"; recovery vs. rebuild de texto (Q1–Q4) |
| `q2` | interleavings determinísticos purge × publicação e `saveTextIndex` × publicação (corridas A e B) |
| `q3` | semântica do `IndexWriteCoordinator` (lease de ranhura única) |
| `q4` | matriz exaustiva de crash da publicação (8 + 6 operações) seguida do recovery 15H-B |
| `q5` | matriz exaustiva de crash de `saveTextIndex` (12 operações) seguida do recovery 15H-B |

## 3. Inventário de escritores

Todos operam sobre `.lina/index/` (canónico) ou `.lina/producer/` (staging/backups/checkpoints). **FACTO:** não há `vault.modify/create/delete` nestes caminhos.

| Escritor | Artefacto | Operação | Coordenação (`IndexWriteCoordinator`) | Fencing | Ownership |
|---|---|---|---|---|---|
| `publishCanonicalEmbeddings` (via geração) | `embeddings.jsonl`, `manifest.json`, backups/tmp | stage → backup → rename ×2 → limpeza | **sim** (`embedding-generation`) | **sim**: `assertWriteFence` antes de início e de cada rename | gate de montante + fence |
| `publishCanonicalEmbeddings` (via purge) | idem | idem | **não** | sim (se `fence` passado) | `acquireFence()` **com auto-claim** |
| `purgeOrphanEmbeddingRecords` (ramo "tudo purgado") | `embeddings.jsonl` (remove), `manifest.json` (**write in-place**), checkpoint | `remove` + `write` | **não** | sim, antes do `remove` e do `write` | idem |
| `writeEmbeddingCheckpoint` | checkpoint + sidecar | stage → backup → rename | sim (geração) | **sim** | fence |
| `removeEmbeddingCheckpoint` / `loadEmbeddingCheckpoint` (limpeza de inválido) / `cleanupPaths` pós-commit | checkpoint, backups | `remove` | sim (geração) | **não** | só artefactos operacionais |
| `recoverEmbeddingPersistenceArtifacts` (arranque) | tmp, backups, canónicos | `write`/`remove`/`rename`/`mkdir` | **sim** (lease `binary-maintenance`) | **sim**, por chamada mutável (proxy) | fence sem auto-claim (15H-B) |
| `recoverEmbeddingPersistenceArtifacts` (início de geração) | idem | idem | sim (`embedding-generation`) | sim | `acquireFence()` **com auto-claim** |
| `saveTextIndex` (rebuild) | `notes.json`, `chunks.jsonl`, `manifest.json` (**partilhado**) | tmp ×3 → backup ×3 → rename ×3 | sim (`text-rebuild`) | **não** | `canPublish()` no início; `evaluateProvenance()` antes de gravar |
| `saveTextIndex` (lote automático) | idem | idem | sim (`text-automatic-batch`, ver C-04) | **não** | `isAuthorizedSync()` (decisão em cache) + `getProvenance()` síncrono |
| `saveTextIndex` (reconciliação, ramo "sem alterações") | idem | idem | **não** | **não** (fence só no purge seguinte) | `acquireFence()` com auto-claim |
| `BinaryEmbeddingPublisher` | `embeddings.binary.manifest.json`, `.meta.jsonl`, `.vectors.f32` | tmp → backup → rename ×3 | sim (`binary-maintenance`) | **sim** (adapter com proxy, 15H-B) | fence sem auto-claim |
| `BinaryEmbeddingCopyController.remove` | trio binário | `remove` | sim (`binary-maintenance`) | **sim** | idem |
| `recoverBinaryEmbeddingPublication` | trio binário | restaurar/limpar | sim (startup, lease) | sim | idem |
| `producerState`/`deviceState`/`ownership*` | `.lina/**` | tmp + backup + rename | n/a | n/a | n/a (fora do âmbito dos embeddings) |

Shutdown/cancelamento não escrevem artefactos próprios (ver §11). **Companion/Standby/Unassigned:** nenhum caminho acima corre sem `acquireFence()`/`canPublish()` positivo (herdado da 15A/15H-A; reconfirmado).

## 4. Fluxo real de publicação

`publishCanonicalEmbeddings` (`src/index/embeddingPersistence.ts:901-1044`), **FACTO**. "Estado intermédio" refere-se ao que um leitor externo vê.

| # | Passo | Operação | Estado intermédio | Crash? | Concorrência | Fence | Rollback |
|---|---|---|---|---|---|---|---|
| 1 | `ensureProducerWorkDirectories` | `mkdir` (se faltar) | nenhum | benigno | — | **não** (`mkdir`) | n/a |
| 2 | `assertWriteFence`; ler `manifest.json` | `read` | nenhum | — | RMW do manifesto | sim | n/a |
| 3 | serializar + validar candidato e par em memória | — | nenhum | — | — | — | n/a |
| 4 | `write embeddings.publish.tmp`; reler/validar | `write`,`read` | tmp órfão (invisível a leitores) | sim → tmp | staging partilhado com purge/geração | não (só no passo 1) | `cleanupPaths` |
| 5 | `write manifest.publish.tmp`; reler/validar o **par** | `write`,`read` | tmp órfão | sim | idem | não | idem |
| 6 | apagar backups antigos | `remove` ×2 | nenhum | — | — | não | n/a |
| 7 | `assertWriteFence`; `rename embeddings.jsonl → embeddings.publish.backup` | `rename` | **JSONL ausente**, manifesto antigo | sim | — | **sim** | rename inverso |
| 8 | `assertWriteFence`; `rename embeddings.publish.tmp → embeddings.jsonl` | `rename` | **W1**: JSONL novo + manifesto antigo | sim | — | **sim** | remove novo + rename inverso |
| 9 | reler/validar o JSONL publicado | `read` | W1 | — | — | — | idem |
| 10 | `assertWriteFence`; `rename manifest.json → manifest.publish.backup` | `rename` | **W2**: JSONL novo, **`manifest.json` ausente** (também o do índice textual) | sim | — | **sim** | rename inverso ×2 |
| 11 | `assertWriteFence`; `rename manifest.publish.tmp → manifest.json` | `rename` | **commit**: par novo + backups | sim | — | **sim** | remove novo + backups de volta |
| 12 | `validateCanonicalFiles` | `read` | par novo | — | — | — | rollback se inválido |
| 13 | limpar backups e checkpoint | `remove` ×4 | par novo, resíduos | benigno | — | **não** | n/a (pós-commit) |

**FACTO:** não há `fsync`/`flush` na API `DataAdapter`; a durabilidade é delegada ao SO. O ponto de commit lógico é o passo 11 (o manifesto é o último a entrar e transporta `publicationId`). O rename com retry (`renameEmbeddingPersistenceArtifact`) só repete falhas transitórias `EBUSY`/`EPERM` e nunca recria o tmp.

## 5. Crash matrix

### 5.1 Publicação de embeddings (probe `q4`, exaustiva)

**Atualização (JSONL antigo `m1`/2 registos → novo `m2`/3 registos; 8 operações mutáveis).** "Falha em N" = a operação N falha.

| N | Operação que falha | Disco (JSONL, manifest) | Arranque, antes do recovery (par / índice textual) | Após recovery 15H-B (par / geração) | Perda? |
|---|---|---|---|---|---|
| 1–2 | `write` tmp | 2 regs, Y | consistent / ready | consistent / `m1`/2 | não |
| 3 | `rename` JSONL → backup | 2 regs, Y | consistent / ready | consistent / `m1`/2 | não |
| 4 | `rename` tmp → JSONL | **ausente**, Y | inconsistent / ready | consistent / `m1`/2 | nova geração (checkpoint preservado) |
| 5 | `rename` manifest → backup (**W1**) | 3 regs, Y antigo | inconsistent / ready | consistent / `m1`/2 | nova geração (checkpoint) |
| 6 | `rename` tmp → manifest (**W2**) | 3 regs, **manifest ausente** | inconsistent / **missing** | consistent / `m1`/2 | nova geração (checkpoint) |
| 7–8 | `remove` de backups (pós-commit) | 3 regs, Y novo | consistent / ready | consistent / `m2`/3 | não |

**Primeira publicação (manifesto só textual → `m2`/3 registos; 6 operações).**

| N | Operação que falha | Disco | Antes do recovery | Após recovery | Observação |
|---|---|---|---|---|---|
| 1–3 | tmp / rename tmp → JSONL | JSONL ausente, Y | absent / ready | absent / none | nada a recuperar |
| 4 | `rename` manifest → backup | **JSONL novo + manifest textual** | inconsistent / ready | **inconsistent / none** | JSONL órfão **não promovido** (política 15H-B); cobertura de custo depende do checkpoint (C-13) |
| 5 | `rename` tmp → manifest | JSONL novo, manifest ausente | inconsistent / missing | **absent**, manifesto textual restaurado, JSONL novo removido | consistente |
| 6 | `remove` do backup (pós-commit) | par novo | consistent / ready | consistent / `m2`/3 | não |

**FACTO (resultado central):** em **todos** os 14 pontos de falha, depois do recovery de arranque o par fica `consistent`/`absent` (ou `inconsistent` só no ponto N=4 da primeira publicação, fail-closed) e **o índice textual volta a `ready`**. **Nenhum ponto produz publicação falsa** (`consistent` com identidade/geração errada). O trabalho gerado preserva-se no checkpoint, que só é apagado após o commit (passo 13).

### 5.2 `saveTextIndex` (probe `q5`, exaustiva; 12 operações mutáveis; manifesto partilhado com `embeddings{…}` válido)

| Falha em N | Disco (notes, chunks, manifest) | Índice textual (antes) | Após recovery 15H-B (texto / par) | Identidade de embeddings no manifesto | Órfãos `*.bak-*` |
|---|---|---|---|---|---|
| 1–4 | YYY | ready | ready / consistent | sim | 0 |
| 5 | `-YY` | invalid | invalid / consistent | sim | 1 |
| 6 | `--Y` | invalid | invalid / consistent | sim | 2 |
| **7** | **`---`** | missing | **missing / inconsistent** | **NÃO** | 3 |
| **8** | `Y--` | missing | **missing / inconsistent** | **NÃO** | 3 |
| **9** | `YY-` | missing | **missing / inconsistent** | **NÃO** | 3 |
| 10–12 | YYY | ready | ready / consistent | sim | 3 → 1 |

**FACTO:** três dos doze pontos de falha (N = 7–9) fazem desaparecer `manifest.json` — e com ele a **única cópia da identidade dos embeddings** — para `producer/backups/manifest.json.bak-<sufixo-aleatório>`, um nome **desconhecido** do recovery (só trata nomes determinísticos). Depois de um rebuild textual manual, o índice fica `ready`, o `embeddings.jsonl` continua em disco, mas o manifesto novo **não tem secção `embeddings`**: o par fica `inconsistent` (→ INCOMPATIBLE / reconstrução confirmada) sem qualquer caminho de recuperação (probe `q1`/Q1). Os backups e tmp aleatórios nunca são limpos.

### 5.3 Purge (probe `q1`, Q2/Q3)

| Cenário | Estado | Arranque / recovery |
|---|---|---|
| Ramo com registos remanescentes | reutiliza `publishCanonicalEmbeddings` → matriz 5.1 | coberto |
| Ramo "tudo purgado": falha entre `remove(JSONL)` e `write(manifest)` | `manifest.json` declara embeddings; JSONL ausente; `exists=false` com identidade publicada | `inconsistent`, recovery **não** faz nada (sem backups) → INCOMPATIBLE |
| Ramo "tudo purgado": falha a meio do `write` do manifesto | **HIPÓTESE** (não reproduzível com `FakeAdapter`, que escreve de forma atómica): `manifest.json` truncado ⇒ índice textual `invalid` | nenhum |

### 5.4 Rebuild textual

O rebuild processa em memória, cede ao renderer e só publica no fim (`saveTextIndex`); cancelamento/erro antes não publica nada. A matriz é a de 5.2. **FACTO:** o rebuild não toca em `embeddings.jsonl`; apenas preserva a secção `embeddings` do manifesto. Os registos ficam `stale`/`obsolete` por hash de chunk, não por inconsistência de par.

## 6. Atomicidade real

**Atomicidade de um rename vs. atomicidade da publicação lógica.**

- **FACTO:** a unidade atómica disponível é o `rename` de **um** ficheiro; a API não oferece rename de pasta nem transação multi-ficheiro, nem `fsync`. `FakeAdapter.failRenameIfDestinationExists` documenta que o projeto assume destinos não substituíveis (mobile); por isso todo o protocolo move o destino **para fora** antes de mover o tmp para dentro. Não se assume substituição atómica por rename.
- **FACTO:** `JSONL + manifest` **não** são publicados atomicamente; são publicados como **unidade lógica com ponto de commit** (rename do manifesto, passo 11), com backups e recovery como mecanismo de roll-back. Estados intermédios aceitáveis (e verificados em 5.1): tmp órfão, W1, W2, JSONL ausente, resíduos de backup pós-commit.
- **FACTO:** o binário **não** pertence à unidade: é derivado e só é aceite se `sourcePublicationId === publicationId` do manifesto e digests/contagem coincidirem (15H-B). Qualquer ordem entre binário e JSONL/manifest é segura para a leitura.
- **Sequência mínima segura (já implementada):** validar tudo em tmp → mover antigo para backup → mover novo para dentro → manifesto por último → validar → limpar. O que **falta** não é a sequência dos escritores de embeddings, mas (a) o mesmo rigor nos escritores do **manifesto partilhado** (`saveTextIndex`, purge) e (b) exclusão entre todos os escritores (§9).
- **Limite estrutural:** enquanto o par for dois ficheiros com nomes fixos, existe sempre uma janela em que `manifest.json` **não existe** (passos 10→11 e, em `saveTextIndex`, passos de backup→publicação). Eliminá-la exige um ponto de commit de **um único** rename (ex.: JSONL com nome por publicação + um só rename do manifesto) — alteração de formato persistido, **fora do âmbito** desta fase (ver §15-E).

## 7. Purge

**FACTO (`purgeOrphanEmbeddingRecords`; chamado só de `reconcileIndexExclusionsInRuntime`, `main.ts:2242` e `:2274`):**

| Aspeto | Estado atual |
|---|---|
| Início | reconciliação de exclusões após alteração de settings (efeito pós-save) |
| Autorização | `getDeviceCapabilities().canMaintainTextIndex` + `ReconciliationWorker.run` → `canPublish()` (decisão em cache) + `gate.acquireFence()` |
| Ownership/epoch | fence capturada **sem** `autoClaimIfUnclaimed:false` ⇒ herda auto-claim da gate; `assertWriteFence` antes do `remove`/`write` e dentro de `publishCanonicalEmbeddings` |
| **Coordenação** | **nenhuma**: o purge não adquire lease do `IndexWriteCoordinator` (nem no ramo sem alterações nem depois do lote) |
| Ficheiros removidos | `embeddings.jsonl` (ramo total); reescreve `manifest.json` |
| Ordem (ramo total) | `remove` JSONL → `write` **in-place** manifesto (sem tmp/backup) → limpa checkpoint |
| Validação prévia | `parseEmbeddingRecords(rawContent, undefined, dims, false)` — **ignora** `inspectCanonicalPair`/contagem do manifesto |
| Pós-condição | **nenhuma** invalidação da cache runtime nem `markEmbeddingWorkStatusDirty` depois do purge |

Cenários pedidos:

- **purge → crash:** ramo parcial = matriz 5.1 (coberto); ramo total = 5.3 (`inconsistent`, fail-closed, sem perda útil porque não restam registos).
- **purge → ownership perdido:** fence verificada antes de cada passo; entre o `remove` e o `write` do ramo total a perda de ownership deixa o estado de 5.3 (sem backup). **Fence + `assert` mitigam, não eliminam, o TOCTOU inerente.**
- **purge → geração concorrente:** **corrida demonstrada** (probe `q2`, corrida A). O purge lê o JSONL e o manifesto no início; uma geração publica um par novo; o purge republica com os registos antigos e a `info` antiga. Resultado: a publicação nova é **substituída silenciosamente** por uma versão anterior (par `consistent`, `publicationId` novo), indetetável por qualquer validador. No caso extremo (mudança de modelo concluída entre a leitura e a republicação) o purge **repõe a identidade do modelo antigo**. Os dois lados usam os mesmos nomes de staging (`embeddings.publish.tmp`, `manifest.publish.tmp`).
- **purge → recovery:** recovery corre sob lease `binary-maintenance` no arranque; o purge só corre depois da reconciliação (que está depois do recovery). Sem sobreposição no arranque; sobreposição possível a meio da sessão apenas com a geração (acima).
- **purge → sincronização:** ver §12.

**Conclusão:** o purge é uma **operação destrutiva** (remove ficheiro, reescreve identidade partilhada) e deve estar sujeita aos mesmos gates que a geração: lease exclusivo, fence sem auto-claim, validação do par antes de agir, e escrita do manifesto sempre via protocolo tmp+backup+rename.

## 8. `saveTextIndex`

**FACTO (`src/index/indexStore.ts:347-515`; chamadores `main.ts:2221`, `:2458`, `:3669`):**

| Questão | Resposta |
|---|---|
| Quem chama | (1) `rebuildTextIndexInternal` (sob lease `text-rebuild`); (2) `processAutomaticIndexUpdateBatch` (lease `text-automatic-batch`); (3) `reconcileIndexExclusionsInRuntime`, ramo "sem alterações" (**sem lease**) |
| Que ficheiros altera | `notes.json`, `chunks.jsonl` e **`manifest.json`** |
| Altera `manifest.json`? | **Sim**: lê o manifesto no início, preserva a secção `embeddings`/`embeddingInput`/`embeddingsEnabled` e republica o manifesto inteiro (**read-modify-write**) |
| Pode ocorrer durante geração? | Rebuild/lote: **não** (rejeitados pelo coordenador). Ramo (3): **sim** (sem lease) |
| Fencing | **nenhum** (`saveTextIndex` não recebe fence); montante: `isAuthorizedSync()` em cache e, no rebuild, `canPublish()` no **início** de um processo potencialmente longo |
| Janela incompatível com embeddings | **sim**: 3 de 12 pontos de crash perdem a identidade (5.2); corrida B (probe `q2`): publicação de embeddings entre a leitura e a escrita do manifesto ⇒ manifesto com a contagem antiga e JSONL novo ⇒ par `inconsistent` |
| Protocolo | faz backup dos **três** ficheiros antes de publicar **qualquer** um (todos ausentes entre os dois ciclos) com backups/tmp de **sufixo aleatório** (`<ficheiro>.bak-<ts>-<rand>`), que o recovery desconhece e nunca limpa |
| Aborta sem proveniência? | **não**: `provenance` indefinida (ownership perdido) é simplesmente omitida do manifesto e a escrita prossegue |

**Relação factual texto ↔ embeddings:** partilham **um ficheiro** (`manifest.json`) com dois escritores independentes e dois protocolos diferentes. Não precisam do mesmo mecanismo de escrita, mas **precisam** da mesma exclusão e da mesma fence, porque o manifesto é um recurso partilhado de leitura-modificação-escrita.

## 9. Concorrência

`IndexWriteCoordinator` é uma **ranhura única** (`activeOperation` + `activeStartedAt`), não um conjunto de leases. Probe `q3` (FACTO):

| Cenário | Resultado |
|---|---|
| `startAutomaticBatch` com um lote já ativo | **accepted** (sobrescreve a ranhura) |
| `finish(B)` enquanto A ainda grava | ranhura fica `null` ⇒ `startEmbeddingGeneration` **accepted** com A ativo |
| `startTextRebuild` com lote ativo | **accepted** (a exclusão rebuild×lote vive em `activeAutomaticIndexUpdates` no host, não no coordenador) |
| `startAutomaticBatch` com rebuild ativo | `text-index-busy` |
| `startBinaryMaintenance` com lote ativo | `text-index-busy` |

Matriz de combinações (bloqueio / single-flight / fence / corrida / resultado):

| Combinação | Bloqueio | Fence | Corrida | Resultado |
|---|---|---|---|---|
| geração × geração | **sim** (`startEmbeddingGeneration` rejeita; single-flight do Operation Manager) | sim | não | seguro |
| geração × purge | **não** (purge sem lease) | parcial | **sim** (C-01) | publicação substituída silenciosamente |
| geração × recovery (arranque) | **sim** (lease `binary-maintenance`) | sim | não | seguro |
| geração × `saveTextIndex` (rebuild/lote) | **sim**, **exceto** lotes sobrepostos (C-04) | não | latente | seguro com ressalva |
| geração × `saveTextIndex` (ramo reconciliação) | **não** | não | **sim** (C-02) | par `inconsistent` |
| purge × recovery | **não** (recovery só no arranque, purge só depois) | sim | não no arranque | seguro hoje; frágil a futuras chamadas |
| purge × `saveTextIndex` (lote) | **não** | não | **sim** (ambos RMW do manifesto) | perda de atualização |
| purge × sync / recovery × sync | n/a | n/a | exterior | ver §12 |

**Pontos de `await` entre operações de filesystem (FACTO):** cada rename do protocolo está separado por `assertWriteFence` (leitura de `ownership.json`) — é aí que callbacks, workers e o dispatch automático podem intercalar; o único atenuante é o lease. Há ainda `onPersisting` **antes** do primeiro passo mutável da publicação (ponto de não retorno antecipado, benigno). O `EmbeddingScheduler` só despacha via `requestEmbeddingIndexGeneration("automatic")` → Operation Manager/coordenador; não escreve diretamente.

## 10. Ownership / fencing

| Cenário | Publicação de embeddings | Purge | `saveTextIndex` |
|---|---|---|---|
| ownership válido | escreve | escreve | escreve |
| perdido **antes** da publicação | `assertWriteFence` no passo 2/7 → falha limpa, nada durável | idem (fence no início / antes do `remove`) | **escreve** (sem fence; decisão em cache) |
| perdido **entre renames** | falha no `assert` seguinte; estado W1/W2 recuperável por 15H-B | falha entre `remove` e `write` ⇒ 5.3 | n/a (sem fence) |
| perdido **durante purge** | idem | idem | — |
| epoch alterado por outro Producer | `assertFence` compara `producerDeviceId` **e** `epoch` | idem | **não detetado** |

**FACTO:** (a) a verificação lê `ownership.json` e o rename ocorre depois — TOCTOU inerente, sem lock cross-device; (b) `isAuthorizedSync()` devolve a **última decisão em cache** (e `true` se ainda não houve decisão) e só é refrescada por chamadas assíncronas pontuais (`evaluate()`/`canPublish()`), **não** periodicamente: os trabalhadores de texto decidem com informação potencialmente obsoleta; (c) o `OwnershipGate` de `main.ts` é criado com `autoClaim = true`: o purge e a geração chamam `acquireFence()` **sem** `{autoClaimIfUnclaimed:false}` — se `ownership.json` ainda não tiver chegado por sincronização, um dispositivo `producer` pode reivindicar epoch 1 a partir do purge (a 15H-B só fechou isto no recovery e na manutenção binária); (d) `assertFence` já usa `autoClaimIfUnclaimed:false`.

**Objetivo "nenhuma mutação durável depois da perda de autoridade":** cumprido para a publicação de embeddings, checkpoint, recovery e binário; **não cumprido** para `saveTextIndex` (todos os chamadores) nem para limpezas pós-commit de artefactos operacionais (C-12).

## 11. Cancelamento

| Operação | Comportamento (FACTO) | Pode deixar estado intermédio? |
|---|---|---|
| Geração antes de `persisting` | `abort` cooperativo; checkpoint preservado; canónico intacto | não |
| Geração em `persisting`/`finalizing` | `cancelOperation` devolve `non-cancellable`; a publicação termina e é apresentada como concluída | não |
| `dispose()` (unload) | `cancelOperation(…, false)` aborta o signal **mesmo para lá do ponto de não retorno**; **`publishCanonicalEmbeddings` não consulta o signal** e continua; o `IndexWriteCoordinator` é descartado, pelo que nada novo começa | só se o processo morrer (matriz 5.1) |
| Publicação | não tem cancelamento próprio | W1/W2 só por crash/revogação de fence (recuperáveis) |
| Purge | sem cancelamento; sem lease | 5.3 em crash |
| Rebuild textual | cancelamento cooperativo; só publica no fim | só por crash em `saveTextIndex` (5.2) |
| Recovery | cada chamada mutável revalida a fence (proxy); falha interrompe sem ultrapassar | backups completos preservados |

**FACTO:** nenhum cancelamento deixa `JSONL novo + manifest antigo`, `binário novo + JSONL antigo`, `.tmp` órfão ou `manifest` sem JSONL **sem que haja** crash ou revogação de fence; todos esses estados são os de 5.1/5.2 e (exceto os de 5.2/5.3) recuperados.

## 12. Sincronização externa

Sem assumir ferramenta. **FACTO/INFERÊNCIA:** uma sincronização observa **nomes de ficheiro**; o protocolo local faz **desaparecer o nome** `manifest.json` entre dois renames (publicação) e, em `saveTextIndex`, entre o primeiro backup e a última publicação (três nomes). Uma ferramenta que propague remoções pode entregar a um par o estado de 5.1-W2/5.2 N=7.

| Cenário | Efeito |
|---|---|
| A sincroniza antes de B | B recebe JSONL e/ou manifesto por ordem arbitrária ⇒ `inconsistent` fail-closed até convergir (15H-B; leitura não escreve) |
| B antes de A | idem; Companion/Standby não têm recovery nem escrita ⇒ aguardam convergência |
| `.tmp`/backups sincronizados | ignorados por todos os leitores; um `manifest.publish.backup` antigo ou `manifest.json.bak-*` propagado **não** é consumido; mas **não** são limpos pelo recetor |
| versão antiga permanece enquanto a nova chega | par antigo `consistent` até um dos membros mudar |
| purge local durante sincronização | o purge **reescreve** manifesto e JSONL (ou apenas o manifesto in-place); gera um `publicationId` novo ⇒ pode competir com uma publicação recebida (resolução de conflito escolhe versões diferentes por ficheiro) |

**Conclusão:** a publicação local **não piora** a convergência em relação ao estado atual do sistema (leitura fail-closed), mas o purge e o `saveTextIndex` introduzem janelas de ausência/regressão de `manifest.json` que o recetor não pode distinguir de uma publicação legítima.

## 13. Operações destrutivas

| Operação | Destrutiva? | Ownership/fence | Confirmação | Rollback | Recovery |
|---|---|---|---|---|---|
| Purge (ramo parcial) | substitui par | fence + `assert` | **nenhuma** (efeito pós-save de settings) | backup/rollback de `publishCanonicalEmbeddings` | 5.1 |
| Purge (ramo total) | **remove JSONL**, reescreve manifesto | fence | nenhuma | **nenhum** (in-place, sem backup) | nenhum |
| Rebuild de embeddings | substitui par | fence | **sim** (full-rebuild exige confirmação, 15B) | backup/rollback | 5.1 |
| Overwrite de manifesto (`saveTextIndex`) | reescreve identidade partilhada | **nenhuma** | sim para rebuild manual; não para lotes | backup aleatório | **nenhum** (5.2) |
| Remoção de JSONL | só via purge total / recovery de 1.ª publicação | fence | n/a | n/a | n/a |
| Remoção de binário | derivado | fence + lease | sim (UI) | n/a | rebuild do derivado |
| Substituição de manifest (publicação) | par | fence | confirmada a montante | sim | 5.1 |
| Limpeza de `.tmp`/backups | só nomes conhecidos | recovery: fence; pós-commit: **não** | n/a | n/a | n/a |

## 14. Findings

> Cada finding: **ID · Sev · Tipo · Título** — Evidência · Localização · Cenário · Impacto · Reprodução · Risco · Recomendação.

### C-01 · HIGH · FACTO (probe `q2`-A) · Purge fora do coordenador substitui silenciosamente uma publicação mais recente
- **Evidência:** `purgeOrphanEmbeddingRecords` não adquire lease; lê JSONL+manifesto, reescreve via `publishCanonicalEmbeddings` com a `info` lida. Probe: geração publica `a,b,c,d`; o purge (que leu `a,b,c`) republica `a,b` com `publicationId` novo.
- **Localização:** `src/index/embeddingPersistence.ts:1084-1188`; `main.ts:2242`, `:2274`.
- **Cenário:** alterar exclusões enquanto uma geração (manual ou automática) está a iniciar/concluir; o purge corre após o lote, **fora** de qualquer lease.
- **Impacto:** publicação válida revertida para versão anterior com par `consistent`; no caso de mudança de modelo concluída entre a leitura e a republicação, reposição da identidade do modelo antigo. Custo de regeneração (possivelmente paga).
- **Reprodução:** `q2` corrida A.
- **Risco:** regressão silenciosa, indetetável por validadores.
- **Recomendação:** lease exclusivo para todo o purge (leitura incluída) e releitura do estado dentro do lease; recusar quando `canonicalPairState !== "consistent"`.

### C-02 · MEDIUM · FACTO (probe `q2`-B) · Ramo "sem alterações" da reconciliação chama `saveTextIndex` sem lease
- **Evidência:** `main.ts:2213-2240` fora de coordenador; RMW do manifesto partilhado perde a secção `embeddings` publicada entre a leitura e a escrita. Probe: manifesto declara 2, JSONL 3 → `inconsistent`.
- **Impacto:** par `inconsistent` permanente (sem backups de publicação após o sucesso) ⇒ INCOMPATIBLE e reconstrução confirmada.
- **Reprodução:** `q2` corrida B. **Também** latente com purge × lote automático (ambos RMW do manifesto, ver §9).
- **Recomendação:** mesmo lease do purge; reler o manifesto dentro do lease imediatamente antes de compor o novo.

### C-03 · MEDIUM · FACTO (probe `q5`, `q1`-Q1) · `saveTextIndex` não é crash-safe para a identidade dos embeddings
- **Evidência:** backup dos três ficheiros antes de publicar qualquer um; nomes de backup/tmp aleatórios desconhecidos do recovery; em 3/12 pontos (N=7–9) `manifest.json` ausente ⇒ identidade perdida; rebuild manual gera manifesto sem secção `embeddings` e o par fica `inconsistent` para sempre. Backups/tmp nunca limpos.
- **Localização:** `src/index/indexStore.ts:474-508`.
- **Impacto:** reconstrução confirmada de embeddings (custo) por crash no `saveTextIndex`.
- **Recomendação:** nomes de backup/tmp **determinísticos** reconhecidos pelo recovery; ordem backup→publicação **por ficheiro** (manifesto sempre o último e com janela mínima, igual à publicação); o recovery passa a restaurar `manifest.json` a partir do backup textual quando ausente.

### C-04 · MEDIUM · FACTO (probe `q3`) · Coordenador de ranhura única não exclui leases do mesmo tipo
- **Evidência:** dois `startAutomaticBatch` aceites; `finish` do segundo liberta a ranhura com o primeiro ativo; `startTextRebuild` aceite com lote ativo.
- **Localização:** `src/index/indexWriteCoordinator.ts:142-217`.
- **Alcance:** **INFERÊNCIA** — alcançável por `processAutomaticIndexUpdateBatch` chamado diretamente pela reconciliação (`main.ts:2264`) em concorrência com o lote do worker, e por `drainAutomaticBatch`.
- **Impacto:** geração iniciada com um `saveTextIndex` ainda ativo.
- **Recomendação:** rejeitar `start*` do mesmo tipo e tornar `finish` por token único; testes de coordenador (hoje inexistentes para este caso).

### C-05 · MEDIUM · FACTO (leitura) / INFERÊNCIA (alcance) · `saveTextIndex` sem fence e com decisão de ownership em cache
- **Evidência:** nenhum parâmetro de fence; `isAuthorizedSync()` não refresca; rebuild avalia `canPublish()` no início e `evaluateProvenance()` antes de gravar mas **grava mesmo com proveniência indefinida** (`main.ts:2455-2467`); lote usa `getProvenance()` síncrono.
- **Impacto:** escrita no índice partilhado após perda de autoridade (o manifesto partilhado inclui a identidade dos embeddings).
- **Recomendação:** fence obrigatória em `saveTextIndex` (assert antes de cada rename, mesma proxy usada no recovery) e aborto explícito sem fence/proveniência.

### C-06 · MEDIUM · FACTO · Ramo "tudo purgado" escreve `manifest.json` in-place e não é recuperável
- **Evidência:** `adapter.write(files.canonicalManifest, …)` direto (`:1184`) sobre o manifesto partilhado do índice textual; crash entre `remove` e `write` ⇒ `inconsistent` sem backups (probe Q3).
- **Impacto:** risco de manifesto truncado (**HIPÓTESE**: dependente da atomicidade de `write` do adapter) ⇒ índice textual `invalid`.
- **Recomendação:** escrever o manifesto sempre por tmp+backup+rename; decidir (ver §15-E) o estado final do ramo total.

### C-07 · MEDIUM · FACTO (probe Q2) · Purge ignora `canonicalPairState` e converte `inconsistent` em `consistent`
- **Evidência:** com manifesto a declarar 3 e JSONL com 2 registos, o purge republica 1 registo e o par passa a `consistent` com `publicationId` novo.
- **Impacto:** contorna a política da 15H-B ("par inconsistente exige rebuild confirmado") sem passar pelo Operation Manager.
- **Recomendação:** `inspectCanonicalPair` antes de agir; só prosseguir com `consistent`.

### C-08 · LOW · FACTO (probe Q4) · Recovery restaura o manifesto partilhado inteiro e pode sobrepor um manifesto textual mais recente
- **Evidência:** W2 → rebuild textual → recovery com ambos os backups ⇒ índice textual `ready` → `invalid` ("contagens do manifesto não correspondem").
- **Condição:** só se o recovery de arranque não correr (fence recusada: `ownership.json` ausente, `index-write-busy`) e se publicar texto antes de um recovery posterior (início de geração).
- **Impacto:** reconstrução de texto (barata e local).
- **Recomendação:** o recovery deve restaurar o manifesto **só** se o manifesto atual estiver ausente, e re-verificar digests do índice textual antes de substituir.

### C-09 · LOW · FACTO · Purge e geração adquirem a fence com auto-claim
- **Evidência:** `main.ts:2215`, `:2271`, `:2959` (`acquireFence()` sem opções) com gate `autoClaim=true`.
- **Condição:** `ownership.json` ausente (p.ex. ainda não sincronizado) num dispositivo com papel `producer`.
- **Recomendação:** `{autoClaimIfUnclaimed:false}` no purge e na manutenção; manter o claim inicial apenas nos fluxos explícitos de primeira publicação autorizados.

### C-10 · LOW · FACTO · Sem invalidação de cache/estado após o purge
- **Evidência:** `main.ts:2241-2251`, `:2268-2288` não chamam `invalidateRuntimeEmbeddingIndex`/`markEmbeddingWorkStatusDirty` depois de reescrever o par (a invalidação do lote ocorre **antes** do purge). A cache runtime recarrega por mudança de `publicationId`; o `EmbeddingWorkStatusController` fica potencialmente obsoleto.
- **Recomendação:** invalidar/marcar dirty depois do purge com sucesso.

### C-11 · LOW · FACTO · Órfãos `*.tmp-*`/`*.bak-*` de `saveTextIndex` nunca são limpos
- **Evidência:** probe `q5`; sufixo aleatório. Podem conter uma cópia obsoleta do manifesto e propagar-se por sincronização.
- **Recomendação:** resolvido por C-03 (nomes determinísticos).

### C-12 · LOW · FACTO · Limpezas pós-commit de artefactos operacionais sem fence
- **Evidência:** `cleanupPaths` pós-sucesso, `removeEmbeddingCheckpoint`, limpeza de checkpoint inválido em `loadEmbeddingCheckpoint`. Só tocam `producer/` (checkpoint/backups já irrelevantes); não alteram o par canónico.
- **Recomendação:** aceitável; documentar como exceção explícita ou fazer passar pelo mesmo `assert`.

### C-13 · INFORMATIVE · FACTO (probe `q4`, 1.ª publicação N=4) · JSONL órfão completo não é promovido
- **Evidência:** JSONL novo `consistent` por si mas manifesto textual ⇒ `inconsistent`; sem backups; recovery deixa-o. A política "temporários/órfãos nunca são promovidos" é deliberada (15H-B). O trabalho gerado está preservado no checkpoint (só apagado após commit) e é reutilizado por qualquer geração seguinte.
- **Recomendação:** nenhuma alteração; manter como estado suportado.

### C-14 · INFORMATIVE · FACTO · Limites inerentes da plataforma
- Sem `fsync`; rename de destino existente não assumido; TOCTOU entre `assertFence` e o rename sem lock cross-device; durabilidade delegada ao SO; `DataAdapter` sem rename de pastas/transação.

### C-15 · INFORMATIVE · FACTO · Positivo: a publicação de embeddings é recuperável em todos os pontos de falha
- 14/14 pontos (5.1) terminam em estado fail-closed ou consistente após o recovery; fence antes de cada rename; rollback em falha; nenhuma publicação falsa. **A publicação não depende do recovery para correção**, só para as duas janelas estruturais (W1, W2).

## 15. Decisão arquitetural

**A — A publicação atual é suficientemente segura?**
- **Protocolo de publicação de embeddings: sim** (§5.1, C-15): sequência correta, manifesto como ponto de commit, backups preservados, fence antes de cada rename, recovery cobre 14/14 pontos de falha. As duas janelas (W1/W2) são inerentes a dois ficheiros com nomes fixos.
- **Mutações à sua volta: não.** O risco real está nos **chamadores** (purge, ramo de reconciliação, coordenador) e no segundo escritor do manifesto partilhado (`saveTextIndex`), não no protocolo de publicação.

**B — O purge está corretamente coordenado?** **Não** (C-01, C-06, C-07, C-09, C-10): sem lease, com autorização por auto-claim, sem validação do par, com ramo total não atómico e sem invalidação pós-operação.

**C — `saveTextIndex` deve ser coordenado com embeddings ou apenas protegido contra interferência?**
**Coordenado e fenced**, não apenas "protegido": partilham um ficheiro com RMW, pelo que a exclusão mútua tem de ser **a mesma** (mesmo lease do coordenador) e a fence tem de cobrir o texto. Os **protocolos de escrita** podem continuar diferentes (3 ficheiros + backups vs. par), desde que o manifesto seja sempre o último a entrar, com backups **determinísticos** reconhecidos pelo recovery (C-03).

**D — É necessário um coordenador de publicação ou basta corrigir os escritores?**
**Basta corrigir os escritores e endurecer o coordenador existente.** O `IndexWriteCoordinator` já expressa as exclusões certas; as falhas são (i) chamadores sem lease (purge, ramo de reconciliação), (ii) o coordenador ser de ranhura única (C-04), (iii) `saveTextIndex` sem fence. Não se justifica um novo componente, nova máquina de estados ou novo gate.

**E — A atomicidade lógica pode ser obtida sem alterar o formato persistido?**
**Sim, no sentido de unidade lógica com ponto de commit e roll-back** (já é o caso para `JSONL + manifest`; o binário é derivado). **Não** no sentido de transição física indivisível: só um formato com **um único rename** como ponto de commit (p.ex. JSONL com nome por publicação e um manifesto que o referencia) o consegue, e isso **altera formato persistido**, fora desta fase. Para o ramo "tudo purgado" há duas opções, ambas sem novo campo persistido: **(P1, recomendada)** gravar o manifesto por tmp+backup+rename e aceitar, tal como hoje, o estado `inconsistent` fail-closed numa janela residual (não há registos a perder: o custo de recuperação é uma geração inicial); **(P2)** publicar um par vazio, o que exige alterar a validação de candidato vazio e a semântica de `empty` no lifecycle — mais invasivo. A escolha final cabe à 15H-C-IMPLEMENT.

**F — Que estados intermédios o recovery 15H-B deve continuar a suportar?**
Todos os de 5.1 (tmp órfãos; JSONL ausente; W1; W2; W2 de primeira publicação; resíduos de backup pós-commit), checkpoint backups, backups binários correspondentes. **Estados que o recovery não cobre hoje e que a 15H-C/D deve cobrir ou eliminar:** manifesto textual em backups de `saveTextIndex` (C-03), resultado do ramo "tudo purgado" (C-06), sobreposição de manifesto textual mais recente (C-08). O JSONL órfão de primeira publicação (C-13) **continua** não promovido.

**G — Alteração mínima para fechar F-08**
F-08 ("persistência não coordenada/fenced") fecha-se com **(1)** lease exclusivo do coordenador em todo o purge e no ramo "sem alterações" da reconciliação (C-01, C-02); **(2)** purge com fence sem auto-claim e validação de `canonicalPairState === "consistent"` antes de agir (C-07, C-09); **(3)** manifesto do ramo total por tmp+backup+rename (C-06); **(4)** coordenador que rejeita leases do mesmo tipo (C-04) — pré-requisito de (1); **(5)** invalidação pós-purge (C-10). Os itens C-03, C-05, C-08 e C-11 (protocolo e fence de `saveTextIndex`, recovery do manifesto partilhado) pertencem à **15H-D** (P-05 da 15H-A) e **não** são necessários para fechar F-08, mas **são** necessários para a persistência poder ser declarada segura.

## 16. Proposta de implementação (para a 15H-C-IMPLEMENT; nada implementado aqui)

Ordem sugerida, **testes primeiro**:

1. **Coordenador:** `start*` rejeita se o mesmo tipo já estiver ativo; `finish` só liberta a ranhura do token; nova capacidade de lease para "manutenção canónica" (purge) reutilizando a exclusão existente (sem novo componente). Testes de unidade para as 5 combinações de `q3`.
2. **Purge:** lease durante todo o ciclo (leitura incluída); `acquireFence({autoClaimIfUnclaimed:false})`; reler manifesto/JSONL **dentro** do lease; `inspectCanonicalPair` obrigatório (só `consistent`; caso contrário devolver `{purgedCount:0}` com diagnóstico, sem escrever); ramo total com manifesto por tmp+backup+rename e `assertWriteFence` por passo; invalidar cache/marcar dirty após sucesso.
3. **Reconciliação:** o ramo "sem alterações" e o purge pós-lote passam a correr sob o mesmo lease; `saveTextIndex` desse ramo relê o manifesto dentro do lease.
4. **Recovery:** sem alterações funcionais além de manter a cobertura da §15-F; documentar o ramo total.
5. **Fora do âmbito (15H-D):** protocolo/fence/recovery de `saveTextIndex`, C-05, C-08, C-11.

Sem novo formato JSONL, sem novos campos persistidos, sem schema, sem gate paralelo, sem alterar `deriveEmbeddingWritePathDecision`/Scheduler/Worker/Operation Manager.

## 17. Critérios de aceitação da futura 15H-C-IMPLEMENT

1. **Coordenador:** dois `startAutomaticBatch` simultâneos → o segundo é rejeitado; `finish` com token desatualizado não liberta a ranhura; geração nunca é aceite com purge ou lote ativo.
2. **Purge × geração:** reprodução da corrida A (`q2`) como teste permanente — a publicação mais recente nunca é substituída; a ordem de `acquire` serializa as duas operações.
3. **Purge × `saveTextIndex`/lote:** nenhuma perda da secção `embeddings` (corrida B) quando o purge e o lote partilham o lease.
4. **Validação do par:** purge sobre par `inconsistent`/`unreadable`/`resource-limit-exceeded`/`unverifiable-legacy` **não escreve** e não altera o estado.
5. **Fence:** purge e manutenção usam fence sem auto-claim; revogação entre o `remove` e o `write` não deixa o manifesto in-place; Companion/Standby/Unassigned nunca adquirem o lease de purge.
6. **Ramo total:** o manifesto nunca é escrito in-place; matriz de crash do ramo total equivalente à de `q4` termina em estado documentado (P1) sem manifesto truncado.
7. **Invalidação:** cache runtime e `EmbeddingWorkStatusController` invalidados após purge com sucesso e **não** após purge recusado.
8. **Regressão 15H-B:** os testes de recovery/par/fence/binário da 15H-B continuam a passar; a matriz exaustiva de `q4` (8 + 6 pontos) torna-se teste permanente.
9. **Lifecycle:** nenhuma regressão em INDETERMINATE/INCOMPATIBLE/READY; nenhum purge ou publicação produz `READY` sobre par `inconsistent`.
10. **Não-objetivos verificados:** sem alterações de schema, `data.json`, formato JSONL, ownership model; sem geração de embeddings nem chamadas a providers nos testes.

---

## Garantias desta fase

Nenhum ficheiro de produção, teste, schema ou `data.json` alterado; nenhum embedding gerado; nenhuma chamada a providers; probes `q1`–`q5` mantidos fora do repositório (scratchpad da sessão); sem commit nem push. Resposta às perguntas do critério de conclusão: (1) §3; (2) §4; (3) §5; (4) §7 e C-01/C-06; (5) §9 e C-04; (6) §10 (cobre publicação, checkpoint, recovery e binário; **não** `saveTextIndex`); (7) §11; (8) §8, C-02/C-03/C-05; (9) §5.1 e §15-F (cobre tudo o que a **publicação de embeddings** produz, não o que `saveTextIndex` e o purge produzem); (10) §15-G.
