# LINA-14F.4-A — Auditoria de Remoção Controlada de Legado (Embedding Lifecycle)

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-A  
**Status:** CONCLUÍDO (Auditoria de análise e inventário — sem remoções de código de produção)  
**Autoridade de Referência:** `AGENTS.md`, Decisões Arquiteturais LINA-14, `LINA-14E`, `LINA-14F.1`, `LINA-14F.2`, `LINA-14F.3`.

---

## 1. Sumário Executivo

Com a conclusão bem-sucedida dos cutovers ativos das fases anteriores:
- **LINA-14F.1:** Read Path e UI (Sidebar, Diagnostics, Search) assumiram autoridade total sobre o `EmbeddingLifecycleSnapshot`;
- **LINA-14F.2:** Write Path, `EmbeddingWorkStatusController`, `EmbeddingPolicyEngine` e `EmbeddingScheduler` foram migrados para decisões canónicas derivadas de `EmbeddingLifecycleSnapshot`;
- **LINA-14F.3:** Camada de execução física (`EmbeddingWorker` e `EmbeddingOperationManager`) foi migrada para o modelo canónico com proteção estrita de fencing de ownership, cancelamento e retry.

Neste ponto, o modelo canónico `EmbeddingLifecycleSnapshot` + `deriveEmbeddingWritePathDecision()` é a **única fonte de autoridade** sobre leitura, decisão e execução.

Esta auditoria (Fase **LINA-14F.4-A**) realiza um inventário exaustivo e rigoroso de todo o legado remanescente no ciclo de vida dos embeddings. O objetivo é estabelecer uma base segura, classificada e rastreável para a subsequente fase de remoção incremental (**LINA-14F.4-B**), garantindo zero quebra de comportamento, zero regressão e zero perda de cobertura de testes.

---

## 2. Inventário e Análise por Âmbito

### 2.1. Módulo `embeddingWorkflowState.ts`

- **Origem:** Introduzido na Fase 0.3.x (LINA-11) para separar o Read Path do Write Path antes da unificação do lifecycle snapshot.
- **Ficheiro:** [`src/index/embeddingWorkflowState.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkflowState.ts)
- **Símbolos Exportados:**
  - `type EmbeddingWorkflowStatus`
  - `interface EmbeddingWorkflowState`
  - `interface ResolveEmbeddingWorkflowInput`
  - `function resolveEmbeddingWorkflowState(input: ResolveEmbeddingWorkflowInput): EmbeddingWorkflowState`
- **Consumidores Atuais no Código de Produção:**
  1. [`src/search/sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts):
     - `BuildSidebarStatusViewModelInput` aceita opcionalmente `workflowState?: EmbeddingWorkflowState` (linha 111);
     - `SidebarStatusViewModel` expõe `workflow?: EmbeddingWorkflowState` (linha 86);
     - **Análise de Decisão:** O resolver `buildSidebarStatusViewModel` limita-se a atribuir `workflow: workflowState` (linha 611). **Nenhuma decisão visual, texto, banner ou gating de manutenção é calculado a partir de `workflow`** — todas as decisões derivam de `lifecycleSnapshot` e `runtimeEmbeddings`.
  2. [`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts):
     - Import não utilizado `import { resolveEmbeddingWorkflowState } from "../index/embeddingWorkflowState";` (linha 18).
  3. [`src/index/embeddingLifecycleAdapter.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleAdapter.ts):
     - `CurrentEmbeddingStateInputs` aceita `workflowState?: EmbeddingWorkflowState | null` (linha 37);
     - Utilizado como fallback secundário para `workAssessment` apenas quando `updatePlan` não é fornecido (linhas 183–192).
  4. [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts):
     - Método `getEmbeddingWorkflowState(options?: { textIndexReady?: boolean }): EmbeddingWorkflowState` (linhas 876–885);
     - Chamado em `getEmbeddingWritePathShadowComparison()` (linha 920, método shadow on-demand sem chamadores de produção);
     - Chamado em `getDeviceDiagnostics()` (linha 1045, passado ao adapter, que pode obter `workAssessment` de forma canónica).
- **Consumidores em Testes:**
  - `tests/index/embeddingWorkflowState.test.ts`
  - `tests/search/sidebarEmbeddingWorkflowState.test.ts`
  - `tests/index/embeddingLifecycleWritePath.test.ts`
- **Autoridade Atual:** **NENHUMA (0%)**.
- **Classificação:** `DEPRECATE` em 14F.4-A; `REMOVE` em 14F.4-B (Lote B3).

---

### 2.2. Flags e Predicados Legados

| Flag / Predicado | Origem / Localização | Consumidores Atuais | Autoridade Atual | Substituto Canónico | Classificação |
|---|---|---|---|---|---|
| `embeddingsAvailable` | `src/device/deviceDiagnostics.ts:62` | `deviceDiagnosticsModal.ts:277`, testes de diagnóstico | Projeção informativa DTO | `snapshot.read.semanticAvailable` | `KEEP-COMPATIBILITY` |
| `hasEmbeddingWork` | `src/maintenance/embeddingScheduler.ts:57` | `EmbeddingScheduler` (DI port) | DI Contract Port | Mantido como porta funcional no scheduler | `KEEP-FUNCTIONAL` |
| `hasEmbeddingWorkAvailable` | `src/index/embeddingWorkStatusController.ts:102` | Apenas testes unitários (`embeddingWorkStatusController.test.ts`) | Nenhuma (wrapper de `classifyEmbeddingWork`) | `classifyEmbeddingWork(summary).updateRequired` | `DEPRECATE` (remover em B2) |
| `hasAutomaticEmbeddingWork` | `main.ts:1445` | `main.ts:1553` (Scheduler DI) | Bridge funcional | `deriveEmbeddingWritePathDecision().canDispatchAutomatically` | `KEEP-FUNCTIONAL` |
| `semanticAvailable` | `EmbeddingLifecycleSnapshot.read.semanticAvailable`, `DeviceRuntimeEmbeddingsState` | UI, Search Modals, ViewModels | Canónica (100%) | N/A (já é canónico) | `KEEP-FUNCTIONAL` |
| `updateRequired` | `EmbeddingLifecycleSnapshot.write.updateRequired`, `EmbeddingWorkAssessment` | Write Path, Policy, Worker | Canónica (100%) | N/A (já é canónico) | `KEEP-FUNCTIONAL` |
| `workAvailable` | `EmbeddingWorkRuntimeState.workAvailable` | `EmbeddingWorkStatusController`, legacy `workflowState` | Canónica no Work Controller | `snapshot.write.updateRequired` | `KEEP-FUNCTIONAL` |
| `workflowState` | `CurrentEmbeddingStateInputs`, `SidebarStatusViewModel` | Pass-through inerte | Nenhuma | `lifecycleSnapshot` | `DEPRECATE` (remover em B3) |
| `isGenerating` / `isUpdating` | Legacy UI / ViewModels | Substituído por `snapshot.primary` e `snapshot.process.phase` | Nenhuma | `snapshot.primary === "UPDATING"` | `REMOVE` (se encontrado em adapters) |
| `isProducer` / `isActiveProducer` | `DeviceRuntimeState`, `OwnershipManifest` | Fencing, UI, Policy | Canónica (100%) | `snapshot.write.applicable` / `snapshot.primary` | `KEEP-FUNCTIONAL` |
| `isStandbyProducer` | `DeviceRuntimeState`, `OwnershipManifest` | Diagnostics, ViewModels | Canónica (100%) | `snapshot.primary === "STANDBY"` | `KEEP-FUNCTIONAL` |
| `effectiveMode` | `DeviceRuntimeEmbeddingsState.effectiveMode` | Search View, Modals | Canónica (100%) | N/A (já é canónico) | `KEEP-FUNCTIONAL` |
| `embeddingsEnabled` | `LinaSettings`, `snapshot.capability.embeddingsEnabled` | Settings, Lifecycle Model | Canónica (100%) | `snapshot.capability.embeddingsEnabled` | `KEEP-FUNCTIONAL` |

---

### 2.3. Adapters de Compatibilidade

1. **`hasEmbeddingWorkAvailable(summary)`** ([`src/index/embeddingWorkStatusController.ts:102`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts#L102)):
   - *Consumidores reais:* Nenhum em produção (apenas testes unitários).
   - *API pública interna:* Sim, exportado.
   - *Pode ser removido já?* Sim, no Lote B2 após migração de testes.
   - *Ação:* `DEPRECATE` agora, `REMOVE` em 14F.4-B.

2. **`evaluateEmbeddingUpdatePolicy(options)`** ([`src/maintenance/embeddingPolicyEngine.ts:240`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingPolicyEngine.ts#L240)):
   - *Consumidores reais:* `main.ts` (linha 909 em `getEmbeddingWritePathShadowComparison()`) e múltiplas suítes de testes legadas (`embeddingUpdateConfirmation.test.ts`, `embeddingStatusExplanation.test.ts`, `embeddingUpdateSettings.test.ts`, `secretBoundaryProtection.test.ts`).
   - *API pública interna:* Sim.
   - *Pode ser removido já?* Não imediatamente, pois quebra testes legados antes de serem convertidos para `evaluateEmbeddingUpdatePolicyFromSnapshot`.
   - *Ação:* `KEEP-COMPATIBILITY` temporário; marcar `@deprecated`; migrar chamadores em testes e `REMOVE` em 14F.4-B (Lote B2).

3. **`summarizeLegacyWritePath(inputs)`** ([`src/index/embeddingLifecycleWritePath.ts:235`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleWritePath.ts#L235)):
   - *Consumidores reais:* Apenas o comparador shadow `compareLegacyWritePathWithLifecycle`.
   - *Pode ser removido já?* Sim, no Lote B1.
   - *Ação:* `REMOVE` em 14F.4-B.

4. **`evaluateLegacySchedulerDecision(inputs)`** ([`src/maintenance/embeddingScheduler.ts:400`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingScheduler.ts#L400)):
   - *Consumidores reais:* Apenas o comparador shadow `compareSchedulerDecision`.
   - *Pode ser removido já?* Sim, no Lote B1.
   - *Ação:* `REMOVE` em 14F.4-B.

5. **`evaluateLegacyOperationDecision(inputs)`** ([`src/maintenance/embeddingOperationLifecycleShadow.ts:99`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingOperationLifecycleShadow.ts#L99)):
   - *Consumidores reais:* Apenas o comparador shadow `compareOperationLifecycleDecision`.
   - *Pode ser removido já?* Sim, no Lote B1.
   - *Ação:* `REMOVE` em 14F.4-B.

---

### 2.4. Shadow Infrastructure

A infraestrutura de Shadow Mode cumpriu integralmente o seu papel de validação empírica durante as fases 14B, 14D e 14F. Não há mais execução de shadow paths em produção ativa.

| Componente Shadow | Ficheiro | Consumidores Atuais | Ação Recomendada | Lote |
|---|---|---|---|---|
| `compareLegacyWithLifecycleSnapshot` | `src/index/embeddingLifecycleAdapter.ts:262` | `createEmbeddingLifecycleShadowComparison`, testes de adapter | `REMOVE` da produção / migrar testes | B1 |
| `createEmbeddingLifecycleShadowComparison` | `src/index/embeddingLifecycleAdapter.ts:331` | Testes de adapter | `REMOVE` da produção | B1 |
| `compareLegacyWritePathWithLifecycle` | `src/index/embeddingLifecycleWritePath.ts:337` | `createEmbeddingWritePathShadowComparison`, testes | `REMOVE` da produção | B1 |
| `createEmbeddingWritePathShadowComparison` | `src/index/embeddingLifecycleWritePath.ts:593` | `main.ts:892`, testes write path | `REMOVE` da produção | B1 |
| `getEmbeddingWritePathShadowComparison` | `main.ts:892` | Método on-demand sem chamadores de produção; testes de contrato | `REMOVE` de `main.ts` | B1 |
| `comparePolicyEngineDecision` | `src/maintenance/embeddingPolicyEngine.ts:348` | Testes do policy engine | `REMOVE` da produção | B1 |
| `compareSchedulerDecision` | `src/maintenance/embeddingScheduler.ts:489` | Testes do scheduler | `REMOVE` da produção | B1 |
| `compareOperationLifecycleDecision` | `src/maintenance/embeddingOperationLifecycleShadow.ts:241` | Testes do worker/operation shadow | `REMOVE` da produção | B1 |
| `OperationLifecycleComparisonResult` / `OperationLifecycleDifference` | `src/maintenance/embeddingOperationLifecycleShadow.ts:78-93` | Comparador shadow | `REMOVE` | B1 |
| `OperationShadowEligibilityDecision` | `src/maintenance/embeddingOperationLifecycleShadow.ts:36` | `embeddingWorker.ts:163`, `evaluateOperationDecisionFromSnapshot` | Renomear para `EmbeddingOperationEligibilityDecision` e mover para `embeddingOperationManager.ts` ou `embeddingWorker.ts` | B1/B4 |

---

### 2.5. Decisões Duplicadas

1. **`main.ts` — `getDeviceDiagnostics()` (linhas 1045–1057):**
   - *Duplicação:* Instancia `workflowState = this.getEmbeddingWorkflowState()` e passa-o a `adaptCurrentStateToLifecycleSnapshot`.
   - *Impacto:* Passa um objeto redundante que é ignorado quando `updatePlan` ou `canonicalExists` estão disponíveis.
   - *Substituto canónico:* Invocar `adaptCurrentStateToLifecycleSnapshot` sem `workflowState`, obtendo o estado de trabalho diretamente de `this.getEmbeddingWorkStatus()`.
   - *Recomendação:* Eliminar a chamada a `getEmbeddingWorkflowState` em 14F.4-B (Lote B3).

2. **`main.ts` — `startEmbeddingScheduler()` (linhas 1530–1545):**
   - *Duplicação:* `canDispatchAutomatically` verifica permissões chamando métodos pontuais em vez de delegar diretamente na avaliação canónica de scheduler/policy via snapshot.
   - *Impacto:* Pequena redundância de invocação, embora já consulte o snapshot canónico.
   - *Recomendação:* Simplificar o handler de `canDispatchAutomatically` em 14F.4-B (Lote B4).

3. **`linaSearchView.ts` (linha 18):**
   - *Duplicação:* Import não utilizado de `resolveEmbeddingWorkflowState`.
   - *Recomendação:* Remover o import inerte em 14F.4-B (Lote B3).

4. **`sidebarStatusViewModel.ts` (linhas 86, 111, 611):**
   - *Duplicação:* Entrada e saída de `workflowState` que não é lida por nenhum renderer de UI.
   - *Recomendação:* Remover o campo `workflow` de `SidebarStatusViewModel` e `BuildSidebarStatusViewModelInput` em 14F.4-B (Lote B3).

---

### 2.6. Fallbacks Remanescentes

#### A. Fallbacks de Compatibilidade Legítima (Manter)
- **`deviceDiagnosticsModal.ts:277`:**
  ```ts
  const hasEmbeddings = snapshot
    ? snapshot.read.semanticAvailable
    : Boolean(searchSection.operationalSemanticAvailable ?? searchSection.embeddingsAvailable);
  ```
  *Motivo:* Protege o modal contra renderização com snapshot nulo/indefinido durante inicialização ou testes unitários simplificados.
- **`embeddingLifecycleAdapter.ts:97-109` (`toEmbeddingIdentitySummary`):**
  *Motivo:* Suporta conversão normalizada tanto de `PublishedEmbeddingIdentity` como de `VectorContractV1` estrutural.

#### B. Fallbacks Perigosos (Eliminados nas fases 14F.1–14F.3)
- *Avaliação:* Nenhum fallback silencioso ou bifurcação de decisão detetado. Todos os caminhos de escrita e execução convergem obrigatoriamente para `EmbeddingLifecycleSnapshot`.

#### C. Dead Fallbacks (Candidatos a Remoção)
- **`embeddingLifecycleAdapter.ts:183-192`:**
  Fallback para `inputs.workflowState` quando `inputs.updatePlan` é nulo. Com a consolidação do `updatePlan` e classificação direta de trabalho em `classifyEmbeddingWork`, este bloco de fallback é código morto.
  *Recomendação:* Remover em 14F.4-B (Lote B3).

---

### 2.7. Testes Legados

| Ficheiro de Teste | Estado Atual | Problema / Dependência | Ação Recomendada |
|---|---|---|---|
| `tests/index/embeddingWorkflowState.test.ts` | Passa (43 testes) | Testa diretamente o resolver legado de `embeddingWorkflowState.ts` | Remover após eliminação de `embeddingWorkflowState.ts` (Lote B5) |
| `tests/search/sidebarEmbeddingWorkflowState.test.ts` | Passa (16 testes) | Testa integração da sidebar com `resolveEmbeddingWorkflowState` | Converter para testar `buildSidebarStatusViewModel` com `EmbeddingLifecycleSnapshot` (Lote B5) |
| `tests/index/embeddingLifecycleWritePath.test.ts` | Passa (29 testes) | Testa comparadores shadow e asserções de snapshot | Manter os testes canónicos de `deriveEmbeddingWritePathDecision`; remover testes do comparador shadow (Lote B5) |
| `tests/maintenance/embeddingOperationLifecycleShadow.test.ts` | Passa (19 testes) | Testa comparação shadow entre legacy e canónico | Migrar asserções canónicas para testes de worker/operation e remover o comparador (Lote B5) |
| `tests/maintenance/embeddingPolicyEngine.test.ts` | Passa (48 testes) | Múltiplos testes chamam `evaluateEmbeddingUpdatePolicy` (wrapper legado) | Migrar chamadas para `evaluateEmbeddingUpdatePolicyFromSnapshot` (Lote B5) |
| `tests/maintenance/embeddingUpdateConfirmation.test.ts` | Passa (9 testes) | Chama `evaluateEmbeddingUpdatePolicy` | Migrar para `evaluateEmbeddingUpdatePolicyFromSnapshot` (Lote B5) |
| `tests/maintenance/embeddingStatusExplanation.test.ts` | Passa (9 testes) | Chama `evaluateEmbeddingUpdatePolicy` | Migrar para `evaluateEmbeddingUpdatePolicyFromSnapshot` (Lote B5) |
| `tests/index/embeddingWorkStatusController.test.ts` | Passa | Testa `hasEmbeddingWorkAvailable` | Migrar para testar `classifyEmbeddingWork` diretamente (Lote B5) |

---

### 2.8. Wiring em `main.ts` e Runtime

1. **Métodos On-Demand / Legados em `main.ts`:**
   - `getEmbeddingWorkflowState()`: Linhas 876–885. Sem chamadores reais em produção. Eliminar no Lote B3.
   - `getEmbeddingWritePathShadowComparison()`: Linhas 892–931. Método shadow on-demand. Eliminar no Lote B1.
2. **Imports em `main.ts`:**
   - `createEmbeddingWritePathShadowComparison`: Eliminar no Lote B1.
   - `EmbeddingWritePathShadowResult`: Eliminar no Lote B1.
   - `resolveEmbeddingWorkflowState`, `EmbeddingWorkflowState`: Eliminar no Lote B3.

---

### 2.9. API Pública e Compatibilidade Externa

- O plugin Lina para Obsidian expõe como entry point público exclusivamente a classe default `LinaPlugin` em `main.ts`.
- Nenhum módulo externo ou plugin de terceiros consome os ficheiros TypeScript internos de `src/index/`, `src/maintenance/` ou `src/search/`.
- As definições de Settings (`LinaSettings`) e a interface de persistência (`.lina/*`) permanecem 100% inalteradas.

---

## 3. Matriz Canónica de Classificação

| Símbolo / Ficheiro | Categoria | Consumidores Atuais | Autoridade Atual | Substituto Canónico | Ação Recomendada | Risco |
|---|---|---|---|---|---|---|
| `EmbeddingWorkflowState` (`src/index/embeddingWorkflowState.ts`) | workflow legado | `sidebarStatusViewModel`, `adapter`, `main.ts`, testes | Nenhuma | `EmbeddingLifecycleSnapshot` | `REMOVE` (Lote B3) | Baixo |
| `resolveEmbeddingWorkflowState` (`src/index/embeddingWorkflowState.ts`) | workflow legado | `main.ts`, `adapter`, testes | Nenhuma | `resolveEmbeddingLifecycle` | `REMOVE` (Lote B3) | Baixo |
| `compareLegacyWithLifecycleSnapshot` (`src/index/embeddingLifecycleAdapter.ts`) | shadow helper | `createEmbeddingLifecycleShadowComparison`, testes | Nenhuma | `resolveEmbeddingLifecycle` | `REMOVE` (Lote B1) | Muito Baixo |
| `createEmbeddingLifecycleShadowComparison` (`src/index/embeddingLifecycleAdapter.ts`) | shadow helper | Testes unitários | Nenhuma | N/A (shadow expirado) | `REMOVE` (Lote B1) | Muito Baixo |
| `summarizeLegacyWritePath` (`src/index/embeddingLifecycleWritePath.ts`) | shadow helper | `compareLegacyWritePathWithLifecycle` | Nenhuma | `deriveEmbeddingWritePathDecision` | `REMOVE` (Lote B1) | Muito Baixo |
| `compareLegacyWritePathWithLifecycle` (`src/index/embeddingLifecycleWritePath.ts`) | shadow helper | `createEmbeddingWritePathShadowComparison` | Nenhuma | `deriveEmbeddingWritePathDecision` | `REMOVE` (Lote B1) | Muito Baixo |
| `createEmbeddingWritePathShadowComparison` (`src/index/embeddingLifecycleWritePath.ts`) | shadow helper | `main.ts:892`, testes | Nenhuma | `deriveEmbeddingWritePathDecision` | `REMOVE` (Lote B1) | Muito Baixo |
| `getEmbeddingWritePathShadowComparison` (`main.ts`) | shadow helper | Testes de contrato | Nenhuma | N/A | `REMOVE` (Lote B1) | Muito Baixo |
| `comparePolicyEngineDecision` (`src/maintenance/embeddingPolicyEngine.ts`) | shadow helper | Testes unitários | Nenhuma | `evaluateEmbeddingUpdatePolicyFromSnapshot` | `REMOVE` (Lote B1) | Muito Baixo |
| `compareSchedulerDecision` (`src/maintenance/embeddingScheduler.ts`) | shadow helper | Testes unitários | Nenhuma | `evaluateSchedulerDecisionFromSnapshot` | `REMOVE` (Lote B1) | Muito Baixo |
| `evaluateLegacySchedulerDecision` (`src/maintenance/embeddingScheduler.ts`) | shadow helper | `compareSchedulerDecision` | Nenhuma | `evaluateSchedulerDecisionFromSnapshot` | `REMOVE` (Lote B1) | Muito Baixo |
| `EmbeddingOperationLifecycleShadow.ts` (módulo completo) | shadow helper | `embeddingWorker.ts`, testes shadow | Nenhuma | `evaluateOperationDecisionFromSnapshot` | `REMOVE` (após mover type canónico) (Lote B1) | Baixo |
| `hasEmbeddingWorkAvailable` (`src/index/embeddingWorkStatusController.ts`) | adapter | Testes unitários | Nenhuma | `classifyEmbeddingWork` | `REMOVE` (Lote B2) | Baixo |
| `evaluateEmbeddingUpdatePolicy` (`src/maintenance/embeddingPolicyEngine.ts`) | adapter | Testes de settings/confirmação | Nenhuma | `evaluateEmbeddingUpdatePolicyFromSnapshot` | `DEPRECATE` → `REMOVE` (Lote B2) | Baixo |
| `getEmbeddingWorkflowState` (`main.ts`) | dead code | `getDeviceDiagnostics`, shadow | Nenhuma | `getDeviceDiagnostics` direto via snapshot | `REMOVE` (Lote B3) | Baixo |
| `workflowState` em `SidebarStatusViewModel` | dead code | Pass-through inerte | Nenhuma | `SidebarStatusViewModel.freshness/searchAvailability` | `REMOVE` (Lote B3) | Muito Baixo |
| Fallback `inputs.workflowState` em `embeddingLifecycleAdapter.ts` | dead fallback | Adapter interno | Nenhuma | `inputs.updatePlan` / `classifyEmbeddingWork` | `REMOVE` (Lote B3) | Muito Baixo |
| `embeddingsAvailable` em `DeviceDiagnosticsCompanionSearchSection` | flag de compatibilidade | Modal de diagnósticos, testes | DTO Informativo | `snapshot.read.semanticAvailable` | `KEEP-COMPATIBILITY` | Nulo |
| `hasEmbeddingWork` em `EmbeddingSchedulerOptions` | DI port | `EmbeddingScheduler` | Porta funcional | N/A | `KEEP-FUNCTIONAL` | Nulo |
| `hasAutomaticEmbeddingWork` em `main.ts` | coordinator port | Scheduler DI | Coordenação canónica | N/A | `KEEP-FUNCTIONAL` | Nulo |

---

## 4. Plano Incremental de Remoção (LINA-14F.4-B)

Para garantir segurança operacional e rastreabilidade atómica, a implementação da fase **LINA-14F.4-B** deve ser dividida em **6 lotes incrementais**:

### Lote B1 — Remoção da Infraestrutura de Shadow Mode
1. Extrair a interface de decisão de operação (`OperationShadowEligibilityDecision` → renomear para `EmbeddingOperationEligibilityDecision`) e a função pure `evaluateOperationDecisionFromSnapshot` para `src/index/embeddingLifecycleWritePath.ts` ou `src/maintenance/embeddingWorker.ts`.
2. Remover o ficheiro `src/maintenance/embeddingOperationLifecycleShadow.ts`.
3. Remover funções comparadoras shadow de `src/index/embeddingLifecycleAdapter.ts` (`compareLegacyWithLifecycleSnapshot`, `createEmbeddingLifecycleShadowComparison`).
4. Remover comparadores shadow de `src/index/embeddingLifecycleWritePath.ts` (`summarizeLegacyWritePath`, `compareLegacyWritePathWithLifecycle`, `createEmbeddingWritePathShadowComparison`).
5. Remover comparadores de `src/maintenance/embeddingPolicyEngine.ts` (`comparePolicyEngineDecision`) e `src/maintenance/embeddingScheduler.ts` (`compareSchedulerDecision`, `evaluateLegacySchedulerDecision`).
6. Remover o método on-demand `getEmbeddingWritePathShadowComparison()` de `main.ts`.
7. Executar suite de testes e validar estabilidade.

### Lote B2 — Remoção de Adapters de Compatibilidade sem Consumidores de Produção
1. Remover `hasEmbeddingWorkAvailable()` de `src/index/embeddingWorkStatusController.ts`.
2. Migrar chamadores de testes de `hasEmbeddingWorkAvailable` para `classifyEmbeddingWork`.
3. Migrar suítes de testes de `evaluateEmbeddingUpdatePolicy` para `evaluateEmbeddingUpdatePolicyFromSnapshot`.
4. Remover o wrapper `evaluateEmbeddingUpdatePolicy()` de `src/maintenance/embeddingPolicyEngine.ts`.
5. Executar suite de testes e validar compilação limpa.

### Lote B3 — Remoção do Workflow State Legado (`EmbeddingWorkflowState`)
1. Remover o parâmetro e propriedade inerte `workflowState` / `workflow` de `src/search/sidebarStatusViewModel.ts`.
2. Remover import inerte de `src/search/linaSearchView.ts`.
3. Remover a dependência de `workflowState` em `src/index/embeddingLifecycleAdapter.ts` e eliminar o dead fallback (linhas 183–192).
4. Remover o método `getEmbeddingWorkflowState()` de `main.ts`.
5. Atualizar `main.ts:getDeviceDiagnostics()` para não construir `workflowState`.
6. Remover o ficheiro `src/index/embeddingWorkflowState.ts`.
7. Executar suite de testes.

### Lote B4 — Simplificação de Wiring e Normalização de Types
1. Limpar imports não utilizados em `main.ts`, `linaSearchView.ts` e `sidebarStatusViewModel.ts`.
2. Normalizar a tipagem de decisão de execução do Worker (`EmbeddingOperationEligibilityDecision`).
3. Simplificar o wiring de `canDispatchAutomatically` no scheduler de `main.ts`.

### Lote B5 — Migração e Limpeza de Testes
1. Remover `tests/index/embeddingWorkflowState.test.ts`.
2. Atualizar `tests/search/sidebarEmbeddingWorkflowState.test.ts` para testar o view model via `EmbeddingLifecycleSnapshot`.
3. Limpar fixtures legadas e mocks obsoletos nos testes de escrita e ciclo de vida.
4. Assegurar 100% de testes verdes em toda a suíte.

### Lote B6 — Validação Arquitetural Final e Build
1. Executar `npm run build` e confirmar bundling sem avisos.
2. Executar `npm test` (garantir passagem integral de todos os testes).
3. Executar `npm run lint:obsidian` para garantir conformidade estrita de linting.
4. Validar que nenhuma dependência cíclica ou export órfão foi introduzido.

---

## 5. Avaliação de Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Quebra de testes durante remoção de adapters (`evaluateEmbeddingUpdatePolicy`, `hasEmbeddingWorkAvailable`) | Alta | Baixo | Migrar testes para as funções canónicas correspondentes antes de apagar os wrappers nos lotes B2 e B5. |
| Regressão em papéis Companion ou Standby | Muito Baixa | Alto | A autoridade já está 100% consolidada no `EmbeddingLifecycleSnapshot`. O lote B1 apenas remove comparadores que não exercem escrita nem decisão. |
| Remoção acidental de tipos necessários ao Worker | Média | Médio | No Lote B1, extrair primeiro `EmbeddingOperationEligibilityDecision` para módulo canónico antes de apagar o ficheiro shadow. |
| Reintrodução de silent fallbacks | Muito Baixa | Médio | Auditoria confirmou ausência de silent fallbacks nos caminhos canónicos. Todos os lotes serão validados por testes de tipo e execução. |

---

## 6. Conclusão e Próximos Passos

A auditoria **LINA-14F.4-A** conclui que:
1. Todo o código legado, shadow helpers, adapters transitórios e dead fallbacks estão perfeitamente mapeados e classificados;
2. O sistema de produção opera integralmente sobre a autoridade canónica (`EmbeddingLifecycleSnapshot`);
3. Não foram feitas alterações em ficheiros de código de produção nesta fase;
4. O plano de 6 lotes para **LINA-14F.4-B** oferece uma trajetória sem risco e com alta rastreabilidade.

A próxima fase autorizada para execução é **LINA-14F.4-B — Implementação Incremental da Remoção de Legado**.
