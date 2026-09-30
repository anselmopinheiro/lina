# LINA-14F.4-B1 — Implementação da Remoção da Infraestrutura Shadow Mode e Normalização dos Tipos Operacionais Canónicos

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B1  
**Estado:** Concluído com Sucesso  
**Autoridade:** `AGENTS.md`, `docs/audits/architecture/LINA-14F4-AUDIT-LEGACY-REMOVAL-001.md`, `docs/audits/architecture/LINA-14F4B1-AUDIT-SHADOW-INFRASTRUCTURE-REMOVAL-001.md`

---

## 1. Sumário Executivo

O lote **LINA-14F.4-B1** executou a eliminação completa e segura da infraestrutura de *Shadow Mode* (comparadores legados vs canónicos, tipos e estruturas de divergência/diferença e avaliadores de réplica legada) no subsistema de embeddings do Lina.

Todos os tipos e funções operacionais canónicas anteriormente alojados em módulos shadow foram normalizados e extraídos para módulos operacionais de produção (`src/maintenance/embeddingWorker.ts`).

Nenhuma semântica operacional, autoridade de decisão, política, agendamento ou contrato público foi alterado. Todos os quality gates de produção e testes unitários/integrados passaram com 100% de sucesso.

---

## 2. Inventário de Alterações em Produção

### 2.1. Símbolos e Módulos Removidos

1. **`src/maintenance/embeddingOperationLifecycleShadow.ts`** (Ficheiro removido integralmente via `git rm`):
   - Módulo que continha o comparador shadow de operações e a definição provisória de decisão de elegibilidade.
   - Símbolos eliminados: `OperationShadowEligibilityDecision` (renomeado/extraído para `EmbeddingOperationEligibilityDecision`), `evaluateLegacyOperationEligibility`, `compareOperationEligibilityDecision`, `OperationEligibilityComparisonResult`, `OperationEligibilityDifference*`.

2. **`src/index/embeddingLifecycleAdapter.ts`**:
   - `ShadowDifferenceSeverity`
   - `EmbeddingLifecycleDifference`
   - `LegacyStateSummary`
   - `EmbeddingLifecycleShadowResult`
   - `compareLegacyWithLifecycleSnapshot()`
   - `createEmbeddingLifecycleShadowComparison()`
   - `mapPrimaryToWorkflowStatus()` (helper interno puramente shadow)

3. **`src/index/embeddingLifecycleWritePath.ts`**:
   - `EmbeddingWritePathShadowInputs`
   - `LegacyWritePathSummary`
   - `summarizeLegacyWritePath()`
   - `EmbeddingWritePathDifferenceArea`
   - `EmbeddingWritePathDifferenceSeverity`
   - `EmbeddingWritePathDifference`
   - `EmbeddingWritePathShadowResult`
   - `compareLegacyWritePathWithLifecycle()`
   - `createEmbeddingWritePathShadowComparison()`
   - `expectedLegacyProcessPhase()`, `planMatchesCanonicalKind()`, `pushDifference()` (helpers puramente shadow)

4. **`src/maintenance/embeddingPolicyEngine.ts`**:
   - `PolicyEngineComparisonResult`
   - `comparePolicyEngineDecision()`

5. **`src/maintenance/embeddingScheduler.ts`**:
   - `LegacySchedulerDecisionInputs`
   - `SchedulerDifferenceArea`
   - `SchedulerDifferenceSeverity`
   - `SchedulerDifference`
   - `SchedulerComparisonResult`
   - `evaluateLegacySchedulerDecision()`
   - `compareSchedulerDecision()`

6. **`main.ts`**:
   - `getEmbeddingWritePathShadowComparison()`
   - Imports de comparação shadow de `embeddingLifecycleWritePath`.

---

### 2.2. Tipos Operacionais Canónicos Extraídos e Normalizados

- **`EmbeddingOperationEligibilityDecision`**: Extraído de `embeddingOperationLifecycleShadow.ts` para `src/maintenance/embeddingWorker.ts`.
- **`evaluateOperationDecisionFromSnapshot(snapshot: EmbeddingLifecycleSnapshot): EmbeddingOperationEligibilityDecision`**: Extraído como função pura exportada em `src/maintenance/embeddingWorker.ts`.
- **`EmbeddingWorker.evaluateCanonicalDecision()`**: Atualizado para invocar diretamente `evaluateOperationDecisionFromSnapshot(snapshot)`.

---

### 2.3. Símbolos Preservados (Lotes Posteriores)

Conforme estipulado no plano LINA-14F.4-A:
- **Lote B2 (Adapters de Compatibilidade):**
  - `hasEmbeddingWorkAvailable()` (em `src/index/embeddingWorkflowState.ts`)
  - `evaluateEmbeddingUpdatePolicy()` wrapper (em `src/maintenance/embeddingPolicyEngine.ts`)
- **Lote B3 (Workflow State & Campos Órfãos):**
  - `src/index/embeddingWorkflowState.ts` e `getEmbeddingWorkflowState()` em `main.ts`
  - Campos legados de `SidebarStatusViewModel`
- **Lote B4 (Wiring & DI do Scheduler):**
  - Assinatura de `EmbeddingScheduler` e injeção em `main.ts`

---

## 3. Migração e Atualização da Suíte de Testes

Os testes que validavam exclusivamente comparadores eliminados foram adaptados para validar a autoridade canónica diretamente:

1. **`tests/maintenance/embeddingOperationLifecycleShadow.test.ts`**:
   - Convertido para validar diretamente `evaluateOperationDecisionFromSnapshot` importado de `embeddingWorker.ts` em todos os 13 cenários canónicos (READY, UPDATE_AVAILABLE, INDEX_ONLY, INCOMPATIBLE, ERROR, Companion, Standby, INDETERMINATE, UPDATING, CANCELLING, Retry, Perda de Ownership, Proteção Atómica).

2. **`tests/maintenance/embeddingOperationLifecycleCutover.test.ts`**:
   - Removidos imports de comparadores shadow; asserções atualizadas para a autoridade canónica `EmbeddingWorker`.

3. **`tests/maintenance/embeddingPolicyEngineLifecycle.test.ts`**:
   - Convertido de teste de comparador para teste canónico de `evaluateEmbeddingUpdatePolicyFromSnapshot`.

4. **`tests/maintenance/embeddingSchedulerLifecycle.test.ts`**:
   - Convertido de teste de comparador para teste canónico de `evaluateSchedulerDecisionFromSnapshot`.

5. **`tests/index/embeddingLifecycleAdapter.test.ts`**:
   - Removido Describe 8 (teste exclusivo de `compareLegacyWithLifecycleSnapshot`). Preservados todos os 7 describes canónicos.

6. **`tests/index/embeddingLifecycleShadowValidation.test.ts`**:
   - Adaptado para validar snapshots canónicos gerados por `adaptCurrentStateToLifecycleSnapshot` em todas as 10 famílias de cenários.

7. **`tests/index/embeddingLifecycleWritePath.test.ts`**:
   - Helper de teste simplificado para derivar canonical `snapshot` e `decision` via `adaptCurrentStateToLifecycleSnapshot` + `deriveEmbeddingWritePathDecision`.
   - Removido Describe 11 (divergências legadas artificiais).

---

## 4. Validação e Quality Gates

Todos os quality gates foram executados e validados:

```bash
npm test                      # 140 test files passed (1873 tests passed, 0 failed)
npm run typecheck             # 0 TypeScript errors
npm run lint:obsidian:strict  # 0 ESLint errors, 0 warnings
npm run build                 # Production build and bundle verified
npm run release-check         # Release validation passed
git diff --check              # 0 whitespace / formatting issues
```

---

## 5. Rastreabilidade e Próximos Passos

- **Lote B1 concluído:** A infraestrutura de *Shadow Mode* foi completamente extirpada sem resíduos operacionais.
- **Próximo Lote:** **LINA-14F.4-B2 — Remoção dos adapters de compatibilidade** (`hasEmbeddingWorkAvailable`, `evaluateEmbeddingUpdatePolicy` wrapper).
