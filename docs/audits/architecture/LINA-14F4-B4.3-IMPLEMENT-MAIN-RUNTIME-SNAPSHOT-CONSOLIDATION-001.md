# Relatório de Implementação: Consolidação de Snapshots no Runtime de main.ts (LINA-14F.4-B4.3)

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B4.3 — Main Runtime Snapshot Consolidation  
**Alvo:** `main.ts`, `src/index/embeddingWorkStatusController.ts`, `tests/maintenance/mainRuntimeSnapshotConsolidation.test.ts`

---

## 1. Resumo Executivo

A fase **LINA-14F.4-B4.3** concluiu com sucesso a eliminação de reconstruções ad-hoc de `EmbeddingLifecycleSnapshot` no runtime de [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts).

Tanto os fluxos manuais (`confirmAndRequestEmbeddingGeneration`) quanto os automáticos (`hasAutomaticEmbeddingWork`) passaram a utilizar exclusivamente a fábrica canónica [`buildEmbeddingWorkLifecycleSnapshot()`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts#L152), assegurando a preservação da cadeia arquitetural canónica:

```text
Estado Factual (Vault / Storage / Device)
                  ↓
       EmbeddingLifecycleSnapshot
                  ↓
      deriveEmbeddingWritePathDecision()
                  ↓
             Consumidores
```

---

## 2. Alterações Realizadas

### 2.1 `main.ts`
- **`confirmAndRequestEmbeddingGeneration()`**:
  - Removida a invocação ad-hoc de `adaptCurrentStateToLifecycleSnapshot`.
  - Construído o `EmbeddingWorkSummary` combinando o estado lido do disco (`readEmbeddingStatus`), o preview de atualização (`effectiveUpdatePlan` com suporte a `isFullRebuild`) e identidades alvo.
  - Snapshot construído via `buildEmbeddingWorkLifecycleSnapshot(workSummary, 0, this.getLiveAuthorityRuntimeState(), this.getEmbeddingOperationState())`.
- **`hasAutomaticEmbeddingWork()`**:
  - Removida a invocação ad-hoc de `adaptCurrentStateToLifecycleSnapshot` com flags manuais isoladas.
  - Construído o `EmbeddingWorkSummary` estruturado a partir do `updatePlan` factual.
  - Snapshot construído via `buildEmbeddingWorkLifecycleSnapshot(...)`, avaliando a decisão do Scheduler via `evaluateSchedulerDecisionFromSnapshot(snapshot, policy)` sem mutação do estado passivo do controller.

### 2.2 `src/index/embeddingWorkStatusController.ts`
- **`buildEmbeddingWorkLifecycleSnapshot()`**:
  - Integrado `getEmbeddingProviderCapability` para determinar deterministicamente se o provider alvo é local ou externo (`isExternalProvider`).
  - Alinhado o fallback de `dimensions` e `prefixMode` na identidade publicada a partir do `targetIdentity` do `updatePlan`.
- **`EmbeddingWorkSummary`**:
  - Ajustado para estender `Partial<EmbeddingStateSummary>`, permitindo que resumos baseados puramente em `updatePlan` ou com leituras parciais mantenham total tipagem estrita sem coerções de tipo inseguras.

### 2.3 Testes de Caracterização
- Criada suite dedicada [`tests/maintenance/mainRuntimeSnapshotConsolidation.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/mainRuntimeSnapshotConsolidation.test.ts) com 11 testes cobrindo:
  - Verificação estática de ausência de chamadas ad-hoc a `adaptCurrentStateToLifecycleSnapshot` nos métodos alvos de `main.ts`.
  - Validação de fluxos `READY` e `UPDATE_AVAILABLE`.
  - Bloqueio determinístico de `Companion` e `Standby`.
  - Bloqueio de providers externos sob política `automatic-local-only`.
  - Degradação imediata por perda de autoridade de ownership (`isAuthorizedSync() === false`).
  - Cobertura exaustiva dos estados de ciclo de vida (`READY`, `UPDATE_AVAILABLE`, `INDEX_ONLY`, `INCOMPATIBLE`, `INDETERMINATE`).

---

## 3. Verificação de Quality Gates

- `npm test`: 146 suites / 1931 testes aprovados (100% verde).
- `npm run typecheck`: 0 erros TypeScript.
- `npm run lint:obsidian:strict`: 0 erros / 0 avisos ESLint.
- `npm run build`: bundle de produção gerado com sucesso.
- `npm run release-check`: verificação de release Obsidian aprovada.
- `git diff --check`: 0 problemas de formatação/espaçamento.

---

## 4. Rastreabilidade Git

- **Branch:** `master`
- **Commit Planeado:** `refactor(embeddings): consolidate main runtime lifecycle snapshot derivation (LINA-14F.4-B4.3)`
- **Autorização:** Aguardando confirmação do utilizador antes do commit / push.
