# Auditoria de Arquitetura: Shadow Infrastructure Removal Audit

**Fase:** LINA-14F.5  
**Data:** 2026-09-30  
**Status:** Aprovada  
**Documento:** `LINA-14F5-AUDIT-SHADOW-INFRASTRUCTURE-REMOVAL-001.md`  

---

## 1. Contexto e Objetivos

Após a consolidação completa do Lifecycle dos embeddings nas fases LINA-14F.4-B4.0 a B4.4, esta auditoria tem como finalidade examinar toda a infraestrutura temporária (shadows, comparadores, wrappers de transição e adaptadores) criada durante a migração para o modelo canónico:

$$\text{Estado Factual} \longrightarrow \text{EmbeddingLifecycleSnapshot} \longrightarrow \text{Decisão Canónica} \longrightarrow \text{Consumidores}$$

O objetivo é:
1. Identificar resíduos de código shadow, comparadores temporários e comentários obsoletos.
2. Classificar exaustivamente cada ocorrência pesquisada em **Manter**, **Migrar** ou **Remover**.
3. Auditar a necessidade e o papel de `embeddingLifecycleAdapter.ts`.
4. Definir o plano de limpeza e consolidação segura sem quebra de invariantes ou contratos.

---

## 2. Pesquisa e Classificação Obrigatória

### 2.1 "Shadow" e Comparadores de Transição
- **`evaluateLegacySchedulerDecision` / `compareSchedulerDecision` / `getEmbeddingWritePathShadowComparison`:**
  - *Estado:* Já removidos nas subfases B1 e B3.
  - *Classificação:* **Removido** (histórico).
- **Comentários de cabeçalho obsoletos:**
  - `src/maintenance/embeddingScheduler.ts:357` ("Scheduler Shadow Decision & Comparison Types").
  - `src/index/embeddingLifecycleAdapter.ts:2,5` ("Embedding Lifecycle Shadow Adapter", "performs shadow comparison").
  - *Classificação:* **Remover / Atualizar Comentário** para refletir a autoridade canónica atual.
- **Suítes de Teste com nome "Shadow":**
  - `tests/index/embeddingLifecycleShadowValidation.test.ts`: Matriz de 14 cenários do ciclo de vida que valida exaustivamente `validateLifecycleInvariants` e transições de estado.
  - `tests/maintenance/embeddingOperationLifecycleShadow.test.ts`: Valida invariantes do gestor de operações contra o ciclo de vida.
  - *Classificação:* **Manter** (atuam como testes essenciais de regressão e validação de invariantes do modelo canónico).

### 2.2 Comparadores de Domínio (`compare`, `comparison`)
- **`compareEmbeddingIdentity` (`src/index/embeddingLifecycleModel.ts`):**
  - *Função:* Compara identidades de embeddings (provider, model, dimensions, inputVersion, prefixMode) para determinar compatibilidade.
  - *Classificação:* **Manter** (lógica de domínio essencial).
- **`compareProvenanceEpoch` (`src/device/artifactProvenance.ts`):**
  - *Função:* Compara epochs de proveniência para sincronização multi-dispositivo.
  - *Classificação:* **Manter** (lógica de domínio essencial).
- **`comparePaths` (`src/index/automaticUpdateEvents.ts`):**
  - *Função:* Ordenação determinística de caminhos modificados.
  - *Classificação:* **Manter** (utilitário puro).
- **`compareEditorPositions` (`src/search/linaSearchView.ts`):**
  - *Função:* Comparação de posições de cursor no editor Obsidian.
  - *Classificação:* **Manter** (lógica de UI/UX).

### 2.3 Adaptadores (`adapter`, `embeddingLifecycleAdapter`)
- **`adaptCurrentStateToLifecycleSnapshot` (`src/index/embeddingLifecycleAdapter.ts`):**
  - *Função:* Transforma os dados factuais heterogéneos (TextIndex, DeviceRuntime, UpdatePlan, WorkAssessment, OperationState, CompanionState) no `EmbeddingLifecycleSnapshot` canónico.
  - *Consumidores:* `main.ts:buildEmbeddingWorkLifecycleSnapshot`, `embeddingWorkStatusController.ts:getLifecycleSnapshot`, `deviceRuntimeState.ts`, `deviceDiagnostics.ts`, `sidebarStatusViewModel.ts`, `embeddingStatusViewModel.ts`.
  - *Classificação:* **Manter**. Não é um comparador shadow, mas sim o transformador funcional canónico do runtime.
- **`toEmbeddingIdentitySummary` (`src/index/embeddingLifecycleAdapter.ts`):**
  - *Função:* Extrai `EmbeddingIdentitySummary` a partir de contratos ou identidades publicadas.
  - *Classificação:* **Manter**.
- **`SettingsRuntimeAdapters` e adaptadores em `src/settings/*`:**
  - *Função:* Infraestrutura declarativa desacoplada da settings tab.
  - *Classificação:* **Manter**.

### 2.4 Legado, Depreciação e Migrações (`legacy`, `deprecated`, `migration`)
- **`LegacyPureLocalProviderId` / `isLegacyPureLocalProviderId` (`src/settings/pureLocalSettingsModel.ts`):**
  - *Função:* Sanitiza valores legados persistidos sem os expor na UI.
  - *Classificação:* **Manter** (protege integridade de settings persistidas).
- **`SettingsMigrations` (`src/settings/settingsMigrations.ts`):**
  - *Função:* Migração sequencial idempotente de schema (v0 -> v1).
  - *Classificação:* **Manter** (compatibilidade com vaults existentes).
- **`legacy-manifest` (`src/settings/pureSettingsAsyncActions.ts`, renderers binários):**
  - *Função:* Impede operações perigosas sobre cópias binárias com manifestos antigos incompatíveis.
  - *Classificação:* **Manter** (guarda de segurança essencial).
- **`legacy-fallback` (`src/device/deviceRoleResolver.ts`):**
  - *Função:* Resolução segura de papéis em instalações pré-migração.
  - *Classificação:* **Manter**.
- **Getters de credenciais com aviso de depreciação em `src/settings.ts`:**
  - *Função:* Garante fallback seguro enquanto migra para `SecretStorage`.
  - *Classificação:* **Manter**.

### 2.5 Avaliadores Canónicos (`evaluateLegacy*`, `evaluate*FromSnapshot`)
- **`evaluateLegacy*`:** `0` ocorrências (**Removido**).
- **`evaluateSchedulerDecisionFromSnapshot` (`src/maintenance/embeddingScheduler.ts`):**
  - *Função:* Avalia elegibilidade de agendamento e auto-dispatch a partir do snapshot canónico.
  - *Classificação:* **Manter** (autoridade canónica do Scheduler).
- **`evaluateEmbeddingUpdatePolicyFromSnapshot` (`src/maintenance/embeddingPolicyEngine.ts`):**
  - *Função:* Avalia conformidade com políticas de autorização manual/automática a partir do snapshot.
  - *Classificação:* **Manter** (autoridade canónica de Política).
- **`evaluateOperationDecisionFromSnapshot` (`src/maintenance/embeddingWorker.ts`):**
  - *Função:* Avalia prontidão e guarda de execução do Worker a partir do snapshot.
  - *Classificação:* **Manter** (autoridade canónica do Worker).

---

## 3. Conclusões da Auditoria

1. **Estado da Infraestrutura Shadow:**
   - Todo o código executável de comparação shadow (`compareSchedulerDecision`, `evaluateLegacySchedulerDecision`, `getEmbeddingWritePathShadowComparison`) já foi completamente eliminado em fases anteriores.
   - Restam apenas comentários e descrições textuais que ainda usam o termo "Shadow" em `embeddingScheduler.ts` e `embeddingLifecycleAdapter.ts`.

2. **Papel de `embeddingLifecycleAdapter.ts`:**
   - O módulo não contém código morto nem duplica lógica: é o transformador puro factual que alimenta a cadeia canónica. Deve ser mantido e ter a sua documentação atualizada para remover menções a "Shadow".

3. **Plano de Implementação (LINA-14F.5):**
   - Atualizar a documentação e comentários de cabeçalho em `src/index/embeddingLifecycleAdapter.ts` e `src/maintenance/embeddingScheduler.ts` para refletir o seu papel puramente canónico.
   - Criar teste de invariante que confirme a ausência definitiva de funções shadow ou comparadores temporários em `src/`.
   - Executar todos os portões de validação.
