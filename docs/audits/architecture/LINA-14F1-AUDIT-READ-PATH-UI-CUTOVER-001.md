# LINA-14F.1: Auditoria de Cutover Ativo do Read Path e UI

**Documento:** `LINA-14F1-AUDIT-READ-PATH-UI-CUTOVER-001.md`  
**Fase:** LINA-14F.1 (Auditoria Prévia ao Cutover do Read Path e UI)  
**Data:** 2026-09-30  
**Estado:** Concluído / Aprovado para Implementação  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  

---

## 1. Contexto e Âmbito da Fase

Na sequência da aprovação global da auditoria **LINA-14E** ([`LINA-14E-AUDIT-LIFECYCLE-CONSOLIDATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14E-AUDIT-LIFECYCLE-CONSOLIDATION-001.md)), a presente sub-fase **LINA-14F.1** inicia a execução do plano de cutover formal.

### Objetivo:
Eliminar os caminhos de fallback legados e tornar o [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts) a **fonte de verdade obrigatória e primária** em todos os consumidores do Read Path e apresentação de UI:
1. **Sidebar View Model** (`src/search/sidebarStatusViewModel.ts`);
2. **Embedding Status View Model** (`src/search/embeddingStatusViewModel.ts`);
3. **Diagnósticos de Dispositivo** (`src/device/deviceDiagnostics.ts` e `src/device/deviceDiagnosticsModal.ts`);
4. **Avaliação de Capacidade Semântica** (`src/search/semanticCapability.ts`);
5. **Runtime de Dispositivo** (`src/device/deviceRuntimeState.ts`);
6. Pontos de composição em `src/search/linaSearchView.ts` e `main.ts`.

---

## 2. Mapeamento de Fallbacks Legados Ativos

A auditoria ao código fonte identificou os seguintes fallbacks legados ainda operacionais que devem ser eliminados:

### 2.1 `src/search/sidebarStatusViewModel.ts`
- **Contrato Atual:** `BuildSidebarStatusViewModelInput.lifecycleSnapshot` é marcado como opcional (`lifecycleSnapshot?: EmbeddingLifecycleSnapshot`).
- **Fallbacks Ativos:**
  - `embeddingsStatus` (linhas 377-401): Cascata de mais de 25 linhas com fallbacks para `isOperational`, `runtimeEmbeddings?.contractState`, `companionState?.embeddingState`, `embeddingsWorkAvailable`, `companionState?.embeddingFreshness`, `runtimeEmbeddings?.exists` e `embeddingsReady`.
  - `hybridMode` (linha 431): Fallback triplo `(lifecycleSnapshot?.read.effectiveMode ?? (runtimeEmbeddings?.effectiveMode ?? (semanticAvailable ? "full" : "text-only")))`.
  - `degradedAlert` (linhas 497-507): Fallback para `companionState?.vectorContractCompatibility` e `runtimeEmbeddings?.contractState` em vez de consultar diretamente `lifecycleSnapshot.read.compatibility`.
  - `canExecuteMaintenance` (linha 540): Fallback para `roleKey === "active-producer"`.

### 2.2 `src/search/embeddingStatusViewModel.ts`
- **Contrato Atual:** `BuildEmbeddingStatusViewModelInput.lifecycleSnapshot` é opcional.
- **Fallbacks Ativos:**
  - `getRuntimeLabel` (linhas 82-88): Ramificações baseadas em `workState.status` legado (`"unknown"`, `"dirty"`, `"calculating"`, `"ready"`, `"error"`).
  - `getHeadline` (linhas 120-132): Ramificações baseadas em `workState.summary?.updatePlan?.mode`, `workState.summary?.detailsAvailable` e `workState.workAvailable`.
  - `buildActions` (linhas 164-199): Ramificações que avaliam `workState.summary?.updatePlan?.mode`, `workState.summary?.detailsAvailable` e `workState.workAvailable` diretamente.
  - `guidance` (linhas 259-265): Fallbacks para `plan?.mode` e `workState.workAvailable`.

### 2.3 `src/search/semanticCapability.ts`
- **Contrato Atual:** `EvaluateSemanticCapabilityInput.lifecycleSnapshot` é opcional (`lifecycleSnapshot?: EmbeddingLifecycleSnapshot | null`).
- **Fallbacks Ativos:**
  - `evaluateSemanticCapability` (linhas 180-284): Quando `lifecycleSnapshot` não está presente, executa um bloco legado de 100 linhas que recalcula `vectorFile`, `runtimeState`, `reasonCode`, `semanticAvailable` e `effectiveMode` a partir de `embeddingsDeclaredInManifest`, `vectorContractState` e `semanticCompatibility`.

### 2.4 `src/device/deviceDiagnostics.ts` & `src/device/deviceDiagnosticsModal.ts`
- **Contrato Atual:** `BuildDeviceDiagnosticsInput.lifecycleSnapshot` e `ReadDeviceDiagnosticsOptions.lifecycleSnapshot` são opcionais.
- **Fallbacks Ativos:**
  - `deviceDiagnostics.ts` (linhas 377-425): Se `lifecycleSnapshot` não for fornecido, `textIndexAvailable`, `embeddingsDeclared`, `operationalSemanticAvailable` e `operationalMode` recorrem a `companionState.artifactAvailability`, `companionState.canConsume`, etc.
  - `deviceDiagnosticsModal.ts` (linhas 251-260 e 280-288): Código de renderização mantém escadas de fallback: `snapshot ? ... : (runtimeEmbeddings ? ... : companionSearch.mode)`.

---

## 3. Riscos do Cutover e Estratégia de Mitigação

| Risco | Impacto | Probabilidade | Mitigação |
|---|---|---|---|
| **Chamada a view model sem snapshot em runtime** | Médio | Nula | `linaSearchView.ts` e `main.ts` já produzem o snapshot canónico em todos os fluxos de abertura e refresh. Tornar o snapshot obrigatório no TypeScript garante verificação em tempo de compilação. |
| **Quebra de testes unitários existentes** | Médio | Média | Testes unitários legados que criavam mocks sem snapshot serão atualizados para fornecer o snapshot canónico ou usar o adapter `adaptCurrentStateToLifecycleSnapshot`. |
| **Divergência em nós Companion** | Alto | Nula | O snapshot canónico já garante `write.applicable = false` e `primary = READY / UPDATE_AVAILABLE / INCOMPATIBLE` sem induzir ações de escrita. |
| **Aumento de complexidade de callers** | Baixo | Baixa | A construção do snapshot é centralizada e suportada pelo adapter em memória de custo desprezível (< 0.5ms). |

---

## 4. Testes Afetados e Plano de Cobertura

### 4.1 Testes a Atualizar para Snapshot Obrigatório:
- `tests/search/sidebarStatusUX.test.ts`: Atualizar os fixtures de teste para incluírem o `lifecycleSnapshot` correspondente ao cenário pretendido.
- `tests/search/embeddingStatusViewModel.test.ts`: Atualizar fixtures com `lifecycleSnapshot`.
- `tests/device/deviceDiagnostics.test.ts`: Garantir que `lifecycleSnapshot` é fornecido nos testes de diagnósticos.

### 4.2 Suites Canónicas Dedicadas a Manter Verdes:
- `tests/search/sidebarStatusLifecycleSnapshot.test.ts` (7 testes canónicos);
- `tests/search/embeddingStatusLifecycleSnapshot.test.ts` (7 testes canónicos);
- `tests/search/semanticCapabilityLifecycleSnapshot.test.ts` (10 testes canónicos);
- `tests/device/deviceDiagnosticsLifecycleSnapshot.test.ts` (9 testes canónicos);
- `tests/device/deviceDiagnostics.test.ts` (16 testes).

### 4.3 Novos Testes de Regressão a Adicionar:
- Adicionar guardas de regressão comprovando que os view models e avaliadores de capacidade não possuem fallbacks silenciosos e rejeitam/não utilizam flags legadas quando o snapshot determina o estado.

---

## 5. Plano de Execução da Implementação

1. **Passo 1 (Semantic Capability):**
   - Tornar `lifecycleSnapshot` obrigatório em `EvaluateSemanticCapabilityInput` (ou fornecido como argumento principal em `evaluateSemanticCapability`).
   - Eliminar a implementação de fallback legado em `evaluateSemanticCapability` em favor de `evaluateSemanticCapabilityFromSnapshot`.
2. **Passo 2 (Sidebar Status View Model):**
   - Tornar `lifecycleSnapshot` obrigatório em `BuildSidebarStatusViewModelInput`.
   - Remover as ramificações legadas de `embeddingsStatus`, `hybridMode`, `degradedAlert` e `canExecuteMaintenance`.
3. **Passo 3 (Embedding Status View Model):**
   - Tornar `lifecycleSnapshot` obrigatório em `BuildEmbeddingStatusViewModelInput`.
   - Eliminar ramificações legadas em `getRuntimeLabel`, `getHeadline`, `buildActions` e `guidance`.
4. **Passo 4 (Device Diagnostics & Modal):**
   - Tornar `lifecycleSnapshot` obrigatório em `BuildDeviceDiagnosticsInput`.
   - Limpar fallbacks na secção `companionSearch` e na renderização do modal `deviceDiagnosticsModal.ts`.
5. **Passo 5 (Atualização de Testes & Validação Global):**
   - Atualizar chamadas em testes unitários.
   - Executar suíte completa: `npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check`.
