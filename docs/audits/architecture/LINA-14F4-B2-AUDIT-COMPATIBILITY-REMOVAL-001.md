# LINA-14F.4-B2 — Pré-Auditoria de Remoção dos Adapters de Compatibilidade

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B2  
**Estado:** Aprovado para Implementação  
**Autoridade:** `AGENTS.md`, `docs/audits/architecture/LINA-14F4-AUDIT-LEGACY-REMOVAL-001.md`

---

## 1. Contexto e Objetivo

Na fase **LINA-14F.4-A**, a auditoria global de remoção de legado identificou adapters e wrappers temporários de compatibilidade introduzidos para manter retrocompatibilidade com testes legados durante a migração do Write Path (LINA-14D.2-A e LINA-14D.2-B).

Com a conclusão do cutover ativo do Read Path (LINA-14F.1), Write Path (LINA-14F.2), Worker/Operation Manager (LINA-14F.3) e eliminação da infraestrutura de Shadow Mode (LINA-14F.4-B1), o pipeline canónico:

```text
Estado Factual
      ↓
EmbeddingLifecycleSnapshot
      ↓
deriveEmbeddingWritePathDecision()
      ↓
Consumidores Ativos
```

é a **única autoridade operacional** em todo o plugin.

O objetivo do lote **LINA-14F.4-B2** é:
1. Eliminar `hasEmbeddingWorkAvailable()` em `src/index/embeddingWorkStatusController.ts`;
2. Eliminar `evaluateEmbeddingUpdatePolicy()` e `evaluateLegacyEmbeddingUpdatePolicy()` em `src/maintenance/embeddingPolicyEngine.ts`;
3. Eliminar tipos e interfaces obsoletas associadas (`EvaluateEmbeddingUpdatePolicyOptions`, `EmbeddingPolicyStateInput`);
4. Migrar todos os testes legados que ainda consumiam estes wrappers para as funções canónicas `evaluateEmbeddingUpdatePolicyFromSnapshot()`, `classifyEmbeddingWork()` ou `deriveEmbeddingWritePathDecision()`.

---

## 2. Inventário Exaustivo de Adapters e Consumidores

### 2.1. `hasEmbeddingWorkAvailable()`

- **Localização:** `src/index/embeddingWorkStatusController.ts` (linhas 102–150).
- **Consumidores em Produção (`src/`, `main.ts`):** **Zero**.
  - `EmbeddingWorkStatusController` já deriva `workAvailable` e `decision` exclusivamente de `adaptCurrentStateToLifecycleSnapshot` + `deriveEmbeddingWritePathDecision`.
- **Consumidores em Testes:**
  - `tests/index/embeddingWorkStatusController.test.ts` (linhas 83, 347–353)
  - `tests/index/embeddingWorkStatusControllerLifecycle.test.ts` (linhas 5, 374–393)
- **Substituição Canónica:** `classifyEmbeddingWork(inputs).updateRequired` ou `deriveEmbeddingWritePathDecision(snapshot).workMode`.

---

### 2.2. `evaluateEmbeddingUpdatePolicy()` e `evaluateLegacyEmbeddingUpdatePolicy()`

- **Localização:** `src/maintenance/embeddingPolicyEngine.ts` (linhas 180–338).
- **Consumidores em Produção (`src/`, `main.ts`):** **Zero**.
  - `EmbeddingScheduler` consome exclusivamente `evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, policy)`.
- **Consumidores em Testes:**
  - `tests/security/secretBoundaryProtection.test.ts` (linha 256)
  - `tests/settings/embeddingUpdateSettings.test.ts` (linhas 124, 136, 152, 169, 181, 199, 211)
  - `tests/maintenance/embeddingUpdateConfirmation.test.ts` (linhas 21, 56, 80, 104, 128, 152, 171, 190)
  - `tests/maintenance/embeddingStatusExplanation.test.ts` (linhas 20, 48, 75, 103, 133, 159, 188, 214)
  - `tests/maintenance/embeddingPolicyEngine.test.ts` (linhas 72, 85, 98, etc.)
- **Substituição Canónica:** `evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, policy)`.

---

### 2.3. Tipos e Interfaces Associadas

- `EvaluateEmbeddingUpdatePolicyOptions` (`src/maintenance/embeddingPolicyEngine.ts:57-64`)
- `EmbeddingPolicyStateInput` (`src/maintenance/embeddingPolicyEngine.ts:49-55`)
- **Consumidores em Produção:** **Zero**.
- **Consumidores em Testes:** Apenas os testes que consumiam `evaluateEmbeddingUpdatePolicy`.

---

## 3. Análise de Risco e Equivalência

| Risco | Probabilidade | Severidade | Mitigação |
|---|---|---|---|
| Quebra de contratos públicos | Nula | Baixa | `hasEmbeddingWorkAvailable` e `evaluateEmbeddingUpdatePolicy` não são APIs públicas de Obsidian nem da janela global; são funções internas do plugin. |
| Divergência de decisão em testes migrados | Baixa | Baixa | A paridade entre snapshot policy e legacy policy já foi matematicamente e exaustivamente provada nas fases LINA-14D.2-B e LINA-14F.2. |
| Regressão em runtime | Nula | Alta | Produção já não invoca estes adapters desde a conclusão do cutover LINA-14F.2 e LINA-14F.3. |

---

## 4. Plano de Execução do Lote B2

1. **Remoção em `src/index/embeddingWorkStatusController.ts`**:
   - Eliminar export e implementação de `hasEmbeddingWorkAvailable`.

2. **Remoção em `src/maintenance/embeddingPolicyEngine.ts`**:
   - Eliminar `evaluateLegacyEmbeddingUpdatePolicy()`.
   - Eliminar `evaluateEmbeddingUpdatePolicy()`.
   - Eliminar `EvaluateEmbeddingUpdatePolicyOptions` e `EmbeddingPolicyStateInput`.
   - Limpar imports não utilizados (`adaptCurrentStateToLifecycleSnapshot`, `DeviceRuntimeState`).

3. **Migração dos Testes**:
   - `tests/index/embeddingWorkStatusController.test.ts`: Migrar asserções para `classifyEmbeddingWork`.
   - `tests/index/embeddingWorkStatusControllerLifecycle.test.ts`: Migrar cenário 10 para testar `classifyEmbeddingWork`.
   - `tests/security/secretBoundaryProtection.test.ts`: Utilizar `evaluateEmbeddingUpdatePolicyFromSnapshot`.
   - `tests/settings/embeddingUpdateSettings.test.ts`: Migrar para `evaluateEmbeddingUpdatePolicyFromSnapshot`.
   - `tests/maintenance/embeddingUpdateConfirmation.test.ts`: Migrar para `evaluateEmbeddingUpdatePolicyFromSnapshot`.
   - `tests/maintenance/embeddingStatusExplanation.test.ts`: Migrar para `evaluateEmbeddingUpdatePolicyFromSnapshot`.
   - `tests/maintenance/embeddingPolicyEngine.test.ts`: Migrar suíte para `evaluateEmbeddingUpdatePolicyFromSnapshot`.

4. **Validação**:
   - `npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check`.
