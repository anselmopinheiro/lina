# Relatório de Auditoria: LINA-15B — Reconciliação `updatePlan` ↔ `EmbeddingLifecycleSnapshot`

**Identificador:** `LINA-15B-AUDIT-UPDATEPLAN-LIFECYCLE-001`
**Data:** 2026-10-01
**Autor:** Arquiteto de Software Sénior & Engenheiro de Embeddings
**Âmbito:** Auditoria técnica aprofundada da relação entre o planeador de atualização (`updatePlan`), o modelo canónico (`EmbeddingLifecycleSnapshot`), o motor de decisão (`deriveEmbeddingWritePathDecision`), o Scheduler, o Worker e a UI.
**Estado:** **AUDITORIA CONCLUÍDA — CORREÇÃO NECESSÁRIA (CLASSIFICAÇÃO A)**

---

## 1. Contexto e Finding de Origem (F-03)

A auditoria global pós-LINA-14 ([`docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md`](docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md) Finding F-03) identificou uma divergência material de segurança:

```text
updatePlan.mode = "full-rebuild"
        ↓
EmbeddingLifecycleSnapshot (adaptCurrentStateToLifecycleSnapshot / buildEmbeddingWorkLifecycleSnapshot)
        ↓
primary = "UPDATE_AVAILABLE" (em vez de INCOMPATIBLE ou full-rebuild)
        ↓
deriveEmbeddingWritePathDecision() => action = "update", requiresConfirmation = false
        ↓
evaluateSchedulerDecisionFromSnapshot() => canDispatch = true ("auto-dispatch-approved")
```

Um plano destrutivo de reconstrução total (`full-rebuild`) pode ser mascarado como uma simples atualização incremental sem confirmação, permitindo que o Scheduler despache em segundo plano uma operação que apaga e regenera todo o índice vetorial.

---

## 2. Origem e Ciclo de Vida do `updatePlan`

### 2.1 Mapeamento no Código-Fonte
- **Definição e Tipos:** [`src/index/embeddingUpdatePlan.ts`](src/index/embeddingUpdatePlan.ts)
  - `EmbeddingUpdateMode = "initial-build" | "incremental" | "full-rebuild" | "indeterminate"`
  - `EmbeddingUpdatePlanReason` (22 razões tipadas cobrindo missing, identity changes, mixed canonical, corruptions, etc.)
  - `EmbeddingUpdatePlan` (plano integral com registos, chunks e IDs obsoletos)
  - `EmbeddingUpdatePlanPreview` (resumo estrutural leve para UI e lifecycle)
- **Função de Cálculo:** `calculateEmbeddingUpdatePlan(input: CalculateEmbeddingUpdatePlanInput): EmbeddingUpdatePlan`
- **Consumidores Principais:**
  1. [`src/index/embeddingGenerator.ts`](src/index/embeddingGenerator.ts) — calcula o plano real durante a execução da geração/atualização/reconstrução.
  2. [`src/index/embeddingWorkStatusController.ts`](src/index/embeddingWorkStatusController.ts) — calcula o preview do plano através de `calculateEmbeddingUpdatePlanPreview` para determinar o `EmbeddingWorkSummary`.
  3. [`src/index/embeddingLifecycleAdapter.ts`](src/index/embeddingLifecycleAdapter.ts) — consome `updatePlan` como input factual opcional em `CurrentEmbeddingStateInputs`.
  4. [`src/search/embeddingStatusViewModel.ts`](src/search/embeddingStatusViewModel.ts) — consome `summary.updatePlan` para métricas da Sidebar.

### 2.2 Persistência e Volatilidade
- O `updatePlan` **não é persistido em disco**; é uma estrutura efêmera e determinística em memória, recalculada a partir do estado dos ficheiros do vault (chunks), do ficheiro canónico (`embeddings.jsonl`), dos checkpoints (`embeddings.checkpoint.jsonl`) e das identidades publicada/alvo.
- O plano pode ficar desatualizado se ficheiros forem alterados no vault sem que ocorra novo cálculo. O `EmbeddingWorkStatusController` invalida e recalcula o plano em eventos de ficheiro ou expiração de TTL.

---

## 3. Semântica dos Modos de `EmbeddingUpdatePlan`

| Modo (`updatePlan.mode`) | Semântica Operacional | Reutilização de Registos | Natureza da Operação |
|---|---|---|---|
| **`initial-build`** | Ficheiro canónico ausente ou vazio. Chunks existem no vault e necessitam de indexação inicial. | 0 registos canónicos (apenas checkpoints válidos, se existirem). | Não-destrutiva (criação inicial). Ação canónica: `generate`. |
| **`incremental`** | Identidade publicada é compatível com o alvo; ficheiro canónico é legível e homogéneo. Apenas chunks novos/modificados são gerados. | Preserva todos os registos canónicos válidos correspondentes a chunks inalterados. | Segura e incremental. Ação canónica: `update`. |
| **`full-rebuild`** | Incompatibilidade estrutural de identidade (provider, model, dimensions, inputVersion, prefixMode alterados), manifesto legado/incompleto, identidade mista nos registos canónicos ou duplicados/inválidos graves. | **0 registos canónicos reutilizáveis**. Todos os registos existentes são descartados. | **Destrutiva (substituição integral)**. Exige **confirmação explícita**. Ação canónica: `rebuild`. |
| **`indeterminate`** | Ficheiro canónico ilegível (limite de recursos ou corrupção de parsing). Não é possível determinar trabalho de forma segura. | N/A | **Bloqueante**. Ação canónica: `none`. |

---

## 4. Transformação para o Lifecycle e Análise de Perda Semântica

### 4.1 Ponto de Injeção: `embeddingLifecycleAdapter.ts`
No adapter ([`src/index/embeddingLifecycleAdapter.ts`](src/index/embeddingLifecycleAdapter.ts) linhas 130–151):
```typescript
if (inputs.updatePlan) {
  const targetSummary = toEmbeddingIdentitySummary(inputs.updatePlan.targetIdentity);
  const effectivePublished = publishedIdentity ?? (
    inputs.updatePlan.mode === "incremental" ? targetSummary : undefined
  );

  workAssessment = classifyEmbeddingWork({
    publishedIdentity: effectivePublished,
    targetIdentity: targetSummary,
    canonicalExists,
    canonicalReadability: inputs.canonicalReadability ?? "readable",
    totalChunks: inputs.updatePlan.totalChunks,
    reusableCanonicalCount: inputs.updatePlan.reusableCanonicalCount,
    recoverableCheckpointCount: inputs.updatePlan.recoverableCheckpointCount,
    toGenerateCount: inputs.updatePlan.toGenerateCount,
    staleToReplaceCount: inputs.updatePlan.staleToReplaceCount,
    missingCount: inputs.updatePlan.missingCount,
    obsoleteToDropCount: inputs.updatePlan.obsoleteToDropCount,
    requiresPublication: inputs.updatePlan.requiresPublication,
    isExternalProvider: inputs.isExternalProvider ?? false,
  });
}
```

### 4.2 Ponto de Falha: `classifyEmbeddingWork` em `embeddingLifecycleModel.ts`
A interface `ClassifyEmbeddingWorkInput` **não aceita `planMode` nem `planReasons`**.
A função `classifyEmbeddingWork` tenta "adivinhar" o modo a partir de `publishedIdentity` vs `targetIdentity`:
1. Se `canonicalReadability === "unreadable"` ⇒ `indeterminate`.
2. Se `!canonicalExists` ⇒ `initial-build`.
3. Se `publishedIdentity && targetIdentity` forem incompatíveis ⇒ `full-rebuild`.
4. **Se `toGenerateCount > 0 || staleToReplaceCount > 0 || missingCount > 0` ⇒ `incremental` (FALLBACK INDEVIDO)**.

### 4.3 Ponto de Falha: `buildEmbeddingWorkLifecycleSnapshot` em `embeddingWorkStatusController.ts`
Nas linhas 158–173:
1. `dimensions` de `publishedIdentity` recebem fallback de `updatePlan.targetIdentity.dimensions`, **eliminando a deteção de discrepância de dimensões**.
2. `inputVersion` é **hardcoded para 1** tanto em `targetIdentity` como em `publishedIdentity`, **eliminando discrepâncias de versão de input**.
3. Quando o `updatePlan` deteta `canonical-identity-mixed` ou `published-identity-incomplete`, o plano fica `mode: "full-rebuild"`, mas `publishedIdentity` e `targetIdentity` aparecem idênticos.
4. `classifyEmbeddingWork` entra na regra 4 e classifica o trabalho como **`mode: "incremental"`**.
5. `resolveEmbeddingLifecycle` resolve o estado primário como **`primary: "UPDATE_AVAILABLE"`**.
6. `deriveEmbeddingWritePathDecision` deriva **`action: "update"`**, **`requiresConfirmation: false`**.
7. `evaluateSchedulerDecisionFromSnapshot` conclui **`canDispatch: true` (`"auto-dispatch-approved"`)**.

---

## 5. Matriz de Coerência Operacional

| Cenário Factual | `updatePlan.mode` / `reasons` | Lifecycle Atual (Buggy) | Lifecycle Esperado (Correto) | Decisão Canónica Esperada | Auto-Dispatch |
|---|---|---|---|---|---|
| **Sem trabalho** | `incremental` / `[up-to-date]` | `READY` | `READY` | `action: none` | Não |
| **Indexação Inicial** | `initial-build` / `[canonical-missing]` | `INDEX_ONLY` | `INDEX_ONLY` | `action: generate` | Conforme política |
| **Atualização Incremental Normal** | `incremental` / `[missing-chunks]` | `UPDATE_AVAILABLE` | `UPDATE_AVAILABLE` | `action: update` | Conforme política (local) |
| **Manifesto Legado / Incompleto** | `full-rebuild` / `[published-identity-incomplete]` | ❌ `UPDATE_AVAILABLE` | ✅ `INCOMPATIBLE` | `action: rebuild`, `requiresConfirmation: true` | **Bloqueado** |
| **Canónico com Identidades Mistas** | `full-rebuild` / `[canonical-identity-mixed]` | ❌ `UPDATE_AVAILABLE` | ✅ `INCOMPATIBLE` | `action: rebuild`, `requiresConfirmation: true` | **Bloqueado** |
| **Registo Canónico com Modelo Mismatch** | `full-rebuild` / `[canonical-record-identity-mismatch]` | ❌ `UPDATE_AVAILABLE` | ✅ `INCOMPATIBLE` | `action: rebuild`, `requiresConfirmation: true` | **Bloqueado** |
| **Duplicados / Inválidos no Canónico** | `full-rebuild` ou `incremental` c/ clean | Conforme plano | Conforme plano | `action: update` ou `rebuild` | Conforme política |
| **Alteração de Dimensão / Prefixo / Modelo** | `full-rebuild` / `[dimension-changed, ...]` | `INCOMPATIBLE` | `INCOMPATIBLE` | `action: rebuild`, `requiresConfirmation: true` | **Bloqueado** |
| **Canónico Ilegível (Teto/Corrupção)** | `indeterminate` / `[canonical-unreadable]` | `INDETERMINATE` | `INDETERMINATE` | `action: none`, `blocked: indeterminate` | **Bloqueado** |
| **Companion / Standby** | N/A | `STANDBY` / `COMPANION` | `STANDBY` / `COMPANION` | `action: none`, `applicable: false` | **Bloqueado** |

---

## 6. Provas Empíricas e Reprodução de F-03

### Teste de Reprodução 1: Manifesto Legado
- **Cenário:** Ficheiro `manifest.json` antigo apenas com `provider` e `model`, sem `inputVersion` nem `prefixMode`.
- **Resultado do Planeador:** `calculateEmbeddingUpdatePlan` devolve `mode: "full-rebuild"`, `reasons: ["published-identity-incomplete"]`.
- **Resultado do Lifecycle Atual:** `buildEmbeddingWorkLifecycleSnapshot` produz `primary: "UPDATE_AVAILABLE"`, `write.work.mode: "incremental"`.
- **Resultado da Decisão:** `deriveEmbeddingWritePathDecision` produz `action: "update"`, `requiresConfirmation: false`.
- **Resultado do Scheduler:** `evaluateSchedulerDecisionFromSnapshot` produz `canDispatch: true`, `reason: "auto-dispatch-approved"`.
- **Impacto:** O Scheduler dispara em background sem confirmação. O gerador recalcula o plano, descarta o índice existente e reconstrói todo o vault.

### Teste de Reprodução 2: Canónico com Identidade Mista
- **Cenário:** Vault sincronizado parcialmente com registos de modelos diferentes em `embeddings.jsonl`.
- **Resultado do Planeador:** `mode: "full-rebuild"`, `reasons: ["canonical-identity-mixed"]`.
- **Resultado do Lifecycle Atual:** `primary: "UPDATE_AVAILABLE"`, `action: "update"`, `requiresConfirmation: false`.
- **Impacto:** O utilizador vê na UI "Atualização disponível" e clica num botão que executa sem aviso uma reconstrução total destrutiva.

---

## 7. Decisão e Plano de Correção (Classificação A)

A auditoria conclui categoricamente com **Classificação A — Correção Necessária**.

### Plano de Correção Mínimo e Seguro:
1. **Passagem do Modo e Razões do Plano para `classifyEmbeddingWork`:**
   - Adicionar `planMode?: EmbeddingUpdateMode` e `planReasons?: readonly EmbeddingUpdatePlanReason[]` a `ClassifyEmbeddingWorkInput`.
   - Se `input.planMode === "full-rebuild"`, `classifyEmbeddingWork` deve respeitar o plano e classificar o trabalho como `mode: "full-rebuild"`, `severity: "blocking"`, preservando as razões do plano.
2. **Correção do Adapter `embeddingLifecycleAdapter.ts`:**
   - Encaminhar `inputs.updatePlan.mode` e `inputs.updatePlan.reasons` para `classifyEmbeddingWork`.
   - Preservar a identidade publicada real sem forçar cópia sintética das dimensões ou inputVersion do alvo quando estes diferem.
3. **Correção de `buildEmbeddingWorkLifecycleSnapshot` em `embeddingWorkStatusController.ts`:**
   - Usar `safeSummary.updatePlan?.targetIdentity?.inputVersion` real.
   - Preservar `safeSummary.dimensions` publicado sem sobrescrever com o alvo.
4. **Alinhamento do Snapshot Resolver (`resolveEmbeddingLifecycle`):**
   - Quando `effectiveWork.mode === "full-rebuild"`, o estado primário deve ser `INCOMPATIBLE` (se o ficheiro canónico existir e a identidade for incompatível/mista) ou o Write Path deve derivar estritamente `action: "rebuild"` e `requiresConfirmation: true`.
5. **Proteção do Scheduler (`evaluateSchedulerDecisionFromSnapshot`):**
   - Garantir que `action === "rebuild"` ou `work.mode === "full-rebuild"` **nunca** permite `canDispatch = true`.
6. **Suíte de Testes Exaustiva:**
   - Testes unitários e de integração validando a equivalência estrita entre `updatePlan` e o lifecycle para todos os 10 cenários da matriz de coerência.
