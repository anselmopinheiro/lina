# LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001

**Natureza:** auditoria independente, exclusivamente de leitura. Não foi alterado código de produção, schemas, contratos nem testes.
**Âmbito:** subsistema de embeddings ponta a ponta (geração, publicação, sincronização, consumo, pesquisa, lifecycle, ownership, UI, testes, documentação).
**Base de código:** branch `master`, HEAD `23862c5` ("docs(architecture): close LINA-14 embedding lifecycle consolidation"), versão `0.3.1`.
**Ordem de autoridade usada:** `AGENTS.md` → código executado → contratos/schemas → testes → documentação arquitetural → auditorias históricas → a prompt.
**Método de evidência:** leitura do código e três *probes* executáveis (código de produção real, empacotado com o `esbuild` do projeto, executado a partir do scratchpad fora do repositório). Onde o número/comportamento vem de um probe, está indicado como **[probe]**; onde vem de leitura de código, **[código]**; onde é estimativa, **[estimativa]**.

---

## 0. Sumário executivo

### Estado global (formulação factual)

O pipeline de geração/publicação tem um núcleo sólido: publicação transacional com validação e rollback, single-flight central, batching sequencial, checkpoints, cache runtime com identidade de origem e guardas de memória por perfil. Os portões de qualidade passam (1938 testes, typecheck, lint strict sem avisos, build, release-check).

A camada de **lifecycle canónico** (LINA-14) está corretamente desenhada ao nível do modelo puro e dos *gates de início* (Worker, Operation Manager, Scheduler, Policy), mas **a consolidação é menos completa do que a baseline declara**:

1. A autoridade de escrita é verificada **apenas no início** de uma operação; não existe *fencing* em curso nem antes da publicação (F-01), e um `ownership.json` vazio/truncado/inválido é sobrescrito com `epoch: 1` por auto-claim (F-02).
2. O lifecycle classifica como `UPDATE_AVAILABLE`/"update"/sem confirmação trabalho que o planeador central classifica como `full-rebuild` destrutivo, e o Scheduler aprova-o para despacho automático (F-03).
3. O estado de escrita fica `INDETERMINATE` (e todas as ações ficam bloqueadas, sem caminho de rebuild) assim que o JSONL canónico excede ~53 MB no desktop / ~11 MB no mobile (F-04).
4. A migração de UI da LINA-14 foi aplicada a código **morto**; o botão real da sidebar usa um predicado local (F-05).
5. Existem seis sintetizadores paralelos de snapshot com identidades fabricadas (`ollama/nomic-embed-text/768`, `mismatch-*`, `contractId: "default"`), contrariando a invariante "fonte única de verdade" (F-06, F-07).

### Findings (tabela)

| ID | Sev. | Título | Migração? | Prioridade |
|---|---|---|---|---|
| F-01 | HIGH | Sem *fencing* de ownership após o início / antes da publicação; proveniência perdida em silêncio | Não | P1 |
| F-02 | HIGH | Auto-claim sobrescreve `ownership.json` vazio/truncado/inválido com `epoch:1` | Não | P1 |
| F-03 | HIGH | Plano `full-rebuild` é classificado como `update` incremental, sem confirmação, auto-despachável | Não | P1 |
| F-04 | HIGH | Teto de leitura JSONL (~53 MB desktop / ~11 MB mobile) ⇒ `INDETERMINATE` ⇒ sem update nem rebuild | Não (leitura) | P1 |
| F-05 | MEDIUM | Derivação de ações da LINA-14 só vive em código morto; botão real usa predicado local | Não | P2 |
| F-06 | MEDIUM | Seis sintetizadores de snapshot com identidades fabricadas; diagnóstico com compatibilidade tautológica | Não | P2 |
| F-07 | MEDIUM | `upstreamTextIndex: "ready"` fixo ⇒ `NO_TEXT_INDEX` inalcançável no snapshot vivo | Não | P2 |
| F-08 | MEDIUM | `purgeOrphanEmbeddingRecords` fora do coordenador de escrita; ramo "tudo purgado" não atómico | Não | P2 |
| F-09 | MEDIUM | Protocolo de publicação move o canónico para *backup*; recuperação só ao iniciar geração | Não | P2 |
| F-10 | MEDIUM | Nenhuma validação contagem-vs-manifesto no consumo; truncagem em fronteira de linha passa | Não | P2 |
| F-11 | MEDIUM | "Local" decidido por id do provider, não por endpoint ⇒ Ollama remoto é auto-despachado | Não | P2 |
| F-12 | MEDIUM | Setting oculta `generateOnlyMissingEmbeddings=false` ⇒ ciclo perpétuo de regeneração | Não | P2 |
| F-13 | MEDIUM | `onload` aguarda leitura integral de chunks+embeddings; leituras repetidas por refresh | Não | P2 |
| F-14 | MEDIUM | Companion mobile depende de cópia binária opt-in para vaults > ~0,5–1,3 k chunks | Não | P3 |
| F-15 | LOW | Cancelamento pelo utilizador conta como falha no backoff do Scheduler | Não | P3 |
| F-16 | LOW | Código canónico sem consumidor (`evaluateOperationDecisionFromSnapshot`, `validateLifecycleInvariants`, fase `finalizing`) | Não | P3 |
| F-17 | LOW | Defaults *fail-open* (`isAuthorizedSync` com `null`, `defaultProducerRuntime`, adapter `?? true`) | Não | P3 |
| F-18 | LOW | Falhas silenciosas: pesquisa devolve `[]` em dimensões incompatíveis; gerador devolve sucesso *no-op* | Não | P3 |
| F-19 | LOW | Resíduos de segredos (leitura de texto limpo legado; migração "pede emprestada" chave de outro dispositivo) | Não | P3 |
| F-20 | LOW | Botão Cancelar da sidebar ignora `non-cancellable` | Não | P3 |
| F-21 | LOW | `isFullRebuild` nunca é `true` em produção; não há rebuild explícito na UI ativa | Não | P3 |
| F-22 | LOW | Duas tabelas de capacidades de provider; `DeviceCapabilities.role` derivado da plataforma | Não | P3 |
| F-23 | LOW | `extractVectorContract` sintetiza contrato a partir de campos parciais e substitui contrato inválido em silêncio | Não | P3 |
| F-24 | INFO | Divergências documentação ↔ runtime (lista em §27) | — | P2 |
| F-25 | INFO | Módulos legados inalcançáveis a partir de `main.ts` (lista em §28) | — | P3 |
| F-26 | INFO | `npm run build` altera `main.js` rastreado e instala no vault de teste (efeito lateral do gate) | — | P3 |

### Bloqueadores

| Dimensão | Existe bloqueador? |
|---|---|
| Uso normal (1 dispositivo, vault pequeno/médio) | **Não.** |
| Uso normal (vault com > ~2,5–6 k chunks, desktop) | **Sim — F-04** (sem update/rebuild de embeddings). |
| Uso multi-dispositivo com >1 Producer | **Sim — F-01, F-02** (escritor duplo e reset de epoch possíveis). |
| Companion mobile, vault > ~0,5–1,3 k chunks | **Condicional — F-14** (exige cópia binária criada no desktop). |
| Release | **Não** pelos gates; recomenda-se tratar F-01..F-04 antes de promover o modelo multi-Producer como suportado. |
| Evolução futura (novos providers, quantização) | Condicional: F-03, F-06/F-07 e F-04 devem ser resolvidos primeiro. |

### Respostas ao critério de conclusão

| # | Pergunta | Resposta | Evidência |
|---|---|---|---|
| 1 | Pipeline internamente coerente? | **Parcialmente.** Coerente no núcleo de geração/publicação; incoerente entre planeador e lifecycle (F-03) e entre estado derivado paralelo (F-06/F-07). | §2, §10 |
| 2 | Algum caminho viola *Producer Only Write*? | **Sim.** Produtor que perde ownership durante a operação continua e publica (F-01); purge fora do coordenador (F-08); auto-claim (F-02). | §4, §9 |
| 3 | Companion realmente read-only? | **Sim, sem violações encontradas.** `src/companion/**` tem 0 escritas em disco; escritores de artefactos partilhados estão sob `canPublish`/gate. Ressalva: as *capabilities* são por plataforma (F-22); a defesa é o ownership gate. | §3 |
| 4 | Ownership seguro sob concorrência? | **Não.** F-01, F-02; sem polling; janela na `saveOwnership`. | §4 |
| 5 | Persistência robusta a sync parcial/corrupção? | **Parcialmente.** Escrita transacional e leitura *fail-closed* em JSON inválido; mas F-09, F-10, F-02. | §5, §20 |
| 6 | Vector Contract aplicado de ponta a ponta? | **Parcialmente.** Gate de pesquisa compara provider/modelo/inputVersion/prefixMode; o lifecycle perde dimensões/inputVersion (F-03) e há contratos sintéticos (F-06, F-23). | §7 |
| 7 | Zero Silent Fallback respeitado? | **Nos gates de início, sim; no resto, não** (F-03, F-06, F-17, F-18). | §7, §12 |
| 8 | Read Path e Write Path corretamente separados? | **No modelo, sim; em runtime, parcialmente** (`getSemanticSearchAvailability` é uma terceira avaliação; F-13). | §11, §12 |
| 9 | Scheduler/Worker/Operation Manager alinhados? | **No início, sim** (`evaluateOperationStartGate` único). Em curso, não (F-01, F-15). | §13–15 |
| 10 | UI reflete o estado real? | **Não totalmente** (F-05, F-07, F-20). | §16 |
| 11 | Existe legado ainda executável? | **Sim:** sintetizadores de snapshot em produção (F-06); módulos raiz legados estão inalcançáveis (F-25). | §28 |
| 12 | Riscos de custo externo? | **Sim, limitados:** F-11 (Ollama remoto tratado como local). Fora disso, providers externos exigem confirmação. | §8 |
| 13 | Riscos de perda/corrupção de dados? | **Sim, moderados:** F-02, F-08, F-09, F-10. Nenhum caminho altera notas do vault. | §5, §20 |
| 14 | Condições de corrida relevantes? | **Sim:** F-01, F-02 (janela local na `saveOwnership`), F-08. Scheduler: corrida benigna (§13). | §24 |
| 15 | Documentação corresponde ao runtime? | **Não** (F-24). | §27 |
| 16 | Cobertura de testes suficiente? | **Não** (lacunas em §26; testes da LINA-14 cobrem código morto). | §26 |
| 17 | Preparado para evolução futura? | **Condicional**, ver "Bloqueadores". | §30 |

---

## 1. Inventário do subsistema

Tamanhos em linhas. "Lê/Escreve" refere-se a estado persistido ou em memória relevante para embeddings.

### 1.1 Modelo e decisão (puros)

| Componente | Responsabilidade | Entrada → Saída | Consumidores |
|---|---|---|---|
| `src/index/embeddingLifecycleModel.ts` (808) | `compareEmbeddingIdentity`, `classifyEmbeddingWork`, `resolveEmbeddingLifecycle` (12 estados, 4 regiões), `validateLifecycleInvariants` | factos → `EmbeddingLifecycleSnapshot` | adapter, write path, testes |
| `src/index/embeddingLifecycleWritePath.ts` (206) | `deriveEmbeddingWritePathDecision`, `evaluateOperationStartGate` | snapshot → decisão/gate | Worker, Manager, Scheduler, Policy, controller |
| `src/index/embeddingLifecycleAdapter.ts` (216) | `adaptCurrentStateToLifecycleSnapshot` | estado heterogéneo → snapshot | main, controller, 4 *fallbacks* (F-06) |
| `src/maintenance/embeddingPolicyEngine.ts` (157) | `evaluateEmbeddingUpdatePolicyFromSnapshot` | snapshot+política → permitido/confirmação | Scheduler, main (confirmação) |
| `src/index/embeddingUpdatePlan.ts` (338) | `calculateEmbeddingUpdatePlan` (initial/incremental/full-rebuild/indeterminate) | chunks+canónico+identidades → plano | gerador, preview |
| `src/index/embeddingState.ts` (261) | `calculateEmbeddingState` (missing/valid/stale/obsolete, `validForSearch`, `reusable…`) | registos → estado | plano, runtime index, status |
| `src/index/vectorContract.ts` (381) | `VectorContractV1`, `computeVectorContractId`, compatibilidade | campos → contrato/compat. | persistência, main, companion |

### 1.2 Execução

| Componente | Responsabilidade | Estado lido / escrito |
|---|---|---|
| `src/maintenance/embeddingWorker.ts` (376) | *Gate* de início, reserva no coordenador, drenar índice textual, chamar gerador | lê snapshot vivo; escreve estado do worker (memória) |
| `src/index/embeddingOperationManager.ts` (473) | Single-flight, estado/progresso/cancelamento, *last barrier* | memória |
| `src/maintenance/embeddingScheduler.ts` (437) | Debounce 30 s / máx. 300 s, backoff, despacho automático | memória; chama `dispatchAutomatic` |
| `src/maintenance/embeddingBackoffPolicy.ts` (99) | backoff exponencial 1–15 min | memória |
| `src/maintenance/maintenanceEngine.ts` (364) | Coordena workers/scheduler; `canRun` por capability | memória |
| `src/index/indexWriteCoordinator.ts` (235) | Exclusão mútua texto/embeddings/binário (memória, por instância) | memória |
| `src/index/embeddingGenerator.ts` (1771) | Plano, validação do provider, batching, checkpoint, publicação; `readEmbeddingStatus`, `readEmbeddingUpdatePreview` | lê `.lina/index/*`, `.lina/producer/checkpoints/*`; escreve via persistência |
| `src/index/embeddingPersistence.ts` (1090) | `publishCanonicalEmbeddings`, checkpoints, recuperação, `purgeOrphanEmbeddingRecords` | escreve `.lina/index/{embeddings.jsonl,manifest.json}` e `.lina/producer/{staging,backups,checkpoints}/*` |
| `src/ai/{ollama,mistral,openRouter}Provider.ts`, `embeddingProvider.ts`, `providerCapabilities.ts`, `providerDefaults.ts` | HTTP, erros, defaults, custo/local | rede |
| `src/index/embeddingBinary*.ts`, `src/maintenance/binaryWorker.ts` | cópia binária derivada (opt-in) | `.lina/index/embeddings.binary.*` |

### 1.3 Leitura/consumo

| Componente | Responsabilidade |
|---|---|
| `src/search/runtimeEmbeddingIndex.ts` (553) | Cache runtime `Float32Array`, identidade de origem, binário↔JSONL, guardas de pico |
| `src/search/semanticSearch.ts`, `hybridSearch.ts` (630), `semanticCapability.ts` (215) | Pesquisa, híbrida, disponibilidade |
| `src/companion/*` | estado de consumo, pesquisa Companion, delta local |
| `src/search/sidebarStatusViewModel.ts` (606), `src/search/linaSearchView.ts` (7955), `src/device/deviceDiagnostics*.ts` | UI/diagnóstico |
| `src/index/embeddingWorkStatusController.ts` (521) | estado derivado em memória (dirty/revisão/single-flight) |

### 1.4 Dispositivo, ownership, segredos

`src/device/{ownershipGate,deviceOwnership,deviceOwnershipTransfer,deviceOwnershipAudit,ownershipRecoveryDiagnostics,artifactProvenance*,producerState,deviceRuntimeState,secretStorage}.ts`, `src/capabilities/deviceCapabilities.ts`.

### 1.5 Comandos e settings de embeddings

Comandos: gerar embeddings, cancelar geração (`cancelar-geracao-embeddings`), estado/diagnóstico do dispositivo, transferir ownership. Settings: `embeddingsEnabled`, `embeddingUpdateMode` (`manual` | `automatic-local-only`), provider/modelo/Base URL/timeout/lote por dispositivo, `maintainBinaryEmbeddingCopy`, `embeddingStorageReadPreference`, `generateOnlyMissingEmbeddings` (**sem UI**, F-12).

### 1.6 Testes (147 ficheiros / 1938 testes)

`tests/index` (36), `tests/maintenance` (20), `tests/device` (30), `tests/search` (15), `tests/companion` (4), `tests/settings` (38). Mapa de cobertura em §26.

---

## 2. Fluxo end-to-end (confirmado no código)

```
Nota → (vault events / reconciliação, só Producer ativo) → índice textual (chunks.jsonl, notes.json, manifest.json)
  → readIndexedChunks → filterChunksByUserContentRules (main.ts:2866) + shouldExcludeContent por chunk (generator:965)
  → calculateEmbeddingUpdatePlan (incremental | full-rebuild | initial-build | indeterminate)   [generator:999]
  → validação do provider com ≤3 candidatos (generator:1097)
  → batches sequenciais; checkpoint por batch (generator:1324)       → .lina/producer/checkpoints/*
  → onPersisting() → publishCanonicalEmbeddings                      [persistence:811]
       embeddings.publish.tmp + manifest.publish.tmp (staging) → validar → backup do canónico → rename embeddings → rename manifest → validar par → limpar
  → manifest.json (embeddings{provider,model,dimensions,publicationId,vectorContract,provenance}, embeddingInput{version,prefixMode}, vectorContract)
  → (opcional) cópia binária derivada
  → sincronização externa (fora do Lina)
  → Companion/Producer: readRuntimeEmbeddingSourceIdentity → (binário se válido e publicationId coincide) | JSONL
  → RuntimeEmbeddingIndexCache.getOrLoad (Float32Array; guardas de pico)
  → runSemanticSearchGrouped (valida provider/modelo/prefixo) → embedding da query no provider → searchRuntimeSemanticIndex
  → hybrid: texto ∥ semântica → renderGroupedCards (filtra paths sem TFile)
```

**Pontos de falha / não atomicidade identificados**

| Ponto | Comportamento | Finding |
|---|---|---|
| Entre `rename(embeddings)` e `rename(manifest)` | par canónico inconsistente (embeddings novos + manifesto antigo) | F-09 |
| Canónico movido para `.lina/producer/backups/` antes do novo entrar | canónico inexistente no caminho canónico durante a janela | F-09 |
| Crash em publicação | recuperação só em `generateEmbeddingsForChunks` (`generator:984`), não no arranque | F-09 |
| Ownership perdida entre início e publicação | nenhuma verificação | F-01 |
| `purgeOrphanEmbeddingRecords` (republica ou apaga) | sem coordenador; ramo final com `write` direto sobre o manifesto canónico | F-08 |
| Retries | validação: até 3 candidatos; lotes: subdivisão só em erro específico do input; fallback Ollama `/api/embeddings` só por incompatibilidade comprovada (sem *retry* de rede) | conforme AGENTS |
| Checkpoint | escrito com backup/rollback; removido só após publicação integral | conforme AGENTS |

Não existe qualquer `vault.modify/create/delete` nos caminhos de embeddings (as cinco ocorrências de `vault.modify` estão em `linaSearchView.ts` e pertencem a aplicação confirmada de YAML/tags/ask). **Notas do vault não são alteradas pelo subsistema de embeddings.**

---

## 3. Producer / Companion

**Producer.** Geração e publicação só são alcançáveis via `EmbeddingWorker.requestGeneration` (gate de início sobre snapshot + `OwnershipGate.isAuthorizedSync()`), `MaintenanceEngine`, scheduler (`canScheduleEmbeddings` inclui `isAuthorizedSync`) e dois writers fora do Worker: `purgeOrphanEmbeddingRecords` (F-08) e `BinaryEmbeddingCopyController` (gated por `BinaryWorker.canPublish`). Active/Standby distinguem-se por `activeProducerId` do manifesto; Standby é bloqueado (`blockedReason: "standby"`).

**Companion.** Verificado:

- `src/companion/**`: **0** chamadas `adapter.write/remove/rename/mkdir` **[código]**.
- Escritores com gate: `TextIndexWorker`, `ReconciliationWorker`, `BinaryWorker`, `ExclusionPolicyService`, Worker de embeddings e scheduler usam `canPublish`/`isAuthorizedSync`, que devolve `false` quando o papel ≠ `producer` (`ownershipGate.ts:183`).
- O Companion herda provider/modelo do contrato publicado (`vectorContract.ts:323-357`, `main.ts:2589-2631`); só Base URL/credenciais são locais.
- Degradação: contrato ausente ⇒ pesquisa semântica indisponível com mensagem explícita (`linaSearchView.ts:3756`); provider inacessível ⇒ erro de geração do embedding da query.

**Ressalvas.** (i) `getDeviceCapabilities()` é derivado só da plataforma (`deviceCapabilities.ts:33-46`): um "Desktop Companion" tem `canGenerateEmbeddings=true`, `canMaintainTextIndex=true`; a proteção é exclusivamente o ownership gate + gate de snapshot (F-22). (ii) Um Companion escreve o seu próprio `.lina/devices/<id>.json` (por dispositivo, não partilhado). Nenhum caminho alternativo que permita a um Companion escrever artefactos canónicos foi encontrado.

---

## 4. Ownership e Single Active Producer

Ficheiros: `ownershipGate.ts`, `deviceOwnership.ts`, `deviceOwnershipTransfer.ts`, `deviceOwnershipAudit.ts`, `ownershipRecoveryDiagnostics.ts`.

- **Aquisição:** `OwnershipGate(..., autoClaim = true)` (`main.ts:1297-1305`) chama `claimInitialOwnership` quando `loadOwnership` devolve `null`.
- **Renovação:** não existe (sem TTL/heartbeat; decisão de desenho documentada).
- **Perda:** o gate guarda `lastDecision` em memória; **só é atualizado quando alguém chama `evaluate()`** (arranque, mudança de papel, `rebuildTextIndex`, `updateExclusionRules`, diagnóstico, início de `runGenerateLocalEmbeddings`). Não há `registerInterval`/`setInterval` **[código]**.
- **Fencing:** o epoch é verificado em `evaluate(expectedEpoch)` mas nenhum chamador de produção passa `expectedEpoch` (F-01).
- **Transferência:** feita a partir do dispositivo **Standby** (`transferir-ownership-dispositivo` só visível em Standby); o antigo Active nunca é notificado.
- **`saveOwnership`:** `rename(target→backup)` → `rename(tmp→target)`; existe uma janela sem `ownership.json`.

Respostas:

| Pergunta | Resposta |
|---|---|
| É possível existirem dois escritores? | **Sim** (F-01): A (antigo Active) mantém `isAuthorizedSync()=true` em cache e pode iniciar/continuar geração após B assumir. |
| Ownership muda durante geração? | Nada a aborta; a geração continua. |
| Durante persistência (`persisting`)? | Não cancelável e sem verificação; publica. |
| Durante finalização/publicação? | Idem; `finalizing` nunca é emitido (F-16). |
| Janela de corrida? | Sim: A↔B (F-01); `evaluate()` concorrente durante `saveOwnership` pode ver "inexistente" e auto-reclamar com `epoch:1` (F-02). |
| Dispositivo offline que regressa? | Mantém `lastDecision` até ao primeiro `evaluate()` (arranque refaz). Se o ficheiro chegar truncado/vazio: F-02. |

---

## 5. Persistência e estrutura `.lina`

| Ficheiro | Writer | Readers | Atómico? | Versionamento | Multi-writer? | Risco de sync |
|---|---|---|---|---|---|---|
| `.lina/index/embeddings.jsonl` | `publishCanonicalEmbeddings`, `purgeOrphan…` | runtime index, status, plano, Companion | Par com manifesto: **não** (2 renames) | via manifesto | não (só Active) | janela entre renames (F-09) |
| `.lina/index/manifest.json` | `saveTextIndex` (preserva secção de embeddings), `publishCanonicalEmbeddings`, `purgeOrphan…` | todos | rename com backup | `version:1`, `embeddingInput.version` | **dois tipos de writer** (texto e embeddings), exclusão via coordenador | `purge` fora do coordenador (F-08) |
| `.lina/producer/checkpoints/embeddings.checkpoint.{jsonl,meta.json}` | gerador | gerador | sim (tmp+backup) | `schemaVersion:1` | não | **dentro do vault**; só deve ser excluído por política de sync externa (manual/README) |
| `.lina/producer/{staging,backups}/*` | persistência, `saveTextIndex` | recuperação | — | — | não | idem |
| `.lina/index/embeddings.binary.*` | `BinaryEmbeddingPublisher` | runtime index | transacional | `sourcePublicationId` | não | derivado; não canónico |
| `.lina/ownership.json` | `saveOwnership` | todos | rename com backup (janela) | `schemaVersion:1` | **não deveria**, mas claim/transfer/relinquish escrevem de dispositivos diferentes | **F-02** |
| `.lina/ownership-history/NNN.json` | audit append-only | diagnóstico | tmp+rename | `schemaVersion:1` | append por dispositivo | conflitos de numeração possíveis (não auditado em profundidade) |
| `.lina/devices/<id>.json` | dispositivo próprio | diagnóstico | tmp+rename | `schemaVersion:2` | não (por dispositivo) | baixo |
| `.lina/producer-state.json` / por dispositivo | `updateProducerState` | diagnóstico | — | V1 | por dispositivo | baixo |
| exclusões canónicas | `ExclusionPolicyService` (gated) | todos | — | hash/revisão | só Active | baixo |

Não multi-writer por desenho mas onde o desenho não o impede: `ownership.json` (F-02), `manifest.json` durante `purge` (F-08).

---

## 6. Sincronização externa

A premissa "agnóstico ao sistema de sincronização" é **válida para sistemas que transferem ficheiros por rename atómico (Syncthing)** e **frágil para** sistemas com *placeholders*/ficheiros parciais (OneDrive on-demand, iCloud, Dropbox em conflito):

| Cenário | Efeito observado/inferido | Ref. |
|---|---|---|
| `ownership.json` chega vazio/truncado | dispositivo Producer reclama `epoch:1` **[probe]** | F-02 |
| `embeddings.jsonl` novo + `manifest.json` antigo | estado transitório; plano vê identidade mista ⇒ `full-rebuild` no planeador, `update` no lifecycle **[probe]** | F-03, F-09 |
| `embeddings.jsonl` truncado em fronteira de linha | aceite silenciosamente (menos vetores) | F-10 |
| `embeddings.jsonl` truncado a meio de linha | `parseJsonlRecords` devolve `null` ⇒ carga falha (*fail-closed*) | — |
| Publicação move canónico para `.lina/producer/backups/` | ferramentas veem *delete* no caminho canónico | F-09 |
| Relógios diferentes | `canonicalMtime` faz parte da identidade de cache; `updatedAt` apenas informativo; epoch é monotónico (não relógio) | sem problema identificado |
| Conflitos `*.sync-conflict-*` | não tratados; não existe deteção | sem finding próprio |

Ficheiros que **não** deveriam ser multi-writer e dependem de disciplina externa: `ownership.json`, `ownership-history/`. Documentação recomenda excluir `.lina/producer/` (docs/manual.md:451-477, README:92); `AGENTS.md` não o lista (F-24).

---

## 7. Vector Contract

- Identidade: `sha256` sobre `{provider, model (lower/trim), dimensions, metric:"cosine", prefixMode, inputVersion}`; exclui endpoint, timestamps, device, credenciais (`vectorContract.ts:79-109`). Sem colisões conhecidas (hash de payload canónico).
- Publicação: `buildManifestCandidate` grava `vectorContract` na raiz **e** em `embeddings.vectorContract`; `saveTextIndex` preserva apenas `embeddings{…}` e `embeddingInput` — o `vectorContract` aninhado sobrevive, o da raiz não (sem impacto: `extractVectorContract` lê ambos).
- Consumo: o gate de pesquisa compara `provider`, `modelo`, `inputVersion`, `prefixMode` (`linaSearchView.ts:3778-3795`), não `contractId`.
- Contrato desconhecido: Companion sem contrato ⇒ indisponível (*fail-closed*).
- **Lacunas:** (i) lifecycle copia dimensões do *target* para o *published* e fixa `inputVersion:1` (F-03); (ii) contratos sintéticos (`contractId:"default"`, `mismatch-*`) em fallbacks (F-06); (iii) `extractVectorContract` sintetiza (F-23); (iv) `parseManifestEmbeddingInfo` exige `input.version === 1` (manifestos legados tornam-se "inválidos", o que é *fail-closed*); (v) `inputVersion` é constante `1` — alterações ao chunker/composição do input dependem de `embeddingInputHash`/`textHash` por registo para serem detetadas.

---

## 8. Providers

| Provider | Embeddings | Local? | Custo | Endpoint/Base URL | Auth | Observações |
|---|---|---|---|---|---|---|
| Ollama | sim (`/api/embed`, fallback `/api/embeddings`) | `isLocal: true` **por id** | nenhum | configurável (`aiBaseUrl`/embedding URL) | nenhuma | F-11 |
| Mistral | sim (batch nativo) | externo | sim | `https://api.mistral.ai/v1` | API key | confirmação obrigatória |
| OpenRouter | sim (`openai/text-embedding-3-small` por omissão) | externo | sim | `https://openrouter.ai/api/v1` | API key | AGENTS descreve OpenRouter só para análise (F-24) |
| Outros | desconhecidos tratados como externos | — | — | — | — | conservador |

- `automatic-local-only` **nunca** dispara providers externos: verificado em três camadas — `canDispatchAutomatically` (`main.ts:1531-1555`), `evaluateSchedulerDecisionFromSnapshot` (`decision.cost === "local"`), `evaluateOperationStartGate` (confirmação ⇒ bloqueia `automatic`). **Mas** a classificação é por id (F-11).
- Mudança de provider/modelo: `INCOMPATIBLE` ⇒ `rebuild` com confirmação; vetores incompatíveis não são reutilizados (`embeddingUpdatePlan.ts:259-265`, `reusableCanonicalRecords` só em `incremental`).
- Timeouts: por dispositivo (`embeddingRequestTimeoutSeconds`, default 60 s); *retries*: só subdivisão de lotes e fallback Ollama; sem *retry* em 429 (erro fatal com categoria `rate-limit`; backoff fica a cargo do Scheduler).
- Query de pesquisa: enviada ao provider em cada pesquisa semântica (comportamento intrínseco; por ação explícita do utilizador).

---

## 9. Pipeline de geração

| Tema | Resultado |
|---|---|
| Seleção/exclusões | `filterChunksByUserContentRules` + `shouldExcludeContent` por chunk; exclusões por path aplicadas na construção do índice; purge após reconciliação (F-08) |
| Conteúdo vazio | chunks < 30 caracteres filtrados no chunker (AGENTS); `totalToGenerate===0` sem trabalho ⇒ erro "sem chunks elegíveis" |
| Hash/alterações | `textHash` + `embeddingInputHash` por registo; estado `stale` por hash |
| Incremental/rebuild | planeador decide (`embeddingUpdatePlan.ts`); **lifecycle não o reflete fielmente** (F-03) |
| Cancelamento | cooperativo entre lotes; `persisting` não cancelável; `dispose()` aborta incondicionalmente |
| Progresso | via Manager; `finalizing` nunca emitido (F-16) |
| Idempotência | retoma por checkpoint compatível; republicação gera novo `publicationId` |
| Removidas/renomeadas/movidas | removidas: obsoletas ⇒ `publish-only`/purge; rename/move: A3 (substituição atómica no índice textual); embeddings do antigo path tornam-se obsoletos |
| Não-Markdown | não indexados (`getMarkdownFiles`) |
| Exclusões novas/removidas | reconciliação imediata + purge (F-08); embeddings invalidados sem geração automática |

Verificado: geração vazia nunca é publicada (`publishCanonicalEmbeddings` rejeita candidato vazio/dimensões ≤ 0, `persistence:830`). Reconstrução total com falha não destrói o canónico anterior (publicação só no fim; rollback).

---

## 10. Lifecycle (12 estados)

Avaliado sobre `resolveEmbeddingLifecycle` (precedência: CANCELLING → UPDATING → ERROR → VERIFYING → NO_TEXT_INDEX → DISABLED → STANDBY → INDETERMINATE → INDEX_ONLY → INCOMPATIBLE → INDEX_ONLY(0 válidos) → UPDATE_AVAILABLE → READY).

| Estado | Entrada (modelo) | Alcançável em produção? | Observação |
|---|---|---|---|
| `NO_TEXT_INDEX` | `upstream ∈ {missing, invalid}` | **Só no ramo indeterminado** do snapshot vivo | F-07 **[probe]** |
| `DISABLED` | `!embeddingsEnabled` | sim | — |
| `INDEX_ONLY` | sem canónico ou 0 válidos | sim | ação `generate` |
| `VERIFYING` | `factsChecking` | raramente (`factsChecking` não é definido no snapshot vivo) | potencialmente inalcançável no caminho Sidebar; sem evidência de impacto |
| `READY` | compatível, sem trabalho | sim | `READY` também para Companion/Unassigned com trabalho pendente (`write.applicable=false`) — coerente com I1 qualificada |
| `UPDATE_AVAILABLE` | trabalho pendente | sim | **aceita `full-rebuild` do planeador** (F-03) |
| `INCOMPATIBLE` | identidades divergentes | sim (provider/modelo/prefixo) | dimensões/inputVersion não são comparáveis no lifecycle (F-03) |
| `INDETERMINATE` | canónico ilegível | sim | **bloqueia tudo e não tem saída** (F-04) |
| `UPDATING`/`CANCELLING` | estado do Manager | sim | — |
| `ERROR` | operação falhada | sim | `retry` |
| `STANDBY` | Producer sem ownership | sim | — |

Não existe estado para `unassigned` (cai em `INDEX_ONLY`/`READY` com `blockedReason:"unassigned"`). Estado que esconde erro: `READY` para Unassigned com trabalho pendente (informativo, sem impacto de escrita).

`validateLifecycleInvariants` implementa 8 das 15 invariantes documentadas (I1–I4, I6, I7, I9, I11) e **não tem consumidores em produção** (F-16).

---

## 11. Write Path

`deriveEmbeddingWritePathDecision` (`embeddingLifecycleWritePath.ts:131-206`) está consistente com a baseline para todos os estados. Observações:

- `evaluateOperationStartGate` (`:98-115`) **não** verifica `action`/`canExecute`: um pedido manual em `READY` (ação `none`) é aceite e o gerador termina como *no-op*. Aceitável como "forçar verificação", mas divergente de "`canStart`" definido em `evaluateOperationDecisionFromSnapshot` (F-16).
- `requiresConfirmation` para `origin ≠ automatic` não é imposto pelo gate; a confirmação é imposta por `confirmAndRequestEmbeddingGeneration` (modal). Comando/sidebar/diagnóstico passam todos por essa função; **não foi encontrado** chamador que invoque `requestEmbeddingIndexGeneration` com origem manual sem confirmação (só o Scheduler usa `"automatic"`).
- Consumidores que recriam decisões: sidebar (`linaSearchView.ts:2827-2832`, F-05); `canDispatchAutomatically` repete provider/role/ownership antes de delegar (`main.ts:1536-1554`); `confirmAndRequestEmbeddingGeneration` reconstrói um terceiro snapshot (`main.ts:1769`).

---

## 12. Read Path

- Disponibilidade operacional real: `getRuntimeEmbeddingIndex` + comparação provider/modelo/inputVersion/prefixMode (LINA-13-P1A); sem *pre-gate* por cache derivado. **Conforme.**
- *Fallback* para texto: explícito — `effectiveMode "text-only"` com `reasonCode`; a pesquisa semântica direta mostra mensagens específicas (provider/modelo/prefixo/dimensão). Na híbrida, a componente semântica ausente degrada para texto com estado visível. **Conforme**, com duas ressalvas: `searchRuntimeSemanticIndex` devolve `[]` se `query.length !== index.dimensions` (F-18) e `getSemanticSearchAvailability` é uma terceira avaliação independente, que lê JSONL/manifesto e, em `detailsAvailable===false`, instancia uma `RuntimeEmbeddingIndexCache` descartável que carrega vetores (`hybridSearch.ts:154-176`).
- Filtragem de excluídos na leitura: `searchRuntimeSemanticIndex` ignora registos cujo `chunkId` não esteja nos `chunks` atuais; `renderGroupedCards` exige `TFile` válido. **Notas excluídas não permanecem acessíveis** mesmo antes do purge.

---

## 13. Scheduler

- Timers injetados (`window.setTimeout`); quiet 30 s, máximo 300 s; backoff 1–15 min; `disable()/dispose()` limpam timers.
- `canScheduleEmbeddings` = capability (plataforma) ∧ `isAuthorizedSync()`; Companion/Standby/Unassigned não agendam.
- Despacho: só com `embeddingUpdateMode === "automatic-local-only"`, papel `producer`, autorizado, provider *local por id*, embeddings configurados e `evaluateSchedulerDecisionFromSnapshot(...).canDispatch`.
- **Corrida:** `automaticDispatchInFlight` só é posto após `dispatch accepted`; durante `await hasEmbeddingWork()` dois `reachReady` podem coexistir. O segundo recebe `already-running` do Manager (single-flight a jusante) ⇒ corrida **benigna**.
- `completion.success=false` também para cancelamento ⇒ backoff (F-15).
- `wake/resume`: não há tratamento específico (timers de `window`); após suspensão do SO o `reachReady` dispara ao retomar, o que é aceitável; sem finding.
- Arranque: `runStartupEmbeddingAutomation` apenas avisa (**zero geração no arranque**, conforme AGENTS).

---

## 14. Worker

Sequência: gate de snapshot → capacidades/`canPublish` (síncrono, em cache) → `isTextIndexBusy` → reserva no coordenador → `Manager.request` (gate final) → fase `preparing` → `drainTextIndex` → `startGeneration` (token) → `generationService.generate` → `finally { coordinator.finish }` → `maintainAfterPublication`.

- A fronteira **geração → persistência → publicação → perda de ownership** não tem verificação (F-01): `runGenerateLocalEmbeddings` chama `evaluateProvenance()` **uma vez** (`main.ts:2900`), ignora o resultado se `undefined` e passa-o ao gerador; o gerador publica sem rever.
- `Worker.dispose()` cancela e faz `dispose` do Manager, que aborta o sinal mesmo em `persisting`; o gerador não observa o sinal após `onPersisting()`, pelo que a publicação termina (coerente com "ponto de não retorno").
- `stop()` do `MaintenanceEngine` desativa o scheduler mas não o worker (o cancelamento é feito separadamente em `stopProducerMaintenanceWorkers`); sem impacto.

---

## 15. Operation Manager

- Exclusão mútua (single-flight) e máquina de estados corretas; `dispose()` incondicional; cancelamento bloqueado em `persisting` (estado do próprio Manager) ou quando a decisão canónica o indica.
- `EmbeddingOperationPhase` **não inclui `finalizing`** (`:22-30`), mas o modelo/baseline tratam `finalizing` como fase não cancelável: ramo morto (F-16).
- Recuperação após crash: o Manager é só memória; não há estado persistido de operação. A recuperação é do gerador (F-09).
- Falhas não mascaradas: erro ⇒ `status "failed"` + mensagem saneada.

---

## 16. UI e diagnóstico

| Verificação | Resultado |
|---|---|
| UI não deriva regras próprias | **Falha** — `showUpdateEmbeddingsButton` (`linaSearchView.ts:2827-2832`) é um predicado local (`isAuthorizedProducer && workAvailable===true && operação parada && indexReady`); rótulo fixo "Atualizar embeddings" (também em `INDEX_ONLY`/`INCOMPATIBLE`) (F-05) |
| Ações derivadas da decisão canónica | Só em `embeddingStatusViewModel.ts`, **código morto** em produção (F-05) |
| Erro nunca como READY | Sidebar usa `lifecycleSnapshot.primary` para frescura (correto); mas snapshot com `upstream:"ready"` fixo (F-07) |
| Rebuild destrutivo com confirmação | Sim via `confirmAndRequestEmbeddingGeneration` + política (`manual` ⇒ sempre; `rebuild` ⇒ confirmação); `isFullRebuild` nunca `true` em produção (F-21) |
| Companion sem ações impossíveis | Sim (`isAuthorizedProducer===true` exigido) |
| Standby distinguido | Sim (papel `standby-producer`, ⏸️) |
| Cancelamento refletido | **Parcial**: botão Cancelar ativo em `persisting`; resultado `non-cancellable` ignorado (F-20); o comando de paleta mostra o aviso |
| Diagnóstico | Modal de dispositivo constrói o snapshot com `vectorContract` do canónico como identidade publicada **e** de dispositivo ⇒ compatibilidade tautológica (F-06) |

---

## 17. Configuração e settings

- Por dispositivo: provider/modelo/URL/timeout/lote/cópia binária/preferência de leitura (`deviceSettingsById`); globais: `embeddingsEnabled`, `embeddingUpdateMode`.
- **Setting sem UI e com efeito perigoso:** `generateOnlyMissingEmbeddings` (default `true`; migrada de `autoGenerateEmbeddingsOnlyWhenNeeded`) — F-12.
- Defaults *stale*: `|| "nomic-embed-text"` em `main.ts:2645` vs. recomendado `nomic-embed-text-v2-moe` (AGENTS) (F-22/F-24).
- Campos legados lidos: `settings.embeddingApiKey`, `aiApiKey`, `embeddingBaseUrl`, `embeddingLocalBaseUrl`, `embeddingModel`, `embeddingLocalModel`, `aiBaseUrl` (fallback em cadeia em `getEffectiveEmbeddingConfig`).

---

## 18. SecretStorage

- Chaves: `lina-analysis-api-key`, `lina-embeddings-api-key` em `app.secretStorage` (não sincronizado).
- Sem `console.*` com `apiKey/authorization/bearer/secret/token` em `src` ou `main.ts` **[pesquisa estática]**; diagnósticos de geração contêm provider/modelo/endpoint/status.
- **Resíduos** (F-19): `getLocalEmbeddingsApiKey()`/`getLocalAnalysisApiKey()` e `getEffectiveEmbeddingApiKey` ainda leem texto limpo legado (`deviceSettingsById`, `settings.embeddingApiKey`, `aiApiKey`) quando não há segredo; `setLocal*ApiKey` escreve texto limpo em `data.json` se `activeSecretStorage` for falso; a migração, quando o dispositivo atual não tem chave, **copia a chave de outro dispositivo** (`secretStorage.ts:160-166, 195-201`) e depois purga todas as entradas. Com `minAppVersion 1.13.0` (SecretStorage disponível) o ramo de texto limpo é de baixa probabilidade.
- Mistral reutiliza o segredo de análise se não houver segredo de embeddings (por desenho).

---

## 19. Exclusões

- Persistência: política canónica em `.lina` (só Active escreve; `canEditExclusions` exige `isAuthorizedSync`); fallback legado a partir de `data.json` quando inexistente.
- Aplicação antes do embedding: índice textual já exclui por path/conteúdo; gerador reaplica `shouldExcludeContent` por chunk.
- Aplicação na pesquisa: filtro por `chunkId` presente e `TFile` existente (sem depender do purge).
- Após alteração: `updateExclusionRules` → `reconcileIndexExclusionsAfterSettingsChange` (latest-policy-wins, serializado) → purge. **Risco:** F-08 (purge fora do coordenador).
- Uma nota excluída **não** permanece acessível semanticamente (defesa na leitura).

---

## 20. Matriz de integridade e corrupção

| Cenário | Deteção | Estado lifecycle | UX | Recuperação | Risco de perda |
|---|---|---|---|---|---|
| manifest ausente | `parseManifestEmbeddingInfo`→`null`/`stat` | `INDEX_ONLY`/`NO_TEXT_INDEX` | texto apenas | regenerar | baixo |
| manifest truncado/JSON inválido | `JSON.parse` falha | `canonical-manifest-invalid` ⇒ semântica indisponível | mensagem específica | regenerar; **não** é recuperado automaticamente | baixo |
| vetor ausente (registo em falta) | `missing` no estado | `UPDATE_AVAILABLE` (Producer) | atualizar | incremental | baixo |
| ficheiro embeddings truncado a meio de linha | `parseJsonlRecords`→`null` | carga falha | erro de carga | regenerar | baixo |
| truncado em fronteira de linha | **não detetado** (F-10) | `READY` com menos vetores | sem aviso | regenerar manual | pesquisa incompleta silenciosa |
| índice incompleto (chunks sem registo) | `missing` | `UPDATE_AVAILABLE` | atualizar | incremental | baixo |
| dimensões erradas (registo) | `isEmbeddingRecord` exige `embedding.length===dimensions`; runtime filtra por `sourceIdentity.dimensions` | stale/inválido | — | regenerar | baixo |
| `contractId` errado | `isValidVectorContract` recomputa; inválido ⇒ **sintetizado a partir dos campos** (F-23) | compatível/ incompatível conforme campos | — | — | baixo |
| hash incorreto | `textHash`/`embeddingInputHash` ⇒ `stale` | `UPDATE_AVAILABLE` | — | incremental | baixo |
| artefacto antigo (proveniência stale/future/unknown) | validação não bloqueante | utilizável | badge | — | baixo |
| ficheiro parcialmente sincronizado (par embeddings/manifest) | plano: identidade mista | **lifecycle: `UPDATE_AVAILABLE`; plano: `full-rebuild`** (F-03) | pede "atualizar" | regeneração total silenciosa possível | custo computacional |
| `ownership.json` vazio/truncado | `loadOwnership`→`null` | **auto-claim `epoch:1`** (F-02) | "Producer ativo" | histórico mostra `epoch-inconsistency` (observação) | autoridade/epoch |
| canónico > ~53 MB (desktop) | guarda de leitura | `INDETERMINATE` (F-04) | "operação indisponível" | nenhuma automática | bloqueio de update |
| crash entre renames de publicação | par inválido / canónico ausente | `INDEX_ONLY`/mista | — | **só na próxima geração** (F-09) | pesquisa semântica indisponível até lá |

---

## 21. Compatibilidade e migrações

- Manifestos sem `embeddingInput`: `parseManifestEmbeddingInfo` recusa (`input.version !== 1`); o planeador marca `published-identity-incomplete` ⇒ `full-rebuild`; o lifecycle marca `incremental` (F-03 caso 1, **[probe]**).
- Formato binário: `legacy-manifest` bloqueia criação/atualização; binário desatualizado nunca entra na cache.
- Checkpoints: `schemaVersion:1` com `inputFormatVersion`, `dimension`, provider/modelo; incompatíveis são descartados (`generator:1195-1204`).
- Migração futura de `VectorContractV1`: `schemaVersion` literal `1`; `isValidVectorContract` rejeita outros, e `extractVectorContract` passa a sintetizar (F-23) — um contrato `schemaVersion:2` futuro seria tratado como "inválido" e reconstruído a partir de campos, sem aviso.
- `ownership.json` com `schemaVersion` futuro: tratado como inválido (`null`) ⇒ auto-claim (F-02).

---

## 22. Performance (apenas identificação de risco)

| Risco | Evidência |
|---|---|
| Leitura integral de `chunks.jsonl` + `embeddings.jsonl` e *hash* SHA de todos os chunks em cada `readEmbeddingStatus`/`readEmbeddingUpdatePreview` | `embeddingGenerator.ts:1569-1600, 1647-1700` |
| Por ciclo de refresh do controller: 2 leituras (`status` + `preview`); `hasAutomaticEmbeddingWork`: +1; `confirmAndRequestEmbeddingGeneration`: +2; `getSemanticSearchAvailability`: +1 | `main.ts:2700-2718, 2670-2695, 1746-1757`, `hybridSearch.ts:90-209` |
| Arranque: `refreshDeviceRuntimeState` (aguardado em `onload`) → `getSemanticSearchAvailability` → leitura integral | `main.ts:496, 3718-3719, 3783-3784, 1125-1137` (F-13) |
| Companion mobile: o controller calcula o plano completo mesmo com escrita não aplicável | `main.ts:2700-2718` |
| Cache runtime: carregamento lazy, single-flight, invalidação por publicação — **conforme** | `runtimeEmbeddingIndex.ts` |
| Tamanho por registo **[probe, pior caso com `Math.random`]**: 768-d ≈ 16,6 KB; 1024-d ≈ 22,0 KB. **[estimativa]** com dígitos curtos típicos de float32 (~12 caracteres): ≈ 9–12 KB | — |

Teto de leitura **[probe]** (`evaluateEmbeddingBridgeRead`): desktop **53,3 MB** (pico estimado = 3×tamanho + 32 MB ≤ 192 MB); mobile **11,2 MB** (5×tamanho + 8 MB ≤ 64 MB). Convertido em chunks **[probe, pior caso]**: desktop ≈ 3 369 (768-d) / 2 542 (1024-d); mobile ≈ 707 / 533. **[estimativa, dígitos curtos]**: desktop ≈ 4,5–6 k; mobile ≈ 0,9–1,3 k.

---

## 23. Mobile

- Startup Companion: `loadDataFromDisk` inclui `refreshDeviceRuntimeState` (F-13).
- Memória: guarda `MOBILE_BRIDGE_READ_GUARD` (12 MB/amplificação 5×); leitura via binário evita o teto JSONL.
- Disponibilidade offline: os artefactos sincronizados são lidos localmente; a pesquisa semântica **exige alcançar o provider** para embutir a query (Ollama no PC pode não ser alcançável no telemóvel) — sem *fallback* para texto além do estado "indisponível/text-only".
- Sync incompleta: F-10/F-09. Contract mismatch: Companion herda o contrato ⇒ mismatch só por manifesto alterado.
- Dependência da cópia binária (opt-in, `maintainBinaryEmbeddingCopy=false` por omissão) — F-14.

---

## 24. Concorrência

| Cenário | Resultado |
|---|---|
| Múltiplos eventos de ficheiro durante geração | Eventos permanecem na fila (coordenador) e retomam depois — conforme |
| Atualização durante geração | `startAutomaticBatch` bloqueado por `embeddingGenerationRequested/active` — conforme |
| Shutdown durante geração | `onunload`: `maintenanceEngine.dispose()` aborta; publicação em curso termina/rollback; recuperação só na próxima geração (F-09) |
| Reabertura durante persistência | idem |
| Duas chamadas manuais | `already-running` do Manager — conforme |
| Scheduler + comando manual | `preemptForManual` limpa timers; o pedido automático posterior recebe `already-running` — conforme |
| Transferência de ownership | F-01 |
| Purge vs geração | F-08 (sem exclusão mútua; mesmos nomes de staging) |
| `saveOwnership` vs `evaluate()` concorrente | F-02 |

---

## 25. Logging e diagnóstico

- Diagnóstico de geração: eventos por estágio (`validation`, `generation`, `publication`, `checkpoint`, `recovery`) com provider/modelo/endpoint/estado/contagens; ativado por `debugIndexUpdates`.
- Erros do provider: categoria + status + endpoint, sem segredos; mensagem ao utilizador limitada a 300 caracteres.
- Lacunas: não há log de **perda de ownership durante operação**; diagnóstico não distingue "estado derivado por fallback sintético" de "derivado de factos" (F-06); `purge` falha apenas com `console.warn`.
- Segredos em logs: nenhum encontrado (§18).

---

## 26. Mapa de cobertura de testes

| Domínio | Ficheiros principais | Cobertura | Lacunas concretas |
|---|---|---|---|
| Lifecycle/modelo | `embeddingLifecycleModel`, `…Adapter`, `…ShadowValidation` | Boa | 7 das 15 invariantes sem validador; nenhum teste de equivalência plano↔lifecycle (F-03) |
| Write path | `embeddingLifecycleWritePath`, `embeddingOperationLifecycleCutover` | Boa | Nenhum teste para `full-rebuild` por `published-identity-incomplete`/`canonical-identity-mixed`/dimensões |
| Read path | `semanticSearchRuntimeGate`, `semanticCapabilityLifecycleSnapshot`, `sidebarStatusLifecycleSnapshot` | Boa | Sem teste de dimensão da query ≠ índice; sem teste de truncagem em fronteira de linha |
| Scheduler | `embeddingScheduler*`, `embeddingSchedulerGate`, `automaticEmbeddingRuntimeDispatch` | Boa | Cancelamento⇒backoff não coberto; Ollama com URL remota não coberto |
| Worker / Manager | `embeddingWorker*`, `embeddingOperationManager*` | Boa | **Perda de ownership a meio de `generate`/`persist` não coberta** (só decisão/gate) |
| Producer / Companion | `companion*`, `workerOwnershipGating`, `deviceDiagnosticsCompanion` | Boa | — |
| Ownership | `deviceOwnership*`, `ownershipGate*`, `ownershipArchitectureAudit` | Boa | **Auto-claim sobre manifesto vazio/truncado/futuro não coberto**; corrida `saveOwnership`↔`evaluate` não coberta |
| Persistência | `embeddingPersistence`, `memoryPersistence` | Boa | Recuperação no arranque inexistente (não testável); `purgeOrphan…` só num teste (`artifactInvalidationAndDefensiveFiltering`); sem teste de concorrência purge↔geração |
| Sync | — | **Nenhum teste de sync parcial** (par embeddings/manifest, truncagem) | lacuna |
| Contrato | `vectorContractAndCompanionInheritance`, `vectorContractStartupOrder` | Boa | Contrato inválido substituído por síntese (F-23) não coberto |
| Corrupção/recuperação | `embeddingPersistence` (rollback), `embeddingResourceGuard` | Média | Teto de leitura ⇒ `INDETERMINATE` ⇒ sem saída (F-04) não coberto como fluxo |
| Mudança de provider | `embeddingUpdatePlan`, `embeddingPolicyEngine*` | Boa | — |
| UI | `embeddingStatusActionDerivation`, `embeddingStatusViewModel` | **Testam código sem chamadores em produção** (F-05) | o predicado real da sidebar (`showUpdateEmbeddingsButton`) não é testado |

---

## 27. Documentação vs runtime

| # | Fonte | Afirmação | Realidade | Classe |
|---|---|---|---|---|
| D1 | Baseline §7.1 | contrato em `.lina/embeddings/manifest.json`; registos em `.lina/embeddings/chunks.jsonl` | `.lina/index/manifest.json` e `.lina/index/embeddings.jsonl` (`embeddingPersistence.ts:16-19`); `chunks.jsonl` é o índice textual | documentação desatualizada |
| D2 | Baseline §3 | Worker "avalia `evaluateOperationDecisionFromSnapshot` antes de cada execução" | usa `evaluateOperationStartGate` + `deriveEmbeddingWritePathDecision`; `evaluateOperationDecisionFromSnapshot` não tem consumidores em produção | documentação desatualizada |
| D3 | Baseline §6.8 | "persistência é imediatamente abortada com `not-active-producer`" | só no início; sem *fencing* em curso (F-01) | código fora da arquitetura |
| D4 | Baseline §6.1 / §12 | "NUNCA reconstruir estados fora do snapshot" / "NUNCA ler `.json(l)` para decidir pesquisar/gerar" | seis sintetizadores (F-06); `getSemanticSearchAvailability`/`readEmbeddingStatus` leem disco | código fora da arquitetura |
| D5 | Baseline §9/B4.1 | ações de UI derivadas da decisão canónica | só em código morto (F-05) | decisão não documentada / teste fora do contrato |
| D6 | Baseline §5 | `finalizing` não cancelável | fase nunca emitida (F-16) | documentação desatualizada |
| D7 | AGENTS.md (robustez de embeddings) | checkpoints/temporários em `.lina/index/` (`embeddings.checkpoint.jsonl`, `…publish.tmp`) | `.lina/producer/{checkpoints,staging,backups}/` | documentação desatualizada |
| D8 | AGENTS.md (Syncthing) | `.stignore` sugerido sem `/.lina/producer/` | `docs/manual.md:451-477` e README incluem-no | documentação inconsistente |
| D9 | AGENTS.md Fase 9N-D6 | OpenRouter "para análise" | OpenRouter tem embeddings implementados e capability `embeddings:true` | documentação desatualizada |
| D10 | AGENTS.md / Baseline | "auto-dispatch apenas Ollama/local" | "local" = provider `ollama`, independentemente do endpoint (F-11) | código fora da arquitetura |
| D11 | Model header | "Invariant Verification (I1 to I15)" | 8 implementadas, 0 em produção | documentação desatualizada |
| D12 | AGENTS.md | `OwnershipGate` "Standby… seguro" | sem notificação do Active ao perder ownership (F-01) | decisão não documentada |

Contagem de testes da baseline (147 ficheiros / 1938 testes) **confere**.

---

## 28. Pesquisa de legado residual

Contagens em `src/` + `main.ts` (ocorrências / ficheiros):

| Termo | Ocorr. / Fich. | Classificação |
|---|---|---|
| `shadow` | 2 / 1 | **Benigno** — classe CSS `lina-shadow-none` |
| `workflowState`, `EmbeddingWorkflowState` | 0 | removidos (confirmado); ficheiro de teste `sidebarEmbeddingWorkflowState.test.ts` mantém o nome histórico |
| `legacy` | 207 / 29 | maioritariamente credenciais/manifestos/binário (`legacy-manifest`, `legacy-single`) — **intencional**; ver F-19, F-23 |
| `deprecated` | 9 / 1 | campos de credenciais marcados `@deprecated` — intencional |
| `adaptCurrentStateToLifecycleSnapshot` | 17 / 8 | **Produção:** `main.ts` (2 sítios), `embeddingWorkStatusController.ts`; **fallbacks executáveis:** `semanticCapability.ts`, `deviceRuntimeState.ts`, `deviceDiagnostics.ts`, `sidebarStatusViewModel.ts` (F-06) |
| `fallback` | 251 / 31 | misto; relevantes: defaults de provider/URL/modelo; fallback de chave de API; fallback `/api/embeddings` (legítimo) |
| `compat` | 262 / 33 | "compatibility" legítimo; ver F-03/F-06 |
| `temporary` | 115 / 17 | ficheiros `tmp`/staging — legítimo |
| `TODO/FIXME/HACK` | 0 reais | as 13 ocorrências de "todo" sem distinção de maiúsculas são a palavra portuguesa |
| `mismatch` | 236 / 33 | comparações legítimas **+ 4 identidades fabricadas**: `mismatch-local/mismatch-model` (adapter), `mismatch-provider/mismatch-model/1024` (`semanticCapability`), `mismatch-configured` (`sidebarStatusViewModel`) |
| `768` | 10 / 5 | defaults fabricados de dimensão: `embeddingLifecycleAdapter.ts:104`, `embeddingWorkStatusController.ts:161,169`, `semanticCapability.ts:186`, `sidebarStatusViewModel.ts:301,308,314,323`, `deviceRuntimeState.ts:244,256` |

**Módulos inalcançáveis a partir de `main.ts`** (análise de dependências por *metafile* do esbuild, 102/115 ficheiros de `src/` alcançáveis): `src/ai/types.ts`, `src/aiResponseModal.ts`, `src/experimental/embeddingBinaryFormat.ts`, `src/index/embeddingProgressModal.ts`, `src/indexSyncStatus.ts`, `src/maintenance/embeddingStatusExplanation.ts` (só tipos), **`src/search/embeddingStatusViewModel.ts`** (`buildEmbeddingStatusViewModel` só é usado em posição de tipo), `src/search/hybridSearchModal.ts`, `src/semanticSearch.ts` (raiz), `src/semanticSearchModal.ts` (raiz), `src/settings/pureGlobalSettingsComposition.ts`, `src/statusModal.ts` (F-25). Três métodos privados de `linaSearchView.ts` (`renderEmbeddingDiagnosticSummary/Details`, `handleEmbeddingDiagnosticAction`) não têm chamadores.

---

## 29. Findings detalhados

### F-01 — HIGH — Sem *fencing* de ownership após o início; proveniência perdida em silêncio
- **Ficheiros:** `main.ts:1484-1490, 2832-3060` (especialmente `2900-2902`); `src/device/ownershipGate.ts:151-203`; `src/index/embeddingGenerator.ts:904, 1324, 1476`; `src/maintenance/embeddingWorker.ts:273-353`.
- **Comportamento atual:** o gate de início usa `isAuthorizedSync()` (decisão **em cache**, `true` se `lastDecision===null`). `runGenerateLocalEmbeddings` chama `evaluateProvenance()` uma vez; se o resultado for `undefined` (já não autorizado) a geração **continua** e publica sem proveniência. Não há `evaluate(expectedEpoch)` antes de checkpoints nem de `publishCanonicalEmbeddings`. A transferência é executada pelo dispositivo Standby; o Active antigo só descobre a perda num `evaluate()` futuro (sem polling). `ownershipLostDuringOperation` só é consumido pelo gate de início e por código sem consumidores.
- **Risco:** dois escritores em `.lina/index/embeddings.jsonl`/`manifest.json`; artefacto publicado pelo dispositivo errado sem proveniência (`unknown`, aceite como utilizável); conflitos de sincronização; violação de *Producer Only Write*.
- **Reprodução:** A (Active) inicia geração com provider remoto (minutos); no dispositivo B executa-se "Promover a produtor ativo"; A termina e publica. Em alternativa: A com scheduler `automatic-local-only` continua a despachar após a transferência até um `evaluate()` ocorrer.
- **Evidência:** código citado; `grep` confirma ausência de `setInterval`/`registerInterval` para o gate e de consumidores de `ownershipLostDuringOperation` fora do gate de início; testes só cobrem decisão (`embeddingLifecycleWritePath.test.ts`, `embeddingOperationLifecycleCutover.test.ts`).
- **Recomendação:** verificar `evaluate(expectedEpoch)` (I/O) imediatamente antes de cada escrita canónica/checkpoint e antes de `onPersisting`; abortar com `not-active-producer` e registar; tratar `provenance===undefined` como falha de autorização; considerar `evaluate()` periódico (baixa frequência) ou reavaliação por evento de ficheiro de `ownership.json`.
- **Migração:** não.  **Prioridade:** P1.

### F-02 — HIGH — Auto-claim sobrescreve `ownership.json` vazio/truncado/inválido com `epoch:1`
- **Ficheiros:** `src/device/ownershipGate.ts:76-94`; `src/device/deviceOwnership.ts:148-171, 236-264, 275-308`; `main.ts:1297-1305` (`autoClaim=true`).
- **Comportamento atual:** `loadOwnership` devolve `null` para ficheiro ausente, vazio, JSON inválido **ou schema não reconhecido** (incluindo `schemaVersion` futuro). `evaluateOwnershipGate` trata `null` como "não reclamado" e, com `autoClaimIfUnclaimed`, chama `claimInitialOwnership`, que grava `epoch:1`, `reason:"initial"`. `transferOwnership` também parte de `epoch 1` se `current===null`.
- **Risco:** perda de autoridade legítima e **regressão de epoch** (viola "epochs nunca são reiniciados"); o dispositivo que recebeu o ficheiro parcial torna-se Active Producer. Histórico em `ownership-history/` fica inconsistente (só diagnosticado, `epoch-inconsistency`).
- **Reprodução [probe]:** manifesto válido (B, epoch 7) truncado a meio, dispositivo A `role=producer`, `autoClaim=true` ⇒ decisão `authorized`, `activeProducerId=A`, `epoch=1`. Ficheiro vazio ⇒ o mesmo.
- **Evidência:** probe (saída em §32). Testes existentes só cobrem "ficheiro vazio ⇒ `null`" (`deviceOwnership.test.ts:160`) e auto-claim com ficheiro **inexistente**.
- **Recomendação:** distinguir `missing` de `invalid/unreadable/future-schema`; só reclamar em `missing` confirmado (e, idealmente, após nova leitura/atraso); nunca sobrescrever um ficheiro existente inválido sem ação explícita do utilizador; reduzir a janela em `saveOwnership` (escrever sobre o destino quando o adapter o permitir, ou reler antes de reclamar).
- **Migração:** não.  **Prioridade:** P1.

### F-03 — HIGH — Plano `full-rebuild` é classificado como `update` incremental, sem confirmação, e auto-despachável
- **Ficheiros:** `src/index/embeddingWorkStatusController.ts:152-238`; `src/index/embeddingLifecycleModel.ts:379-495`; `src/index/embeddingLifecycleAdapter.ts:82-216`; `src/index/embeddingUpdatePlan.ts:247-283`; `src/maintenance/embeddingScheduler.ts:374-437`.
- **Comportamento atual:** `classifyEmbeddingWork` ignora `plan.mode`/`plan.reasons` e decide só por identidades lifecycle + contagens. `buildEmbeddingWorkLifecycleSnapshot` constrói `publishedIdentity` com `inputVersion: 1` fixo e `dimensions = updatePlan.targetIdentity.dimensions ?? summary.dimensions ?? 768` (prefere o **alvo** ao publicado). Logo dimensões, `inputVersion`, identidade publicada incompleta e canónico com identidade mista nunca geram `INCOMPATIBLE`.
- **Risco:** o planeador central (que o gerador reexecuta) faz `full-rebuild` e descarta vetores reutilizáveis, mas UI/Policy/Scheduler tratam-no como `UPDATE_AVAILABLE`/`update`/**sem confirmação**; com `automatic-local-only` o Scheduler aprova o despacho (`auto-dispatch-approved`). Viola a invariante "rebuild destrutivo exige confirmação". Pesquisa continua `full` no Read Path.
- **Reprodução [probe com o planeador real]:** (1) manifesto legado (provider/modelo/dimensões, sem `inputVersion/prefixMode`) ⇒ `plan.mode=full-rebuild` (`published-identity-incomplete`), lifecycle `UPDATE_AVAILABLE`, ação `update`, `requiresConfirmation=false`, `schedulerCanDispatch=true`. (2) registos canónicos com identidade diferente da do manifesto (par parcialmente sincronizado) ⇒ `plan.mode=full-rebuild` (`canonical-identity-mixed`), mesmo resultado. Controlo: provider alterado ⇒ `INCOMPATIBLE`, `rebuild`, confirmação. Dimensões: o alvo pré-validação copia as dimensões publicadas (`resolvePreValidationTargetIdentity`), logo só é detetável após a validação no gerador.
- **Recomendação:** o lifecycle deve consumir `plan.mode`/`reasons` (ou o adapter deve mapear `full-rebuild` ⇒ `INCOMPATIBLE`/`full-rebuild`); usar identidade **publicada real** (manifesto) e `inputVersion` real; teste de equivalência plano↔lifecycle.
- **Migração:** não.  **Prioridade:** P1.

### F-04 — HIGH — Teto de leitura JSONL ⇒ `INDETERMINATE` ⇒ sem update nem rebuild
- **Ficheiros:** `src/index/embeddingGenerator.ts:317-356`; `src/index/embeddingResourceGuard.ts`; `src/index/embeddingUpdatePlan.ts:267-269`; `src/index/embeddingLifecycleModel.ts:408-417, 709-710`; `src/index/embeddingLifecycleWritePath.ts:108-110`; `main.ts:1795-1829`; `src/maintenance/embeddingUpdateConfirmation.ts:61-123`.
- **Comportamento atual:** `readCanonicalEmbeddingFileState` devolve `unreadable` quando `evaluateEmbeddingBridgeRead` nega (desktop ≈ 53,3 MB, mobile ≈ 11,2 MB). O plano fica `indeterminate`, o snapshot `INDETERMINATE` (`action:none`, `canExecute:false`) e o gate de início devolve `indeterminate` ⇒ o Worker responde `not-capable`; `confirmAndRequestEmbeddingGeneration` termina com `PRODUCER_OPERATION_UNAVAILABLE_MESSAGE` (`main.ts:1826-1829`). `prepareEmbeddingUpdateConfirmation` só devolve `null` para Companion ou "sem trabalho", pelo que, com providers de custo externo (p. ex. Mistral), o utilizador ainda vê **primeiro o modal de custo** para uma operação que será recusada a seguir. Não existe ação de rebuild a partir de `INDETERMINATE`. (`capability.canRequestUpdate` permanece `true` neste estado — inconsistente com `canExecute:false`.)
- **Risco:** a partir de ~2,5–6 k chunks (desktop) o Producer deixa de poder atualizar ou reconstruir embeddings, com mensagem enganadora; o leitor por binário (Companion) não resolve o lado de escrita.
- **Reprodução [probe]:** limites e nº de chunks em §22; `classifyEmbeddingWork({canonicalReadability:"unreadable"})` ⇒ `INDETERMINATE`, `action none`, `canExecute false`.
- **Recomendação:** separar "ilegível por limite de recursos" de "ilegível por corrupção"; permitir `full-rebuild` com confirmação (não requer ler o canónico) e/ou avaliar trabalho a partir do manifesto+chunks sem materializar JSONL; mensagem específica.
- **Migração:** não (comportamento de leitura/decisão).  **Prioridade:** P1.

### F-05 — MEDIUM — Derivação de ações da LINA-14 só vive em código morto; botão real usa predicado local
- **Ficheiros:** `src/search/linaSearchView.ts:15, 2827-2844, 2904-3002`; `src/search/embeddingStatusViewModel.ts`; `tests/search/embeddingStatusActionDerivation.test.ts`.
- **Comportamento:** `showUpdateEmbeddingsButton` = `isAuthorizedProducer===true && workAvailable===true && operação parada && indexReady`; rótulo fixo; `buildEmbeddingStatusViewModel` só é referenciado em `ReturnType<typeof …>`; `renderEmbeddingDiagnosticSummary/Details` e `handleEmbeddingDiagnosticAction` não têm chamadores; `requiresFullRebuildConfirmation` (única origem de `isFullRebuild=true`) só existe nesse ramo morto.
- **Risco:** falsa confiança (os testes B4.1 passam sobre código inalcançável); comportamento real diverge da baseline ("UI como apresentadora pura"); estados `ERROR`/`retry`, `INDEX_ONLY` ("Gerar") e `INCOMPATIBLE` ("Reconstruir") não têm rótulo/ação próprios na sidebar.
- **Evidência:** análise de alcançabilidade por *metafile* + `grep` dos chamadores.
- **Recomendação:** ligar a sidebar à decisão canónica (ação/rótulo/`canExecute`/`requiresConfirmation`) e remover o código morto, ou remover a afirmação da baseline.
- **Migração:** não.  **Prioridade:** P2.

### F-06 — MEDIUM — Seis sintetizadores de snapshot com identidades fabricadas; compatibilidade tautológica no diagnóstico
- **Ficheiros:** `embeddingLifecycleAdapter.ts:98-118`; `semanticCapability.ts:184-212`; `sidebarStatusViewModel.ts:255-330`; `deviceRuntimeState.ts:235-260`; `deviceDiagnostics.ts:378-398`; `embeddingWorkStatusController.ts:158-201`; `main.ts:1043-1050, 1073, 1139`.
- **Comportamento:** quando não recebem snapshot, estes módulos sintetizam identidade/contrato a partir de booleanos com valores inventados (`ollama/nomic-embed-text/768`, `default-producer/default-model`, `mismatch-local`, `mismatch-configured`, `contractId:"default"`). **Em produção** `main.ts:1073` e `:1139` chamam `resolveDeviceRuntimeState` **sem** `lifecycleSnapshot`, pelo que o `DeviceRuntimeState` (que alimenta `getLiveAuthorityRuntimeState`, `embeddings.configured/exists`) usa o ramo sintético. `getDeviceDiagnostics` (`main.ts:1043`) passa o contrato **publicado** como identidade publicada **e** de dispositivo (`adapter:98-110`): compatibilidade sempre "compatible" (tautologia); o modo mostrado vem de `semanticAvailability`, podendo contradizer `primary`.
- **Risco:** estado derivado por ficção; diagnóstico pode mostrar `READY` com modo `text-only`; baseline §6.1 violada.
- **Recomendação:** tornar obrigatório o snapshot nos consumidores; remover os ramos sintéticos; o diagnóstico deve comparar contrato publicado vs identidade alvo do dispositivo.
- **Migração:** não.  **Prioridade:** P2.

### F-07 — MEDIUM — `NO_TEXT_INDEX` inalcançável no snapshot vivo
- **Ficheiros:** `embeddingWorkStatusController.ts:232`; `main.ts:884-913`.
- **Comportamento:** `buildEmbeddingWorkLifecycleSnapshot` fixa `upstreamTextIndex:"ready"`. **[probe]:** índice textual vazio com embeddings canónicos presentes (0 chunks, 100 obsoletos) ⇒ `UPDATE_AVAILABLE`, `read.effectiveMode "full"`, ação `update` (publish-only), gate de início `allowed`.
- **Risco:** UI/decisão oferecem "atualizar" sem índice textual; o gerador falha com "Índice textual vazio" (mensagem tardia). Pesquisa semântica anunciada `full`.
- **Recomendação:** passar o estado real do índice textual (`readTextIndexStatus`) ao snapshot.
- **Migração:** não.  **Prioridade:** P2.

### F-08 — MEDIUM — `purgeOrphanEmbeddingRecords` fora do coordenador; ramo "tudo purgado" não atómico
- **Ficheiros:** `main.ts:2196-2242`; `src/index/embeddingPersistence.ts:989-1090` (`1077-1088`); `src/index/indexWriteCoordinator.ts:92-105`.
- **Comportamento:** o purge corre depois de `processAutomaticIndexUpdateBatch` libertar o token; `startEmbeddingGeneration` só exige `activeOperation===null`, portanto uma geração pode arrancar durante o purge. Ambos usam os mesmos ficheiros de staging (`embeddings.publish.tmp`, `manifest.publish.tmp`). No ramo "tudo purgado" remove-se `embeddings.jsonl` **antes** de reescrever o manifesto com `adapter.write` direto e mantém-se `vectorContract` na raiz do manifesto. Após o purge não há `invalidateRuntimeEmbeddingIndex` nem `markDirty` de trabalho.
- **Risco:** dois publicadores simultâneos; par canónico inconsistente se houver crash no ramo final.
- **Recomendação:** executar o purge sob token do coordenador/single-flight do Manager; usar o protocolo transacional também no ramo final; invalidar cache/estado.
- **Migração:** não.  **Prioridade:** P2.

### F-09 — MEDIUM — Protocolo de publicação expõe janela sem canónico; recuperação só ao iniciar geração
- **Ficheiros:** `embeddingPersistence.ts:872-899`; `embeddingGenerator.ts:984`; `indexStore.ts:~440-500` (mesmo padrão em `saveTextIndex`).
- **Comportamento:** o canónico é movido para `.lina/producer/backups/` antes de o novo entrar; embeddings são publicados antes do manifesto. `recoverEmbeddingPersistenceArtifacts` só é chamado dentro de `generateEmbeddingsForChunks`.
- **Risco:** ferramentas de sincronização observam eliminação dos artefactos canónicos (e, com `.lina/producer/` excluído, o backup nunca chega aos outros dispositivos); um crash deixa o par inconsistente/ausente até à próxima geração manual; Companions ficam sem pesquisa semântica entretanto.
- **Recomendação:** recuperação no arranque do Producer (antes de qualquer leitura de estado); avaliar publicação por *rename-over* quando o adapter o permita; documentar a janela.
- **Migração:** não.  **Prioridade:** P2.

### F-10 — MEDIUM — Sem validação contagem-vs-manifesto no consumo
- **Ficheiros:** `runtimeEmbeddingIndex.ts:273-323, 495-545`; `embeddingGenerator.ts:317-356`; `embeddingPersistence.ts:358-402` (validação só em publicação/recuperação).
- **Comportamento:** `manifest.embeddings.totalEmbeddings/sourceTotalChunks` são gravados mas não verificados ao ler. Truncagem em fronteira de linha (ou perda de registos) produz índice menor sem erro.
- **Risco:** pesquisa semântica silenciosamente incompleta no Companion; estado `READY`.
- **Recomendação:** comparar contagem de registos lidos com `totalEmbeddings`; divergência ⇒ estado explícito (`corpus-load-failed`/incompleto).
- **Migração:** não (campo já persistido).  **Prioridade:** P2.

### F-11 — MEDIUM — "Local" decidido por id do provider
- **Ficheiros:** `src/ai/providerCapabilities.ts:15-52`; `main.ts:1540-1544`; `embeddingWorkStatusController.ts:205`; `src/settings/pureLocalSettingsModel.ts:78` (tabela paralela).
- **Comportamento:** `ollama` ⇒ `isLocal:true`, `cost:"none"`, independentemente da Base URL; `automatic-local-only` despacha para qualquer host Ollama configurado (LAN/Internet).
- **Risco:** envio automático de conteúdo de notas para um servidor remoto sem confirmação, contra a intenção de "local-only".
- **Recomendação:** classificar local por destino (loopback/mesma máquina) ou exigir confirmação para Base URL não-loopback; unificar as duas tabelas de capacidades.
- **Migração:** não.  **Prioridade:** P2.

### F-12 — MEDIUM — Setting oculta causa regeneração perpétua
- **Ficheiros:** `main.ts:1754, 2676, 2713, 2909`; `src/settings.ts:748`; `src/settings/settingsMigrations.ts:127-128`.
- **Comportamento:** `generateOnlyMissingEmbeddings=false` (p. ex. herdada de `autoGenerateEmbeddingsOnlyWhenNeeded=false`) faz `readEmbeddingUpdatePreview(incremental:false)` ignorar o canónico ⇒ plano `initial-build` com todos os chunks. Sem UI para a alterar.
- **Risco:** com `automatic-local-only`, após cada geração bem-sucedida o Scheduler reavalia `hasEmbeddingWork()` (sempre `true`) e reagenda ⇒ regeneração total em ciclo; a sidebar mostra permanentemente "atualização disponível".
- **Recomendação:** remover/forçar a setting ou expô-la com avisos; nunca usar `incremental:false` na avaliação de trabalho do Scheduler.
- **Migração:** possível limpeza de `data.json`.  **Prioridade:** P2.

### F-13 — MEDIUM — Leitura integral no arranque e leituras repetidas
- **Ficheiros:** `main.ts:496, 1092-1155, 3682-3784`; `hybridSearch.ts:90-209`; `embeddingGenerator.ts:1569-1700`.
- **Comportamento:** `onload` aguarda `loadDataFromDisk` → `refreshDeviceRuntimeState` → `getSemanticSearchAvailability` → `readEmbeddingStatus` (lê `chunks.jsonl` e `embeddings.jsonl`, *hash* de todos os chunks). O controller repete 2 leituras por refresh; em `detailsAvailable===false` instancia cache runtime descartável.
- **Risco:** arranque lento e pico de memória (desktop/mobile); contradiz "arranque leve" e "settings passivas".
- **Recomendação:** derivar disponibilidade do manifesto+`stat` no arranque; calcular o plano sob demanda e partilhar resultado entre consumidores.
- **Migração:** não.  **Prioridade:** P2.

### F-14 — MEDIUM — Companion mobile depende de cópia binária opt-in
- **Ficheiros:** `runtimeEmbeddingIndex.ts:495-523`; `hybridSearch.ts:74-88`; `settings.ts` (`maintainBinaryEmbeddingCopy` por omissão `false`).
- **Comportamento:** JSONL > ~11,2 MB ⇒ `no-safe-source` ⇒ "binary-required"; a cópia binária só existe se o Producer a criar (manual/opt-in).
- **Risco:** pesquisa semântica indisponível no telemóvel para vaults acima de ~0,5–1,3 k chunks na configuração por omissão (comportamento documentado como experimental).
- **Recomendação:** decisão de produto: tornar a cópia binária parte do fluxo recomendado ou comunicar o limite na UI do Companion.
- **Migração:** não.  **Prioridade:** P3.

### F-15 — LOW — Cancelamento conta como falha no backoff
- **Ficheiros:** `main.ts:1562-1565`; `embeddingScheduler.ts:274-286`. `result.success=false` também para `cancelled`.
- **Recomendação:** propagar `cancelled` e não penalizar.  **Prioridade:** P3.

### F-16 — LOW — Código canónico sem consumidores / ramos mortos
- `evaluateOperationDecisionFromSnapshot`/`evaluateCanonicalDecision` (`embeddingWorker.ts:43-93, 266-271`); `validateLifecycleInvariants` (8/15); fase `finalizing` inexistente no Manager; `canStart` nunca consultado. **Prioridade:** P3.

### F-17 — LOW — Defaults *fail-open*
- `OwnershipGate.isAuthorizedSync()` devolve `true` se `lastDecision===null` (`ownershipGate.ts:186-188`); `canDispatchAutomatically` devolve `true` sem snapshot do controller (`main.ts:1554`); `defaultProducerRuntime` (Active, `semanticAvailable:true`) quando não há runtime (`embeddingWorkStatusController.ts:174-203`); adapter: `effectiveRole ?? "producer"`, `isActiveProducer ?? true`, `configured ?? true` (`embeddingLifecycleAdapter.ts:89-92`). Mitigado a jusante por outros gates. **Prioridade:** P3.

### F-18 — LOW — Falhas silenciosas
- `searchRuntimeSemanticIndex` devolve `[]` se `query.length !== index.dimensions` (`semanticSearch.ts:197`) e `searchSemanticIndex` engole o erro por registo com `console.warn`; o gerador devolve sucesso *no-op* com canónico ilegível se o snapshot divergir (`embeddingGenerator.ts:1049-1061`). **Prioridade:** P3.

### F-19 — LOW — Resíduos de segredos
- Ver §18. **Prioridade:** P3.

### F-20 — LOW — Botão Cancelar ignora `non-cancellable`
- `linaSearchView.ts:2080-2089`: só trata `no-active-operation`. **Prioridade:** P3.

### F-21 — LOW — Sem rebuild explícito na UI ativa
- `isFullRebuild` só é `true` no ramo morto; o modal destrutivo dedicado (`request.isFullRebuild`) nunca é apresentado em produção. A confirmação genérica cobre `rebuild` via política. **Prioridade:** P3.

### F-22 — LOW — Tabelas de capacidades duplicadas; capabilities por plataforma
- `providerCapabilities.ts` vs `pureLocalSettingsModel.ts`; `DeviceCapabilities.role` = plataforma (`deviceCapabilities.ts:33-46`). **Prioridade:** P3.

### F-23 — LOW — Síntese de contrato
- `extractVectorContract` (`vectorContract.ts:176-223`) substitui contrato inválido por síntese e sintetiza contratos legados; aceitável para compatibilidade mas sem sinalização. **Prioridade:** P3.

### F-24 — INFO — Divergências documentação ↔ runtime: §27 (D1–D12).

### F-25 — INFO — Módulos inalcançáveis: §28.

### F-26 — INFO — Efeitos laterais do gate `npm run build`
- Altera o `main.js` **rastreado** (1 linha minificada) e executa `copy:test-vault`, que instala `main.js/manifest.json/styles.css` em `D:\anselmo\__obsidian__\zettel\.obsidian\plugins\lina`. O `main.js` foi restaurado (`git checkout -- main.js`) antes do commit documental; a cópia no vault de teste **não** foi revertida (é um artefacto de build local, fora do repositório).

---

## 30. Próximas fases propostas (não implementadas)

Ordenadas por dependência; cada uma pequena e verificável.

1. **LINA-15A — Ownership hardening:** distinguir `missing`/`invalid`/`future-schema`; proibir auto-claim sobre ficheiro existente inválido (F-02); `evaluate(expectedEpoch)` antes de checkpoint/publicação e abortar com `not-active-producer`; tratar `provenance===undefined` como falha (F-01); testes de perda a meio de geração/persistência.
2. **LINA-15B — Reconciliação plano↔lifecycle:** identidade publicada real e `inputVersion` real; `full-rebuild` do planeador ⇒ `INCOMPATIBLE` com confirmação; teste de equivalência (F-03).
3. **LINA-15C — Estado de escrita para canónicos grandes:** separar limite de recursos de corrupção; permitir `full-rebuild` a partir de `INDETERMINATE` por limite; avaliar trabalho sem materializar JSONL; mensagem específica; alinhar `canRequestUpdate` com `canExecute` (F-04).
4. **LINA-15D — Fonte única de snapshot:** remover sintetizadores e identidades fabricadas; `DeviceRuntimeState` a consumir o snapshot; estado real do índice textual (`NO_TEXT_INDEX`); diagnóstico com comparação contrato↔alvo (F-06, F-07).
5. **LINA-15E — UI:** sidebar a consumir `deriveEmbeddingWritePathDecision`; ações/rótulos por estado; cancelamento com `non-cancellable`; remover código morto e testes associados ou religá-los (F-05, F-20, F-21, F-25).
6. **LINA-15F — Persistência e sync:** recuperação de publicação no arranque do Producer; purge sob coordenador e transacional; validação contagem-vs-manifesto; revisão do protocolo de publicação (F-08, F-09, F-10).
7. **LINA-15G — Custo/privacidade e settings:** localidade por destino; limpeza de `generateOnlyMissingEmbeddings`; cancelamento sem backoff; unificar tabelas de capacidades (F-11, F-12, F-15, F-22).
8. **LINA-15H — Arranque e performance:** remover leitura integral do arranque; partilhar cálculo de plano (F-13).
9. **LINA-15I — Testes e documentação:** fechar lacunas de §26 e corrigir D1–D12 (F-24, F-16, F-17, F-18, F-19, F-23).

---

## 31. Quality gates (resultados registados)

Executados neste repositório a partir de `D:\_dev\obsidian\lina` (branch `master`, HEAD `23862c5`, árvore limpa no início).

| Comando | Resultado |
|---|---|
| `npm test` | **147 ficheiros / 1938 testes aprovados** (12,8 s), exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint:obsidian:strict` | exit 0 (`--max-warnings=0`) — **0 erros, 0 avisos** |
| `npm run build` | exit 0 (inclui `typecheck`, esbuild produção e `copy:test-vault`); efeito lateral descrito em F-26 |
| `npm run release-check` | exit 0 — "READY FOR OBSIDIAN RELEASE", versão 0.3.1 |
| `git diff --check` | exit 0; `git status --short` só com este relatório (`??`) |

`npm ci` **não** foi executado: a tarefa é documental/de auditoria, não altera dependências nem código; o ambiente já continha `node_modules` válidos (o `npm test`/build corridos com sucesso).

## 32. Apêndice — probes executáveis (fora do repositório)

Scripts em scratchpad da sessão (não versionados); compilam módulos reais de `src/` com o `esbuild` do projeto. Resultados relevantes:

- **Probe 1/4 (F-03, F-07):** planeador real `calculateEmbeddingUpdatePlan` + `buildEmbeddingWorkLifecycleSnapshot`:
  - manifesto legado ⇒ `planMode: full-rebuild`, `lifecyclePrimary: UPDATE_AVAILABLE`, `action: update`, `requiresConfirmation: false`, `schedulerCanDispatch: true`;
  - canónico misto ⇒ idem;
  - controlo compatível ⇒ `READY`, `action none`;
  - provider alterado ⇒ `INCOMPATIBLE`, `rebuild`, `requiresConfirmation: true`, `startGate(automatic)=confirmation-required`;
  - índice textual vazio + canónico com 100 obsoletos ⇒ `UPDATE_AVAILABLE`, `readMode full`, `publish-only`.
- **Probe 2 (F-04):** `evaluateEmbeddingBridgeRead` — limites desktop 55 924 053 B (53,3 MB), mobile 11 744 051 B (11,2 MB); 16 597 B/registo (768-d) e 21 993 B/registo (1024-d) com floats aleatórios; `canonicalReadability:"unreadable"` ⇒ `INDETERMINATE`, `action none`, `canExecute false`, `canRequestUpdate true`.
- **Probe 3 (F-02):** `evaluateOwnershipGate` com manifesto B/epoch 7 truncado ou vazio e dispositivo A `producer`, `autoClaimIfUnclaimed:true` ⇒ `{authorized:true, activeProducerId:A, epoch:1}` e manifesto reescrito com `reason:"initial"`.

**Confirmações de âmbito:** nenhuma nota do vault foi alterada; nenhum embedding foi gerado; nenhuma chamada a providers externos; nenhuma alteração fora do relatório (o `main.js` modificado pelo build foi restaurado).
