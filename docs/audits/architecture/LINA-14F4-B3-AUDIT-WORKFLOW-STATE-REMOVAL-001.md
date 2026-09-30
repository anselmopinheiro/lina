# LINA-14F.4-B3 — Auditoria de Remoção do Modelo Legado de Workflow State

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B3  
**Estado:** Aprovado para Implementação  
**Autoridade:** `AGENTS.md`, `docs/audits/architecture/LINA-14F4-AUDIT-LEGACY-REMOVAL-001.md`

---

## 1. Contexto e Objetivo

No âmbito da consolidação do ciclo de vida dos embeddings (**LINA-14**), a auditoria global LINA-14F.4-A identificou `embeddingWorkflowState.ts` como o último modelo paralelo de estado do Write Path residual no projeto.

Com a conclusão dos lotes:
- **LINA-14F.1:** Cutover do Read Path e UI;
- **LINA-14F.2:** Cutover do Write Path (Controller, Policy Engine e Scheduler);
- **LINA-14F.3:** Cutover do Worker e Operation Manager;
- **LINA-14F.4-B1:** Remoção da infraestrutura de Shadow Mode;
- **LINA-14F.4-B2:** Remoção de adapters de compatibilidade (`hasEmbeddingWorkAvailable`, `evaluateEmbeddingUpdatePolicy`).

O pipeline canónico:

```text
Estado Factual (Settings, Discos, Chunks, Identidades, Ownership)
      ↓
EmbeddingLifecycleSnapshot
      ↓
deriveEmbeddingWritePathDecision() / evaluateEmbeddingUpdatePolicyFromSnapshot()
      ↓
Consumidores Ativos (UI, Scheduler, Workers, Diagnostics)
```

é agora a **fonte única e absoluta de verdade**. O modelo `EmbeddingWorkflowState` é redundante, cria duplicação de conceitos e mantém campos órfãos em runtime.

O objetivo do lote **LINA-14F.4-B3** é:
1. Eliminar `src/index/embeddingWorkflowState.ts`;
2. Eliminar o método `getEmbeddingWorkflowState()` de `main.ts`;
3. Eliminar todas as chamadas a `resolveEmbeddingWorkflowState()` em `src/search/linaSearchView.ts`, `main.ts` e adapters;
4. Eliminar os campos inertes `workflow` e `workflowState` em `src/search/sidebarStatusViewModel.ts` e `src/index/embeddingLifecycleAdapter.ts`;
5. Atualizar os testes de UI da Sidebar (`tests/search/sidebarEmbeddingWorkflowState.test.ts` e `tests/search/linaSearchViewHardening.test.ts`) para utilizarem o snapshot canónico;
6. Eliminar o ficheiro de testes obsoleto `tests/index/embeddingWorkflowState.test.ts`.

---

## 2. Inventário Exaustivo de Ocorrências e Dependências

### 2.1. Definição do Ficheiro Legado
- **Ficheiro:** `src/index/embeddingWorkflowState.ts` (~85 linhas)
- **Tipos Exportados:**
  - `EmbeddingWorkflowStatus`: `"idle" | "checking" | "update-required" | "preparing" | "generating" | "persisting" | "finalizing" | "error" | "cancelled"`
  - `EmbeddingWorkflowState`: `{ status, operationRunning, canUpdate, workAvailable, error? }`
  - `ResolveEmbeddingWorkflowStateInput`: `{ workState, operationState, binaryMaintenancePhase, isAuthorizedProducer, textIndexReady }`
- **Funções Exportadas:**
  - `resolveEmbeddingWorkflowState(input: ResolveEmbeddingWorkflowStateInput): EmbeddingWorkflowState`
- **Classificação:** Código morto / legado a eliminar.

---

### 2.2. Ocorrências em Produção

| Localização | Símbolo / Campo | Classificação | Ação de Migração |
|---|---|---|---|
| `main.ts:144` | `import { resolveEmbeddingWorkflowState, ... }` | Import legado | Remover import. |
| `main.ts:873-882` | `getEmbeddingWorkflowState(options)` | Método legado sem consumidores externos | Remover método. |
| `main.ts:996, 1002` | Chamada em `getDeviceDiagnostics()` | Fallback redundante | Remover `workflowState` da chamada a `adaptCurrentStateToLifecycleSnapshot`. |
| `main.ts:1508` | Campo `workflowState` em `canDispatchAutomatically` | Adapter temporário B2 | Substituir por `workAssessment` canónico no snapshot. |
| `src/search/linaSearchView.ts:18` | `import { resolveEmbeddingWorkflowState }` | Import legado | Remover import. |
| `src/search/linaSearchView.ts:2681-2687` | Chamada a `resolveEmbeddingWorkflowState` em `refreshState` | Duplicação de estado | Eliminar chamada. A Sidebar já constrói e consome `lifecycleSnapshot`. |
| `src/search/linaSearchView.ts:2716, 2740` | `workflowState` passado a `adaptCurrentStateToLifecycleSnapshot` e `buildSidebarStatusViewModel` | Passagem inerte | Remover parâmetros. |
| `src/search/sidebarStatusViewModel.ts:21` | `import { EmbeddingWorkflowState }` | Import legado | Remover import. |
| `src/search/sidebarStatusViewModel.ts:86` | `readonly workflow?: EmbeddingWorkflowState` em `SidebarStatusViewModel` | Campo inerte de visualização | Remover campo. |
| `src/search/sidebarStatusViewModel.ts:111` | `readonly workflowState?: EmbeddingWorkflowState` em `BuildSidebarStatusViewModelInput` | Input legado | Remover input. |
| `src/search/sidebarStatusViewModel.ts:263-270, 611` | Fallback de `workflowState` | Código morto | Remover fallback e retorno `workflow`. |
| `src/index/embeddingLifecycleAdapter.ts:21` | `import { EmbeddingWorkflowState }` | Import legado | Remover import. |
| `src/index/embeddingLifecycleAdapter.ts:37` | `readonly workflowState?: EmbeddingWorkflowState \| null` em `CurrentEmbeddingStateInputs` | Input legado | Remover input. |
| `src/index/embeddingLifecycleAdapter.ts:153-162` | Bloco `else if (inputs.workflowState)` | Fallback legado | Remover bloco; `adaptCurrentStateToLifecycleSnapshot` recebe `workAssessment` ou `updatePlan`. |

---

### 2.3. Ocorrências em Testes

| Ficheiro de Teste | Natureza da Dependência | Ação de Migração |
|---|---|---|
| `tests/index/embeddingWorkflowState.test.ts` | Testes unitários do módulo legado | **Remover ficheiro** (módulo deixa de existir). |
| `tests/search/sidebarEmbeddingWorkflowState.test.ts` | Testes de apresentação da Sidebar baseados no helper legado | Migrar helpers para instanciar `lifecycleSnapshot` diretamente (ou via `adaptCurrentStateToLifecycleSnapshot`), validando o comportamento de visualização da Sidebar. |
| `tests/search/linaSearchViewHardening.test.ts:54` | Asserção de string textual sobre `linaSearchView.ts` (`expect(text).toContain("const workflowState = resolveEmbeddingWorkflowState(");`) | Atualizar asserção para verificar o lifecycle snapshot canónico. |
| `tests/index/embeddingLifecycleWritePath.test.ts:16, 152` | Import e chamada auxiliar em `shadow(...)` | Remover chamada e import. |

---

## 3. Análise de Risco e Invariantes

| Risco | Severidade | Probabilidade | Mitigação |
|---|---|---|---|
| Quebra de visualização na Sidebar | Média | Baixa | A Sidebar já deriva toda a sua lógica de visualização (títulos, frescura, alertas degradados e botão de ação) a partir de `lifecycleSnapshot` desde LINA-14F.1. |
| Regressão em `getDeviceDiagnostics` | Baixa | Nula | `getDeviceDiagnostics` passa `deviceRuntimeState`, `operationState`, `companionState`, `vectorContract` e obtém um `lifecycleSnapshot` completo. |
| Incompatibilidade de tipos em `main.ts` | Baixa | Nula | `npm run typecheck` valida exaustivamente todas as assinaturas. |

---

## 4. Plano de Implementação

1. **Atualizar `src/index/embeddingLifecycleAdapter.ts`**:
   - Remover import e campo `workflowState` em `CurrentEmbeddingStateInputs`.
   - Remover o bloco de fallback `inputs.workflowState`.

2. **Atualizar `src/search/sidebarStatusViewModel.ts`**:
   - Remover import `EmbeddingWorkflowState`.
   - Remover campo `workflow` de `SidebarStatusViewModel` e `workflowState` de `BuildSidebarStatusViewModelInput`.
   - Limpar mapeamento em `buildSidebarStatusViewModel`.

3. **Atualizar `src/search/linaSearchView.ts`**:
   - Remover import `resolveEmbeddingWorkflowState`.
   - Remover instanciação e passagem de `workflowState`.

4. **Atualizar `main.ts`**:
   - Remover import `EmbeddingWorkflowState` / `resolveEmbeddingWorkflowState`.
   - Remover método `getEmbeddingWorkflowState()`.
   - Atualizar `getDeviceDiagnostics()` e `canDispatchAutomatically()`.

5. **Remover `src/index/embeddingWorkflowState.ts`**:
   - Eliminar o ficheiro.

6. **Migrar e Atualizar Testes**:
   - Eliminar `tests/index/embeddingWorkflowState.test.ts`.
   - Atualizar `tests/search/sidebarEmbeddingWorkflowState.test.ts`.
   - Atualizar `tests/search/linaSearchViewHardening.test.ts`.
   - Atualizar `tests/index/embeddingLifecycleWritePath.test.ts`.

7. **Executar Quality Gates Completos**:
   - `npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check`.
