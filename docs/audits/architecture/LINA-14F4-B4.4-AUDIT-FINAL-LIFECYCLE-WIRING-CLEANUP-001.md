# Auditoria de Arquitetura: Final Lifecycle Wiring Cleanup & Hardening

**Fase:** LINA-14F.4-B4.4  
**Data:** 2026-09-30  
**Status:** Aprovada  
**Documento:** `LINA-14F4-B4.4-AUDIT-FINAL-LIFECYCLE-WIRING-CLEANUP-001.md`  

---

## 1. Contexto e Objetivos

Esta auditoria constitui a etapa final do lote **LINA-14F.4-B4 (Runtime Wiring Simplification)**, cujo objetivo é:
1. Verificar a consolidação definitiva do ciclo de vida canónico dos embeddings:
   $$\text{Estado Factual} \longrightarrow \text{EmbeddingLifecycleSnapshot} \longrightarrow \text{deriveEmbeddingWritePathDecision()} \longrightarrow \text{Consumidores}$$
2. Identificar e classificar todas as ocorrências de termos-chave e potenciais resíduos de arquiteturas legadas.
3. Auditar especificamente os ViewModels prioritários (`sidebarStatusViewModel.ts` e `embeddingStatusViewModel.ts`).
4. Assegurar que nenhum componente ou consumidor reconstrói estado ad-hoc ou duplica regras de decisão operacional.

---

## 2. Pesquisa Obrigatória e Classificação de Ocorrências

Conforme exigido pelo mandato LINA-14F.4-B4.4, foi efetuada uma pesquisa exaustiva no código-fonte (`src/`, `main.ts` e `tests/`).

### 2.1 `EmbeddingWorkflowState` / `workflowState` / `resolveEmbeddingWorkflowState`
- **Ocorrências em `src/` e `main.ts`:** `0` (Zero).
- **Ocorrências em `tests/`:** `0` (Zero).
- **Ocorrências em `docs/`:** Apenas registos históricos de auditorias passadas.
- **Classificação:** **Legado Removido** (concluído com sucesso na Fase LINA-14F.4-B3).

### 2.2 `adaptCurrentStateToLifecycleSnapshot`
- **`src/index/embeddingLifecycleAdapter.ts`:** Declaração da função adaptadora pura canónica.
  - *Classificação:* **Produção Necessária**.
- **`src/index/embeddingWorkStatusController.ts`:** Utilizado em `getLifecycleSnapshot()` para projetar o estado factual do controlador no snapshot canónico.
  - *Classificação:* **Produção Necessária**.
- **`src/device/deviceRuntimeState.ts` / `src/device/deviceDiagnostics.ts`:** Utilizado para derivar snapshots diagnósticos a partir do estado do dispositivo quando não injetado.
  - *Classificação:* **Produção Necessária**.
- **`src/search/sidebarStatusViewModel.ts` / `src/search/embeddingStatusViewModel.ts` / `src/search/semanticCapability.ts`:** Fallback seguro quando o snapshot opcional não é injetado diretamente (ex: testes unitários isolados ou chamadas sem wiring completo).
  - *Classificação:* **Compatibilidade Temporária / Produção Segura**.
- **`tests/*`:** Utilizado para criar fixtures de teste determinísticas.
  - *Classificação:* **Teste**.

### 2.3 `lifecycleSnapshot`
- **`src/index/embeddingLifecycleModel.ts`:** Definição do tipo central `EmbeddingLifecycleSnapshot`.
  - *Classificação:* **Produção Necessária**.
- **`src/index/embeddingLifecycleWritePath.ts`:** Motor de decisão `deriveEmbeddingWritePathDecision(snapshot)`.
  - *Classificação:* **Produção Necessária**.
- **`src/maintenance/embeddingScheduler.ts`:** Gate de despacho automático consultando o snapshot canónico.
  - *Classificação:* **Produção Necessária**.
- **`src/maintenance/embeddingWorker.ts`:** Validação pré-execução física contra snapshot canónico.
  - *Classificação:* **Produção Necessária**.
- **`src/maintenance/embeddingOperationManager.ts`:** Validação de arranque de operação contra o Write Path do snapshot.
  - *Classificação:* **Produção Necessária**.
- **`src/maintenance/embeddingPolicyEngine.ts`:** Avaliação de prontidão e políticas baseada no snapshot.
  - *Classificação:* **Produção Necessária**.
- **`src/search/linaSearchView.ts`:** Obtém snapshot canónico via `this.plugin.getEmbeddingLifecycleSnapshot()` e injeta nos ViewModels.
  - *Classificação:* **Produção Necessária**.
- **`main.ts`:** Orquestrador principal que centraliza a derivação factual via `buildEmbeddingWorkLifecycleSnapshot(...)`.
  - *Classificação:* **Produção Necessária**.

### 2.4 `decision` / `deriveEmbeddingWritePathDecision`
- Todos os consumidores que decidem ações (`embeddingWorker`, `embeddingScheduler`, `embeddingPolicyEngine`, `embeddingWorkStatusController`, `embeddingStatusViewModel`) utilizam estritamente `deriveEmbeddingWritePathDecision(snapshot)`.
- *Classificação:* **Produção Necessária**.

### 2.5 `hasEmbeddingWork`
- **`src/maintenance/embeddingScheduler.ts`:** Porta de injeção de dependência na interface `EmbeddingSchedulerOptions`.
- **`main.ts`:** Injeção canónica delegando em `this.hasAutomaticEmbeddingWork()`, que consome `buildEmbeddingWorkLifecycleSnapshot(...)`.
- *Classificação:* **Produção Necessária**.

### 2.6 `updateAvailable` / `isReady`
- **Ocorrências de heurísticas legadas ad-hoc em `src/`:** `0` (Zero).
- A verificação de prontidão e necessidade de atualização baseia-se exclusivamente em `lifecycleSnapshot.primary === "UPDATE_AVAILABLE"` / `lifecycleSnapshot.write.updateRequired` e `lifecycleSnapshot.primary === "READY"`.
- *Classificação:* **Produção Necessária**.

### 2.7 `full-rebuild`
- Utilizado como identificador de modo nos contratos `EmbeddingUpdateMode`, `EmbeddingWorkExecutionMode`, no Write Path e no mapeamento de UI / confirmação modal em `embeddingStatusViewModel.ts`.
- *Classificação:* **Produção Necessária**.

---

## 3. Auditoria Detalhada dos ViewModels Prioritários

### 3.1 `src/search/sidebarStatusViewModel.ts`
- **Entrada:** `BuildSidebarStatusViewModelInput` aceita `lifecycleSnapshot?: EmbeddingLifecycleSnapshot`.
- **No Runtime:** `linaSearchView.ts` obtém `this.plugin.getEmbeddingLifecycleSnapshot()` e passa-o explicitamente como `lifecycleSnapshot`.
- **Fallback:** Se omitido (em testes legados de apresentação), usa `adaptCurrentStateToLifecycleSnapshot` com valores coerentes.
- **Derivações:**
  - `hybridMode`: Extraído diretamente de `lifecycleSnapshot.read.effectiveMode`.
  - `canExecuteMaintenance`: Avalia `roleKey === "active-producer" && lifecycleSnapshot.write.applicable`.
  - Degraded Alerts: Avalia prioritariamente `lifecycleSnapshot.primary === "INCOMPATIBLE"` e `lifecycleSnapshot.read.compatibility.status === "incompatible"`.
- **Conclusão:** Totalmente alinhado com a cadeia canónica; sem decisões paralelas de escrita.

### 3.2 `src/search/embeddingStatusViewModel.ts`
- **Entrada:** `BuildEmbeddingStatusViewModelInput` aceita `lifecycleSnapshot?: EmbeddingLifecycleSnapshot`.
- **Ações de UI (`buildActions`):**
  - Invoca `const decision = deriveEmbeddingWritePathDecision(lifecycleSnapshot)`.
  - Mapeia a ação canónica através de `mapDecisionToUiAction(decision)`.
  - Não reconstrói regras de negócio nem calcula divergências locais.
- **Linhas de Diagnóstico:** Consomem `lifecycleSnapshot.write.work.counts`, `lifecycleSnapshot.read.compatibility` e `lifecycleSnapshot.info`.
- **Conclusão:** Totalmente alinhado com a cadeia canónica; zero duplicação de regras.

---

## 4. Estado da Cadeia Canónica

```
┌─────────────────────────────────────────────────────────┐
│                     ESTADO FACTUAL                      │
│ (TextIndex, Embeddings State, Device Role, Companion)   │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│               EmbeddingLifecycleSnapshot                │
│    (Primary Status, Read Mode, Write Work, Capability)  │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│           deriveEmbeddingWritePathDecision()            │
│   (Action, WorkMode, CanExecute, Gating, Reasons)       │
└────────────────────────────┬────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌───────────────────────┐         ┌───────────────────────┐
│      EXECUTORES       │         │       VIEWMODELS      │
│  - EmbeddingScheduler │         │  - SidebarStatusVM    │
│  - EmbeddingWorker    │         │  - EmbeddingStatusVM  │
│  - OperationManager   │         │  - LinaSearchView     │
└───────────────────────┘         └───────────────────────┘
```

Todos os consumidores convergem para a mesma origem de dados e a mesma função pura de decisão.

---

## 5. Plano de Hardening e Testes

1. Criar suíte de testes de consolidação e hardening: `tests/maintenance/finalLifecycleWiringHardening.test.ts`.
2. Validar que:
   - Nenhuma referência a modelos legados (`EmbeddingWorkflowState`) existe em `src/` ou `main.ts`.
   - Todos os componentes de runtime e UI utilizam o `EmbeddingLifecycleSnapshot` canónico.
   - A decisão derivada de `deriveEmbeddingWritePathDecision` rege tanto executores em background como a UI interactiva.
3. Executar o ciclo completo de validação:
   - `npm test`
   - `npm run typecheck`
   - `npm run lint:obsidian:strict`
   - `npm run build`
   - `npm run release-check`
   - `git diff --check`
