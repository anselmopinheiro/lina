# Relatório de Implementação: LINA-15C — Separação entre Teto de Leitura JSONL e Corrupção Física em `INDETERMINATE`

**Identificador:** `LINA-15C-IMPLEMENT-LARGE-CANONICAL-STATE-001`  
**Data:** 2026-10-01  
**Autor:** Arquiteto de Software Sénior & Engenheiro de Embeddings  
**Âmbito:** Implementação da separação semântica e operacional entre teto de capacidade do Resource Guard em JSONL e corrupção física/ilegibilidade em `INDETERMINATE`.  
**Estado:** **IMPLEMENTAÇÃO CONCLUÍDA — 100% TESTES APROVADOS (149 FICHEIROS / 1969 TESTES)**

---

## 1. Finding e Causa-Raiz

### 1.1 Finding F-04
Na auditoria pós-LINA-14, identificou-se que ficheiros canónicos válidos cujo tamanho excedesse o teto do Resource Guard (~53,33 MB no desktop e ~11,20 MB no mobile) provocavam a classificação do subsistema como `primary = "INDETERMINATE"`, `action = "none"`, `canExecute = false`. O Producer ficava impedido não só de atualizar incrementalmente como também de reconstruir o índice (`full-rebuild`).

### 1.2 Causa-Raiz
1. `evaluateEmbeddingBridgeRead` recusava a leitura segura do ficheiro por limite de recursos de memória/ponte IPC.
2. `readCanonicalEmbeddingFileState` devolvia `readability = "unreadable"`, misturando o teto de recursos com corrupção de parsing e erros de I/O.
3. `calculateEmbeddingUpdatePlan` e `classifyEmbeddingWork` tratavam `"unreadable"` como incerteza e geravam `mode = "indeterminate"`, deixando o sistema bloqueado.

---

## 2. Solução Implementada

1. **Expansão do Tipo `CanonicalEmbeddingReadability`:**
   - Adicionado `"resource-limit-exceeded"` a `CanonicalEmbeddingReadability` em [`src/index/embeddingUpdatePlan.ts`](src/index/embeddingUpdatePlan.ts), [`src/index/embeddingGenerator.ts`](src/index/embeddingGenerator.ts), [`src/index/embeddingLifecycleModel.ts`](src/index/embeddingLifecycleModel.ts), [`src/index/embeddingLifecycleAdapter.ts`](src/index/embeddingLifecycleAdapter.ts) e [`src/index/embeddingWorkStatusController.ts`](src/index/embeddingWorkStatusController.ts).
2. **Nova Razão de Plano:**
   - Adicionada `"canonical-resource-limit-exceeded"` em `EmbeddingUpdatePlanReason`.
3. **Mapeamento do Resource Guard no Gerador:**
   - `readCanonicalEmbeddingFileState` devolve `readability = "resource-limit-exceeded"` quando `!bridgeDecision.allowed`.
4. **Reconciliação no `calculateEmbeddingUpdatePlan`:**
   - Quando `canonicalReadability === "resource-limit-exceeded"`:
     - `mode = "full-rebuild"`;
     - `reusableCanonicalRecords = []` (0 registos reutilizáveis do canónico);
     - `toGenerateCount = chunks.length`;
     - `reasons = ["canonical-resource-limit-exceeded"]`.
5. **Classificação no `EmbeddingLifecycleModel`:**
   - `classifyEmbeddingWork` classifica `"resource-limit-exceeded"` como `kind = "pending"`, `mode = "full-rebuild"`, `severity = "blocking"`.
   - `resolveEmbeddingLifecycle` mapeia para `primary = "INCOMPATIBLE"`, `canRequestUpdate = true`, `requiresConfirmation = true`.
6. **Decisão do Write Path e Gate de Operação:**
   - `deriveEmbeddingWritePathDecision` deriva `action = "rebuild"`, `canExecute = true`, `requiresConfirmation = true`.
   - `evaluateOperationStartGate(decision, "automatic")` bloqueia despacho automático em background (`confirmation-required`).
   - `evaluateOperationStartGate(decision, "sidebar" | "command")` permite arranque manual com confirmação do utilizador.
7. **Integração na Pesquisa Híbrida / Semântica:**
   - `getSemanticSearchAvailability` reconhece `"resource-limit-exceeded"` e utiliza a cópia binária se disponível (`binary-v1`), ou indica que a cópia binária é necessária (`reasonCode: "binary-required"`).

---

## 3. Ficheiros Modificados

1. [`src/index/embeddingUpdatePlan.ts`](src/index/embeddingUpdatePlan.ts) — tipos de legibilidade e razões de plano; tratamento de `"resource-limit-exceeded"` como `full-rebuild`.
2. [`src/index/embeddingGenerator.ts`](src/index/embeddingGenerator.ts) — devolução de `"resource-limit-exceeded"` na recusa do guard e descrições de plano.
3. [`src/index/embeddingLifecycleModel.ts`](src/index/embeddingLifecycleModel.ts) — classificação de trabalho para `"resource-limit-exceeded"`.
4. [`src/index/embeddingLifecycleAdapter.ts`](src/index/embeddingLifecycleAdapter.ts) — propagação do novo tipo no input factual.
5. [`src/index/embeddingWorkStatusController.ts`](src/index/embeddingWorkStatusController.ts) — distinção em `isIndeterminateWorkSummary`.
6. [`src/search/hybridSearch.ts`](src/search/hybridSearch.ts) — suporte a fallback binário em `getSemanticSearchAvailability`.
7. [`tests/index/largeCanonicalResourceLimit.test.ts`](tests/index/largeCanonicalResourceLimit.test.ts) — suite completa de testes de caracterização (10 cenários).
8. [`tests/index/embeddingResourceGuard.test.ts`](tests/index/embeddingResourceGuard.test.ts) — atualização de asserções para o novo estado tipado.
9. [`tests/settings/embeddingConfigurationRuntimeWiring.test.ts`](tests/settings/embeddingConfigurationRuntimeWiring.test.ts) — distinção explícita entre `resource-limited` e `read-failure`.

---

## 4. Invariantes de Segurança Verificados

1. **Fail-Closed em Incerteza Real:** Ficheiros corrompidos ou erros de I/O continuam a produzir `readability = "unreadable"`, `mode = "indeterminate"`, `primary = "INDETERMINATE"`, `action = "none"`, `canExecute = false`.
2. **Sem Despacho Automático Destrutivo:** `requiresConfirmation = true` impede arranque em background pelo Scheduler.
3. **Proteção Fencing LINA-15A:** A validação `{ deviceId, epoch }` permanece ativa na publicação atómica de embeddings.
4. **Sem Riscos de OOM:** O limite do Resource Guard (53,33 MB desktop / 11,20 MB mobile) permanece inviolável, não permitindo carregamento perigoso em memória.

---

## 5. Resultados de Validação

- `npm test`: **149 test files passed, 1969 tests passed (100%)**
- `npm run typecheck`: **0 erros**
- `npm run lint:obsidian:strict`: **0 erros / 0 avisos**
- `npm run build`: **Build de produção completada com sucesso**
- `npm run release-check`: **READY FOR OBSIDIAN RELEASE**
- `git diff --check`: **Sem conflitos ou whitespace errors**
