# LINA-14F.4-B3 — Relatório de Implementação: Remoção do Modelo Legado de Workflow State

**Data**: 2026-09-30  
**Fase**: LINA-14F.4-B3 (Embedding Lifecycle Consolidation)  
**Autor**: Arquiteto de Software Sénior & Engenheiro TypeScript  
**Auditoria Prévia**: `docs/audits/architecture/LINA-14F4-B3-AUDIT-WORKFLOW-STATE-REMOVAL-001.md`  
**Estado**: Concluído  

---

## 1. Resumo Executivo

A fase **LINA-14F.4-B3** eliminou definitivamente o último modelo paralelo de estado do ciclo de vida dos embeddings (`src/index/embeddingWorkflowState.ts`), consolidando o **`EmbeddingLifecycleSnapshot`** e a decisão operacional canónica **`deriveEmbeddingWritePathDecision()`** como **fonte única da verdade** em toda a arquitetura do Lina.

Todas as ocorrências de `EmbeddingWorkflowState`, `resolveEmbeddingWorkflowState`, `getEmbeddingWorkflowState()` e propriedades órfãs `workflowState` foram auditadas, migradas e removidas.

---

## 2. Inventário de Alterações Efetuadas

### 2.1. Ficheiros Removidos
1. `src/index/embeddingWorkflowState.ts` — Módulo legado com `EmbeddingWorkflowState`, `resolveEmbeddingWorkflowState`, `EmbeddingWorkflowPhase`, `EmbeddingWorkflowSourceState`, etc.
2. `tests/index/embeddingWorkflowState.test.ts` — Suíte de testes legada do modelo paralelo.

### 2.2. Código de Produção Atualizado
1. **`src/index/embeddingLifecycleAdapter.ts`**:
   - Removido import de `EmbeddingWorkflowState`.
   - Removido campo `workflowState` de `CurrentEmbeddingStateInputs`.
   - Removido fallback obsoleto `inputs.workflowState` na derivação de work assessment; agora consome diretamente `inputs.workAssessment`.

2. **`src/search/sidebarStatusViewModel.ts`**:
   - Removido import de `EmbeddingWorkflowState`.
   - Removido campo `workflow` de `SidebarStatusViewModel`.
   - Removido campo `workflowState` de `BuildSidebarStatusViewModelInput`.
   - Removido fallback baseado em `workflowState` ao construir o `lifecycleSnapshot` implícito; substituído por mapeamento direto a partir de `embeddingsWorkAvailable` para `workAssessment`.

3. **`src/search/linaSearchView.ts`**:
   - Removido import de `resolveEmbeddingWorkflowState`.
   - Removida computação de `workflowState` e passagem nos inputs de `adaptCurrentStateToLifecycleSnapshot` e `buildSidebarStatusViewModel`.
   - Botão contextual da sidebar derivado diretamente do estado canónico operacional do worker/work status controller e da prontidão do índice.

4. **`main.ts`**:
   - Removidos imports de `EmbeddingWorkflowState` e `resolveEmbeddingWorkflowState`.
   - Removido método público `getEmbeddingWorkflowState()`.
   - Removido campo `workflowState` de `getDeviceDiagnostics()`.
   - Atualizado `canDispatchAutomatically()` em `LinaPlugin` para utilizar a avaliação canónica de trabalho (`embeddingWorker.getEmbeddingWorkStatusController().getWorkAssessment()`).

### 2.3. Testes Atualizados
1. **`tests/search/sidebarEmbeddingWorkflowState.test.ts`**:
   - Removido import de `resolveEmbeddingWorkflowState`.
   - Testes de apresentação atualizados para validar o view model canónico (`SidebarStatusViewModel`) com inputs canónicos (`embeddingsWorkAvailable`, `semanticPreparing`, `semanticAvailable`, etc.).
2. **`tests/search/linaSearchViewHardening.test.ts`**:
   - Removido teste/asserção sobre `resolveEmbeddingWorkflowState`; atualizado para validar `adaptCurrentStateToLifecycleSnapshot`.
3. **`tests/index/embeddingLifecycleWritePath.test.ts`**:
   - Removido `resolveEmbeddingWorkflowState` e referência a `src/index/embeddingWorkflowState.ts` no teste de isolamento.
4. **`tests/search/sidebarStatusLifecycleSnapshot.test.ts`**:
   - Atualizados testes de cenário para passar `workAssessment` diretamente em vez de `workflowState`.
5. **`tests/search/embeddingStatusLifecycleSnapshot.test.ts`**:
   - Atualizados testes de cenário para passar `workAssessment` diretamente em vez de `workflowState`.
6. **`tests/index/embeddingLifecycleShadowValidation.test.ts`**:
   - Substituído `workflowState` por `workAssessment` em 4 testes de invariantes.
7. **`tests/index/embeddingLifecycleAdapter.test.ts`**:
   - Substituído `workflowState` por `workAssessment` em 2 testes de cenário.
8. **`tests/device/deviceDiagnosticsLifecycleSnapshot.test.ts`**:
   - Substituído `workflowState` por `workAssessment` no teste de cenário do produtor.

---

## 3. Impacto Arquitetural

| Aspeto | Antes (LINA-14F.4-B2) | Depois (LINA-14F.4-B3) |
|---|---|---|
| **Modelo de Estado de Ciclo de Vida** | Duplo (`EmbeddingLifecycleSnapshot` canónico + `EmbeddingWorkflowState` legado) | **Único (`EmbeddingLifecycleSnapshot`)** |
| **Decisão Operacional** | `deriveEmbeddingWritePathDecision()` com vestígios de `workflowState` | **`deriveEmbeddingWritePathDecision()` puro e soberano** |
| **Sidebar View Model** | Consumia snapshot com fallback para `workflowState` | **Consome estritamente `EmbeddingLifecycleSnapshot` / `workAssessment`** |
| **Diagnósticos** | Expunha `workflowState` | **Exclui representações paralelas legadas** |
| **Entropia e Duplicação** | 1 ficheiro paralelo (218 linhas) + 1 ficheiro de teste (220 linhas) | **0 ficheiros órfãos, 0 duplicação de regras** |

---

## 4. Validação e Quality Gates

Todos os quality gates foram executados e aprovados:

| Comando | Resultado | Detalhes |
|---|---|---|
| `npm test` | **APROVADO** | 139 ficheiros de teste, 1863 testes passaram (0 falhas) |
| `npm run typecheck` | **APROVADO** | Zero erros de tipagem TypeScript (`tsc --noEmit`) |
| `npm run lint:obsidian:strict` | **APROVADO** | Zero avisos / zero erros ESLint |
| `npm run build` | **APROVADO** | Build de produção com esbuild concluído |
| `npm run release-check` | **APROVADO** | Pronto para release Obsidian |
| `git diff --check` | **APROVADO** | Zero conflitos ou trailing whitespaces |

---

## 5. Conclusão

A fase **LINA-14F.4-B3** cumpriu integralmente o seu objetivo: o modelo legado `embeddingWorkflowState.ts` foi completamente erradicado e o `EmbeddingLifecycleSnapshot` é agora a única linguagem de estado do ciclo de vida dos embeddings no Lina.
