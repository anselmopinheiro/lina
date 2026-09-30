# LINA-14D.2-C — Auditoria de Migração Shadow do Scheduler para o Write Path Canónico

**Data:** 2026-09-30  
**Fase:** LINA-14D.2-C  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Aprovado para Implementação Shadow  

---

## 1. Contexto e Motivação

O projeto Lina encontra-se na fase LINA-14D.2 de migração e consolidação do Write Path de embeddings.
A arquitetura consolidada estabelece o fluxo unidirecional:

```text
EmbeddingLifecycleSnapshot
          ↓
deriveEmbeddingWritePathDecision()
          ↓
EmbeddingPolicyEngine & Consumidores do Write Path
          ↓
Execução
```

Com a conclusão de **LINA-14D.1** (decisões arquiteturais do Write Path congeladas), **LINA-14D.2-A** (`EmbeddingWorkStatusController` migrado) e **LINA-14D.2-B** (`EmbeddingPolicyEngine` migrado), a presente fase — **LINA-14D.2-C** — foca-se na **Shadow Migration do Scheduler** ([`EmbeddingScheduler`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingScheduler.ts)).

### Limites Obrigatórios e Não-Interferência Comportamental
Esta fase **NÃO altera o comportamento em produção** do Scheduler.
- Zero alteração no disparo automático em runtime;
- Zero alteração na periodicidade, debounce de quiet period (30s) e bounded maximum delay (300s);
- Zero alteração em timers, ownership, locks, Worker, publicação, geração de embeddings, UI ou Settings;
- Zero chamadas externas de IA não autorizadas.

O objetivo é auditar as decisões legadas do Scheduler, desenhar uma comparação shadow pura baseada em `EmbeddingLifecycleSnapshot` + `deriveEmbeddingWritePathDecision()` e classificar rigorosamente eventuais divergências.

---

## 2. Auditoria do Scheduler Atual

### 2.1 Componentes e Portas Injetadas
O [`EmbeddingScheduler`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingScheduler.ts) opera através de portas estritas injetadas pelo host ([`main.ts`](file:///d:/_dev/obsidian/lina/main.ts)):

1. **`canScheduleEmbeddings()`**:
   - *Legado:* `getDeviceCapabilities().canGenerateEmbeddings && this.getOwnershipGate().isAuthorizedSync()`
   - *Função:* Determina se o scheduler pode arrancar (`start()`) e aceitar transições de estado (`markDirty()`).
2. **`canDispatchAutomatically()`**:
   - *Legado:* Inspeciona a role (`deviceRole === "producer"`), a configuração do provider (apenas local e sem custo externo via `evaluateEmbeddingUpdatePolicy`) e a política (`settings.embeddingUpdateMode`).
   - *Função:* Portão de política pré-despacho automático.
3. **`hasEmbeddingWork()`**:
   - *Legado:* `this.hasAutomaticEmbeddingWork()` em `main.ts`, que lê `readEmbeddingUpdatePreview` e calcula `updatePlan.toGenerateCount > 0 || updatePlan.requiresPublication`.
   - *Função:* Verificação de trabalho pendente após o expirar do quiet period / debounce.
4. **`dispatchAutomatic()`**:
   - *Legado:* `this.requestEmbeddingIndexGeneration("automatic")`.
   - *Função:* Invoca o `MaintenanceEngine` / `EmbeddingWorker`.

### 2.2 Mapeamento da Cadeia de Decisão

| Dimensão | Mecanismo Legado (`EmbeddingScheduler` + `main.ts`) | Mecanismo Canónico (`EmbeddingLifecycleSnapshot` + `deriveEmbeddingWritePathDecision`) |
|---|---|---|
| **Deteção de Trabalho** | `hasAutomaticEmbeddingWork`: `toGenerateCount > 0 \|\| requiresPublication` sobre preview ad-hoc. | `snapshot.write.updateRequired` e `decision.workKind !== "none"`. |
| **Autorização de Despacho** | `canDispatchAutomatically` + `evaluateEmbeddingUpdatePolicy` com input booleano ad-hoc. | `decision.canExecute && decision.action !== "none" && !decision.requiresConfirmation && decision.cost === "local"`. |
| **Ownership / Papel** | `deviceRole === "producer"` e `isAuthorizedSync()`. | `decision.applicable === true` (filtrando `companion`, `standby`, `unassigned`, `ownership-lost`). |
| **Criação de Operações** | `dispatchAutomatic()` aceita e despoleta geração sem validar se a ação requer rebuild. | `decision.action === "update" \|\| decision.action === "generate"` (rebuild é bloqueado de despacho automático por `requiresConfirmation: true`). |

---

## 3. Matriz de Estados e Validações Obrigatórias

| Estado / Cenário | Decisão Canónica do Write Path | Comportamento Esperado do Scheduler Shadow | Classificação de Divergência |
|---|---|---|---|
| **`READY`** | `updateRequired = false`, `action = "none"`, `canExecute = false` | Scheduler não agenda trabalho (`hasWork = false`, `canDispatch = false`). | Esperada / Alinhada. |
| **`UPDATE_AVAILABLE`** | `updateRequired = true`, `action = "update"`, `canExecute = true` | Reconhece trabalho pendente compatível com update local automático (`policy = automatic-local-only`). | Esperada / Alinhada. |
| **`INDEX_ONLY`** | `updateRequired = true`, `action = "generate"`, `canExecute = true` | Reconhece necessidade de build inicial. Se local e política automática, pode despachar; se external, requer confirmação. | Esperada / Alinhada. |
| **`INCOMPATIBLE`** | `action = "rebuild"`, `requiresConfirmation = true`, `severity = "blocking"` | **Nunca despacha automaticamente.** Requer rebuild e confirmação explícita. | Esperada / Alinhada (Bloqueio mandatório). |
| **`ERROR`** | `action = "retry"`, `canRetry` condicionado por autoridade | Não executa automaticamente sem intervenção ou reset de cooldown/backoff. | Esperada / Alinhada. |
| **`Companion`** | `applicable = false`, `blockedReason = "companion"`, `action = "none"` | **Nunca agenda nem executa localmente.** | Esperada / Alinhada. |
| **`Standby`** | `applicable = false`, `blockedReason = "standby"`, `action = "none"` | **Nunca executa localmente.** | Esperada / Alinhada. |
| **`INDETERMINATE`** | `workKind = "indeterminate"`, `action = "none"`, `canExecute = false` | **Bloqueia execução automática**, não faz fallback silencioso para idle. | Esperada / Alinhada. |
| **Perda de Ownership** | `ownershipLostDuringOperation = true` ou `applicable = false` (`ownership-lost`) | Cancela ou bloqueia agendamento e execução imediata. | Esperada / Alinhada. |

---

## 4. Classificação e Tratamento de Divergências

As divergências observadas entre o Scheduler legado e a decisão canónica são tipadas em 3 categorias:

1. **Esperada (`expected`):**
   - Transição onde o modelo canónico impõe restrição mais segura conhecida (ex.: bloqueio estrito de Companion, Standby ou `INCOMPATIBLE`).
2. **Informativa (`informative`):**
   - Variações semânticas de diagnóstico ou descrição que não afetam a segurança da execução (ex.: detalhe do motivo de bloqueio ou custo).
3. **Divergência Real (`divergence`):**
   - Qualquer situação onde o scheduler legado despacharia trabalho automático não autorizado pela decisão canónica, ou onde silenciaria um estado indeterminado.

---

## 5. Plano de Implementação da Camada Shadow

1. **Tipos e Interfaces de Shadow no Módulo do Scheduler**:
   - `SchedulerEligibilityDecision`: modelo puro da decisão de agendamento e despacho.
   - `LegacySchedulerDecisionInputs`: inputs estruturados do scheduler legado para cálculo shadow.
   - `SchedulerDifference` e `SchedulerComparisonResult`: avaliação determinística de paridade com categorização de divergências.
2. **Funções Puras de Avaliação**:
   - `evaluateLegacySchedulerDecision(inputs)`: replica a lógica dos predicados legados do scheduler.
   - `evaluateSchedulerDecisionFromSnapshot(snapshot, policy)`: deriva a decisão prescritiva de agendamento diretamente do `EmbeddingLifecycleSnapshot` + `deriveEmbeddingWritePathDecision()`.
   - `compareSchedulerDecision(legacyInputs, snapshot, policy)`: compara ambas e gera lista categorizada de diferenças.
3. **Bateria Abrangente de Testes (10 Cenários)**:
   - Ficheiro dedicado `tests/maintenance/embeddingSchedulerLifecycle.test.ts` cobrindo todos os cenários estipulados.

---

## 6. Critérios de Conclusão da Fase

- Módulo [`src/maintenance/embeddingScheduler.ts`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingScheduler.ts) enriquecido com ferramentas puras de shadow comparison sem impacto no runtime ativo;
- Bateria de testes de paridade shadow com 10 cenários criada e 100% aprovada;
- Validação completa (`npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check`);
- Relatório de implementação e documentação de projeto atualizados.
