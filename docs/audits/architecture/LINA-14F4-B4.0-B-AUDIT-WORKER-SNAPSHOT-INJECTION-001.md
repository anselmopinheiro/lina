# Auditoria de Arquitetura: Injeção de Snapshot Canónico no EmbeddingWorker (LINA-14F.4-B4.0-B)

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B4.0-B  
**Alvo:** `src/maintenance/embeddingWorker.ts`, `src/index/embeddingOperationManager.ts`, `main.ts` (`getMaintenanceEngine`)

---

## 1. Contexto e Objetivos

Na arquitetura canónica consolidada em LINA-14:
- `EmbeddingLifecycleSnapshot` é o modelo factual único de estado do ciclo de vida dos embeddings.
- `deriveEmbeddingWritePathDecision()` é a autoridade canónica de decisão operacional.
- O `EmbeddingScheduler` foi corrigido na fase B4.0-A para utilizar o snapshot canónico em vez de heurísticas isoladas.
- O `EmbeddingWorker` representa a última barreira de proteção antes da execução física de geração/escrita de embeddings no vault.

Esta auditoria analisa a receção do snapshot canónico pelo `EmbeddingWorker`, identificando como o worker valida a autoridade antes da escrita, bloqueia execuções indevidas (Companion, Standby, Indeterminate, Incompatible) e deteta perda de ownership durante a operação.

---

## 2. Análise dos Componentes

### 2.1 `EmbeddingWorker` (`src/maintenance/embeddingWorker.ts`)
- **Port de Snapshot:** Já define `getLifecycleSnapshot?: () => EmbeddingLifecycleSnapshot` em `EmbeddingWorkerOptions`.
- **Validação de Snapshot:** `evaluateOperationDecisionFromSnapshot(snapshot)` deriva a decisão canónica via `deriveEmbeddingWritePathDecision(snapshot)`.
- **Guarda de Execução:** Em `requestGeneration()`:
  - Se `getLifecycleSnapshot` for fornecido, avalia a decisão canónica.
  - Bloqueia com `not-active-producer` se `decision.ownershipLostDuringOperation`.
  - Bloqueia com `not-capable` para Companion ou falta de capabilities.
  - Bloqueia com `not-active-producer` para Standby.
  - Bloqueia com `not-capable` para estados `INDETERMINATE`.
  - Bloqueia com `not-capable` execuções automáticas quando `decision.requiresConfirmation`.

### 2.2 `MaintenanceEngine` e `main.ts`
- Em `main.ts` (`getMaintenanceEngine()`), o `EmbeddingWorker` é instanciado sem passar a porta `getLifecycleSnapshot`.
- Sem a injeção em `main.ts`, o worker em produção depende apenas dos ports de fallback legados (`capabilities`, `canPublish`), perdendo a validação refinada do ciclo de vida canónico (`primary`, `blockedReason`, `requiresConfirmation`, `ownershipLostDuringOperation`).

---

## 3. Riscos e Requisitos de Segurança

1. **Companion Isolation:** Dispositivos configurados como Companion nunca devem executar escrita nem iniciar geração local.
2. **Standby Producer:** Dispositivos Standby não possuem autorização ativa e devem retornar `not-active-producer`.
3. **Perda de Ownership:** Se a autoridade for revogada durante uma geração em curso, o worker deve sinalizar `ownershipLostDuringOperation` e rejeitar novas operações com `not-active-producer`.
4. **Rebuild / Incompatibilidade:** Mudanças de modelo/provider exigem confirmação explícita do utilizador e nunca devem ser despoletadas automaticamente pelo worker sem confirmação.

---

## 4. Plano de Implementação

1. **Injeção em `main.ts`:**
   - Adicionar método auxiliar `getEmbeddingLifecycleSnapshot(): EmbeddingLifecycleSnapshot` no `LinaPlugin` em `main.ts`.
   - Injetar `getLifecycleSnapshot: () => this.getEmbeddingLifecycleSnapshot()` na instanciação de `EmbeddingWorker` em `getMaintenanceEngine()`.
2. **Testes de Caracterização:**
   - Criar suite dedicada `tests/maintenance/embeddingWorkerSnapshotInjection.test.ts` cobrindo todos os cenários obrigatórios:
     - Producer Ativo (`READY`, `UPDATE_AVAILABLE`, `INDEX_ONLY`).
     - Companion Isolation (`not-capable`).
     - Standby Producer (`not-active-producer`).
     - Perda de Ownership (`ownershipLostDuringOperation` -> `not-active-producer`).
     - Incompatibilidade e bloqueio de auto-start sem confirmação.
3. **Validação:**
   - Executar todos os quality gates (`npm test`, `typecheck`, `lint:obsidian:strict`, `build`, `release-check`, `git diff --check`).
