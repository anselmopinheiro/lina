# LINA-14F.2 — IMPLEMENTAÇÃO DO CUTOVER ATIVO DO WRITE PATH (CONTROLLER, POLICY, SCHEDULER)

**Data:** 2026-09-30  
**Fase:** LINA-14F.2  
**Estado:** Concluído  
**Autor:** Engenheiro TypeScript / Arquiteto de Software Sénior  

---

## 1. Resumo Executivo

A fase **LINA-14F.2** realizou com sucesso o cutover ativo dos componentes centrais de decisão do Write Path do subsistema de embeddings:
1. `EmbeddingWorkStatusController` (`src/index/embeddingWorkStatusController.ts`)
2. `EmbeddingPolicyEngine` (`src/maintenance/embeddingPolicyEngine.ts`)
3. `EmbeddingScheduler` (`src/maintenance/embeddingScheduler.ts`)
4. Ports e wiring em `main.ts` (`hasAutomaticEmbeddingWork`, `canDispatchAutomatically`, `confirmAndRequestEmbeddingGeneration`, `getDeviceRuntimeState`)

A autoridade formal e efetiva de decisão passou a derivar de `deriveEmbeddingWritePathDecision(snapshot)` (e suas projeções puras), eliminando heurísticas booleanas ad-hoc e avaliações legadas concorrentes.

---

## 2. Componentes Migrados e Detalhes de Implementação

### 2.1 EmbeddingWorkStatusController (`src/index/embeddingWorkStatusController.ts`)
- **Autoridade Única:** O controller passou a derivar o seu estado e disponibilidade de trabalho diretamente através de `deriveEmbeddingWritePathDecision(snapshot)` e `snapshot.write.work.updateRequired`.
- **Tri-estado Preservado:** 
  - `decision.workKind === "indeterminate"` ou `snapshot.primary === "INDETERMINATE"` produz `workAvailable: undefined`.
  - Roles não autorizadas a gerar escritas (`companion`, `standby`) produzem `workAvailable: false`.
  - Estados normais com chunks pendentes/rebuild/cleanup produzem `workAvailable: true`.
  - Estados up-to-date produzem `workAvailable: false`.
- **Publicação/Cleanup:** Casos com registos inválidos/duplicados são devidamente alimentados no plano sintético e classificados como `publish-only` (`updateRequired: true`).
- **Retrocompatibilidade de export:** `hasEmbeddingWorkAvailable()` foi preservado como pure helper delegando em `classifyEmbeddingWork` para total estabilidade de testes legados.

### 2.2 EmbeddingPolicyEngine (`src/maintenance/embeddingPolicyEngine.ts`)
- **Avaliação Canónica:** O motor de política de embeddings agora avalia as decisões diretamente a partir do snapshot canónico através de `evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, policy)`.
- **Compatibilidade de Assinatura:** `evaluateEmbeddingUpdatePolicy()` foi mantido como pure adapter para compatibilidade de callers existentes, construindo o snapshot canónico através de `adaptCurrentStateToLifecycleSnapshot` e encaminhando a avaliação para `evaluateEmbeddingUpdatePolicyFromSnapshot`.

### 2.3 EmbeddingScheduler (`src/maintenance/embeddingScheduler.ts`)
- **Predicado Canónico:** O scheduler avalia `options.canDispatchAutomatically()` e `options.hasEmbeddingWork()`, que consultam a decisão canónica do snapshot.
- **Invariantes Temporais Intactas:** Foram estritamente preservados os timers, debounce (30s), maximum delay (300s), backoff exponencial e política de single-flight.

### 2.4 Runtime Wiring (`main.ts`)
- **`hasAutomaticEmbeddingWork`:** Constrói o snapshot a partir do `updatePlan` fresco e verifica `decision.applicable && decision.updateRequired && (decision.action === "update" || decision.action === "generate")`.
- **`canDispatchAutomatically`:** Avalia a política de auto-dispatch com base na decisão da política derivada do snapshot canónico.
- **`confirmAndRequestEmbeddingGeneration`:** Obtém a autorização de execução e exigência de confirmação consultando o snapshot canónico e a decisão de política associada.
- **`getDeviceRuntimeState`:** Injeta `isAuthorizedSync()` do `OwnershipGate` para evitar falsas desautorizações durante transições síncronas antes da primeira avaliação assíncrona.

---

## 3. Invariantes Verificadas

| Invariante | Estado Canónico / Decisão | Comportamento Observado |
|---|---|---|
| **READY** | `primary: "READY"`, `workKind: "none"` | `workAvailable: false`, Scheduler não despacha |
| **UPDATE_AVAILABLE** | `primary: "UPDATE_AVAILABLE"`, `action: "update"` | `workAvailable: true`, Scheduler despacha se política autorizar |
| **INDEX_ONLY** | `primary: "INDEX_ONLY"`, `action: "generate"` | Apenas Produtor Ativo pode gerar |
| **INCOMPATIBLE** | `primary: "INCOMPATIBLE"`, `action: "rebuild"` | `requiresConfirmation: true`, nunca auto-executa |
| **ERROR** | `primary: "ERROR"`, `action: "retry"` | Sem retry automático infinito |
| **INDETERMINATE** | `primary: "INDETERMINATE"` | `workAvailable: undefined`, auto-dispatch bloqueado |
| **Companion** | `blockedReason: "companion"` | `action: "none"`, nunca despacha |
| **Standby** | `blockedReason: "standby"` | `action: "none"`, nunca despacha |
| **Disabled** | `primary: "DISABLED"` | Write Path inaplicável |

---

## 4. Quality Gates

- `npm test`: **139 ficheiros / 1867 testes aprovados** (100%)
- `npm run typecheck`: **0 erros**
- `npm run lint:obsidian:strict`: **0 erros / 0 avisos**
- `npm run build`: **Sucesso (bundle de produção gerado)**
- `npm run release-check`: **OK (READY FOR OBSIDIAN RELEASE)**
- `git diff --check`: **Limpo (sem erros de formatação/espaços)**

---

## 5. Próximas Etapas

- **LINA-14F.3:** Cutover ativo do `EmbeddingOperationManager` e locks de execução (`IndexWriteCoordinator`).
- **LINA-14F.4:** Cutover ativo do `EmbeddingWorker` e unificação física dos pipelines de geração.
