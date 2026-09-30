# LINA-14F.4-B1 — Auditoria de Remoção da Infraestrutura Shadow Mode

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B1  
**Status:** PRÉ-AUDITORIA CONCLUÍDA  
**Autoridade de Referência:** `AGENTS.md`, Decisões Arquiteturais LINA-14, `LINA-14E`, `LINA-14F.1`, `LINA-14F.2`, `LINA-14F.3`, `LINA-14F.4-A`.

---

## 1. Sumário Executivo e Objetivos

Esta auditoria define o plano rigoroso e seguro para a execução do **Lote B1** da fase **LINA-14F.4-B — Remoção incremental do legado**.

Conforme auditado em **LINA-14F.4-A**:
- A autoridade operacional sobre Leitura, Decisão de Escrita e Execução de Manutenção pertence 100% ao modelo canónico `EmbeddingLifecycleSnapshot` + `deriveEmbeddingWritePathDecision()`;
- A infraestrutura de Shadow Mode cumpriu integralmente o seu propósito de validação empírica e paridade;
- Os comparadores e estruturas de diferença legacy vs canonical não exercem autoridade operacional nem afetam decisões ativas de produção.

O objetivo do **Lote B1** é remover de forma cirúrgica e segura toda a infraestrutura de comparação Shadow Mode, extraindo e normalizando previamente qualquer tipo ou função canónica que ainda resida em módulos shadow.

---

## 2. Inventário Exaustivo de Símbolos e Análise de Consumidores

### 2.1. Módulo `src/maintenance/embeddingOperationLifecycleShadow.ts`

| Símbolo | Natureza | Consumidores em Produção | Consumidores em Testes | Destino no Lote B1 |
|---|---|---|---|---|
| `OperationShadowEligibilityDecision` | Interface canónica de decisão | `src/maintenance/embeddingWorker.ts` | Testes do worker e shadow | **Extrair & Renomear:** `EmbeddingOperationEligibilityDecision` em `src/maintenance/embeddingWorker.ts` |
| `evaluateOperationDecisionFromSnapshot` | Função pura canónica | `src/maintenance/embeddingWorker.ts` | Testes do worker e shadow | **Extrair:** Mover para `src/maintenance/embeddingWorker.ts` |
| `LegacyOperationStateInputs` | Tipo auxiliar shadow | Nenhum | Testes shadow | **Remover** |
| `OperationDifferenceCategory` | Tipo auxiliar shadow | Nenhum | Testes shadow | **Remover** |
| `OperationDifferenceArea` | Tipo auxiliar shadow | Nenhum | Testes shadow | **Remover** |
| `OperationLifecycleDifference` | Estrutura de diferença | Nenhum | Testes shadow | **Remover** |
| `OperationLifecycleComparisonResult` | Resultado shadow | Nenhum | Testes shadow | **Remover** |
| `evaluateLegacyOperationDecision` | Réplica legacy | Nenhum | Testes shadow | **Remover** |
| `compareOperationLifecycleDecision` | Comparador shadow | Nenhum | Testes shadow | **Remover** |
| **Ficheiro Completo** | Módulo shadow | N/A | N/A | **Remover ficheiro** após extração |

### 2.2. Módulo `src/index/embeddingLifecycleAdapter.ts`

| Símbolo | Natureza | Consumidores em Produção | Consumidores em Testes | Destino no Lote B1 |
|---|---|---|---|---|
| `ShadowDifferenceSeverity` | Tipo auxiliar shadow | Nenhum | `embeddingLifecycleAdapter.test.ts` | **Remover** |
| `EmbeddingLifecycleDifference` | Estrutura de diferença | Nenhum | `embeddingLifecycleAdapter.test.ts` | **Remover** |
| `LegacyStateSummary` | Sumário legacy | Nenhum | `embeddingLifecycleAdapter.test.ts` | **Remover** |
| `EmbeddingLifecycleShadowResult` | Resultado shadow | Nenhum | `embeddingLifecycleAdapter.test.ts` | **Remover** |
| `compareLegacyWithLifecycleSnapshot` | Comparador shadow | Nenhum | `createEmbeddingLifecycleShadowComparison` | **Remover** |
| `createEmbeddingLifecycleShadowComparison` | Comparador shadow | Nenhum | `embeddingLifecycleAdapter.test.ts`, `embeddingLifecycleShadowValidation.test.ts` | **Remover** (migrar testes para `adaptCurrentStateToLifecycleSnapshot`) |
| `mapPrimaryToWorkflowStatus` | Helper interno shadow | Nenhum | `compareLegacyWithLifecycleSnapshot` | **Remover** |
| `CurrentEmbeddingStateInputs` | Tipo canónico adapter | `main.ts`, UI, Search, Worker | Múltiplos testes | **Preservar** |
| `adaptCurrentStateToLifecycleSnapshot` | Função canónica adapter | `main.ts`, UI, Diagnostics, Worker | Múltiplos testes | **Preservar** |
| `toEmbeddingIdentitySummary` | Função canónica adapter | `adaptCurrentStateToLifecycleSnapshot` | Múltiplos testes | **Preservar** |

### 2.3. Módulo `src/index/embeddingLifecycleWritePath.ts`

| Símbolo | Natureza | Consumidores em Produção | Consumidores em Testes | Destino no Lote B1 |
|---|---|---|---|---|
| `EmbeddingWriteAction` | Tipo canónico de ação | `main.ts`, Worker, Scheduler | Múltiplos testes | **Preservar** |
| `EmbeddingWriteBlockedReason` | Tipo canónico | `main.ts`, Diagnostics | Múltiplos testes | **Preservar** |
| `EmbeddingWritePathDecision` | Interface canónica | `main.ts`, Worker, Scheduler | Múltiplos testes | **Preservar** |
| `deriveEmbeddingWritePathDecision` | Função canónica de decisão | `main.ts`, Worker, Scheduler, Policy | Múltiplos testes | **Preservar** |
| `EmbeddingWritePathShadowInputs` | Tipo auxiliar shadow | `main.ts` (método shadow) | Testes write path | **Remover** |
| `LegacyWritePathSummary` | Sumário legacy | Nenhum | Testes write path | **Remover** |
| `summarizeLegacyWritePath` | Réplica legacy | Nenhum | `compareLegacyWritePathWithLifecycle` | **Remover** |
| `EmbeddingWritePathDifferenceArea` | Tipo auxiliar shadow | Nenhum | Testes write path | **Remover** |
| `EmbeddingWritePathDifferenceSeverity` | Tipo auxiliar shadow | Nenhum | Testes write path | **Remover** |
| `EmbeddingWritePathDifference` | Estrutura de diferença | Nenhum | Testes write path | **Remover** |
| `EmbeddingWritePathShadowResult` | Resultado shadow | `main.ts` (método shadow) | Testes write path | **Remover** |
| `expectedLegacyProcessPhase` | Helper interno shadow | Nenhum | `compareLegacyWritePathWithLifecycle` | **Remover** |
| `describeIsolation` | Helper interno shadow | Nenhum | `compareLegacyWritePathWithLifecycle` | **Remover** |
| `OFFERED_ACTIONS` | Helper interno shadow | Nenhum | `compareLegacyWritePathWithLifecycle` | **Remover** |
| `compareLegacyWritePathWithLifecycle` | Comparador shadow | Nenhum | `createEmbeddingWritePathShadowComparison` | **Remover** |
| `createEmbeddingWritePathShadowComparison` | Comparador shadow | `main.ts` (método shadow) | Testes write path | **Remover** |

### 2.4. Módulo `src/maintenance/embeddingPolicyEngine.ts`

| Símbolo | Natureza | Consumidores em Produção | Consumidores em Testes | Destino no Lote B1 |
|---|---|---|---|---|
| `EmbeddingUpdatePolicy` | Tipo canónico | `LinaSettings`, UI, Policy | Múltiplos testes | **Preservar** |
| `EmbeddingPolicyDecision` | Tipo canónico | Worker, Scheduler, Policy | Múltiplos testes | **Preservar** |
| `EvaluateEmbeddingUpdatePolicyOptions`| Tipo de options | UI, Policy, Tests | Múltiplos testes | **Preservar** |
| `evaluateEmbeddingUpdatePolicyFromSnapshot`| Função canónica | Worker, Scheduler, Policy | Múltiplos testes | **Preservar** |
| `evaluateEmbeddingUpdatePolicy` | Wrapper de compatibilidade | `main.ts`, testes de settings | Testes legados | **Preservar** (marcado para remoção em B2) |
| `PolicyEngineComparisonResult` | Resultado shadow | Nenhum | `embeddingPolicyEngineLifecycle.test.ts` | **Remover** |
| `comparePolicyEngineDecision` | Comparador shadow | Nenhum | `embeddingPolicyEngineLifecycle.test.ts` | **Remover** |

### 2.5. Módulo `src/maintenance/embeddingScheduler.ts`

| Símbolo | Natureza | Consumidores em Produção | Consumidores em Testes | Destino no Lote B1 |
|---|---|---|---|---|
| `SchedulerEligibilityDecision` | Tipo canónico | `EmbeddingScheduler`, testes | Múltiplos testes | **Preservar** |
| `evaluateSchedulerDecisionFromSnapshot`| Função canónica | `EmbeddingScheduler` | Múltiplos testes | **Preservar** |
| `EmbeddingScheduler` (classe) | Motor canónico | `main.ts`, MaintenanceEngine | Múltiplos testes | **Preservar** |
| `LegacySchedulerDecisionInputs` | Tipo auxiliar shadow | Nenhum | `embeddingSchedulerLifecycle.test.ts`| **Remover** |
| `SchedulerDifferenceCategory` | Tipo auxiliar shadow | Nenhum | `embeddingSchedulerLifecycle.test.ts`| **Remover** |
| `SchedulerDifferenceArea` | Tipo auxiliar shadow | Nenhum | `embeddingSchedulerLifecycle.test.ts`| **Remover** |
| `SchedulerDifference` | Estrutura de diferença | Nenhum | `embeddingSchedulerLifecycle.test.ts`| **Remover** |
| `SchedulerComparisonResult` | Resultado shadow | Nenhum | `embeddingSchedulerLifecycle.test.ts`| **Remover** |
| `evaluateLegacySchedulerDecision` | Réplica legacy | Nenhum | `compareSchedulerDecision` | **Remover** |
| `compareSchedulerDecision` | Comparador shadow | Nenhum | `embeddingSchedulerLifecycle.test.ts`| **Remover** |

### 2.6. `main.ts`

| Símbolo / Membro | Natureza | Consumidores em Produção | Consumidores em Testes | Destino no Lote B1 |
|---|---|---|---|---|
| `getEmbeddingWritePathShadowComparison()` | Método on-demand shadow | Nenhum | Teste de contrato de isolamento | **Remover** |
| Import `createEmbeddingWritePathShadowComparison` | Import shadow | `getEmbeddingWritePathShadowComparison` | N/A | **Remover** |
| Import `type EmbeddingWritePathShadowResult` | Import shadow | `getEmbeddingWritePathShadowComparison` | N/A | **Remover** |

---

## 3. Limites Rígidos e Itens Não-Afetados (Preservados para Lotes B2–B6)

Em estrito cumprimento das diretrizes de arquitetura:
1. **Lote B2:** `hasEmbeddingWorkAvailable()` em `embeddingWorkStatusController.ts` e `evaluateEmbeddingUpdatePolicy()` em `embeddingPolicyEngine.ts` **NÃO** são removidos em B1;
2. **Lote B3:** `src/index/embeddingWorkflowState.ts`, campo inerte `workflow` em `sidebarStatusViewModel.ts` e `getEmbeddingWorkflowState()` em `main.ts` **NÃO** são removidos em B1;
3. **Lote B4:** Simplificação de wiring e DI no scheduler de `main.ts` fica para B4;
4. **Lote B5:** Migração completa de testes de workflow legado fica para B5;
5. **Invariantes Operacionais:** Nenhuma alteração em:
   - Locks, ownership, fencing de Companion/Standby;
   - Semântica de `deriveEmbeddingWritePathDecision()`;
   - Persistência ou publicação de embeddings;
   - Settings ou schemas de dados.

---

## 4. Plano de Execução do Lote B1

1. **Passo 1 (Extração de tipos canónicos):**
   - Em `src/maintenance/embeddingWorker.ts`, declarar a interface canónica `EmbeddingOperationEligibilityDecision` e a função pura `evaluateOperationDecisionFromSnapshot(snapshot)`.
   - Atualizar `EmbeddingWorker.evaluateCanonicalDecision()` para utilizar `EmbeddingOperationEligibilityDecision`.
2. **Passo 2 (Eliminação do módulo shadow de Worker):**
   - Remover `src/maintenance/embeddingOperationLifecycleShadow.ts`.
   - Atualizar `tests/maintenance/embeddingOperationLifecycleCutover.test.ts` e `tests/maintenance/embeddingOperationLifecycleShadow.test.ts` para importar de `src/maintenance/embeddingWorker.ts` e focar exclusivamente nas decisões canónicas.
3. **Passo 3 (Limpeza de Shadow no Adapter):**
   - Em `src/index/embeddingLifecycleAdapter.ts`, remover `ShadowDifferenceSeverity`, `EmbeddingLifecycleDifference`, `LegacyStateSummary`, `EmbeddingLifecycleShadowResult`, `compareLegacyWithLifecycleSnapshot`, `createEmbeddingLifecycleShadowComparison` e `mapPrimaryToWorkflowStatus`.
   - Em `tests/index/embeddingLifecycleShadowValidation.test.ts`, migrar para `adaptCurrentStateToLifecycleSnapshot`.
   - Em `tests/index/embeddingLifecycleAdapter.test.ts`, remover o bloco 8 de shadow comparison.
4. **Passo 4 (Limpeza de Shadow no Write Path):**
   - Em `src/index/embeddingLifecycleWritePath.ts`, remover `EmbeddingWritePathShadowInputs`, `LegacyWritePathSummary`, `summarizeLegacyWritePath`, `EmbeddingWritePathDifferenceArea`, `EmbeddingWritePathDifferenceSeverity`, `EmbeddingWritePathDifference`, `EmbeddingWritePathShadowResult`, `compareLegacyWritePathWithLifecycle`, `createEmbeddingWritePathShadowComparison` e helpers internos.
   - Em `tests/index/embeddingLifecycleWritePath.test.ts`, remover testes que validavam exclusivamente as réplicas legacy e o método shadow do plugin.
5. **Passo 5 (Limpeza de Shadow no Policy Engine e Scheduler):**
   - Em `src/maintenance/embeddingPolicyEngine.ts`, remover `PolicyEngineComparisonResult` e `comparePolicyEngineDecision`.
   - Em `src/maintenance/embeddingScheduler.ts`, remover `LegacySchedulerDecisionInputs`, `SchedulerDifferenceCategory`, `SchedulerDifferenceArea`, `SchedulerDifference`, `SchedulerComparisonResult`, `evaluateLegacySchedulerDecision`, `compareSchedulerDecision`.
   - Em `tests/maintenance/embeddingPolicyEngineLifecycle.test.ts` e `tests/maintenance/embeddingSchedulerLifecycle.test.ts`, remover os testes de comparação shadow legada.
6. **Passo 6 (Limpeza em `main.ts`):**
   - Remover `getEmbeddingWritePathShadowComparison()` e os imports de shadow correspondentes.
7. **Passo 7 (Validação Integral):**
   - Executar `npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check`.
