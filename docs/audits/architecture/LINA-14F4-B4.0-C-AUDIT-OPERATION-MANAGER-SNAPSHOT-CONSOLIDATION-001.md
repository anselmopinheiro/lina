# LINA-14F4-B4.0-C-AUDIT-OPERATION-MANAGER-SNAPSHOT-CONSOLIDATION-001

**Fase:** LINA-14F.4-B4.0-C — consolidação do `EmbeddingOperationManager` com o snapshot canónico
**Estado Git:** `master`, HEAD `f3a18ef` (B4.0-A e B4.0-B já integrados), working tree limpa
**Contrato:** `AGENTS.md` › decisões LINA-14 › `PROMPT-MESTRA-LINA-002` › prompt da fase. Sem conflitos entre estas fontes; a prompt indica `master` no commit (coerente com o repositório).

## 1. Estado atual do Operation Manager (`src/index/embeddingOperationManager.ts`, 399 linhas)

O manager é uma **máquina de estados pura**: single-flight (`activePromise`), `AbortController`, transições `running → cancelling → cancelled|completed|failed`, fases (`preparing … persisting`), progresso, subscrição. **Não importa o modelo de ciclo de vida e não toma nenhuma decisão de elegibilidade.** É criado e detido exclusivamente por `EmbeddingWorker` (`new EmbeddingOperationManager()`), que é o único ponto de entrada (`MaintenanceEngine` → Worker).

### 1.1 Entradas usadas para decidir operações
| Decisão | Entrada atual | Fonte |
|---|---|---|
| Aceitar `request()` | apenas `disposed` e `activePromise` | estado interno |
| `cancelActiveOperation()` | `disposed`, `activePromise/abortController`, `status` | estado interno |
| Fase/progresso | chamadas do runner (`setPhase`, `setProgress`) | gerador de embeddings |
| Autoridade (ownership/papel) | **nenhuma** | delegada ao Worker |

### 1.2 Validações existentes e onde vivem
| Validação | Onde |
|---|---|
| Companion / Standby / Unassigned / embeddings desativados | Worker (`requestGeneration`, ramo `getLifecycleSnapshot`) e `MaintenanceEngine`/ports legados (`capabilities`, `canPublish`) |
| `INDETERMINATE`, perda de ownership, confirmação em `origin="automatic"` | Worker (regras **inline**) |
| Single-flight | Manager (`already-running`) e Worker (antes da reserva do coordenador) |
| Cancelamento durante `persisting` | **ninguém** |

## 2. Achados

### A1 — O manager permite cancelar em `persisting` (contradiz o snapshot e o AGENTS.md) — **Alta**
- `cancelActiveOperation()` só verifica `status === "running"`. Em `persisting` (ponto de não retorno: `AGENTS.md`, "Estratégia de Indexação") o estado passa a `cancelling` e o `AbortController` é abortado. O gerador ignora o abort depois de `onPersisting` (`embeddingGenerator.ts:903, 1471`; não há verificação de cancelamento posterior) e a operação termina como `completed`.
- O snapshot/modelo já afirma `process.cancellable = false` em `persisting`/`finalizing` (invariante I7, `embeddingLifecycleModel.ts`), e o tipo `EmbeddingOperationCancelResult` já inclui `"non-cancellable"`, **que nunca é devolvido**.
- Efeito: durante a publicação crítica a UI mostra "a cancelar" enquanto a escrita prossegue; manager e snapshot discordam sobre a mesma operação.

### A2 — Regras de elegibilidade duplicadas no Worker — **Média**
`requestGeneration` tem um ramo inline (perda de autoridade, `!applicable`, `INDETERMINATE`, confirmação automática) **e** `evaluateOperationDecisionFromSnapshot` calcula `canStart`/`reason` com lógica paralela que `requestGeneration` não usa. Duas formulações da mesma política.

### A3 — O snapshot entregue ao Worker não reflete a operação nem a autoridade atuais — **Alta**
`getEmbeddingLifecycleSnapshot()` (`main.ts:870`, B4.0-B) devolve o snapshot em cache do `EmbeddingWorkStatusController` sempre que existe. Esse snapshot é construído **no momento do refresh**, **sem `operationState`** (`embeddingWorkStatusController.ts:166`) e com o runtime em cache. Consequências em produção:
- `snapshot.primary` nunca é `UPDATING`/`CANCELLING`/`ERROR` e `process.phase` é sempre `idle` ⇒ `ownershipLostDuringOperation` nunca é verdadeiro e `canCancel` é sempre falso: as verificações do Worker para "operação ativa" são cegas.
- Estado indeterminado: o controller **não produz snapshot** quando o plano é `indeterminate`/ilegível (`:112-117`); o ramo de *fallback* de `getEmbeddingLifecycleSnapshot()` constrói um snapshot sem plano (trabalho `none`) ⇒ **`INDETERMINATE` não bloqueia** o Worker em produção (Zero Silent Fallback violado).
- Os testes de B4.0-B injetam snapshots estáticos e por isso não detetam estas lacunas.

### A4 — Chamadores de cancelamento — **Baixa**
| Chamador | Uso do resultado |
|---|---|
| `main.ts:628` (comando) | trata `cancel-requested`/`already-cancelling`; qualquer outro valor mostra "Não existe geração ativa" |
| `linaSearchView.ts:2081` (botão) | só trata `no-active-operation` |
| `linaSearchView.ts:3009`, `main.ts:1251` (despromoção) | ignoram o resultado |
| `Worker.dispose()` / `Manager.dispose()` | cancelamento **incondicional** no *unload* (deve manter-se) |

### A5 — Retry, erro e Companion
- **Retry:** o manager aceita novo `request()` após `failed` (sem memória de falha); a autorização de retry pertence ao Worker/snapshot (`action="retry"`).
- **Erro:** `failed` permanece até ao próximo pedido (consistente com `primary=ERROR`).
- **Companion:** nunca tem operação (Worker bloqueia o início); `cancelActiveOperation` devolve `no-active-operation`. Não é necessária regra adicional de cancelamento.

## 3. Conflitos com o Worker já migrado
- B4.0-B injeta o snapshot no Worker mas **não** o entrega ao manager; uma segunda verificação dentro do manager seria redundante **se** usasse regras próprias. Por isso a solução não pode duplicar regras: a mesma função pura deve servir Worker e manager.
- Existem testes do Worker/manager que usam `new EmbeddingOperationManager()` sem porta e snapshots estáticos: o comportamento **sem** porta deve permanecer inalterado.

## 4. Riscos de alteração
| # | Risco | Mitigação |
|---|---|---|
| R1 | Bloquear todos os cancelamentos se o snapshot da porta for antigo (`process.phase=idle`) | O manager **só recusa** cancelamento quando a fase do próprio manager ou a do snapshot indicam `persisting`/`finalizing`; o fornecedor do snapshot passa a compor o estado vivo da operação (A3) |
| R2 | Alterar locks/fases/checkpoints | Nenhum desses é tocado: sem alterações ao gerador, ao coordenador, à persistência ou a `setPhase`; `dispose()` continua incondicional |
| R3 | Bloquear `request()` legítimo por snapshot incompleto | Em falha do fornecedor o **início é bloqueado** (fail-closed) e o **cancelamento é permitido** (direção segura); testado |
| R4 | Novo estado de resultado (`blocked`) propagado aos consumidores | O Worker traduz para o vocabulário existente (`not-capable` / `not-active-producer`); o tipo público `EmbeddingWorkerRequestResult` não expõe `blocked` |
| R5 | Mensagem enganosa no comando de cancelar para `non-cancellable` | Usar o texto já existente `statusEmbeddingGenerationPersisting`; sem novas strings nem alterações de UX |
| R6 | Regressão do fallback de "estado indeterminado" | Fornecedor do snapshot passa a marcar o trabalho como `indeterminate` (A3), com teste dedicado |

## 5. Plano de implementação (mínimo e seguro)
1. **Regra única** em `embeddingLifecycleWritePath.ts`: `evaluateOperationStartGate(decision, origin)` → `{ allowed: true } | { allowed: false, reason }` com `reason ∈ {"ownership-lost","not-applicable","companion","indeterminate","confirmation-required"}`; `Worker.requestGeneration` passa a usá-la (comportamento idêntico) e o manager usa-a para o portão de início.
2. **Manager:** opção `getWritePathDecision?: () => EmbeddingWritePathDecision`.
   - `request()`: com porta, recusa com `{status:"blocked", reason}` segundo a regra única (falha da porta ⇒ recusa); sem porta, comportamento atual.
   - `cancelActiveOperation()`: recusa com `"non-cancellable"` quando a operação está em `persisting`/`finalizing` (fase do manager ou do snapshot); falha da porta ⇒ permite; `dispose()` mantém cancelamento incondicional.
3. **Worker:** constrói o manager com a porta derivada de `getLifecycleSnapshot`; traduz `blocked` para o vocabulário existente; a verificação de pré-validação usa a regra única.
4. **Fornecedor do snapshot (`main.ts`)** compõe o estado **vivo**: operação atual do manager, autoridade atual (`OwnershipGate.isAuthorizedSync()`), plano do controller e estado indeterminado explícito. O controller exporta o construtor do snapshot de trabalho (extração sem alteração de comportamento).
5. **Comando de cancelar** trata `non-cancellable` com texto existente.
6. **Testes** dedicados (`tests/index/embeddingOperationManagerSnapshot.test.ts`) + teste do fornecedor no plugin.

### Fora do âmbito (mantido)
Remoção de legado; alterações ao gerador, coordenador, persistência, checkpoints ou sincronização; fencing de ownership **antes de entrar em `persisting`** (B16 — exigiria alterar o fluxo do gerador); UX.

## 6. Confirmações
Esta auditoria não alterou código, testes, schemas ou notas do vault; não gerou embeddings nem fez chamadas externas.
