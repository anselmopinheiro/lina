# LINA-14F4-B4.0-C-IMPLEMENT-OPERATION-MANAGER-SNAPSHOT-CONSOLIDATION-001

**Fase:** LINA-14F.4-B4.0-C — consolidação do `EmbeddingOperationManager` com o snapshot canónico
**Auditoria:** `LINA-14F4-B4.0-C-AUDIT-OPERATION-MANAGER-SNAPSHOT-CONSOLIDATION-001.md`

## 1. Resumo
O manager deixa de ser cego à política: passa a consumir `deriveEmbeddingWritePathDecision(snapshot)` através de uma porta opcional, com uma regra única de início partilhada com o Worker. O fornecedor do snapshot em `main.ts` passou a compor o estado vivo (operação atual, autoridade atual, plano indeterminado).

## 2. Alterações
| Ficheiro | Alteração |
|---|---|
| `src/index/embeddingLifecycleWritePath.ts` | `evaluateOperationStartGate(decision, origin)` (+ `OperationStartGate`, `OperationStartBlockReason`): regra única de início |
| `src/index/embeddingOperationManager.ts` | Opção `getWritePathDecision`; `request()` devolve `{status:"blocked", reason}` (fail-closed); cancelamento devolve `"non-cancellable"` em `persisting`/`finalizing` (fase do manager ou do snapshot; falha da porta ⇒ permite); `dispose()` continua incondicional |
| `src/maintenance/embeddingWorker.ts` | Manager construído com a porta derivada de `getLifecycleSnapshot`; `requestGeneration` usa a regra única (mapeamento idêntico ao anterior para `not-active-producer`/`not-capable`); `blocked` nunca é exposto (excluído de `EmbeddingWorkerRequestResult`) |
| `src/index/embeddingWorkStatusController.ts` | Extração sem alteração de comportamento: `isIndeterminateWorkSummary`, `buildEmbeddingWorkLifecycleSnapshot(summary, revision, runtime?, operationState?)` |
| `main.ts` | `getEmbeddingLifecycleSnapshot()` vivo (operação atual, sobreposição de autoridade via `OwnershipGate.isAuthorizedSync()`, plano ilegível ⇒ `INDETERMINATE`); comando de cancelar trata `non-cancellable` com o texto já existente `statusEmbeddingGenerationPersisting` |

## 3. Resultado por achado da auditoria
- **A1** (cancelar em `persisting`): corrigido — `non-cancellable`, sem abort.
- **A2** (regras duplicadas): regra única `evaluateOperationStartGate`.
- **A3** (snapshot desatualizado / `INDETERMINATE` não bloqueava): fornecedor vivo; estado ilegível bloqueia início.
- **A4/A5**: comando tratado; `dispose()`, retry, erro e Companion sem alterações de comportamento.

## 4. Testes
- `tests/index/embeddingOperationManagerSnapshot.test.ts` (22): autorizada (UPDATE_AVAILABLE/INDEX_ONLY), bloqueada, Companion, Standby, INDETERMINATE, confirmação automática vs manual, retry após erro, porta a falhar (start fecha, cancel abre), sem porta, perda de ownership, cancelamento (generating/persisting/finalizing/fase do manager/snapshot obsoleto/already-cancelling/dispose), divergência legado vs snapshot.
- `tests/index/embeddingLiveLifecycleSnapshotProvider.test.ts` (5): fase viva, sobreposição de ownership, indeterminado explícito, pedido bloqueado no Worker.
- `tests/index/embeddingOperationManager.test.ts`: o teste que fixava o comportamento A1 foi atualizado para o novo contrato (`non-cancellable`, sem abort, conclui normalmente).

## 5. Limites respeitados
Sem alterações a gerador, coordenador, locks, fases persistidas, checkpoints, recuperação, schemas, formato de embeddings, sincronização ou UI; legado não removido.

## 6. Fora do âmbito / seguimento
Fencing de ownership **antes** de entrar em `persisting` (exige alterações ao gerador); correções do adapter documentadas na auditoria B4.

## 7. Confirmações
Sem alterações a notas do vault, sem geração de embeddings, sem chamadas externas.
