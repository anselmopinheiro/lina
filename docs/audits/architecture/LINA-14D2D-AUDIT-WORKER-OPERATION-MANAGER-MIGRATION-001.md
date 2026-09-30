# LINA-14D.2-D — Auditoria de Migração Shadow do Worker e Operation Manager para o Write Path Canónico

**Data:** 2026-09-30  
**Fase:** LINA-14D.2-D  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Aprovado para Implementação Shadow  

---

## 1. Contexto e Motivação

O projeto Lina encontra-se na fase LINA-14D.2 de consolidação do Write Path de embeddings.
A cadeia canónica unificada estabelece:

```text
EmbeddingLifecycleSnapshot
          ↓
deriveEmbeddingWritePathDecision()
          ↓
Policy Engine / Scheduler / Operation Manager / Worker
          ↓
Execução Segura
```

Após a migração e validação shadow do `EmbeddingWorkStatusController` (14D.2-A), do `EmbeddingPolicyEngine` (14D.2-B) e do `EmbeddingScheduler` (14D.2-C), a presente fase — **LINA-14D.2-D** — audita e implementa a camada shadow para os componentes centrais de execução física e controlo de operações:
- [`EmbeddingWorker`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingWorker.ts);
- [`EmbeddingOperationManager`](file:///d:/_dev/obsidian/lina/src/index/embeddingOperationManager.ts);
- [`MaintenanceEngine`](file:///d:/_dev/obsidian/lina/src/maintenance/maintenanceEngine.ts).

### Limites Obrigatórios e Não-Interferência Comportamental
Esta fase opera **exclusivamente em Shadow Mode**:
- **Zero alteração na execução de operações ativas ou geração de embeddings;**
- **Zero alteração no Worker, Operation Manager, canais de progresso, cancelamento, timers ou locks;**
- **Zero alteração em esquemas de persistência, formato JSONL de embeddings ou publicação;**
- **Zero chamadas externas de rede ou I/O colateral.**

---

## 2. Mapeamento dos Componentes Operacionais

### 2.1 Criadores e Iniciadores de Operações
Na arquitetura atual:
1. **Iniciadores de Pedido (`requestGeneration`):**
   - **Comando Manual (`command`):** Invocado pelo utilizador via Command Palette (`Lina: Rebuild/Update Embeddings`).
   - **Gatilho de Sidebar (`sidebar`):** Invocado pelo botão contextual de atualização na vista de pesquisa.
   - **Agendamento Automático (`automatic`):** Invocado pelo `EmbeddingScheduler` após expirar o debounce de quiet-period.
   - **Reconciliação Interna (`internal`):** Gatilhos de diagnóstico ou reparação.
2. **Autorização e Verificação de Ownership:**
   - O `EmbeddingWorker` verifica portas booleanas isoladas:
     - `capabilities.canGenerateEmbeddings()` (hardware/plataforma desktop vs mobile);
     - `capabilities.canPublish()` / `canPublish()` (verificação do Active Producer através do `OwnershipGate`);
     - `isTextIndexBusy()` e `coordinator.requestPreparation()` (coordenação com o índice textual).
3. **Bloqueio de Companion e Standby:**
   - Companion é bloqueado via `capabilities.canGenerateEmbeddings() === false` (`"not-capable"`).
   - Standby é bloqueado via `canPublish() === false` (`"not-active-producer"`).

### 2.2 Decisões Duplicadas e Dispersas vs Decisão Canónica

| Ponto de Decisão Legada | Mecanismo Legado Atual | Mecanismo Canónico (`deriveEmbeddingWritePathDecision`) | Análise de Divergência / Risco |
|---|---|---|---|
| **Elegibilidade para Iniciar Operação** | `canGenerateEmbeddings() && canPublish() && !isTextIndexBusy() && status !== "running"` | `decision.applicable && decision.canExecute && decision.action !== "none" && !operationActive` | O mecanismo legado não valida se o estado é `INCOMPATIBLE` (que exige confirmação modal) ou se há trabalho real antes de reservar o coordenador. |
| **Ação Permitida** | Operação cega de geração (`generate`), sem distinção formal entre `generate`, `update`, `rebuild` ou `retry`. | `decision.action` (`"none" \| "generate" \| "update" \| "rebuild" \| "cancel" \| "retry"`). | Canónico prescreve o modo exato e custo associado. |
| **Cancelabilidade** | `status === "running"` em qualquer fase (`EmbeddingOperationManager`). | `process.cancellable` avalia a fase ativa (`persisting` não é interrompível). | O canónico previne abortar corrupções no momento da persistência atómica. |
| **Perda de Autoridade durante Execução** | Sem verificação contínua no loop do Worker; a perda de ownership a meio do batch pode permitir persistência se não houver fencing ativo. | `decision.ownershipLostDuringOperation === true` (quando `operationActive` e `blockedReason` indica perda de papel/autoridade). | **Crítico:** O modelo canónico deteta imediatamente a anomalia para suspensão segura. |
| **Estados Indeterminados** | `hasEmbeddingWork` ou gatilhos manuais podem acionar worker sobre índice ilegível. | `snapshot.primary === "INDETERMINATE"` e `workKind: "indeterminate"` bloqueiam `canExecute: false`. | Canónico impede corrupção de índices com dados corrompidos. |

---

## 3. Avaliação de Riscos e Invariantes Operacionais

### 3.1 Operação sem Snapshot Válido
- No modelo legado, um pedido pode ser submetido se os testes booleanos passarem, mesmo que os metadados do índice estejam corrompidos.
- O modelo canónico garante que qualquer anomalia classifica o estado primário como `INDETERMINATE`, `INCOMPATIBLE` ou `ERROR`, desabilitando `canExecute = false` sem confirmação ou reparação prévia.

### 3.2 Mudança de Ownership durante a Execução
- Se outro nó reivindicar o papel de Active Producer enquanto uma geração de 1000 chunks decorre:
  - O snapshot deteta a perda de autoridade (`capability.blockedReason = "ownership-lost"` ou `"standby"`).
  - A decisão canónica sinaliza `ownershipLostDuringOperation = true` e `action = "cancel"`.

### 3.3 Proteção do Companion e Standby
- Dispositivos Companion e Standby obtêm deterministicamente `applicable = false`, `canExecute = false` e `action = "none"` no snapshot, garantindo isolamento total.

---

## 4. Arquitetura da Camada Shadow

Será criado o módulo puro [`src/maintenance/embeddingOperationLifecycleShadow.ts`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingOperationLifecycleShadow.ts) expondo:

1. **`OperationShadowEligibilityDecision`**:
   - `canStart: boolean` (se uma nova operação pode ser iniciada)
   - `canCancel: boolean` (se a operação ativa pode ser cancelada de forma segura)
   - `canRetry: boolean` (se uma operação falhada pode ser repetida)
   - `action: EmbeddingWriteAction`
   - `requiresConfirmation: boolean`
   - `ownershipLostDuringOperation: boolean`
   - `reason: string`
   - `decision?: EmbeddingWritePathDecision`
2. **`LegacyOperationStateInputs`**:
   - `canGenerateEmbeddings: boolean`
   - `canPublish: boolean`
   - `isTextIndexBusy: boolean`
   - `operationState: EmbeddingOperationState`
   - `hasWork?: boolean`
   - `deviceRole?: DeviceRole`
3. **`compareOperationLifecycleDecision`**:
   - Compara a decisão operacional legada com a decisão canónica derivada de `EmbeddingLifecycleSnapshot`.
   - Categoriza as divergências em:
     - `expected`: proteções seguras do modelo canónico (ex.: bloqueio de rebuild sem confirmação, não-cancelabilidade em `persisting`, bloqueio de `INDETERMINATE`);
     - `informative`: discrepâncias de mensagens de diagnóstico ou categorização de erro;
     - `divergence`: autorizações de execução divergentes não intencionais.

---

## 5. Matriz de Cenários e Cobertura de Testes

A suite [`tests/maintenance/embeddingOperationLifecycleShadow.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingOperationLifecycleShadow.test.ts) validará:

1. **`READY` sem trabalho:** `canStart = false`, `canCancel = false`, `action = "none"`.
2. **`UPDATE_AVAILABLE`:** `canStart = true`, `action = "update"`.
3. **`INDEX_ONLY`:** `canStart = true`, `action = "generate"`.
4. **`INCOMPATIBLE`:** `canStart = false` (exige rebuild e confirmação), `action = "rebuild"`, `requiresConfirmation = true`.
5. **`ERROR`:** `canStart = false`, `action = "retry"`, `canRetry = true` (se autorizado).
6. **`Companion`:** `canStart = false`, `canCancel = false`, `action = "none"`.
7. **`Standby`:** `canStart = false`, `canCancel = false`, `action = "none"`.
8. **`INDETERMINATE`:** `canStart = false`, `action = "none"`.
9. **Geração em curso (`UPDATING`):** `canStart = false`, `action = "cancel"` (se cancelável), preservação de progresso.
10. **Cancelamento (`CANCELLING`):** `canStart = false`, `canCancel = false`, `action = "none"`.
11. **Retry:** `canRetry = true` condicionado à autoridade do produtor.
12. **Perda de Ownership durante Operação:** `ownershipLostDuringOperation = true`, `canStart = false`.
13. **Divergência Legado vs Canónico:** classificação estruturada de desvios.

---

## 6. Conclusão da Auditoria

A camada shadow do Worker e Operation Manager fornece a observabilidade e verificação estrita necessárias para a futura transição ativa (LINA-14D.3 / LINA-14D.5), garantindo zero impacto nos fluxos produtivos atuais. Aprovado para implementação imediata.
