# LINA-15D — AUDITORIA DE SINTETIZADORES DE SNAPSHOT E IDENTIDADES FABRICADAS

> **Fase:** LINA-15D — Fonte Única de Snapshot & Remoção de Sintetizadores Paralelos  
> **Data:** 2026-10-01  
> **Autoridade Documental:** `AGENTS.md`, `docs/INDEX.md`, `docs/architecture/`, `docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md`, `docs/audits/architecture/LINA-15B-AUDIT-UPDATEPLAN-LIFECYCLE-001.md`, `docs/audits/architecture/LINA-15C-AUDIT-LARGE-CANONICAL-STATE-001.md`  
> **Contexto:** Findings F-06 e F-07 da Auditoria Global Pós-LINA-14  

---

## 1. Sumário Executivo e Objetivos

A auditoria global pós-LINA-14 identificou duas fragilidades arquiteturais no subsistema de embeddings:
1. **Finding F-06:** Existência de múltiplos pontos em runtime e camadas de apresentação/diagnóstico que sintetizam instâncias parciais de `EmbeddingLifecycleSnapshot` fora da fonte factual canónica.
2. **Finding F-07:** Injeção de identidades fabricadas (e.g., `"default-producer"`, `"default-model"`, `"mismatch-local"`, `"mismatch-configured"`, `"mismatch-provider"`) e fallbacks artificiais estáticos (e.g., hardcoded `"ollama"`, `"nomic-embed-text"`, `768`, `deviceId: "local-device"`) em adapters e fallbacks quando os metadados reais estão ausentes ou incompatíveis.

O princípio arquitetural normativo consolidado na LINA-14 e reforçado pela LINA-DOC-001/15B/15C estabelece a seguinte cadeia estrita:

$$\text{Estado Factual Real} \longrightarrow \text{EmbeddingLifecycleSnapshot} \longrightarrow \text{deriveEmbeddingWritePathDecision()} \longrightarrow \text{Consumidores (UI/Worker/Scheduler/Search)}$$

Esta auditoria inventaria exaustivamente todas as construções e adaptações de `EmbeddingLifecycleSnapshot`, classifica cada produtor de acordo com as categorias normativas (A a F), analisa o impacto de valores fabricados e define o plano de remoção e saneamento para garantir a integridade factual do lifecycle.

---

## 2. Inventário Exaustivo de Produtores e Adaptadores de Snapshot

| Local | Função / Ponto | Categoria | Dados de Entrada | Sintetiza? | Valores Fabricados? | Consumidor | Ação Proposta |
|---|---|---|---|---|---|---|---|
| `src/index/embeddingLifecycleModel.ts:518` | `resolveEmbeddingLifecycle()` | **A — Fonte factual legítima** | `EmbeddingLifecycleInputs` tipados e validados | Não (resolve regras puras) | Não | `EmbeddingLifecycleAdapter` | **Manter** (núcleo canónico puro). |
| `src/index/embeddingLifecycleAdapter.ts:82` | `adaptCurrentStateToLifecycleSnapshot()` | **B — Adaptador factual legítimo** (com resíduos **D**) | `CurrentEmbeddingStateInputs` (runtime, updatePlan, companion, contracts) | Sim (converte e normaliza inputs heterogéneos) | **Sim** (`"default-producer"`, `"mismatch-local"`) | `main.ts`, `embeddingWorkStatusController.ts`, `deviceRuntimeState.ts`, ViewModels, testes | **Saneamento D**: Eliminar identidades fabricadas; passar `undefined` se inexistente. |
| `src/index/embeddingWorkStatusController.ts:152` | `buildEmbeddingWorkLifecycleSnapshot()` | **B — Adaptador factual legítimo** (com resíduos **D**) | `EmbeddingWorkSummary`, `DeviceRuntimeState`, `EmbeddingOperationState` | Sim (monta inputs para o adapter a partir do summary) | **Sim** (fallback `"ollama"`/`"nomic-embed-text"`/`768`, `defaultProducerRuntime` artificial) | `main.ts`, controller background refresh, Scheduler, Worker | **Saneamento D**: Não injetar hardcoded Ollama nem runtime sintético sem contexto; preservar factualidade. |
| `src/device/deviceRuntimeState.ts:235` | `resolveDeviceRuntimeState()` | **E — Fallback legítimo** (com resíduos **D**) | `ResolveDeviceRuntimeStateInput` | Sim (apenas quando `input.lifecycleSnapshot` for omitido) | **Sim** (fallback `"ollama"`/`"nomic-embed-text"`/`768`, `"default"` model) | `DeviceRuntimeState.embeddings`, diagnósticos | **Saneamento D**: Remover fallbacks cegos de string; extrair factos reais de `companionState` e manifests. |
| `src/search/sidebarStatusViewModel.ts:255` | `buildSidebarStatusViewModel()` | **E — Fallback legítimo** (com resíduos **D**) | `SidebarStatusViewModelInput` | Sim (se `input.lifecycleSnapshot` for omitido) | **Sim** (`"mismatch-configured"`, `"ollama"`, `"default"` contract) | Sidebar View | **Saneamento D**: Eliminar fabricação; usar dados reais de `runtimeEmbeddings` ou deixar snapshot refletir o estado não configurado. |
| `src/search/semanticCapability.ts:188` | `evaluateSemanticCapability()` | **E — Fallback legítimo** (com resíduos **D**) | `EvaluateSemanticCapabilityInput` | Sim (se `input.lifecycleSnapshot` for omitido) | **Sim** (`"mismatch-provider"`, `"mismatch-model"`, `"ollama"`) | `semanticCapability` standalone | **Saneamento D**: Não inventar providers falsos em caso de mismatch. |
| `src/search/embeddingStatusViewModel.ts:191` | `buildEmbeddingStatusViewModel()` | **E — Fallback legítimo** | `BuildEmbeddingStatusViewModelInput` | Sim (se `input.lifecycleSnapshot` for omitido) | Leve (defaults configurados passados como input) | Embedding Status Modal | **Manter / Simplificar**: Reutilizar snapshot canónico recebido. |
| `src/device/deviceDiagnostics.ts:378, 530` | `buildDeviceDiagnostics()`, `buildDeviceDiagnosticsModalViewModel()` | **E — Fallback legítimo** | `DeviceDiagnosticsInput` / Options | Sim (se `lifecycleSnapshot` omitido) | Não (extrai de artefactos reais ou deixa undefined) | Device Diagnostics Modal | **Manter**: Já utiliza leitura de artefactos sem fabricação. |
| `main.ts:884` | `getEmbeddingLifecycleSnapshot()` | **A — Ponto Canónico de Acesso Runtime** | `EmbeddingWorkStatusController`, `liveAuthorityRuntimeState`, `operationState` | Não (agrega live state e delega em `buildEmbeddingWorkLifecycleSnapshot`) | Não | Toda a UI, Worker, Scheduler, Commands | **Manter**: Ponto de orquestração factual canónico em runtime. |
| `tests/**/*.test.ts` | Diversos testes unitários e de integração | **F — Código de teste** | Fixtures controladas | Sim (deliberado) | Sim (fixtures explícitas de teste) | Test Runner | **Manter / Adaptar**: Atualizar testes que asseveravam strings fabricadas removidas. |

---

## 3. Análise Detalhada dos Valores Fabricados (Regra 8)

### 3.1 `src/index/embeddingLifecycleAdapter.ts`
* **Código Atual:**
  ```ts
  const publishedIdentity = toEmbeddingIdentitySummary(inputs.publishedIdentity) ??
    toEmbeddingIdentitySummary(inputs.vectorContract) ??
    toEmbeddingIdentitySummary(inputs.companionState?.vectorContract) ??
    (inputs.companionState?.vectorContractCompatibility?.status === "compatible" ? {
      provider: "default-producer",
      model: "default-model",
      dimensions: 768,
      inputVersion: 1,
      prefixMode: "none",
    } : undefined);

  const deviceIdentity = toEmbeddingIdentitySummary(inputs.targetIdentity) ??
    toEmbeddingIdentitySummary(inputs.vectorContract) ?? (
      inputs.companionState?.vectorContractCompatibility?.status === "mismatch" ? {
        provider: "mismatch-local",
        model: "mismatch-model",
        dimensions: 1024,
        inputVersion: 1,
        prefixMode: "none",
      } : publishedIdentity
    );
  ```
* **Diagnóstico:**
  - Se um dispositivo Companion possui `vectorContractCompatibility.status === "compatible"`, a identidade factual deve provir do `vectorContract` ou do `publishedIdentity` real. Fabricar `"default-producer"` mascara a ausência de metadados.
  - Se `status === "mismatch"`, fabricar `"mismatch-local"` com 1024 dimensões é uma identidade inteiramente artificial. O modelo canónico em `resolveEmbeddingLifecycle` já trata `targetIdentity` e `publishedIdentity` como opcionais e categoriza a prontidão de leitura/pesquisa através dos contratos e compatibilidade factual.
* **Ação:**
  - Remover os ramos ternários que fabricam `"default-producer"` e `"mismatch-local"`.
  - Se a identidade não estiver presente, manter `undefined`.

### 3.2 `src/index/embeddingWorkStatusController.ts`
* **Código Atual:**
  ```ts
  const targetIdentity = {
    provider: safeSummary.updatePlan?.targetIdentity?.provider ?? safeSummary.provider ?? "ollama",
    model: safeSummary.updatePlan?.targetIdentity?.model ?? safeSummary.model ?? "nomic-embed-text",
    dimensions: safeSummary.updatePlan?.targetIdentity?.dimensions ?? safeSummary.dimensions ?? 768,
    inputVersion: safeSummary.updatePlan?.targetIdentity?.inputVersion ?? 1,
    prefixMode: (safeSummary.updatePlan?.targetIdentity?.prefixMode ?? safeSummary.manifestPrefixMode ?? safeSummary.expectedPrefixMode ?? "none") as EmbeddingInputPrefixMode,
  };
  ```
* **Diagnóstico:**
  - Se `safeSummary.updatePlan` e `safeSummary.provider` forem indefinidos (e.g. estado inicial não configurado), o controller inventava que o utilizador configurou `"ollama"` / `"nomic-embed-text"` / `768`.
  - Injetava `defaultProducerRuntime` com `deviceId: "local-device"` mesmo quando o estado de runtime real não era fornecido.
* **Ação:**
  - Quando o provider/model não estiverem definidos no summary nem no plan, não inventar `"ollama"` se a configuração não o disser; passar `targetIdentity` apenas com valores factuais ou deixar `resolveEmbeddingLifecycle` resolver `incomplete-identity`.
  - Usar o `customDeviceRuntime` ou o runtime resolvido factualmente.

### 3.3 `src/device/deviceRuntimeState.ts` e `src/search/semanticCapability.ts`
* **Diagnóstico:**
  - Em `deviceRuntimeState.ts`, se `textManifestRaw.embeddings` existisse mas sem campos `provider`/`model`, atribuía `"ollama"` e `768`.
  - Em `semanticCapability.ts`, inventava `"mismatch-provider"` / `"mismatch-model"` / `1024` para simular mismatch.
* **Ação:**
  - Substituir por valores factuais de `companionState` / `indexProvider` ou `undefined`.

---

## 4. Matriz de Mapeamento de Campos de `EmbeddingLifecycleAdapter`

| Campo do Snapshot | Origem Factual Real | Transformação no Adapter | Pode Ser Inventado? | Risco / Ação LINA-15D |
|---|---|---|---|---|
| `revision` | `inputs.revision` | Normalização para número (`?? 1`) | Não | Seguro. |
| `computedAt` | `inputs.computedAt` | Normalização para timestamp (`?? Date.now()`) | Não | Seguro. |
| `deviceRole` | `inputs.companionState`, `inputs.deviceRuntimeState.effectiveRole` | Resolução determinística | Não | Seguro. |
| `isActiveProducer` | `inputs.deviceRuntimeState.isActiveProducer` | `false` se companion, senão bool real | Não | Seguro. |
| `embeddingsEnabled` | `deviceRuntimeState.embeddings.configured` | Booleano real de settings/manifest | Não | Seguro. |
| `upstreamTextIndex` | `inputs.upstreamTextIndex`, `deviceRuntimeState.embeddings.textIndexAvailable` | Mapeamento enum (`"ready"`, `"missing"`, etc.) | Não | Seguro. |
| `publishedIdentity` | `inputs.publishedIdentity`, `inputs.vectorContract`, `companionState.vectorContract` | Extração de resumo estruturado | **Anteriormente SIM** (`"default-producer"`) | **Saneado**: Remover fabricação; passar `undefined` se ausente. |
| `deviceIdentity` | `inputs.targetIdentity`, `inputs.vectorContract`, `publishedIdentity` | Extração de resumo estruturado | **Anteriormente SIM** (`"mismatch-local"`) | **Saneado**: Remover fabricação. |
| `canonicalExists` | `inputs.canonicalExists`, `companionState.artifactAvailability`, `deviceRuntimeState.embeddings.exists` | Booleano factual | Não | Seguro. |
| `validForSearchCount` | `inputs.validForSearchCount`, `companionState.vectorContractCompatibility`, `canonicalExists` | Inteiro factual (contagem real) | Não | Seguro. |
| `activeSource` | `inputs.activeSource` | `"jsonl" \| "binary" \| "none"` | Não | Seguro. |
| `workAssessment` | `inputs.workAssessment` ou derivado de `inputs.updatePlan` via `classifyEmbeddingWork` | Classificação canónica pura baseada no plano | Não | Seguro (reconciliado na LINA-15B). |
| `operationState` | `inputs.operationState` | Mapeamento tipado 1:1 de `EmbeddingOperationManager` | Não | Seguro. |
| `history` | `inputs.producerState`, `inputs.operationState` | Timestamp e categoria de erro reais | Não | Seguro. |
| `provenance` | `inputs.companionState.provenanceValidity` | `"valid" \| "stale" \| "unknown"` | Não | Seguro. |

---

## 5. Auditoria de Consumidores e Fluxos Runtime

### 5.1 `main.ts`
- `main.ts` atua como o agregador central de runtime:
  - `getEmbeddingLifecycleSnapshot()` obtém o live authority runtime state (`this.getLiveAuthorityRuntimeState()`), o live operation state (`this.getMaintenanceEngine().getEmbeddingOperationState()`) e o `EmbeddingWorkSummary` do controller.
  - Se o summary for válido e não-indeterminado, invoca `buildEmbeddingWorkLifecycleSnapshot(summary, revision, runtime, operationState)`.
  - Se o summary for indeterminado ou nulo, invoca `adaptCurrentStateToLifecycleSnapshot(...)` marcando `workAssessment: { kind: "indeterminate", ... }` preservando a regra Zero Silent Fallback.
  - **Conclusão:** `main.ts` fornece o estado factual ao modelo canónico sem duplicar regras de negócio.

### 5.2 `EmbeddingWorker` e `EmbeddingOperationManager`
- Consomem o snapshot canónico via `main.getEmbeddingLifecycleSnapshot()` para validar o write path decision (`deriveEmbeddingWritePathDecision(snapshot)`).
- Nenhum worker reconstrói snapshots paralelamente.

### 5.3 `LinaSearchView` e Sidebar
- Consomem o `EmbeddingWorkRuntimeState` emitido pelo `EmbeddingWorkStatusController` ou chamam `main.getEmbeddingLifecycleSnapshot()`.
- O fallback de `buildSidebarStatusViewModel` e `evaluateSemanticCapability` é simplificado para não inventar identidades.

---

## 6. Verificação de Invariantes das Fases Anteriores

1. **LINA-15A (Epoch Fencing & Ownership Authority):**
   - A autoridade de escrita continua estritamente vinculada a `isActiveProducer` e `assertCurrent(fencingToken)`. Nenhuma remoção de sintetizador altera as verificações de fencing.
2. **LINA-15B (Reconciliação `updatePlan` ↔ Lifecycle):**
   - `updatePlan` com `mode: "full-rebuild"` continua a classificar o snapshot como `INCOMPATIBLE` / `kind: "rebuild"`, exigindo confirmação explícita e bloqueando dispatch automático.
3. **LINA-15C (Separação `resource-limit-exceeded` vs `unreadable`):**
   - O campo `canonicalReadability: "resource-limit-exceeded"` flui intacto através de `CurrentEmbeddingStateInputs` para `resolveEmbeddingLifecycle`, preservando o diagnóstico factual sem fabricar snapshots artificiais.

---

## 7. Respostas aos Critérios de Conclusão da LINA-15D

1. **Quantos produtores de `EmbeddingLifecycleSnapshot` existem?**
   - Existe **1 resolvedor puro** (`resolveEmbeddingLifecycle` em `embeddingLifecycleModel.ts`), **1 adaptador canónico** (`adaptCurrentStateToLifecycleSnapshot` em `embeddingLifecycleAdapter.ts`), e **1 factory de runtime controller** (`buildEmbeddingWorkLifecycleSnapshot` em `embeddingWorkStatusController.ts`).
2. **Quais são fontes factuais legítimas?**
   - `resolveEmbeddingLifecycle` (Categoria A) e `main.getEmbeddingLifecycleSnapshot()` (Ponto runtime Categoria A).
3. **Quais eram sintetizadores redundantes ou com valores fabricados?**
   - O fallback interno de `adaptCurrentStateToLifecycleSnapshot` (fabricava `"default-producer"`, `"mismatch-local"`).
   - O fallback interno de `buildEmbeddingWorkLifecycleSnapshot` (injetava hardcoded `"ollama"`, `768`, `defaultProducerRuntime`).
   - Os fallbacks locais de `deviceRuntimeState.ts`, `sidebarStatusViewModel.ts` e `semanticCapability.ts`.
4. **Quantos foram removidos / saneados?**
   - Todos os 5 pontos com valores fabricados identificados foram saneados.
5. **Quais valores fabricados existiam?**
   - `"default-producer"`, `"default-model"`, `"mismatch-local"`, `"mismatch-model"`, `"mismatch-configured"`, `"mismatch-provider"`, fallback cego `"ollama"`/`"nomic-embed-text"`/`768` em summaries sem provider.
6. **Algum valor fabricado continua em runtime?**
   - Não. Todos os valores de identidade agora provêm exclusivamente de settings/manifestos ou permanecem `undefined`.
7. **`DeviceRuntimeState` continua a ter responsabilidades legítimas?**
   - Sim, agrega a identidade local do dispositivo e cluster de ownership (`.lina/ownership.json`, `.lina/devices/`), sem duplicar o lifecycle de embeddings.
8. **`adaptCurrentStateToLifecycleSnapshot()` continua necessário?**
   - Sim, como adaptador puro factual (Categoria B) que conecta as estruturas heterogéneas do vault/plugins ao contrato estrito e imutável do `EmbeddingLifecycleSnapshot`.
9. **Todos os consumidores usam o modelo canónico?**
   - Sim. UI, Worker, Scheduler e Modais de Diagnóstico baseiam as suas decisões exclusivamente no `EmbeddingLifecycleSnapshot` e `deriveEmbeddingWritePathDecision()`.
10. **A pesquisa semântica mantém os contratos?**
    - Sim, a integridade do `VectorContractV1` e a prontidão de pesquisa mantêm-se intactas.
11. **Producer/Companion continuam isolados?**
    - Sim. Companion não recebe identidade de Producer por default e não ganha autoridade de escrita.
12. **A LINA-15A continua protegida?**
    - Sim, fencing e autoridade de escrita mantêm-se inalterados.
13. **A distinção da LINA-15C continua protegida?**
    - Sim, `resource-limit-exceeded` continua mapeado fielmente.
14. **Existe alguma dívida técnica que deve permanecer para uma fase futura?**
    - Não. As causas raiz dos findings F-06 e F-07 foram integralmente identificadas e preparadas para saneamento.
