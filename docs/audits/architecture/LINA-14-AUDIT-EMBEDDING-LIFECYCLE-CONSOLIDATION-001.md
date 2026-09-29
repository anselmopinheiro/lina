# LINA-14-AUDIT-EMBEDDING-LIFECYCLE-CONSOLIDATION-001

**Tipo:** Auditoria arquitetural — congelação do modelo (nenhum código, teste, schema ou migration alterado; sem commit)
**Contrato superior:** `PROMPT-MESTRA-LINA-002`, `AGENTS.md`, auditorias LINA-07 a LINA-13 (ver §0.3)
**Estado Git:** `master`, HEAD `f5f840d`

---

## 0. Método, limites e conflitos

### 0.1 Método
Consolidação das auditorias LINA-07, 08, 09, 10, 12, 12B, 13-P0 e 13-P1-AB, **confrontada de novo com o código** nos pontos que sustentam decisões de modelo (`embeddingState.ts`, `embeddingUpdatePlan.ts`, `embeddingWorkStatusController.ts`, `embeddingWorkflowState.ts`, `semanticCapability.ts`, `deviceRuntimeState.ts`, `runtimeEmbeddingIndex.ts`, `vectorContract.ts`, `companionConsumptionState.ts`, `producerState.ts`, `ownershipGate.ts`, `main.ts` — publicação, produtor, arranque —, `sidebarStatusViewModel.ts`, `linaSearchView.ts`).

### 0.2 Limites
- Nenhum teste foi executado; nada foi reproduzido em runtime. "Confirmado" = cadeia de chamadas lida.
- Não li integralmente `embeddingGenerator.ts` (1771 linhas) nem o miolo de `embeddingPersistence.ts`; a análise do **Process Path** assenta no que `main.ts` observa (diagnósticos `stage: checkpoint|publication|recovery`), em `AGENTS.md` e nos testes de ciclo.
- Este documento **não substitui** LINA-12/12B/13; usa os identificadores `B1…B18` (LINA-13-P0), `P-A*`/`P-B*` (LINA-13-P1-AB) e `F1…F11` (LINA-12).

### 0.3 Conflitos identificados com `PROMPT-MESTRA-LINA-002` (a resolver antes de implementar)
| # | Contrato MESTRA | Realidade | Resolução |
|---|---|---|---|
| C1 | Companion "não assume estado operacional do Producer" | O Companion calcula localmente `workAvailable`, mostra "Atualização necessária" e usa `full-rebuild` a partir das **suas** settings (`main.ts:2591-2609`, VM sem distinção de papel) | O modelo futuro põe `write = not-applicable` no Companion (§5.4) |
| C2 | "Zero Silent Fallback": incompatibilidade → avisar, suspender semântica, permitir texto | A pesquisa híbrida faz o fallback **com aviso**; a Sidebar pode continuar a afirmar "híbrida disponível" com cache antiga (B2). O `VectorContract` (`contractId`, `evaluateVectorContractCompatibility`) **não é usado** no Read Path em produção: a compatibilidade é comparada campo a campo em 3 sítios | Uma função única de comparação de identidade (§5.2) |
| C3 | Testes: `npm run lint:obsidian:strict` | `AGENTS.md` (prioridade 1) fixa que o modo strict falha com os 7 avisos históricos e só bloqueia release quando o baseline for zero | Prevalece `AGENTS.md` |
| C4 | "Native Settings Pages" com 8 páginas | `AGENTS.md` descreve 12 grupos/47 IDs declarativos; fora do âmbito | Não tocar |
| C5 | Workflow "… Commit → Push" | Regras da sessão exigem autorização explícita para commit/push | Não aplicável a esta auditoria |

---

## 1. Resumo executivo

O Lina tem hoje **um planeador factual excelente** (`calculateEmbeddingUpdatePlan` + `calculateEmbeddingState`, baseados em hashes e identidade) e **nenhum modelo único** que o traduza em estado de produto. A partir do mesmo plano, cinco componentes produzem cinco reduções diferentes a booleano ("há trabalho"), e a interface recompõe o estado a partir de sinais soltos: cache do Read Path, estado de trabalho, estado de operação, fase da cópia binária, idade em `producer-state.json` e mensagens imperativas.

Decisões propostas (a congelar):

1. **Atualizado = ausência de trabalho segundo o plano** (hashes + identidade + publicação pendente). A idade é sempre informação.
2. **Desatualizado** ocorre por: chunks novos/alterados; mudança de provider, modelo, formato de input, prefixo ou dimensão; conflito de identidade com o contrato; publicação de limpeza pendente. **Não** ocorre por idade, mudança de epoch, nem por remoção de notas *per se* (esta é limpeza sem custo e sem impacto na pesquisa).
3. Modelo consolidado **`EmbeddingLifecycleSnapshot`** (superconjunto de `EmbeddingWorkflowSnapshot`), revisionado, com quatro regiões ortogonais — `read`, `write`, `process`, `history` — e um único **`primary`** derivado, que é o que a interface apresenta.
4. Máquina de estados de 12 estados primários (§6), com estados impossíveis explicitados e testáveis por propriedades.
5. Roadmap em seis fases pequenas e reversíveis, com uma fase de **shadow mode** antes de qualquer corte de UI (§8).

Respostas ao critério final (detalhe em §12):

1. **Nota muda → "é necessário gerar embeddings":** evento do Vault → fila do `TextIndexWorker` (só Active Producer, auto-update ligado, índice válido) → `saveTextIndex` → `markEmbeddingWorkStatusDirty` → controller (`dirty`→`calculating`→`ready`) → `calculateEmbeddingUpdatePlan` → `workAvailable` → Sidebar. Se o auto-update estiver desligado, a cadeia **para no primeiro passo e nada o sinaliza** (B13/B14).
2. **Embeddings válidos → quem decide a pesquisa semântica:** hoje, para *execução*, o `RuntimeEmbeddingIndexCache` mais comparações inline; para *apresentação*, `DeviceRuntimeState.embeddings` (cache). No modelo futuro: **uma função pura** `evaluateReadCapability(facts, deviceIdentity)` sobre a mesma comparação de identidade, avaliada no snapshot e revalidada sobre o índice carregado no momento da pesquisa.
3. **Único estado que a interface apresenta:** `EmbeddingLifecycleSnapshot.primary`.

---

## 2. Arquitetura atual

### 2.1 Quatro caminhos, sem dono comum

```
                    ┌────────────────────── DISCO ──────────────────────┐
                    │ .lina/index/{manifest,notes,chunks,embeddings}     │
                    │ .lina/ownership.json  .lina/producer-state.json    │
                    │ .lina/producer/{checkpoints,staging,backups}       │
                    └───────┬───────────────┬─────────────────┬──────────┘
                            │               │                 │
   READ PATH ───────────────┘   WRITE PATH ──┘   PROCESS PATH ─┘   HISTORY
   DeviceRuntimeState (cache)   calculateEmbeddingUpdatePlan       EmbeddingOperationManager (memória)
   evaluateSemanticCapability   EmbeddingWorkStatusController      EmbeddingWorker.state (memória, duplicado)
   getSemanticSearchAvailability calculateEmbeddingState           IndexWriteCoordinator (token)
   RuntimeEmbeddingIndexCache   Scheduler (hasEmbeddingWork)       BinaryEmbeddingCopyController
   VectorContract (só stamping) política de custos                 producer-state.json (só Produtor)
                            \          |                 /
                             \         |                /
                              └── PRESENTATION: sidebarStatusViewModel + statusEl + diagnóstico + Definições ──┘
```

### 2.2 Read Path — quem decide se a pesquisa semântica pode funcionar?
**Ninguém, isoladamente.** Cinco implementações vivas (LINA-13-P0 §1.1): R1 (`DeviceRuntimeState`, cache), R2 (`getSemanticSearchAvailability`), R3 (identidade inline na híbrida), R4 (idem na pura), R5 (modal legado), R6 (2.ª avaliação no diagnóstico), R7 (`consumptionState.embeddingState.available`). Em execução, a decisão efetiva é **R3/R4 sobre o `RuntimeEmbeddingIndexCache`** (validação de manifesto, ficheiro, identidade, `validForSearch`, `count>0`, estabilidade da fonte). Em apresentação, é **R1**, que só é atualizada em três situações programáticas.

Sobre o **Vector Contract**: `createVectorContract` é usado na publicação (`embeddingPersistence.ts:771`, `embeddingBinaryStorage.ts:489`) e `extractVectorContract` no Companion (`main.ts:2468`, `companionConsumptionState.ts:352`). `evaluateVectorContractCompatibility` e `resolveEffectiveEmbeddingRuntimeConfig` **não têm chamadores de produção** (o parâmetro `targetVectorContract` nunca é passado). Conclusão: o contrato descreve o que foi publicado, mas a **compatibilidade nunca é decidida pelo contrato** — é decidida por comparações campo a campo (`provider`, `model`, `inputVersion`, `prefixMode`, dimensão) em R2, R3 e R4, e por `calculateEmbeddingState` ao nível do registo.

### 2.3 Write Path — quem decide que é preciso gerar?
O **facto** é decidido por `calculateEmbeddingUpdatePlan` (hashes de `textHash` e `embeddingInputHash`, identidade publicada vs alvo, checkpoint, duplicados/inválidos). O **veredicto booleano** é decidido, de forma diferente, em: `hasEmbeddingWorkAvailable` (controller), `main.ts:1674` (política), `main.ts:2584` (scheduler), botão da Sidebar, VM e execução (`embeddingGenerator.ts:999-1047`). Ver LINA-13-P0 §2.

### 2.4 Process Path — quem sabe que uma operação está em curso?
Oficialmente `EmbeddingOperationManager` (via `MaintenanceEngine`), com `status` e `phase` (`preparing`, `waiting-for-text-index`, `validating`, `generating`, `persisting`, `completed`, `failed`, `cancelled`). Em paralelo: `EmbeddingWorker.state` (`idle|running|error`, sem consumidores úteis), `IndexWriteCoordinator` (exclusão de escrita), `EmbeddingScheduler.automaticDispatchInFlight`, `BinaryEmbeddingCopyController.phase`, `isSemanticPreparationActive()` e o texto imperativo de `statusEl`. A publicação dispara diagnósticos `stage: checkpoint|publication|recovery` (`onDiagnostic`), que `main.ts:2816-2830` reduz a três booleanos locais (`canonicalEmbeddingsPublished`, `checkpointChanged`, `recoveryCompleted`) — **não existe fase "publishing/finalizing" na operação**; só `persisting`.

### 2.5 Presentation Layer
- **Sidebar:** `stateContainer` (VM) + `statusEl` (imperativo) + acordeão "Estado" + botão contextual (condição própria) + código morto (`renderEmbeddingDiagnosticSummary/Details`, `buildEmbeddingStatusViewModel`).
- **Diagnóstico:** `runtime.embeddings` para modo/artefactos (corrigido em LINA-10), mais `companionSearch.mode` de R7 e uma 2.ª avaliação (R6).
- **Definições:** só papel/ownership e resumos; não mostram estado de embeddings além de "ativados/desativados".
- **Modais:** confirmação de custo (`explainEmbeddingStatus` por contagens) e progresso; modal de pesquisa semântica legado com cadeia própria.

---

## 3. Fontes de estado — inventário obrigatório

| Conceito | Fonte atual | Consumidores | Problemas |
|---|---|---|---|
| **Embeddings existem** | (a) manifesto textual `embeddingsEnabled` + secção `embeddings` (`parseManifestEmbeddingInfo`); (b) `embeddings.jsonl` existe com tamanho >0 (`readRuntimeEmbeddingSourceIdentityResult`); (c) `readEmbeddingStatus.exists`; (d) `DeviceRuntimeState.embeddings.exists` = `embeddingsDeclared ∨ binário` ∧ `vectorFile≠missing`; (e) `consumptionState.artifactAvailability.embeddings` | Índice runtime (b), `getSemanticSearchAvailability` (c), diagnóstico (d, e), VM ramo `missing` (d, e) | (d,e) tratam **`generationId` divergente como `invalid`** (`companionConsumptionState.ts:339-350`) — estado **normal** de drift (B8); `exists=false` com vetores válidos |
| **Embeddings compatíveis** | Comparação campo a campo em R2 (`hybridSearch.ts:123-128`), R3 (`:524-538`), R4 (`linaSearchView.ts:3786-3803`); `calculateEmbeddingState` por registo (`published-*-mismatch`); `VectorContract` **não usado** | Pesquisa (R3/R4), R1, plano (para `full-rebuild`) | 3 implementações da mesma comparação; contrato ignorado; `providerReachable`/`isChecking` mortos; `contractState==="mismatch"` inatingível na prática |
| **Embeddings atualizados** | `EmbeddingWorkRuntimeState.workAvailable===false` com `status==="ready"`; na Sidebar também `embeddingsFreshness` **por idade** (fallback) | Sidebar (linha "Embeddings"), diagnóstico legado (morto) | `undefined` (indeterminado) → "Atualizados" (B5); valor antigo durante `dirty` (B4); fallback por idade (B9/B10); "atualizado" é relativo ao **índice textual**, não ao vault (B13/B14) |
| **Atualização necessária** | 5 reduções: controller, política, scheduler, botão, VM (+ execução) | Botão, Sidebar, scheduler, pedido manual | Divergem em obsoletos/duplicados/`chunks=0`/`full-rebuild`/`embeddingsEnabled`/Companion (B6, B7); `canUpdate` sem leitores |
| **Geração em curso** | `EmbeddingOperationState.status/phase`; em paralelo `worker.state`, `semanticPreparing`, fase binária, `automaticDispatchInFlight`, token do coordenador, `statusEl` | Sidebar (botão, progresso, `semanticPreparing`), scheduler, modal de progresso | `semanticPreparing` altera a mensagem de **pesquisa** (S1); `cancelling`→`preparing`; sem fase de publicação |
| **Erros** | `operationState.error`; `workState.errorCategory="refresh-failed"`; `worker.state.lastError`; backoff do scheduler; `producer-state.maintenance.lastError` (persistido, só Produtor); `statusEl` | Sidebar (`statusEl`), workflow `ERROR`, política de retry | Perdem-se no reinício (exceto telemetria do Produtor); ERROR mascara o estado de dados; "concluído" apagado por `setStatus("")` (B18) |
| **Autoridade de escrita** | `OwnershipGate.lastDecision` (cache); `isAuthorizedSync()` otimista se `null`; `DeviceRuntimeState.isActiveProducer` (cache) | Worker, scheduler, botão, política | Duas caches; sem fencing durante a geração (B16); comando de transferência não atualiza a cache (B11) |
| **Histórico** | `manifest.embeddings.updatedAt`/`publicationId` (canónico); `producer-state.embeddings.lastSuccessfulPublicationAt` e `maintenance.*` (Produtor); `operationState.finishedAt` (memória) | Sidebar (idade), Companion | Sem "última operação" nem "última falha" fiáveis entre sessões/dispositivos |
| **Índice textual pronto** | `readTextIndexStatus.usability` (`ready|stale|missing|invalid`) | Sidebar (só `missing`), pesquisa, botão | `stale` ignorado; deteção desligada com exclusões por conteúdo (`main.ts:443`) |

---

## 4. Problemas (consolidação)

### 4.1 Estruturais (raiz)
| ID | Problema | Sintomas ligados |
|---|---|---|
| S-1 | Não há **modelo de estado de produto**: a apresentação recompõe estado a partir de sinais de baixo nível | B4, B5, B6, B9, B10, B12, S1–S6 |
| S-2 | **Cache do Read Path sem invalidação** | B1, B2, B3, B11 |
| S-3 | **Três (na verdade cinco) definições de "há trabalho"** | B6, B7, B5 |
| S-4 | **Compatibilidade sem contrato**: comparação campo a campo replicada; `VectorContract` decorativo | B2, C2 |
| S-5 | **Sem fencing** de autoridade durante a geração | B16 |
| S-6 | **Companion usa o Write Path** (calcula trabalho com settings locais) | C1, "Atualização necessária" inacionável |
| S-7 | **Dimensão upstream invisível**: o estado dos embeddings é relativo ao índice textual, não ao vault | B13, B14 |
| S-8 | **"Concluído" e "histórico" não existem como estado** | B18, perda de contexto entre sessões |
| S-9 | Mistura de **informação, aviso e ação** num único texto ("Atualização necessária") | UX (§9) |

### 4.2 Pontos corretos a preservar
Planeador puro e testado; `calculateEmbeddingState` com separação `validForSearch` / `reusableForNextGeneration`; single-flight e exclusão de escrita; checkpoints não pesquisáveis; publicação com rollback; política de custos; proveniência histórica e não bloqueante; `RuntimeEmbeddingIndexCache` com identidade de fonte; fallback textual da pesquisa.

---

## 5. Arquitetura recomendada

### 5.1 Princípios
1. **Um planeador, uma classificação, um snapshot, um estado apresentado.**
2. **Factos ≠ estado ≠ apresentação:** factos lidos uma vez por revisão; estado calculado por funções puras; apresentação só traduz.
3. **Read e Write ortogonais**, combinados só no `primary` por uma matriz explícita.
4. **Nada de polling:** invalidação por eventos nomeados + impressão digital de ficheiros na utilização.
5. **Aditivo e reversível:** nenhuma alteração de schema, manifesto ou persistência.

### 5.2 Definições a congelar

#### "Existem"
- **Publicados:** o manifesto declara `embeddings` com identidade completa (provider, modelo, dimensões, `inputVersion`, `prefixMode`) e `embeddings.jsonl` existe (>0 bytes).
- **Utilizáveis:** `validForSearchCount > 0` para a identidade do dispositivo.
- A pesquisa depende de **utilizáveis**; o estado "publicados mas nenhum utilizável" é `INCOMPATIBLE` ou `INDETERMINATE`, nunca `READY`.
- `generationId` textual diferente do `sourceTextGenerationId` **não** invalida existência (é o estado normal de drift; resolve B8).

#### "Compatíveis"
Função única `compareEmbeddingIdentity(published, target): { compatible, reasons[] }` com `reasons ∈ {provider, model, dimensions, input-version, prefix-mode, incomplete}`; a igualdade de `contractId` é o atalho canónico quando ambos os lados têm contrato. Duas aplicações, uma função:
- **Compatibilidade de pesquisa:** publicado vs identidade do *dispositivo* (Companion: contrato herdado; Produtor: settings locais). Decide `read`.
- **Compatibilidade de geração:** publicado vs identidade *alvo* da próxima geração. Decide `incremental` vs `full-rebuild` (já implementado no planeador).

#### "Atualizado" (conteúdo)
> Atualizado ⇔ `classifyEmbeddingWork(plan) = none` ⇔ todos os chunks atuais do índice textual publicado têm registo `validForSearch` para a identidade alvo, e não há publicação de limpeza pendente.

- Critérios permitidos: **hash dos conteúdos** (`textHash`, `embeddingInputHash`), **plano de atualização**, **compatibilidade de identidade**.
- **Proibido:** idade cronológica, epoch, existência de checkpoint isoladamente, heartbeat do produtor.
- "Atualizado" é sempre **relativo ao índice textual publicado**. A frescura do índice face ao vault é uma dimensão upstream separada (`textIndex.freshness`), apresentada à parte e que pode qualificar o estado (`READY` com aviso "índice textual desatualizado").

#### "Desatualizado" (`write.updateRequired`)
| Causa | Trabalho | Custo | Pesquisa atual | Severidade proposta |
|---|---|---|---|---|
| Nota nova / alterada (chunk `missing` ou `stale`) | `incremental` | provider | Continua **utilizável** (chunks inalterados) | ação |
| Nota eliminada / chunk removido (`obsolete`) | `publish-only` (limpeza) | **nenhum** | Inalterada (obsoletos já excluídos de `validForSearch`) | info |
| Duplicados / inválidos no canónico | `publish-only` | nenhum | Inalterada | info |
| Checkpoint recuperável cobre tudo | `publish-only` | nenhum | Inalterada | ação leve |
| Provider / modelo / dimensão / `inputVersion` / `prefixMode` alvo ≠ publicado | `full-rebuild` | provider (alto) | **Text-only** (Zero Silent Fallback) | ação bloqueante (`INCOMPATIBLE`) |
| Canónico ilegível / detalhes indisponíveis | — | — | Depende da fonte binária | `INDETERMINATE` (nunca "atualizados") |
| Mudança de epoch / ownership | **nenhum** | — | Inalterada | nunca |
| Idade | **nenhum** | — | Inalterada | nunca |

Decisão de produto a confirmar: **eliminação isolada de notas não deve pedir ação ao utilizador** (é `info`), podendo a limpeza ser feita na próxima atualização ou por publicação automática sem custo. É a única alteração de comportamento face ao atual (que trata obsoletos como "Atualização necessária").

### 5.3 `EmbeddingLifecycleSnapshot`

Recomenda-se **`EmbeddingLifecycleSnapshot`** como contrato público e `EmbeddingWorkflowSnapshot` como sub-região interna (`write` + `process`). Justificação: a interface e a pesquisa precisam de `read` e `write` do mesmo instante/revisão; um snapshot só de workflow obrigaria a duas leituras coordenadas (a origem de B1).

```ts
interface EmbeddingLifecycleSnapshot {
  readonly revision: number;              // monotónica; mesma para todas as regiões
  readonly computedAt: number;            // ms, informativo

  readonly read: {                        // "Consigo pesquisar?"
    readonly semanticAvailable: boolean;
    readonly effectiveMode: "full" | "text-only" | "unavailable";
    readonly compatibility: {
      readonly status: "compatible" | "incompatible" | "unknown" | "none";
      readonly reasons: readonly IdentityMismatchReason[];
      readonly published?: IdentitySummary;   // provider/model/dimensions/contractId
      readonly device?: IdentitySummary;
    };
    readonly source: "jsonl" | "binary" | "none";
    readonly reasonCode?: SemanticReasonCode;
  };

  readonly write: {                       // "Preciso gerar/publicar?"
    readonly work: EmbeddingWorkAssessment; // none | indeterminate | pending{mode,counts}
    readonly updateRequired: boolean;
    readonly reason?: WorkReason;
    readonly severity: "none" | "info" | "action" | "blocking";
    readonly cost: "none" | "local" | "external";
    readonly applicable: boolean;         // false no Companion
  };

  readonly process: {                     // "Está a decorrer algo?"
    readonly phase: "idle" | "checking" | "preparing" | "generating"
                  | "persisting" | "finalizing" | "cancelling";
    readonly progress?: { processed: number; total: number; reused: number; failed: number };
    readonly origin?: "command" | "sidebar" | "automatic" | "internal";
    readonly cancellable: boolean;
  };

  readonly history: {                     // "O que aconteceu?"
    readonly lastSuccess?: { at: string; publicationId?: string; generated?: number; reused?: number };
    readonly lastFailure?: { at?: string; category: string; message?: string };
    readonly lastOperation?: { kind: "completed" | "failed" | "cancelled"; at?: string };
  };

  readonly capability: {                  // "Posso/devo fazer alguma coisa?"
    readonly canRequestUpdate: boolean;
    readonly blockedReason?: "companion" | "standby" | "unassigned" | "embeddings-disabled"
                            | "text-index-not-ready" | "operation-active" | "policy-blocked"
                            | "ownership-lost";
    readonly requiresConfirmation: boolean;
    readonly trigger: { mode: "manual" | "automatic-local"; scheduledAt?: number; backoffUntil?: number };
  };

  readonly upstream: { readonly textIndex: "ready" | "stale" | "missing" | "invalid" };
  readonly info: { readonly embeddingsPublishedAt?: string; readonly provenance?: "valid" | "stale" | "future" | "unknown" };

  readonly primary: EmbeddingLifecycleStatus;   // §6 — o único estado apresentado
}
```

Fontes do `history` (sem nova persistência nas fases 14A–14D): `lastSuccess` do **manifesto canónico** (`embeddings.updatedAt`, `publicationId` — sincronizado, portanto também no Companion); `lastFailure`/`lastOperation` do `EmbeddingOperationState` em memória e, no Produtor, de `producer-state.maintenance`. Persistir o histórico de falhas entre sessões fica em backlog.

### 5.4 Companion
`write.applicable = false`; `process.phase = "idle"`; `capability.blockedReason = "companion"`. O Companion mostra `read` e `info` (idade e proveniência como texto secundário). Se o produtor publicou artefactos incompatíveis com a configuração do Companion (raro, pois herda o contrato), o estado é `INCOMPATIBLE` com mensagem "gerido pelo Produtor". Resolve C1 e o texto inacionável.

### 5.5 Componentes
| Componente | Responsabilidade | Novo? |
|---|---|---|
| `EmbeddingCorpusFacts` (loader) | Lê uma vez por revisão: manifesto, estado do canónico, plano, checkpoint, fingerprint | Novo |
| `compareEmbeddingIdentity` | Compatibilidade única (§5.2) | Novo (puro) |
| `classifyEmbeddingWork` | `none|indeterminate|pending` (§5.2) | Novo (puro) |
| `resolveEmbeddingLifecycle(facts, device, operation, history, policy, role)` | Snapshot completo + `primary` | Novo (puro) |
| `EmbeddingLifecycleCoordinator` | Revisão, `markDirty(reason)`, lazy single-flight, `getFresh()/getSnapshot()/subscribe()`, fingerprint na utilização | Novo (I/O) |
| `RuntimeEmbeddingIndexCache` | Carregamento dos vetores (dados) | Existente, sem decidir disponibilidade |
| `EmbeddingWorkStatusController`, `EmbeddingScheduler`, política | Passam a consumir `classifyEmbeddingWork` | Existentes, adaptados |

---

## 6. Máquina de estados

### 6.1 Estados primários (`EmbeddingLifecycleStatus`)

| Estado | Significado | `read.effectiveMode` | `write` | `process` | Ação típica |
|---|---|---|---|---|---|
| `NO_TEXT_INDEX` | Sem índice textual utilizável | `unavailable` | n/a | idle | Criar índice |
| `DISABLED` | `embeddingsEnabled=false` | `text-only` (ou `full` se já existirem vetores compatíveis e a política o permitir — decisão de produto) | n/a | idle | Ativar |
| `INDEX_ONLY` | Índice ok; sem embeddings publicados | `text-only` | pending `initial-build` | idle | **Gerar** |
| `VERIFYING` | Cálculo de factos em curso | valor anterior (não contradiz) | — | checking | — |
| `READY` | Utilizáveis e sem trabalho | `full` | none | idle | — |
| `UPDATE_AVAILABLE` | Utilizáveis; trabalho `incremental`/`publish-only` | `full` | pending | idle | **Atualizar** (ou informação, se só limpeza) |
| `INCOMPATIBLE` | Identidade publicada ≠ alvo/dispositivo | `text-only` | pending `full-rebuild` | idle | **Reconstruir** (Produtor) / aguardar (Companion) |
| `INDETERMINATE` | Canónico ilegível / detalhes indisponíveis | conforme fonte binária | indeterminate | idle | Atualizar estado |
| `UPDATING` | Operação ativa (sub-fases em `process.phase`) | valor anterior | pending | preparing…finalizing | **Cancelar** |
| `CANCELLING` | Cancelamento cooperativo pedido | valor anterior | pending | cancelling | — |
| `ERROR` | Última operação falhou e ainda não foi reconhecida/reavaliada | valor anterior | conforme dados | idle | Repetir / ver diagnóstico |
| `STANDBY` | Produtor sem autoridade (leitura apenas) | valor de dados | n/a | idle | Promover (se aplicável) |

Notas:
- `ERROR` **sobrepõe-se** ao estado de dados apenas na apresentação (`primary`); `read` continua a refletir a pesquisa real. Sai por: nova operação, refresh que confirme dados sem trabalho (passa a `READY` + `history.lastFailure`), ou reconhecimento explícito.
- "Concluído" **não é estado**: é `history.lastOperation=completed` + transição para `READY`/`UPDATE_AVAILABLE`, apresentado como *toast/indicador efémero* de `history`.
- Os estados do exemplo do pedido mapeiam assim: `NO_DATA`→`NO_TEXT_INDEX`/`INDEX_ONLY`; `INDEX_ONLY`→`INDEX_ONLY`; `UPDATE_REQUIRED`→`UPDATE_AVAILABLE`/`INCOMPATIBLE`; `READY`→`READY`; `UPDATING`→`UPDATING`; `ERROR`→`ERROR`; `INCOMPATIBLE`→`INCOMPATIBLE`.

### 6.2 Eventos
`TEXT_INDEX_PUBLISHED`, `TEXT_INDEX_INVALIDATED`, `EMBEDDINGS_PUBLISHED`, `PUBLICATION_ROLLED_BACK`, `CHECKPOINT_CHANGED`, `SETTINGS_CHANGED` (`provider|model|prefix|enabled|readPreference`), `CONTRACT_LOADED`, `OWNERSHIP_CHANGED`, `ROLE_CHANGED`, `BINARY_PUBLISHED`, `SYNC_DETECTED` (impressão digital), `FACTS_READY(work)`, `FACTS_FAILED`, `UPDATE_REQUESTED`, `CONFIRMED`, `DECLINED`, `PROVIDER_VALIDATED`, `PROVIDER_FAILED(global|input)`, `BATCH_DONE`, `CANCEL_REQUESTED`, `PERSIST_STARTED`, `PUBLISH_OK`, `PUBLISH_FAILED_ROLLBACK`, `OWNERSHIP_LOST`.

### 6.3 Transições (resumo)

| De | Evento | Guarda | Para |
|---|---|---|---|
| qualquer (dados) | `TEXT_INDEX_PUBLISHED`, `SETTINGS_CHANGED`, `CONTRACT_LOADED`, `SYNC_DETECTED`, `EMBEDDINGS_PUBLISHED`, `CHECKPOINT_CHANGED` | `process=idle` | `VERIFYING` |
| `VERIFYING` | `FACTS_READY` | sem índice | `NO_TEXT_INDEX` |
| `VERIFYING` | `FACTS_READY` | `embeddingsEnabled=false` | `DISABLED` |
| `VERIFYING` | `FACTS_READY` | sem embeddings publicados | `INDEX_ONLY` |
| `VERIFYING` | `FACTS_READY` | identidade incompatível | `INCOMPATIBLE` |
| `VERIFYING` | `FACTS_READY` | `work=none` | `READY` |
| `VERIFYING` | `FACTS_READY` | `work=pending` | `UPDATE_AVAILABLE` |
| `VERIFYING` | `FACTS_READY` | `work=indeterminate` | `INDETERMINATE` |
| `VERIFYING` | `FACTS_FAILED` | — | `INDETERMINATE` (com `history.lastFailure`) |
| `INDEX_ONLY` / `UPDATE_AVAILABLE` / `INCOMPATIBLE` / `ERROR` / `INDETERMINATE` | `UPDATE_REQUESTED` | `capability.canRequestUpdate` | `UPDATING(preparing)` (após `CONFIRMED` quando exigido; `DECLINED` → estado anterior) |
| `UPDATING(preparing)` | `PROVIDER_VALIDATED` | — | `UPDATING(generating)` |
| `UPDATING(preparing)` | `PROVIDER_FAILED(global)` | — | `ERROR` (sem publicar) |
| `UPDATING(generating)` | `BATCH_DONE` | — | `UPDATING(generating)` (progresso; checkpoint) |
| `UPDATING(generating)` | `PROVIDER_FAILED(global)` | — | `ERROR` (checkpoint preservado) |
| `UPDATING(*)` | `CANCEL_REQUESTED` | fase < `persisting` | `CANCELLING` → `VERIFYING` (`lastOperation=cancelled`) |
| `UPDATING(generating)` | `PERSIST_STARTED` | autoridade revalidada (epoch) | `UPDATING(persisting)` — **ponto de não retorno** |
| `UPDATING(generating)` | `PERSIST_STARTED` | autoridade perdida | `CANCELLING` → `VERIFYING` (`lastOperation=cancelled, reason=ownership-lost`) |
| `UPDATING(persisting)` | `PUBLISH_OK` | — | `UPDATING(finalizing)` → `VERIFYING` (`lastSuccess`) |
| `UPDATING(persisting)` | `PUBLISH_FAILED_ROLLBACK` | — | `ERROR` (canónico anterior íntegro) |
| `UPDATING(persisting)` | `CANCEL_REQUESTED` | — | ignorado (não retorno) |
| qualquer | `ROLE_CHANGED` / `OWNERSHIP_CHANGED` | perde autoridade | `STANDBY` (ou Companion: `write.applicable=false`) |
| `UPDATING(*)` | `OWNERSHIP_LOST` | fase < `persisting` | `CANCELLING` |

### 6.4 Estados impossíveis (invariantes a testar)
| # | Invariante | Motivo |
|---|---|---|
| I1 | `primary=READY` ⇒ `write.work=none` ∧ `read.semanticAvailable` | "Pronto" nunca com trabalho ou sem pesquisa |
| I2 | `primary=UPDATE_AVAILABLE` ⇒ `work=pending` ∧ `read.semanticAvailable` | Se a pesquisa não funciona é `INCOMPATIBLE`/`INDEX_ONLY` |
| I3 | `primary=INCOMPATIBLE` ⇒ `read.effectiveMode≠full` | Zero Silent Fallback |
| I4 | `primary=INDEX_ONLY` ⇒ `read.semanticAvailable=false` | — |
| I5 | `process.phase≠idle` ⇒ role = Active Producer | Companion/Standby nunca geram |
| I6 | `primary=UPDATING` ⇒ `capability.canRequestUpdate=false` ∧ botão "Atualizar" oculto | Sem operações concorrentes |
| I7 | `process.phase=persisting` ⇒ `cancellable=false` | Ponto de não retorno |
| I8 | No máximo uma operação ativa | Single-flight |
| I9 | `write.applicable=false` ⇒ `capability.canRequestUpdate=false` ∧ `primary∈{READY,INCOMPATIBLE,INDEX_ONLY,NO_TEXT_INDEX,DISABLED,VERIFYING,INDETERMINATE}` | Companion |
| I10 | `primary=VERIFYING` ⇒ nenhuma afirmação positiva de "Atualizados" | B4 |
| I11 | `work=indeterminate` ⇒ `primary≠READY` | B5 |
| I12 | `age` nunca aparece nas guardas de nenhuma transição | LINA-09 |
| I13 | `epoch`/proveniência nunca aparece nas guardas | LINA-08 |
| I14 | `primary=ERROR` ⇒ existe `history.lastFailure` | — |
| I15 | Toda a região usa a mesma `revision` | B1 |
| I16 | `write.cost≠none` ∧ `requiresConfirmation=false` ⇒ `trigger.mode=automatic-local` ∧ provider local | Nunca gastar créditos em silêncio |

### 6.5 Matriz `read × primary` (pares permitidos)
`full` ⇒ {`READY`, `UPDATE_AVAILABLE`, `UPDATING`, `CANCELLING`, `ERROR`, `STANDBY`, `VERIFYING`, `DISABLED`*}; `text-only` ⇒ {`INDEX_ONLY`, `INCOMPATIBLE`, `INDETERMINATE`, `UPDATING`, `ERROR`, `DISABLED`, `VERIFYING`}; `unavailable` ⇒ {`NO_TEXT_INDEX`, `VERIFYING`}. (*decisão de produto.)

---

## 7. Cenários obrigatórios

Legenda: **Hoje** = comportamento derivado do código; **Alvo** = com o modelo congelado.

### 7.1 Vault novo
- **Hoje:** sem índice → mensagem de índice em falta; após rebuild manual, `DeviceRuntimeState` só é recalculado no arranque (S-2/B1); geração inicial: `initial-build` (`work=true`), botão "Atualizar embeddings" só para Produtor autorizado; após a 1.ª geração a Sidebar pode continuar em "só texto" e a pesquisa pura recusar (B1).
- **Alvo:** `NO_TEXT_INDEX` → (rebuild) → `INDEX_ONLY` (botão "Gerar embeddings", custo indicado) → `UPDATING` → `READY`; cada passagem incrementa `revision` e o `read` acompanha sem reabrir diagnóstico.

### 7.2 Utilizador altera uma nota
- **Hoje:** ver Q1 (§12). Se o auto-update do índice estiver desligado ou houver exclusões por conteúdo (B13/B14), nenhum sinal; se ligado, há uma janela em que a Sidebar diz "Atualizados" (B4) antes de "Atualização necessária"; barra compacta continua verde (B12); Companion vê "Atualização necessária" sem ação.
- **Alvo:** `READY` → (`TEXT_INDEX_PUBLISHED`) `VERIFYING` → `UPDATE_AVAILABLE` (`incremental`, N chunks, custo local/externo); indicador na barra compacta; botão só no Produtor autorizado; Companion vê `READY` (o seu `read` não muda) e, em `info`, "produtor tem atualização pendente" apenas se `producer-state` o disser.

### 7.3 Utilizador elimina uma nota
- **Hoje:** evento `delete` → publicação textual → `obsolete>0` → `workAvailable=true` → "Atualização necessária" + botão; o clique só publica (sem chamadas ao provider). Se o índice ficar sem chunks, o clique diz "já atualizado" (B7).
- **Alvo:** `UPDATE_AVAILABLE` com `write.work.mode=publish-only`, `severity=info`, `cost=none`; texto "Limpeza pendente (sem custo)"; pesquisa nunca mostra a nota apagada (já filtrada por `TFile`).

### 7.4 Embeddings existem há 30 dias sem alterações
- **Hoje:** operacional + sem trabalho → "Atualizados (há 30 dias)" ✔; mas com cache falsa (S-2) o ramo de fallback usa `embeddingsFreshness` por idade → `stale` (B9); alertas `producer-aging/stale` (B10).
- **Alvo:** `READY`; idade como texto secundário; sem alertas por idade (I12).

### 7.5 Provider muda
- **Produtor, hoje:** `refreshEmbeddingConfigurationState` → work dirty → plano `full-rebuild` → "Atualização necessária"; híbrida devolve texto com aviso; cache R1 antiga: cabeçalho "híbrida disponível" (B2); LINA-08 previa "Incompatíveis com o modelo", que não é atingível (`contractState==="mismatch"` nunca ocorre).
- **Produtor, alvo:** `SETTINGS_CHANGED` → `VERIFYING` → `INCOMPATIBLE` (`read=text-only`, `write=full-rebuild`, custo externo, confirmação reforçada "Reconstruir").
- **Companion, alvo:** o Companion herda o contrato **publicado**; a mudança de provider no Produtor só afeta o Companion quando este recebe a nova publicação (`SYNC_DETECTED`); até lá permanece `READY` com o contrato antigo.

### 7.6 Companion recebe novos artefactos
- **Hoje:** o índice runtime recarrega-se na pesquisa seguinte (identidade de fonte), mas `effectiveVectorContract` e `DeviceRuntimeState` não são relidos (B3, §LINA-13-P1-AB P-B3); a Sidebar não se atualiza; publicação textual posterior à de embeddings faz o estado de consumo dizer `invalid`/`text-only` (B8).
- **Alvo:** impressão digital (`stat` de `manifest.json`, `embeddings.jsonl`, `ownership.json`) verificada à abertura da Sidebar e antes de uma pesquisa → `SYNC_DETECTED` → contrato + factos relidos → novo snapshot; `write.applicable=false`.

### 7.7 Producer perde ownership durante a geração
- **Hoje:** `canPublish` é a cache `OwnershipGate.isAuthorizedSync()` (otimista se `null`); a proveniência é capturada uma vez (`main.ts:2789`); ninguém volta a avaliar antes de `persisting`; a publicação pode sobrepor artefactos do novo produtor (B16). A proveniência fica `stale` (registo, não prevenção).
- **Alvo:** `OWNERSHIP_LOST` (ou reavaliação com `expectedEpoch` à entrada de `persisting`) → `CANCELLING` → `VERIFYING`, checkpoint local preservado, `lastOperation=cancelled(reason=ownership-lost)`, `primary=STANDBY`. Risco residual documentado: sem compare-and-swap em ficheiros simples, uma perda de ownership **durante** a escrita atómica só é detetável depois; a política é "o novo produtor volta a publicar" e o estado fica assinalado.

---

## 8. Roadmap (fases pequenas e reversíveis)

Cada fase é um PR independente, sem alterações de schema, e respeita a checklist da MESTRA (*resolve problema real? é a solução mais simples? mantém contratos? introduz complexidade? pode ir para backlog?*).

| Fase | Conteúdo | Comportamento visível | Reversão | Depende de |
|---|---|---|---|---|
| **13-P1 (já planeado)** | P1-A, P1-B; depois c/d/e/f/g/h e P1b | Corrige B1–B6, B9–B12, B15, B16 | Reverter commits | P0 |
| **14.0** | Congelar este modelo em `docs/architecture/embedding-lifecycle-model.md` (ADR curto) | Nenhum | — | esta auditoria |
| **14A** | Módulos **puros**: `compareEmbeddingIdentity`, `classifyEmbeddingWork`, `resolveEmbeddingLifecycle`; testes tabulares + propriedades (I1–I16). **Sem ligação a nada** | Nenhum | Apagar ficheiros | 14.0 |
| **14B** | `EmbeddingCorpusFacts` + `EmbeddingLifecycleCoordinator` em **shadow mode**: calcula em paralelo e compara com o estado legado (log de debug e testes), sem afetar UI | Nenhum | Desligar registo | 14A |
| **14C** | Migrar consumidores do **Read**: pre-gate/mensagens de pesquisa, cabeçalho de modo da Sidebar, Diagnóstico (remove R6/R7), resumos das Definições → `snapshot.read` | Coerência de "híbrida disponível" | Reverter PR | 14B |
| **14D** | Migrar **Write/Process/History**: controller, política, scheduler e pedido manual usam `classifyEmbeddingWork`; VM da Sidebar passa a `{role, read, write, textIndex, info}`; botão e `lastOutcome` a partir de `capability`/`history`; Companion `write.applicable=false` | Linha "Embeddings", botão, indicador na barra, mensagens | Reverter PR (VM antigo mantido até 14F) | 14C |
| **14E** | Fencing de ownership integrado no processo (`OWNERSHIP_LOST`, reavaliação com `expectedEpoch` à entrada de `persisting`) — se P1b não o tiver feito | Cancelamento seguro | Reverter PR | P1b |
| **14F** | Limpeza: `buildEmbeddingStatusViewModel`, `renderEmbeddingDiagnostic*`, `canUpdate` antigo, `EmbeddingWorker.state`, `isChecking`/`providerReachable`, `getEmbeddingWorkflowState` órfão; atualizar testes de texto e documentação | Nenhum | Reverter PR | 14D |

**Backlog (não implementar agora):** persistência do histórico de falhas entre sessões; publicação automática de limpezas sem custo; indicador de progresso de sincronização; coordenador partilhado com o estado do índice textual.

**Ordem de valor/risco:** 13-P1 corrige o defeito visível com o menor risco; 14A–14B constroem a fundação sem impacto; 14C–14D fazem o corte de UI já com prova de equivalência do shadow mode.

---

## 9. UX

### 9.1 Avaliação atual
| Pergunta | Resposta |
|---|---|
| Existe indicação clara quando os embeddings precisam de ser gerados? | **Parcial.** A linha "Embeddings: Atualização necessária" existe no acordeão "Estado"; a barra compacta permanece verde ("Pesquisa híbrida disponível") sem indicador de pendência; sem contagem de notas; sem indicação de custo ou de que a pesquisa continua a funcionar. Sem índice textual atualizado nada é sinalizado. |
| Existe botão visível quando a ação é manual? | **Sim**, para Active Producer com índice pronto e `workAvailable===true` (`linaSearchView.ts:2829-2846`). **Não** em `error`, `indeterminate`, `INCOMPATIBLE` distinguível de atualização, nem quando o motivo da ausência é o papel (não explica). Aparece com embeddings desativados (B6). |
| A UI distingue informação, aviso e ação? | **Não.** "Atualização necessária" cobre: notas alteradas (ação), obsoletos (info), contrato incompatível (ação bloqueante), idade (info incorreta), Companion (inacionável). |

### 9.2 Modelo de severidade proposto
| Severidade | Quando | Apresentação |
|---|---|---|
| `info` | `READY` com idade; limpeza pendente; proveniência de época anterior; índice "aging" | texto secundário, sem cor de alerta |
| `notice` | `UPDATE_AVAILABLE` incremental; `VERIFYING` prolongado | indicador na barra compacta + linha no cartão; botão se acionável |
| `action` | `INDEX_ONLY`; `INCOMPATIBLE` (Produtor) | botão primário com custo e confirmação |
| `blocked` | `INCOMPATIBLE`/`UPDATE_AVAILABLE` sem autoridade (Companion/Standby) | mensagem "gerido pelo Produtor", sem botão |
| `error` | `ERROR` | mensagem com causa segura + repetir |

### 9.3 Requisitos de UX a congelar
1. A barra compacta mostra sempre o **modo de pesquisa** (read) e, se houver `notice/action`, um indicador de pendência.
2. O cartão mostra **um** estado de embeddings (`primary`) e, quando acionável, um botão; quando não acionável, uma razão curta.
3. "Pesquisa" nunca menciona "atualização"; "atualização" nunca afirma disponibilidade de pesquisa.
4. Custo (`local`/`externo`) visível antes da ação; provider externo exige confirmação.
5. Nenhuma mensagem de sucesso depende de um canal imperativo que possa ser apagado.

---

## 10. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| K1 | Aumento de complexidade (um coordenador + facts + resolver) contra o princípio "mais simples" | Média | Médio | Módulos puros pequenos; 14A/14B sem efeito; remover 3 caminhos redundantes em 14F; medir linhas removidas vs adicionadas |
| K2 | Regressões na Sidebar (muitos testes são asserções de texto do código) | Alta | Baixo–Médio | Testes de VM tabulares novos; atualizar os testes de texto no mesmo PR (`linaSearchViewHardening`, `sidebarEmbeddingWorkflowState`, `sidebarSimplificationUX`, `runtimeEmbeddingIndex`) |
| K3 | Shadow mode custa I/O extra | Média | Baixo | Só em debug/testes; reutilizar factos já lidos; `EmbeddingCorpusFacts` único |
| K4 | Decisão de produto errada em "eliminação = info" | Média | Baixo | Confirmar antes de 14D; parametrizar `severity` |
| K5 | Companion perde o aviso "há atualização" | Média | Baixo | `info` a partir de `producer-state` (observacional) |
| K6 | Mudar o significado de `exists`/`consumptionMode` (B8) afeta diagnósticos | Baixa | Médio | Fase 14C com testes de paridade do diagnóstico |
| K7 | Fencing incompleto dá falsa segurança | Média | Alto | Documentar o risco residual (§7.7); manter proveniência histórica |
| K8 | Mobile: I/O de factos e impressão digital | Baixa | Médio | `stat` O(1); factos lidos uma vez; sem polling; respeitar guardrails de recursos existentes |
| K9 | i18n: novos textos (PT-PT + EN) | Média | Baixo | Reutilizar strings existentes; adicionar por fase; testes de paridade de chaves |
| K10 | Conflito com estado de fases em `AGENTS.md` (linhas históricas longas) | Baixa | Baixo | Acrescentar apenas uma linha por fase concluída |

---

## 11. Testes

### 11.1 Unitários (puros; 14A)
| ID | Nome | Objetivo | Cenário → esperado |
|---|---|---|---|
| U1 | `compareEmbeddingIdentity` tabular | Compatibilidade única | Cada campo divergente devolve a razão certa; contratos iguais ⇒ compatível; incompleto ⇒ `incomplete` |
| U2 | `classifyEmbeddingWork` tabular | Definição única de trabalho | `chunks=[]`+obsoletos, `full-rebuild`, checkpoint cobre tudo, duplicados, inválidos, ilegível ⇒ `none|indeterminate|pending{mode}` esperado |
| U3 | Idade ignorada | Regra LINA-09 | Mesma entrada com `updatedAt` de hoje e de há 400 dias ⇒ snapshot idêntico exceto `info` |
| U4 | Epoch ignorado | Regra LINA-08 | Proveniência `stale|future|unknown` ⇒ `primary` inalterado |
| U5 | `resolveEmbeddingLifecycle` exaustivo | Matriz `read × write × process × role` | Todas as combinações geram `primary` e satisfazem I1–I16 |
| U6 | Propriedades | Invariantes | Gerador aleatório de entradas ⇒ nunca viola I1–I16 |
| U7 | Transições | Tabela §6.3 | Para cada (estado, evento) o estado seguinte é o esperado |
| U8 | `indeterminate` nunca `READY` | B5 | `work=undefined` ⇒ `INDETERMINATE` |
| U9 | Severidade | §9.2 | Cada causa de "desatualizado" produz a severidade da tabela §5.2 |

### 11.2 Lifecycle (coordenador; 14B) — fake clock e `FakeAdapter`
| ID | Nome | Cenário → esperado |
|---|---|---|
| L1 | `revision` monotónica | Eventos consecutivos ⇒ revisões crescentes; cálculo tardio descartado |
| L2 | `markDirty` O(1) sem subscritores | Sem consumidores ⇒ nenhum I/O |
| L3 | single-flight | 10 `getFresh()` em paralelo ⇒ 1 leitura de factos |
| L4 | invalidação por evento | Cada evento de §6.2 muda o snapshot no ciclo seguinte |
| L5 | impressão digital | Alterar `manifest.json`/`embeddings.jsonl`/`ownership.json` externamente ⇒ `SYNC_DETECTED` na utilização |
| L6 | sem polling | Nenhum timer criado pelo coordenador |
| L7 | shadow parity | Legado vs snapshot para o corpus de cenários ⇒ divergências apenas nas listadas como bugs (B1–B18) |
| L8 | ordem de arranque | Contrato carregado antes do primeiro snapshot; Companion correto |

### 11.3 Producer
| ID | Nome | Cenário → esperado |
|---|---|---|
| P1 | Vault novo → `READY` | `NO_TEXT_INDEX`→`INDEX_ONLY`→`UPDATING`→`READY`; `read` acompanha sem diagnóstico |
| P2 | Nota alterada | `READY`→`VERIFYING`→`UPDATE_AVAILABLE`; botão visível; `estado` nunca "Atualizados" durante `VERIFYING` |
| P3 | Nota eliminada | `publish-only`, `severity=info`, custo `none`; sem chamada ao provider |
| P4 | Mudança de provider/modelo | `INCOMPATIBLE`, `text-only` imediato, confirmação reforçada |
| P5 | `embeddingsEnabled=false` | `DISABLED`; sem botão de geração |
| P6 | Falha global do provider | `ERROR`, checkpoint preservado, `lastFailure` presente; nova tentativa retoma |
| P7 | Cancelamento | `CANCELLING`→`VERIFYING`; `lastOperation=cancelled`; nunca `ERROR` |
| P8 | Falha de publicação | rollback; `ERROR`; canónico anterior íntegro; `read` inalterado |
| P9 | **Ownership perdido durante geração** | `OWNERSHIP_LOST` ⇒ cancelamento antes de `persisting`; sem publicação; `STANDBY` |
| P10 | Modo automático local | `trigger.scheduledAt`/`backoffUntil` no snapshot; externo nunca automático |
| P11 | Concluído | `lastOperation=completed` presente após o refresh seguinte (B18) |

### 11.4 Companion
| ID | Nome | Cenário → esperado |
|---|---|---|
| C1 | Nunca gera | `write.applicable=false`, `canRequestUpdate=false` em todos os estados |
| C2 | Arranque com contrato | Contrato carregado antes do snapshot ⇒ `READY` |
| C3 | Novos artefactos sincronizados | `SYNC_DETECTED` ⇒ snapshot atualizado sem reiniciar |
| C4 | Contrato publicado incompatível com pesquisa | `INCOMPATIBLE`, `text-only`, mensagem "gerido pelo Produtor" |
| C5 | Publicação textual à frente dos embeddings (B8) | `READY`/`UPDATE_AVAILABLE`, **não** `invalid`/`text-only` |
| C6 | Sem "Atualização necessária" acionável | Sem botão, sem `full-rebuild` a partir de settings locais |
| C7 | Fallback textual | Sem embeddings ⇒ pesquisa textual disponível e mensagem clara |

### 11.5 Integração
| ID | Nome | Cenário → esperado |
|---|---|---|
| I-1 | Ciclo completo com snapshots | Estender `embeddingLifecycle.integration.test.ts` para afirmar `primary` após cada fase |
| I-2 | Equivalência Read | Para o mesmo publicado, híbrida, pura e Sidebar concordam (`read`) |
| I-3 | Diagnóstico ≡ Sidebar | `deviceDiagnostics.companionSearch` deriva do mesmo snapshot |
| I-4 | Apresentação | VM tabular: `primary`→ linha, botão, indicador, alerta; sem `Date.now()`/idade nas decisões |
| I-5 | Regressão de custos | Nenhum caminho automático chama provider externo |
| I-6 | Sincronização | Artefactos parciais (manifesto novo, embeddings antigos) ⇒ estado seguro anterior |

### 11.6 Proteção contra regressão arquitetural (testes de texto, no estilo do repositório)
- `sidebarStatusViewModel.ts` não referencia `computeFreshnessFromTimestamp` para embeddings nem `producerFreshness` em alertas.
- `linaSearchView.ts` não referencia `embeddingsWorkAvailable`, `embeddingsChecking`, `semanticPreparing` após 14D.
- Nenhum módulo além de `resolveEmbeddingLifecycle` produz `primary`.

---

## 12. Critério final

**1. Se uma nota muda, qual é o caminho até aparecer "é necessário gerar embeddings"?**

```
modify (Vault)                                           só se papel ≠ companion (registerVaultEventListeners)
 → filtro de eventos internos (.lina/.obsidian)          getAutomaticUpdateIgnoreReason
 → fila com debounce por path + coalescing + single-flight     TextIndexWorker (Active Producer; autoUpdateIndexOnFileChanges=true; índice válido existente)
 → batch: saveTextIndex(notas, chunks, …)                novo generationId; secção embeddings preservada
 → markEmbeddingWorkStatusDirty("text-index-published")  + invalidateRuntimeEmbeddingIndex + scheduler.markDirty
 → EmbeddingWorkStatusController: dirty → calculating → ready      (só com subscritores; debounce 250 ms)
 → readEmbeddingStatus + readEmbeddingUpdatePreview → calculateEmbeddingUpdatePlan   (hash do chunk e do input vs registos)
 → deriveEmbeddingWorkAvailability → workAvailable (boolean | undefined)
 → Sidebar: applyEmbeddingWorkStatus → refreshState → VM (embeddingsWorkAvailable) → "Atualização necessária" (+ botão se Produtor autorizado)
```
Pontos onde a cadeia falha hoje: auto-update desligado ou exclusões por conteúdo (B13/B14: nada sinaliza), janela `dirty` (B4), Companion (não corre o worker), `workAvailable===undefined` (B5). A frase literal "é necessário gerar embeddings" não existe: a UI diz "Atualização necessária". No modelo futuro: `UPDATE_AVAILABLE` com contagem, custo e botão.

**2. Se embeddings existem e são válidos, qual componente decide a pesquisa semântica?**
Hoje: para executar, `RuntimeEmbeddingIndexCache.getOrLoad` + comparações inline (R3/R4); para apresentar, `DeviceRuntimeState.embeddings` (R1, cache). Em LINA-13-P1-A a decisão de execução deixa de depender de R1. **No modelo congelado:** `evaluateReadCapability` (dentro de `resolveEmbeddingLifecycle`), usando `compareEmbeddingIdentity`, avaliada sobre factos frescos do coordenador; na pesquisa, o mesmo `compareEmbeddingIdentity` é reaplicado à identidade do índice **efetivamente carregado** (proteção contra corridas). O `RuntimeEmbeddingIndexCache` fica apenas como carregador de dados.

**3. Qual é o único estado que a interface deve apresentar?**
`EmbeddingLifecycleSnapshot.primary` — um de `NO_TEXT_INDEX | DISABLED | INDEX_ONLY | VERIFYING | READY | UPDATE_AVAILABLE | INCOMPATIBLE | INDETERMINATE | UPDATING | CANCELLING | ERROR | STANDBY` —, acompanhado do **modo de pesquisa** derivado exclusivamente de `read` do mesmo snapshot (par validado pela matriz §6.5) e de informação secundária (`info`: idade, proveniência). A interface não calcula, não compõe e não infere estado.

---

## 13. Perguntas em aberto (decisões de produto)
1. Eliminação isolada de notas: `info` sem ação (recomendado) ou `notice` com botão?
2. `DISABLED` com vetores compatíveis existentes: a pesquisa semântica usa-os ou fica suspensa?
3. Publicação de limpeza sem custo (`publish-only`): automática para o Produtor ou sempre manual?
4. Semântica de `stale` do índice textual com exclusões por conteúdo (B14).
5. Persistir `lastFailure` entre sessões (backlog) — onde (settings locais do dispositivo, nunca em ficheiros sincronizados)?

## 14. Confirmações de âmbito
- Apenas este relatório foi criado; nenhum ficheiro de código, teste, configuração, schema ou manifesto foi alterado.
- Nenhuma nota do vault alterada; nenhum embedding gerado; nenhuma chamada externa; nenhum commit.
