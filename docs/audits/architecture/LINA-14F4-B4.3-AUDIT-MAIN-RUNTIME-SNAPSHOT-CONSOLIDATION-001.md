# Auditoria de Arquitetura: Consolidação de Snapshots no Runtime de main.ts (LINA-14F.4-B4.3)

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B4.3 — Main Runtime Snapshot Consolidation  
**Alvo:** `main.ts` (`confirmAndRequestEmbeddingGeneration`, `hasAutomaticEmbeddingWork`, `getEmbeddingLifecycleSnapshot`)

---

## 1. Contexto e Objetivos

Nas fases anteriores (B4.0-A a B4.2), os componentes downstream (`EmbeddingScheduler`, `EmbeddingWorker`, `EmbeddingOperationManager` e `LinaSearchView`) foram progressivamente migrados para consumir exclusivamente a cadeia factual canónica:

```text
Estado Factual (Vault / Storage / Device)
                  ↓
       EmbeddingLifecycleSnapshot
                  ↓
     deriveEmbeddingWritePathDecision()
                  ↓
            Consumidores
```

No entanto, no ficheiro central [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts), ainda subsistem dois métodos que constroem snapshots locais ad-hoc diretamente através de `adaptCurrentStateToLifecycleSnapshot`:
1. `confirmAndRequestEmbeddingGeneration()` (linhas 1758–1765)
2. `hasAutomaticEmbeddingWork()` (linhas 2671–2678)

O objetivo da fase **LINA-14F.4-B4.3** é consolidar a construção de snapshots em `main.ts`, eliminando mapeamentos parciais e garantindo que todas as decisões em `main.ts` utilizam a fábrica canónica [`buildEmbeddingWorkLifecycleSnapshot()`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts#L151).

---

## 2. Análise do Estado Atual e Métodos Envolvidos

### 2.1 `confirmAndRequestEmbeddingGeneration()`
- **Localização:** `main.ts:1727–1820`
- **Comportamento Atual:**
  - Lê `readEmbeddingStatus` e `readEmbeddingUpdatePreview`.
  - Constrói um snapshot ad-hoc via `adaptCurrentStateToLifecycleSnapshot({ deviceRuntimeState, updatePlan, upstreamTextIndex: "ready", canonicalExists, canonicalReadability, isExternalProvider })`.
  - Avalia `evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, policy)`.
  - Constrói o pedido de confirmação com `prepareEmbeddingUpdateConfirmation`.
- **Problema:** Mapeamento manual de campos com defaults locais duplicados, em vez de recorrer à factory canónica `buildEmbeddingWorkLifecycleSnapshot`.

### 2.2 `hasAutomaticEmbeddingWork()`
- **Localização:** `main.ts:2661–2681`
- **Comportamento Atual:**
  - Lê `readEmbeddingUpdatePreview`.
  - Constrói um snapshot ad-hoc com flags manuais (`canonicalExists: updatePlan.mode !== "initial-build"`, `canonicalReadability: updatePlan.mode === "initial-build" ? "missing" : "readable"`).
  - Avalia `evaluateSchedulerDecisionFromSnapshot(snapshot, policy)`.
- **Problema:** Cria uma segunda heurística isolada para inferir a legibilidade e existência do índice canónico.
- **Invariante Crítica:** Não deve forçar o refresh do `EmbeddingWorkStatusController` para não alterar o estado passivo reportado à UI (`tests/maintenance/automaticEmbeddingRuntimeDispatch.test.ts:114`).

### 2.3 `getEmbeddingLifecycleSnapshot()`
- **Localização:** `main.ts:883–912`
- **Comportamento Atual:**
  - Se o resumo do controller estiver disponível e for válido, chama `buildEmbeddingWorkLifecycleSnapshot(summary, revision, runtime, operationState)`.
  - Caso contrário, usa `adaptCurrentStateToLifecycleSnapshot` com `getLiveAuthorityRuntimeState()`.
- **Papel:** É a fonte de verdade consolidada consumida pelo Worker e Operation Manager.

---

## 3. Identificação de Riscos e Invariantes

1. **Invariante do Scheduler Passivo:**  
   `hasAutomaticEmbeddingWork()` deve continuar síncrono/independente do status passivo do controller, evitando side-effects que disparassem notificações na UI.
2. **Invariante do Rebuild Completo:**  
   Em `confirmAndRequestEmbeddingGeneration()`, quando `isFullRebuild = true`, o plano de atualização deve manter explicitamente o modo `"full-rebuild"`, exigindo confirmação modal do utilizador.
3. **Invariante de Autoridade em Tempo Real:**  
   A criação do snapshot deve consultar `this.getLiveAuthorityRuntimeState()` e `this.getEmbeddingOperationState()` para refletir instantaneamente a perda de autoridade ou operações em curso.
4. **Zero Fallback Silencioso:**  
   Estados indeterminados ou unreadable devem ser preservados sem defaults permissivos que iniciem gerações cegas.

---

## 4. Plano de Alteração

1. **Utilizar `buildEmbeddingWorkLifecycleSnapshot` de forma consistente em `main.ts`:**
   - Em `confirmAndRequestEmbeddingGeneration()`: criar o `EmbeddingWorkSummary` a partir de `summary` + `updatePlan` e invocar `buildEmbeddingWorkLifecycleSnapshot(workSummary, 0, this.getLiveAuthorityRuntimeState(), this.getEmbeddingOperationState())`.
   - Em `hasAutomaticEmbeddingWork()`: montar o `EmbeddingWorkSummary` estruturado com o `updatePlan` e invocar `buildEmbeddingWorkLifecycleSnapshot(...)`.
2. **Testes de Caracterização:**
   - Criar suite dedicada [`tests/maintenance/mainRuntimeSnapshotConsolidation.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/mainRuntimeSnapshotConsolidation.test.ts) validando:
     - `READY`
     - `UPDATE_AVAILABLE`
     - `INDEX_ONLY`
     - `INCOMPATIBLE`
     - `ERROR`
     - `Companion` (bloqueio de geração e escrita)
     - `Standby` (bloqueio de geração e escrita)
     - Provider Externo
     - Perda de Ownership durante o fluxo
3. **Quality Gates:**
   - `npm test`
   - `npm run typecheck`
   - `npm run lint:obsidian:strict`
   - `npm run build`
   - `npm run release-check`
   - `git diff --check`
